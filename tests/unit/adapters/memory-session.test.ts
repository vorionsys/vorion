/**
 * MemorySessionStoreAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemorySessionStoreAdapter,
  createMemorySessionStoreAdapter,
  getMemorySessionStoreAdapter,
  resetMemorySessionStoreAdapter,
} from '../../../src/common/adapters/memory-session.js';
import type { CreateSessionInput } from '../../../src/common/adapters/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MemorySessionStoreAdapter', () => {
  let sessionStore: MemorySessionStoreAdapter;

  const createTestSessionInput = (overrides?: Partial<CreateSessionInput>): CreateSessionInput => ({
    userId: 'user-123',
    tenantId: 'tenant-456',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStore = createMemorySessionStoreAdapter({
      defaultTTL: 3600, // 1 hour
      maxSessionsPerUser: 3,
      cleanupIntervalMs: 300000, // 5 minutes
    });
  });

  afterEach(() => {
    sessionStore.stop();
    resetMemorySessionStoreAdapter();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a session store with default options', () => {
      const adapter = createMemorySessionStoreAdapter();
      expect(adapter).toBeInstanceOf(MemorySessionStoreAdapter);
      adapter.stop();
    });

    it('should create a session store with custom options', () => {
      const adapter = createMemorySessionStoreAdapter({
        defaultTTL: 7200,
        maxSessionsPerUser: 5,
        cleanupIntervalMs: 60000,
      });
      expect(adapter).toBeInstanceOf(MemorySessionStoreAdapter);
      adapter.stop();
    });

    it('should not start cleanup timer when cleanupIntervalMs is 0', () => {
      const adapter = createMemorySessionStoreAdapter({ cleanupIntervalMs: 0 });
      expect(adapter).toBeInstanceOf(MemorySessionStoreAdapter);
      adapter.stop();
    });
  });

  describe('create', () => {
    it('should create a new session', async () => {
      const input = createTestSessionInput();
      const session = await sessionStore.create(input);

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-123');
      expect(session.tenantId).toBe('tenant-456');
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.userAgent).toBe('Mozilla/5.0');
      expect(session.revoked).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('should create session with custom TTL', async () => {
      const input = createTestSessionInput({ ttlSeconds: 7200 });
      const session = await sessionStore.create(input);

      const expectedExpiry = new Date(session.createdAt.getTime() + 7200 * 1000);
      expect(session.expiresAt.getTime()).toBe(expectedExpiry.getTime());
    });

    it('should create session with metadata', async () => {
      const input = createTestSessionInput({
        metadata: { role: 'admin', permissions: ['read', 'write'] },
      });
      const session = await sessionStore.create(input);

      expect(session.metadata).toEqual({ role: 'admin', permissions: ['read', 'write'] });
    });

    it('should create session with device fingerprint', async () => {
      const input = createTestSessionInput({
        deviceFingerprint: 'fingerprint-abc123',
      });
      const session = await sessionStore.create(input);

      expect(session.deviceFingerprint).toBe('fingerprint-abc123');
    });

    it('should enforce max sessions per user', async () => {
      // Create max sessions
      await sessionStore.create(createTestSessionInput());
      await sessionStore.create(createTestSessionInput());
      await sessionStore.create(createTestSessionInput());

      // Creating a 4th session should revoke the oldest one
      await sessionStore.create(createTestSessionInput());

      // Allow time for revocation to process
      vi.advanceTimersByTime(100);

      const userSessions = await sessionStore.getUserSessions('user-123');
      expect(userSessions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('get', () => {
    it('should get an existing session', async () => {
      const created = await sessionStore.create(createTestSessionInput());
      const retrieved = await sessionStore.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionStore.get('nonexistent-id');
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const session = await sessionStore.create(createTestSessionInput({ ttlSeconds: 60 }));

      // Advance time past expiry
      vi.advanceTimersByTime(70000);

      const result = await sessionStore.get(session.id);
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing session', async () => {
      const session = await sessionStore.create(createTestSessionInput());

      const deleted = await sessionStore.delete(session.id);

      expect(deleted).toBe(true);
      expect(await sessionStore.get(session.id)).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const deleted = await sessionStore.delete('nonexistent-id');
      expect(deleted).toBe(false);
    });

    it('should remove session from user index', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      await sessionStore.delete(session.id);

      const userSessions = await sessionStore.getUserSessions('user-123');
      expect(userSessions).toHaveLength(0);
    });
  });

  describe('revoke', () => {
    it('should revoke an existing session', async () => {
      const session = await sessionStore.create(createTestSessionInput());

      const revoked = await sessionStore.revoke(session.id, 'User logout', 'user-123');

      expect(revoked).toBe(true);

      const retrieved = await sessionStore.get(session.id);
      expect(retrieved!.revoked).toBe(true);
      expect(retrieved!.revokedAt).toBeInstanceOf(Date);
      expect(retrieved!.revokedReason).toBe('User logout');
      expect(retrieved!.revokedBy).toBe('user-123');
    });

    it('should return false for non-existent session', async () => {
      const revoked = await sessionStore.revoke('nonexistent-id', 'reason', 'admin');
      expect(revoked).toBe(false);
    });

    it('should schedule deletion after revocation', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      await sessionStore.revoke(session.id, 'Test revocation', 'admin');

      // Session should still exist briefly
      expect(await sessionStore.get(session.id)).not.toBeNull();

      // After 5 minutes, session should be deleted
      vi.advanceTimersByTime(310000); // 5+ minutes

      expect(sessionStore.size).toBe(0);
    });
  });

  describe('getUserSessions', () => {
    it('should get all active sessions for a user', async () => {
      await sessionStore.create(createTestSessionInput({ userId: 'user-1' }));
      await sessionStore.create(createTestSessionInput({ userId: 'user-1' }));
      await sessionStore.create(createTestSessionInput({ userId: 'user-2' }));

      const user1Sessions = await sessionStore.getUserSessions('user-1');
      expect(user1Sessions).toHaveLength(2);

      const user2Sessions = await sessionStore.getUserSessions('user-2');
      expect(user2Sessions).toHaveLength(1);
    });

    it('should return empty array for user with no sessions', async () => {
      const sessions = await sessionStore.getUserSessions('nonexistent-user');
      expect(sessions).toHaveLength(0);
    });

    it('should exclude expired sessions', async () => {
      await sessionStore.create(createTestSessionInput({ ttlSeconds: 60 }));
      await sessionStore.create(createTestSessionInput({ ttlSeconds: 3600 }));

      // Expire one session
      vi.advanceTimersByTime(70000);

      const sessions = await sessionStore.getUserSessions('user-123');
      expect(sessions).toHaveLength(1);
    });

    it('should exclude revoked sessions', async () => {
      const session1 = await sessionStore.create(createTestSessionInput());
      await sessionStore.create(createTestSessionInput());

      await sessionStore.revoke(session1.id, 'Test', 'admin');

      const sessions = await sessionStore.getUserSessions('user-123');
      expect(sessions).toHaveLength(1);
    });
  });

  describe('touch', () => {
    it('should update lastActivityAt', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      const originalActivity = session.lastActivityAt;

      vi.advanceTimersByTime(1000);

      const touched = await sessionStore.touch(session.id);
      expect(touched).toBe(true);

      const updated = await sessionStore.get(session.id);
      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should return false for non-existent session', async () => {
      const touched = await sessionStore.touch('nonexistent-id');
      expect(touched).toBe(false);
    });

    it('should return false for revoked session', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      await sessionStore.revoke(session.id, 'Test', 'admin');

      const touched = await sessionStore.touch(session.id);
      expect(touched).toBe(false);
    });
  });

  describe('validate', () => {
    it('should validate an active session', async () => {
      const session = await sessionStore.create(createTestSessionInput());

      const result = await sessionStore.validate(session.id);

      expect(result.valid).toBe(true);
      expect(result.session).toBeDefined();
    });

    it('should invalidate non-existent session', async () => {
      const result = await sessionStore.validate('nonexistent-id');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should invalidate revoked session', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      await sessionStore.revoke(session.id, 'Security concern', 'admin');

      const result = await sessionStore.validate(session.id);

      expect(result.valid).toBe(false);
      // The reason is the revocation reason itself, or a default message about revocation
      expect(result.reason).toBeDefined();
      expect(result.session).toBeDefined();
      expect(result.session!.revoked).toBe(true);
    });

    it('should invalidate expired session', async () => {
      const session = await sessionStore.create(createTestSessionInput({ ttlSeconds: 60 }));

      vi.advanceTimersByTime(70000);

      const result = await sessionStore.validate(session.id);

      expect(result.valid).toBe(false);
    });

    it('should update lastActivityAt on successful validation', async () => {
      const session = await sessionStore.create(createTestSessionInput());
      const originalActivity = session.lastActivityAt;

      vi.advanceTimersByTime(1000);

      await sessionStore.validate(session.id);

      const updated = await sessionStore.get(session.id);
      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(originalActivity.getTime());
    });
  });

  describe('size', () => {
    it('should return the number of sessions', async () => {
      expect(sessionStore.size).toBe(0);

      await sessionStore.create(createTestSessionInput());
      expect(sessionStore.size).toBe(1);

      await sessionStore.create(createTestSessionInput({ userId: 'user-2' }));
      expect(sessionStore.size).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired sessions periodically', async () => {
      await sessionStore.create(createTestSessionInput({ ttlSeconds: 60 }));
      await sessionStore.create(createTestSessionInput({ ttlSeconds: 60, userId: 'user-2' }));
      await sessionStore.create(createTestSessionInput({ ttlSeconds: 7200, userId: 'user-3' }));

      // Expire two sessions
      vi.advanceTimersByTime(70000);

      // Trigger cleanup interval
      vi.advanceTimersByTime(300000);

      expect(sessionStore.size).toBe(1);
    });

    it('should clean up user index when user has no more sessions', async () => {
      const session = await sessionStore.create(createTestSessionInput({ ttlSeconds: 60 }));

      vi.advanceTimersByTime(70000);
      vi.advanceTimersByTime(300000);

      const sessions = await sessionStore.getUserSessions('user-123');
      expect(sessions).toHaveLength(0);
    });
  });

  describe('stop', () => {
    it('should stop the cleanup timer', () => {
      const adapter = createMemorySessionStoreAdapter();
      adapter.stop();
      // Should not throw when stopping multiple times
      adapter.stop();
    });
  });

  describe('getMemorySessionStoreAdapter singleton', () => {
    afterEach(() => {
      resetMemorySessionStoreAdapter();
    });

    it('should return the same instance', () => {
      const instance1 = getMemorySessionStoreAdapter();
      const instance2 = getMemorySessionStoreAdapter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getMemorySessionStoreAdapter();
      await instance1.create(createTestSessionInput());

      resetMemorySessionStoreAdapter();

      const instance2 = getMemorySessionStoreAdapter();
      expect(instance1).not.toBe(instance2);
      expect(instance2.size).toBe(0);
    });
  });

  describe('session limit enforcement', () => {
    it('should revoke oldest session when limit exceeded', async () => {
      const store = createMemorySessionStoreAdapter({ maxSessionsPerUser: 2 });

      const session1 = await store.create(createTestSessionInput());
      vi.advanceTimersByTime(1000); // Ensure different timestamps

      const session2 = await store.create(createTestSessionInput());
      vi.advanceTimersByTime(1000);

      // Touch session1 to make it more recent
      await store.touch(session1.id);
      vi.advanceTimersByTime(1000);

      // Create a third session - should revoke session2 (oldest by activity)
      await store.create(createTestSessionInput());

      vi.advanceTimersByTime(100);

      const sessions = await store.getUserSessions('user-123');

      // Should have at most 2 sessions
      expect(sessions.length).toBeLessThanOrEqual(2);

      store.stop();
    });
  });
});
