/**
 * In-Memory Lock Adapter
 *
 * Provides a distributed locking implementation that runs entirely in memory,
 * suitable for development, testing, or single-instance deployments.
 *
 * Features:
 * - Lock storage with Map
 * - Unique lock IDs for ownership verification
 * - TTL with automatic expiration
 * - Retry with configurable attempts and delay
 *
 * Note: In-memory locks are NOT distributed across instances.
 * Use Redis-backed locks for multi-instance deployments.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import type { ILockAdapter, LockOptions, LockResult } from './types.js';

const logger = createLogger({ component: 'memory-lock' });

/**
 * Internal lock representation
 */
interface LockEntry {
  lockId: string;
  key: string;
  expiresAt: number;
}

/**
 * Default lock options
 */
const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  ttlMs: 30000, // 30 seconds
  retryCount: 3,
  retryDelayMs: 100,
};

/**
 * In-memory lock adapter implementation
 */
export class MemoryLockAdapter implements ILockAdapter {
  private locks = new Map<string, LockEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start background cleanup for expired locks
    this.startCleanup();
    logger.debug({}, 'Memory lock adapter created');
  }

  /**
   * Attempt to acquire a lock
   */
  async acquire(key: string, options?: LockOptions): Promise<LockResult> {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const lockId = randomUUID();

    for (let attempt = 0; attempt <= opts.retryCount; attempt++) {
      // Check if lock exists and is still valid
      const existingLock = this.locks.get(key);

      if (existingLock) {
        // Check if expired
        if (existingLock.expiresAt <= Date.now()) {
          // Expired, can take over
          this.locks.delete(key);
        } else {
          // Lock is held, retry if we have attempts left
          if (attempt < opts.retryCount) {
            await this.sleep(opts.retryDelayMs);
            continue;
          }

          logger.debug(
            { key, attempts: attempt + 1 },
            'Lock acquisition failed after retries'
          );
          return { acquired: false };
        }
      }

      // Acquire the lock
      const entry: LockEntry = {
        lockId,
        key,
        expiresAt: Date.now() + opts.ttlMs,
      };

      this.locks.set(key, entry);

      logger.debug(
        { key, lockId, ttlMs: opts.ttlMs },
        'Lock acquired'
      );

      return { acquired: true, lockId };
    }

    return { acquired: false };
  }

  /**
   * Release a lock
   */
  async release(key: string, lockId: string): Promise<boolean> {
    const existingLock = this.locks.get(key);

    if (!existingLock) {
      logger.debug({ key, lockId }, 'Lock release failed: not found');
      return false;
    }

    // Verify ownership
    if (existingLock.lockId !== lockId) {
      logger.debug(
        { key, lockId, actualLockId: existingLock.lockId },
        'Lock release failed: not owner'
      );
      return false;
    }

    // Check if expired (still return false as we don't own it anymore)
    if (existingLock.expiresAt <= Date.now()) {
      this.locks.delete(key);
      logger.debug({ key, lockId }, 'Lock release failed: expired');
      return false;
    }

    this.locks.delete(key);
    logger.debug({ key, lockId }, 'Lock released');
    return true;
  }

  /**
   * Extend a lock's TTL
   */
  async extend(key: string, lockId: string, additionalMs: number): Promise<boolean> {
    const existingLock = this.locks.get(key);

    if (!existingLock) {
      logger.debug({ key, lockId }, 'Lock extend failed: not found');
      return false;
    }

    // Verify ownership
    if (existingLock.lockId !== lockId) {
      logger.debug(
        { key, lockId, actualLockId: existingLock.lockId },
        'Lock extend failed: not owner'
      );
      return false;
    }

    // Check if expired
    if (existingLock.expiresAt <= Date.now()) {
      this.locks.delete(key);
      logger.debug({ key, lockId }, 'Lock extend failed: expired');
      return false;
    }

    // Extend the TTL
    existingLock.expiresAt = Date.now() + additionalMs;

    logger.debug(
      { key, lockId, additionalMs },
      'Lock extended'
    );

    return true;
  }

  /**
   * Check if a lock is held (for debugging/monitoring)
   */
  isLocked(key: string): boolean {
    const entry = this.locks.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    if (entry.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get the number of active locks (for monitoring)
   */
  get activeCount(): number {
    this.cleanupExpired();
    return this.locks.size;
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
   * Start background cleanup of expired locks
   */
  private startCleanup(): void {
    // Cleanup every 10 seconds
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 10000);

    // Don't block process exit
    this.cleanupTimer.unref();
  }

  /**
   * Remove expired locks
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.locks.entries()) {
      if (entry.expiresAt <= now) {
        this.locks.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug({ expiredCount }, 'Cleaned up expired locks');
    }
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance for default usage
 */
let defaultInstance: MemoryLockAdapter | null = null;

/**
 * Get the default memory lock adapter instance
 */
export function getMemoryLockAdapter(): ILockAdapter {
  if (!defaultInstance) {
    defaultInstance = new MemoryLockAdapter();
  }
  return defaultInstance;
}

/**
 * Create a new memory lock adapter instance (for testing)
 */
export function createMemoryLockAdapter(): MemoryLockAdapter {
  return new MemoryLockAdapter();
}

/**
 * Reset the default instance (for testing)
 */
export function resetMemoryLockAdapter(): void {
  if (defaultInstance) {
    defaultInstance.stop();
    defaultInstance = null;
  }
}
