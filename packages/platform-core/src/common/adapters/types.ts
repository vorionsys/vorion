/**
 * Adapter Interfaces for Redis Optionality
 *
 * These interfaces define contracts for queue, cache, lock, session,
 * and rate limiting functionality. They can be implemented by either
 * Redis-backed or in-memory backends, allowing Vorion to run without Redis.
 *
 * @packageDocumentation
 */

import type { Session, CreateSessionInput } from '../../security/session-store.js';

// Re-export Session types for convenience
export type { Session, CreateSessionInput };

// =============================================================================
// QUEUE ADAPTER
// =============================================================================

/**
 * Options for adding a job to a queue
 */
export interface QueueJobOptions {
  /** Delay in milliseconds before the job becomes active */
  delay?: number;
  /** Number of retry attempts */
  attempts?: number;
  /** Backoff configuration for retries */
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  /** Job priority (lower = higher priority) */
  priority?: number;
  /** Custom job ID (for deduplication) */
  jobId?: string;
}

/**
 * Job counts by status
 */
export interface JobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Job representation passed to handlers
 */
export interface Job<T = unknown> {
  id: string;
  data: T;
  attemptsMade: number;
}

/**
 * Job handler function type
 */
export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

/**
 * Queue adapter interface for job processing
 */
export interface IQueueAdapter {
  /**
   * Add a job to the queue
   * @returns Job ID
   */
  add<T>(name: string, data: T, options?: QueueJobOptions): Promise<string>;

  /**
   * Register a handler for processing jobs
   */
  process<T>(handler: JobHandler<T>): void;

  /**
   * Get job counts by status
   */
  getJobCounts(): Promise<JobCounts>;

  /**
   * Close the queue and stop processing
   */
  close(): Promise<void>;
}

// =============================================================================
// CACHE ADAPTER
// =============================================================================

/**
 * Cache adapter interface for key-value storage with TTL
 */
export interface ICacheAdapter {
  /**
   * Get a value from cache
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   * @param ttlSeconds - Time-to-live in seconds (optional)
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a key from cache
   */
  del(key: string): Promise<void>;

  /**
   * Check if a key exists in cache
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get keys matching a pattern
   * Supports glob patterns: * (any characters), ? (single character)
   */
  keys(pattern: string): Promise<string[]>;
}

// =============================================================================
// LOCK ADAPTER
// =============================================================================

/**
 * Options for acquiring a lock
 */
export interface LockOptions {
  /** Lock TTL in milliseconds */
  ttlMs?: number;
  /** Number of retry attempts to acquire the lock */
  retryCount?: number;
  /** Delay between retry attempts in milliseconds */
  retryDelayMs?: number;
}

/**
 * Result of a lock acquisition attempt
 */
export interface LockResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** Unique lock identifier (required for release/extend) */
  lockId?: string;
}

/**
 * Lock adapter interface for distributed locking
 */
export interface ILockAdapter {
  /**
   * Attempt to acquire a lock
   */
  acquire(key: string, options?: LockOptions): Promise<LockResult>;

  /**
   * Release a lock
   * @param key - Lock key
   * @param lockId - Lock identifier from acquire result
   * @returns true if released, false if not owned or already expired
   */
  release(key: string, lockId: string): Promise<boolean>;

  /**
   * Extend a lock's TTL
   * @param key - Lock key
   * @param lockId - Lock identifier from acquire result
   * @param additionalMs - Additional time in milliseconds
   * @returns true if extended, false if not owned or already expired
   */
  extend(key: string, lockId: string, additionalMs: number): Promise<boolean>;
}

// =============================================================================
// SESSION STORE ADAPTER
// =============================================================================

/**
 * Session store adapter interface
 */
export interface ISessionStoreAdapter {
  /**
   * Create a new session
   */
  create(input: CreateSessionInput): Promise<Session>;

  /**
   * Get a session by ID
   * @returns The session or null if not found/expired
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Delete a session permanently
   */
  delete(sessionId: string): Promise<boolean>;

  /**
   * Revoke a session (marks as revoked but keeps briefly for detection)
   */
  revoke(sessionId: string, reason: string, revokedBy: string): Promise<boolean>;

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): Promise<Session[]>;
}

// =============================================================================
// RATE LIMIT ADAPTER
// =============================================================================

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the window */
  remaining: number;
  /** Unix timestamp when the window resets */
  resetAt: number;
}

/**
 * Rate limit adapter interface
 */
export interface IRateLimitAdapter {
  /**
   * Check and consume rate limit
   * @param key - Rate limit key (e.g., tenant:intentType)
   * @param limit - Maximum requests per window
   * @param windowSeconds - Window size in seconds
   */
  checkLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;

  /**
   * Get current rate limit status without consuming
   */
  getStatus(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;

  /**
   * Reset rate limit for a key
   */
  reset(key: string): Promise<void>;
}

// =============================================================================
// ADAPTER PROVIDER
// =============================================================================

/**
 * Health status for the adapter system
 */
export interface AdapterHealthStatus {
  redis: {
    available: boolean;
    latencyMs?: number;
    error?: string;
  };
  mode: 'redis' | 'memory';
}

/**
 * Adapter provider interface for getting adapter instances
 */
export interface AdapterProvider {
  /**
   * Get a queue adapter by name
   */
  getQueueAdapter(name: string): IQueueAdapter;

  /**
   * Get the cache adapter
   */
  getCacheAdapter(): ICacheAdapter;

  /**
   * Get the lock adapter
   */
  getLockAdapter(): ILockAdapter;

  /**
   * Get the session store adapter
   */
  getSessionStoreAdapter(): ISessionStoreAdapter;

  /**
   * Get the rate limit adapter
   */
  getRateLimitAdapter(): IRateLimitAdapter;

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean;

  /**
   * Get health status of the adapter system
   */
  getHealthStatus(): Promise<AdapterHealthStatus>;
}
