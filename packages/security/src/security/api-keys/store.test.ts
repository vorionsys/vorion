import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryApiKeyStore,
  createApiKeyStore,
  getApiKeyStore,
  resetApiKeyStore,
  getStoreType,
} from './store.js';
import { ApiKeyScope, ApiKeyStatus, DEFAULT_API_KEY_RATE_LIMIT } from './types.js';
import type { ApiKey, ApiKeyRateLimitState } from './types.js';

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: `key-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Test Key',
    hashedKey: 'sha256-hash-value',
    prefix: Math.random().toString(36).slice(2, 10),
    tenantId: 'tenant-1',
    scopes: [ApiKeyScope.READ],
    rateLimit: { ...DEFAULT_API_KEY_RATE_LIMIT },
    status: ApiKeyStatus.ACTIVE,
    expiresAt: null,
    createdAt: new Date(),
    lastUsedAt: null,
    metadata: {},
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('InMemoryApiKeyStore', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    store = createApiKeyStore();
  });

  afterEach(() => {
    store.stop();
  });

  describe('create()', () => {
    it('stores and returns the API key', async () => {
      const key = makeApiKey();
      const result = await store.create(key);
      expect(result.id).toBe(key.id);
      expect(result.name).toBe(key.name);
    });

    it('throws on duplicate prefix', async () => {
      const key1 = makeApiKey({ prefix: 'abcd1234' });
      const key2 = makeApiKey({ prefix: 'abcd1234' });
      await store.create(key1);
      await expect(store.create(key2)).rejects.toThrow('already exists');
    });
  });

  describe('getById()', () => {
    it('retrieves key by ID', async () => {
      const key = makeApiKey();
      await store.create(key);
      const result = await store.getById(key.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(key.id);
    });

    it('returns null for unknown ID', async () => {
      const result = await store.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getByPrefix()', () => {
    it('retrieves key by prefix', async () => {
      const key = makeApiKey({ prefix: 'testpfx1' });
      await store.create(key);
      const result = await store.getByPrefix('testpfx1');
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('testpfx1');
    });

    it('returns null for unknown prefix', async () => {
      const result = await store.getByPrefix('unknown1');
      expect(result).toBeNull();
    });
  });

  describe('update()', () => {
    it('updates mutable fields', async () => {
      const key = makeApiKey();
      await store.create(key);
      const updated = await store.update(key.id, {
        name: 'Updated Name',
        status: ApiKeyStatus.REVOKED,
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.status).toBe(ApiKeyStatus.REVOKED);
    });

    it('preserves immutable fields (id, prefix, hashedKey, tenantId, createdAt, createdBy)', async () => {
      const key = makeApiKey();
      await store.create(key);
      const updated = await store.update(key.id, {
        id: 'hacked-id',
        prefix: 'hacked!!',
        hashedKey: 'hacked-hash',
        tenantId: 'hacked-tenant',
        createdBy: 'hacked-user',
      } as Partial<ApiKey>);
      expect(updated!.id).toBe(key.id);
      expect(updated!.prefix).toBe(key.prefix);
      expect(updated!.hashedKey).toBe(key.hashedKey);
      expect(updated!.tenantId).toBe(key.tenantId);
      expect(updated!.createdBy).toBe(key.createdBy);
    });

    it('returns null for unknown ID', async () => {
      const result = await store.update('nonexistent', { name: 'x' });
      expect(result).toBeNull();
    });

    it('updated key is retrievable by prefix', async () => {
      const key = makeApiKey();
      await store.create(key);
      await store.update(key.id, { name: 'New Name' });
      const byPrefix = await store.getByPrefix(key.prefix);
      expect(byPrefix!.name).toBe('New Name');
    });
  });

  describe('delete()', () => {
    it('removes key from store', async () => {
      const key = makeApiKey();
      await store.create(key);
      const deleted = await store.delete(key.id);
      expect(deleted).toBe(true);
      expect(await store.getById(key.id)).toBeNull();
      expect(await store.getByPrefix(key.prefix)).toBeNull();
    });

    it('returns false for unknown ID', async () => {
      const result = await store.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('also removes rate limit state', async () => {
      const key = makeApiKey();
      await store.create(key);
      const now = Date.now();
      await store.setRateLimitState({
        keyId: key.id,
        second: { count: 1, resetAt: now + 1000 },
        minute: { count: 1, resetAt: now + 60000 },
        hour: { count: 1, resetAt: now + 3600000 },
      });
      await store.delete(key.id);
      expect(await store.getRateLimitState(key.id)).toBeNull();
    });
  });

  describe('list()', () => {
    it('filters by tenantId', async () => {
      await store.create(makeApiKey({ tenantId: 'tenant-a', prefix: 'aaaa1111' }));
      await store.create(makeApiKey({ tenantId: 'tenant-b', prefix: 'bbbb2222' }));
      const result = await store.list({ tenantId: 'tenant-a' });
      expect(result.total).toBe(1);
      expect(result.keys[0].tenantId).toBe('tenant-a');
    });

    it('filters by status', async () => {
      await store.create(makeApiKey({ status: ApiKeyStatus.ACTIVE, prefix: 'actv0001' }));
      await store.create(makeApiKey({ status: ApiKeyStatus.REVOKED, prefix: 'revk0001' }));
      const result = await store.list({ tenantId: 'tenant-1', status: ApiKeyStatus.ACTIVE });
      expect(result.keys.every(k => k.status === ApiKeyStatus.ACTIVE)).toBe(true);
    });

    it('filters by scope', async () => {
      await store.create(makeApiKey({ scopes: [ApiKeyScope.READ], prefix: 'read0001' }));
      await store.create(makeApiKey({ scopes: [ApiKeyScope.ADMIN], prefix: 'admn0001' }));
      const result = await store.list({ tenantId: 'tenant-1', scope: ApiKeyScope.ADMIN });
      expect(result.keys.every(k => k.scopes.includes(ApiKeyScope.ADMIN))).toBe(true);
    });

    it('filters by createdBy', async () => {
      await store.create(makeApiKey({ createdBy: 'alice', prefix: 'alce0001' }));
      await store.create(makeApiKey({ createdBy: 'bob', prefix: 'bobb0001' }));
      const result = await store.list({ tenantId: 'tenant-1', createdBy: 'alice' });
      expect(result.keys.every(k => k.createdBy === 'alice')).toBe(true);
    });

    it('sorts by createdAt descending', async () => {
      const older = makeApiKey({
        prefix: 'old00001',
        createdAt: new Date('2024-01-01'),
      });
      const newer = makeApiKey({
        prefix: 'new00001',
        createdAt: new Date('2025-01-01'),
      });
      await store.create(older);
      await store.create(newer);
      const result = await store.list({ tenantId: 'tenant-1' });
      expect(result.keys[0].prefix).toBe('new00001');
    });

    it('respects pagination (offset and limit)', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create(makeApiKey({
          prefix: `pag${i.toString().padStart(5, '0')}`,
          createdAt: new Date(2025, 0, i + 1),
        }));
      }
      const result = await store.list({ tenantId: 'tenant-1', offset: 1, limit: 2 });
      expect(result.keys).toHaveLength(2);
      expect(result.total).toBe(5);
    });
  });

  describe('rate limit state', () => {
    it('stores and retrieves rate limit state', async () => {
      const now = Date.now();
      const state: ApiKeyRateLimitState = {
        keyId: 'key-1',
        second: { count: 5, resetAt: now + 1000 },
        minute: { count: 30, resetAt: now + 60000 },
        hour: { count: 500, resetAt: now + 3600000 },
      };
      await store.setRateLimitState(state);
      const result = await store.getRateLimitState('key-1');
      expect(result).not.toBeNull();
      expect(result!.second.count).toBe(5);
      expect(result!.minute.count).toBe(30);
      expect(result!.hour.count).toBe(500);
    });

    it('returns null for unknown key', async () => {
      const result = await store.getRateLimitState('unknown');
      expect(result).toBeNull();
    });
  });

  describe('updateLastUsed()', () => {
    it('updates lastUsedAt timestamp', async () => {
      const key = makeApiKey();
      await store.create(key);
      expect(key.lastUsedAt).toBeNull();

      await store.updateLastUsed(key.id);
      const updated = await store.getById(key.id);
      expect(updated!.lastUsedAt).toBeInstanceOf(Date);
    });

    it('no-ops for unknown key', async () => {
      await expect(store.updateLastUsed('unknown')).resolves.toBeUndefined();
    });
  });

  describe('reset()', () => {
    it('clears all data', async () => {
      await store.create(makeApiKey({ prefix: 'rst00001' }));
      store.reset();
      expect(await store.getByPrefix('rst00001')).toBeNull();
    });
  });

  describe('getStats()', () => {
    it('returns accurate statistics', async () => {
      await store.create(makeApiKey({ status: ApiKeyStatus.ACTIVE, prefix: 'stat0001' }));
      await store.create(makeApiKey({ status: ApiKeyStatus.ACTIVE, prefix: 'stat0002' }));
      await store.create(makeApiKey({ status: ApiKeyStatus.REVOKED, prefix: 'stat0003' }));

      const stats = store.getStats();
      expect(stats.totalKeys).toBe(3);
      expect(stats.byStatus.active).toBe(2);
      expect(stats.byStatus.revoked).toBe(1);
      expect(stats.byTenant['tenant-1']).toBe(3);
    });
  });
});

describe('getStoreType()', () => {
  it('returns memory in test environment', () => {
    expect(getStoreType()).toBe('memory');
  });
});

describe('singleton functions', () => {
  afterEach(() => {
    resetApiKeyStore();
  });

  it('getApiKeyStore returns singleton', () => {
    const store1 = getApiKeyStore();
    const store2 = getApiKeyStore();
    expect(store1).toBe(store2);
  });

  it('resetApiKeyStore clears singleton', () => {
    const store1 = getApiKeyStore();
    resetApiKeyStore();
    const store2 = getApiKeyStore();
    expect(store1).not.toBe(store2);
  });
});
