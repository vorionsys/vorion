/**
 * Tests for ServiceAccountManager, InMemoryServiceAccountStore, and utility functions
 *
 * Validates:
 * - Client ID/secret generation and hashing utilities
 * - InMemoryServiceAccountStore CRUD operations
 * - ServiceAccountManager lifecycle (create, verify, revoke, suspend, reactivate)
 * - Secret rotation
 * - Permission matching (exact, wildcard, prefix)
 * - IP whitelist enforcement
 * - Secret rotation recommendation logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
  InMemoryServiceAccountStore,
  ServiceAccountManager,
  ServiceAccountNotFoundError,
  ServiceAccountRevokedError,
  ServiceAccountSuspendedError,
  ServiceAccountError,
  SERVICE_CLIENT_ID_PREFIX,
  getServiceAccountStore,
  setServiceAccountStore,
  getServiceAccountManager,
  createServiceAccountManager,
  resetServiceAccountSingletons,
  serviceAccountSchema,
  createServiceAccountInputSchema,
  updateServiceAccountInputSchema,
  type CreateServiceAccountInput,
  type ServiceAccount,
} from '../service-account.js';

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// =============================================================================
// HELPERS
// =============================================================================

const VALID_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_TENANT_ID_2 = '660e8400-e29b-41d4-a716-446655440001';

function defaultInput(overrides: Partial<CreateServiceAccountInput> = {}): CreateServiceAccountInput {
  return {
    name: 'test-service',
    permissions: ['read:data'],
    tenantId: VALID_TENANT_ID,
    ...overrides,
  };
}

function createManager(overrides: {
  store?: InMemoryServiceAccountStore;
  minSecretRotationDays?: number;
  maxAccountsPerTenant?: number;
} = {}): { manager: ServiceAccountManager; store: InMemoryServiceAccountStore } {
  const store = overrides.store ?? new InMemoryServiceAccountStore();
  const manager = new ServiceAccountManager({
    store,
    minSecretRotationDays: overrides.minSecretRotationDays,
    maxAccountsPerTenant: overrides.maxAccountsPerTenant,
  });
  return { manager, store };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

describe('Service account utility functions', () => {
  describe('generateClientId', () => {
    it('starts with svc_ prefix', () => {
      const id = generateClientId();
      expect(id.startsWith(SERVICE_CLIENT_ID_PREFIX)).toBe(true);
    });

    it('has svc_ prefix followed by 32 hex chars', () => {
      const id = generateClientId();
      const hexPart = id.slice(SERVICE_CLIENT_ID_PREFIX.length);
      expect(hexPart).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('generateClientSecret', () => {
    it('produces a 64 hex character string', () => {
      const secret = generateClientSecret();
      expect(secret).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('hashClientSecret', () => {
    it('produces a 64 hex character SHA-256 hash', () => {
      const hash = hashClientSecret('test-secret');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyClientSecret', () => {
    it('returns true for matching secret and hash', () => {
      const secret = generateClientSecret();
      const hash = hashClientSecret(secret);
      expect(verifyClientSecret(secret, hash)).toBe(true);
    });

    it('returns false for wrong secret', () => {
      const secret = generateClientSecret();
      const hash = hashClientSecret(secret);
      expect(verifyClientSecret('wrong-secret', hash)).toBe(false);
    });

    it('returns false when hash lengths differ (length-mismatch branch)', () => {
      // Provide a hashedSecret that is shorter than a real SHA-256 hash (64 hex chars)
      // This exercises the `if (hashedInput.length !== hashedSecret.length)` branch at line 240
      const result = verifyClientSecret('some-secret', 'short');
      expect(result).toBe(false);
    });
  });
});

// =============================================================================
// IN-MEMORY STORE
// =============================================================================

describe('InMemoryServiceAccountStore', () => {
  let store: InMemoryServiceAccountStore;

  beforeEach(() => {
    store = new InMemoryServiceAccountStore();
  });

  function makeAccount(overrides: Partial<ServiceAccount> = {}): ServiceAccount {
    return {
      clientId: generateClientId(),
      clientSecret: hashClientSecret(generateClientSecret()),
      name: 'test-svc',
      permissions: ['read:data'],
      status: 'active',
      tenantId: VALID_TENANT_ID,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('create and findByClientId roundtrip', async () => {
    const account = makeAccount();
    await store.create(account);
    const found = await store.findByClientId(account.clientId);

    expect(found).not.toBeNull();
    expect(found!.clientId).toBe(account.clientId);
    expect(found!.name).toBe(account.name);
  });

  it('create throws ConflictError for duplicate clientId', async () => {
    const account = makeAccount();
    await store.create(account);
    await expect(store.create(account)).rejects.toThrow(/already exists/);
  });

  it('findByTenantId filters correctly', async () => {
    const a1 = makeAccount({ tenantId: VALID_TENANT_ID });
    const a2 = makeAccount({ tenantId: VALID_TENANT_ID });
    const a3 = makeAccount({ tenantId: VALID_TENANT_ID_2 });

    await store.create(a1);
    await store.create(a2);
    await store.create(a3);

    const tenant1Accounts = await store.findByTenantId(VALID_TENANT_ID);
    expect(tenant1Accounts).toHaveLength(2);

    const tenant2Accounts = await store.findByTenantId(VALID_TENANT_ID_2);
    expect(tenant2Accounts).toHaveLength(1);
  });

  it('update modifies and delete removes account', async () => {
    const account = makeAccount();
    await store.create(account);

    const updated = await store.update(account.clientId, { name: 'updated-name' });
    expect(updated.name).toBe('updated-name');

    const deleted = await store.delete(account.clientId);
    expect(deleted).toBe(true);

    const notFound = await store.findByClientId(account.clientId);
    expect(notFound).toBeNull();
  });

  it('clear() empties all accounts', async () => {
    await store.create(makeAccount());
    await store.create(makeAccount());
    store.clear();

    const results = await store.findByTenantId(VALID_TENANT_ID);
    expect(results).toHaveLength(0);
  });

  it('updateLastUsed() updates the lastUsedAt timestamp', async () => {
    const account = makeAccount();
    await store.create(account);

    expect(account.lastUsedAt).toBeUndefined();
    await store.updateLastUsed(account.clientId);

    const found = await store.findByClientId(account.clientId);
    expect(found!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('delete() for non-existent clientId returns false', async () => {
    const result = await store.delete('svc_nonexistent');
    expect(result).toBe(false);
  });

  it('update() for non-existent clientId throws ServiceAccountNotFoundError', async () => {
    await expect(store.update('svc_nonexistent', { name: 'x' })).rejects.toThrow(
      ServiceAccountNotFoundError
    );
  });
});

// =============================================================================
// SERVICE ACCOUNT MANAGER
// =============================================================================

describe('ServiceAccountManager', () => {
  let manager: ServiceAccountManager;
  let store: InMemoryServiceAccountStore;

  beforeEach(() => {
    const created = createManager();
    manager = created.manager;
    store = created.store;
  });

  // ---------------------------------------------------------------------------
  // createAccount
  // ---------------------------------------------------------------------------

  describe('createAccount', () => {
    it('produces a valid account with clientId and hashed secret', async () => {
      const result = await manager.createAccount(defaultInput());

      expect(result.account.clientId).toBeDefined();
      expect(result.account.clientId.startsWith(SERVICE_CLIENT_ID_PREFIX)).toBe(true);
      expect(result.account.clientSecret).toMatch(/^[a-f0-9]{64}$/);
      expect(result.account.status).toBe('active');
      expect(result.account.name).toBe('test-service');
      expect(result.account.tenantId).toBe(VALID_TENANT_ID);
    });

    it('plaintext secret verifies against the stored hash', async () => {
      const result = await manager.createAccount(defaultInput());
      const matches = verifyClientSecret(result.clientSecretPlaintext, result.account.clientSecret);
      expect(matches).toBe(true);
    });

    it('respects maxAccountsPerTenant', async () => {
      const { manager: limitedManager } = createManager({ maxAccountsPerTenant: 2 });

      await limitedManager.createAccount(defaultInput({ name: 'svc-1' }));
      await limitedManager.createAccount(defaultInput({ name: 'svc-2' }));

      await expect(
        limitedManager.createAccount(defaultInput({ name: 'svc-3' }))
      ).rejects.toThrow(/Maximum service accounts/);
    });

    it('throws validation error for empty name', async () => {
      await expect(manager.createAccount(defaultInput({ name: '' }))).rejects.toThrow();
    });

    it('throws validation error for name at 256 chars (exceeds max 255)', async () => {
      const longName = 'a'.repeat(256);
      await expect(manager.createAccount(defaultInput({ name: longName }))).rejects.toThrow();
    });

    it('accepts name at exactly 255 chars', async () => {
      const maxName = 'a'.repeat(255);
      const result = await manager.createAccount(defaultInput({ name: maxName }));
      expect(result.account.name).toBe(maxName);
    });

    it('throws validation error for empty permissions array', async () => {
      await expect(manager.createAccount(defaultInput({ permissions: [] }))).rejects.toThrow();
    });

    it('throws validation error for description exceeding 1000 chars', async () => {
      const longDesc = 'x'.repeat(1001);
      await expect(
        manager.createAccount(defaultInput({ description: longDesc }))
      ).rejects.toThrow();
    });

    it('accepts description at exactly 1000 chars', async () => {
      const maxDesc = 'x'.repeat(1000);
      const result = await manager.createAccount(defaultInput({ description: maxDesc }));
      expect(result.account.description).toBe(maxDesc);
    });

    it('throws validation error for invalid IP in ipWhitelist', async () => {
      await expect(
        manager.createAccount(defaultInput({ ipWhitelist: ['not-an-ip'] }))
      ).rejects.toThrow();
    });

    it('throws validation error for invalid tenantId (not UUID)', async () => {
      await expect(
        manager.createAccount(defaultInput({ tenantId: 'not-a-uuid' }))
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getAccount
  // ---------------------------------------------------------------------------

  describe('getAccount', () => {
    it('throws ServiceAccountNotFoundError for non-existent clientId', async () => {
      await expect(manager.getAccount('svc_nonexistent')).rejects.toThrow(
        ServiceAccountNotFoundError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verifyCredentials
  // ---------------------------------------------------------------------------

  describe('verifyCredentials', () => {
    it('returns account on valid credentials', async () => {
      const result = await manager.createAccount(defaultInput());
      const account = await manager.verifyCredentials(
        result.account.clientId,
        result.clientSecretPlaintext
      );
      expect(account.clientId).toBe(result.account.clientId);
    });

    it('throws on wrong secret', async () => {
      const result = await manager.createAccount(defaultInput());
      await expect(
        manager.verifyCredentials(result.account.clientId, 'wrong-secret')
      ).rejects.toThrow(/Invalid credentials/);
    });

    it('throws ServiceAccountRevokedError for revoked account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.revokeAccount(result.account.clientId);

      await expect(
        manager.verifyCredentials(result.account.clientId, result.clientSecretPlaintext)
      ).rejects.toThrow(ServiceAccountRevokedError);
    });

    it('throws ServiceAccountSuspendedError for suspended account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.suspendAccount(result.account.clientId);

      await expect(
        manager.verifyCredentials(result.account.clientId, result.clientSecretPlaintext)
      ).rejects.toThrow(ServiceAccountSuspendedError);
    });

    it('throws generic Invalid credentials for non-existent clientId (prevents enumeration)', async () => {
      await expect(
        manager.verifyCredentials('svc_doesnotexist', 'any-secret')
      ).rejects.toThrow(/Invalid credentials/);

      // Ensure it does NOT throw ServiceAccountNotFoundError
      try {
        await manager.verifyCredentials('svc_doesnotexist', 'any-secret');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceAccountError);
        expect(err).not.toBeInstanceOf(ServiceAccountNotFoundError);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // revokeAccount
  // ---------------------------------------------------------------------------

  describe('revokeAccount', () => {
    it('changes status to revoked', async () => {
      const result = await manager.createAccount(defaultInput());
      const revoked = await manager.revokeAccount(result.account.clientId);
      expect(revoked.status).toBe('revoked');
    });

    it('throws when already revoked', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.revokeAccount(result.account.clientId);

      await expect(manager.revokeAccount(result.account.clientId)).rejects.toThrow(
        /already revoked/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // suspendAccount
  // ---------------------------------------------------------------------------

  describe('suspendAccount', () => {
    it('changes status to suspended', async () => {
      const result = await manager.createAccount(defaultInput());
      const suspended = await manager.suspendAccount(result.account.clientId);
      expect(suspended.status).toBe('suspended');
    });

    it('cannot suspend a revoked account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.revokeAccount(result.account.clientId);

      await expect(manager.suspendAccount(result.account.clientId)).rejects.toThrow(
        /Cannot suspend a revoked account/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // reactivateAccount
  // ---------------------------------------------------------------------------

  describe('reactivateAccount', () => {
    it('changes status from suspended to active', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.suspendAccount(result.account.clientId);

      const reactivated = await manager.reactivateAccount(result.account.clientId);
      expect(reactivated.status).toBe('active');
    });

    it('cannot reactivate a revoked account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.revokeAccount(result.account.clientId);

      await expect(manager.reactivateAccount(result.account.clientId)).rejects.toThrow(
        /Cannot reactivate a revoked account/
      );
    });

    it('throws when account is already active', async () => {
      const result = await manager.createAccount(defaultInput());

      await expect(manager.reactivateAccount(result.account.clientId)).rejects.toThrow(
        /Account is already active/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // rotateSecret
  // ---------------------------------------------------------------------------

  describe('rotateSecret', () => {
    it('produces a new secret that differs from the original', async () => {
      const creation = await manager.createAccount(defaultInput());
      const rotation = await manager.rotateSecret(creation.account.clientId);

      expect(rotation.newClientSecretPlaintext).toBeDefined();
      expect(rotation.previousSecretHash).toBe(creation.account.clientSecret);
      expect(rotation.account.clientSecret).not.toBe(creation.account.clientSecret);

      // New secret should verify
      const matches = verifyClientSecret(rotation.newClientSecretPlaintext, rotation.account.clientSecret);
      expect(matches).toBe(true);
    });

    it('throws for suspended account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.suspendAccount(result.account.clientId);

      await expect(manager.rotateSecret(result.account.clientId)).rejects.toThrow(
        /Cannot rotate secret for inactive account/
      );
    });

    it('throws for revoked account', async () => {
      const result = await manager.createAccount(defaultInput());
      await manager.revokeAccount(result.account.clientId);

      await expect(manager.rotateSecret(result.account.clientId)).rejects.toThrow(
        /Cannot rotate secret for inactive account/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // hasPermission
  // ---------------------------------------------------------------------------

  describe('hasPermission', () => {
    it('returns true for exact match', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['read:data', 'write:data'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'read:data');
      expect(has).toBe(true);
    });

    it('returns true for wildcard * permission', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['*'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'anything:here');
      expect(has).toBe(true);
    });

    it('returns true for prefix match (read:* matches read:users)', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['read:*'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'read:users');
      expect(has).toBe(true);
    });

    it('returns false when permission is not granted', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['read:data'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'write:data');
      expect(has).toBe(false);
    });

    it('read:* does NOT match write:users', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['read:*'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'write:users');
      expect(has).toBe(false);
    });

    it('read:* matches read: (prefix match)', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['read:*'] })
      );
      // 'read:*' -> prefix is 'read:' -> 'read:'.startsWith('read:') is true
      const has = await manager.hasPermission(result.account.clientId, 'read:');
      expect(has).toBe(true);
    });

    it('admin (no :*) does not trigger prefix matching for admin:users', async () => {
      const result = await manager.createAccount(
        defaultInput({ permissions: ['admin'] })
      );
      const has = await manager.hasPermission(result.account.clientId, 'admin:users');
      expect(has).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isIpAllowed
  // ---------------------------------------------------------------------------

  describe('isIpAllowed', () => {
    it('allows any IP when no whitelist is set', async () => {
      const result = await manager.createAccount(defaultInput());
      const allowed = await manager.isIpAllowed(result.account.clientId, '10.0.0.1');
      expect(allowed).toBe(true);
    });

    it('allows IP in whitelist', async () => {
      const result = await manager.createAccount(
        defaultInput({ ipWhitelist: ['10.0.0.1', '10.0.0.2'] })
      );
      const allowed = await manager.isIpAllowed(result.account.clientId, '10.0.0.1');
      expect(allowed).toBe(true);
    });

    it('rejects IP not in whitelist', async () => {
      const result = await manager.createAccount(
        defaultInput({ ipWhitelist: ['10.0.0.1'] })
      );
      const allowed = await manager.isIpAllowed(result.account.clientId, '192.168.1.1');
      expect(allowed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isSecretRotationRecommended
  // ---------------------------------------------------------------------------

  describe('isSecretRotationRecommended', () => {
    it('recommends rotation when secret was rotated longer ago than minSecretRotationDays', async () => {
      const { manager: mgr } = createManager({ minSecretRotationDays: 1 });
      const result = await mgr.createAccount(defaultInput());

      // Manually backdate secretRotatedAt
      const account = await store.findByClientId(result.account.clientId);
      // Use the store from the manager — need a fresh store reference
      const freshStore = new InMemoryServiceAccountStore();
      const freshMgr = new ServiceAccountManager({ store: freshStore, minSecretRotationDays: 1 });
      const freshResult = await freshMgr.createAccount(defaultInput());

      // Backdate secretRotatedAt to 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await freshStore.update(freshResult.account.clientId, { secretRotatedAt: twoDaysAgo });

      const recommended = await freshMgr.isSecretRotationRecommended(freshResult.account.clientId);
      expect(recommended).toBe(true);
    });

    it('does not recommend rotation for recently rotated secret', async () => {
      const result = await manager.createAccount(defaultInput());
      // Default minSecretRotationDays is 90; account was just created so secretRotatedAt = now
      const recommended = await manager.isSecretRotationRecommended(result.account.clientId);
      expect(recommended).toBe(false);
    });

    it('recommends rotation when secretRotatedAt is null', async () => {
      const result = await manager.createAccount(defaultInput());
      // Remove secretRotatedAt by setting it to undefined
      await store.update(result.account.clientId, { secretRotatedAt: undefined });

      const recommended = await manager.isSecretRotationRecommended(result.account.clientId);
      expect(recommended).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAccount
  // ---------------------------------------------------------------------------

  describe('deleteAccount', () => {
    it('deletes an existing account and returns true', async () => {
      const result = await manager.createAccount(defaultInput());
      const deleted = await manager.deleteAccount(result.account.clientId);
      expect(deleted).toBe(true);

      // Confirm it no longer exists
      await expect(manager.getAccount(result.account.clientId)).rejects.toThrow(
        ServiceAccountNotFoundError
      );
    });

    it('throws ServiceAccountNotFoundError for non-existent account', async () => {
      await expect(manager.deleteAccount('svc_nonexistent')).rejects.toThrow(
        ServiceAccountNotFoundError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listAccounts and findAccount
  // ---------------------------------------------------------------------------

  describe('listAccounts', () => {
    it('returns all accounts for a given tenant', async () => {
      await manager.createAccount(defaultInput({ name: 'svc-a' }));
      await manager.createAccount(defaultInput({ name: 'svc-b' }));
      await manager.createAccount(defaultInput({ name: 'svc-other', tenantId: VALID_TENANT_ID_2 }));

      const accounts = await manager.listAccounts(VALID_TENANT_ID);
      expect(accounts).toHaveLength(2);
    });
  });

  describe('findAccount', () => {
    it('returns null for non-existent clientId (does not throw)', async () => {
      const result = await manager.findAccount('svc_nonexistent');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // updateAccount
  // ---------------------------------------------------------------------------

  describe('updateAccount', () => {
    it('updates the name of an account', async () => {
      const result = await manager.createAccount(defaultInput());
      const updated = await manager.updateAccount(result.account.clientId, { name: 'new-name' });
      expect(updated.name).toBe('new-name');
    });

    it('throws validation error for invalid name in update (empty string)', async () => {
      const result = await manager.createAccount(defaultInput());
      await expect(
        manager.updateAccount(result.account.clientId, { name: '' })
      ).rejects.toThrow();
    });

    it('throws ServiceAccountNotFoundError when updating non-existent account', async () => {
      await expect(
        manager.updateAccount('svc_nonexistent', { name: 'x' })
      ).rejects.toThrow(ServiceAccountNotFoundError);
    });
  });
});

// =============================================================================
// ERROR CLASS PROPERTIES
// =============================================================================

describe('Error class properties', () => {
  it('ServiceAccountError has code SERVICE_ACCOUNT_ERROR and statusCode 400', () => {
    const err = new ServiceAccountError('test');
    expect(err.code).toBe('SERVICE_ACCOUNT_ERROR');
    expect(err.statusCode).toBe(400);
  });

  it('ServiceAccountError includes details when provided', () => {
    const details = { foo: 'bar' };
    const err = new ServiceAccountError('test', details);
    expect(err.details).toEqual(details);
  });

  it('ServiceAccountNotFoundError has code SERVICE_ACCOUNT_NOT_FOUND and includes clientId in details', () => {
    const err = new ServiceAccountNotFoundError('svc_abc123');
    expect(err.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
    expect(err.details).toEqual({ clientId: 'svc_abc123' });
  });

  it('ServiceAccountRevokedError has code SERVICE_ACCOUNT_REVOKED, statusCode 401, and includes clientId in details', () => {
    const err = new ServiceAccountRevokedError('svc_abc123');
    expect(err.code).toBe('SERVICE_ACCOUNT_REVOKED');
    expect(err.statusCode).toBe(401);
    expect(err.details).toEqual({ clientId: 'svc_abc123' });
  });

  it('ServiceAccountSuspendedError has code SERVICE_ACCOUNT_SUSPENDED, statusCode 403, and includes clientId in details', () => {
    const err = new ServiceAccountSuspendedError('svc_abc123');
    expect(err.code).toBe('SERVICE_ACCOUNT_SUSPENDED');
    expect(err.statusCode).toBe(403);
    expect(err.details).toEqual({ clientId: 'svc_abc123' });
  });
});

// =============================================================================
// ZOD SCHEMA DIRECT TESTS
// =============================================================================

describe('Zod schema validation', () => {
  describe('createServiceAccountInputSchema', () => {
    it('rejects empty name', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: '',
        permissions: ['read:data'],
        tenantId: VALID_TENANT_ID,
      });
      expect(result.success).toBe(false);
    });

    it('rejects name exceeding 255 chars', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: 'a'.repeat(256),
        permissions: ['read:data'],
        tenantId: VALID_TENANT_ID,
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty permissions array', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: 'svc',
        permissions: [],
        tenantId: VALID_TENANT_ID,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid tenantId (not UUID)', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: 'svc',
        permissions: ['read:data'],
        tenantId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid IP in ipWhitelist', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: 'svc',
        permissions: ['read:data'],
        tenantId: VALID_TENANT_ID,
        ipWhitelist: ['not-an-ip'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects description exceeding 1000 chars', () => {
      const result = createServiceAccountInputSchema.safeParse({
        name: 'svc',
        permissions: ['read:data'],
        tenantId: VALID_TENANT_ID,
        description: 'x'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateServiceAccountInputSchema', () => {
    it('rejects empty name when provided', () => {
      const result = updateServiceAccountInputSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name exceeding 255 chars', () => {
      const result = updateServiceAccountInputSchema.safeParse({ name: 'a'.repeat(256) });
      expect(result.success).toBe(false);
    });

    it('accepts valid partial update', () => {
      const result = updateServiceAccountInputSchema.safeParse({ name: 'valid-name' });
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

describe('Singleton management', () => {
  beforeEach(() => {
    resetServiceAccountSingletons();
  });

  it('getServiceAccountStore() returns InMemoryServiceAccountStore by default', () => {
    const store = getServiceAccountStore();
    expect(store).toBeInstanceOf(InMemoryServiceAccountStore);
  });

  it('setServiceAccountStore() replaces the default store and resets manager', () => {
    // Get default manager to ensure it is cached
    const originalManager = getServiceAccountManager();

    // Replace with a new store
    const customStore = new InMemoryServiceAccountStore();
    setServiceAccountStore(customStore);

    // Store should be the new one
    const store = getServiceAccountStore();
    expect(store).toBe(customStore);

    // Manager should have been reset (new instance)
    const newManager = getServiceAccountManager();
    expect(newManager).not.toBe(originalManager);
  });

  it('getServiceAccountManager() returns a ServiceAccountManager', () => {
    const mgr = getServiceAccountManager();
    expect(mgr).toBeInstanceOf(ServiceAccountManager);
  });

  it('getServiceAccountManager() called twice returns same instance', () => {
    const mgr1 = getServiceAccountManager();
    const mgr2 = getServiceAccountManager();
    expect(mgr1).toBe(mgr2);
  });

  it('createServiceAccountManager() creates a new instance', () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = createServiceAccountManager({ store });
    expect(mgr).toBeInstanceOf(ServiceAccountManager);

    // Should be a different instance from the singleton
    const singleton = getServiceAccountManager();
    expect(mgr).not.toBe(singleton);
  });

  it('resetServiceAccountSingletons() clears both store and manager', () => {
    // Warm up the singletons
    const store1 = getServiceAccountStore();
    const mgr1 = getServiceAccountManager();

    resetServiceAccountSingletons();

    // After reset, new calls should create fresh instances
    const store2 = getServiceAccountStore();
    const mgr2 = getServiceAccountManager();

    expect(store2).not.toBe(store1);
    expect(mgr2).not.toBe(mgr1);
  });
});

// =============================================================================
// MUTATION-KILLING TESTS
// =============================================================================

describe('[Mutation-kill] Exact constant values', () => {
  it('SERVICE_CLIENT_ID_PREFIX is exactly "svc_"', () => {
    expect(SERVICE_CLIENT_ID_PREFIX).toBe('svc_');
  });

  it('ServiceAccountStatus.ACTIVE is exactly "active"', () => {
    expect(ServiceAccountStatus.ACTIVE).toBe('active');
  });

  it('ServiceAccountStatus.REVOKED is exactly "revoked"', () => {
    expect(ServiceAccountStatus.REVOKED).toBe('revoked');
  });

  it('ServiceAccountStatus.SUSPENDED is exactly "suspended"', () => {
    expect(ServiceAccountStatus.SUSPENDED).toBe('suspended');
  });

  it('ServiceAccountStatus has exactly 3 values', () => {
    const values = Object.values(ServiceAccountStatus);
    expect(values).toHaveLength(3);
    expect(values).toContain('active');
    expect(values).toContain('revoked');
    expect(values).toContain('suspended');
  });
});

describe('[Mutation-kill] generateClientId exact format', () => {
  it('total length is exactly 36 characters (4 prefix + 32 hex)', () => {
    const id = generateClientId();
    expect(id.length).toBe(36);
  });

  it('prefix portion is exactly 4 characters', () => {
    expect(SERVICE_CLIENT_ID_PREFIX.length).toBe(4);
  });

  it('hex portion is exactly 32 characters (from 16 random bytes)', () => {
    const id = generateClientId();
    const hexPart = id.slice(4);
    expect(hexPart.length).toBe(32);
  });

  it('produces unique IDs on successive calls', () => {
    const id1 = generateClientId();
    const id2 = generateClientId();
    expect(id1).not.toBe(id2);
  });
});

describe('[Mutation-kill] generateClientSecret exact format', () => {
  it('produces exactly 64 hex characters (from 32 random bytes)', () => {
    const secret = generateClientSecret();
    expect(secret.length).toBe(64);
  });

  it('produces unique secrets on successive calls', () => {
    const s1 = generateClientSecret();
    const s2 = generateClientSecret();
    expect(s1).not.toBe(s2);
  });
});

describe('[Mutation-kill] hashClientSecret determinism', () => {
  it('produces identical hash for same input', () => {
    const hash1 = hashClientSecret('deterministic-test');
    const hash2 = hashClientSecret('deterministic-test');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashClientSecret('input-a');
    const hash2 = hashClientSecret('input-b');
    expect(hash1).not.toBe(hash2);
  });

  it('hash length is exactly 64 hex characters', () => {
    const hash = hashClientSecret('any-input');
    expect(hash.length).toBe(64);
  });
});

describe('[Mutation-kill] verifyClientSecret edge cases', () => {
  it('returns exactly true (not truthy) for correct secret', () => {
    const secret = 'known-secret-value';
    const hash = hashClientSecret(secret);
    const result = verifyClientSecret(secret, hash);
    expect(result).toBe(true);
    expect(result).not.toBe(1);
  });

  it('returns exactly false (not falsy) for wrong secret', () => {
    const hash = hashClientSecret('real-secret');
    const result = verifyClientSecret('wrong-secret', hash);
    expect(result).toBe(false);
    expect(result).not.toBe(0);
  });

  it('returns exactly false for empty string secret vs real hash', () => {
    const hash = hashClientSecret('real-secret');
    const result = verifyClientSecret('', hash);
    expect(result).toBe(false);
  });
});

describe('[Mutation-kill] ServiceAccountManager default config values', () => {
  it('default minSecretRotationDays is exactly 90', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store });
    const result = await mgr.createAccount(defaultInput());

    // Backdate secretRotatedAt to exactly 89 days ago (should NOT recommend)
    const eightyNineDaysAgo = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: eightyNineDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(false);

    // Backdate to exactly 90 days ago (should recommend)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: ninetyDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(true);
  });

  it('default maxAccountsPerTenant is exactly 100', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store });

    // Create 100 accounts (should work)
    for (let i = 0; i < 100; i++) {
      await mgr.createAccount(defaultInput({ name: `svc-${i}` }));
    }

    // 101st should fail
    await expect(
      mgr.createAccount(defaultInput({ name: 'svc-overflow' }))
    ).rejects.toThrow(/Maximum service accounts/);
  });
});

describe('[Mutation-kill] maxAccountsPerTenant boundary (>= vs >)', () => {
  it('allows creation when count is exactly one below limit', async () => {
    const { manager } = createManager({ maxAccountsPerTenant: 3 });
    await manager.createAccount(defaultInput({ name: 'svc-1' }));
    await manager.createAccount(defaultInput({ name: 'svc-2' }));
    // count is 2, limit is 3, so 2 < 3 → allowed
    const result = await manager.createAccount(defaultInput({ name: 'svc-3' }));
    expect(result.account.name).toBe('svc-3');
  });

  it('rejects creation when count is exactly at limit', async () => {
    const { manager } = createManager({ maxAccountsPerTenant: 3 });
    await manager.createAccount(defaultInput({ name: 'svc-1' }));
    await manager.createAccount(defaultInput({ name: 'svc-2' }));
    await manager.createAccount(defaultInput({ name: 'svc-3' }));
    // count is 3, limit is 3, so 3 >= 3 → rejected
    await expect(
      manager.createAccount(defaultInput({ name: 'svc-4' }))
    ).rejects.toThrow(/Maximum service accounts/);
  });
});

describe('[Mutation-kill] isSecretRotationRecommended boundary (>= vs >)', () => {
  it('returns false at minSecretRotationDays - 1', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store, minSecretRotationDays: 10 });
    const result = await mgr.createAccount(defaultInput());

    // 9 days ago (below threshold)
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: nineDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(false);
  });

  it('returns true at exactly minSecretRotationDays', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store, minSecretRotationDays: 10 });
    const result = await mgr.createAccount(defaultInput());

    // Exactly 10 days ago (at threshold)
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: tenDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(true);
  });

  it('returns true at minSecretRotationDays + 1', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store, minSecretRotationDays: 10 });
    const result = await mgr.createAccount(defaultInput());

    // 11 days ago (above threshold)
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: elevenDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(true);
  });
});

describe('[Mutation-kill] isIpAllowed with empty array vs undefined', () => {
  it('allows any IP when ipWhitelist is empty array', async () => {
    const result = await manager.createAccount(defaultInput({ ipWhitelist: [] }));
    // Force store to have empty array (schema might strip it)
    await store.update(result.account.clientId, { ipWhitelist: [] });
    const allowed = await manager.isIpAllowed(result.account.clientId, '10.0.0.1');
    expect(allowed).toBe(true);
  });

  it('allows any IP when ipWhitelist is undefined', async () => {
    const result = await manager.createAccount(defaultInput());
    const allowed = await manager.isIpAllowed(result.account.clientId, '10.0.0.1');
    expect(allowed).toBe(true);
  });
});

describe('[Mutation-kill] createAccount sets fields correctly', () => {
  it('sets status to ACTIVE (not revoked or suspended)', async () => {
    const result = await manager.createAccount(defaultInput());
    expect(result.account.status).toBe(ServiceAccountStatus.ACTIVE);
    expect(result.account.status).toBe('active');
    expect(result.account.status).not.toBe('revoked');
    expect(result.account.status).not.toBe('suspended');
  });

  it('sets createdAt to a Date close to now', async () => {
    const before = new Date();
    const result = await manager.createAccount(defaultInput());
    const after = new Date();
    expect(result.account.createdAt).toBeInstanceOf(Date);
    expect(result.account.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.account.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('sets secretRotatedAt to same time as createdAt', async () => {
    const result = await manager.createAccount(defaultInput());
    expect(result.account.secretRotatedAt).toBeDefined();
    expect(result.account.secretRotatedAt!.getTime()).toBe(result.account.createdAt.getTime());
  });

  it('stores ipWhitelist when provided', async () => {
    const result = await manager.createAccount(
      defaultInput({ ipWhitelist: ['10.0.0.1', '10.0.0.2'] })
    );
    expect(result.account.ipWhitelist).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('stores description when provided', async () => {
    const result = await manager.createAccount(
      defaultInput({ description: 'Test service description' })
    );
    expect(result.account.description).toBe('Test service description');
  });

  it('stores metadata when provided', async () => {
    const result = await manager.createAccount(
      defaultInput({ metadata: { env: 'staging', version: 2 } })
    );
    expect(result.account.metadata).toEqual({ env: 'staging', version: 2 });
  });

  it('stores permissions in correct order', async () => {
    const result = await manager.createAccount(
      defaultInput({ permissions: ['write:data', 'read:data', 'admin:users'] })
    );
    expect(result.account.permissions).toEqual(['write:data', 'read:data', 'admin:users']);
  });
});

describe('[Mutation-kill] rotateSecret updates secretRotatedAt', () => {
  it('rotation result has a secretRotatedAt after original createdAt', async () => {
    const creation = await manager.createAccount(defaultInput());
    const originalTime = creation.account.secretRotatedAt!.getTime();

    // Small delay to ensure time advances
    await new Promise((r) => setTimeout(r, 5));

    const rotation = await manager.rotateSecret(creation.account.clientId);
    expect(rotation.account.secretRotatedAt).toBeDefined();
    expect(rotation.account.secretRotatedAt!.getTime()).toBeGreaterThanOrEqual(originalTime);
  });
});

describe('[Mutation-kill] Error class .name properties', () => {
  it('ServiceAccountError.name is "ServiceAccountError"', () => {
    const err = new ServiceAccountError('test');
    expect(err.name).toBe('ServiceAccountError');
  });

  it('ServiceAccountNotFoundError.name is "ServiceAccountNotFoundError"', () => {
    const err = new ServiceAccountNotFoundError('svc_x');
    expect(err.name).toBe('ServiceAccountNotFoundError');
  });

  it('ServiceAccountRevokedError.name is "ServiceAccountRevokedError"', () => {
    const err = new ServiceAccountRevokedError('svc_x');
    expect(err.name).toBe('ServiceAccountRevokedError');
  });

  it('ServiceAccountSuspendedError.name is "ServiceAccountSuspendedError"', () => {
    const err = new ServiceAccountSuspendedError('svc_x');
    expect(err.name).toBe('ServiceAccountSuspendedError');
  });
});

describe('[Mutation-kill] Error class message content', () => {
  it('ServiceAccountNotFoundError message includes the clientId', () => {
    const err = new ServiceAccountNotFoundError('svc_test123');
    expect(err.message).toContain('svc_test123');
    expect(err.message).toBe('Service account not found: svc_test123');
  });

  it('ServiceAccountRevokedError message includes the clientId', () => {
    const err = new ServiceAccountRevokedError('svc_test456');
    expect(err.message).toContain('svc_test456');
    expect(err.message).toBe('Service account has been revoked: svc_test456');
  });

  it('ServiceAccountSuspendedError message includes the clientId', () => {
    const err = new ServiceAccountSuspendedError('svc_test789');
    expect(err.message).toContain('svc_test789');
    expect(err.message).toBe('Service account is suspended: svc_test789');
  });
});

describe('[Mutation-kill] Error class statusCodes are exact', () => {
  it('ServiceAccountNotFoundError inherits NotFoundError statusCode 404', () => {
    const err = new ServiceAccountNotFoundError('svc_x');
    expect(err.statusCode).toBe(404);
  });
});

describe('[Mutation-kill] hasPermission wildcard prefix slice logic', () => {
  it('read:* removes exactly the last character (*) to get "read:"', async () => {
    // "read:*" → prefix "read:" → "read:anything".startsWith("read:") is true
    const result = await manager.createAccount(
      defaultInput({ permissions: ['read:*'] })
    );
    // "read:" itself should match
    expect(await manager.hasPermission(result.account.clientId, 'read:')).toBe(true);
    // "rea" should NOT match (prefix is "read:", not "read")
    expect(await manager.hasPermission(result.account.clientId, 'rea')).toBe(false);
    // "read" (without colon) should NOT match
    expect(await manager.hasPermission(result.account.clientId, 'read')).toBe(false);
  });

  it('a:* matches a:b but not ab', async () => {
    const result = await manager.createAccount(
      defaultInput({ permissions: ['a:*'] })
    );
    expect(await manager.hasPermission(result.account.clientId, 'a:b')).toBe(true);
    expect(await manager.hasPermission(result.account.clientId, 'ab')).toBe(false);
  });
});

describe('[Mutation-kill] InMemoryServiceAccountStore returns copies not references', () => {
  it('create returns a copy, not the original', async () => {
    const original: ServiceAccount = {
      clientId: generateClientId(),
      clientSecret: hashClientSecret(generateClientSecret()),
      name: 'copy-test',
      permissions: ['read:data'],
      status: 'active',
      tenantId: VALID_TENANT_ID,
      createdAt: new Date(),
    };

    const returned = await store.create(original);
    returned.name = 'mutated';

    const fetched = await store.findByClientId(original.clientId);
    expect(fetched!.name).toBe('copy-test');
  });

  it('findByClientId returns a copy', async () => {
    const original: ServiceAccount = {
      clientId: generateClientId(),
      clientSecret: hashClientSecret(generateClientSecret()),
      name: 'copy-test-2',
      permissions: ['read:data'],
      status: 'active',
      tenantId: VALID_TENANT_ID,
      createdAt: new Date(),
    };
    await store.create(original);

    const fetched1 = await store.findByClientId(original.clientId);
    fetched1!.name = 'mutated';

    const fetched2 = await store.findByClientId(original.clientId);
    expect(fetched2!.name).toBe('copy-test-2');
  });

  it('findByClientId returns null (not undefined) for missing accounts', async () => {
    const result = await store.findByClientId('nonexistent');
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });
});

describe('[Mutation-kill] updateLastUsed for non-existent account is silent', () => {
  it('does not throw when account does not exist', async () => {
    // updateLastUsed should silently do nothing
    await expect(store.updateLastUsed('nonexistent')).resolves.toBeUndefined();
  });
});

describe('[Mutation-kill] ServiceAccountManager.verifyCredentials updates lastUsedAt', () => {
  it('updates lastUsedAt asynchronously after successful verification', async () => {
    const result = await manager.createAccount(defaultInput());
    const before = await store.findByClientId(result.account.clientId);
    expect(before!.lastUsedAt).toBeUndefined();

    await manager.verifyCredentials(result.account.clientId, result.clientSecretPlaintext);

    // Wait a tick for the async updateLastUsed to complete
    await new Promise((r) => setTimeout(r, 10));

    const after = await store.findByClientId(result.account.clientId);
    expect(after!.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('[Mutation-kill] ServiceAccountManager config overrides', () => {
  it('custom minSecretRotationDays is respected', async () => {
    const store = new InMemoryServiceAccountStore();
    const mgr = new ServiceAccountManager({ store, minSecretRotationDays: 5 });
    const result = await mgr.createAccount(defaultInput());

    // 4 days ago → not recommended
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: fourDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(false);

    // 5 days ago → recommended
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await store.update(result.account.clientId, { secretRotatedAt: fiveDaysAgo });
    expect(await mgr.isSecretRotationRecommended(result.account.clientId)).toBe(true);
  });

  it('custom maxAccountsPerTenant of 1 allows exactly 1', async () => {
    const { manager: mgr } = createManager({ maxAccountsPerTenant: 1 });
    await mgr.createAccount(defaultInput({ name: 'only-one' }));
    await expect(
      mgr.createAccount(defaultInput({ name: 'too-many' }))
    ).rejects.toThrow(/Maximum service accounts/);
  });
});
