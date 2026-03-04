/**
 * Adapter System for Redis Optionality
 *
 * This module exports all adapter interfaces and implementations,
 * allowing Vorion to run with either Redis-backed or in-memory
 * implementations of queues, caches, locks, sessions, and rate limiting.
 *
 * Usage:
 * ```typescript
 * import { getAdapterProvider } from './common/adapters';
 *
 * const provider = getAdapterProvider();
 * const cache = provider.getCacheAdapter();
 * await cache.set('key', 'value', 300);
 * ```
 *
 * Or use convenience functions:
 * ```typescript
 * import { getCacheAdapter, getQueueAdapter } from './common/adapters';
 *
 * const cache = getCacheAdapter();
 * const queue = getQueueAdapter('my-queue');
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Queue types
  QueueJobOptions,
  JobCounts,
  Job,
  JobHandler,
  IQueueAdapter,

  // Cache types
  ICacheAdapter,

  // Lock types
  LockOptions,
  LockResult,
  ILockAdapter,

  // Session types
  Session,
  CreateSessionInput,
  ISessionStoreAdapter,

  // Rate limit types
  RateLimitResult,
  IRateLimitAdapter,

  // Provider types
  AdapterHealthStatus,
  AdapterProvider,
} from './types.js';

// =============================================================================
// MEMORY IMPLEMENTATIONS
// =============================================================================

// Queue
export {
  MemoryQueueAdapter,
  createMemoryQueueAdapter,
} from './memory-queue.js';

// Cache
export {
  MemoryCacheAdapter,
  createMemoryCacheAdapter,
  getMemoryCacheAdapter,
  resetMemoryCacheAdapter,
  type MemoryCacheOptions,
} from './memory-cache.js';

// Lock
export {
  MemoryLockAdapter,
  createMemoryLockAdapter,
  getMemoryLockAdapter,
  resetMemoryLockAdapter,
} from './memory-lock.js';

// Session
export {
  MemorySessionStoreAdapter,
  createMemorySessionStoreAdapter,
  getMemorySessionStoreAdapter,
  resetMemorySessionStoreAdapter,
  type MemorySessionStoreOptions,
} from './memory-session.js';

// Rate Limit
export {
  MemoryRateLimitAdapter,
  createMemoryRateLimitAdapter,
  getMemoryRateLimitAdapter,
  resetMemoryRateLimitAdapter,
  type MemoryRateLimitOptions,
} from './memory-ratelimit.js';

// =============================================================================
// PROVIDER
// =============================================================================

export {
  getAdapterProvider,
  createAdapterProvider,
  resetAdapterProvider,
  type AdapterProviderConfig,

  // Convenience functions
  getQueueAdapter,
  getCacheAdapter,
  getLockAdapter,
  getSessionStoreAdapter,
  getRateLimitAdapter,
} from './provider.js';
