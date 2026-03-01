/**
 * MemoryRateLimitAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryRateLimitAdapter,
  createMemoryRateLimitAdapter,
  getMemoryRateLimitAdapter,
  resetMemoryRateLimitAdapter,
} from '../../../src/common/adapters/memory-ratelimit.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MemoryRateLimitAdapter', () => {
  let rateLimiter: MemoryRateLimitAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = createMemoryRateLimitAdapter({ cleanupIntervalMs: 60000 });
  });

  afterEach(() => {
    rateLimiter.stop();
    resetMemoryRateLimitAdapter();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a rate limiter with default options', () => {
      const adapter = createMemoryRateLimitAdapter();
      expect(adapter).toBeInstanceOf(MemoryRateLimitAdapter);
      adapter.stop();
    });

    it('should create a rate limiter with custom options', () => {
      const adapter = createMemoryRateLimitAdapter({
        cleanupIntervalMs: 30000,
      });
      expect(adapter).toBeInstanceOf(MemoryRateLimitAdapter);
      adapter.stop();
    });

    it('should not start cleanup timer when cleanupIntervalMs is 0', () => {
      const adapter = createMemoryRateLimitAdapter({ cleanupIntervalMs: 0 });
      expect(adapter).toBeInstanceOf(MemoryRateLimitAdapter);
      adapter.stop();
    });
  });

  describe('checkLimit', () => {
    it('should allow first request', async () => {
      const result = await rateLimiter.checkLimit('test-key', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('should allow requests under limit', async () => {
      const limit = 5;

      for (let i = 0; i < limit; i++) {
        const result = await rateLimiter.checkLimit('test-key', limit, 60);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(limit - i - 1);
      }
    });

    it('should deny requests over limit', async () => {
      const limit = 3;

      // Use up the limit
      for (let i = 0; i < limit; i++) {
        await rateLimiter.checkLimit('test-key', limit, 60);
      }

      // Next request should be denied
      const result = await rateLimiter.checkLimit('test-key', limit, 60);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track different keys independently', async () => {
      await rateLimiter.checkLimit('key1', 2, 60);
      await rateLimiter.checkLimit('key1', 2, 60);

      // key1 is at limit
      const key1Result = await rateLimiter.checkLimit('key1', 2, 60);
      expect(key1Result.allowed).toBe(false);

      // key2 should still be allowed
      const key2Result = await rateLimiter.checkLimit('key2', 2, 60);
      expect(key2Result.allowed).toBe(true);
    });

    it('should reset after window expires (sliding window)', async () => {
      const limit = 2;
      const windowSeconds = 10;

      // Use up the limit
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);

      // Should be denied
      let result = await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      expect(result.allowed).toBe(false);

      // Advance time past window
      vi.advanceTimersByTime(11000);

      // Should be allowed again
      result = await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      expect(result.allowed).toBe(true);
    });

    it('should implement sliding window correctly', async () => {
      const limit = 3;
      const windowSeconds = 10;

      // Make 2 requests at t=0
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);

      // Advance 5 seconds
      vi.advanceTimersByTime(5000);

      // Make 1 more request at t=5
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);

      // Should be at limit now
      let result = await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      expect(result.allowed).toBe(false);

      // Advance 6 more seconds (t=11) - first 2 requests should be outside window
      vi.advanceTimersByTime(6000);

      // Should have 2 more requests available (only the t=5 request is in window)
      result = await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should return correct resetAt time', async () => {
      const windowSeconds = 60;
      const now = Date.now();

      const result = await rateLimiter.checkLimit('test-key', 10, windowSeconds);

      // resetAt should be approximately now + window
      expect(result.resetAt).toBeGreaterThanOrEqual(now);
      expect(result.resetAt).toBeLessThanOrEqual(now + windowSeconds * 1000 + 100);
    });
  });

  describe('getStatus', () => {
    it('should return status without consuming', async () => {
      const limit = 5;

      // Make some requests
      await rateLimiter.checkLimit('test-key', limit, 60);
      await rateLimiter.checkLimit('test-key', limit, 60);

      // Check status (should not consume)
      const status1 = await rateLimiter.getStatus('test-key', limit, 60);
      expect(status1.remaining).toBe(3);

      // Check status again (should be same)
      const status2 = await rateLimiter.getStatus('test-key', limit, 60);
      expect(status2.remaining).toBe(3);
    });

    it('should return full limit for unknown key', async () => {
      const status = await rateLimiter.getStatus('unknown-key', 10, 60);

      expect(status.allowed).toBe(true);
      expect(status.remaining).toBe(10);
    });

    it('should return allowed=false when at limit', async () => {
      const limit = 2;

      await rateLimiter.checkLimit('test-key', limit, 60);
      await rateLimiter.checkLimit('test-key', limit, 60);

      const status = await rateLimiter.getStatus('test-key', limit, 60);
      expect(status.allowed).toBe(false);
      expect(status.remaining).toBe(0);
    });

    it('should exclude expired timestamps from status', async () => {
      const limit = 3;
      const windowSeconds = 10;

      // Make 2 requests
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);
      await rateLimiter.checkLimit('test-key', limit, windowSeconds);

      // Advance time past window
      vi.advanceTimersByTime(11000);

      // Status should show full limit available
      const status = await rateLimiter.getStatus('test-key', limit, windowSeconds);
      expect(status.remaining).toBe(3);
    });
  });

  describe('reset', () => {
    it('should reset rate limit for a key', async () => {
      const limit = 3;

      // Use up the limit
      await rateLimiter.checkLimit('test-key', limit, 60);
      await rateLimiter.checkLimit('test-key', limit, 60);
      await rateLimiter.checkLimit('test-key', limit, 60);

      // Should be denied
      let result = await rateLimiter.checkLimit('test-key', limit, 60);
      expect(result.allowed).toBe(false);

      // Reset the key
      await rateLimiter.reset('test-key');

      // Should be allowed again
      result = await rateLimiter.checkLimit('test-key', limit, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should not throw for non-existent key', async () => {
      await expect(rateLimiter.reset('nonexistent')).resolves.not.toThrow();
    });

    it('should not affect other keys', async () => {
      await rateLimiter.checkLimit('key1', 2, 60);
      await rateLimiter.checkLimit('key1', 2, 60);
      await rateLimiter.checkLimit('key2', 2, 60);
      await rateLimiter.checkLimit('key2', 2, 60);

      await rateLimiter.reset('key1');

      // key1 should be reset
      const key1Result = await rateLimiter.checkLimit('key1', 2, 60);
      expect(key1Result.allowed).toBe(true);
      expect(key1Result.remaining).toBe(1);

      // key2 should still be at limit
      const key2Result = await rateLimiter.checkLimit('key2', 2, 60);
      expect(key2Result.allowed).toBe(false);
    });
  });

  describe('size', () => {
    it('should return the number of tracked keys', async () => {
      expect(rateLimiter.size).toBe(0);

      await rateLimiter.checkLimit('key1', 10, 60);
      expect(rateLimiter.size).toBe(1);

      await rateLimiter.checkLimit('key2', 10, 60);
      expect(rateLimiter.size).toBe(2);

      await rateLimiter.checkLimit('key1', 10, 60); // Same key
      expect(rateLimiter.size).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up stale entries', async () => {
      await rateLimiter.checkLimit('key1', 10, 60);
      await rateLimiter.checkLimit('key2', 10, 60);

      // Advance time significantly (1+ hour to exceed cutoff)
      vi.advanceTimersByTime(3700000);

      // Trigger cleanup
      vi.advanceTimersByTime(60000);

      expect(rateLimiter.size).toBe(0);
    });

    it('should keep entries with recent timestamps', async () => {
      await rateLimiter.checkLimit('key1', 10, 60);

      // Advance time but not past cutoff
      vi.advanceTimersByTime(1800000); // 30 minutes

      // Make another request to add a recent timestamp
      await rateLimiter.checkLimit('key1', 10, 60);

      // Trigger cleanup
      vi.advanceTimersByTime(60000);

      expect(rateLimiter.size).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop the cleanup timer', () => {
      const adapter = createMemoryRateLimitAdapter();
      adapter.stop();
      // Should not throw when stopping multiple times
      adapter.stop();
    });
  });

  describe('getMemoryRateLimitAdapter singleton', () => {
    afterEach(() => {
      resetMemoryRateLimitAdapter();
    });

    it('should return the same instance', () => {
      const instance1 = getMemoryRateLimitAdapter();
      const instance2 = getMemoryRateLimitAdapter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getMemoryRateLimitAdapter();
      await instance1.checkLimit('test-key', 10, 60);

      resetMemoryRateLimitAdapter();

      const instance2 = getMemoryRateLimitAdapter();
      expect(instance1).not.toBe(instance2);
      expect(instance2.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle limit of 1', async () => {
      const result1 = await rateLimiter.checkLimit('test-key', 1, 60);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(0);

      const result2 = await rateLimiter.checkLimit('test-key', 1, 60);
      expect(result2.allowed).toBe(false);
    });

    it('should handle very short window', async () => {
      const windowSeconds = 1;

      await rateLimiter.checkLimit('test-key', 2, windowSeconds);
      await rateLimiter.checkLimit('test-key', 2, windowSeconds);

      let result = await rateLimiter.checkLimit('test-key', 2, windowSeconds);
      expect(result.allowed).toBe(false);

      // Wait for window to expire
      vi.advanceTimersByTime(1500);

      result = await rateLimiter.checkLimit('test-key', 2, windowSeconds);
      expect(result.allowed).toBe(true);
    });

    it('should handle concurrent requests to same key', async () => {
      const limit = 5;

      // Simulate concurrent requests
      const results = await Promise.all([
        rateLimiter.checkLimit('test-key', limit, 60),
        rateLimiter.checkLimit('test-key', limit, 60),
        rateLimiter.checkLimit('test-key', limit, 60),
      ]);

      // All should be allowed since we're under limit
      expect(results.every(r => r.allowed)).toBe(true);
    });

    it('should handle different limits for same key', async () => {
      // Use limit of 2
      await rateLimiter.checkLimit('test-key', 2, 60);
      await rateLimiter.checkLimit('test-key', 2, 60);

      // At limit for limit=2
      let result = await rateLimiter.checkLimit('test-key', 2, 60);
      expect(result.allowed).toBe(false);

      // But allowed for limit=5 (same key, different limit)
      result = await rateLimiter.checkLimit('test-key', 5, 60);
      expect(result.allowed).toBe(true);
    });
  });
});
