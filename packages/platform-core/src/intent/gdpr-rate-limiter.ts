/**
 * GDPR Rate Limiter
 *
 * Provides distributed rate limiting and request deduplication for GDPR operations.
 * Prevents abuse of resource-intensive export/erasure operations while ensuring
 * legitimate requests can proceed.
 *
 * Features:
 * - Per-user rate limiting for export (3/hour) and erasure (1/24h)
 * - Request deduplication to prevent concurrent duplicate jobs
 * - Tenant-level job queue depth limits
 * - Atomic Redis operations for distributed safety
 *
 * @packageDocumentation
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';

const logger = createLogger({ component: 'gdpr-rate-limiter' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until rate limit resets (if not allowed) */
  retryAfter?: number;
  /** Current count in the window */
  currentCount?: number;
  /** Maximum allowed in the window */
  limit?: number;
}

/**
 * Job queue depth check result
 */
export interface QueueDepthResult {
  /** Whether a new job can be added */
  allowed: boolean;
  /** Current pending job count */
  currentDepth: number;
  /** Maximum allowed depth */
  maxDepth: number;
  /** Seconds to retry after (if not allowed) */
  retryAfter?: number;
}

/**
 * Pending job info
 */
export interface PendingJobInfo {
  /** Job ID */
  jobId: string;
  /** When the job was created */
  createdAt: string;
  /** Job status */
  status: 'pending' | 'processing';
}

/**
 * GDPR Rate Limiter interface
 */
export interface GdprRateLimiter {
  /**
   * Check if an export request is allowed for this user
   */
  checkExportLimit(userId: string, tenantId: string): Promise<RateLimitResult>;

  /**
   * Check if an erasure request is allowed for this user
   */
  checkErasureLimit(userId: string, tenantId: string): Promise<RateLimitResult>;

  /**
   * Get pending job for a user (if any)
   */
  getPendingJob(userId: string, type: 'export' | 'erasure'): Promise<string | null>;

  /**
   * Record a new GDPR request
   */
  recordRequest(userId: string, type: 'export' | 'erasure', jobId: string): Promise<void>;

  /**
   * Check tenant job queue depth
   */
  checkQueueDepth(tenantId: string): Promise<QueueDepthResult>;

  /**
   * Mark a job as completed (removes from pending)
   */
  completeJob(userId: string, type: 'export' | 'erasure', jobId: string, tenantId: string): Promise<void>;

  /**
   * Mark a job as failed (removes from pending)
   */
  failJob(userId: string, type: 'export' | 'erasure', jobId: string, tenantId: string): Promise<void>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Rate limit configuration
 */
export interface GdprRateLimiterConfig {
  /** Maximum export requests per hour per user */
  exportMaxPerHour: number;
  /** Maximum erasure requests per 24 hours per user */
  erasureMaxPerDay: number;
  /** Maximum pending GDPR jobs per tenant */
  maxPendingJobsPerTenant: number;
  /** TTL for pending job markers (seconds) */
  pendingJobTtlSeconds: number;
  /** Redis key prefix */
  keyPrefix: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: GdprRateLimiterConfig = {
  exportMaxPerHour: 3,
  erasureMaxPerDay: 1,
  maxPendingJobsPerTenant: 100,
  pendingJobTtlSeconds: 24 * 60 * 60, // 24 hours
  keyPrefix: 'gdpr:ratelimit',
};

// =============================================================================
// LUA SCRIPTS
// =============================================================================

/**
 * Lua script for atomic rate limit check and increment.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = current timestamp (seconds)
 * ARGV[2] = window size (seconds)
 * ARGV[3] = limit
 *
 * Returns: [allowed (0/1), current_count, reset_at]
 */
const RATE_LIMIT_CHECK_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove expired entries
local windowStart = now - windowSeconds
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

-- Get current count
local currentCount = redis.call('ZCARD', key)

-- Check if under limit
local allowed = 0
if currentCount < limit then
  -- Add new request with current timestamp as score and value
  redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
  currentCount = currentCount + 1
  allowed = 1
end

-- Set TTL on the key
redis.call('EXPIRE', key, windowSeconds + 60)

-- Calculate reset time
local oldestEntry = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = now + windowSeconds
if #oldestEntry >= 2 then
  resetAt = tonumber(oldestEntry[2]) + windowSeconds
end

return {allowed, currentCount, resetAt}
`;

/**
 * Lua script for atomic pending job check-and-set.
 * Uses SETNX semantics to prevent race conditions.
 *
 * KEYS[1] = pending job key
 * ARGV[1] = job ID
 * ARGV[2] = TTL (seconds)
 * ARGV[3] = created timestamp
 *
 * Returns: [success (0/1), existing_job_id or nil]
 */
const PENDING_JOB_SET_SCRIPT = `
local key = KEYS[1]
local jobId = ARGV[1]
local ttl = tonumber(ARGV[2])
local createdAt = ARGV[3]

-- Check if key exists
local existing = redis.call('GET', key)
if existing then
  return {0, existing}
end

-- Set the new job ID with TTL
local value = cjson.encode({jobId = jobId, createdAt = createdAt, status = 'pending'})
redis.call('SET', key, value, 'EX', ttl, 'NX')

-- Verify it was set (race condition check)
local current = redis.call('GET', key)
if current then
  local decoded = cjson.decode(current)
  if decoded.jobId == jobId then
    return {1, nil}
  end
  return {0, decoded.jobId}
end

return {0, nil}
`;

/**
 * Lua script for atomic queue depth check and increment.
 *
 * KEYS[1] = queue depth key
 * ARGV[1] = max depth
 * ARGV[2] = TTL (seconds)
 *
 * Returns: [allowed (0/1), current_depth]
 */
const QUEUE_DEPTH_CHECK_SCRIPT = `
local key = KEYS[1]
local maxDepth = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

-- Get current depth
local currentDepth = tonumber(redis.call('GET', key) or '0')

-- Check if under limit
local allowed = 0
if currentDepth < maxDepth then
  -- Increment depth
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ttl)
  currentDepth = currentDepth + 1
  allowed = 1
end

return {allowed, currentDepth}
`;

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Redis-backed GDPR rate limiter implementation
 */
export class RedisGdprRateLimiter implements GdprRateLimiter {
  private redis: Redis;
  private config: GdprRateLimiterConfig;
  private rateLimitScriptSha: string | null = null;
  private pendingJobScriptSha: string | null = null;
  private queueDepthScriptSha: string | null = null;
  private initialized = false;

  constructor(redis?: Redis, config?: Partial<GdprRateLimiterConfig>) {
    this.redis = redis ?? getRedis();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize Lua scripts
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      this.rateLimitScriptSha = await this.redis.script('LOAD', RATE_LIMIT_CHECK_SCRIPT) as string;
      this.pendingJobScriptSha = await this.redis.script('LOAD', PENDING_JOB_SET_SCRIPT) as string;
      this.queueDepthScriptSha = await this.redis.script('LOAD', QUEUE_DEPTH_CHECK_SCRIPT) as string;
      this.initialized = true;
      logger.info('GDPR rate limiter Lua scripts loaded');
    } catch (error) {
      logger.error({ error }, 'Failed to load GDPR rate limiter Lua scripts');
      throw error;
    }
  }

  /**
   * Generate Redis key for rate limiting
   */
  private getRateLimitKey(userId: string, type: 'export' | 'erasure'): string {
    return `${this.config.keyPrefix}:limit:${type}:${userId}`;
  }

  /**
   * Generate Redis key for pending job
   */
  private getPendingJobKey(userId: string, type: 'export' | 'erasure'): string {
    return `${this.config.keyPrefix}:pending:${type}:${userId}`;
  }

  /**
   * Generate Redis key for tenant queue depth
   */
  private getQueueDepthKey(tenantId: string): string {
    return `${this.config.keyPrefix}:queue:${tenantId}`;
  }

  /**
   * Check export rate limit
   */
  async checkExportLimit(userId: string, tenantId: string): Promise<RateLimitResult> {
    await this.ensureInitialized();

    const key = this.getRateLimitKey(userId, 'export');
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 3600; // 1 hour

    try {
      const result = await this.redis.evalsha(
        this.rateLimitScriptSha!,
        1,
        key,
        now.toString(),
        windowSeconds.toString(),
        this.config.exportMaxPerHour.toString()
      ) as number[];

      const [allowed, currentCount, resetAt] = result;
      const retryAfter = allowed === 0 ? Math.max(1, resetAt - now) : undefined;

      logger.debug(
        { userId, tenantId, allowed: allowed === 1, currentCount, retryAfter },
        'Export rate limit checked'
      );

      return {
        allowed: allowed === 1,
        retryAfter,
        currentCount,
        limit: this.config.exportMaxPerHour,
      };
    } catch (error) {
      logger.error({ error, userId, tenantId }, 'Export rate limit check failed');
      // Fail open to allow legitimate requests
      return { allowed: true };
    }
  }

  /**
   * Check erasure rate limit
   */
  async checkErasureLimit(userId: string, tenantId: string): Promise<RateLimitResult> {
    await this.ensureInitialized();

    const key = this.getRateLimitKey(userId, 'erasure');
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 24 * 3600; // 24 hours

    try {
      const result = await this.redis.evalsha(
        this.rateLimitScriptSha!,
        1,
        key,
        now.toString(),
        windowSeconds.toString(),
        this.config.erasureMaxPerDay.toString()
      ) as number[];

      const [allowed, currentCount, resetAt] = result;
      const retryAfter = allowed === 0 ? Math.max(1, resetAt - now) : undefined;

      logger.debug(
        { userId, tenantId, allowed: allowed === 1, currentCount, retryAfter },
        'Erasure rate limit checked'
      );

      return {
        allowed: allowed === 1,
        retryAfter,
        currentCount,
        limit: this.config.erasureMaxPerDay,
      };
    } catch (error) {
      logger.error({ error, userId, tenantId }, 'Erasure rate limit check failed');
      // Fail open to allow legitimate requests
      return { allowed: true };
    }
  }

  /**
   * Get pending job for user
   */
  async getPendingJob(userId: string, type: 'export' | 'erasure'): Promise<string | null> {
    const key = this.getPendingJobKey(userId, type);

    try {
      const value = await this.redis.get(key);
      if (!value) return null;

      const parsed = JSON.parse(value) as PendingJobInfo;
      logger.debug({ userId, type, jobId: parsed.jobId }, 'Found pending GDPR job');
      return parsed.jobId;
    } catch (error) {
      logger.error({ error, userId, type }, 'Failed to get pending job');
      return null;
    }
  }

  /**
   * Record a new GDPR request with deduplication
   */
  async recordRequest(userId: string, type: 'export' | 'erasure', jobId: string): Promise<void> {
    await this.ensureInitialized();

    const key = this.getPendingJobKey(userId, type);
    const createdAt = new Date().toISOString();

    try {
      const result = await this.redis.evalsha(
        this.pendingJobScriptSha!,
        1,
        key,
        jobId,
        this.config.pendingJobTtlSeconds.toString(),
        createdAt
      ) as [number, string | null];

      const [success, existingJobId] = result;

      if (success === 0 && existingJobId) {
        logger.warn(
          { userId, type, jobId, existingJobId },
          'GDPR request already pending'
        );
      } else {
        logger.info({ userId, type, jobId }, 'GDPR request recorded');
      }
    } catch (error) {
      logger.error({ error, userId, type, jobId }, 'Failed to record GDPR request');
      // Still try basic set as fallback
      try {
        const value = JSON.stringify({ jobId, createdAt, status: 'pending' });
        await this.redis.set(key, value, 'EX', this.config.pendingJobTtlSeconds, 'NX');
      } catch {
        // Ignore fallback failure
      }
    }
  }

  /**
   * Check tenant queue depth
   */
  async checkQueueDepth(tenantId: string): Promise<QueueDepthResult> {
    await this.ensureInitialized();

    const key = this.getQueueDepthKey(tenantId);

    try {
      const result = await this.redis.evalsha(
        this.queueDepthScriptSha!,
        1,
        key,
        this.config.maxPendingJobsPerTenant.toString(),
        this.config.pendingJobTtlSeconds.toString()
      ) as number[];

      const [allowed, currentDepth] = result;

      logger.debug(
        { tenantId, allowed: allowed === 1, currentDepth, maxDepth: this.config.maxPendingJobsPerTenant },
        'Queue depth checked'
      );

      return {
        allowed: allowed === 1,
        currentDepth,
        maxDepth: this.config.maxPendingJobsPerTenant,
        retryAfter: allowed === 0 ? 60 : undefined, // Suggest retry in 1 minute
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Queue depth check failed');
      // Fail open
      return {
        allowed: true,
        currentDepth: 0,
        maxDepth: this.config.maxPendingJobsPerTenant,
      };
    }
  }

  /**
   * Mark job as completed
   */
  async completeJob(userId: string, type: 'export' | 'erasure', jobId: string, tenantId: string): Promise<void> {
    const pendingKey = this.getPendingJobKey(userId, type);
    const queueKey = this.getQueueDepthKey(tenantId);

    try {
      // Verify it's the correct job before removing
      const value = await this.redis.get(pendingKey);
      if (value) {
        const parsed = JSON.parse(value) as PendingJobInfo;
        if (parsed.jobId === jobId) {
          await this.redis.del(pendingKey);
        }
      }

      // Decrement queue depth
      await this.redis.decr(queueKey);
      // Ensure it doesn't go negative
      const depth = await this.redis.get(queueKey);
      if (depth && parseInt(depth, 10) < 0) {
        await this.redis.set(queueKey, '0');
      }

      logger.info({ userId, type, jobId, tenantId }, 'GDPR job completed');
    } catch (error) {
      logger.error({ error, userId, type, jobId, tenantId }, 'Failed to mark job as completed');
    }
  }

  /**
   * Mark job as failed
   */
  async failJob(userId: string, type: 'export' | 'erasure', jobId: string, tenantId: string): Promise<void> {
    // Same as complete - remove from pending and decrement depth
    await this.completeJob(userId, type, jobId, tenantId);
    logger.info({ userId, type, jobId, tenantId }, 'GDPR job marked as failed');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

let globalRateLimiter: GdprRateLimiter | null = null;

/**
 * Get or create the global GDPR rate limiter
 */
export function getGdprRateLimiter(
  redis?: Redis,
  config?: Partial<GdprRateLimiterConfig>
): GdprRateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RedisGdprRateLimiter(redis, config);
  }
  return globalRateLimiter;
}

/**
 * Create a new GDPR rate limiter instance
 */
export function createGdprRateLimiter(
  redis?: Redis,
  config?: Partial<GdprRateLimiterConfig>
): GdprRateLimiter {
  return new RedisGdprRateLimiter(redis, config);
}

/**
 * Reset the global rate limiter (for testing)
 */
export function resetGdprRateLimiter(): void {
  globalRateLimiter = null;
}
