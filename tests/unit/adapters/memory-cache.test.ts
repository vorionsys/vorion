/**
 * MemoryCacheAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryCacheAdapter,
  createMemoryCacheAdapter,
  getMemoryCacheAdapter,
  resetMemoryCacheAdapter,
} from '../../../src/common/adapters/memory-cache.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MemoryCacheAdapter', () => {
  let cache: MemoryCacheAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = createMemoryCacheAdapter({ cleanupIntervalMs: 60000 });
  });

  afterEach(() => {
    cache.stop();
    resetMemoryCacheAdapter();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a cache with default options', () => {
      const adapter = createMemoryCacheAdapter();
      expect(adapter).toBeInstanceOf(MemoryCacheAdapter);
      adapter.stop();
    });

    it('should create a cache with custom options', () => {
      const adapter = createMemoryCacheAdapter({
        cleanupIntervalMs: 30000,
        maxEntries: 100,
      });
      expect(adapter).toBeInstanceOf(MemoryCacheAdapter);
      adapter.stop();
    });

    it('should not start cleanup timer when cleanupIntervalMs is 0', () => {
      const adapter = createMemoryCacheAdapter({ cleanupIntervalMs: 0 });
      expect(adapter).toBeInstanceOf(MemoryCacheAdapter);
      adapter.stop();
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the stored value', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    it('should return null for expired key', async () => {
      await cache.set('key1', 'value1', 1); // 1 second TTL

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should return value if TTL has not expired', async () => {
      await cache.set('key1', 'value1', 10); // 10 seconds TTL

      // Advance time but not past TTL
      vi.advanceTimersByTime(5000);

      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    it('should handle complex objects', async () => {
      const obj = { id: 1, name: 'test', nested: { value: true } };
      await cache.set('obj', obj);
      const result = await cache.get<typeof obj>('obj');
      expect(result).toEqual(obj);
    });
  });

  describe('set', () => {
    it('should store a value without TTL', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    it('should store a value with TTL', async () => {
      await cache.set('key1', 'value1', 60);
      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    it('should overwrite existing value', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key1', 'value2');
      const result = await cache.get<string>('key1');
      expect(result).toBe('value2');
    });

    it('should evict oldest entry when maxEntries is reached', async () => {
      const limitedCache = createMemoryCacheAdapter({ maxEntries: 2 });

      await limitedCache.set('key1', 'value1');
      await limitedCache.set('key2', 'value2');
      await limitedCache.set('key3', 'value3'); // Should evict key1

      const result1 = await limitedCache.get('key1');
      const result2 = await limitedCache.get('key2');
      const result3 = await limitedCache.get('key3');

      expect(result1).toBeNull();
      expect(result2).toBe('value2');
      expect(result3).toBe('value3');

      limitedCache.stop();
    });

    it('should handle null and undefined values', async () => {
      await cache.set('nullKey', null);
      await cache.set('undefinedKey', undefined);

      const nullResult = await cache.get('nullKey');
      const undefinedResult = await cache.get('undefinedKey');

      expect(nullResult).toBeNull();
      expect(undefinedResult).toBeUndefined();
    });
  });

  describe('del', () => {
    it('should delete an existing key', async () => {
      await cache.set('key1', 'value1');
      await cache.del('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should not throw for non-existent key', async () => {
      await expect(cache.del('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.exists('key1');
      expect(result).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const result = await cache.exists('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for expired key', async () => {
      await cache.set('key1', 'value1', 1); // 1 second TTL

      vi.advanceTimersByTime(1500);

      const result = await cache.exists('key1');
      expect(result).toBe(false);
    });
  });

  describe('keys', () => {
    beforeEach(async () => {
      await cache.set('user:1', 'alice');
      await cache.set('user:2', 'bob');
      await cache.set('session:1', 'sess1');
      await cache.set('session:2', 'sess2');
    });

    it('should return all keys matching wildcard pattern', async () => {
      const result = await cache.keys('user:*');
      expect(result).toHaveLength(2);
      expect(result).toContain('user:1');
      expect(result).toContain('user:2');
    });

    it('should return all keys with * pattern', async () => {
      const result = await cache.keys('*');
      expect(result).toHaveLength(4);
    });

    it('should return empty array for no matches', async () => {
      const result = await cache.keys('nonexistent:*');
      expect(result).toHaveLength(0);
    });

    it('should support ? for single character match', async () => {
      const result = await cache.keys('user:?');
      expect(result).toHaveLength(2);
    });

    it('should exclude expired keys from results', async () => {
      await cache.set('temp:1', 'tempvalue', 1); // 1 second TTL

      vi.advanceTimersByTime(1500);

      const result = await cache.keys('temp:*');
      expect(result).toHaveLength(0);
    });

    it('should handle complex glob patterns', async () => {
      await cache.set('api:v1:users', 'data1');
      await cache.set('api:v2:users', 'data2');
      await cache.set('api:v1:sessions', 'data3');

      const result = await cache.keys('api:v?:users');
      expect(result).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.clear();

      expect(cache.size).toBe(0);
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });
  });

  describe('size', () => {
    it('should return the number of entries', async () => {
      expect(cache.size).toBe(0);

      await cache.set('key1', 'value1');
      expect(cache.size).toBe(1);

      await cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });
  });

  describe('TTL expiration', () => {
    it('should automatically expire entries after TTL', async () => {
      await cache.set('key1', 'value1', 5); // 5 seconds TTL

      // Value should exist before TTL
      expect(await cache.get('key1')).toBe('value1');

      // Advance time past TTL
      vi.advanceTimersByTime(6000);

      // Value should be expired
      expect(await cache.get('key1')).toBeNull();
    });

    it('should not expire entries without TTL', async () => {
      await cache.set('key1', 'value1'); // No TTL

      // Advance time significantly
      vi.advanceTimersByTime(3600000); // 1 hour

      // Value should still exist
      expect(await cache.get('key1')).toBe('value1');
    });
  });

  describe('cleanup', () => {
    it('should clean up expired entries on interval', async () => {
      await cache.set('key1', 'value1', 30); // 30 seconds TTL
      await cache.set('key2', 'value2', 30);
      await cache.set('key3', 'value3'); // No TTL

      // Expire some entries
      vi.advanceTimersByTime(35000); // 35 seconds

      // Trigger cleanup interval
      vi.advanceTimersByTime(60000);

      // key1 and key2 should be cleaned up, key3 should remain
      expect(cache.size).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop the cleanup timer', () => {
      const adapter = createMemoryCacheAdapter();
      adapter.stop();
      // Should not throw when stopping multiple times
      adapter.stop();
    });
  });

  describe('getMemoryCacheAdapter singleton', () => {
    afterEach(() => {
      resetMemoryCacheAdapter();
    });

    it('should return the same instance', () => {
      const instance1 = getMemoryCacheAdapter();
      const instance2 = getMemoryCacheAdapter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getMemoryCacheAdapter();
      await instance1.set('key', 'value');

      resetMemoryCacheAdapter();

      const instance2 = getMemoryCacheAdapter();
      expect(instance1).not.toBe(instance2);
      expect(await instance2.get('key')).toBeNull();
    });
  });

  describe('pattern matching edge cases', () => {
    it('should escape regex special characters in patterns', async () => {
      await cache.set('key.with.dots', 'value1');
      await cache.set('key[with]brackets', 'value2');

      const dotsResult = await cache.keys('key.with.dots');
      expect(dotsResult).toHaveLength(1);
      expect(dotsResult[0]).toBe('key.with.dots');

      const bracketsResult = await cache.keys('key[with]brackets');
      expect(bracketsResult).toHaveLength(1);
    });

    it('should handle empty pattern', async () => {
      await cache.set('key', 'value');
      const result = await cache.keys('');
      expect(result).toHaveLength(0);
    });
  });
});
