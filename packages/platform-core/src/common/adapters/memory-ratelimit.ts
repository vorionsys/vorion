/**
 * In-Memory Rate Limit Adapter
 *
 * Provides a rate limiting implementation that runs entirely in memory,
 * suitable for development, testing, or single-instance deployments.
 *
 * Features:
 * - Sliding window algorithm using timestamps
 * - Per-key rate limiting
 * - Automatic cleanup of expired entries
 *
 * Note: In-memory rate limits are NOT shared across instances.
 * Use Redis-backed rate limiting for multi-instance deployments.
 *
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import type { IRateLimitAdapter, RateLimitResult } from './types.js';

const logger = createLogger({ component: 'memory-ratelimit' });

/**
 * Rate limit entry with request timestamps
 */
interface RateLimitEntry {
  timestamps: number[]; // Array of request timestamps in ms
}

/**
 * Configuration options for the memory rate limiter
 */
export interface MemoryRateLimitOptions {
  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupIntervalMs?: number;
}

/**
 * Default configuration
 */
const DEFAULT_OPTIONS: Required<MemoryRateLimitOptions> = {
  cleanupIntervalMs: 60000, // 1 minute
};

/**
 * In-memory rate limit adapter implementation
 */
export class MemoryRateLimitAdapter implements IRateLimitAdapter {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<MemoryRateLimitOptions>;

  constructor(options?: MemoryRateLimitOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Start background cleanup
    this.startCleanup();

    logger.debug(
      { cleanupIntervalMs: this.options.cleanupIntervalMs },
      'Memory rate limit adapter created'
    );
  }

  /**
   * Check and consume rate limit
   */
  async checkLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    // Get or create entry
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    // Remove timestamps outside the window (sliding window cleanup)
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

    // Check if under limit
    if (entry.timestamps.length < limit) {
      // Under limit: add this request
      entry.timestamps.push(now);

      const remaining = limit - entry.timestamps.length;
      const resetAt = this.calculateResetAt(entry.timestamps, windowMs);

      return {
        allowed: true,
        remaining,
        resetAt,
      };
    }

    // Over limit: deny
    const resetAt = this.calculateResetAt(entry.timestamps, windowMs);

    logger.debug(
      { key, limit, current: entry.timestamps.length },
      'Rate limit exceeded'
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  /**
   * Get current rate limit status without consuming
   */
  async getStatus(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    const entry = this.entries.get(key);

    if (!entry) {
      // No requests yet
      return {
        allowed: true,
        remaining: limit,
        resetAt: now + windowMs,
      };
    }

    // Filter to only timestamps in current window
    const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
    const remaining = Math.max(0, limit - validTimestamps.length);
    const resetAt = this.calculateResetAt(validTimestamps, windowMs);

    return {
      allowed: validTimestamps.length < limit,
      remaining,
      resetAt,
    };
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    this.entries.delete(key);
    logger.debug({ key }, 'Rate limit reset');
  }

  /**
   * Get the number of tracked keys
   */
  get size(): number {
    return this.entries.size;
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
   * Calculate when the rate limit window resets
   */
  private calculateResetAt(timestamps: number[], windowMs: number): number {
    if (timestamps.length === 0) {
      return Date.now() + windowMs;
    }

    // Reset when the oldest timestamp in the window expires
    const oldestTimestamp = Math.min(...timestamps);
    return oldestTimestamp + windowMs;
  }

  /**
   * Start background cleanup of stale entries
   */
  private startCleanup(): void {
    if (this.options.cleanupIntervalMs <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupStale();
    }, this.options.cleanupIntervalMs);

    // Don't block process exit
    this.cleanupTimer.unref();
  }

  /**
   * Remove entries with no recent timestamps
   */
  private cleanupStale(): void {
    const now = Date.now();
    // Keep entries with timestamps from the last hour (generous window)
    const cutoff = now - 3600000;
    let cleanedCount = 0;

    for (const [key, entry] of this.entries.entries()) {
      // Remove timestamps older than cutoff
      entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);

      // Remove entry if no timestamps remain
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug({ cleanedCount }, 'Cleaned up stale rate limit entries');
    }
  }
}

/**
 * Singleton instance for default usage
 */
let defaultInstance: MemoryRateLimitAdapter | null = null;

/**
 * Get the default memory rate limit adapter instance
 */
export function getMemoryRateLimitAdapter(
  options?: MemoryRateLimitOptions
): IRateLimitAdapter {
  if (!defaultInstance) {
    defaultInstance = new MemoryRateLimitAdapter(options);
  }
  return defaultInstance;
}

/**
 * Create a new memory rate limit adapter instance (for testing)
 */
export function createMemoryRateLimitAdapter(
  options?: MemoryRateLimitOptions
): MemoryRateLimitAdapter {
  return new MemoryRateLimitAdapter(options);
}

/**
 * Reset the default instance (for testing)
 */
export function resetMemoryRateLimitAdapter(): void {
  if (defaultInstance) {
    defaultInstance.stop();
    defaultInstance = null;
  }
}
