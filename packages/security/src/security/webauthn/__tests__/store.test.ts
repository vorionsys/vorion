/**
 * Tests for InMemoryWebAuthnStore, RedisWebAuthnStore, and store singletons
 *
 * Validates:
 * - Credential CRUD operations (create, read, update, delete)
 * - Lookup by id, credentialId, and userId
 * - Duplicate credentialId rejection
 * - Multi-user isolation
 * - Credential count per user
 * - Immutable field preservation on update
 * - Sorted results (newest first) for getCredentialsByUserId
 * - Challenge set/get (one-time use), expiration, and delete
 * - Store reset clears all data
 * - getStats returns correct counts
 * - stop cleans up interval
 * - RedisWebAuthnStore: delegation, Redis paths, fallback
 * - Singleton: getWebAuthnStore, resetWebAuthnStore, enableRedisWebAuthnStore
 * - Challenge expiry boundary conditions
 * - Cleanup interval logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  InMemoryWebAuthnStore,
  RedisWebAuthnStore,
  createWebAuthnStore,
  createRedisWebAuthnStore,
  getWebAuthnStore,
  resetWebAuthnStore,
  enableRedisWebAuthnStore,
} from '../store.js';
import type {
  WebAuthnCredential,
  ChallengeEntry,
} from '../types.js';

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../distributed-state.js', () => ({
  getRedisStateProvider: vi.fn(() => ({})),
}));

// =============================================================================
// HELPERS
// =============================================================================

let credentialCounter = 0;

function createTestCredential(overrides: Partial<WebAuthnCredential> = {}): WebAuthnCredential {
  credentialCounter++;
  return {
    id: `cred-id-${credentialCounter}`,
    credentialId: `cred-webauthn-${credentialCounter}`,
    publicKey: `pubkey-base64url-${credentialCounter}`,
    counter: 0,
    transports: ['internal'],
    createdAt: new Date(),
    lastUsedAt: null,
    name: `Test Passkey ${credentialCounter}`,
    userId: 'user-1',
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: '00000000-0000-0000-0000-000000000000',
    ...overrides,
  };
}

function createTestChallenge(overrides: Partial<ChallengeEntry> = {}): ChallengeEntry {
  return {
    challenge: 'test-challenge-string',
    userId: 'user-1',
    type: 'registration',
    expiresAt: Date.now() + 300000, // 5 minutes from now
    createdAt: new Date(),
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('InMemoryWebAuthnStore', () => {
  let store: InMemoryWebAuthnStore;

  beforeEach(() => {
    credentialCounter = 0;
    store = new InMemoryWebAuthnStore();
  });

  afterEach(() => {
    store.stop();
  });

  // ===========================================================================
  // CREDENTIAL CRUD
  // ===========================================================================

  describe('createCredential', () => {
    it('should create and return a credential', async () => {
      const credential = createTestCredential();
      const result = await store.createCredential(credential);

      expect(result).toEqual(credential);
      expect(result.id).toBe(credential.id);
      expect(result.credentialId).toBe(credential.credentialId);
    });

    it('should reject duplicate credentialId', async () => {
      const cred1 = createTestCredential({ credentialId: 'dup-cred-id' });
      await store.createCredential(cred1);

      const cred2 = createTestCredential({ id: 'different-id', credentialId: 'dup-cred-id' });
      await expect(store.createCredential(cred2)).rejects.toThrow(
        'Credential with ID dup-cred-id already exists'
      );
    });
  });

  describe('getCredentialById', () => {
    it('should return a credential by its internal id', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);

      const result = await store.getCredentialById(credential.id);
      expect(result).toEqual(credential);
    });

    it('should return null for non-existent id', async () => {
      const result = await store.getCredentialById('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getCredentialByCredentialId', () => {
    it('should return a credential by its WebAuthn credentialId', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);

      const result = await store.getCredentialByCredentialId(credential.credentialId);
      expect(result).toEqual(credential);
    });

    it('should return null for non-existent credentialId', async () => {
      const result = await store.getCredentialByCredentialId('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getCredentialsByUserId', () => {
    it('should return all credentials for a user sorted newest first', async () => {
      const olderDate = new Date('2024-01-01T00:00:00Z');
      const newerDate = new Date('2024-06-01T00:00:00Z');

      const cred1 = createTestCredential({ userId: 'user-A', createdAt: olderDate });
      const cred2 = createTestCredential({ userId: 'user-A', createdAt: newerDate });

      await store.createCredential(cred1);
      await store.createCredential(cred2);

      const result = await store.getCredentialsByUserId('user-A');
      expect(result).toHaveLength(2);
      // Newest first
      expect(result[0].createdAt.getTime()).toBeGreaterThanOrEqual(result[1].createdAt.getTime());
      expect(result[0].id).toBe(cred2.id);
      expect(result[1].id).toBe(cred1.id);
    });

    it('should return empty array for user with no credentials', async () => {
      const result = await store.getCredentialsByUserId('no-such-user');
      expect(result).toEqual([]);
    });

    it('should not return credentials from other users (multi-user isolation)', async () => {
      const credA = createTestCredential({ userId: 'user-A' });
      const credB = createTestCredential({ userId: 'user-B' });

      await store.createCredential(credA);
      await store.createCredential(credB);

      const resultA = await store.getCredentialsByUserId('user-A');
      const resultB = await store.getCredentialsByUserId('user-B');

      expect(resultA).toHaveLength(1);
      expect(resultA[0].userId).toBe('user-A');

      expect(resultB).toHaveLength(1);
      expect(resultB[0].userId).toBe('user-B');
    });
  });

  describe('updateCredential', () => {
    it('should update mutable fields', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);

      const updated = await store.updateCredential(credential.id, {
        counter: 5,
        lastUsedAt: new Date('2025-01-01T00:00:00Z'),
        name: 'Updated Passkey Name',
      });

      expect(updated).not.toBeNull();
      expect(updated!.counter).toBe(5);
      expect(updated!.lastUsedAt).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(updated!.name).toBe('Updated Passkey Name');
    });

    it('should preserve immutable fields (id, credentialId, publicKey, userId, createdAt)', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);

      const updated = await store.updateCredential(credential.id, {
        id: 'hacked-id',
        credentialId: 'hacked-cred-id',
        publicKey: 'hacked-public-key',
        userId: 'hacked-user',
        createdAt: new Date('1999-01-01T00:00:00Z'),
        counter: 10,
      } as Partial<WebAuthnCredential>);

      expect(updated).not.toBeNull();
      // Immutable fields must not change
      expect(updated!.id).toBe(credential.id);
      expect(updated!.credentialId).toBe(credential.credentialId);
      expect(updated!.publicKey).toBe(credential.publicKey);
      expect(updated!.userId).toBe(credential.userId);
      expect(updated!.createdAt).toEqual(credential.createdAt);
      // Mutable field should change
      expect(updated!.counter).toBe(10);
    });

    it('should return null for non-existent credential', async () => {
      const result = await store.updateCredential('non-existent', { counter: 1 });
      expect(result).toBeNull();
    });
  });

  describe('deleteCredential', () => {
    it('should delete an existing credential and return true', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);

      const deleted = await store.deleteCredential(credential.id);
      expect(deleted).toBe(true);

      const found = await store.getCredentialById(credential.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent credential', async () => {
      const result = await store.deleteCredential('non-existent');
      expect(result).toBe(false);
    });

    it('should remove from all indexes after deletion', async () => {
      const credential = createTestCredential();
      await store.createCredential(credential);
      await store.deleteCredential(credential.id);

      expect(await store.getCredentialById(credential.id)).toBeNull();
      expect(await store.getCredentialByCredentialId(credential.credentialId)).toBeNull();
      expect(await store.getCredentialsByUserId(credential.userId)).toEqual([]);
    });
  });

  describe('deleteCredentialsByUserId', () => {
    it('should delete all credentials for a user and return count', async () => {
      const cred1 = createTestCredential({ userId: 'user-X' });
      const cred2 = createTestCredential({ userId: 'user-X' });
      const cred3 = createTestCredential({ userId: 'user-Y' });

      await store.createCredential(cred1);
      await store.createCredential(cred2);
      await store.createCredential(cred3);

      const deletedCount = await store.deleteCredentialsByUserId('user-X');
      expect(deletedCount).toBe(2);

      const remaining = await store.getCredentialsByUserId('user-X');
      expect(remaining).toEqual([]);

      // user-Y's credential should be untouched
      const userY = await store.getCredentialsByUserId('user-Y');
      expect(userY).toHaveLength(1);
    });

    it('should return 0 when user has no credentials', async () => {
      const count = await store.deleteCredentialsByUserId('ghost-user');
      expect(count).toBe(0);
    });
  });

  describe('countCredentialsByUserId', () => {
    it('should return correct count of credentials per user', async () => {
      await store.createCredential(createTestCredential({ userId: 'user-count' }));
      await store.createCredential(createTestCredential({ userId: 'user-count' }));
      await store.createCredential(createTestCredential({ userId: 'user-count' }));

      const count = await store.countCredentialsByUserId('user-count');
      expect(count).toBe(3);
    });

    it('should return 0 for user with no credentials', async () => {
      const count = await store.countCredentialsByUserId('no-user');
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // CHALLENGE OPERATIONS
  // ===========================================================================

  describe('setChallenge and getChallenge', () => {
    it('should store and retrieve a challenge', async () => {
      const challenge = createTestChallenge();
      await store.setChallenge('test-key', challenge);

      const result = await store.getChallenge('test-key');
      expect(result).toEqual(challenge);
    });

    it('should enforce one-time use - second get returns null', async () => {
      const challenge = createTestChallenge();
      await store.setChallenge('one-time-key', challenge);

      const first = await store.getChallenge('one-time-key');
      expect(first).not.toBeNull();

      const second = await store.getChallenge('one-time-key');
      expect(second).toBeNull();
    });

    it('should return null for expired challenge', async () => {
      const expiredChallenge = createTestChallenge({
        expiresAt: Date.now() - 1000, // already expired
      });
      await store.setChallenge('expired-key', expiredChallenge);

      const result = await store.getChallenge('expired-key');
      expect(result).toBeNull();
    });

    it('should return null for non-existent challenge', async () => {
      const result = await store.getChallenge('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('deleteChallenge', () => {
    it('should delete an existing challenge and return true', async () => {
      const challenge = createTestChallenge();
      await store.setChallenge('del-key', challenge);

      const deleted = await store.deleteChallenge('del-key');
      expect(deleted).toBe(true);

      const result = await store.getChallenge('del-key');
      expect(result).toBeNull();
    });

    it('should return false for non-existent challenge', async () => {
      const result = await store.deleteChallenge('non-existent');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  describe('reset', () => {
    it('should clear all credentials and challenges', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      await store.setChallenge('ch-key', createTestChallenge());

      store.reset();

      expect(await store.getCredentialById(cred.id)).toBeNull();
      expect(await store.getChallenge('ch-key')).toBeNull();

      const stats = store.getStats();
      expect(stats.totalCredentials).toBe(0);
      expect(stats.totalUsers).toBe(0);
      expect(stats.pendingChallenges).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await store.createCredential(createTestCredential({ userId: 'u1' }));
      await store.createCredential(createTestCredential({ userId: 'u1' }));
      await store.createCredential(createTestCredential({ userId: 'u2' }));
      await store.setChallenge('ch1', createTestChallenge());
      await store.setChallenge('ch2', createTestChallenge());

      const stats = store.getStats();

      expect(stats.totalCredentials).toBe(3);
      expect(stats.totalUsers).toBe(2);
      expect(stats.pendingChallenges).toBe(2);
      expect(stats.credentialsByUser['u1']).toBe(2);
      expect(stats.credentialsByUser['u2']).toBe(1);
    });
  });

  describe('stop', () => {
    it('should clean up the interval without errors', () => {
      // Just verify it doesn't throw
      expect(() => store.stop()).not.toThrow();
      // Calling stop a second time should also be safe
      expect(() => store.stop()).not.toThrow();
    });
  });

  // ===========================================================================
  // FACTORY FUNCTION
  // ===========================================================================

  describe('createWebAuthnStore', () => {
    it('should return a new InMemoryWebAuthnStore instance', () => {
      const newStore = createWebAuthnStore();
      expect(newStore).toBeInstanceOf(InMemoryWebAuthnStore);
      newStore.stop();
    });
  });

  // ===========================================================================
  // CHALLENGE EXPIRY BOUNDARY
  // ===========================================================================

  describe('getChallenge - expiry boundary', () => {
    it('should return null when expiresAt equals current time (boundary)', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const challenge = createTestChallenge({
        expiresAt: now, // exact boundary: Date.now() > expiresAt is false when equal
      });
      await store.setChallenge('boundary-key', challenge);

      // Date.now() > entry.expiresAt: now > now is false, so challenge is valid
      const result = await store.getChallenge('boundary-key');
      expect(result).not.toBeNull();

      vi.restoreAllMocks();
    });

    it('should return null when Date.now() is 1ms past expiresAt', async () => {
      const expiresAt = Date.now() - 1;
      const challenge = createTestChallenge({ expiresAt });
      await store.setChallenge('expired-boundary', challenge);

      const result = await store.getChallenge('expired-boundary');
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // GETSTATS DETAILED
  // ===========================================================================

  describe('getStats - detailed fields', () => {
    it('should return empty credentialsByUser when no credentials exist', () => {
      const stats = store.getStats();
      expect(stats.totalCredentials).toBe(0);
      expect(stats.totalUsers).toBe(0);
      expect(stats.pendingChallenges).toBe(0);
      expect(stats.credentialsByUser).toEqual({});
    });

    it('should correctly track credentialsByUser per user', async () => {
      await store.createCredential(createTestCredential({ userId: 'alpha' }));
      await store.createCredential(createTestCredential({ userId: 'alpha' }));
      await store.createCredential(createTestCredential({ userId: 'alpha' }));
      await store.createCredential(createTestCredential({ userId: 'beta' }));

      const stats = store.getStats();
      expect(stats.credentialsByUser['alpha']).toBe(3);
      expect(stats.credentialsByUser['beta']).toBe(1);
      expect(stats.totalCredentials).toBe(4);
      expect(stats.totalUsers).toBe(2);
    });
  });

  // ===========================================================================
  // DELETE CREDENTIAL - USER SET CLEANUP
  // ===========================================================================

  describe('deleteCredential - user set cleanup', () => {
    it('should remove userId entry from credentialsByUserId map when last credential deleted', async () => {
      const cred = createTestCredential({ userId: 'single-cred-user' });
      await store.createCredential(cred);

      expect((await store.getCredentialsByUserId('single-cred-user')).length).toBe(1);

      await store.deleteCredential(cred.id);

      // After deleting the only credential, user should have 0 credentials
      const count = await store.countCredentialsByUserId('single-cred-user');
      expect(count).toBe(0);
    });

    it('should keep other credentials when one is deleted for a multi-credential user', async () => {
      const cred1 = createTestCredential({ userId: 'multi-cred-user' });
      const cred2 = createTestCredential({ userId: 'multi-cred-user' });
      await store.createCredential(cred1);
      await store.createCredential(cred2);

      await store.deleteCredential(cred1.id);

      const remaining = await store.getCredentialsByUserId('multi-cred-user');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(cred2.id);
    });
  });

  // ===========================================================================
  // DELETE CREDENTIALS BY USER - LOOP CORRECTNESS
  // ===========================================================================

  describe('deleteCredentialsByUserId - loop correctness', () => {
    it('should remove from all indexes (credentialsById and credentialsByCredentialId)', async () => {
      const cred1 = createTestCredential({ userId: 'del-loop-user' });
      const cred2 = createTestCredential({ userId: 'del-loop-user' });
      await store.createCredential(cred1);
      await store.createCredential(cred2);

      await store.deleteCredentialsByUserId('del-loop-user');

      // Verify removal from all indexes
      expect(await store.getCredentialById(cred1.id)).toBeNull();
      expect(await store.getCredentialById(cred2.id)).toBeNull();
      expect(await store.getCredentialByCredentialId(cred1.credentialId)).toBeNull();
      expect(await store.getCredentialByCredentialId(cred2.credentialId)).toBeNull();
    });
  });

  // ===========================================================================
  // UPDATE CREDENTIAL - INDEX CONSISTENCY
  // ===========================================================================

  describe('updateCredential - index consistency', () => {
    it('should update credential in credentialsByCredentialId index', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);

      await store.updateCredential(cred.id, { name: 'Updated Name' });

      const found = await store.getCredentialByCredentialId(cred.credentialId);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Updated Name');
    });
  });

  // ===========================================================================
  // SORT DIRECTION - getCredentialsByUserId
  // ===========================================================================

  describe('getCredentialsByUserId - sort direction', () => {
    it('should sort newest first (descending by createdAt)', async () => {
      const dates = [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-03-01T00:00:00Z'),
      ];

      for (const date of dates) {
        await store.createCredential(
          createTestCredential({ userId: 'sort-user', createdAt: date })
        );
      }

      const result = await store.getCredentialsByUserId('sort-user');
      expect(result).toHaveLength(3);

      // Verify descending order
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          result[i + 1].createdAt.getTime()
        );
      }

      expect(result[0].createdAt).toEqual(new Date('2024-06-01T00:00:00Z'));
      expect(result[2].createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  // ===========================================================================
  // CLEANUP INTERVAL
  // ===========================================================================

  describe('startCleanup (internal)', () => {
    it('should clean up expired challenges when interval fires', async () => {
      vi.useFakeTimers();

      const cleanupStore = new InMemoryWebAuthnStore();
      const expired = createTestChallenge({ expiresAt: Date.now() - 1000 });
      const valid = createTestChallenge({
        expiresAt: Date.now() + 999999,
        challenge: 'valid-challenge',
      });

      await cleanupStore.setChallenge('exp-key', expired);
      await cleanupStore.setChallenge('val-key', valid);

      // Advance by 60 seconds to trigger cleanup interval
      vi.advanceTimersByTime(60000);

      // The expired challenge should have been cleaned up
      // getChallenge is one-time-use, so we check stats instead
      const stats = cleanupStore.getStats();
      expect(stats.pendingChallenges).toBe(1); // Only the valid one remains

      cleanupStore.stop();
      vi.useRealTimers();
    });

    it('should not remove non-expired challenges during cleanup', async () => {
      vi.useFakeTimers();

      const cleanupStore = new InMemoryWebAuthnStore();
      const valid1 = createTestChallenge({
        expiresAt: Date.now() + 500000,
        challenge: 'valid1',
      });
      const valid2 = createTestChallenge({
        expiresAt: Date.now() + 600000,
        challenge: 'valid2',
      });

      await cleanupStore.setChallenge('v1', valid1);
      await cleanupStore.setChallenge('v2', valid2);

      vi.advanceTimersByTime(60000);

      const stats = cleanupStore.getStats();
      expect(stats.pendingChallenges).toBe(2);

      cleanupStore.stop();
      vi.useRealTimers();
    });
  });
});

// =============================================================================
// REDIS WEBAUTHN STORE
// =============================================================================

describe('RedisWebAuthnStore', () => {
  function createMockStateProvider() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      getHealthStatus: vi.fn().mockResolvedValue({ healthy: true }),
      increment: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      getRawClient: vi.fn(),
      clearFallbackCache: vi.fn(),
      cleanupFallbackCache: vi.fn(),
    };
  }

  let mockStateProvider: ReturnType<typeof createMockStateProvider>;
  let redisStore: RedisWebAuthnStore;

  beforeEach(async () => {
    credentialCounter = 0;
    mockStateProvider = createMockStateProvider();
    redisStore = new RedisWebAuthnStore(mockStateProvider as any);
    // Wait for health check to resolve
    await vi.waitFor(() => {
      expect(mockStateProvider.getHealthStatus).toHaveBeenCalled();
    });
  });

  afterEach(() => {
    redisStore.stop();
  });

  // ===========================================================================
  // CREDENTIAL OPERATIONS (delegated to fallback)
  // ===========================================================================

  describe('credential operations (delegated)', () => {
    it('should delegate createCredential to fallback', async () => {
      const cred = createTestCredential();
      const result = await redisStore.createCredential(cred);
      expect(result).toEqual(cred);
    });

    it('should delegate getCredentialById to fallback', async () => {
      const cred = createTestCredential();
      await redisStore.createCredential(cred);
      const result = await redisStore.getCredentialById(cred.id);
      expect(result).toEqual(cred);
    });

    it('should delegate getCredentialByCredentialId to fallback', async () => {
      const cred = createTestCredential();
      await redisStore.createCredential(cred);
      const result = await redisStore.getCredentialByCredentialId(cred.credentialId);
      expect(result).toEqual(cred);
    });

    it('should delegate getCredentialsByUserId to fallback', async () => {
      const cred = createTestCredential({ userId: 'redis-user' });
      await redisStore.createCredential(cred);
      const result = await redisStore.getCredentialsByUserId('redis-user');
      expect(result).toHaveLength(1);
    });

    it('should delegate updateCredential to fallback', async () => {
      const cred = createTestCredential();
      await redisStore.createCredential(cred);
      const updated = await redisStore.updateCredential(cred.id, { counter: 10 });
      expect(updated!.counter).toBe(10);
    });

    it('should delegate deleteCredential to fallback', async () => {
      const cred = createTestCredential();
      await redisStore.createCredential(cred);
      const deleted = await redisStore.deleteCredential(cred.id);
      expect(deleted).toBe(true);
    });

    it('should delegate deleteCredentialsByUserId to fallback', async () => {
      await redisStore.createCredential(createTestCredential({ userId: 'redis-del-user' }));
      await redisStore.createCredential(createTestCredential({ userId: 'redis-del-user' }));
      const count = await redisStore.deleteCredentialsByUserId('redis-del-user');
      expect(count).toBe(2);
    });

    it('should delegate countCredentialsByUserId to fallback', async () => {
      await redisStore.createCredential(createTestCredential({ userId: 'redis-count-user' }));
      const count = await redisStore.countCredentialsByUserId('redis-count-user');
      expect(count).toBe(1);
    });
  });

  // ===========================================================================
  // CHALLENGE OPERATIONS (Redis-backed)
  // ===========================================================================

  describe('setChallenge (Redis path)', () => {
    it('should store challenge in Redis with correct key prefix and TTL', async () => {
      const challenge = createTestChallenge({
        expiresAt: Date.now() + 300000,
      });

      await redisStore.setChallenge('test-key', challenge);

      expect(mockStateProvider.set).toHaveBeenCalledWith(
        'webauthn:challenge:test-key',
        expect.any(String),
        expect.any(Number)
      );

      // Verify the TTL is positive and reasonable
      const ttlArg = mockStateProvider.set.mock.calls[0][2];
      expect(ttlArg).toBeGreaterThanOrEqual(1);
      expect(ttlArg).toBeLessThanOrEqual(300);
    });

    it('should serialize challenge entry with createdAt as ISO string', async () => {
      const challenge = createTestChallenge();
      await redisStore.setChallenge('ser-key', challenge);

      const serialized = JSON.parse(mockStateProvider.set.mock.calls[0][1]);
      expect(typeof serialized.createdAt).toBe('string');
      expect(new Date(serialized.createdAt).toISOString()).toBe(
        challenge.createdAt.toISOString()
      );
    });

    it('should fall back to in-memory when Redis set fails', async () => {
      mockStateProvider.set.mockRejectedValueOnce(new Error('Redis down'));

      const challenge = createTestChallenge();
      await redisStore.setChallenge('fallback-key', challenge);

      // After failure, useRedis should be false
      expect(redisStore.isUsingRedis()).toBe(false);

      // Subsequent calls should use fallback (no more Redis calls)
      const challenge2 = createTestChallenge({ challenge: 'second' });
      await redisStore.setChallenge('fallback-key-2', challenge2);
      expect(mockStateProvider.set).toHaveBeenCalledTimes(1); // Only the failed call
    });
  });

  describe('getChallenge (Redis path)', () => {
    it('should retrieve and delete challenge from Redis', async () => {
      const challengeData = {
        challenge: 'redis-challenge',
        userId: 'user-1',
        type: 'registration',
        expiresAt: Date.now() + 300000,
        createdAt: new Date().toISOString(),
      };
      mockStateProvider.get.mockResolvedValue(JSON.stringify(challengeData));

      const result = await redisStore.getChallenge('redis-get-key');

      expect(result).not.toBeNull();
      expect(result!.challenge).toBe('redis-challenge');
      expect(result!.createdAt).toBeInstanceOf(Date);

      // Should delete after retrieval (one-time use)
      expect(mockStateProvider.delete).toHaveBeenCalledWith(
        'webauthn:challenge:redis-get-key'
      );
    });

    it('should return null when Redis has no data', async () => {
      mockStateProvider.get.mockResolvedValue(null);

      const result = await redisStore.getChallenge('missing-key');
      expect(result).toBeNull();
      // Should not attempt to delete
      expect(mockStateProvider.delete).not.toHaveBeenCalled();
    });

    it('should return null for expired challenge from Redis', async () => {
      const expiredData = {
        challenge: 'expired-redis-challenge',
        userId: 'user-1',
        type: 'authentication',
        expiresAt: Date.now() - 1000, // expired
        createdAt: new Date().toISOString(),
      };
      mockStateProvider.get.mockResolvedValue(JSON.stringify(expiredData));

      const result = await redisStore.getChallenge('expired-redis-key');
      expect(result).toBeNull();
    });

    it('should fall back to in-memory when Redis get fails', async () => {
      mockStateProvider.get.mockRejectedValueOnce(new Error('Redis timeout'));

      const result = await redisStore.getChallenge('redis-fail-key');
      // Falls back to fallback store, which has nothing
      expect(result).toBeNull();
    });
  });

  describe('deleteChallenge (Redis path)', () => {
    it('should delete challenge from Redis with correct key', async () => {
      mockStateProvider.delete.mockResolvedValue(true);

      const result = await redisStore.deleteChallenge('del-redis-key');
      expect(result).toBe(true);
      expect(mockStateProvider.delete).toHaveBeenCalledWith(
        'webauthn:challenge:del-redis-key'
      );
    });

    it('should fall back to in-memory when Redis delete fails', async () => {
      mockStateProvider.delete.mockRejectedValueOnce(new Error('Redis error'));

      const result = await redisStore.deleteChallenge('del-fail-key');
      // Falls back to in-memory store's deleteChallenge
      expect(result).toBe(false); // Nothing in fallback
    });
  });

  // ===========================================================================
  // FALLBACK MODE (when Redis is unhealthy)
  // ===========================================================================

  describe('fallback mode', () => {
    it('should use fallback when health check returns unhealthy', async () => {
      const unhealthyProvider = createMockStateProvider();
      unhealthyProvider.getHealthStatus.mockResolvedValue({ healthy: false, error: 'down' });
      const fallbackStore = new RedisWebAuthnStore(unhealthyProvider as any);

      await vi.waitFor(() => {
        expect(unhealthyProvider.getHealthStatus).toHaveBeenCalled();
      });

      // Allow health check to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(fallbackStore.isUsingRedis()).toBe(false);

      const challenge = createTestChallenge();
      await fallbackStore.setChallenge('fallback-test', challenge);

      // Should not call Redis
      expect(unhealthyProvider.set).not.toHaveBeenCalled();

      const result = await fallbackStore.getChallenge('fallback-test');
      expect(result).not.toBeNull();
      expect(result!.challenge).toBe('test-challenge-string');

      fallbackStore.stop();
    });

    it('should use fallback when health check throws', async () => {
      const errorProvider = createMockStateProvider();
      errorProvider.getHealthStatus.mockRejectedValue(new Error('connection refused'));
      const errorStore = new RedisWebAuthnStore(errorProvider as any);

      await vi.waitFor(() => {
        expect(errorProvider.getHealthStatus).toHaveBeenCalled();
      });

      // Allow health check to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(errorStore.isUsingRedis()).toBe(false);
      errorStore.stop();
    });
  });

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  describe('reset', () => {
    it('should reset the fallback store', async () => {
      const cred = createTestCredential();
      await redisStore.createCredential(cred);

      redisStore.reset();

      const found = await redisStore.getCredentialById(cred.id);
      expect(found).toBeNull();
    });
  });

  describe('stop', () => {
    it('should stop without error', () => {
      expect(() => redisStore.stop()).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should include usingRedis flag', async () => {
      const stats = redisStore.getStats();
      expect(stats).toHaveProperty('usingRedis');
      expect(typeof stats.usingRedis).toBe('boolean');
    });

    it('should return fallback stats plus usingRedis', async () => {
      await redisStore.createCredential(createTestCredential({ userId: 'stats-user' }));

      const stats = redisStore.getStats();
      expect(stats.totalCredentials).toBe(1);
      expect(stats.totalUsers).toBe(1);
      expect(stats.usingRedis).toBe(true);
    });
  });

  describe('isUsingRedis', () => {
    it('should return true when Redis is healthy', () => {
      expect(redisStore.isUsingRedis()).toBe(true);
    });
  });
});

// =============================================================================
// STORE SINGLETON FUNCTIONS
// =============================================================================

describe('Store singleton functions', () => {
  afterEach(() => {
    resetWebAuthnStore();
  });

  describe('getWebAuthnStore', () => {
    it('should return InMemoryWebAuthnStore by default', () => {
      const store = getWebAuthnStore();
      expect(store).toBeInstanceOf(InMemoryWebAuthnStore);
    });

    it('should return the same instance on subsequent calls', () => {
      const s1 = getWebAuthnStore();
      const s2 = getWebAuthnStore();
      expect(s1).toBe(s2);
    });
  });

  describe('enableRedisWebAuthnStore', () => {
    it('should cause getWebAuthnStore to return RedisWebAuthnStore', () => {
      resetWebAuthnStore();
      enableRedisWebAuthnStore();
      const store = getWebAuthnStore();
      expect(store).toBeInstanceOf(RedisWebAuthnStore);
    });
  });

  describe('resetWebAuthnStore', () => {
    it('should reset so next call creates a new store', () => {
      const s1 = getWebAuthnStore();
      resetWebAuthnStore();
      const s2 = getWebAuthnStore();
      expect(s1).not.toBe(s2);
    });

    it('should reset useRedisStore flag', () => {
      enableRedisWebAuthnStore();
      resetWebAuthnStore();
      const store = getWebAuthnStore();
      expect(store).toBeInstanceOf(InMemoryWebAuthnStore);
    });

    it('should be safe to call when no store exists', () => {
      expect(() => resetWebAuthnStore()).not.toThrow();
    });
  });

  describe('createRedisWebAuthnStore', () => {
    it('should create a new RedisWebAuthnStore instance', () => {
      const mockProvider = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        getHealthStatus: vi.fn().mockResolvedValue({ healthy: true }),
      };
      const store = createRedisWebAuthnStore(mockProvider as any);
      expect(store).toBeInstanceOf(RedisWebAuthnStore);
      store.stop();
    });
  });
});

// =============================================================================
// MUTATION-KILLING: Exact constants and boundary conditions
// =============================================================================

describe('Mutation-killing: InMemoryWebAuthnStore additional', () => {
  let store: InMemoryWebAuthnStore;

  beforeEach(() => {
    credentialCounter = 0;
    store = new InMemoryWebAuthnStore();
  });

  afterEach(() => {
    store.stop();
  });

  describe('getCredentialsByUserId - empty set handling', () => {
    it('should return empty array when userId exists but set is empty', async () => {
      // This tests the credentialIds.size === 0 branch
      const cred = createTestCredential({ userId: 'empty-set-user' });
      await store.createCredential(cred);
      await store.deleteCredential(cred.id);

      const result = await store.getCredentialsByUserId('empty-set-user');
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('countCredentialsByUserId - null coalescing', () => {
    it('should return exactly 0 for unknown user (tests ?? 0)', async () => {
      const count = await store.countCredentialsByUserId('nonexistent');
      expect(count).toBe(0);
      expect(count).not.toBe(null);
      expect(count).not.toBe(undefined);
    });

    it('should return exact count matching number of created credentials', async () => {
      await store.createCredential(createTestCredential({ userId: 'precise-count' }));
      await store.createCredential(createTestCredential({ userId: 'precise-count' }));

      const count = await store.countCredentialsByUserId('precise-count');
      expect(count).toBe(2);
      expect(count).not.toBe(1);
      expect(count).not.toBe(3);
    });
  });

  describe('getCredentialsByUserId - sort comparator direction', () => {
    it('should sort by b.createdAt - a.createdAt (not a - b)', async () => {
      const oldest = createTestCredential({ userId: 'sort-dir', createdAt: new Date('2020-01-01') });
      const middle = createTestCredential({ userId: 'sort-dir', createdAt: new Date('2022-06-15') });
      const newest = createTestCredential({ userId: 'sort-dir', createdAt: new Date('2024-12-31') });

      await store.createCredential(oldest);
      await store.createCredential(middle);
      await store.createCredential(newest);

      const result = await store.getCredentialsByUserId('sort-dir');

      // First element should be newest (descending)
      expect(result[0].id).toBe(newest.id);
      expect(result[1].id).toBe(middle.id);
      expect(result[2].id).toBe(oldest.id);

      // Verify descending order explicitly
      expect(result[0].createdAt.getTime()).toBeGreaterThan(result[1].createdAt.getTime());
      expect(result[1].createdAt.getTime()).toBeGreaterThan(result[2].createdAt.getTime());
    });
  });

  describe('getChallenge - strict greater-than (not >=) for expiry', () => {
    it('should return challenge when Date.now() equals expiresAt exactly (> not >=)', async () => {
      const exactTime = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(exactTime);

      const challenge = createTestChallenge({ expiresAt: exactTime });
      await store.setChallenge('exact-boundary', challenge);

      // Date.now() > entry.expiresAt: exactTime > exactTime is false
      // So challenge should still be returned
      const result = await store.getChallenge('exact-boundary');
      expect(result).not.toBeNull();
      expect(result!.challenge).toBe(challenge.challenge);

      vi.restoreAllMocks();
    });

    it('should return null when Date.now() is 1ms past expiresAt', async () => {
      const expiresAt = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);

      const challenge = createTestChallenge({ expiresAt });
      await store.setChallenge('past-boundary', challenge);

      // Date.now() > entry.expiresAt: (expiresAt + 1) > expiresAt is true
      const result = await store.getChallenge('past-boundary');
      expect(result).toBeNull();

      vi.restoreAllMocks();
    });
  });

  describe('deleteCredentialsByUserId - returns exact count', () => {
    it('should return exactly the number of credentials deleted (not 0, not more)', async () => {
      await store.createCredential(createTestCredential({ userId: 'count-del' }));
      await store.createCredential(createTestCredential({ userId: 'count-del' }));
      await store.createCredential(createTestCredential({ userId: 'count-del' }));

      const count = await store.deleteCredentialsByUserId('count-del');
      expect(count).toBe(3);
      expect(count).not.toBe(0);
      expect(count).not.toBe(2);
      expect(count).not.toBe(4);
    });
  });

  describe('createCredential - user set initialization', () => {
    it('should create a new Set for first credential of a user', async () => {
      const cred = createTestCredential({ userId: 'first-cred-user' });
      await store.createCredential(cred);

      const count = await store.countCredentialsByUserId('first-cred-user');
      expect(count).toBe(1);
    });

    it('should add to existing Set for subsequent credentials', async () => {
      await store.createCredential(createTestCredential({ userId: 'multi-add' }));
      await store.createCredential(createTestCredential({ userId: 'multi-add' }));

      const count = await store.countCredentialsByUserId('multi-add');
      expect(count).toBe(2);
    });
  });

  describe('updateCredential - all 5 immutable fields preserved', () => {
    it('should preserve id even when trying to overwrite', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      const updated = await store.updateCredential(cred.id, { id: 'HACKED' } as any);
      expect(updated!.id).toBe(cred.id);
    });

    it('should preserve credentialId even when trying to overwrite', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      const updated = await store.updateCredential(cred.id, { credentialId: 'HACKED' } as any);
      expect(updated!.credentialId).toBe(cred.credentialId);
    });

    it('should preserve publicKey even when trying to overwrite', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      const updated = await store.updateCredential(cred.id, { publicKey: 'HACKED' } as any);
      expect(updated!.publicKey).toBe(cred.publicKey);
    });

    it('should preserve userId even when trying to overwrite', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      const updated = await store.updateCredential(cred.id, { userId: 'HACKED' } as any);
      expect(updated!.userId).toBe(cred.userId);
    });

    it('should preserve createdAt even when trying to overwrite', async () => {
      const cred = createTestCredential();
      await store.createCredential(cred);
      const updated = await store.updateCredential(cred.id, { createdAt: new Date('1970-01-01') } as any);
      expect(updated!.createdAt).toEqual(cred.createdAt);
    });
  });

  describe('getStats - exact field structure', () => {
    it('should return object with exactly 4 fields', () => {
      const stats = store.getStats();
      const keys = Object.keys(stats);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('totalCredentials');
      expect(keys).toContain('totalUsers');
      expect(keys).toContain('pendingChallenges');
      expect(keys).toContain('credentialsByUser');
    });
  });
});

describe('Mutation-killing: RedisWebAuthnStore TTL and key prefix', () => {
  function createMockStateProvider() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      getHealthStatus: vi.fn().mockResolvedValue({ healthy: true }),
      increment: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      getRawClient: vi.fn(),
      clearFallbackCache: vi.fn(),
      cleanupFallbackCache: vi.fn(),
    };
  }

  it('should use exact key prefix "webauthn:challenge:" for setChallenge', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const challenge = createTestChallenge({ expiresAt: Date.now() + 60000 });
    await store.setChallenge('my-key', challenge);

    // Key must start with exact prefix
    const redisKey = mockProvider.set.mock.calls[0][0];
    expect(redisKey).toBe('webauthn:challenge:my-key');
    expect(redisKey).toMatch(/^webauthn:challenge:/);

    store.stop();
  });

  it('should use exact key prefix "webauthn:challenge:" for getChallenge', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    await store.getChallenge('get-key');

    expect(mockProvider.get).toHaveBeenCalledWith('webauthn:challenge:get-key');

    store.stop();
  });

  it('should use exact key prefix "webauthn:challenge:" for deleteChallenge', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    await store.deleteChallenge('del-key');

    expect(mockProvider.delete).toHaveBeenCalledWith('webauthn:challenge:del-key');

    store.stop();
  });

  it('should calculate TTL using ceil((expiresAt - Date.now()) / 1000) with minimum 1', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    // 60 seconds from now
    const challenge = createTestChallenge({ expiresAt: now + 60000 });
    await store.setChallenge('ttl-test', challenge);

    const ttl = mockProvider.set.mock.calls[0][2];
    expect(ttl).toBe(60); // Math.ceil(60000 / 1000)
    expect(ttl).toBeGreaterThanOrEqual(1);

    vi.restoreAllMocks();
    store.stop();
  });

  it('should enforce minimum TTL of 1 second even when expiresAt is very close', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    // Already past or exactly at now: Math.max(1, Math.ceil((now - now) / 1000)) = Math.max(1, 0) = 1
    const challenge = createTestChallenge({ expiresAt: now });
    await store.setChallenge('min-ttl-test', challenge);

    const ttl = mockProvider.set.mock.calls[0][2];
    expect(ttl).toBe(1); // Math.max(1, 0) = 1
    expect(ttl).not.toBe(0);

    vi.restoreAllMocks();
    store.stop();
  });

  it('should serialize createdAt as ISO string in Redis', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const createdAt = new Date('2025-06-15T12:00:00Z');
    const challenge = createTestChallenge({ createdAt, expiresAt: Date.now() + 60000 });
    await store.setChallenge('iso-test', challenge);

    const serialized = JSON.parse(mockProvider.set.mock.calls[0][1]);
    expect(serialized.createdAt).toBe('2025-06-15T12:00:00.000Z');
    expect(typeof serialized.createdAt).toBe('string');

    store.stop();
  });

  it('should deserialize createdAt back to Date from Redis', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    mockProvider.get.mockResolvedValue(JSON.stringify({
      challenge: 'deserialized-test',
      userId: 'user-1',
      type: 'registration',
      expiresAt: Date.now() + 300000,
      createdAt: '2025-06-15T12:00:00.000Z',
    }));

    const result = await store.getChallenge('deser-key');
    expect(result).not.toBeNull();
    expect(result!.createdAt).toBeInstanceOf(Date);
    expect(result!.createdAt.toISOString()).toBe('2025-06-15T12:00:00.000Z');

    store.stop();
  });

  it('getStats should include usingRedis as true when Redis is healthy', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const stats = store.getStats();
    expect(stats.usingRedis).toBe(true);
    expect(stats.usingRedis).not.toBe(false);

    store.stop();
  });

  it('getStats should have exactly 5 fields (including usingRedis)', async () => {
    const mockProvider = createMockStateProvider();
    const store = new RedisWebAuthnStore(mockProvider as any);
    await vi.waitFor(() => {
      expect(mockProvider.getHealthStatus).toHaveBeenCalled();
    });

    const stats = store.getStats();
    const keys = Object.keys(stats);
    expect(keys).toHaveLength(5);
    expect(keys).toContain('usingRedis');
    expect(keys).toContain('totalCredentials');
    expect(keys).toContain('totalUsers');
    expect(keys).toContain('pendingChallenges');
    expect(keys).toContain('credentialsByUser');

    store.stop();
  });
});

describe('Mutation-killing: cleanup interval exact timing', () => {
  it('should use 60000ms interval for cleanup (not 60001 or 59999)', async () => {
    vi.useFakeTimers();

    const cleanupStore = new InMemoryWebAuthnStore();
    const expired = createTestChallenge({ expiresAt: Date.now() - 1 });
    await cleanupStore.setChallenge('timing-test', expired);

    // At 59999ms, cleanup should NOT have fired
    vi.advanceTimersByTime(59999);
    const stats59 = cleanupStore.getStats();
    expect(stats59.pendingChallenges).toBe(1); // Still there

    // At 60000ms, cleanup SHOULD fire
    vi.advanceTimersByTime(1);
    const stats60 = cleanupStore.getStats();
    expect(stats60.pendingChallenges).toBe(0); // Cleaned up

    cleanupStore.stop();
    vi.useRealTimers();
  });
});
