/**
 * Redis Circuit Breaker and Resilience
 *
 * Provides circuit breaker protection and graceful fallbacks for Redis operations
 * to prevent cascading failures when Redis is unavailable or degraded.
 *
 * Features:
 * - Circuit breaker with CLOSED -> OPEN -> HALF_OPEN states
 * - Graceful fallbacks when Redis is unavailable:
 *   - Rate limiting: allow requests with warning
 *   - Locks: in-memory mutex (single instance only)
 *   - Cache: bypass cache, query DB directly
 * - 5 second timeout for all Redis operations
 * - Metrics export for monitoring
 *
 * @packageDocumentation
 */

import {
  CircuitState,
  getCircuitBreaker,
  CircuitBreakerOpenError,
  withCircuitBreaker,
  withCircuitBreakerResult,
} from './circuit-breaker.js';
import { createLogger } from './logger.js';
import { getRedis } from './redis.js';
import { withTimeout } from './timeout.js';
import type { CircuitBreaker } from './circuit-breaker.js';

const logger = createLogger({ component: 'redis-resilience' });

// Re-export useful types
export { CircuitState, CircuitBreakerOpenError };

/**
 * Redis operation timeout in milliseconds (5 seconds)
 */
export const REDIS_OPERATION_TIMEOUT_MS = 5000;

/**
 * Redis circuit breaker service name
 */
export const REDIS_SERVICE_NAME = 'redis';

/**
 * In-memory mutex for fallback locking when Redis is unavailable.
 * WARNING: Only works within a single Node.js instance!
 */
class InMemoryMutex {
  private locks = new Map<string, {
    owner: string;
    expiresAt: number;
    waiters: Array<{ resolve: (acquired: boolean) => void; timeout: NodeJS.Timeout }>;
  }>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired locks every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
    this.cleanupInterval.unref();
  }

  async acquire(key: string, ownerId: string, ttlMs: number, waitTimeoutMs: number = 0): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);

    // Check if lock is held and not expired
    if (existing && existing.expiresAt > now && existing.owner !== ownerId) {
      // Lock is held by someone else
      if (waitTimeoutMs <= 0) {
        return false;
      }

      // Wait for lock to be released
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Remove from waiters and resolve false
          const lock = this.locks.get(key);
          if (lock) {
            lock.waiters = lock.waiters.filter(w => w.resolve !== resolve);
          }
          resolve(false);
        }, waitTimeoutMs);

        if (existing.waiters) {
          existing.waiters.push({ resolve, timeout });
        }
      });
    }

    // Acquire the lock
    this.locks.set(key, {
      owner: ownerId,
      expiresAt: now + ttlMs,
      waiters: existing?.waiters ?? [],
    });

    logger.debug({ key, ownerId, ttlMs }, 'In-memory lock acquired (fallback mode)');
    return true;
  }

  release(key: string, ownerId: string): boolean {
    const existing = this.locks.get(key);
    if (!existing || existing.owner !== ownerId) {
      return false;
    }

    // Notify waiters
    const waiters = existing.waiters;
    this.locks.delete(key);

    // Give lock to first waiter
    if (waiters.length > 0) {
      const first = waiters.shift()!;
      clearTimeout(first.timeout);
      // Create new lock for the waiter
      this.locks.set(key, {
        owner: 'waiter', // Will be updated by the waiter
        expiresAt: Date.now() + 30000, // Default 30s TTL
        waiters,
      });
      first.resolve(true);
    }

    logger.debug({ key, ownerId }, 'In-memory lock released (fallback mode)');
    return true;
  }

  isLocked(key: string): boolean {
    const existing = this.locks.get(key);
    return existing !== undefined && existing.expiresAt > Date.now();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
        // Notify waiters that lock expired
        for (const waiter of lock.waiters) {
          clearTimeout(waiter.timeout);
          waiter.resolve(false);
        }
      }
    }
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.locks.clear();
  }
}

// Singleton in-memory mutex for fallback locking
const inMemoryMutex = new InMemoryMutex();

/**
 * Get the Redis circuit breaker instance
 */
export function getRedisCircuitBreaker(): CircuitBreaker {
  return getCircuitBreaker(REDIS_SERVICE_NAME, (from, to, _breaker) => {
    logger.info(
      { service: REDIS_SERVICE_NAME, fromState: from, toState: to },
      `Redis circuit breaker state transition: ${from} -> ${to}`
    );
  });
}

/**
 * Check if the Redis circuit is currently open
 */
export async function isRedisCircuitOpen(): Promise<boolean> {
  const breaker = getRedisCircuitBreaker();
  return await breaker.isOpen();
}

/**
 * Get Redis circuit breaker status for monitoring
 */
export async function getRedisCircuitStatus(): Promise<{
  name: string;
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  timeUntilReset: number | null;
}> {
  const breaker = getRedisCircuitBreaker();
  return await breaker.getStatus();
}

/**
 * Execute a Redis operation with circuit breaker protection and timeout.
 *
 * @param fn - The Redis operation to execute
 * @param options - Optional configuration
 * @returns The result of the Redis operation
 * @throws CircuitBreakerOpenError when circuit is open
 * @throws TimeoutError when operation exceeds timeout
 *
 * @example
 * ```typescript
 * const value = await withRedisCircuitBreaker(
 *   async () => redis.get('mykey'),
 *   { operationName: 'getKey' }
 * );
 * ```
 */
export function withRedisCircuitBreaker<T>(
  fn: () => Promise<T>,
  options: {
    operationName?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const operationName = options.operationName ?? 'unknown';
  const timeoutMs = options.timeoutMs ?? REDIS_OPERATION_TIMEOUT_MS;

  return withCircuitBreaker(REDIS_SERVICE_NAME, () => {
    return withTimeout(
      fn(),
      timeoutMs,
      `Redis operation '${operationName}' timed out after ${timeoutMs}ms`
    );
  });
}

/**
 * Execute a Redis operation with circuit breaker protection,
 * returning a result object instead of throwing on circuit open.
 *
 * @param fn - The Redis operation to execute
 * @param options - Optional configuration
 * @returns Result object with success flag and result/error
 */
export async function withRedisCircuitBreakerResult<T>(
  fn: () => Promise<T>,
  options: {
    operationName?: string;
    timeoutMs?: number;
  } = {}
): Promise<{
  success: boolean;
  result?: T;
  error?: Error;
  circuitOpen: boolean;
}> {
  const operationName = options.operationName ?? 'unknown';
  const timeoutMs = options.timeoutMs ?? REDIS_OPERATION_TIMEOUT_MS;

  return withCircuitBreakerResult(REDIS_SERVICE_NAME, async () => {
    return withTimeout(
      fn(),
      timeoutMs,
      `Redis operation '${operationName}' timed out after ${timeoutMs}ms`
    );
  });
}

// =============================================================================
// Graceful Fallback Functions
// =============================================================================

/**
 * Rate limiting with graceful Redis fallback.
 *
 * When Redis is down:
 * - Logs a warning
 * - Allows the request to proceed (fail-open for availability)
 * - Returns a result indicating fallback mode
 *
 * @param key - Rate limit key (e.g., 'ratelimit:tenant:123:minute')
 * @param limit - Maximum requests allowed in the window
 * @param windowSeconds - Window duration in seconds
 * @returns Rate limit result with remaining requests and fallback status
 *
 * @example
 * ```typescript
 * const result = await rateLimitWithFallback(
 *   `ratelimit:${tenantId}:minute`,
 *   100,
 *   60
 * );
 *
 * if (!result.allowed) {
 *   return reply.status(429).send({ error: 'Rate limit exceeded' });
 * }
 *
 * if (result.fallbackMode) {
 *   // Log that we're operating without rate limit protection
 *   logger.warn({ tenantId }, 'Rate limiting in fallback mode');
 * }
 * ```
 */
export async function rateLimitWithFallback(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
  fallbackMode: boolean;
}> {
  const redis = getRedis();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const resetAt = Math.ceil((now + windowMs) / 1000);

  const result = await withRedisCircuitBreakerResult(
    async () => {
      // Use Redis INCR with EXPIRE for rate limiting
      const currentCount = await redis.incr(key);

      // Set expiry on first request in window
      if (currentCount === 1) {
        await redis.expire(key, windowSeconds);
      }

      return currentCount;
    },
    { operationName: 'rateLimit' }
  );

  if (result.circuitOpen || !result.success) {
    // Redis unavailable - allow request but log warning
    logger.warn(
      { key, limit, windowSeconds, reason: result.circuitOpen ? 'circuit_open' : 'redis_error' },
      'Rate limiting unavailable - allowing request in fallback mode'
    );

    return {
      allowed: true,
      remaining: limit, // Assume full limit available
      resetAt,
      fallbackMode: true,
    };
  }

  const currentCount = result.result!;
  const allowed = currentCount <= limit;
  const remaining = Math.max(0, limit - currentCount);

  return {
    allowed,
    remaining,
    resetAt,
    fallbackMode: false,
  };
}

/**
 * Distributed lock with graceful Redis fallback.
 *
 * When Redis is down:
 * - Falls back to in-memory mutex (single instance only!)
 * - Logs a warning about single-instance limitation
 * - Still provides mutual exclusion within the current process
 *
 * @param key - Lock key
 * @param ownerId - Unique identifier for the lock owner
 * @param ttlMs - Lock time-to-live in milliseconds
 * @param options - Optional configuration
 * @returns Lock result with fallback status
 *
 * @example
 * ```typescript
 * const lock = await acquireLockWithFallback(
 *   `lock:order:${orderId}`,
 *   `worker:${workerId}`,
 *   30000 // 30 seconds
 * );
 *
 * if (!lock.acquired) {
 *   return { error: 'Could not acquire lock' };
 * }
 *
 * try {
 *   if (lock.fallbackMode) {
 *     logger.warn({ orderId }, 'Using in-memory lock - not distributed!');
 *   }
 *   // Process order...
 * } finally {
 *   await releaseLockWithFallback(lock.key, lock.ownerId);
 * }
 * ```
 */
export async function acquireLockWithFallback(
  key: string,
  ownerId: string,
  ttlMs: number,
  options: {
    waitTimeoutMs?: number;
  } = {}
): Promise<{
  acquired: boolean;
  key: string;
  ownerId: string;
  fallbackMode: boolean;
  release: () => Promise<boolean>;
}> {
  const redis = getRedis();
  const ttlSeconds = Math.ceil(ttlMs / 1000);

  const result = await withRedisCircuitBreakerResult(
    async () => {
      // Try to acquire lock with NX (only if not exists) and EX (expiry)
      const acquired = await redis.set(key, ownerId, 'EX', ttlSeconds, 'NX');
      return acquired === 'OK';
    },
    { operationName: 'acquireLock' }
  );

  if (result.circuitOpen || !result.success) {
    // Redis unavailable - fall back to in-memory mutex
    logger.warn(
      { key, ownerId, ttlMs, reason: result.circuitOpen ? 'circuit_open' : 'redis_error' },
      'Distributed lock unavailable - using in-memory mutex (single instance only!)'
    );

    const acquired = await inMemoryMutex.acquire(
      key,
      ownerId,
      ttlMs,
      options.waitTimeoutMs ?? 0
    );

    return {
      acquired,
      key,
      ownerId,
      fallbackMode: true,
      release: () => Promise.resolve(inMemoryMutex.release(key, ownerId)),
    };
  }

  const acquired = result.result!;

  return {
    acquired,
    key,
    ownerId,
    fallbackMode: false,
    release: async () => {
      const releaseResult = await withRedisCircuitBreakerResult(
        async () => {
          // Use Lua script for atomic check-and-delete
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          const released = await redis.eval(script, 1, key, ownerId);
          return released === 1;
        },
        { operationName: 'releaseLock' }
      );

      if (releaseResult.circuitOpen || !releaseResult.success) {
        logger.warn({ key, ownerId }, 'Could not release Redis lock - circuit open or error');
        return false;
      }

      return releaseResult.result!;
    },
  };
}

/**
 * Release a distributed lock with fallback support.
 *
 * @param key - Lock key
 * @param ownerId - Lock owner identifier
 * @returns Whether the lock was successfully released
 */
export async function releaseLockWithFallback(key: string, ownerId: string): Promise<boolean> {
  const redis = getRedis();

  const result = await withRedisCircuitBreakerResult(
    async () => {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const released = await redis.eval(script, 1, key, ownerId);
      return released === 1;
    },
    { operationName: 'releaseLock' }
  );

  if (result.circuitOpen || !result.success) {
    // Try in-memory mutex as fallback
    return inMemoryMutex.release(key, ownerId);
  }

  return result.result!;
}

/**
 * Cache get with graceful Redis fallback.
 *
 * When Redis is down:
 * - Returns null/undefined (cache miss)
 * - Caller should then query the database directly
 * - Logs a warning about cache bypass
 *
 * @param key - Cache key
 * @param options - Optional configuration
 * @returns Cached value or null if not found or Redis unavailable
 *
 * @example
 * ```typescript
 * const cached = await cacheGetWithFallback<UserData>(`user:${userId}`);
 *
 * if (cached.value) {
 *   return cached.value;
 * }
 *
 * if (cached.fallbackMode) {
 *   logger.debug({ userId }, 'Cache bypassed - querying database');
 * }
 *
 * // Query database and optionally cache the result
 * const user = await db.select().from(users).where(eq(users.id, userId));
 * await cacheSetWithFallback(`user:${userId}`, user, 300);
 * return user;
 * ```
 */
export async function cacheGetWithFallback<T>(
  key: string,
  options: {
    parse?: boolean; // Default: true (JSON parse the value)
  } = {}
): Promise<{
  value: T | null;
  fallbackMode: boolean;
}> {
  const redis = getRedis();
  const parse = options.parse ?? true;

  const result = await withRedisCircuitBreakerResult(
    async () => redis.get(key),
    { operationName: 'cacheGet' }
  );

  if (result.circuitOpen || !result.success) {
    logger.debug(
      { key, reason: result.circuitOpen ? 'circuit_open' : 'redis_error' },
      'Cache unavailable - treating as cache miss'
    );

    return {
      value: null,
      fallbackMode: true,
    };
  }

  const rawValue = result.result;
  if (rawValue === null || rawValue === undefined) {
    return {
      value: null,
      fallbackMode: false,
    };
  }

  try {
    const value = parse ? (JSON.parse(rawValue) as T) : (rawValue as unknown as T);
    return {
      value,
      fallbackMode: false,
    };
  } catch (error) {
    logger.warn({ key, error }, 'Failed to parse cached value');
    return {
      value: null,
      fallbackMode: false,
    };
  }
}

/**
 * Cache set with graceful Redis fallback.
 *
 * When Redis is down:
 * - Logs a warning about cache write failure
 * - Returns false to indicate the value was not cached
 * - Does not throw an error
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time-to-live in seconds
 * @returns Whether the value was successfully cached
 */
export async function cacheSetWithFallback<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<{
  success: boolean;
  fallbackMode: boolean;
}> {
  const redis = getRedis();
  const serialized = JSON.stringify(value);

  const result = await withRedisCircuitBreakerResult(
    async () => {
      await redis.setex(key, ttlSeconds, serialized);
      return true;
    },
    { operationName: 'cacheSet' }
  );

  if (result.circuitOpen || !result.success) {
    logger.debug(
      { key, ttlSeconds, reason: result.circuitOpen ? 'circuit_open' : 'redis_error' },
      'Cache unavailable - value not cached'
    );

    return {
      success: false,
      fallbackMode: true,
    };
  }

  return {
    success: true,
    fallbackMode: false,
  };
}

/**
 * Cache delete with graceful Redis fallback.
 *
 * @param key - Cache key to delete
 * @returns Whether the key was successfully deleted
 */
export async function cacheDeleteWithFallback(key: string): Promise<{
  success: boolean;
  fallbackMode: boolean;
}> {
  const redis = getRedis();

  const result = await withRedisCircuitBreakerResult(
    async () => {
      const deleted = await redis.del(key);
      return deleted > 0;
    },
    { operationName: 'cacheDelete' }
  );

  if (result.circuitOpen || !result.success) {
    logger.debug(
      { key, reason: result.circuitOpen ? 'circuit_open' : 'redis_error' },
      'Cache unavailable - delete skipped'
    );

    return {
      success: false,
      fallbackMode: true,
    };
  }

  return {
    success: result.result!,
    fallbackMode: false,
  };
}

// =============================================================================
// Circuit Breaker Management
// =============================================================================

/**
 * Force the Redis circuit breaker to open state.
 */
export async function forceRedisCircuitOpen(): Promise<void> {
  const breaker = getRedisCircuitBreaker();
  await breaker.forceOpen();
  logger.warn({}, 'Redis circuit breaker manually opened');
}

/**
 * Force the Redis circuit breaker to closed state.
 */
export async function forceRedisCircuitClose(): Promise<void> {
  const breaker = getRedisCircuitBreaker();
  await breaker.forceClose();
  logger.info({}, 'Redis circuit breaker manually closed');
}

/**
 * Reset the Redis circuit breaker.
 */
export async function resetRedisCircuit(): Promise<void> {
  const breaker = getRedisCircuitBreaker();
  await breaker.reset();
  logger.info({}, 'Redis circuit breaker reset');
}

/**
 * Redis health check with circuit breaker status.
 */
export async function checkRedisHealthWithCircuit(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  circuit: {
    state: CircuitState;
    failureCount: number;
    failureThreshold: number;
    timeUntilReset: number | null;
  };
}> {
  const breaker = getRedisCircuitBreaker();
  const status = await breaker.getStatus();

  // If circuit is open, don't even try to check Redis
  if (status.state === 'OPEN') {
    return {
      healthy: false,
      error: 'Circuit breaker is OPEN - Redis marked as unavailable',
      circuit: {
        state: status.state,
        failureCount: status.failureCount,
        failureThreshold: status.failureThreshold,
        timeUntilReset: status.timeUntilReset,
      },
    };
  }

  const redis = getRedis();
  const start = performance.now();

  try {
    const result = await withRedisCircuitBreakerResult(
      async () => redis.ping(),
      { operationName: 'healthCheck', timeoutMs: 5000 }
    );

    const latencyMs = Math.round(performance.now() - start);
    const updatedStatus = await breaker.getStatus();

    if (result.circuitOpen) {
      return {
        healthy: false,
        latencyMs,
        error: 'Circuit breaker is OPEN',
        circuit: {
          state: updatedStatus.state,
          failureCount: updatedStatus.failureCount,
          failureThreshold: updatedStatus.failureThreshold,
          timeUntilReset: updatedStatus.timeUntilReset,
        },
      };
    }

    const isHealthy = result.success && result.result === 'PONG';

    return {
      healthy: isHealthy,
      latencyMs,
      error: result.success ? undefined : result.error?.message,
      circuit: {
        state: updatedStatus.state,
        failureCount: updatedStatus.failureCount,
        failureThreshold: updatedStatus.failureThreshold,
        timeUntilReset: updatedStatus.timeUntilReset,
      },
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    const updatedStatus = await breaker.getStatus();

    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error',
      circuit: {
        state: updatedStatus.state,
        failureCount: updatedStatus.failureCount,
        failureThreshold: updatedStatus.failureThreshold,
        timeUntilReset: updatedStatus.timeUntilReset,
      },
    };
  }
}

/**
 * Stop the in-memory mutex fallback.
 * Call this during graceful shutdown.
 */
export function stopInMemoryMutex(): void {
  inMemoryMutex.stop();
}
