/**
 * Cognigate Redis Resource State Provider
 *
 * Implements distributed resource tracking using Redis.
 * Uses atomic Lua scripts for consistency under concurrent access.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/resource-state-provider
 */

import type { Redis } from 'ioredis';
import { getRedis } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import type { ID } from '../common/types.js';
import type { ResourceLimits, ResourceUsage, ResourceStateProvider } from './types.js';
import {
  INCREMENT_AND_CHECK_LUA,
  UPDATE_MEMORY_PEAK_LUA,
  GET_RESOURCE_SNAPSHOT_LUA,
  CHECK_LIMITS_LUA,
  INIT_EXECUTION_LUA,
  INCREMENT_CPU_TIME_LUA,
  CLEANUP_EXECUTION_LUA,
} from './lua-scripts.js';

const logger = createLogger({ component: 'cognigate-resource-state' });

/**
 * Dependencies for RedisResourceStateProvider
 */
export interface RedisResourceStateProviderDependencies {
  /** Redis client instance */
  redis?: Redis;
}

/**
 * Violation type mapping from Lua script return values
 */
const VIOLATION_TYPES = {
  0: null,
  1: 'memory_exceeded',
  2: 'cpu_exceeded',
  3: 'timeout_exceeded',
  4: 'network_limit_exceeded',
  5: 'filesystem_limit_exceeded',
} as const;

/**
 * Violation type descriptions
 */
const VIOLATION_DESCRIPTIONS: Record<string, string> = {
  memory_exceeded: 'Memory limit exceeded',
  cpu_exceeded: 'CPU time limit exceeded',
  timeout_exceeded: 'Execution timeout exceeded',
  network_limit_exceeded: 'Network request limit exceeded',
  filesystem_limit_exceeded: 'File system operation limit exceeded',
};

/**
 * Redis-based resource state provider for distributed execution tracking.
 *
 * Uses Redis HASH structures for efficient storage and Lua scripts
 * for atomic operations that prevent race conditions.
 */
export class RedisResourceStateProvider implements ResourceStateProvider {
  private readonly redis: Redis;
  private readonly keyPrefix = 'cognigate:exec:';

  constructor(deps: RedisResourceStateProviderDependencies = {}) {
    this.redis = deps.redis ?? getRedis();
  }

  /**
   * Build the Redis key for an execution
   */
  private buildKey(executionId: ID): string {
    return `${this.keyPrefix}${executionId}`;
  }

  /**
   * Initialize execution tracking with limits and TTL
   */
  async initExecution(executionId: ID, limits: ResourceLimits, ttlMs: number): Promise<void> {
    const key = this.buildKey(executionId);
    const startTime = Date.now();
    const ttlSeconds = Math.ceil(ttlMs / 1000) + 60; // Add buffer for cleanup

    await this.redis.eval(
      INIT_EXECUTION_LUA,
      1,
      key,
      startTime.toString(),
      ttlSeconds.toString(),
      limits.maxMemoryMb.toString(),
      limits.maxCpuPercent.toString(),
      limits.timeoutMs.toString(),
      (limits.maxNetworkRequests ?? -1).toString(),
      (limits.maxFileSystemOps ?? -1).toString()
    );

    logger.debug(
      { executionId, limits, ttlMs },
      'Execution state initialized'
    );
  }

  /**
   * Record memory usage sample, updating peak if higher
   */
  async recordMemoryUsage(executionId: ID, memoryMb: number): Promise<void> {
    const key = this.buildKey(executionId);

    await this.redis.eval(
      UPDATE_MEMORY_PEAK_LUA,
      1,
      key,
      memoryMb.toString()
    );
  }

  /**
   * Get peak memory usage for an execution
   */
  async getPeakMemory(executionId: ID): Promise<number> {
    const key = this.buildKey(executionId);
    const value = await this.redis.hget(key, 'memoryPeakMb');
    return value ? parseFloat(value) : 0;
  }

  /**
   * Atomically increment CPU time and return new total
   */
  async incrementCpuTime(executionId: ID, deltaMs: number): Promise<number> {
    const key = this.buildKey(executionId);

    const result = await this.redis.eval(
      INCREMENT_CPU_TIME_LUA,
      1,
      key,
      deltaMs.toString()
    ) as number;

    return result;
  }

  /**
   * Get total CPU time for an execution
   */
  async getCpuTimeMs(executionId: ID): Promise<number> {
    const key = this.buildKey(executionId);
    const value = await this.redis.hget(key, 'cpuTimeMs');
    return value ? parseFloat(value) : 0;
  }

  /**
   * Atomically increment network request count and check limit
   */
  async incrementNetworkRequests(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }> {
    const key = this.buildKey(executionId);

    const result = await this.redis.eval(
      INCREMENT_AND_CHECK_LUA,
      1,
      key,
      'networkRequests',
      '1',
      limit.toString()
    ) as [number, number];

    const [allowed, current] = result;
    return { allowed: allowed === 1, current };
  }

  /**
   * Get current network request count
   */
  async getNetworkRequestCount(executionId: ID): Promise<number> {
    const key = this.buildKey(executionId);
    const value = await this.redis.hget(key, 'networkRequests');
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Atomically increment file system operation count and check limit
   */
  async incrementFileSystemOps(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }> {
    const key = this.buildKey(executionId);

    const result = await this.redis.eval(
      INCREMENT_AND_CHECK_LUA,
      1,
      key,
      'fileSystemOps',
      '1',
      limit.toString()
    ) as [number, number];

    const [allowed, current] = result;
    return { allowed: allowed === 1, current };
  }

  /**
   * Get current file system operation count
   */
  async getFileSystemOpCount(executionId: ID): Promise<number> {
    const key = this.buildKey(executionId);
    const value = await this.redis.hget(key, 'fileSystemOps');
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Check if execution should be terminated based on resource limits
   */
  async shouldTerminate(
    executionId: ID,
    limits: ResourceLimits
  ): Promise<{ terminate: boolean; reason?: string; violation?: string }> {
    const key = this.buildKey(executionId);
    const currentTime = Date.now();

    // Calculate effective CPU time limit based on percent and elapsed time
    // This allows for burst usage while maintaining overall limit
    const startTime = await this.redis.hget(key, 'startTime');
    const elapsedMs = startTime ? currentTime - parseInt(startTime, 10) : 0;
    const cpuTimeLimit = (limits.maxCpuPercent / 100) * elapsedMs;

    const result = await this.redis.eval(
      CHECK_LIMITS_LUA,
      1,
      key,
      limits.maxMemoryMb.toString(),
      cpuTimeLimit.toString(),
      (limits.maxNetworkRequests ?? -1).toString(),
      (limits.maxFileSystemOps ?? -1).toString(),
      currentTime.toString(),
      limits.timeoutMs.toString()
    ) as [number, number, number, number];

    const [shouldTerminate, violationType, currentValue, limit] = result;

    if (shouldTerminate === 1) {
      const violation = VIOLATION_TYPES[violationType as keyof typeof VIOLATION_TYPES];
      const reason = violation
        ? `${VIOLATION_DESCRIPTIONS[violation]}: ${currentValue} exceeds limit of ${limit}`
        : 'Unknown violation';

      logger.warn(
        { executionId, violation, currentValue, limit },
        'Resource limit violation detected'
      );

      return {
        terminate: true,
        reason,
        violation: violation ?? undefined,
      };
    }

    return { terminate: false };
  }

  /**
   * Clean up execution tracking and return final usage metrics
   */
  async cleanupExecution(executionId: ID): Promise<ResourceUsage> {
    const key = this.buildKey(executionId);

    const result = await this.redis.eval(
      CLEANUP_EXECUTION_LUA,
      1,
      key
    ) as [number, number, number, number, number];

    const [memoryPeakMb, cpuTimeMs, wallTimeMs, networkRequests, fileSystemOps] = result;

    logger.debug(
      { executionId, memoryPeakMb, cpuTimeMs, wallTimeMs, networkRequests, fileSystemOps },
      'Execution state cleaned up'
    );

    return {
      memoryPeakMb,
      cpuTimeMs,
      wallTimeMs,
      networkRequests,
      fileSystemOps,
    };
  }

  /**
   * Get a snapshot of all resource metrics
   */
  async getResourceSnapshot(executionId: ID): Promise<{
    memoryPeakMb: number;
    cpuTimeMs: number;
    networkRequests: number;
    fileSystemOps: number;
    wallTimeMs: number;
  }> {
    const key = this.buildKey(executionId);
    const currentTime = Date.now();

    const result = await this.redis.eval(
      GET_RESOURCE_SNAPSHOT_LUA,
      1,
      key
    ) as [number, number, number, number, number];

    const [memoryPeakMb, cpuTimeMs, networkRequests, fileSystemOps, startTime] = result;
    const wallTimeMs = startTime > 0 ? currentTime - startTime : 0;

    return {
      memoryPeakMb,
      cpuTimeMs,
      networkRequests,
      fileSystemOps,
      wallTimeMs,
    };
  }
}

/**
 * Create a Redis resource state provider instance
 */
export function createResourceStateProvider(
  deps: RedisResourceStateProviderDependencies = {}
): ResourceStateProvider {
  return new RedisResourceStateProvider(deps);
}
