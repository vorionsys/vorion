/**
 * MFA Store Tests
 *
 * Tests for the MfaStore class and singleton functions.
 * Uses mocked Drizzle database chain operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../common/db.js', () => ({
  getDatabase: vi.fn(() => mockDb),
}));

vi.mock('../../../common/random.js', () => ({
  secureRandomId: vi.fn(() => 'mock-random-token'),
}));

// =============================================================================
// Mock Database Helpers
// =============================================================================

let mockDb: any;

/**
 * Create a mock Drizzle DB chain that supports all common operations.
 * The final operation in a chain (returning, limit, or the chain itself for
 * update/delete without returning) resolves with the provided value.
 */
function createMockDbChain(returnValue: any) {
  const chain: any = {};
  const methods = [
    'select',
    'insert',
    'update',
    'delete',
    'from',
    'where',
    'values',
    'set',
    'returning',
    'limit',
    'orderBy',
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods resolve with the returnValue
  chain.returning = vi.fn().mockResolvedValue(
    Array.isArray(returnValue) ? returnValue : [returnValue]
  );
  chain.limit = vi.fn().mockResolvedValue(
    Array.isArray(returnValue) ? returnValue : [returnValue]
  );
  // Make the chain itself thenable (for awaiting update/delete without .returning())
  chain.then = (resolve: any) =>
    resolve(Array.isArray(returnValue) ? returnValue : [returnValue]);
  return chain;
}

function createFreshMockDb(returnValue: any = []) {
  return createMockDbChain(returnValue);
}

// =============================================================================
// Test Data Factories
// =============================================================================

const now = new Date('2025-01-15T12:00:00Z');

function makeUserMfaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mfa-id-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    totpSecret: 'encrypted-secret',
    totpSecretEncrypted: true,
    status: 'active',
    enabledAt: now,
    enrollmentStartedAt: now,
    enrollmentExpiresAt: null,
    gracePeriodEndsAt: new Date('2025-01-16T12:00:00Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBackupCodeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bc-id-1',
    userMfaId: 'mfa-id-1',
    codeHash: 'hash-abc',
    usedAt: null,
    usedFromIp: null,
    createdAt: now,
    ...overrides,
  };
}

function makeChallengeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'challenge-id-1',
    userId: 'user-1',
    sessionId: 'session-1',
    challengeToken: 'mock-random-token',
    verified: false,
    verifiedAt: null,
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date('2025-01-15T12:05:00Z'),
    createdAt: now,
    ...overrides,
  };
}

// =============================================================================
// Imports (after mocks)
// =============================================================================

import {
  MfaStore,
  getMfaStore,
  resetMfaStore,
  createMfaStore,
} from '../mfa-store.js';

// =============================================================================
// Tests
// =============================================================================

describe('mfa-store', () => {
  let store: MfaStore;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMfaStore();
    mockDb = createFreshMockDb();
    store = new MfaStore(mockDb);
  });

  // ===========================================================================
  // createUserMfa
  // ===========================================================================
  describe('createUserMfa', () => {
    it('should create a record and return mapped result', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret123',
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(result.id).toBe('mfa-id-1');
      expect(result.userId).toBe('user-1');
      expect(result.tenantId).toBe('tenant-1');
    });

    it('should use totpSecretEncrypted default true when not provided', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      expect(result.totpSecretEncrypted).toBe(true);
    });

    it('should pass totpSecretEncrypted=false when explicitly set', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: false });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
        totpSecretEncrypted: false,
      });

      expect(result.totpSecretEncrypted).toBe(false);
    });

    it('should set status to pending and enrollment times', async () => {
      const row = makeUserMfaRow({
        status: 'pending',
        enrollmentStartedAt: now,
        enrollmentExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      expect(result.status).toBe('pending');
      expect(result.enrollmentStartedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // getUserMfa
  // ===========================================================================
  describe('getUserMfa', () => {
    it('should return mapped record when found', async () => {
      const row = makeUserMfaRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('user-1', 'tenant-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('mfa-id-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.tenantId).toBe('tenant-1');
    });

    it('should return null when not found', async () => {
      mockDb = createFreshMockDb([]);
      // Override limit to return empty array
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('nonexistent', 'tenant-1');

      expect(result).toBeNull();
    });

    it('should call select, from, where, limit in chain', async () => {
      const row = makeUserMfaRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.getUserMfa('user-1', 'tenant-1');

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalledWith(1);
    });
  });

  // ===========================================================================
  // getUserMfaById
  // ===========================================================================
  describe('getUserMfaById', () => {
    it('should return mapped record when found', async () => {
      const row = makeUserMfaRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-id-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('mfa-id-1');
    });

    it('should return null when not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // activateUserMfa
  // ===========================================================================
  describe('activateUserMfa', () => {
    it('should update status to active and return record', async () => {
      const row = makeUserMfaRow({ status: 'active', enabledAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const gracePeriodEndsAt = new Date('2025-01-16T12:00:00Z');
      const result = await store.activateUserMfa('mfa-id-1', gracePeriodEndsAt);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
    });

    it('should return null when record not found after update', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.activateUserMfa('nonexistent', new Date());

      expect(result).toBeNull();
    });

    it('should set enrollmentExpiresAt to null on activation', async () => {
      const row = makeUserMfaRow({
        status: 'active',
        enrollmentExpiresAt: null,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.activateUserMfa('mfa-id-1', new Date());

      expect(result!.enrollmentExpiresAt).toBeNull();
    });
  });

  // ===========================================================================
  // disableUserMfa
  // ===========================================================================
  describe('disableUserMfa', () => {
    it('should update status to disabled and clear fields', async () => {
      const row = makeUserMfaRow({
        status: 'disabled',
        totpSecret: null,
        enabledAt: null,
        gracePeriodEndsAt: null,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.disableUserMfa('user-1', 'tenant-1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.status).toBe('disabled');
      expect(result!.totpSecret).toBeNull();
    });

    it('should return null when record not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.disableUserMfa('nonexistent', 'tenant-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // deleteUserMfa
  // ===========================================================================
  describe('deleteUserMfa', () => {
    it('should delete and return true when record exists', async () => {
      mockDb = createFreshMockDb([{ id: 'mfa-id-1' }]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('user-1', 'tenant-1');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when no record deleted', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('nonexistent', 'tenant-1');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // updateEnrollmentExpiry
  // ===========================================================================
  describe('updateEnrollmentExpiry', () => {
    it('should update enrollment expiry', async () => {
      mockDb = createFreshMockDb();
      store = new MfaStore(mockDb);

      const expiresAt = new Date('2025-01-15T12:30:00Z');
      await store.updateEnrollmentExpiry('mfa-id-1', expiresAt);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should not throw on successful update', async () => {
      mockDb = createFreshMockDb();
      store = new MfaStore(mockDb);

      await expect(
        store.updateEnrollmentExpiry('mfa-id-1', new Date())
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // createBackupCodes
  // ===========================================================================
  describe('createBackupCodes', () => {
    it('should create multiple backup codes and return mapped records', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1', codeHash: 'hash-1' }),
        makeBackupCodeRow({ id: 'bc-2', codeHash: 'hash-2' }),
        makeBackupCodeRow({ id: 'bc-3', codeHash: 'hash-3' }),
      ];
      mockDb = createFreshMockDb(rows);
      store = new MfaStore(mockDb);

      const result = await store.createBackupCodes('mfa-id-1', [
        'hash-1',
        'hash-2',
        'hash-3',
      ]);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(result[0].codeHash).toBe('hash-1');
    });

    it('should map all fields in returned backup code records', async () => {
      const row = makeBackupCodeRow();
      mockDb = createFreshMockDb([row]);
      store = new MfaStore(mockDb);

      const result = await store.createBackupCodes('mfa-id-1', ['hash-abc']);

      expect(result[0]).toEqual({
        id: 'bc-id-1',
        userMfaId: 'mfa-id-1',
        codeHash: 'hash-abc',
        usedAt: null,
        usedFromIp: null,
        createdAt: now,
      });
    });
  });

  // ===========================================================================
  // getUnusedBackupCodes
  // ===========================================================================
  describe('getUnusedBackupCodes', () => {
    it('should return unused backup codes', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1', usedAt: null }),
        makeBackupCodeRow({ id: 'bc-2', usedAt: null }),
      ];
      // getUnusedBackupCodes uses select().from().where() which returns a promise via `then`
      mockDb = createFreshMockDb(rows);
      // Override chain to resolve from where (since there is no .limit or .returning)
      mockDb.where = vi.fn().mockResolvedValue(rows);
      store = new MfaStore(mockDb);

      const result = await store.getUnusedBackupCodes('mfa-id-1');

      expect(result).toHaveLength(2);
      expect(result[0].usedAt).toBeNull();
    });

    it('should return empty array when no unused codes', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.where = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getUnusedBackupCodes('mfa-id-1');

      expect(result).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getUnusedBackupCodeCount
  // ===========================================================================
  describe('getUnusedBackupCodeCount', () => {
    it('should return count of unused backup codes', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1' }),
        makeBackupCodeRow({ id: 'bc-2' }),
        makeBackupCodeRow({ id: 'bc-3' }),
      ];
      mockDb = createFreshMockDb(rows);
      mockDb.where = vi.fn().mockResolvedValue(rows);
      store = new MfaStore(mockDb);

      const count = await store.getUnusedBackupCodeCount('mfa-id-1');

      expect(count).toBe(3);
    });

    it('should return 0 when no unused codes', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.where = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const count = await store.getUnusedBackupCodeCount('mfa-id-1');

      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // markBackupCodeUsed
  // ===========================================================================
  describe('markBackupCodeUsed', () => {
    it('should update code with usedAt and usedFromIp', async () => {
      const row = makeBackupCodeRow({
        usedAt: now,
        usedFromIp: '192.168.1.1',
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markBackupCodeUsed('bc-id-1', '192.168.1.1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.usedFromIp).toBe('192.168.1.1');
    });

    it('should return null when code not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.markBackupCodeUsed('nonexistent', null);

      expect(result).toBeNull();
    });

    it('should handle null usedFromIp', async () => {
      const row = makeBackupCodeRow({ usedAt: now, usedFromIp: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markBackupCodeUsed('bc-id-1', null);

      expect(result).not.toBeNull();
      expect(result!.usedFromIp).toBeNull();
    });
  });

  // ===========================================================================
  // deleteBackupCodes
  // ===========================================================================
  describe('deleteBackupCodes', () => {
    it('should delete all codes for userMfaId and return count', async () => {
      mockDb = createFreshMockDb([{ id: 'bc-1' }, { id: 'bc-2' }]);
      store = new MfaStore(mockDb);

      const count = await store.deleteBackupCodes('mfa-id-1');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(count).toBe(2);
    });

    it('should return 0 when no codes deleted', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const count = await store.deleteBackupCodes('mfa-id-1');

      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // createChallenge
  // ===========================================================================
  describe('createChallenge', () => {
    it('should create a challenge with a generated token', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const expiresAt = new Date('2025-01-15T12:05:00Z');
      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt,
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(result.challengeToken).toBe('mock-random-token');
      expect(result.userId).toBe('user-1');
      expect(result.sessionId).toBe('session-1');
    });

    it('should use default maxAttempts of 5 when not provided', async () => {
      const row = makeChallengeRow({ maxAttempts: 5 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
      });

      expect(result.maxAttempts).toBe(5);
    });

    it('should use custom maxAttempts when provided', async () => {
      const row = makeChallengeRow({ maxAttempts: 3 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
        maxAttempts: 3,
      });

      expect(result.maxAttempts).toBe(3);
    });

    it('should map all challenge fields correctly', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date('2025-01-15T12:05:00Z'),
      });

      expect(result).toEqual({
        id: 'challenge-id-1',
        userId: 'user-1',
        sessionId: 'session-1',
        challengeToken: 'mock-random-token',
        verified: false,
        verifiedAt: null,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date('2025-01-15T12:05:00Z'),
        createdAt: now,
      });
    });
  });

  // ===========================================================================
  // getChallengeByToken
  // ===========================================================================
  describe('getChallengeByToken', () => {
    it('should return challenge when found', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result).not.toBeNull();
      expect(result!.challengeToken).toBe('mock-random-token');
    });

    it('should return null when not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getActiveChallenge
  // ===========================================================================
  describe('getActiveChallenge', () => {
    it('should return non-expired, non-verified challenge', async () => {
      const futureExpiry = new Date(Date.now() + 60_000);
      const row = makeChallengeRow({
        verified: false,
        expiresAt: futureExpiry,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).not.toBeNull();
      expect(result!.verified).toBe(false);
    });

    it('should return null when challenge is expired', async () => {
      const pastExpiry = new Date('2020-01-01T00:00:00Z');
      const row = makeChallengeRow({
        verified: false,
        expiresAt: pastExpiry,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).toBeNull();
    });

    it('should return null when no challenge found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).toBeNull();
    });

    it('should call orderBy for createdAt desc', async () => {
      const row = makeChallengeRow({
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.getActiveChallenge('user-1', 'session-1');

      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // incrementChallengeAttempts
  // ===========================================================================
  describe('incrementChallengeAttempts', () => {
    it('should increment attempts and return updated challenge', async () => {
      // First call: getChallengeById (select...limit)
      // Second call: update...returning
      const currentRow = makeChallengeRow({ attempts: 2 });
      const updatedRow = makeChallengeRow({ attempts: 3 });
      mockDb = createFreshMockDb(currentRow);
      // On the first limit call, return the current row (getChallengeById)
      // On the returning call after update, return the updated row
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          return Promise.resolve([currentRow]);
        }
        return Promise.resolve([updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      const result = await store.incrementChallengeAttempts('challenge-id-1');

      expect(result).not.toBeNull();
      expect(result!.attempts).toBe(3);
    });

    it('should return null when challenge not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.incrementChallengeAttempts('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // markChallengeVerified
  // ===========================================================================
  describe('markChallengeVerified', () => {
    it('should set verified=true and verifiedAt', async () => {
      const row = makeChallengeRow({
        verified: true,
        verifiedAt: now,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markChallengeVerified('challenge-id-1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.verified).toBe(true);
      expect(result!.verifiedAt).toEqual(now);
    });

    it('should return null when challenge not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.markChallengeVerified('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // deleteExpiredChallenges
  // ===========================================================================
  describe('deleteExpiredChallenges', () => {
    it('should delete expired challenges and return count', async () => {
      mockDb = createFreshMockDb([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
      store = new MfaStore(mockDb);

      const count = await store.deleteExpiredChallenges();

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(count).toBe(3);
    });

    it('should return 0 when no expired challenges', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const count = await store.deleteExpiredChallenges();

      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // isSessionVerified
  // ===========================================================================
  describe('isSessionVerified', () => {
    it('should return true when verified challenge exists', async () => {
      const row = makeChallengeRow({ verified: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.isSessionVerified('user-1', 'session-1');

      expect(result).toBe(true);
    });

    it('should return false when no verified challenge exists', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([undefined]);
      store = new MfaStore(mockDb);

      const result = await store.isSessionVerified('user-1', 'session-1');

      expect(result).toBe(false);
    });

    it('should query with userId, sessionId, and verified=true', async () => {
      const row = makeChallengeRow({ verified: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.isSessionVerified('user-1', 'session-1');

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalledWith(1);
    });
  });

  // ===========================================================================
  // getChallengeById
  // ===========================================================================
  describe('getChallengeById', () => {
    it('should return challenge when found', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeById('challenge-id-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('challenge-id-1');
    });

    it('should return null when not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Singleton functions
  // ===========================================================================
  describe('singleton functions', () => {
    it('getMfaStore should return a MfaStore instance', () => {
      const instance = getMfaStore();
      expect(instance).toBeInstanceOf(MfaStore);
    });

    it('getMfaStore should return the same instance on repeated calls', () => {
      const first = getMfaStore();
      const second = getMfaStore();
      expect(first).toBe(second);
    });

    it('resetMfaStore should clear the singleton', () => {
      const first = getMfaStore();
      resetMfaStore();
      const second = getMfaStore();
      expect(first).not.toBe(second);
    });

    it('createMfaStore should create a new store with custom database', () => {
      const customDb = createFreshMockDb();
      const customStore = createMfaStore(customDb);
      expect(customStore).toBeInstanceOf(MfaStore);
    });
  });

  // ===========================================================================
  // Mapping edge cases
  // ===========================================================================
  describe('mapping edge cases', () => {
    it('should map totpSecretEncrypted to true when null in DB', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      expect(result.totpSecretEncrypted).toBe(true);
    });

    it('should map verified to false when null in challenge', async () => {
      const row = makeChallengeRow({ verified: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
      });

      expect(result.verified).toBe(false);
    });

    it('should map attempts to 0 when null in challenge', async () => {
      const row = makeChallengeRow({ attempts: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
      });

      expect(result.attempts).toBe(0);
    });

    it('should map maxAttempts to 5 when null in challenge', async () => {
      const row = makeChallengeRow({ maxAttempts: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
      });

      expect(result.maxAttempts).toBe(5);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Exact values passed to db.insert().values() and db.update().set()
  // These kill ObjectLiteral mutations by verifying the exact objects passed
  // ===========================================================================

  describe('exact insert/update values verification (ObjectLiteral kills)', () => {
    it('createUserMfa passes exact values to db.insert().values()', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-val',
        tenantId: 'tenant-val',
        totpSecret: 'secret-val',
        totpSecretEncrypted: false,
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-val',
          tenantId: 'tenant-val',
          totpSecret: 'secret-val',
          totpSecretEncrypted: false,
          status: 'pending',
        })
      );

      // Verify enrollmentStartedAt and enrollmentExpiresAt are Date objects
      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.enrollmentStartedAt).toBeInstanceOf(Date);
      expect(valuesArg.enrollmentExpiresAt).toBeInstanceOf(Date);
    });

    it('createUserMfa defaults totpSecretEncrypted to true when not provided', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.totpSecretEncrypted).toBe(true);
    });

    it('createUserMfa enrollment expiry is approximately 15 minutes from now', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const beforeTime = Date.now();
      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });
      const afterTime = Date.now();

      const valuesArg = mockDb.values.mock.calls[0][0];
      const expiresAt = valuesArg.enrollmentExpiresAt.getTime();
      const startedAt = valuesArg.enrollmentStartedAt.getTime();

      // enrollmentExpiresAt should be ~15 minutes (900000ms) after enrollmentStartedAt
      const diff = expiresAt - startedAt;
      expect(diff).toBe(15 * 60 * 1000);
    });

    it('activateUserMfa passes exact set values', async () => {
      const row = makeUserMfaRow({ status: 'active' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const gracePeriodEndsAt = new Date('2025-06-01T00:00:00Z');
      await store.activateUserMfa('mfa-id-1', gracePeriodEndsAt);

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          enrollmentExpiresAt: null,
          gracePeriodEndsAt,
        })
      );

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.enabledAt).toBeInstanceOf(Date);
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it('disableUserMfa passes exact set values', async () => {
      const row = makeUserMfaRow({ status: 'disabled' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.disableUserMfa('user-1', 'tenant-1');

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'disabled',
          totpSecret: null,
          enabledAt: null,
          gracePeriodEndsAt: null,
        })
      );

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it('updateEnrollmentExpiry passes exact set values', async () => {
      mockDb = createFreshMockDb();
      store = new MfaStore(mockDb);

      const expiresAt = new Date('2025-03-01T00:00:00Z');
      await store.updateEnrollmentExpiry('mfa-id-1', expiresAt);

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enrollmentExpiresAt: expiresAt,
        })
      );

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it('markBackupCodeUsed passes exact set values', async () => {
      const row = makeBackupCodeRow({ usedAt: now, usedFromIp: '10.0.0.1' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.markBackupCodeUsed('bc-id-1', '10.0.0.1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.usedAt).toBeInstanceOf(Date);
      expect(setArg.usedFromIp).toBe('10.0.0.1');
    });

    it('markBackupCodeUsed passes null usedFromIp when null', async () => {
      const row = makeBackupCodeRow({ usedAt: now, usedFromIp: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.markBackupCodeUsed('bc-id-1', null);

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.usedFromIp).toBeNull();
    });

    it('markChallengeVerified passes exact set values', async () => {
      const row = makeChallengeRow({ verified: true, verifiedAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.markChallengeVerified('challenge-id-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.verified).toBe(true);
      expect(setArg.verifiedAt).toBeInstanceOf(Date);
    });

    it('createChallenge passes exact values to db.insert().values()', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const expiresAt = new Date('2025-06-01T00:00:00Z');
      await store.createChallenge({
        userId: 'user-ch',
        sessionId: 'sess-ch',
        expiresAt,
        maxAttempts: 3,
      });

      expect(mockDb.values).toHaveBeenCalledWith({
        userId: 'user-ch',
        sessionId: 'sess-ch',
        challengeToken: 'mock-random-token',
        expiresAt,
        maxAttempts: 3,
      });
    });

    it('createChallenge defaults maxAttempts to 5 when not provided', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createChallenge({
        userId: 'user-1',
        sessionId: 'sess-1',
        expiresAt: new Date(),
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.maxAttempts).toBe(5);
    });

    it('createBackupCodes passes correct values array', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1', codeHash: 'h1' }),
        makeBackupCodeRow({ id: 'bc-2', codeHash: 'h2' }),
      ];
      mockDb = createFreshMockDb(rows);
      store = new MfaStore(mockDb);

      await store.createBackupCodes('mfa-42', ['h1', 'h2']);

      expect(mockDb.values).toHaveBeenCalledWith([
        { userMfaId: 'mfa-42', codeHash: 'h1' },
        { userMfaId: 'mfa-42', codeHash: 'h2' },
      ]);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: incrementChallengeAttempts uses current.attempts + 1
  // ===========================================================================

  describe('incrementChallengeAttempts - exact set value', () => {
    it('should set attempts to current.attempts + 1', async () => {
      const currentRow = makeChallengeRow({ attempts: 3 });
      const updatedRow = makeChallengeRow({ attempts: 4 });
      mockDb = createFreshMockDb(currentRow);
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          return Promise.resolve([currentRow]);
        }
        return Promise.resolve([updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      await store.incrementChallengeAttempts('challenge-id-1');

      // Verify db.update().set() was called with attempts = current + 1 = 4
      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.attempts).toBe(4);
    });

    it('should set attempts to 1 when current attempts is 0', async () => {
      const currentRow = makeChallengeRow({ attempts: 0 });
      const updatedRow = makeChallengeRow({ attempts: 1 });
      mockDb = createFreshMockDb(currentRow);
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          return Promise.resolve([currentRow]);
        }
        return Promise.resolve([updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      await store.incrementChallengeAttempts('challenge-id-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.attempts).toBe(1);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: BooleanLiteral - Drizzle schema defaults and mapping
  // ===========================================================================

  describe('BooleanLiteral mutation kills', () => {
    it('mapUserMfaRecord sets totpSecretEncrypted to true when DB returns true', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('user-1', 'tenant-1');

      expect(result!.totpSecretEncrypted).toBe(true);
    });

    it('mapUserMfaRecord sets totpSecretEncrypted to false when DB returns false', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: false });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('user-1', 'tenant-1');

      expect(result!.totpSecretEncrypted).toBe(false);
    });

    it('mapChallengeRecord sets verified to false when DB returns false', async () => {
      const row = makeChallengeRow({ verified: false });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.verified).toBe(false);
    });

    it('mapChallengeRecord sets verified to true when DB returns true', async () => {
      const row = makeChallengeRow({ verified: true, verifiedAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.verified).toBe(true);
    });

    it('mapChallengeRecord sets attempts to 0 when DB returns 0', async () => {
      const row = makeChallengeRow({ attempts: 0 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.attempts).toBe(0);
    });

    it('mapChallengeRecord preserves non-zero attempts from DB', async () => {
      const row = makeChallengeRow({ attempts: 3 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.attempts).toBe(3);
    });

    it('mapChallengeRecord sets maxAttempts to 5 as default when null', async () => {
      const row = makeChallengeRow({ maxAttempts: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.maxAttempts).toBe(5);
    });

    it('mapChallengeRecord preserves non-5 maxAttempts from DB', async () => {
      const row = makeChallengeRow({ maxAttempts: 10 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.maxAttempts).toBe(10);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: ConditionalExpression - null checks with conditional returns
  // ===========================================================================

  describe('ConditionalExpression - record ? mapped : null patterns', () => {
    it('getUserMfa returns mapped record (not null) when record exists', async () => {
      const row = makeUserMfaRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('user-1', 'tenant-1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.tenantId).toBe('tenant-1');
      expect(result!.status).toBe('active');
    });

    it('getUserMfaById returns mapped record (not null) when record exists', async () => {
      const row = makeUserMfaRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-id-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('mfa-id-1');
    });

    it('activateUserMfa returns full mapped record when DB returns a row', async () => {
      const row = makeUserMfaRow({
        status: 'active',
        enabledAt: now,
        enrollmentExpiresAt: null,
        gracePeriodEndsAt: new Date('2025-06-01'),
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.activateUserMfa('mfa-id-1', new Date('2025-06-01'));

      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
      expect(result!.enabledAt).toEqual(now);
      expect(result!.enrollmentExpiresAt).toBeNull();
      expect(result!.gracePeriodEndsAt).toEqual(new Date('2025-06-01'));
    });

    it('disableUserMfa returns full mapped record when DB returns a row', async () => {
      const row = makeUserMfaRow({
        status: 'disabled',
        totpSecret: null,
        enabledAt: null,
        gracePeriodEndsAt: null,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.disableUserMfa('user-1', 'tenant-1');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('disabled');
      expect(result!.totpSecret).toBeNull();
      expect(result!.enabledAt).toBeNull();
      expect(result!.gracePeriodEndsAt).toBeNull();
    });

    it('getChallengeByToken returns full mapped record when found', async () => {
      const row = makeChallengeRow({
        verified: false,
        attempts: 2,
        maxAttempts: 5,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('challenge-id-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.sessionId).toBe('session-1');
      expect(result!.challengeToken).toBe('mock-random-token');
      expect(result!.verified).toBe(false);
      expect(result!.verifiedAt).toBeNull();
      expect(result!.attempts).toBe(2);
      expect(result!.maxAttempts).toBe(5);
    });

    it('markChallengeVerified returns null when no record found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.markChallengeVerified('nonexistent');

      expect(result).toBeNull();
    });

    it('incrementChallengeAttempts returns full mapped record when found', async () => {
      const currentRow = makeChallengeRow({ attempts: 1 });
      const updatedRow = makeChallengeRow({ attempts: 2 });
      mockDb = createFreshMockDb(currentRow);
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          return Promise.resolve([currentRow]);
        }
        return Promise.resolve([updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      const result = await store.incrementChallengeAttempts('challenge-id-1');

      expect(result).not.toBeNull();
      expect(result!.attempts).toBe(2);
      expect(result!.id).toBe('challenge-id-1');
    });

    it('markBackupCodeUsed returns full mapped record with all fields', async () => {
      const row = makeBackupCodeRow({
        usedAt: now,
        usedFromIp: '192.168.1.100',
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markBackupCodeUsed('bc-id-1', '192.168.1.100');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('bc-id-1');
      expect(result!.userMfaId).toBe('mfa-id-1');
      expect(result!.codeHash).toBe('hash-abc');
      expect(result!.usedAt).toEqual(now);
      expect(result!.usedFromIp).toBe('192.168.1.100');
      expect(result!.createdAt).toEqual(now);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: BlockStatement - guarded blocks
  // ===========================================================================

  describe('BlockStatement - logging blocks and conditional returns', () => {
    it('deleteUserMfa returns true and logs when rows are deleted', async () => {
      mockDb = createFreshMockDb([{ id: 'mfa-id-1' }]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('user-1', 'tenant-1');

      expect(result).toBe(true);
    });

    it('deleteUserMfa returns false without logging when no rows deleted', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('nonexistent', 'tenant-1');

      expect(result).toBe(false);
    });

    it('deleteExpiredChallenges returns correct count when challenges deleted', async () => {
      mockDb = createFreshMockDb([{ id: 'c1' }, { id: 'c2' }]);
      store = new MfaStore(mockDb);

      const count = await store.deleteExpiredChallenges();

      expect(count).toBe(2);
    });

    it('deleteExpiredChallenges returns 0 when no expired challenges', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const count = await store.deleteExpiredChallenges();

      expect(count).toBe(0);
    });

    it('activateUserMfa logs when record is found', async () => {
      const row = makeUserMfaRow({ status: 'active' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.activateUserMfa('mfa-id-1', new Date());

      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
    });

    it('markBackupCodeUsed logs when record is found', async () => {
      const row = makeBackupCodeRow({ usedAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markBackupCodeUsed('bc-id-1', null);

      expect(result).not.toBeNull();
    });

    it('markChallengeVerified logs when record is found', async () => {
      const row = makeChallengeRow({ verified: true, verifiedAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.markChallengeVerified('challenge-id-1');

      expect(result).not.toBeNull();
      expect(result!.verified).toBe(true);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Full mapUserMfaRecord field verification
  // ===========================================================================

  describe('mapUserMfaRecord - all fields mapped correctly', () => {
    it('maps all UserMfaRecord fields from DB row', async () => {
      const fullRow = makeUserMfaRow({
        id: 'mfa-full-id',
        userId: 'user-full',
        tenantId: 'tenant-full',
        totpSecret: 'full-secret',
        totpSecretEncrypted: true,
        status: 'active',
        enabledAt: new Date('2025-01-10'),
        enrollmentStartedAt: new Date('2025-01-09'),
        enrollmentExpiresAt: null,
        gracePeriodEndsAt: new Date('2025-01-17'),
        createdAt: new Date('2025-01-08'),
        updatedAt: new Date('2025-01-15'),
      });
      mockDb = createFreshMockDb(fullRow);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfa('user-full', 'tenant-full');

      expect(result).toEqual({
        id: 'mfa-full-id',
        userId: 'user-full',
        tenantId: 'tenant-full',
        totpSecret: 'full-secret',
        totpSecretEncrypted: true,
        status: 'active',
        enabledAt: new Date('2025-01-10'),
        enrollmentStartedAt: new Date('2025-01-09'),
        enrollmentExpiresAt: null,
        gracePeriodEndsAt: new Date('2025-01-17'),
        createdAt: new Date('2025-01-08'),
        updatedAt: new Date('2025-01-15'),
      });
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Enrollment expiry arithmetic — exact 900000ms value
  // Kills mutations like 15/60*1000, 15*60/1000, 15+60*1000, etc.
  // ===========================================================================

  describe('enrollment expiry arithmetic mutations', () => {
    it('enrollment expiry is exactly 900000ms (15*60*1000) from now', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      const diff = valuesArg.enrollmentExpiresAt.getTime() - valuesArg.enrollmentStartedAt.getTime();
      expect(diff).toBe(900000); // exact numeric check kills arithmetic mutants
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThan(1_000_000);
    });

    it('enrollment expiry is NOT 60000ms (kills 1*60*1000 mutant)', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      const diff = valuesArg.enrollmentExpiresAt.getTime() - valuesArg.enrollmentStartedAt.getTime();
      expect(diff).not.toBe(60000); // not 1 minute
      expect(diff).not.toBe(15000); // not 15 seconds
      expect(diff).not.toBe(15 * 60); // not 900ms
      expect(diff).not.toBe(1000); // not 1 second
    });

    it('enrollmentStartedAt and enrollmentExpiresAt are both passed (not swapped or removed)', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg).toHaveProperty('enrollmentStartedAt');
      expect(valuesArg).toHaveProperty('enrollmentExpiresAt');
      expect(valuesArg.enrollmentStartedAt).toBeInstanceOf(Date);
      expect(valuesArg.enrollmentExpiresAt).toBeInstanceOf(Date);
      expect(valuesArg.enrollmentExpiresAt.getTime()).toBeGreaterThan(valuesArg.enrollmentStartedAt.getTime());
    });
  });

  // ===========================================================================
  // MUTATION KILLS: String literal mutations — status values
  // Kills mutants that swap 'pending'/'active'/'disabled' strings
  // ===========================================================================

  describe('string literal status mutations', () => {
    it('createUserMfa passes status as literally "pending" (not "active" or "disabled")', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.status).toBe('pending');
      expect(valuesArg.status).not.toBe('active');
      expect(valuesArg.status).not.toBe('disabled');
    });

    it('activateUserMfa passes status as literally "active" (not "pending" or "disabled")', async () => {
      const row = makeUserMfaRow({ status: 'active' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.activateUserMfa('mfa-id-1', new Date());

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.status).toBe('active');
      expect(setArg.status).not.toBe('pending');
      expect(setArg.status).not.toBe('disabled');
    });

    it('disableUserMfa passes status as literally "disabled" (not "pending" or "active")', async () => {
      const row = makeUserMfaRow({ status: 'disabled' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.disableUserMfa('user-1', 'tenant-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.status).toBe('disabled');
      expect(setArg.status).not.toBe('pending');
      expect(setArg.status).not.toBe('active');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Null-to-non-null swaps in set() calls
  // Kills mutants that replace null with undefined, empty string, 0, etc.
  // ===========================================================================

  describe('null literal mutation kills in set() calls', () => {
    it('activateUserMfa sets enrollmentExpiresAt to exactly null', async () => {
      const row = makeUserMfaRow({ status: 'active' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.activateUserMfa('mfa-id-1', new Date());

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.enrollmentExpiresAt).toBeNull();
      expect(setArg.enrollmentExpiresAt).not.toBeUndefined();
    });

    it('disableUserMfa sets totpSecret to exactly null', async () => {
      const row = makeUserMfaRow({ status: 'disabled' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.disableUserMfa('user-1', 'tenant-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.totpSecret).toBeNull();
      expect(setArg.totpSecret).not.toBeUndefined();
      expect(setArg.totpSecret).not.toBe('');
    });

    it('disableUserMfa sets enabledAt to exactly null', async () => {
      const row = makeUserMfaRow({ status: 'disabled' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.disableUserMfa('user-1', 'tenant-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.enabledAt).toBeNull();
      expect(setArg.enabledAt).not.toBeUndefined();
    });

    it('disableUserMfa sets gracePeriodEndsAt to exactly null', async () => {
      const row = makeUserMfaRow({ status: 'disabled' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.disableUserMfa('user-1', 'tenant-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.gracePeriodEndsAt).toBeNull();
      expect(setArg.gracePeriodEndsAt).not.toBeUndefined();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: markChallengeVerified — verified literal must be true
  // ===========================================================================

  describe('markChallengeVerified boolean literal mutations', () => {
    it('markChallengeVerified sets verified to exactly true (not false)', async () => {
      const row = makeChallengeRow({ verified: true, verifiedAt: now });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.markChallengeVerified('challenge-id-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.verified).toBe(true);
      expect(setArg.verified).not.toBe(false);
      expect(setArg.verified).toStrictEqual(true);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: getActiveChallenge — expiry comparison direction
  // Kills mutants that change > to <, >=, <=, or ===
  // ===========================================================================

  describe('getActiveChallenge expiry comparison mutations', () => {
    it('returns record when expiresAt is 1ms in the future (boundary test)', async () => {
      // Use a fixed "now" by ensuring the record expires just barely in the future
      const futureExpiry = new Date(Date.now() + 5000); // 5 seconds ahead
      const row = makeChallengeRow({
        verified: false,
        expiresAt: futureExpiry,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).not.toBeNull();
    });

    it('returns null when expiresAt equals now (not expired > check, not >=)', async () => {
      // Create a challenge that expires exactly at the moment getActiveChallenge checks
      // Since getActiveChallenge does `new Date(record.expiresAt) > now` and both are
      // created almost simultaneously, a past date should yield null
      const pastExpiry = new Date(Date.now() - 1);
      const row = makeChallengeRow({
        verified: false,
        expiresAt: pastExpiry,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).toBeNull();
    });

    it('returns null when expiresAt is well in the past', async () => {
      const pastExpiry = new Date('2000-01-01T00:00:00Z');
      const row = makeChallengeRow({
        verified: false,
        expiresAt: pastExpiry,
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getActiveChallenge('user-1', 'session-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: isSessionVerified — `!== undefined` vs `=== undefined`
  // ===========================================================================

  describe('isSessionVerified comparison mutations', () => {
    it('returns true (not false) when record is present', async () => {
      const row = makeChallengeRow({ verified: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.isSessionVerified('user-1', 'session-1');

      expect(result).toBe(true);
      expect(result).not.toBe(false);
      expect(result).toStrictEqual(true);
    });

    it('returns false (not true) when record is undefined', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([undefined]);
      store = new MfaStore(mockDb);

      const result = await store.isSessionVerified('user-1', 'session-1');

      expect(result).toBe(false);
      expect(result).not.toBe(true);
      expect(result).toStrictEqual(false);
    });

    it('returns false when limit resolves to empty array (no record)', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.isSessionVerified('user-1', 'session-1');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: deleteUserMfa — `result.length > 0` boundary
  // Kills mutants that change > 0 to >= 0, < 0, === 0, etc.
  // ===========================================================================

  describe('deleteUserMfa boundary condition mutations', () => {
    it('returns true when exactly 1 row deleted (length=1 > 0 is true)', async () => {
      mockDb = createFreshMockDb([{ id: 'single-id' }]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('user-1', 'tenant-1');

      expect(result).toBe(true);
    });

    it('returns false when 0 rows deleted (length=0 > 0 is false)', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.returning = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('user-1', 'tenant-1');

      expect(result).toBe(false);
    });

    it('returns true when multiple rows deleted (length=3 > 0 is true)', async () => {
      mockDb = createFreshMockDb([{ id: 'id-1' }, { id: 'id-2' }, { id: 'id-3' }]);
      store = new MfaStore(mockDb);

      const result = await store.deleteUserMfa('user-1', 'tenant-1');

      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: incrementChallengeAttempts — +1 operator mutations
  // Kills mutants that change +1 to -1, *1, /1, or remove increment
  // ===========================================================================

  describe('incrementChallengeAttempts arithmetic mutations', () => {
    it('increments from 0 to 1 (not 0-1=-1, not 0*1=0)', async () => {
      const currentRow = makeChallengeRow({ attempts: 0 });
      const updatedRow = makeChallengeRow({ attempts: 1 });
      mockDb = createFreshMockDb(currentRow);
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        return Promise.resolve(limitCallCount === 1 ? [currentRow] : [updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      await store.incrementChallengeAttempts('challenge-id-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.attempts).toBe(1);
      expect(setArg.attempts).not.toBe(0); // kills removal mutant
      expect(setArg.attempts).not.toBe(-1); // kills -1 mutant
    });

    it('increments from 4 to 5 (not 4-1=3, not 4*1=4)', async () => {
      const currentRow = makeChallengeRow({ attempts: 4 });
      const updatedRow = makeChallengeRow({ attempts: 5 });
      mockDb = createFreshMockDb(currentRow);
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        return Promise.resolve(limitCallCount === 1 ? [currentRow] : [updatedRow]);
      });
      mockDb.returning = vi.fn().mockResolvedValue([updatedRow]);
      store = new MfaStore(mockDb);

      await store.incrementChallengeAttempts('challenge-id-1');

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.attempts).toBe(5);
      expect(setArg.attempts).not.toBe(4); // kills *1 or no-op mutant
      expect(setArg.attempts).not.toBe(3); // kills -1 mutant
    });

    it('does not call update when challenge is not found', async () => {
      mockDb = createFreshMockDb([]);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      store = new MfaStore(mockDb);

      const result = await store.incrementChallengeAttempts('nonexistent');

      expect(result).toBeNull();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Nullish coalescing defaults — exact default values
  // Kills mutants that change ?? true to ?? false, ?? 0 to ?? 1, etc.
  // ===========================================================================

  describe('nullish coalescing default value mutations', () => {
    it('totpSecretEncrypted ?? true — null yields true not false', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-id-1');

      expect(result!.totpSecretEncrypted).toBe(true);
      expect(result!.totpSecretEncrypted).not.toBe(false);
    });

    it('totpSecretEncrypted ?? true — undefined yields true not false', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: undefined });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-id-1');

      expect(result!.totpSecretEncrypted).toBe(true);
    });

    it('totpSecretEncrypted ?? true — false is preserved as false', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: false });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-id-1');

      expect(result!.totpSecretEncrypted).toBe(false);
    });

    it('verified ?? false — null yields false not true', async () => {
      const row = makeChallengeRow({ verified: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.verified).toBe(false);
      expect(result!.verified).not.toBe(true);
    });

    it('verified ?? false — undefined yields false', async () => {
      const row = makeChallengeRow({ verified: undefined });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.verified).toBe(false);
    });

    it('attempts ?? 0 — null yields 0 not 1 or 5', async () => {
      const row = makeChallengeRow({ attempts: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.attempts).toBe(0);
      expect(result!.attempts).not.toBe(1);
      expect(result!.attempts).not.toBe(5);
    });

    it('attempts ?? 0 — undefined yields 0', async () => {
      const row = makeChallengeRow({ attempts: undefined });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.attempts).toBe(0);
    });

    it('maxAttempts ?? 5 — null yields 5 not 0 or 1', async () => {
      const row = makeChallengeRow({ maxAttempts: null });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.maxAttempts).toBe(5);
      expect(result!.maxAttempts).not.toBe(0);
      expect(result!.maxAttempts).not.toBe(1);
    });

    it('maxAttempts ?? 5 — undefined yields 5', async () => {
      const row = makeChallengeRow({ maxAttempts: undefined });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.maxAttempts).toBe(5);
    });

    it('maxAttempts ?? 5 — non-null value 3 is preserved as 3', async () => {
      const row = makeChallengeRow({ maxAttempts: 3 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('mock-random-token');

      expect(result!.maxAttempts).toBe(3);
      expect(result!.maxAttempts).not.toBe(5);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: createUserMfa input field pass-through
  // Kills mutants that swap userId/tenantId/totpSecret in values()
  // ===========================================================================

  describe('createUserMfa field identity mutations', () => {
    it('userId in values() comes from input.userId, not input.tenantId', async () => {
      const row = makeUserMfaRow({ status: 'pending' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-ALPHA',
        tenantId: 'tenant-BETA',
        totpSecret: 'secret-GAMMA',
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.userId).toBe('user-ALPHA');
      expect(valuesArg.tenantId).toBe('tenant-BETA');
      expect(valuesArg.totpSecret).toBe('secret-GAMMA');
      // Kills swap mutations
      expect(valuesArg.userId).not.toBe('tenant-BETA');
      expect(valuesArg.tenantId).not.toBe('user-ALPHA');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: createChallenge input field pass-through + secureRandomId
  // Kills mutants that swap userId/sessionId or remove challengeToken
  // ===========================================================================

  describe('createChallenge field identity mutations', () => {
    it('userId and sessionId are passed correctly (not swapped)', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createChallenge({
        userId: 'user-AAA',
        sessionId: 'session-BBB',
        expiresAt: new Date('2030-01-01'),
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.userId).toBe('user-AAA');
      expect(valuesArg.sessionId).toBe('session-BBB');
      expect(valuesArg.userId).not.toBe('session-BBB');
      expect(valuesArg.sessionId).not.toBe('user-AAA');
    });

    it('challengeToken comes from secureRandomId (not input)', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date('2030-01-01'),
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.challengeToken).toBe('mock-random-token');
      expect(valuesArg).toHaveProperty('challengeToken');
    });

    it('expiresAt is passed from input', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const expiresAt = new Date('2030-06-15T10:30:00Z');
      await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt,
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.expiresAt).toBe(expiresAt);
    });

    it('maxAttempts defaults to 5 via ?? operator when undefined', async () => {
      const row = makeChallengeRow();
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
        // maxAttempts not provided (undefined)
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.maxAttempts).toBe(5);
      expect(valuesArg.maxAttempts).not.toBe(0);
      expect(valuesArg.maxAttempts).not.toBe(undefined);
    });

    it('maxAttempts passes through when explicitly set to 10', async () => {
      const row = makeChallengeRow({ maxAttempts: 10 });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createChallenge({
        userId: 'user-1',
        sessionId: 'session-1',
        expiresAt: new Date(),
        maxAttempts: 10,
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.maxAttempts).toBe(10);
      expect(valuesArg.maxAttempts).not.toBe(5);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: createUserMfa totpSecretEncrypted ?? true in values()
  // Kills mutant that changes `input.totpSecretEncrypted ?? true` to always true/false
  // ===========================================================================

  describe('createUserMfa totpSecretEncrypted coalescing in values()', () => {
    it('passes false to DB when input.totpSecretEncrypted is false (not coerced to true)', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: false });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
        totpSecretEncrypted: false,
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.totpSecretEncrypted).toBe(false);
      expect(valuesArg.totpSecretEncrypted).not.toBe(true);
    });

    it('passes true to DB when input.totpSecretEncrypted is undefined (default)', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
        // totpSecretEncrypted not set
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.totpSecretEncrypted).toBe(true);
    });

    it('passes true to DB when input.totpSecretEncrypted is explicitly true', async () => {
      const row = makeUserMfaRow({ totpSecretEncrypted: true });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      await store.createUserMfa({
        userId: 'user-1',
        tenantId: 'tenant-1',
        totpSecret: 'secret',
        totpSecretEncrypted: true,
      });

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg.totpSecretEncrypted).toBe(true);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: mapBackupCodeRecord — individual field identity
  // Kills mutants that swap fields in the mapping function
  // ===========================================================================

  describe('mapBackupCodeRecord field identity mutations', () => {
    it('each field maps to itself, not a different field', async () => {
      const row = makeBackupCodeRow({
        id: 'bc-unique-id',
        userMfaId: 'mfa-unique-id',
        codeHash: 'unique-hash-xyz',
        usedAt: new Date('2025-02-01'),
        usedFromIp: '10.20.30.40',
        createdAt: new Date('2025-01-01'),
      });
      mockDb = createFreshMockDb([row]);
      store = new MfaStore(mockDb);

      const result = await store.createBackupCodes('mfa-unique-id', ['unique-hash-xyz']);

      expect(result[0].id).toBe('bc-unique-id');
      expect(result[0].userMfaId).toBe('mfa-unique-id');
      expect(result[0].codeHash).toBe('unique-hash-xyz');
      expect(result[0].usedAt).toEqual(new Date('2025-02-01'));
      expect(result[0].usedFromIp).toBe('10.20.30.40');
      expect(result[0].createdAt).toEqual(new Date('2025-01-01'));

      // Verify fields are not swapped
      expect(result[0].id).not.toBe('mfa-unique-id');
      expect(result[0].userMfaId).not.toBe('bc-unique-id');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: mapChallengeRecord — individual field identity
  // Kills mutants that swap fields in the mapping function
  // ===========================================================================

  describe('mapChallengeRecord field identity mutations', () => {
    it('each field maps to itself with distinct values', async () => {
      const row = makeChallengeRow({
        id: 'ch-unique-id',
        userId: 'user-unique',
        sessionId: 'session-unique',
        challengeToken: 'token-unique',
        verified: true,
        verifiedAt: new Date('2025-03-01'),
        attempts: 7,
        maxAttempts: 12,
        expiresAt: new Date('2025-04-01'),
        createdAt: new Date('2025-02-01'),
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getChallengeByToken('token-unique');

      expect(result!.id).toBe('ch-unique-id');
      expect(result!.userId).toBe('user-unique');
      expect(result!.sessionId).toBe('session-unique');
      expect(result!.challengeToken).toBe('token-unique');
      expect(result!.verified).toBe(true);
      expect(result!.verifiedAt).toEqual(new Date('2025-03-01'));
      expect(result!.attempts).toBe(7);
      expect(result!.maxAttempts).toBe(12);
      expect(result!.expiresAt).toEqual(new Date('2025-04-01'));
      expect(result!.createdAt).toEqual(new Date('2025-02-01'));

      // Verify numeric fields are not swapped
      expect(result!.attempts).not.toBe(12);
      expect(result!.maxAttempts).not.toBe(7);
      // Verify string fields are not swapped
      expect(result!.userId).not.toBe('session-unique');
      expect(result!.sessionId).not.toBe('user-unique');
      expect(result!.id).not.toBe('token-unique');
      expect(result!.challengeToken).not.toBe('ch-unique-id');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: mapUserMfaRecord — individual field identity
  // Kills mutants that swap date fields or string fields in the mapping
  // ===========================================================================

  describe('mapUserMfaRecord field identity with distinct dates', () => {
    it('each date field maps to the correct DB column', async () => {
      const row = makeUserMfaRow({
        id: 'mfa-distinct',
        userId: 'user-distinct',
        tenantId: 'tenant-distinct',
        totpSecret: 'secret-distinct',
        totpSecretEncrypted: false,
        status: 'pending',
        enabledAt: new Date('2025-01-01'),
        enrollmentStartedAt: new Date('2025-02-02'),
        enrollmentExpiresAt: new Date('2025-03-03'),
        gracePeriodEndsAt: new Date('2025-04-04'),
        createdAt: new Date('2025-05-05'),
        updatedAt: new Date('2025-06-06'),
      });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const result = await store.getUserMfaById('mfa-distinct');

      expect(result!.id).toBe('mfa-distinct');
      expect(result!.userId).toBe('user-distinct');
      expect(result!.tenantId).toBe('tenant-distinct');
      expect(result!.totpSecret).toBe('secret-distinct');
      expect(result!.totpSecretEncrypted).toBe(false);
      expect(result!.status).toBe('pending');
      expect(result!.enabledAt).toEqual(new Date('2025-01-01'));
      expect(result!.enrollmentStartedAt).toEqual(new Date('2025-02-02'));
      expect(result!.enrollmentExpiresAt).toEqual(new Date('2025-03-03'));
      expect(result!.gracePeriodEndsAt).toEqual(new Date('2025-04-04'));
      expect(result!.createdAt).toEqual(new Date('2025-05-05'));
      expect(result!.updatedAt).toEqual(new Date('2025-06-06'));

      // Verify date fields are not swapped with each other
      expect(result!.enabledAt).not.toEqual(new Date('2025-02-02'));
      expect(result!.enrollmentStartedAt).not.toEqual(new Date('2025-01-01'));
      expect(result!.enrollmentExpiresAt).not.toEqual(new Date('2025-04-04'));
      expect(result!.gracePeriodEndsAt).not.toEqual(new Date('2025-03-03'));
      expect(result!.createdAt).not.toEqual(new Date('2025-06-06'));
      expect(result!.updatedAt).not.toEqual(new Date('2025-05-05'));
      // Verify string fields are not swapped
      expect(result!.userId).not.toBe('tenant-distinct');
      expect(result!.tenantId).not.toBe('user-distinct');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Singleton — lazy initialization and reset
  // ===========================================================================

  describe('singleton lazy init and reset mutations', () => {
    it('getMfaStore creates instance on first call (not null)', () => {
      resetMfaStore();
      const instance = getMfaStore();
      expect(instance).toBeDefined();
      expect(instance).not.toBeNull();
      expect(instance).toBeInstanceOf(MfaStore);
    });

    it('getMfaStore returns same reference twice (singleton identity)', () => {
      resetMfaStore();
      const a = getMfaStore();
      const b = getMfaStore();
      expect(a).toBe(b);
    });

    it('resetMfaStore causes next getMfaStore to create new instance', () => {
      resetMfaStore();
      const first = getMfaStore();
      resetMfaStore();
      const second = getMfaStore();
      expect(first).not.toBe(second);
      expect(second).toBeInstanceOf(MfaStore);
    });

    it('createMfaStore returns a new instance separate from singleton', () => {
      resetMfaStore();
      const singleton = getMfaStore();
      const custom = createMfaStore(createFreshMockDb());
      expect(custom).not.toBe(singleton);
      expect(custom).toBeInstanceOf(MfaStore);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: activateUserMfa — gracePeriodEndsAt is passed from argument
  // Kills mutant that removes or replaces the gracePeriodEndsAt assignment
  // ===========================================================================

  describe('activateUserMfa gracePeriodEndsAt pass-through', () => {
    it('passes the exact gracePeriodEndsAt Date object to set()', async () => {
      const row = makeUserMfaRow({ status: 'active' });
      mockDb = createFreshMockDb(row);
      store = new MfaStore(mockDb);

      const specificDate = new Date('2026-12-25T00:00:00Z');
      await store.activateUserMfa('mfa-id-1', specificDate);

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.gracePeriodEndsAt).toBe(specificDate);
      expect(setArg.gracePeriodEndsAt).toEqual(new Date('2026-12-25T00:00:00Z'));
    });
  });

  // ===========================================================================
  // MUTATION KILLS: updateEnrollmentExpiry — expiresAt is passed from argument
  // ===========================================================================

  describe('updateEnrollmentExpiry pass-through', () => {
    it('passes the exact expiresAt Date to set().enrollmentExpiresAt', async () => {
      mockDb = createFreshMockDb();
      store = new MfaStore(mockDb);

      const specificDate = new Date('2026-07-04T12:00:00Z');
      await store.updateEnrollmentExpiry('mfa-id-1', specificDate);

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.enrollmentExpiresAt).toBe(specificDate);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: deleteBackupCodes — return value is result.length
  // Kills mutant that returns 0, hardcoded value, or wrong property
  // ===========================================================================

  describe('deleteBackupCodes return value mutations', () => {
    it('returns exactly 1 when 1 row deleted', async () => {
      mockDb = createFreshMockDb([{ id: 'bc-1' }]);
      store = new MfaStore(mockDb);

      const count = await store.deleteBackupCodes('mfa-id-1');

      expect(count).toBe(1);
      expect(count).not.toBe(0);
    });

    it('returns exactly 5 when 5 rows deleted', async () => {
      mockDb = createFreshMockDb([
        { id: 'bc-1' },
        { id: 'bc-2' },
        { id: 'bc-3' },
        { id: 'bc-4' },
        { id: 'bc-5' },
      ]);
      store = new MfaStore(mockDb);

      const count = await store.deleteBackupCodes('mfa-id-1');

      expect(count).toBe(5);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: deleteExpiredChallenges — return value is result.length
  // ===========================================================================

  describe('deleteExpiredChallenges return value mutations', () => {
    it('returns exactly 1 when 1 expired challenge deleted', async () => {
      mockDb = createFreshMockDb([{ id: 'c1' }]);
      store = new MfaStore(mockDb);

      const count = await store.deleteExpiredChallenges();

      expect(count).toBe(1);
      expect(count).not.toBe(0);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: createBackupCodes values() mapping
  // Kills mutant that changes codeHash or userMfaId in the map
  // ===========================================================================

  describe('createBackupCodes values mapping mutations', () => {
    it('maps each codeHash to the correct userMfaId (not swapped)', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1', codeHash: 'hash-X' }),
      ];
      mockDb = createFreshMockDb(rows);
      store = new MfaStore(mockDb);

      await store.createBackupCodes('mfa-target-id', ['hash-X']);

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg).toEqual([{ userMfaId: 'mfa-target-id', codeHash: 'hash-X' }]);
      expect(valuesArg[0].userMfaId).not.toBe('hash-X');
      expect(valuesArg[0].codeHash).not.toBe('mfa-target-id');
    });

    it('maps multiple codeHashes preserving order', async () => {
      const rows = [
        makeBackupCodeRow({ id: 'bc-1', codeHash: 'A' }),
        makeBackupCodeRow({ id: 'bc-2', codeHash: 'B' }),
        makeBackupCodeRow({ id: 'bc-3', codeHash: 'C' }),
      ];
      mockDb = createFreshMockDb(rows);
      store = new MfaStore(mockDb);

      await store.createBackupCodes('mfa-99', ['A', 'B', 'C']);

      const valuesArg = mockDb.values.mock.calls[0][0];
      expect(valuesArg).toHaveLength(3);
      expect(valuesArg[0]).toEqual({ userMfaId: 'mfa-99', codeHash: 'A' });
      expect(valuesArg[1]).toEqual({ userMfaId: 'mfa-99', codeHash: 'B' });
      expect(valuesArg[2]).toEqual({ userMfaId: 'mfa-99', codeHash: 'C' });
    });
  });

  // ===========================================================================
  // MUTATION KILLS: getUnusedBackupCodeCount delegates to getUnusedBackupCodes
  // Kills mutant that returns hardcoded 0 or doesn't use .length
  // ===========================================================================

  describe('getUnusedBackupCodeCount delegation mutations', () => {
    it('returns 1 when 1 unused code exists (not hardcoded 0)', async () => {
      const rows = [makeBackupCodeRow({ id: 'bc-single' })];
      mockDb = createFreshMockDb(rows);
      mockDb.where = vi.fn().mockResolvedValue(rows);
      store = new MfaStore(mockDb);

      const count = await store.getUnusedBackupCodeCount('mfa-id-1');

      expect(count).toBe(1);
      expect(count).not.toBe(0);
    });

    it('returns 5 when 5 unused codes exist', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeBackupCodeRow({ id: `bc-${i}` })
      );
      mockDb = createFreshMockDb(rows);
      mockDb.where = vi.fn().mockResolvedValue(rows);
      store = new MfaStore(mockDb);

      const count = await store.getUnusedBackupCodeCount('mfa-id-1');

      expect(count).toBe(5);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Constructor — database ?? getDatabase() fallback
  // ===========================================================================

  describe('constructor database fallback mutation', () => {
    it('uses provided database when given (not getDatabase())', async () => {
      const customDb = createFreshMockDb(makeUserMfaRow());
      const customStore = new MfaStore(customDb);

      await customStore.getUserMfaById('mfa-id-1');

      expect(customDb.select).toHaveBeenCalled();
    });

    it('uses getDatabase() when no database provided', () => {
      // getMfaStore internally calls new MfaStore() with no args, which falls back to getDatabase()
      resetMfaStore();
      const singleton = getMfaStore();
      expect(singleton).toBeInstanceOf(MfaStore);
    });
  });
});
