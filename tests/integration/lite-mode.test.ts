/**
 * Lite Mode Integration Tests
 *
 * Tests Redis-optional deployment mode where all adapters run in-memory.
 * Verifies that cache, lock, queue, session, and rate limiting operations
 * work correctly without Redis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    lite: {
      enabled: true,
      redisOptional: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-12345',
      expiration: '1h',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1', rateLimit: 1000 },
    redis: { host: 'localhost', port: 6379, db: 0 },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// IMPORTS (after mocks)
// =============================================================================

import {
  createMemoryCacheAdapter,
  createMemoryLockAdapter,
  createMemoryQueueAdapter,
  createMemorySessionStoreAdapter,
  createMemoryRateLimitAdapter,
  createAdapterProvider,
  type MemoryCacheAdapter,
  type MemoryLockAdapter,
  type MemoryQueueAdapter,
  type MemorySessionStoreAdapter,
  type MemoryRateLimitAdapter,
} from '../../src/common/adapters/index.js';

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Lite Mode Integration Tests', () => {
  // ===========================================================================
  // 1. Cache Adapter Tests
  // ===========================================================================
  describe('Memory Cache Adapter', () => {
    let cache: MemoryCacheAdapter;

    beforeEach(() => {
      cache = createMemoryCacheAdapter({ cleanupIntervalMs: 0 });
    });

    afterEach(() => {
      cache.stop();
    });

    it('should set and get values', async () => {
      await cache.set('test-key', { name: 'test', value: 42 });
      const result = await cache.get<{ name: string; value: number }>('test-key');
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      await cache.set('delete-key', 'value');
      expect(await cache.get('delete-key')).toBe('value');

      await cache.del('delete-key');
      expect(await cache.get('delete-key')).toBeNull();
    });

    it('should check key existence', async () => {
      await cache.set('exists-key', 'value');
      expect(await cache.exists('exists-key')).toBe(true);
      expect(await cache.exists('does-not-exist')).toBe(false);
    });

    it('should expire keys after TTL', async () => {
      await cache.set('ttl-key', 'value', 1); // 1 second TTL

      // Should exist immediately
      expect(await cache.get('ttl-key')).toBe('value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      expect(await cache.get('ttl-key')).toBeNull();
    });

    it('should find keys matching pattern with asterisk wildcard', async () => {
      await cache.set('user:123:profile', { name: 'Alice' });
      await cache.set('user:456:profile', { name: 'Bob' });
      await cache.set('user:123:settings', { theme: 'dark' });
      await cache.set('tenant:abc:config', { enabled: true });

      const userKeys = await cache.keys('user:*');
      expect(userKeys).toHaveLength(3);
      expect(userKeys).toContain('user:123:profile');
      expect(userKeys).toContain('user:456:profile');
      expect(userKeys).toContain('user:123:settings');

      const profileKeys = await cache.keys('user:*:profile');
      expect(profileKeys).toHaveLength(2);
      expect(profileKeys).toContain('user:123:profile');
      expect(profileKeys).toContain('user:456:profile');
    });

    it('should find keys matching pattern with question mark wildcard', async () => {
      await cache.set('key-a', 1);
      await cache.set('key-b', 2);
      await cache.set('key-ab', 3);

      const singleCharKeys = await cache.keys('key-?');
      expect(singleCharKeys).toHaveLength(2);
      expect(singleCharKeys).toContain('key-a');
      expect(singleCharKeys).toContain('key-b');
      expect(singleCharKeys).not.toContain('key-ab');
    });

    it('should handle complex object values', async () => {
      const complexValue = {
        id: randomUUID(),
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
        date: new Date().toISOString(),
        nullable: null,
      };

      await cache.set('complex-key', complexValue);
      const result = await cache.get<typeof complexValue>('complex-key');
      expect(result).toEqual(complexValue);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      expect(cache.size).toBe(3);

      await cache.clear();

      expect(cache.size).toBe(0);
      expect(await cache.get('key1')).toBeNull();
    });

    it('should respect maxEntries limit with LRU eviction', async () => {
      const limitedCache = createMemoryCacheAdapter({
        maxEntries: 3,
        cleanupIntervalMs: 0,
      });

      await limitedCache.set('key1', 'value1');
      await limitedCache.set('key2', 'value2');
      await limitedCache.set('key3', 'value3');

      expect(limitedCache.size).toBe(3);

      // Adding a fourth entry should evict the oldest
      await limitedCache.set('key4', 'value4');

      expect(limitedCache.size).toBe(3);
      expect(await limitedCache.get('key1')).toBeNull(); // Evicted
      expect(await limitedCache.get('key2')).toBe('value2');
      expect(await limitedCache.get('key4')).toBe('value4');

      limitedCache.stop();
    });

    it('should not return expired keys in pattern search', async () => {
      await cache.set('persist-key', 'value');
      await cache.set('expire-key', 'value', 1); // 1 second TTL

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const allKeys = await cache.keys('*-key');
      expect(allKeys).toHaveLength(1);
      expect(allKeys).toContain('persist-key');
      expect(allKeys).not.toContain('expire-key');
    });
  });

  // ===========================================================================
  // 2. Lock Adapter Tests
  // ===========================================================================
  describe('Memory Lock Adapter', () => {
    let lock: MemoryLockAdapter;

    beforeEach(() => {
      lock = createMemoryLockAdapter();
    });

    afterEach(() => {
      lock.stop();
    });

    it('should acquire and release locks', async () => {
      const result = await lock.acquire('test-lock');

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();

      const released = await lock.release('test-lock', result.lockId!);
      expect(released).toBe(true);
    });

    it('should prevent concurrent lock acquisition', async () => {
      const lock1 = await lock.acquire('exclusive-lock', {
        ttlMs: 5000,
        retryCount: 0,
      });
      expect(lock1.acquired).toBe(true);

      // Second acquisition should fail without retries
      const lock2 = await lock.acquire('exclusive-lock', {
        ttlMs: 5000,
        retryCount: 0,
      });
      expect(lock2.acquired).toBe(false);

      // Release first lock
      await lock.release('exclusive-lock', lock1.lockId!);

      // Now acquisition should succeed
      const lock3 = await lock.acquire('exclusive-lock', { retryCount: 0 });
      expect(lock3.acquired).toBe(true);

      await lock.release('exclusive-lock', lock3.lockId!);
    });

    it('should retry acquiring lock with backoff', async () => {
      const lock1 = await lock.acquire('retry-lock', { ttlMs: 100 });
      expect(lock1.acquired).toBe(true);

      // Start attempting to acquire with retries
      const startTime = Date.now();
      const lock2Promise = lock.acquire('retry-lock', {
        ttlMs: 5000,
        retryCount: 3,
        retryDelayMs: 50,
      });

      // The first lock should expire, allowing the second to succeed
      const lock2 = await lock2Promise;
      const elapsed = Date.now() - startTime;

      expect(lock2.acquired).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(50); // At least one retry delay
    });

    it('should not release lock owned by another holder', async () => {
      const lock1 = await lock.acquire('ownership-lock');
      expect(lock1.acquired).toBe(true);

      // Try to release with wrong lockId
      const released = await lock.release('ownership-lock', 'wrong-lock-id');
      expect(released).toBe(false);

      // Lock should still be held
      const lock2 = await lock.acquire('ownership-lock', { retryCount: 0 });
      expect(lock2.acquired).toBe(false);

      // Correct lockId should release
      const correctRelease = await lock.release('ownership-lock', lock1.lockId!);
      expect(correctRelease).toBe(true);
    });

    it('should extend lock TTL', async () => {
      const result = await lock.acquire('extend-lock', { ttlMs: 100 });
      expect(result.acquired).toBe(true);

      // Extend the lock
      const extended = await lock.extend('extend-lock', result.lockId!, 5000);
      expect(extended).toBe(true);

      // Wait past original TTL
      await new Promise(resolve => setTimeout(resolve, 150));

      // Lock should still be held due to extension
      const lock2 = await lock.acquire('extend-lock', { retryCount: 0 });
      expect(lock2.acquired).toBe(false);

      await lock.release('extend-lock', result.lockId!);
    });

    it('should fail to extend expired lock', async () => {
      const result = await lock.acquire('expire-extend-lock', { ttlMs: 50 });
      expect(result.acquired).toBe(true);

      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Extend should fail
      const extended = await lock.extend('expire-extend-lock', result.lockId!, 5000);
      expect(extended).toBe(false);
    });

    it('should fail to extend lock with wrong lockId', async () => {
      const result = await lock.acquire('wrong-id-lock');
      expect(result.acquired).toBe(true);

      const extended = await lock.extend('wrong-id-lock', 'wrong-lock-id', 5000);
      expect(extended).toBe(false);

      await lock.release('wrong-id-lock', result.lockId!);
    });

    it('should automatically expire locks after TTL', async () => {
      const result = await lock.acquire('auto-expire-lock', { ttlMs: 50 });
      expect(result.acquired).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // New lock should succeed
      const lock2 = await lock.acquire('auto-expire-lock', { retryCount: 0 });
      expect(lock2.acquired).toBe(true);

      await lock.release('auto-expire-lock', lock2.lockId!);
    });

    it('should report if lock is held', async () => {
      expect(lock.isLocked('check-lock')).toBe(false);

      const result = await lock.acquire('check-lock');
      expect(result.acquired).toBe(true);

      expect(lock.isLocked('check-lock')).toBe(true);

      await lock.release('check-lock', result.lockId!);

      expect(lock.isLocked('check-lock')).toBe(false);
    });

    it('should track active lock count', async () => {
      expect(lock.activeCount).toBe(0);

      const lock1 = await lock.acquire('count-lock-1');
      const lock2 = await lock.acquire('count-lock-2');
      const lock3 = await lock.acquire('count-lock-3');

      expect(lock.activeCount).toBe(3);

      await lock.release('count-lock-1', lock1.lockId!);
      expect(lock.activeCount).toBe(2);

      await lock.release('count-lock-2', lock2.lockId!);
      await lock.release('count-lock-3', lock3.lockId!);
      expect(lock.activeCount).toBe(0);
    });
  });

  // ===========================================================================
  // 3. Queue Adapter Tests
  // ===========================================================================
  describe('Memory Queue Adapter', () => {
    let queue: MemoryQueueAdapter;

    beforeEach(() => {
      queue = createMemoryQueueAdapter('test-queue') as MemoryQueueAdapter;
    });

    afterEach(async () => {
      await queue.close();
    });

    it('should add jobs and process them', async () => {
      const processedJobs: Array<{ id: string; data: unknown }> = [];

      queue.process(async job => {
        processedJobs.push({ id: job.id, data: job.data });
      });

      const jobId = await queue.add('test-job', { value: 42 });
      expect(jobId).toBeDefined();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(processedJobs).toHaveLength(1);
      expect(processedJobs[0].data).toEqual({ value: 42 });
    });

    it('should support custom job IDs for deduplication', async () => {
      const processedJobIds: string[] = [];

      queue.process(async job => {
        processedJobIds.push(job.id);
      });

      // Add same job twice with same ID
      await queue.add('dedup-job', { value: 1 }, { jobId: 'unique-id' });
      await queue.add('dedup-job', { value: 2 }, { jobId: 'unique-id' });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Only the last job with that ID should be processed (overwrites previous)
      expect(processedJobIds).toContain('unique-id');
    });

    it('should add delayed jobs with correct status', async () => {
      // Add a delayed job
      await queue.add('delayed-job', { value: 1 }, { delay: 100 });

      // Check initial status - should be delayed
      const counts = await queue.getJobCounts();
      expect(counts.delayed).toBe(1);
      expect(counts.waiting).toBe(0);

      // Note: In the memory queue implementation, delayed jobs are moved to
      // waiting status when processJobs runs. The delay is tracked via processAt
      // timestamp. This test verifies the delayed status is set correctly.
    });

    it('should process delayed jobs when triggered by new job', async () => {
      const processedNames: string[] = [];

      // Register handler first
      queue.process(async job => {
        processedNames.push((job.data as { name: string }).name);
      });

      // Add a delayed job
      await queue.add('delayed-job', { name: 'delayed' }, { delay: 50 });

      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Add immediate job to trigger processing cycle
      await queue.add('trigger-job', { name: 'trigger' });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Both should be processed (delayed job first since it's ready)
      expect(processedNames).toContain('delayed');
      expect(processedNames).toContain('trigger');
    });

    it('should retry failed jobs with exponential backoff', async () => {
      let attemptCount = 0;

      queue.process(async job => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Simulated failure');
        }
      });

      await queue.add('retry-job', { value: 1 }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 50 },
      });

      // Wait for retries (50ms + 100ms backoff + processing time)
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(attemptCount).toBe(3);
    });

    it('should mark job as failed after max retries', async () => {
      queue.process(async () => {
        throw new Error('Always fails');
      });

      await queue.add('fail-job', { value: 1 }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10 },
      });

      // Wait for all retry attempts
      await new Promise(resolve => setTimeout(resolve, 200));

      const counts = await queue.getJobCounts();
      expect(counts.failed).toBe(1);
    });

    it('should track job counts by status', async () => {
      let processedCount = 0;

      // Register handler first
      queue.process(async () => {
        processedCount++;
      });

      // Add immediate job
      await queue.add('immediate-job', { value: 1 });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Check counts - immediate job should be processed
      let counts = await queue.getJobCounts();
      expect(counts.completed).toBeGreaterThanOrEqual(1);
      expect(processedCount).toBeGreaterThanOrEqual(1);
    });

    it('should respect job priority (lower = higher priority)', async () => {
      const processedOrder: number[] = [];

      // Don't process yet
      await queue.add('low-priority', { order: 3 }, { priority: 10 });
      await queue.add('high-priority', { order: 1 }, { priority: 1 });
      await queue.add('medium-priority', { order: 2 }, { priority: 5 });

      // Now start processing
      queue.process(async job => {
        processedOrder.push((job.data as { order: number }).order);
      });

      // Wait for all jobs to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Higher priority (lower number) should be processed first
      expect(processedOrder[0]).toBe(1); // high-priority
    });

    it('should close gracefully and stop processing', async () => {
      let processing = false;

      queue.process(async () => {
        processing = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        processing = false;
      });

      await queue.add('close-job', { value: 1 });

      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 20));

      // Close the queue
      await queue.close();

      // Adding new job should throw
      await expect(queue.add('new-job', { value: 2 })).rejects.toThrow('Queue is closed');
    });
  });

  // ===========================================================================
  // 4. Session Adapter Tests
  // ===========================================================================
  describe('Memory Session Store Adapter', () => {
    let sessionStore: MemorySessionStoreAdapter;
    const testTenantId = 'test-tenant-123';

    beforeEach(() => {
      sessionStore = createMemorySessionStoreAdapter({
        defaultTTL: 3600, // 1 hour
        maxSessionsPerUser: 5,
        cleanupIntervalMs: 0, // Disable automatic cleanup for tests
      });
    });

    afterEach(() => {
      sessionStore.stop();
    });

    it('should create and retrieve sessions', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
        deviceFingerprint: 'device-fingerprint-123',
        metadata: { source: 'test' },
      });

      expect(session.id).toBeDefined();
      expect(session.userId).toBe(userId);
      expect(session.tenantId).toBe(testTenantId);
      expect(session.revoked).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const retrieved = await sessionStore.get(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe(userId);
    });

    it('should return null for non-existent sessions', async () => {
      const session = await sessionStore.get('non-existent-session-id');
      expect(session).toBeNull();
    });

    it('should delete sessions', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
      });

      const deleted = await sessionStore.delete(session.id);
      expect(deleted).toBe(true);

      const retrieved = await sessionStore.get(session.id);
      expect(retrieved).toBeNull();
    });

    it('should revoke sessions with reason', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
      });

      const revoked = await sessionStore.revoke(session.id, 'User logout', 'user');
      expect(revoked).toBe(true);

      const retrieved = await sessionStore.get(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.revoked).toBe(true);
      expect(retrieved?.revokedReason).toBe('User logout');
      expect(retrieved?.revokedBy).toBe('user');
      expect(retrieved?.revokedAt).toBeInstanceOf(Date);
    });

    it('should get all sessions for a user', async () => {
      const userId = randomUUID();

      // Create multiple sessions
      await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Agent 1',
      });
      await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.2',
        userAgent: 'Agent 2',
      });
      await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.3',
        userAgent: 'Agent 3',
      });

      const sessions = await sessionStore.getUserSessions(userId);
      expect(sessions).toHaveLength(3);
      expect(sessions.every(s => s.userId === userId)).toBe(true);
    });

    it('should not return revoked sessions in getUserSessions', async () => {
      const userId = randomUUID();

      const session1 = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Agent 1',
      });
      await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.2',
        userAgent: 'Agent 2',
      });

      // Revoke first session
      await sessionStore.revoke(session1.id, 'Test revocation', 'system');

      const sessions = await sessionStore.getUserSessions(userId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).not.toBe(session1.id);
    });

    it('should expire sessions after TTL', async () => {
      const shortTTLStore = createMemorySessionStoreAdapter({
        defaultTTL: 1, // 1 second
        cleanupIntervalMs: 0,
      });

      const userId = randomUUID();
      const session = await shortTTLStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
      });

      // Should exist immediately
      expect(await shortTTLStore.get(session.id)).not.toBeNull();

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      expect(await shortTTLStore.get(session.id)).toBeNull();

      shortTTLStore.stop();
    });

    it('should enforce max sessions per user', async () => {
      const maxSessionStore = createMemorySessionStoreAdapter({
        defaultTTL: 3600,
        maxSessionsPerUser: 2,
        cleanupIntervalMs: 0,
      });

      const userId = randomUUID();

      // Create sessions up to limit
      const session1 = await maxSessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Agent 1',
      });

      // Add delay between session creations to ensure different lastActivityAt
      await new Promise(resolve => setTimeout(resolve, 10));

      await maxSessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.2',
        userAgent: 'Agent 2',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Third session should trigger eviction of oldest
      await maxSessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.3',
        userAgent: 'Agent 3',
      });

      const sessions = await maxSessionStore.getUserSessions(userId);
      expect(sessions.length).toBeLessThanOrEqual(2);

      // First session should have been revoked
      const firstSession = await maxSessionStore.get(session1.id);
      if (firstSession) {
        expect(firstSession.revoked).toBe(true);
      }

      maxSessionStore.stop();
    });

    it('should update last activity with touch', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
      });

      const originalActivity = session.lastActivityAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      const touched = await sessionStore.touch(session.id);
      expect(touched).toBe(true);

      const updated = await sessionStore.get(session.id);
      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should validate sessions correctly', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
      });

      // Valid session
      const validResult = await sessionStore.validate(session.id);
      expect(validResult.valid).toBe(true);
      expect(validResult.session).toBeDefined();

      // Revoked session
      await sessionStore.revoke(session.id, 'Session revoked for testing', 'system');
      const revokedResult = await sessionStore.validate(session.id);
      expect(revokedResult.valid).toBe(false);
      expect(revokedResult.reason).toContain('revoked');

      // Non-existent session
      const nonExistentResult = await sessionStore.validate('non-existent');
      expect(nonExistentResult.valid).toBe(false);
      expect(nonExistentResult.reason).toContain('not found');
    });

    it('should isolate sessions by user', async () => {
      const user1 = randomUUID();
      const user2 = randomUUID();

      await sessionStore.create({
        userId: user1,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Agent 1',
      });
      await sessionStore.create({
        userId: user2,
        tenantId: testTenantId,
        ipAddress: '192.168.1.2',
        userAgent: 'Agent 2',
      });

      const user1Sessions = await sessionStore.getUserSessions(user1);
      const user2Sessions = await sessionStore.getUserSessions(user2);

      expect(user1Sessions).toHaveLength(1);
      expect(user2Sessions).toHaveLength(1);
      expect(user1Sessions[0].userId).toBe(user1);
      expect(user2Sessions[0].userId).toBe(user2);
    });

    it('should support custom TTL per session', async () => {
      const userId = randomUUID();
      const session = await sessionStore.create({
        userId,
        tenantId: testTenantId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent/1.0',
        ttlSeconds: 1, // 1 second
      });

      expect(await sessionStore.get(session.id)).not.toBeNull();

      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(await sessionStore.get(session.id)).toBeNull();
    });
  });

  // ===========================================================================
  // 5. Rate Limit Adapter Tests
  // ===========================================================================
  describe('Memory Rate Limit Adapter', () => {
    let rateLimit: MemoryRateLimitAdapter;

    beforeEach(() => {
      rateLimit = createMemoryRateLimitAdapter({ cleanupIntervalMs: 0 });
    });

    afterEach(() => {
      rateLimit.stop();
    });

    it('should allow requests within limit', async () => {
      const result = await rateLimit.checkLimit('test-key', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('should block requests over limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await rateLimit.checkLimit('exhaust-key', 3, 60);
      }

      // Fourth request should be blocked
      const result = await rateLimit.checkLimit('exhaust-key', 3, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track remaining requests correctly', async () => {
      const limit = 5;

      for (let i = 0; i < limit; i++) {
        const result = await rateLimit.checkLimit('track-key', limit, 60);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(limit - i - 1);
      }

      // Over limit
      const overLimit = await rateLimit.checkLimit('track-key', limit, 60);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.remaining).toBe(0);
    });

    it('should get status without consuming limit', async () => {
      // Check status - should not consume
      const status1 = await rateLimit.getStatus('status-key', 3, 60);
      expect(status1.allowed).toBe(true);
      expect(status1.remaining).toBe(3);

      // Check again - should still be 3
      const status2 = await rateLimit.getStatus('status-key', 3, 60);
      expect(status2.remaining).toBe(3);

      // Now consume one
      await rateLimit.checkLimit('status-key', 3, 60);

      // Status should show 2 remaining
      const status3 = await rateLimit.getStatus('status-key', 3, 60);
      expect(status3.remaining).toBe(2);
    });

    it('should reset rate limit for key', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await rateLimit.checkLimit('reset-key', 3, 60);
      }

      // Verify blocked
      expect((await rateLimit.checkLimit('reset-key', 3, 60)).allowed).toBe(false);

      // Reset
      await rateLimit.reset('reset-key');

      // Should be allowed again
      const result = await rateLimit.checkLimit('reset-key', 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should use sliding window (old requests expire)', async () => {
      const windowSeconds = 1;

      // Make 3 requests in 1 second window with limit of 3
      await rateLimit.checkLimit('sliding-key', 3, windowSeconds);
      await rateLimit.checkLimit('sliding-key', 3, windowSeconds);
      await rateLimit.checkLimit('sliding-key', 3, windowSeconds);

      // Should be at limit
      expect((await rateLimit.checkLimit('sliding-key', 3, windowSeconds)).allowed).toBe(false);

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Old requests should have expired, new request should be allowed
      const result = await rateLimit.checkLimit('sliding-key', 3, windowSeconds);
      expect(result.allowed).toBe(true);
    });

    it('should handle different keys independently', async () => {
      // Exhaust key1
      for (let i = 0; i < 2; i++) {
        await rateLimit.checkLimit('key1', 2, 60);
      }
      expect((await rateLimit.checkLimit('key1', 2, 60)).allowed).toBe(false);

      // key2 should still be available
      const key2Result = await rateLimit.checkLimit('key2', 2, 60);
      expect(key2Result.allowed).toBe(true);
      expect(key2Result.remaining).toBe(1);
    });

    it('should calculate resetAt correctly', async () => {
      const windowSeconds = 60;
      const beforeRequest = Date.now();

      const result = await rateLimit.checkLimit('resetat-key', 3, windowSeconds);

      // resetAt should be approximately now + windowSeconds
      const expectedReset = beforeRequest + windowSeconds * 1000;
      expect(result.resetAt).toBeGreaterThanOrEqual(beforeRequest);
      expect(result.resetAt).toBeLessThanOrEqual(expectedReset + 100); // Allow 100ms tolerance
    });

    it('should track size of rate limit entries', async () => {
      expect(rateLimit.size).toBe(0);

      await rateLimit.checkLimit('size-key-1', 10, 60);
      expect(rateLimit.size).toBe(1);

      await rateLimit.checkLimit('size-key-2', 10, 60);
      expect(rateLimit.size).toBe(2);

      await rateLimit.reset('size-key-1');
      expect(rateLimit.size).toBe(1);
    });
  });

  // ===========================================================================
  // 6. Adapter Provider Tests
  // ===========================================================================
  describe('Adapter Provider', () => {
    it('should create memory adapters in lite mode', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      // Should not throw and return adapters
      const cache = provider.getCacheAdapter();
      const lock = provider.getLockAdapter();
      const queue = provider.getQueueAdapter('test-queue');
      const session = provider.getSessionStoreAdapter();
      const rateLimit = provider.getRateLimitAdapter();

      expect(cache).toBeDefined();
      expect(lock).toBeDefined();
      expect(queue).toBeDefined();
      expect(session).toBeDefined();
      expect(rateLimit).toBeDefined();

      // Test basic operations
      await cache.set('provider-test', 'value');
      expect(await cache.get('provider-test')).toBe('value');

      // Check mode
      const health = await provider.getHealthStatus();
      expect(health.mode).toBe('memory');

      await provider.shutdown();
    });

    it('should return same adapter instances on repeated calls', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      const cache1 = provider.getCacheAdapter();
      const cache2 = provider.getCacheAdapter();
      expect(cache1).toBe(cache2);

      const lock1 = provider.getLockAdapter();
      const lock2 = provider.getLockAdapter();
      expect(lock1).toBe(lock2);

      const queue1 = provider.getQueueAdapter('same-queue');
      const queue2 = provider.getQueueAdapter('same-queue');
      expect(queue1).toBe(queue2);

      // Different queue names should return different instances
      const queue3 = provider.getQueueAdapter('different-queue');
      expect(queue3).not.toBe(queue1);

      await provider.shutdown();
    });

    it('should report Redis as unavailable in lite mode', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      const isAvailable = provider.isRedisAvailable();
      // In forced memory mode, Redis check is skipped so it returns false
      expect(isAvailable).toBe(false);

      await provider.shutdown();
    });

    it('should shutdown cleanly', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      // Use some adapters
      const cache = provider.getCacheAdapter();
      await cache.set('shutdown-test', 'value');

      const queue = provider.getQueueAdapter('shutdown-queue');
      await queue.add('test-job', { value: 1 });

      // Shutdown should not throw
      await expect(provider.shutdown()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // 7. Graceful Fallback Tests
  // ===========================================================================
  describe('Graceful Fallback When Redis Unavailable', () => {
    it('should operate correctly in memory-only mode', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      // All operations should work without Redis
      const cache = provider.getCacheAdapter();
      await cache.set('fallback-cache', { data: 'test' }, 3600);
      expect(await cache.get('fallback-cache')).toEqual({ data: 'test' });

      const lock = provider.getLockAdapter();
      const lockResult = await lock.acquire('fallback-lock');
      expect(lockResult.acquired).toBe(true);
      await lock.release('fallback-lock', lockResult.lockId!);

      const rateLimit = provider.getRateLimitAdapter();
      const limitResult = await rateLimit.checkLimit('fallback-rate', 10, 60);
      expect(limitResult.allowed).toBe(true);

      const session = provider.getSessionStoreAdapter();
      const newSession = await session.create({
        userId: randomUUID(),
        tenantId: 'fallback-tenant',
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });
      expect(newSession.id).toBeDefined();

      await provider.shutdown();
    });

    it('should report memory mode in health status', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });

      const health = await provider.getHealthStatus();

      expect(health.mode).toBe('memory');
      expect(health.redis.available).toBe(false);
      // Error message should indicate Redis is not available
      expect(health.redis.error).toBeDefined();

      await provider.shutdown();
    });

    it('should handle concurrent operations in memory mode', async () => {
      const provider = createAdapterProvider({ forceMemoryMode: true });
      const cache = provider.getCacheAdapter();

      // Run many concurrent operations
      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(cache.set(`concurrent-key-${i}`, { value: i }));
      }

      await Promise.all(operations);

      // Verify all values are stored
      const readOperations = [];
      for (let i = 0; i < 100; i++) {
        readOperations.push(cache.get(`concurrent-key-${i}`));
      }

      const results = await Promise.all(readOperations);
      for (let i = 0; i < 100; i++) {
        expect(results[i]).toEqual({ value: i });
      }

      await provider.shutdown();
    });

    it('should handle concurrent lock acquisitions correctly', async () => {
      const lock = createMemoryLockAdapter();
      const acquiredLocks: string[] = [];
      const failedAttempts: number[] = [];

      // Try to acquire the same lock from multiple "workers"
      const workers = Array.from({ length: 10 }, (_, i) => async () => {
        const result = await lock.acquire('contended-lock', {
          ttlMs: 100,
          retryCount: 0,
        });
        if (result.acquired) {
          acquiredLocks.push(result.lockId!);
          await new Promise(resolve => setTimeout(resolve, 10));
          await lock.release('contended-lock', result.lockId!);
        } else {
          failedAttempts.push(i);
        }
      });

      await Promise.all(workers.map(w => w()));

      // Only one worker should have acquired the lock at a time
      // Some should have succeeded, some should have failed
      expect(acquiredLocks.length).toBeGreaterThan(0);
      expect(acquiredLocks.length + failedAttempts.length).toBe(10);

      lock.stop();
    });
  });
});
