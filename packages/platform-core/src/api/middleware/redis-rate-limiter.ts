/**
 * Redis-Backed Distributed Rate Limiter
 *
 * Provides distributed rate limiting using Redis for multi-instance deployments.
 * Implements sliding window rate limiting with atomic Lua scripts for accuracy.
 *
 * Features:
 * - Sliding window algorithm for accurate rate limiting
 * - Multiple windows (per-minute, per-hour, burst)
 * - Atomic operations using Redis Lua scripts
 * - Per-user, per-IP, per-endpoint, and tenant-level limits
 * - Graceful fallback to in-memory when Redis is unavailable
 * - Rate limit headers in response
 * - OpenTelemetry tracing integration
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Redis } from 'ioredis';
import { trace, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { getRedis, checkRedisHealth } from '../../common/redis.js';
import { getConfig } from '../../common/config.js';
import { createLogger } from '../../common/logger.js';
import { getTraceContext } from '../../common/trace.js';
import type { VorionErrorResponse } from '../../common/contracts/output.js';

const logger = createLogger({ component: 'redis-rate-limiter' });
const tracer = trace.getTracer('vorion-redis-rate-limiter');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Rate limit window configuration
 */
export interface RateLimitWindow {
  /** Maximum requests allowed in this window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * Multi-window rate limit configuration
 */
export interface MultiWindowRateLimitConfig {
  /** Per-minute rate limit */
  perMinute?: RateLimitWindow;
  /** Per-hour rate limit */
  perHour?: RateLimitWindow;
  /** Burst limit (per-second) */
  burst?: RateLimitWindow;
}

/**
 * Rate limiter configuration
 */
export interface RedisRateLimiterConfig {
  /** Redis key prefix for rate limit data */
  keyPrefix: string;
  /** Default rate limits for all requests */
  defaultLimits: MultiWindowRateLimitConfig;
  /** Per-endpoint overrides (URL pattern -> limits) */
  endpointOverrides?: Record<string, Partial<MultiWindowRateLimitConfig>>;
  /** Per-tenant limit multipliers (tenantId -> multiplier) */
  tenantMultipliers?: Record<string, number>;
  /** Global tenant limits (separate from per-endpoint) */
  tenantGlobalLimits?: MultiWindowRateLimitConfig;
  /** Skip rate limiting for certain requests */
  skip?: (request: FastifyRequest) => boolean;
  /** Custom error message */
  errorMessage?: string;
  /** Enable graceful degradation (allow requests when Redis fails) */
  gracefulDegradation?: boolean;
  /** Log warnings when falling back to in-memory */
  logFallbackWarnings?: boolean;
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Results per window */
  windows: {
    minute?: WindowResult;
    hour?: WindowResult;
    burst?: WindowResult;
  };
  /** Which window caused the rejection (if any) */
  limitedBy?: 'minute' | 'hour' | 'burst';
  /** Retry-after value in seconds */
  retryAfter?: number;
  /** Whether result came from fallback (in-memory) */
  fromFallback: boolean;
}

/**
 * Result for a single rate limit window
 */
export interface WindowResult {
  /** Current request count in window */
  current: number;
  /** Maximum allowed requests */
  limit: number;
  /** Remaining requests in window */
  remaining: number;
  /** Unix timestamp when window resets */
  resetAt: number;
}

// ============================================================================
// Lua Scripts for Atomic Operations
// ============================================================================

/**
 * Lua script for sliding window rate limit check and increment.
 *
 * Uses sorted sets with timestamps as scores for precise sliding window.
 * Atomically removes expired entries, checks limit, and adds new request.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = current timestamp (milliseconds)
 * ARGV[2] = window size (milliseconds)
 * ARGV[3] = limit
 * ARGV[4] = unique request ID (for the sorted set member)
 *
 * Returns: [current_count, is_allowed (0/1), reset_at]
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local requestId = ARGV[4]

-- Remove expired entries (older than window)
local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

-- Get current count
local currentCount = redis.call('ZCARD', key)

-- Check if under limit
local allowed = 0
if currentCount < limit then
  -- Add new request
  redis.call('ZADD', key, now, requestId)
  currentCount = currentCount + 1
  allowed = 1
end

-- Set TTL on the key (window size + 1 second buffer)
redis.call('PEXPIRE', key, windowMs + 1000)

-- Calculate reset time (when oldest entry expires)
local oldestScore = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = now + windowMs
if #oldestScore >= 2 then
  resetAt = tonumber(oldestScore[2]) + windowMs
end

return {currentCount, allowed, resetAt}
`;

/**
 * Lua script for multi-window rate limit check.
 *
 * Checks multiple windows atomically in a single Redis call.
 *
 * KEYS[1] = burst key (per-second)
 * KEYS[2] = minute key
 * KEYS[3] = hour key
 * ARGV[1] = current timestamp (milliseconds)
 * ARGV[2] = burst window (milliseconds)
 * ARGV[3] = burst limit
 * ARGV[4] = minute window (milliseconds)
 * ARGV[5] = minute limit
 * ARGV[6] = hour window (milliseconds)
 * ARGV[7] = hour limit
 * ARGV[8] = unique request ID
 *
 * Returns: [
 *   burst_count, burst_allowed, burst_reset,
 *   minute_count, minute_allowed, minute_reset,
 *   hour_count, hour_allowed, hour_reset,
 *   overall_allowed (0/1)
 * ]
 */
const MULTI_WINDOW_SCRIPT = `
local burstKey = KEYS[1]
local minuteKey = KEYS[2]
local hourKey = KEYS[3]

local now = tonumber(ARGV[1])
local burstWindowMs = tonumber(ARGV[2])
local burstLimit = tonumber(ARGV[3])
local minuteWindowMs = tonumber(ARGV[4])
local minuteLimit = tonumber(ARGV[5])
local hourWindowMs = tonumber(ARGV[6])
local hourLimit = tonumber(ARGV[7])
local requestId = ARGV[8]

-- Helper function to check window
local function checkWindow(key, windowMs, limit)
  local windowStart = now - windowMs
  redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
  local count = redis.call('ZCARD', key)
  local allowed = count < limit and 1 or 0

  local oldestScore = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + windowMs
  if #oldestScore >= 2 then
    resetAt = tonumber(oldestScore[2]) + windowMs
  end

  return {count, allowed, resetAt}
end

-- Check all windows first (without incrementing)
local burstResult = checkWindow(burstKey, burstWindowMs, burstLimit)
local minuteResult = checkWindow(minuteKey, minuteWindowMs, minuteLimit)
local hourResult = checkWindow(hourKey, hourWindowMs, hourLimit)

-- Overall allowed only if all windows allow
local overallAllowed = 0
if burstResult[2] == 1 and minuteResult[2] == 1 and hourResult[2] == 1 then
  overallAllowed = 1

  -- Add to all windows
  redis.call('ZADD', burstKey, now, requestId)
  redis.call('ZADD', minuteKey, now, requestId)
  redis.call('ZADD', hourKey, now, requestId)

  -- Update counts
  burstResult[1] = burstResult[1] + 1
  minuteResult[1] = minuteResult[1] + 1
  hourResult[1] = hourResult[1] + 1

  -- Set TTLs
  redis.call('PEXPIRE', burstKey, burstWindowMs + 1000)
  redis.call('PEXPIRE', minuteKey, minuteWindowMs + 1000)
  redis.call('PEXPIRE', hourKey, hourWindowMs + 1000)
end

return {
  burstResult[1], burstResult[2], burstResult[3],
  minuteResult[1], minuteResult[2], minuteResult[3],
  hourResult[1], hourResult[2], hourResult[3],
  overallAllowed
}
`;

// ============================================================================
// In-Memory Fallback Store
// ============================================================================

/**
 * In-memory sliding window entry with LRU tracking
 */
interface InMemoryWindowEntry {
  timestamps: number[];
  lastCleanup: number;
  lastAccess: number; // For LRU eviction
}

/**
 * LRU eviction entry for sorted index
 */
interface LruEntry {
  key: string;
  lastAccess: number;
  expiresAt: number; // Earliest expiration time based on oldest timestamp
}

/**
 * Maximum entries in the fallback store before LRU eviction kicks in
 */
const FALLBACK_STORE_MAX_SIZE = 10_000;

/**
 * Batch size for cleanup operations to avoid blocking
 */
const CLEANUP_BATCH_SIZE = 500;

/**
 * In-memory fallback store for when Redis is unavailable.
 * Implements LRU eviction when max size is reached.
 */
class InMemoryFallbackStore {
  private windows: Map<string, InMemoryWindowEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxSize: number;

  // Sorted index for efficient expiration-based cleanup
  private expirationIndex: LruEntry[] = [];
  private indexDirty = false;

  constructor(maxSize: number = FALLBACK_STORE_MAX_SIZE) {
    this.maxSize = maxSize;
    // Cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    this.cleanupInterval.unref();
  }

  /**
   * Check and increment rate limit counter
   */
  check(key: string, windowMs: number, limit: number): WindowResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      // Check if we need to evict before adding
      if (this.windows.size >= this.maxSize) {
        this.evictLruEntries(Math.max(1, Math.floor(this.maxSize * 0.1))); // Evict 10%
      }
      entry = { timestamps: [], lastCleanup: now, lastAccess: now };
      this.windows.set(key, entry);
      this.indexDirty = true;
    } else {
      // Update last access time for LRU tracking
      entry.lastAccess = now;
    }

    // Clean up old entries
    if (now - entry.lastCleanup > 1000) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
      entry.lastCleanup = now;
      this.indexDirty = true;
    }

    const currentCount = entry.timestamps.length;
    const allowed = currentCount < limit;

    if (allowed) {
      entry.timestamps.push(now);
    }

    // Calculate reset time
    const oldestTimestamp = entry.timestamps[0] ?? now;
    const resetAt = Math.ceil((oldestTimestamp + windowMs) / 1000);

    return {
      current: allowed ? currentCount + 1 : currentCount,
      limit,
      remaining: Math.max(0, limit - (allowed ? currentCount + 1 : currentCount)),
      resetAt,
    };
  }

  /**
   * Evict least recently used entries
   */
  private evictLruEntries(count: number): void {
    if (this.windows.size === 0) return;

    // Build sorted list by last access time (oldest first)
    const entries = Array.from(this.windows.entries())
      .map(([key, entry]) => ({ key, lastAccess: entry.lastAccess }))
      .sort((a, b) => a.lastAccess - b.lastAccess);

    // Evict the oldest entries
    const toEvict = Math.min(count, entries.length);
    for (let i = 0; i < toEvict; i++) {
      this.windows.delete(entries[i]!.key);
    }

    this.indexDirty = true;
  }

  /**
   * Cleanup expired entries using batched processing
   * Uses expiration index for O(1) per-entry lookup instead of O(n) scan
   */
  private cleanup(): void {
    const now = Date.now();
    const maxWindowMs = 3600000; // 1 hour
    const expirationThreshold = now - maxWindowMs;

    // Rebuild expiration index if dirty
    if (this.indexDirty) {
      this.rebuildExpirationIndex(maxWindowMs);
    }

    // Process expired entries from the sorted index
    let processed = 0;
    const toDelete: string[] = [];

    // Find entries to delete (sorted by expiration, so we can stop early)
    for (const entry of this.expirationIndex) {
      if (entry.expiresAt > now) {
        break; // All remaining entries have not expired yet
      }

      const windowEntry = this.windows.get(entry.key);
      if (!windowEntry) {
        toDelete.push(entry.key);
        continue;
      }

      // Clean timestamps within the entry
      const originalLength = windowEntry.timestamps.length;
      windowEntry.timestamps = windowEntry.timestamps.filter((ts) => ts > expirationThreshold);

      if (windowEntry.timestamps.length === 0) {
        toDelete.push(entry.key);
      } else if (windowEntry.timestamps.length !== originalLength) {
        this.indexDirty = true;
      }

      processed++;
      if (processed >= CLEANUP_BATCH_SIZE) {
        break; // Process remaining in next cleanup cycle
      }
    }

    // Batch delete expired entries
    for (const key of toDelete) {
      this.windows.delete(key);
    }

    if (toDelete.length > 0) {
      this.indexDirty = true;
    }

    // Remove deleted entries from expiration index
    if (toDelete.length > 0) {
      const toDeleteSet = new Set(toDelete);
      this.expirationIndex = this.expirationIndex.filter((e) => !toDeleteSet.has(e.key));
    }
  }

  /**
   * Rebuild the expiration index sorted by earliest expiration time
   */
  private rebuildExpirationIndex(maxWindowMs: number): void {
    this.expirationIndex = Array.from(this.windows.entries()).map(([key, entry]) => {
      const oldestTimestamp = entry.timestamps[0] ?? entry.lastAccess;
      return {
        key,
        lastAccess: entry.lastAccess,
        expiresAt: oldestTimestamp + maxWindowMs,
      };
    });

    // Sort by expiration time (earliest first)
    this.expirationIndex.sort((a, b) => a.expiresAt - b.expiresAt);
    this.indexDirty = false;
  }

  /**
   * Get statistics
   */
  getStats(): { activeKeys: number; maxSize: number; utilizationPercent: number } {
    return {
      activeKeys: this.windows.size,
      maxSize: this.maxSize,
      utilizationPercent: Math.round((this.windows.size / this.maxSize) * 100),
    };
  }

  /**
   * Stop the cleanup timer
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
    this.expirationIndex = [];
  }
}

// ============================================================================
// Redis Rate Limiter Class
// ============================================================================

/**
 * Redis-backed distributed rate limiter
 */
export class RedisRateLimiter {
  private config: RedisRateLimiterConfig;
  private redis: Redis | null = null;
  private fallbackStore: InMemoryFallbackStore;
  private scriptSha: string | null = null;
  private multiWindowScriptSha: string | null = null;
  private redisAvailable: boolean = true;
  private lastHealthCheck: number = 0;
  private healthCheckIntervalMs: number = 5000;
  private readonly instanceId: string;

  constructor(config: Partial<RedisRateLimiterConfig> = {}) {
    this.config = {
      keyPrefix: 'vorion:ratelimit',
      defaultLimits: {
        perMinute: { limit: 100, windowSeconds: 60 },
        perHour: { limit: 1000, windowSeconds: 3600 },
        burst: { limit: 10, windowSeconds: 1 },
      },
      gracefulDegradation: true,
      logFallbackWarnings: true,
      ...config,
    };

    this.fallbackStore = new InMemoryFallbackStore();
    this.instanceId = crypto.randomUUID();
  }

  /**
   * Initialize Redis connection and load Lua scripts
   */
  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      if (config.env === 'development' && config.lite?.redisOptional) {
        logger.info('Redis is optional in lite mode, using in-memory fallback');
        this.redisAvailable = false;
        return;
      }

      this.redis = getRedis();

      // Load Lua scripts
      this.scriptSha = await this.redis.script('LOAD', SLIDING_WINDOW_SCRIPT) as string;
      this.multiWindowScriptSha = await this.redis.script('LOAD', MULTI_WINDOW_SCRIPT) as string;

      logger.info(
        { scriptSha: this.scriptSha, multiWindowScriptSha: this.multiWindowScriptSha },
        'Redis rate limiter initialized with Lua scripts'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis rate limiter');

      if (this.config.gracefulDegradation) {
        this.redisAvailable = false;
        logger.warn('Falling back to in-memory rate limiting');
      } else {
        throw error;
      }
    }
  }

  /**
   * Check rate limit and periodic Redis health
   */
  private async checkRedisAvailability(): Promise<boolean> {
    const now = Date.now();

    // Don't check too frequently
    if (now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return this.redisAvailable;
    }

    this.lastHealthCheck = now;

    try {
      const health = await checkRedisHealth(1000);
      const wasAvailable = this.redisAvailable;
      this.redisAvailable = health.healthy;

      if (!wasAvailable && this.redisAvailable) {
        logger.info('Redis connection restored, switching back to Redis rate limiting');
        // Reload scripts
        await this.initialize();
      } else if (wasAvailable && !this.redisAvailable) {
        logger.warn({ error: health.error }, 'Redis unavailable, using in-memory fallback');
      }

      return this.redisAvailable;
    } catch {
      this.redisAvailable = false;
      return false;
    }
  }

  /**
   * Generate rate limit key
   */
  private generateKey(
    type: 'user' | 'ip' | 'endpoint' | 'tenant',
    identifier: string,
    window: 'burst' | 'minute' | 'hour'
  ): string {
    return `${this.config.keyPrefix}:${type}:${identifier}:${window}`;
  }

  /**
   * Check rate limit for a request using multiple windows
   */
  async checkMultiWindow(
    identifier: string,
    type: 'user' | 'ip' | 'endpoint' | 'tenant',
    limits: MultiWindowRateLimitConfig
  ): Promise<RateLimitCheckResult> {
    const isRedisAvailable = await this.checkRedisAvailability();

    if (isRedisAvailable && this.redis && this.multiWindowScriptSha) {
      return this.checkMultiWindowRedis(identifier, type, limits);
    }

    return this.checkMultiWindowInMemory(identifier, type, limits);
  }

  /**
   * Check multi-window rate limit using Redis
   */
  private async checkMultiWindowRedis(
    identifier: string,
    type: 'user' | 'ip' | 'endpoint' | 'tenant',
    limits: MultiWindowRateLimitConfig
  ): Promise<RateLimitCheckResult> {
    const now = Date.now();
    const requestId = `${this.instanceId}:${now}:${Math.random().toString(36).slice(2)}`;

    // Generate keys
    const burstKey = this.generateKey(type, identifier, 'burst');
    const minuteKey = this.generateKey(type, identifier, 'minute');
    const hourKey = this.generateKey(type, identifier, 'hour');

    // Get limits with defaults
    const burstLimit = limits.burst?.limit ?? 10;
    const burstWindow = (limits.burst?.windowSeconds ?? 1) * 1000;
    const minuteLimit = limits.perMinute?.limit ?? 100;
    const minuteWindow = (limits.perMinute?.windowSeconds ?? 60) * 1000;
    const hourLimit = limits.perHour?.limit ?? 1000;
    const hourWindow = (limits.perHour?.windowSeconds ?? 3600) * 1000;

    try {
      const result = (await this.redis!.evalsha(
        this.multiWindowScriptSha!,
        3,
        burstKey,
        minuteKey,
        hourKey,
        now.toString(),
        burstWindow.toString(),
        burstLimit.toString(),
        minuteWindow.toString(),
        minuteLimit.toString(),
        hourWindow.toString(),
        hourLimit.toString(),
        requestId
      )) as number[];

      const [
        burstCount,
        burstAllowed,
        burstReset,
        minuteCount,
        minuteAllowed,
        minuteReset,
        hourCount,
        hourAllowed,
        hourReset,
        overallAllowed,
      ] = result;

      // Determine which window caused the rejection
      let limitedBy: 'burst' | 'minute' | 'hour' | undefined;
      let retryAfter: number | undefined;

      if (overallAllowed === 0) {
        if (burstAllowed === 0) {
          limitedBy = 'burst';
          retryAfter = Math.ceil((burstReset - now) / 1000);
        } else if (minuteAllowed === 0) {
          limitedBy = 'minute';
          retryAfter = Math.ceil((minuteReset - now) / 1000);
        } else if (hourAllowed === 0) {
          limitedBy = 'hour';
          retryAfter = Math.ceil((hourReset - now) / 1000);
        }
      }

      return {
        allowed: overallAllowed === 1,
        windows: {
          burst: {
            current: burstCount,
            limit: burstLimit,
            remaining: Math.max(0, burstLimit - burstCount),
            resetAt: Math.ceil(burstReset / 1000),
          },
          minute: {
            current: minuteCount,
            limit: minuteLimit,
            remaining: Math.max(0, minuteLimit - minuteCount),
            resetAt: Math.ceil(minuteReset / 1000),
          },
          hour: {
            current: hourCount,
            limit: hourLimit,
            remaining: Math.max(0, hourLimit - hourCount),
            resetAt: Math.ceil(hourReset / 1000),
          },
        },
        limitedBy,
        retryAfter: retryAfter ? Math.max(1, retryAfter) : undefined,
        fromFallback: false,
      };
    } catch (error) {
      logger.error({ error, identifier, type }, 'Redis rate limit check failed');

      if (this.config.gracefulDegradation) {
        this.redisAvailable = false;
        return this.checkMultiWindowInMemory(identifier, type, limits);
      }

      throw error;
    }
  }

  /**
   * Check multi-window rate limit using in-memory fallback
   */
  private checkMultiWindowInMemory(
    identifier: string,
    type: 'user' | 'ip' | 'endpoint' | 'tenant',
    limits: MultiWindowRateLimitConfig
  ): RateLimitCheckResult {
    if (this.config.logFallbackWarnings) {
      logger.debug({ identifier, type }, 'Using in-memory rate limit fallback');
    }

    // Get limits with defaults
    const burstLimit = limits.burst?.limit ?? 10;
    const burstWindow = (limits.burst?.windowSeconds ?? 1) * 1000;
    const minuteLimit = limits.perMinute?.limit ?? 100;
    const minuteWindow = (limits.perMinute?.windowSeconds ?? 60) * 1000;
    const hourLimit = limits.perHour?.limit ?? 1000;
    const hourWindow = (limits.perHour?.windowSeconds ?? 3600) * 1000;

    // Check each window
    const burstKey = this.generateKey(type, identifier, 'burst');
    const minuteKey = this.generateKey(type, identifier, 'minute');
    const hourKey = this.generateKey(type, identifier, 'hour');

    // Check without incrementing first
    const burstResult = this.fallbackStore.check(burstKey, burstWindow, burstLimit);
    const minuteResult = this.fallbackStore.check(minuteKey, minuteWindow, minuteLimit);
    const hourResult = this.fallbackStore.check(hourKey, hourWindow, hourLimit);

    // Determine overall allowed and limiting window
    let allowed = true;
    let limitedBy: 'burst' | 'minute' | 'hour' | undefined;
    let retryAfter: number | undefined;
    const now = Math.ceil(Date.now() / 1000);

    if (burstResult.remaining === 0) {
      allowed = false;
      limitedBy = 'burst';
      retryAfter = Math.max(1, burstResult.resetAt - now);
    } else if (minuteResult.remaining === 0) {
      allowed = false;
      limitedBy = 'minute';
      retryAfter = Math.max(1, minuteResult.resetAt - now);
    } else if (hourResult.remaining === 0) {
      allowed = false;
      limitedBy = 'hour';
      retryAfter = Math.max(1, hourResult.resetAt - now);
    }

    return {
      allowed,
      windows: {
        burst: burstResult,
        minute: minuteResult,
        hour: hourResult,
      },
      limitedBy,
      retryAfter,
      fromFallback: true,
    };
  }

  /**
   * Get effective limits for a request
   */
  getEffectiveLimits(
    endpoint: string,
    tenantId?: string
  ): MultiWindowRateLimitConfig {
    let limits = { ...this.config.defaultLimits };

    // Apply endpoint overrides
    if (this.config.endpointOverrides) {
      for (const [pattern, overrides] of Object.entries(this.config.endpointOverrides)) {
        if (this.matchEndpoint(endpoint, pattern)) {
          limits = this.mergeLimits(limits, overrides);
          break;
        }
      }
    }

    // Apply tenant multiplier
    if (tenantId && this.config.tenantMultipliers?.[tenantId]) {
      const multiplier = this.config.tenantMultipliers[tenantId];
      limits = this.applyMultiplier(limits, multiplier);
    }

    return limits;
  }

  /**
   * Match endpoint against pattern (supports wildcards)
   */
  private matchEndpoint(endpoint: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return endpoint.startsWith(prefix);
    }
    return endpoint === pattern;
  }

  /**
   * Merge limit configurations
   */
  private mergeLimits(
    base: MultiWindowRateLimitConfig,
    overrides: Partial<MultiWindowRateLimitConfig>
  ): MultiWindowRateLimitConfig {
    return {
      perMinute: overrides.perMinute ?? base.perMinute,
      perHour: overrides.perHour ?? base.perHour,
      burst: overrides.burst ?? base.burst,
    };
  }

  /**
   * Apply multiplier to limits
   */
  private applyMultiplier(
    limits: MultiWindowRateLimitConfig,
    multiplier: number
  ): MultiWindowRateLimitConfig {
    return {
      perMinute: limits.perMinute
        ? { ...limits.perMinute, limit: Math.ceil(limits.perMinute.limit * multiplier) }
        : undefined,
      perHour: limits.perHour
        ? { ...limits.perHour, limit: Math.ceil(limits.perHour.limit * multiplier) }
        : undefined,
      burst: limits.burst
        ? { ...limits.burst, limit: Math.ceil(limits.burst.limit * multiplier) }
        : undefined,
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    redisAvailable: boolean;
    fallbackActiveKeys: number;
    instanceId: string;
  } {
    return {
      redisAvailable: this.redisAvailable,
      fallbackActiveKeys: this.fallbackStore.getStats().activeKeys,
      instanceId: this.instanceId,
    };
  }

  /**
   * Stop the rate limiter
   */
  stop(): void {
    this.fallbackStore.stop();
    logger.info('Redis rate limiter stopped');
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

/** Type for preHandler hook function */
type PreHandlerFn = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Set rate limit response headers
 */
function setRateLimitHeaders(reply: FastifyReply, result: RateLimitCheckResult): void {
  // Use minute window as primary for headers
  const minuteWindow = result.windows.minute;
  if (minuteWindow) {
    reply.header('X-RateLimit-Limit', minuteWindow.limit);
    reply.header('X-RateLimit-Remaining', minuteWindow.remaining);
    reply.header('X-RateLimit-Reset', minuteWindow.resetAt);
  }

  // Add burst window headers
  const burstWindow = result.windows.burst;
  if (burstWindow) {
    reply.header('X-RateLimit-Burst-Limit', burstWindow.limit);
    reply.header('X-RateLimit-Burst-Remaining', burstWindow.remaining);
  }

  // Add hour window headers
  const hourWindow = result.windows.hour;
  if (hourWindow) {
    reply.header('X-RateLimit-Hour-Limit', hourWindow.limit);
    reply.header('X-RateLimit-Hour-Remaining', hourWindow.remaining);
  }

  if (result.retryAfter !== undefined) {
    reply.header('Retry-After', result.retryAfter);
  }

  // Indicate if using fallback
  if (result.fromFallback) {
    reply.header('X-RateLimit-Fallback', 'true');
  }
}

/**
 * Create rate limit error response
 */
function createRateLimitErrorResponse(
  result: RateLimitCheckResult,
  requestId: string,
  customMessage?: string
): VorionErrorResponse {
  const windowDetails: Record<string, unknown> = {};

  if (result.windows.burst) {
    windowDetails['burst'] = {
      limit: result.windows.burst.limit,
      remaining: result.windows.burst.remaining,
      resetAt: new Date(result.windows.burst.resetAt * 1000).toISOString(),
    };
  }
  if (result.windows.minute) {
    windowDetails['minute'] = {
      limit: result.windows.minute.limit,
      remaining: result.windows.minute.remaining,
      resetAt: new Date(result.windows.minute.resetAt * 1000).toISOString(),
    };
  }
  if (result.windows.hour) {
    windowDetails['hour'] = {
      limit: result.windows.hour.limit,
      remaining: result.windows.hour.remaining,
      resetAt: new Date(result.windows.hour.resetAt * 1000).toISOString(),
    };
  }

  return {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: customMessage ?? 'Too many requests. Please retry later.',
      details: {
        limitedBy: result.limitedBy,
        windows: windowDetails,
        retryAfter: result.retryAfter,
      },
      retryAfter: result.retryAfter,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Extract user ID from request
 */
function extractUserId(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: { sub?: string; id?: string } }).user;
  if (user?.sub) return user.sub;
  if (user?.id) return user.id;

  const auth = (request as FastifyRequest & { auth?: { userId?: string } }).auth;
  if (auth?.userId) return auth.userId;

  return null;
}

/**
 * Extract tenant ID from request
 */
function extractTenantId(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  if (user?.tenantId) return user.tenantId;

  const auth = (request as FastifyRequest & { auth?: { tenantId?: string } }).auth;
  if (auth?.tenantId) return auth.tenantId;

  const headerTenantId = request.headers['x-tenant-id'];
  if (typeof headerTenantId === 'string') return headerTenantId;

  return null;
}

/**
 * Extract client IP from request
 */
function extractClientIp(request: FastifyRequest): string {
  // Check forwarded headers (common in reverse proxy setups)
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string') return realIp;

  return request.ip ?? 'unknown';
}

// ============================================================================
// Global Rate Limiter Instance
// ============================================================================

let globalRateLimiter: RedisRateLimiter | null = null;

/**
 * Get or create the global Redis rate limiter
 */
export async function getRedisRateLimiter(
  config?: Partial<RedisRateLimiterConfig>
): Promise<RedisRateLimiter> {
  if (!globalRateLimiter) {
    globalRateLimiter = new RedisRateLimiter(config);
    await globalRateLimiter.initialize();
  }
  return globalRateLimiter;
}

/**
 * Reset the global rate limiter (for testing)
 */
export function resetRedisRateLimiter(): void {
  if (globalRateLimiter) {
    globalRateLimiter.stop();
    globalRateLimiter = null;
  }
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Create Redis-backed rate limiting middleware for per-user limits
 *
 * @param config - Rate limiter configuration
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * server.post('/api/data', {
 *   preHandler: await redisRateLimitPerUser({
 *     defaultLimits: {
 *       perMinute: { limit: 100, windowSeconds: 60 },
 *       perHour: { limit: 1000, windowSeconds: 3600 },
 *       burst: { limit: 10, windowSeconds: 1 },
 *     },
 *   }),
 * }, handler);
 * ```
 */
export async function redisRateLimitPerUser(
  config?: Partial<RedisRateLimiterConfig>
): Promise<PreHandlerFn> {
  const limiter = await getRedisRateLimiter(config);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id ?? 'unknown';
    const traceContext = getTraceContext();

    // Check skip condition
    if (config?.skip?.(request)) {
      return;
    }

    // Get user ID or fall back to IP
    const userId = extractUserId(request);
    const identifier = userId ?? `ip:${extractClientIp(request)}`;
    const type = userId ? 'user' : 'ip';

    // Get effective limits
    const endpoint = request.routeOptions?.url ?? request.url;
    const tenantId = extractTenantId(request) ?? undefined;
    const limits = limiter.getEffectiveLimits(endpoint, tenantId);

    return tracer.startActiveSpan(
      'redisRateLimit.checkUser',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'rateLimit.identifier': identifier,
          'rateLimit.type': type,
          'rateLimit.endpoint': endpoint,
          'request.id': requestId,
          ...(traceContext && { 'trace.id': traceContext.traceId }),
        },
      },
      async (span: Span) => {
        try {
          const result = await limiter.checkMultiWindow(identifier, type, limits);

          span.setAttribute('rateLimit.allowed', result.allowed);
          span.setAttribute('rateLimit.fromFallback', result.fromFallback);
          if (result.limitedBy) {
            span.setAttribute('rateLimit.limitedBy', result.limitedBy);
          }

          setRateLimitHeaders(reply, result);

          if (!result.allowed) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit exceeded' });
            span.end();

            logger.warn(
              {
                requestId,
                identifier,
                type,
                limitedBy: result.limitedBy,
                retryAfter: result.retryAfter,
                fromFallback: result.fromFallback,
              },
              'Rate limit exceeded'
            );

            const response = createRateLimitErrorResponse(result, requestId, config?.errorMessage);
            reply.status(429).send(response);
            return;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit check failed' });
          span.recordException(error as Error);
          span.end();

          logger.error({ error, requestId, identifier }, 'Rate limit check failed');

          if (config?.gracefulDegradation !== false) {
            logger.warn({ requestId }, 'Rate limiter failed, allowing request (graceful degradation)');
            return;
          }

          throw error;
        }
      }
    );
  };
}

/**
 * Create Redis-backed rate limiting middleware for per-IP limits
 * (for unauthenticated endpoints)
 */
export async function redisRateLimitPerIp(
  config?: Partial<RedisRateLimiterConfig>
): Promise<PreHandlerFn> {
  const limiter = await getRedisRateLimiter(config);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id ?? 'unknown';

    if (config?.skip?.(request)) {
      return;
    }

    const ip = extractClientIp(request);
    const endpoint = request.routeOptions?.url ?? request.url;
    const limits = limiter.getEffectiveLimits(endpoint);

    return tracer.startActiveSpan(
      'redisRateLimit.checkIp',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'rateLimit.ip': ip,
          'rateLimit.endpoint': endpoint,
          'request.id': requestId,
        },
      },
      async (span: Span) => {
        try {
          const result = await limiter.checkMultiWindow(ip, 'ip', limits);

          span.setAttribute('rateLimit.allowed', result.allowed);
          span.setAttribute('rateLimit.fromFallback', result.fromFallback);

          setRateLimitHeaders(reply, result);

          if (!result.allowed) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit exceeded' });
            span.end();

            logger.warn(
              { requestId, ip, limitedBy: result.limitedBy, retryAfter: result.retryAfter },
              'IP rate limit exceeded'
            );

            const response = createRateLimitErrorResponse(result, requestId, config?.errorMessage);
            reply.status(429).send(response);
            return;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit check failed' });
          span.recordException(error as Error);
          span.end();

          if (config?.gracefulDegradation !== false) {
            return;
          }
          throw error;
        }
      }
    );
  };
}

/**
 * Create Redis-backed rate limiting middleware for tenant-level global limits
 */
export async function redisRateLimitPerTenant(
  config?: Partial<RedisRateLimiterConfig>
): Promise<PreHandlerFn> {
  const limiter = await getRedisRateLimiter(config);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id ?? 'unknown';

    if (config?.skip?.(request)) {
      return;
    }

    const tenantId = extractTenantId(request);
    if (!tenantId) {
      // No tenant context, skip tenant-level limiting
      return;
    }

    // Use tenant global limits if configured, otherwise default
    const limits = config?.tenantGlobalLimits ?? limiter.getEffectiveLimits('*', tenantId);

    return tracer.startActiveSpan(
      'redisRateLimit.checkTenant',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'rateLimit.tenantId': tenantId,
          'request.id': requestId,
        },
      },
      async (span: Span) => {
        try {
          const result = await limiter.checkMultiWindow(tenantId, 'tenant', limits);

          span.setAttribute('rateLimit.allowed', result.allowed);
          span.setAttribute('rateLimit.fromFallback', result.fromFallback);

          // Add tenant-specific header
          reply.header('X-RateLimit-Tenant', tenantId);
          setRateLimitHeaders(reply, result);

          if (!result.allowed) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Tenant rate limit exceeded' });
            span.end();

            logger.warn(
              { requestId, tenantId, limitedBy: result.limitedBy, retryAfter: result.retryAfter },
              'Tenant rate limit exceeded'
            );

            const response = createRateLimitErrorResponse(
              result,
              requestId,
              config?.errorMessage ?? 'Tenant rate limit exceeded'
            );
            reply.status(429).send(response);
            return;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit check failed' });
          span.recordException(error as Error);
          span.end();

          if (config?.gracefulDegradation !== false) {
            return;
          }
          throw error;
        }
      }
    );
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Rate limiter factory options
 */
export interface RateLimiterFactoryOptions extends Partial<RedisRateLimiterConfig> {
  /** Force in-memory mode (for testing) */
  forceInMemory?: boolean;
}

/**
 * Create rate limiter middleware based on environment.
 *
 * Returns Redis-backed limiter in production and in-memory in development.
 *
 * @param options - Rate limiter options
 * @returns Object with middleware functions for different rate limiting strategies
 *
 * @example
 * ```typescript
 * const rateLimiter = await createRateLimiter({
 *   defaultLimits: {
 *     perMinute: { limit: 100, windowSeconds: 60 },
 *   },
 * });
 *
 * server.post('/api/data', {
 *   preHandler: rateLimiter.perUser,
 * }, handler);
 * ```
 */
export async function createRateLimiter(options: RateLimiterFactoryOptions = {}): Promise<{
  /** Per-user rate limiting (falls back to per-IP for unauthenticated) */
  perUser: PreHandlerFn;
  /** Per-IP rate limiting */
  perIp: PreHandlerFn;
  /** Per-tenant global rate limiting */
  perTenant: PreHandlerFn;
  /** Get rate limiter statistics */
  getStats: () => { redisAvailable: boolean; fallbackActiveKeys: number; instanceId: string };
  /** Stop the rate limiter */
  stop: () => void;
}> {
  const config = getConfig();
  const useRedis = !options.forceInMemory && config.env !== 'development';

  if (useRedis) {
    logger.info('Creating Redis-backed rate limiter for production');
  } else {
    logger.info('Creating in-memory rate limiter for development');
  }

  // Initialize the global limiter
  const limiter = await getRedisRateLimiter({
    ...options,
    gracefulDegradation: options.gracefulDegradation ?? true,
  });

  return {
    perUser: await redisRateLimitPerUser(options),
    perIp: await redisRateLimitPerIp(options),
    perTenant: await redisRateLimitPerTenant(options),
    getStats: () => limiter.getStats(),
    stop: () => {
      limiter.stop();
      resetRedisRateLimiter();
    },
  };
}

// ============================================================================
// Fastify Plugin
// ============================================================================

/**
 * Plugin options for registering Redis rate limiting
 */
export interface RedisRateLimitPluginOptions extends RateLimiterFactoryOptions {
  /** Enable global tenant rate limiting */
  enableGlobalTenantLimit?: boolean;
  /** Paths to skip rate limiting */
  skipPaths?: string[];
}

/**
 * Register Redis rate limiting plugin for Fastify
 *
 * @example
 * ```typescript
 * await server.register(redisRateLimitPlugin, {
 *   defaultLimits: {
 *     perMinute: { limit: 100, windowSeconds: 60 },
 *     perHour: { limit: 1000, windowSeconds: 3600 },
 *     burst: { limit: 10, windowSeconds: 1 },
 *   },
 *   enableGlobalTenantLimit: true,
 *   skipPaths: ['/health', '/ready', '/metrics'],
 * });
 * ```
 */
export const redisRateLimitPlugin: FastifyPluginAsync<RedisRateLimitPluginOptions> = async (
  server: FastifyInstance,
  options: RedisRateLimitPluginOptions
) => {
  const skipPaths = new Set(options.skipPaths ?? ['/health', '/ready', '/metrics']);

  const skip = (request: FastifyRequest): boolean => {
    return skipPaths.has(request.url);
  };

  const rateLimiter = await createRateLimiter({
    ...options,
    skip: options.skip ?? skip,
  });

  // Decorate server with rate limiter utilities
  server.decorate('vorionRedisRateLimiter', rateLimiter);
  server.decorate('vorionRedisRateLimitPerUser', rateLimiter.perUser);
  server.decorate('vorionRedisRateLimitPerIp', rateLimiter.perIp);
  server.decorate('vorionRedisRateLimitPerTenant', rateLimiter.perTenant);

  // Add global tenant rate limiting if enabled
  if (options.enableGlobalTenantLimit) {
    server.addHook('onRequest', async (request, reply) => {
      if (skip(request)) return;
      await rateLimiter.perTenant(request, reply);
    });
  }

  // Cleanup on server close
  server.addHook('onClose', async () => {
    rateLimiter.stop();
  });

  logger.info(
    {
      enableGlobalTenantLimit: options.enableGlobalTenantLimit,
      skipPaths: Array.from(skipPaths),
    },
    'Redis rate limit plugin registered'
  );
};

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    vorionRedisRateLimiter: Awaited<ReturnType<typeof createRateLimiter>>;
    vorionRedisRateLimitPerUser: PreHandlerFn;
    vorionRedisRateLimitPerIp: PreHandlerFn;
    vorionRedisRateLimitPerTenant: PreHandlerFn;
  }
}
