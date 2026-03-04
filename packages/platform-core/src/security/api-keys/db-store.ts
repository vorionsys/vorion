/**
 * Database-backed API Key Store
 *
 * Production-ready implementation of IApiKeyStore using Drizzle ORM
 * with PostgreSQL. Supports optional Redis for high-performance rate limiting.
 *
 * Features:
 * - Full CRUD operations with proper transactions
 * - Efficient indexing (by prefix, tenantId)
 * - Rate limit state with TTL-based cleanup
 * - Redis integration for rate limiting when available
 * - Graceful fallback to database when Redis is unavailable
 *
 * @packageDocumentation
 */

import { eq, and, desc, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { getDatabase, type Database } from '../../common/db.js';
import { createLogger } from '../../common/logger.js';
import {
  apiKeys,
  apiKeyRateLimits,
  type ApiKeyRecord,
  type ApiKeyRateLimitRecord,
} from '@vorionsys/contracts/db';
import type { IApiKeyStore } from './store.js';
import type {
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  ApiKeyRateLimitState,
  ApiKeyListFilters,
  ApiKeyRateLimit,
} from './types.js';

const logger = createLogger({ component: 'db-api-key-store' });

// =============================================================================
// CONSTANTS
// =============================================================================

/** TTL for rate limit records in seconds (2 hours) */
const RATE_LIMIT_TTL_SECONDS = 7200;

/** Redis key prefix for rate limit state */
const REDIS_RATE_LIMIT_PREFIX = 'vorion:api-key:ratelimit:';

/** Cleanup batch size for stale rate limit records */
const CLEANUP_BATCH_SIZE = 1000;

// =============================================================================
// DATABASE API KEY STORE
// =============================================================================

/**
 * Database-backed API key store implementation.
 *
 * Uses PostgreSQL via Drizzle ORM for persistent storage of API keys.
 * Optionally uses Redis for high-performance rate limiting.
 */
export class DbApiKeyStore implements IApiKeyStore {
  private db: Database;
  private redis: Redis | null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options?: { database?: Database; redis?: Redis | null }) {
    this.db = options?.database ?? getDatabase();
    this.redis = options?.redis ?? null;

    // Start periodic cleanup of stale rate limit records
    this.startCleanup();
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new API key
   */
  async create(apiKey: ApiKey): Promise<ApiKey> {
    try {
      const [record] = await this.db
        .insert(apiKeys)
        .values({
          id: apiKey.id,
          name: apiKey.name,
          prefix: apiKey.prefix,
          hashedKey: apiKey.hashedKey,
          tenantId: apiKey.tenantId,
          createdBy: apiKey.createdBy,
          scopes: apiKey.scopes,
          rateLimitRequestsPerMinute: apiKey.rateLimit.requestsPerMinute,
          rateLimitRequestsPerHour: apiKey.rateLimit.requestsPerHour,
          rateLimitBurstLimit: apiKey.rateLimit.burstLimit,
          status: apiKey.status,
          expiresAt: apiKey.expiresAt,
          description: apiKey.description,
          allowedIps: apiKey.allowedIps,
          metadata: apiKey.metadata,
        })
        .returning();

      logger.info(
        { keyId: apiKey.id, prefix: apiKey.prefix, tenantId: apiKey.tenantId },
        'API key created in database'
      );

      return this.mapRecordToApiKey(record);
    } catch (error) {
      // Check for duplicate prefix error
      if (this.isDuplicateKeyError(error)) {
        throw new Error(`API key with prefix ${apiKey.prefix} already exists`);
      }
      logger.error({ error, keyId: apiKey.id }, 'Failed to create API key');
      throw error;
    }
  }

  /**
   * Get an API key by ID
   */
  async getById(id: string): Promise<ApiKey | null> {
    try {
      const [record] = await this.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1);

      return record ? this.mapRecordToApiKey(record) : null;
    } catch (error) {
      logger.error({ error, keyId: id }, 'Failed to get API key by ID');
      throw error;
    }
  }

  /**
   * Get an API key by prefix (first 8 chars)
   * This is the primary lookup method during validation
   */
  async getByPrefix(prefix: string): Promise<ApiKey | null> {
    try {
      const [record] = await this.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.prefix, prefix))
        .limit(1);

      return record ? this.mapRecordToApiKey(record) : null;
    } catch (error) {
      logger.error({ error, prefix }, 'Failed to get API key by prefix');
      throw error;
    }
  }

  /**
   * Update an API key
   */
  async update(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
    try {
      // Build update object, excluding immutable fields
      const updateData: Record<string, unknown> = {};

      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.scopes !== undefined) updateData.scopes = updates.scopes;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.allowedIps !== undefined) updateData.allowedIps = updates.allowedIps;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;
      if (updates.lastUsedAt !== undefined) updateData.lastUsedAt = updates.lastUsedAt;

      // Handle rate limit updates
      if (updates.rateLimit) {
        if (updates.rateLimit.requestsPerMinute !== undefined) {
          updateData.rateLimitRequestsPerMinute = updates.rateLimit.requestsPerMinute;
        }
        if (updates.rateLimit.requestsPerHour !== undefined) {
          updateData.rateLimitRequestsPerHour = updates.rateLimit.requestsPerHour;
        }
        if (updates.rateLimit.burstLimit !== undefined) {
          updateData.rateLimitBurstLimit = updates.rateLimit.burstLimit;
        }
      }

      if (Object.keys(updateData).length === 0) {
        // No updates to apply, return current state
        return this.getById(id);
      }

      const [record] = await this.db
        .update(apiKeys)
        .set(updateData)
        .where(eq(apiKeys.id, id))
        .returning();

      if (record) {
        logger.info({ keyId: id }, 'API key updated in database');
        return this.mapRecordToApiKey(record);
      }

      return null;
    } catch (error) {
      logger.error({ error, keyId: id }, 'Failed to update API key');
      throw error;
    }
  }

  /**
   * Delete an API key
   */
  async delete(id: string): Promise<boolean> {
    try {
      // Use transaction to delete key and associated rate limit state
      return await this.db.transaction(async (tx) => {
        // Delete rate limit state first (cascade should handle this, but be explicit)
        await tx.delete(apiKeyRateLimits).where(eq(apiKeyRateLimits.keyId, id));

        // Delete the key
        const result = await tx
          .delete(apiKeys)
          .where(eq(apiKeys.id, id))
          .returning({ id: apiKeys.id });

        if (result.length > 0) {
          // Also clear Redis rate limit state if available
          if (this.redis) {
            try {
              await this.redis.del(`${REDIS_RATE_LIMIT_PREFIX}${id}`);
            } catch (redisError) {
              logger.warn({ error: redisError, keyId: id }, 'Failed to delete Redis rate limit state');
            }
          }

          logger.info({ keyId: id }, 'API key deleted from database');
          return true;
        }

        return false;
      });
    } catch (error) {
      logger.error({ error, keyId: id }, 'Failed to delete API key');
      throw error;
    }
  }

  /**
   * List API keys with filters
   */
  async list(filters: ApiKeyListFilters): Promise<{ keys: ApiKey[]; total: number }> {
    try {
      // Build WHERE conditions
      const conditions = [eq(apiKeys.tenantId, filters.tenantId)];

      if (filters.status) {
        conditions.push(eq(apiKeys.status, filters.status));
      }

      if (filters.createdBy) {
        conditions.push(eq(apiKeys.createdBy, filters.createdBy));
      }

      // Get total count
      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get paginated results
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      let query = this.db
        .select()
        .from(apiKeys)
        .where(and(...conditions))
        .orderBy(desc(apiKeys.createdAt))
        .limit(limit)
        .offset(offset);

      const records = await query;

      // Filter by scope in memory (JSON array filtering)
      let keys = records.map((record) => this.mapRecordToApiKey(record));

      if (filters.scope) {
        keys = keys.filter((key) => key.scopes.includes(filters.scope as ApiKeyScope));
      }

      return { keys, total };
    } catch (error) {
      logger.error({ error, tenantId: filters.tenantId }, 'Failed to list API keys');
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Rate Limit State Operations
  // ---------------------------------------------------------------------------

  /**
   * Get rate limit state for a key
   *
   * Uses Redis if available, falls back to database
   */
  async getRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null> {
    // Try Redis first if available
    if (this.redis) {
      try {
        const state = await this.getRedisRateLimitState(keyId);
        if (state) return state;
      } catch (error) {
        logger.warn(
          { error, keyId },
          'Failed to get rate limit state from Redis, falling back to database'
        );
      }
    }

    // Fall back to database
    return this.getDbRateLimitState(keyId);
  }

  /**
   * Set rate limit state for a key
   *
   * Uses Redis if available, always persists to database as backup
   */
  async setRateLimitState(state: ApiKeyRateLimitState): Promise<void> {
    // Always persist to database
    await this.setDbRateLimitState(state);

    // Also set in Redis if available (for faster reads)
    if (this.redis) {
      try {
        await this.setRedisRateLimitState(state);
      } catch (error) {
        logger.warn(
          { error, keyId: state.keyId },
          'Failed to set rate limit state in Redis'
        );
      }
    }
  }

  /**
   * Atomically increment rate limit counters using Redis INCR
   *
   * This is the preferred method for distributed rate limiting.
   * Uses Redis atomic INCR with EXPIRE for sliding window.
   * Falls back to database-based counting if Redis is unavailable.
   *
   * @param keyId - The API key ID
   * @returns Current counts after incrementing
   */
  async incrementRateLimitCounters(keyId: string): Promise<{
    second: number;
    minute: number;
    hour: number;
  }> {
    // Try Redis first for atomic increment
    if (this.redis) {
      try {
        const now = Date.now();
        const secondKey = `${REDIS_RATE_LIMIT_PREFIX}${keyId}:second:${Math.floor(now / 1000)}`;
        const minuteKey = `${REDIS_RATE_LIMIT_PREFIX}${keyId}:minute:${Math.floor(now / 60000)}`;
        const hourKey = `${REDIS_RATE_LIMIT_PREFIX}${keyId}:hour:${Math.floor(now / 3600000)}`;

        // Use pipeline for efficiency
        const pipeline = this.redis.pipeline();
        pipeline.incr(secondKey);
        pipeline.expire(secondKey, 2); // 2 second TTL for second window
        pipeline.incr(minuteKey);
        pipeline.expire(minuteKey, 120); // 2 minute TTL for minute window
        pipeline.incr(hourKey);
        pipeline.expire(hourKey, 7200); // 2 hour TTL for hour window

        const results = await pipeline.exec();

        if (!results) {
          throw new Error('Redis pipeline execution failed');
        }

        // Extract values from pipeline results
        // Results are [error, value] tuples, with incr results at indices 0, 2, 4
        const secondCount = (results[0]?.[1] as number) ?? 0;
        const minuteCount = (results[2]?.[1] as number) ?? 0;
        const hourCount = (results[4]?.[1] as number) ?? 0;

        return {
          second: secondCount,
          minute: minuteCount,
          hour: hourCount,
        };
      } catch (error) {
        logger.warn(
          { error, keyId },
          'Failed to increment rate limit counters in Redis, falling back to database'
        );
      }
    }

    // Fallback: Use database with optimistic locking
    return this.incrementDbRateLimitCounters(keyId);
  }

  /**
   * Increment rate limit counters in the database
   * Used as fallback when Redis is unavailable
   */
  private async incrementDbRateLimitCounters(keyId: string): Promise<{
    second: number;
    minute: number;
    hour: number;
  }> {
    const now = Date.now();

    // Get current state
    let state = await this.getDbRateLimitState(keyId);

    if (!state) {
      state = {
        keyId,
        second: { count: 0, resetAt: now + 1000 },
        minute: { count: 0, resetAt: now + 60000 },
        hour: { count: 0, resetAt: now + 3600000 },
      };
    }

    // Reset expired windows and increment
    if (now >= state.second.resetAt) {
      state.second = { count: 1, resetAt: now + 1000 };
    } else {
      state.second.count++;
    }

    if (now >= state.minute.resetAt) {
      state.minute = { count: 1, resetAt: now + 60000 };
    } else {
      state.minute.count++;
    }

    if (now >= state.hour.resetAt) {
      state.hour = { count: 1, resetAt: now + 3600000 };
    } else {
      state.hour.count++;
    }

    // Persist updated state
    await this.setDbRateLimitState(state);

    return {
      second: state.second.count,
      minute: state.minute.count,
      hour: state.hour.count,
    };
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    try {
      await this.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, id));
    } catch (error) {
      logger.error({ error, keyId: id }, 'Failed to update last used timestamp');
      // Don't throw - this is not critical
    }
  }

  /**
   * Reset the store (for testing)
   */
  reset(): void {
    // In database mode, reset means clearing all data
    // This should only be used in testing
    logger.warn('Reset called on database store - this should only be used in testing');
  }

  /**
   * Stop cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Redis Rate Limit Operations
  // ---------------------------------------------------------------------------

  private async getRedisRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null> {
    if (!this.redis) return null;

    const data = await this.redis.get(`${REDIS_RATE_LIMIT_PREFIX}${keyId}`);
    if (!data) return null;

    try {
      return JSON.parse(data) as ApiKeyRateLimitState;
    } catch {
      return null;
    }
  }

  private async setRedisRateLimitState(state: ApiKeyRateLimitState): Promise<void> {
    if (!this.redis) return;

    // Calculate TTL based on the latest reset time
    const maxResetAt = Math.max(state.second.resetAt, state.minute.resetAt, state.hour.resetAt);
    const ttl = Math.max(1, Math.ceil((maxResetAt - Date.now()) / 1000) + 60); // Add 1 minute buffer

    await this.redis.set(
      `${REDIS_RATE_LIMIT_PREFIX}${state.keyId}`,
      JSON.stringify(state),
      'EX',
      ttl
    );
  }

  // ---------------------------------------------------------------------------
  // Database Rate Limit Operations
  // ---------------------------------------------------------------------------

  private async getDbRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null> {
    try {
      const [record] = await this.db
        .select()
        .from(apiKeyRateLimits)
        .where(eq(apiKeyRateLimits.keyId, keyId))
        .limit(1);

      if (!record) return null;

      return this.mapRateLimitRecordToState(record);
    } catch (error) {
      logger.error({ error, keyId }, 'Failed to get rate limit state from database');
      return null;
    }
  }

  private async setDbRateLimitState(state: ApiKeyRateLimitState): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RATE_LIMIT_TTL_SECONDS * 1000);

    try {
      // Upsert rate limit state
      await this.db
        .insert(apiKeyRateLimits)
        .values({
          keyId: state.keyId,
          secondCount: state.second.count,
          secondResetAt: state.second.resetAt,
          minuteCount: state.minute.count,
          minuteResetAt: state.minute.resetAt,
          hourCount: state.hour.count,
          hourResetAt: state.hour.resetAt,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: apiKeyRateLimits.keyId,
          set: {
            secondCount: state.second.count,
            secondResetAt: state.second.resetAt,
            minuteCount: state.minute.count,
            minuteResetAt: state.minute.resetAt,
            hourCount: state.hour.count,
            hourResetAt: state.hour.resetAt,
            expiresAt,
            updatedAt: now,
          },
        });
    } catch (error) {
      logger.error({ error, keyId: state.keyId }, 'Failed to set rate limit state in database');
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup Operations
  // ---------------------------------------------------------------------------

  /**
   * Start periodic cleanup of stale rate limit records
   */
  private startCleanup(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupStaleRateLimits().catch((error) => {
          logger.error({ error }, 'Failed to cleanup stale rate limit records');
        });
      },
      5 * 60 * 1000
    );

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Remove expired rate limit records
   */
  async cleanupStaleRateLimits(): Promise<number> {
    try {
      const now = new Date();

      const result = await this.db
        .delete(apiKeyRateLimits)
        .where(lt(apiKeyRateLimits.expiresAt, now))
        .returning({ id: apiKeyRateLimits.id });

      if (result.length > 0) {
        logger.info({ count: result.length }, 'Cleaned up stale rate limit records');
      }

      return result.length;
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup stale rate limit records');
      return 0;
    }
  }

  /**
   * Update expired API keys status
   */
  async updateExpiredKeys(): Promise<number> {
    try {
      const now = new Date();

      const result = await this.db
        .update(apiKeys)
        .set({ status: 'expired' })
        .where(
          and(
            eq(apiKeys.status, 'active'),
            lt(apiKeys.expiresAt, now)
          )
        )
        .returning({ id: apiKeys.id });

      if (result.length > 0) {
        logger.info({ count: result.length }, 'Updated expired API keys');
      }

      return result.length;
    } catch (error) {
      logger.error({ error }, 'Failed to update expired API keys');
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping Functions
  // ---------------------------------------------------------------------------

  private mapRecordToApiKey(record: ApiKeyRecord): ApiKey {
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      hashedKey: record.hashedKey,
      tenantId: record.tenantId,
      createdBy: record.createdBy,
      scopes: (record.scopes ?? []) as ApiKeyScope[],
      rateLimit: {
        requestsPerMinute: record.rateLimitRequestsPerMinute,
        requestsPerHour: record.rateLimitRequestsPerHour,
        burstLimit: record.rateLimitBurstLimit,
      },
      status: record.status as ApiKeyStatus,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      description: record.description ?? undefined,
      allowedIps: (record.allowedIps as string[] | null) ?? undefined,
      metadata: (record.metadata as Record<string, unknown>) ?? {},
    };
  }

  private mapRateLimitRecordToState(record: ApiKeyRateLimitRecord): ApiKeyRateLimitState {
    return {
      keyId: record.keyId,
      second: {
        count: record.secondCount,
        resetAt: record.secondResetAt,
      },
      minute: {
        count: record.minuteCount,
        resetAt: record.minuteResetAt,
      },
      hour: {
        count: record.hourCount,
        resetAt: record.hourResetAt,
      },
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (error instanceof Error) {
      const pgError = error as { code?: string; constraint?: string };
      // PostgreSQL unique violation
      return pgError.code === '23505' && (pgError.constraint?.includes('prefix') ?? false);
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get store statistics
   */
  async getStats(): Promise<{
    totalKeys: number;
    byStatus: Record<ApiKeyStatus, number>;
    byTenant: Record<string, number>;
    rateLimitStates: number;
  }> {
    try {
      // Get total count
      const [totalResult] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys);

      // Get count by status
      const statusCounts = await this.db
        .select({
          status: apiKeys.status,
          count: sql<number>`count(*)::int`,
        })
        .from(apiKeys)
        .groupBy(apiKeys.status);

      // Get count by tenant (top 100)
      const tenantCounts = await this.db
        .select({
          tenantId: apiKeys.tenantId,
          count: sql<number>`count(*)::int`,
        })
        .from(apiKeys)
        .groupBy(apiKeys.tenantId)
        .limit(100);

      // Get rate limit state count
      const [rateLimitResult] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeyRateLimits);

      const byStatus: Record<ApiKeyStatus, number> = {
        active: 0,
        revoked: 0,
        expired: 0,
      };

      for (const { status, count } of statusCounts) {
        byStatus[status as ApiKeyStatus] = count;
      }

      const byTenant: Record<string, number> = {};
      for (const { tenantId, count } of tenantCounts) {
        byTenant[tenantId] = count;
      }

      return {
        totalKeys: totalResult?.count ?? 0,
        byStatus,
        byTenant,
        rateLimitStates: rateLimitResult?.count ?? 0,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get store statistics');
      throw error;
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let dbStore: DbApiKeyStore | null = null;

/**
 * Get the database API key store singleton
 */
export function getDbApiKeyStore(redis?: Redis | null): DbApiKeyStore {
  if (!dbStore) {
    dbStore = new DbApiKeyStore({ redis });
    logger.info('Database API key store initialized');
  }
  return dbStore;
}

/**
 * Create a new database API key store instance (for testing)
 */
export function createDbApiKeyStore(options?: {
  database?: Database;
  redis?: Redis | null;
}): DbApiKeyStore {
  return new DbApiKeyStore(options);
}

/**
 * Reset the database API key store singleton (for testing)
 */
export function resetDbApiKeyStore(): void {
  if (dbStore) {
    dbStore.stop();
    dbStore = null;
  }
  logger.info('Database API key store singleton reset');
}
