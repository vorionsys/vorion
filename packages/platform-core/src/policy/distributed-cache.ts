/**
 * Distributed Policy Cache
 *
 * Redis-backed distributed cache for policy data with:
 * - Cache versioning for stale read detection
 * - Write-through caching with Redis transactions
 * - 2-phase invalidation (mark stale -> update -> confirm)
 * - Distributed locking for policy updates
 *
 * Fixes MEDIUM vulnerability: Policy evaluation cache invalidation race condition
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from 'node:crypto';
import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';
import type { Policy, PolicyDefinition } from './types.js';
import type { ID } from '../common/types.js';

const logger = createLogger({ component: 'policy-distributed-cache' });

// =============================================================================
// Metrics
// =============================================================================

/**
 * Policy cache hit/miss counter
 */
export const policyDistributedCacheOperations = new Counter({
  name: 'vorion_policy_distributed_cache_operations_total',
  help: 'Total distributed policy cache operations',
  labelNames: ['operation', 'result', 'tenant_id'] as const,
  registers: [vorionRegistry],
});

/**
 * Policy lock contention counter
 */
export const policyLockContentionTotal = new Counter({
  name: 'vorion_policy_lock_contention_total',
  help: 'Total policy lock acquisition attempts and outcomes',
  labelNames: ['operation', 'result', 'tenant_id'] as const,
  registers: [vorionRegistry],
});

/**
 * Policy lock wait time histogram
 */
export const policyLockWaitSeconds = new Histogram({
  name: 'vorion_policy_lock_wait_seconds',
  help: 'Time spent waiting to acquire policy locks',
  labelNames: ['tenant_id'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [vorionRegistry],
});

/**
 * Stale cache reads detected
 */
export const policyStaleCacheReadsTotal = new Counter({
  name: 'vorion_policy_stale_cache_reads_total',
  help: 'Total stale policy cache reads detected and rejected',
  labelNames: ['tenant_id'] as const,
  registers: [vorionRegistry],
});

/**
 * Active policy locks gauge
 */
export const activePolicyLocksGauge = new Gauge({
  name: 'vorion_active_policy_locks',
  help: 'Number of currently held policy locks',
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Cached policy entry with version metadata
 */
export interface CachedPolicyEntry {
  policy: Policy;
  cacheVersion: number;
  cachedAt: number;
  expiresAt: number;
}

/**
 * Policy version info stored in Redis
 */
export interface PolicyVersionInfo {
  version: number;
  checksum: string;
  updatedAt: number;
  cacheVersion: number;
  stale: boolean;
}

/**
 * Lock result
 */
export interface PolicyLockResult {
  acquired: boolean;
  lockId?: string;
  error?: string;
}

/**
 * Options for policy lock acquisition
 */
export interface PolicyLockOptions {
  /** Lock timeout in milliseconds (how long the lock is held) */
  lockTimeoutMs?: number;
  /** Maximum time to wait for acquiring the lock */
  acquireTimeoutMs?: number;
  /** Initial retry delay in milliseconds */
  retryDelayMs?: number;
}

// =============================================================================
// Constants
// =============================================================================

const CACHE_KEY_PREFIX = 'policy:cache:';
const VERSION_KEY_PREFIX = 'policy:version:';
const LOCK_KEY_PREFIX = 'policy:lock:';
const STALE_MARKER_PREFIX = 'policy:stale:';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LOCK_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10000; // 10 seconds
const DEFAULT_RETRY_DELAY_MS = 50; // 50ms initial retry

// =============================================================================
// Lua Scripts for Atomic Operations
// =============================================================================

/**
 * Lua script for atomic lock acquisition with NX and EX
 */
const ACQUIRE_LOCK_SCRIPT = `
  local lockKey = KEYS[1]
  local lockId = ARGV[1]
  local lockTimeoutSeconds = tonumber(ARGV[2])

  local result = redis.call("SET", lockKey, lockId, "NX", "EX", lockTimeoutSeconds)
  if result then
    return 1
  else
    return 0
  end
`;

/**
 * Lua script for atomic lock release (only release if we own the lock)
 */
const RELEASE_LOCK_SCRIPT = `
  local lockKey = KEYS[1]
  local lockId = ARGV[1]

  if redis.call("GET", lockKey) == lockId then
    return redis.call("DEL", lockKey)
  else
    return 0
  end
`;

/**
 * Lua script for atomic cache write with version increment
 * Keys: [cacheKey, versionKey]
 * Args: [policyJson, checksum, ttlSeconds]
 */
const WRITE_THROUGH_CACHE_SCRIPT = `
  local cacheKey = KEYS[1]
  local versionKey = KEYS[2]
  local staleKey = KEYS[3]
  local policyJson = ARGV[1]
  local checksum = ARGV[2]
  local ttlSeconds = tonumber(ARGV[3])
  local nowMs = tonumber(ARGV[4])

  -- Get current version info or initialize
  local currentVersionJson = redis.call("GET", versionKey)
  local newCacheVersion = 1

  if currentVersionJson then
    local currentVersion = cjson.decode(currentVersionJson)
    newCacheVersion = (currentVersion.cacheVersion or 0) + 1
  end

  -- Build new version info
  local newVersionInfo = {
    version = cjson.decode(policyJson).version,
    checksum = checksum,
    updatedAt = nowMs,
    cacheVersion = newCacheVersion,
    stale = false
  }

  -- Use MULTI/EXEC for atomic update
  redis.call("MULTI")

  -- Remove stale marker
  redis.call("DEL", staleKey)

  -- Update version info (no expiry - this is authoritative)
  redis.call("SET", versionKey, cjson.encode(newVersionInfo))

  -- Update cache with TTL
  redis.call("SETEX", cacheKey, ttlSeconds, policyJson)

  redis.call("EXEC")

  return newCacheVersion
`;

/**
 * Lua script for marking a policy as stale (2-phase invalidation step 1)
 * Keys: [versionKey, staleKey]
 * Args: [ttlSeconds]
 */
const MARK_STALE_SCRIPT = `
  local versionKey = KEYS[1]
  local staleKey = KEYS[2]
  local ttlSeconds = tonumber(ARGV[1])

  -- Mark as stale
  redis.call("SETEX", staleKey, ttlSeconds, "1")

  -- Update version info to mark stale
  local versionJson = redis.call("GET", versionKey)
  if versionJson then
    local versionInfo = cjson.decode(versionJson)
    versionInfo.stale = true
    redis.call("SET", versionKey, cjson.encode(versionInfo))
  end

  return 1
`;

/**
 * Lua script for reading cache with version validation
 * Keys: [cacheKey, versionKey, staleKey]
 * Args: [expectedCacheVersion (optional, 0 to skip check)]
 */
const READ_CACHE_SCRIPT = `
  local cacheKey = KEYS[1]
  local versionKey = KEYS[2]
  local staleKey = KEYS[3]
  local expectedVersion = tonumber(ARGV[1])

  -- Check if marked as stale
  local isStale = redis.call("EXISTS", staleKey)
  if isStale == 1 then
    return {nil, "STALE", 0}
  end

  -- Get version info
  local versionJson = redis.call("GET", versionKey)
  if not versionJson then
    return {nil, "NO_VERSION", 0}
  end

  local versionInfo = cjson.decode(versionJson)

  -- Check if version info marked stale
  if versionInfo.stale then
    return {nil, "STALE", versionInfo.cacheVersion}
  end

  -- If expected version provided, check it
  if expectedVersion > 0 and versionInfo.cacheVersion ~= expectedVersion then
    return {nil, "VERSION_MISMATCH", versionInfo.cacheVersion}
  end

  -- Get cached policy
  local cached = redis.call("GET", cacheKey)
  if not cached then
    return {nil, "CACHE_MISS", versionInfo.cacheVersion}
  end

  return {cached, "HIT", versionInfo.cacheVersion}
`;

/**
 * Lua script for atomic cache invalidation (2-phase step 2 - after DB commit)
 * Keys: [cacheKey, versionKey, staleKey]
 */
const INVALIDATE_CACHE_SCRIPT = `
  local cacheKey = KEYS[1]
  local versionKey = KEYS[2]
  local staleKey = KEYS[3]

  redis.call("MULTI")
  redis.call("DEL", cacheKey)
  redis.call("DEL", staleKey)

  -- Update version to increment cache version and clear stale flag
  local versionJson = redis.call("GET", versionKey)
  if versionJson then
    local versionInfo = cjson.decode(versionJson)
    versionInfo.cacheVersion = (versionInfo.cacheVersion or 0) + 1
    versionInfo.stale = false
    redis.call("SET", versionKey, cjson.encode(versionInfo))
  end

  redis.call("EXEC")

  return 1
`;

// =============================================================================
// Distributed Policy Cache Service
// =============================================================================

/**
 * Distributed Policy Cache Service
 *
 * Provides distributed caching with:
 * - Cache versioning for stale read detection
 * - Write-through caching with atomic Redis transactions
 * - 2-phase invalidation to prevent race conditions
 * - Distributed locking for policy mutations
 */
export class DistributedPolicyCache {
  private redis = getRedis();
  private activeLocks = 0;

  // ==========================================================================
  // Key Generation
  // ==========================================================================

  private getCacheKey(policyId: string, tenantId: string): string {
    return `${CACHE_KEY_PREFIX}${tenantId}:${policyId}`;
  }

  private getVersionKey(policyId: string, tenantId: string): string {
    return `${VERSION_KEY_PREFIX}${tenantId}:${policyId}`;
  }

  private getLockKey(policyId: string, tenantId: string): string {
    return `${LOCK_KEY_PREFIX}${tenantId}:${policyId}`;
  }

  private getStaleKey(policyId: string, tenantId: string): string {
    return `${STALE_MARKER_PREFIX}${tenantId}:${policyId}`;
  }

  // ==========================================================================
  // Distributed Locking
  // ==========================================================================

  /**
   * Acquire a distributed lock for a policy
   *
   * @param policyId - Policy ID to lock
   * @param tenantId - Tenant ID
   * @param options - Lock options
   * @returns Lock result with lockId if acquired
   */
  async acquireLock(
    policyId: string,
    tenantId: string,
    options: PolicyLockOptions = {}
  ): Promise<PolicyLockResult> {
    const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    const lockKey = this.getLockKey(policyId, tenantId);
    const lockId = randomUUID();
    const lockTimeoutSeconds = Math.ceil(lockTimeoutMs / 1000);

    const startTime = Date.now();
    let attempt = 0;
    let currentDelay = retryDelayMs;

    while (Date.now() - startTime < acquireTimeoutMs) {
      attempt++;

      try {
        const result = await this.redis.eval(
          ACQUIRE_LOCK_SCRIPT,
          1,
          lockKey,
          lockId,
          lockTimeoutSeconds.toString()
        );

        if (result === 1) {
          this.activeLocks++;
          activePolicyLocksGauge.set(this.activeLocks);

          const waitTime = (Date.now() - startTime) / 1000;
          policyLockWaitSeconds.observe({ tenant_id: tenantId }, waitTime);
          policyLockContentionTotal.inc({
            operation: 'acquire',
            result: 'success',
            tenant_id: tenantId,
          });

          logger.debug(
            { policyId, tenantId, lockId, attempt, waitTimeMs: waitTime * 1000 },
            'Policy lock acquired'
          );

          return { acquired: true, lockId };
        }
      } catch (error) {
        logger.warn(
          { error, policyId, tenantId, attempt },
          'Error acquiring policy lock'
        );
      }

      // Check if we should retry
      const elapsed = Date.now() - startTime;
      if (elapsed + currentDelay >= acquireTimeoutMs) {
        break;
      }

      // Add jitter to retry delay
      const jitter = currentDelay * 0.25 * (Math.random() * 2 - 1);
      const delayWithJitter = Math.max(retryDelayMs, currentDelay + jitter);

      await new Promise((resolve) => setTimeout(resolve, delayWithJitter));

      // Exponential backoff (capped at 1 second)
      currentDelay = Math.min(currentDelay * 2, 1000);
    }

    policyLockContentionTotal.inc({
      operation: 'acquire',
      result: 'timeout',
      tenant_id: tenantId,
    });

    logger.debug(
      { policyId, tenantId, attempts: attempt },
      'Policy lock acquisition timed out'
    );

    return { acquired: false, error: 'Lock acquisition timed out' };
  }

  /**
   * Release a distributed lock for a policy
   *
   * @param policyId - Policy ID
   * @param tenantId - Tenant ID
   * @param lockId - Lock ID from acquire
   * @returns true if released, false if not owned or expired
   */
  async releaseLock(
    policyId: string,
    tenantId: string,
    lockId: string
  ): Promise<boolean> {
    const lockKey = this.getLockKey(policyId, tenantId);

    try {
      const result = await this.redis.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        lockKey,
        lockId
      );

      if (result === 1) {
        this.activeLocks = Math.max(0, this.activeLocks - 1);
        activePolicyLocksGauge.set(this.activeLocks);

        policyLockContentionTotal.inc({
          operation: 'release',
          result: 'success',
          tenant_id: tenantId,
        });

        logger.debug({ policyId, tenantId, lockId }, 'Policy lock released');
        return true;
      }

      policyLockContentionTotal.inc({
        operation: 'release',
        result: 'not_owned',
        tenant_id: tenantId,
      });

      logger.warn(
        { policyId, tenantId, lockId },
        'Policy lock release failed - not owned or expired'
      );
      return false;
    } catch (error) {
      policyLockContentionTotal.inc({
        operation: 'release',
        result: 'error',
        tenant_id: tenantId,
      });

      logger.error(
        { error, policyId, tenantId, lockId },
        'Error releasing policy lock'
      );
      return false;
    }
  }

  /**
   * Execute a function with a distributed policy lock
   *
   * @param policyId - Policy ID to lock
   * @param tenantId - Tenant ID
   * @param operation - Async function to execute while holding lock
   * @param options - Lock options
   * @returns Result of the operation
   * @throws Error if lock cannot be acquired
   */
  async withPolicyLock<T>(
    policyId: string,
    tenantId: string,
    operation: () => Promise<T>,
    options: PolicyLockOptions = {}
  ): Promise<T> {
    const lockResult = await this.acquireLock(policyId, tenantId, options);

    if (!lockResult.acquired || !lockResult.lockId) {
      throw new PolicyLockError(
        `Failed to acquire policy lock: ${lockResult.error}`,
        policyId,
        tenantId
      );
    }

    try {
      return await operation();
    } finally {
      await this.releaseLock(policyId, tenantId, lockResult.lockId);
    }
  }

  // ==========================================================================
  // Cache Operations
  // ==========================================================================

  /**
   * Get a policy from distributed cache with version validation
   *
   * @param policyId - Policy ID
   * @param tenantId - Tenant ID
   * @param expectedCacheVersion - Optional expected version to validate
   * @returns Cached policy or null if not found/stale
   */
  async get(
    policyId: string,
    tenantId: string,
    expectedCacheVersion?: number
  ): Promise<{ policy: Policy | null; cacheVersion: number; stale: boolean }> {
    const cacheKey = this.getCacheKey(policyId, tenantId);
    const versionKey = this.getVersionKey(policyId, tenantId);
    const staleKey = this.getStaleKey(policyId, tenantId);

    try {
      const result = (await this.redis.eval(
        READ_CACHE_SCRIPT,
        3,
        cacheKey,
        versionKey,
        staleKey,
        (expectedCacheVersion ?? 0).toString()
      )) as [string | null, string, number];

      const [cachedJson, status, cacheVersion] = result;

      if (status === 'HIT' && cachedJson) {
        policyDistributedCacheOperations.inc({
          operation: 'get',
          result: 'hit',
          tenant_id: tenantId,
        });

        logger.debug(
          { policyId, tenantId, cacheVersion },
          'Policy cache hit'
        );

        return {
          policy: JSON.parse(cachedJson) as Policy,
          cacheVersion,
          stale: false,
        };
      }

      // Handle various miss reasons
      if (status === 'STALE') {
        policyStaleCacheReadsTotal.inc({ tenant_id: tenantId });
        policyDistributedCacheOperations.inc({
          operation: 'get',
          result: 'stale',
          tenant_id: tenantId,
        });

        logger.debug(
          { policyId, tenantId, cacheVersion },
          'Policy cache stale'
        );

        return { policy: null, cacheVersion, stale: true };
      }

      if (status === 'VERSION_MISMATCH') {
        policyStaleCacheReadsTotal.inc({ tenant_id: tenantId });
        policyDistributedCacheOperations.inc({
          operation: 'get',
          result: 'version_mismatch',
          tenant_id: tenantId,
        });

        logger.debug(
          { policyId, tenantId, expectedCacheVersion, actualCacheVersion: cacheVersion },
          'Policy cache version mismatch'
        );

        return { policy: null, cacheVersion, stale: true };
      }

      policyDistributedCacheOperations.inc({
        operation: 'get',
        result: 'miss',
        tenant_id: tenantId,
      });

      logger.debug(
        { policyId, tenantId, status },
        'Policy cache miss'
      );

      return { policy: null, cacheVersion, stale: false };
    } catch (error) {
      policyDistributedCacheOperations.inc({
        operation: 'get',
        result: 'error',
        tenant_id: tenantId,
      });

      logger.error(
        { error, policyId, tenantId },
        'Error reading policy from distributed cache'
      );

      return { policy: null, cacheVersion: 0, stale: false };
    }
  }

  /**
   * Write a policy to distributed cache atomically with version increment
   * (Write-through caching)
   *
   * @param policy - Policy to cache
   * @param ttlMs - Cache TTL in milliseconds
   * @returns New cache version
   */
  async set(
    policy: Policy,
    ttlMs: number = DEFAULT_CACHE_TTL_MS
  ): Promise<number> {
    const cacheKey = this.getCacheKey(policy.id, policy.tenantId);
    const versionKey = this.getVersionKey(policy.id, policy.tenantId);
    const staleKey = this.getStaleKey(policy.id, policy.tenantId);
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    try {
      const policyJson = JSON.stringify(policy);
      const nowMs = Date.now();

      const newCacheVersion = (await this.redis.eval(
        WRITE_THROUGH_CACHE_SCRIPT,
        3,
        cacheKey,
        versionKey,
        staleKey,
        policyJson,
        policy.checksum,
        ttlSeconds.toString(),
        nowMs.toString()
      )) as number;

      policyDistributedCacheOperations.inc({
        operation: 'set',
        result: 'success',
        tenant_id: policy.tenantId,
      });

      logger.debug(
        { policyId: policy.id, tenantId: policy.tenantId, cacheVersion: newCacheVersion },
        'Policy written to distributed cache'
      );

      return newCacheVersion;
    } catch (error) {
      policyDistributedCacheOperations.inc({
        operation: 'set',
        result: 'error',
        tenant_id: policy.tenantId,
      });

      logger.error(
        { error, policyId: policy.id, tenantId: policy.tenantId },
        'Error writing policy to distributed cache'
      );

      throw error;
    }
  }

  /**
   * Mark a policy as stale (2-phase invalidation step 1)
   * Call this BEFORE committing database changes
   *
   * @param policyId - Policy ID
   * @param tenantId - Tenant ID
   */
  async markStale(policyId: string, tenantId: string): Promise<void> {
    const versionKey = this.getVersionKey(policyId, tenantId);
    const staleKey = this.getStaleKey(policyId, tenantId);

    try {
      await this.redis.eval(
        MARK_STALE_SCRIPT,
        2,
        versionKey,
        staleKey,
        '300' // Stale marker TTL: 5 minutes
      );

      policyDistributedCacheOperations.inc({
        operation: 'mark_stale',
        result: 'success',
        tenant_id: tenantId,
      });

      logger.debug(
        { policyId, tenantId },
        'Policy marked as stale in distributed cache'
      );
    } catch (error) {
      policyDistributedCacheOperations.inc({
        operation: 'mark_stale',
        result: 'error',
        tenant_id: tenantId,
      });

      logger.error(
        { error, policyId, tenantId },
        'Error marking policy as stale in distributed cache'
      );

      throw error;
    }
  }

  /**
   * Invalidate a policy in distributed cache (2-phase invalidation step 2)
   * Call this AFTER database changes are committed
   *
   * @param policyId - Policy ID
   * @param tenantId - Tenant ID
   */
  async invalidate(policyId: string, tenantId: string): Promise<void> {
    const cacheKey = this.getCacheKey(policyId, tenantId);
    const versionKey = this.getVersionKey(policyId, tenantId);
    const staleKey = this.getStaleKey(policyId, tenantId);

    try {
      await this.redis.eval(
        INVALIDATE_CACHE_SCRIPT,
        3,
        cacheKey,
        versionKey,
        staleKey
      );

      policyDistributedCacheOperations.inc({
        operation: 'invalidate',
        result: 'success',
        tenant_id: tenantId,
      });

      logger.debug(
        { policyId, tenantId },
        'Policy invalidated in distributed cache'
      );
    } catch (error) {
      policyDistributedCacheOperations.inc({
        operation: 'invalidate',
        result: 'error',
        tenant_id: tenantId,
      });

      logger.error(
        { error, policyId, tenantId },
        'Error invalidating policy in distributed cache'
      );

      throw error;
    }
  }

  /**
   * Get the current cache version for a policy
   *
   * @param policyId - Policy ID
   * @param tenantId - Tenant ID
   * @returns Version info or null if not found
   */
  async getVersionInfo(
    policyId: string,
    tenantId: string
  ): Promise<PolicyVersionInfo | null> {
    const versionKey = this.getVersionKey(policyId, tenantId);

    try {
      const versionJson = await this.redis.get(versionKey);
      if (!versionJson) {
        return null;
      }

      return JSON.parse(versionJson) as PolicyVersionInfo;
    } catch (error) {
      logger.error(
        { error, policyId, tenantId },
        'Error getting policy version info'
      );
      return null;
    }
  }

  /**
   * Clear all cache entries for a tenant
   *
   * @param tenantId - Tenant ID
   */
  async clearTenantCache(tenantId: string): Promise<number> {
    try {
      const pattern = `${CACHE_KEY_PREFIX}${tenantId}:*`;
      const versionPattern = `${VERSION_KEY_PREFIX}${tenantId}:*`;
      const stalePattern = `${STALE_MARKER_PREFIX}${tenantId}:*`;

      let deleted = 0;

      // Use SCAN to find and delete keys (avoid KEYS in production)
      for (const p of [pattern, versionPattern, stalePattern]) {
        let cursor = '0';
        do {
          const [newCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            p,
            'COUNT',
            100
          );
          cursor = newCursor;

          if (keys.length > 0) {
            await this.redis.del(...keys);
            deleted += keys.length;
          }
        } while (cursor !== '0');
      }

      logger.info({ tenantId, deletedKeys: deleted }, 'Tenant policy cache cleared');

      return deleted;
    } catch (error) {
      logger.error({ error, tenantId }, 'Error clearing tenant policy cache');
      throw error;
    }
  }
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when policy lock acquisition fails
 */
export class PolicyLockError extends Error {
  public readonly code = 'POLICY_LOCK_ERROR';
  public readonly policyId: string;
  public readonly tenantId: string;

  constructor(message: string, policyId: string, tenantId: string) {
    super(message);
    this.name = 'PolicyLockError';
    this.policyId = policyId;
    this.tenantId = tenantId;
  }
}

/**
 * Error thrown when stale cache is detected
 */
export class StaleCacheError extends Error {
  public readonly code = 'STALE_CACHE_ERROR';
  public readonly policyId: string;
  public readonly tenantId: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;

  constructor(
    message: string,
    policyId: string,
    tenantId: string,
    expectedVersion: number,
    actualVersion: number
  ) {
    super(message);
    this.name = 'StaleCacheError';
    this.policyId = policyId;
    this.tenantId = tenantId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let distributedCacheInstance: DistributedPolicyCache | null = null;

/**
 * Get the distributed policy cache singleton
 */
export function getDistributedPolicyCache(): DistributedPolicyCache {
  if (!distributedCacheInstance) {
    distributedCacheInstance = new DistributedPolicyCache();
  }
  return distributedCacheInstance;
}

/**
 * Execute an operation with a distributed policy lock
 *
 * @param policyId - Policy ID to lock
 * @param tenantId - Tenant ID
 * @param operation - Async function to execute while holding lock
 * @returns Result of the operation
 */
export async function withPolicyLock<T>(
  policyId: string,
  tenantId: string,
  operation: () => Promise<T>
): Promise<T> {
  const cache = getDistributedPolicyCache();
  return cache.withPolicyLock(policyId, tenantId, operation);
}
