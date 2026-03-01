/**
 * MemoryLockAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryLockAdapter,
  createMemoryLockAdapter,
  getMemoryLockAdapter,
  resetMemoryLockAdapter,
} from '../../../src/common/adapters/memory-lock.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MemoryLockAdapter', () => {
  let lockAdapter: MemoryLockAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    lockAdapter = createMemoryLockAdapter();
  });

  afterEach(() => {
    lockAdapter.stop();
    resetMemoryLockAdapter();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a lock adapter', () => {
      const adapter = createMemoryLockAdapter();
      expect(adapter).toBeInstanceOf(MemoryLockAdapter);
      adapter.stop();
    });
  });

  describe('acquire', () => {
    it('should acquire a lock successfully', async () => {
      const result = await lockAdapter.acquire('test-lock');

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();
      expect(typeof result.lockId).toBe('string');
    });

    it('should fail to acquire an already held lock', async () => {
      await lockAdapter.acquire('test-lock');
      const result = await lockAdapter.acquire('test-lock', { retryCount: 0 });

      expect(result.acquired).toBe(false);
      expect(result.lockId).toBeUndefined();
    });

    it('should acquire lock with custom TTL', async () => {
      const result = await lockAdapter.acquire('test-lock', { ttlMs: 5000 });

      expect(result.acquired).toBe(true);
      expect(lockAdapter.isLocked('test-lock')).toBe(true);
    });

    it('should retry acquiring lock', async () => {
      // Acquire lock
      const firstResult = await lockAdapter.acquire('test-lock', { ttlMs: 100 });
      expect(firstResult.acquired).toBe(true);

      // Try to acquire same lock with retries
      const acquirePromise = lockAdapter.acquire('test-lock', {
        retryCount: 5,
        retryDelayMs: 50,
      });

      // Advance time to expire the first lock
      vi.advanceTimersByTime(150);

      const secondResult = await acquirePromise;
      expect(secondResult.acquired).toBe(true);
    });

    it('should fail after max retries', async () => {
      // Use a long TTL lock that won't expire during retries
      await lockAdapter.acquire('test-lock', { ttlMs: 30000 });

      // Start the acquire attempt in background and advance timers
      const acquirePromise = lockAdapter.acquire('test-lock', {
        retryCount: 2,
        retryDelayMs: 10,
      });

      // Advance time for all retries to complete
      await vi.advanceTimersByTimeAsync(100);

      const result = await acquirePromise;
      expect(result.acquired).toBe(false);
    });

    it('should acquire expired lock without retry', async () => {
      await lockAdapter.acquire('test-lock', { ttlMs: 100 });

      // Advance time to expire the lock
      vi.advanceTimersByTime(150);

      const result = await lockAdapter.acquire('test-lock', { retryCount: 0 });
      expect(result.acquired).toBe(true);
    });

    it('should use default options when not provided', async () => {
      const result = await lockAdapter.acquire('test-lock');
      expect(result.acquired).toBe(true);
    });
  });

  describe('release', () => {
    it('should release a held lock', async () => {
      const { lockId } = await lockAdapter.acquire('test-lock');

      const released = await lockAdapter.release('test-lock', lockId!);

      expect(released).toBe(true);
      expect(lockAdapter.isLocked('test-lock')).toBe(false);
    });

    it('should fail to release a non-existent lock', async () => {
      const released = await lockAdapter.release('nonexistent', 'fake-id');
      expect(released).toBe(false);
    });

    it('should fail to release lock with wrong lockId', async () => {
      await lockAdapter.acquire('test-lock');

      const released = await lockAdapter.release('test-lock', 'wrong-id');

      expect(released).toBe(false);
      expect(lockAdapter.isLocked('test-lock')).toBe(true);
    });

    it('should fail to release an expired lock', async () => {
      const { lockId } = await lockAdapter.acquire('test-lock', { ttlMs: 100 });

      // Advance time to expire the lock
      vi.advanceTimersByTime(150);

      const released = await lockAdapter.release('test-lock', lockId!);
      expect(released).toBe(false);
    });
  });

  describe('extend', () => {
    it('should extend a held lock', async () => {
      const { lockId } = await lockAdapter.acquire('test-lock', { ttlMs: 1000 });

      const extended = await lockAdapter.extend('test-lock', lockId!, 5000);

      expect(extended).toBe(true);

      // Original TTL would have expired, but extended lock should still be valid
      vi.advanceTimersByTime(2000);
      expect(lockAdapter.isLocked('test-lock')).toBe(true);
    });

    it('should fail to extend a non-existent lock', async () => {
      const extended = await lockAdapter.extend('nonexistent', 'fake-id', 5000);
      expect(extended).toBe(false);
    });

    it('should fail to extend lock with wrong lockId', async () => {
      await lockAdapter.acquire('test-lock');

      const extended = await lockAdapter.extend('test-lock', 'wrong-id', 5000);
      expect(extended).toBe(false);
    });

    it('should fail to extend an expired lock', async () => {
      const { lockId } = await lockAdapter.acquire('test-lock', { ttlMs: 100 });

      // Advance time to expire the lock
      vi.advanceTimersByTime(150);

      const extended = await lockAdapter.extend('test-lock', lockId!, 5000);
      expect(extended).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('should return true for held lock', async () => {
      await lockAdapter.acquire('test-lock');
      expect(lockAdapter.isLocked('test-lock')).toBe(true);
    });

    it('should return false for non-existent lock', () => {
      expect(lockAdapter.isLocked('nonexistent')).toBe(false);
    });

    it('should return false for expired lock', async () => {
      await lockAdapter.acquire('test-lock', { ttlMs: 100 });

      vi.advanceTimersByTime(150);

      expect(lockAdapter.isLocked('test-lock')).toBe(false);
    });
  });

  describe('activeCount', () => {
    it('should return the number of active locks', async () => {
      expect(lockAdapter.activeCount).toBe(0);

      await lockAdapter.acquire('lock1');
      expect(lockAdapter.activeCount).toBe(1);

      await lockAdapter.acquire('lock2');
      expect(lockAdapter.activeCount).toBe(2);
    });

    it('should not count expired locks', async () => {
      await lockAdapter.acquire('lock1', { ttlMs: 100 });
      await lockAdapter.acquire('lock2');

      vi.advanceTimersByTime(150);

      expect(lockAdapter.activeCount).toBe(1);
    });
  });

  describe('timeout behavior', () => {
    it('should automatically expire locks after TTL', async () => {
      const { lockId } = await lockAdapter.acquire('test-lock', { ttlMs: 1000 });

      expect(lockAdapter.isLocked('test-lock')).toBe(true);

      vi.advanceTimersByTime(1500);

      expect(lockAdapter.isLocked('test-lock')).toBe(false);

      // Should not be able to release expired lock
      const released = await lockAdapter.release('test-lock', lockId!);
      expect(released).toBe(false);
    });

    it('should allow acquiring a timed-out lock', async () => {
      await lockAdapter.acquire('test-lock', { ttlMs: 100 });

      vi.advanceTimersByTime(150);

      const result = await lockAdapter.acquire('test-lock', { retryCount: 0 });
      expect(result.acquired).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired locks periodically', async () => {
      await lockAdapter.acquire('lock1', { ttlMs: 5000 });
      await lockAdapter.acquire('lock2', { ttlMs: 5000 });
      await lockAdapter.acquire('lock3'); // Default TTL

      // Expire lock1 and lock2
      vi.advanceTimersByTime(6000);

      // Trigger cleanup interval (every 10 seconds)
      vi.advanceTimersByTime(10000);

      // Only lock3 should remain
      expect(lockAdapter.activeCount).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop the cleanup timer', () => {
      const adapter = createMemoryLockAdapter();
      adapter.stop();
      // Should not throw when stopping multiple times
      adapter.stop();
    });
  });

  describe('getMemoryLockAdapter singleton', () => {
    afterEach(() => {
      resetMemoryLockAdapter();
    });

    it('should return the same instance', () => {
      const instance1 = getMemoryLockAdapter();
      const instance2 = getMemoryLockAdapter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getMemoryLockAdapter();
      await instance1.acquire('test-lock');

      resetMemoryLockAdapter();

      const instance2 = getMemoryLockAdapter();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('concurrent lock acquisition', () => {
    it('should handle multiple locks on different keys', async () => {
      const result1 = await lockAdapter.acquire('lock1');
      const result2 = await lockAdapter.acquire('lock2');
      const result3 = await lockAdapter.acquire('lock3');

      expect(result1.acquired).toBe(true);
      expect(result2.acquired).toBe(true);
      expect(result3.acquired).toBe(true);

      expect(lockAdapter.activeCount).toBe(3);
    });

    it('should release locks independently', async () => {
      const { lockId: lockId1 } = await lockAdapter.acquire('lock1');
      const { lockId: lockId2 } = await lockAdapter.acquire('lock2');

      await lockAdapter.release('lock1', lockId1!);

      expect(lockAdapter.isLocked('lock1')).toBe(false);
      expect(lockAdapter.isLocked('lock2')).toBe(true);

      await lockAdapter.release('lock2', lockId2!);
      expect(lockAdapter.isLocked('lock2')).toBe(false);
    });
  });
});
