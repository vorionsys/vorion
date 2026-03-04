/**
 * In-Memory Cache Adapter
 *
 * Provides a cache implementation that runs entirely in memory,
 * suitable for development, testing, or single-instance deployments.
 *
 * Features:
 * - Key-value storage with Map
 * - TTL tracking with automatic expiration
 * - Background cleanup interval for expired entries
 * - Pattern-based key listing (glob patterns)
 *
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import type { ICacheAdapter } from './types.js';

const logger = createLogger({ component: 'memory-cache' });

/**
 * Cache entry with TTL tracking
 */
interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number | null; // null = no expiration
}

/**
 * Default cleanup interval in milliseconds (1 minute)
 */
const DEFAULT_CLEANUP_INTERVAL_MS = 60000;

/**
 * Configuration options for the memory cache
 */
export interface MemoryCacheOptions {
  /** Interval for background cleanup of expired entries (ms) */
  cleanupIntervalMs?: number;
  /** Maximum number of entries (0 = unlimited) */
  maxEntries?: number;
}

/**
 * In-memory cache adapter implementation
 */
export class MemoryCacheAdapter implements ICacheAdapter {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<MemoryCacheOptions>;

  constructor(options?: MemoryCacheOptions) {
    this.options = {
      cleanupIntervalMs: options?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      maxEntries: options?.maxEntries ?? 0,
    };

    // Start background cleanup
    this.startCleanup();

    logger.debug(
      { cleanupIntervalMs: this.options.cleanupIntervalMs },
      'Memory cache created'
    );
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Enforce max entries limit
    if (this.options.maxEntries > 0 && this.cache.size >= this.options.maxEntries) {
      // Evict oldest entry (LRU-like behavior)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const expiresAt = ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : null;

    this.cache.set(key, {
      value,
      expiresAt,
    });
  }

  /**
   * Delete a key from cache
   */
  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get keys matching a pattern
   * Supports glob patterns: * (any characters), ? (single character)
   */
  async keys(pattern: string): Promise<string[]> {
    const regex = this.patternToRegex(pattern);
    const matchingKeys: string[] = [];
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      // Skip expired entries
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        continue;
      }

      if (regex.test(key)) {
        matchingKeys.push(key);
      }
    }

    return matchingKeys;
  }

  /**
   * Clear all entries from cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Get the number of entries in cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Stop the background cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Start background cleanup of expired entries
   */
  private startCleanup(): void {
    if (this.options.cleanupIntervalMs <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.options.cleanupIntervalMs);

    // Don't block process exit
    this.cleanupTimer.unref();
  }

  /**
   * Remove expired entries from cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug({ expiredCount }, 'Cleaned up expired cache entries');
    }
  }

  /**
   * Convert glob pattern to regex
   */
  private patternToRegex(pattern: string): RegExp {
    // Escape regex special characters except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Convert glob patterns to regex
    const regexPattern = escaped
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character

    return new RegExp(`^${regexPattern}$`);
  }
}

/**
 * Singleton instance for default usage
 */
let defaultInstance: MemoryCacheAdapter | null = null;

/**
 * Get the default memory cache instance
 */
export function getMemoryCacheAdapter(options?: MemoryCacheOptions): ICacheAdapter {
  if (!defaultInstance) {
    defaultInstance = new MemoryCacheAdapter(options);
  }
  return defaultInstance;
}

/**
 * Create a new memory cache instance (for testing or isolated usage)
 */
export function createMemoryCacheAdapter(options?: MemoryCacheOptions): MemoryCacheAdapter {
  return new MemoryCacheAdapter(options);
}

/**
 * Reset the default instance (for testing)
 */
export function resetMemoryCacheAdapter(): void {
  if (defaultInstance) {
    defaultInstance.stop();
    defaultInstance = null;
  }
}
