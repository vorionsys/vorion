/**
 * Redis-backed SSO Authorization State Store
 *
 * Provides cluster-safe state storage for OAuth/OIDC authorization flows.
 * Uses Redis SET NX for atomic state creation to prevent replay attacks.
 *
 * Features:
 * - Atomic state creation (prevents race conditions)
 * - Automatic TTL expiration (5 minutes default)
 * - Atomic consume operation (get and delete in one operation)
 * - Fallback to in-memory storage for development/testing
 *
 * @module auth/sso/redis-state-store
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import type { AuthorizationState } from './types.js';

const logger = createLogger({ component: 'sso-state-store' });

/**
 * Configuration for the Redis state store
 */
export interface RedisStateStoreConfig {
  /** Redis client instance */
  redis: Redis | null;
  /** Key prefix for state entries (default: 'sso:state:') */
  keyPrefix?: string;
  /** State TTL in seconds (default: 300 = 5 minutes) */
  stateTtlSeconds?: number;
  /** Enable fallback to in-memory when Redis unavailable */
  enableMemoryFallback?: boolean;
}

/**
 * Serialized authorization state for Redis storage
 */
interface SerializedAuthorizationState {
  state: string;
  nonce: string;
  codeVerifier?: string;
  providerId: string;
  returnUrl?: string;
  tenantId?: string;
  createdAt: string; // ISO date string
  expiresAt: string; // ISO date string
  metadata?: Record<string, unknown>;
}

/**
 * Result of an atomic consume operation
 */
export interface ConsumeStateResult {
  /** Whether the state was successfully consumed */
  success: boolean;
  /** The consumed state (if successful) */
  state?: AuthorizationState;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Redis-backed SSO State Store
 *
 * Provides atomic operations for managing OAuth authorization state
 * in a cluster-safe manner using Redis.
 *
 * @example
 * ```typescript
 * const stateStore = new RedisStateStore({
 *   redis: getRedis(),
 *   stateTtlSeconds: 300, // 5 minutes
 * });
 *
 * // Store state atomically
 * const stored = await stateStore.set(authState);
 * if (!stored) {
 *   throw new Error('State already exists (potential replay)');
 * }
 *
 * // Consume state atomically (get and delete)
 * const result = await stateStore.consume(stateParam);
 * if (!result.success) {
 *   throw new Error(result.error);
 * }
 * ```
 */
export class RedisStateStore {
  private readonly redis: Redis | null;
  private readonly keyPrefix: string;
  private readonly stateTtlSeconds: number;
  private readonly enableMemoryFallback: boolean;

  /** In-memory fallback store for development/testing */
  private readonly memoryStore = new Map<string, AuthorizationState>();
  private memoryCleanupInterval: NodeJS.Timeout | null = null;

  /** Lua script for atomic consume (GET + DELETE) */
  private static readonly CONSUME_SCRIPT = `
    local value = redis.call('GET', KEYS[1])
    if value then
      redis.call('DEL', KEYS[1])
      return value
    end
    return nil
  `;

  /** SHA of the loaded consume script */
  private consumeScriptSha: string | null = null;

  constructor(config: RedisStateStoreConfig) {
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix ?? 'sso:state:';
    this.stateTtlSeconds = config.stateTtlSeconds ?? 300; // 5 minutes
    this.enableMemoryFallback = config.enableMemoryFallback ?? true;

    if (this.redis) {
      // Load the consume script
      this.loadConsumeScript().catch((error) => {
        logger.warn({ error }, 'Failed to load consume script, will use eval');
      });
    }

    // Start memory cleanup if fallback is enabled
    if (this.enableMemoryFallback) {
      this.startMemoryCleanup();
    }

    logger.info({
      hasRedis: !!this.redis,
      keyPrefix: this.keyPrefix,
      stateTtlSeconds: this.stateTtlSeconds,
      enableMemoryFallback: this.enableMemoryFallback,
    }, 'RedisStateStore initialized');
  }

  /**
   * Load the consume Lua script into Redis
   */
  private async loadConsumeScript(): Promise<void> {
    if (!this.redis) return;

    try {
      this.consumeScriptSha = await this.redis.script(
        'LOAD',
        RedisStateStore.CONSUME_SCRIPT
      ) as string;
      logger.debug({ sha: this.consumeScriptSha }, 'Consume script loaded');
    } catch (error) {
      logger.warn({ error }, 'Failed to load consume script');
      throw error;
    }
  }

  /**
   * Start periodic cleanup of expired in-memory states
   */
  private startMemoryCleanup(): void {
    // Clean up every 30 seconds
    this.memoryCleanupInterval = setInterval(() => {
      this.cleanupExpiredMemoryStates();
    }, 30000);

    // Don't prevent process exit
    this.memoryCleanupInterval.unref();
  }

  /**
   * Clean up expired states from memory store
   */
  private cleanupExpiredMemoryStates(): number {
    const now = new Date();
    let cleaned = 0;

    // Use Array.from to avoid downlevelIteration requirements
    const entries = Array.from(this.memoryStore.entries());
    for (const [key, state] of entries) {
      if (now > state.expiresAt) {
        this.memoryStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ count: cleaned }, 'Cleaned up expired memory states');
    }

    return cleaned;
  }

  /**
   * Generate Redis key for a state
   */
  private getKey(state: string): string {
    return `${this.keyPrefix}${state}`;
  }

  /**
   * Serialize state for Redis storage
   */
  private serialize(state: AuthorizationState): string {
    const serialized: SerializedAuthorizationState = {
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
      providerId: state.providerId,
      returnUrl: state.returnUrl,
      tenantId: state.tenantId,
      createdAt: state.createdAt.toISOString(),
      expiresAt: state.expiresAt.toISOString(),
      metadata: state.metadata,
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize state from Redis storage
   */
  private deserialize(data: string): AuthorizationState {
    const serialized: SerializedAuthorizationState = JSON.parse(data);
    return {
      state: serialized.state,
      nonce: serialized.nonce,
      codeVerifier: serialized.codeVerifier,
      providerId: serialized.providerId,
      returnUrl: serialized.returnUrl,
      tenantId: serialized.tenantId,
      createdAt: new Date(serialized.createdAt),
      expiresAt: new Date(serialized.expiresAt),
      metadata: serialized.metadata,
    };
  }

  /**
   * Check if Redis is available
   */
  private isRedisAvailable(): boolean {
    if (!this.redis) return false;

    try {
      // Check connection status
      return this.redis.status === 'ready';
    } catch {
      return false;
    }
  }

  /**
   * Store authorization state atomically
   *
   * Uses SET NX to ensure the state doesn't already exist,
   * preventing replay attacks where an attacker tries to
   * reuse a state parameter.
   *
   * @param state - The authorization state to store
   * @returns true if stored successfully, false if state already exists
   */
  async set(state: AuthorizationState): Promise<boolean> {
    const key = this.getKey(state.state);
    const serialized = this.serialize(state);

    // Try Redis first
    if (this.isRedisAvailable()) {
      try {
        // SET NX EX - Set only if not exists, with expiration
        const result = await this.redis!.set(
          key,
          serialized,
          'EX',
          this.stateTtlSeconds,
          'NX'
        );

        const stored = result === 'OK';

        if (stored) {
          logger.debug({ state: state.state, providerId: state.providerId }, 'State stored in Redis');
        } else {
          logger.warn({ state: state.state }, 'State already exists in Redis (potential replay)');
        }

        return stored;
      } catch (error) {
        logger.error({ error, state: state.state }, 'Failed to store state in Redis');

        // Fall back to memory if enabled
        if (this.enableMemoryFallback) {
          logger.warn('Falling back to in-memory state storage');
          return this.setInMemory(state);
        }

        throw error;
      }
    }

    // Use in-memory fallback
    if (this.enableMemoryFallback) {
      return this.setInMemory(state);
    }

    throw new Error('Redis not available and memory fallback is disabled');
  }

  /**
   * Store state in memory (fallback)
   */
  private setInMemory(state: AuthorizationState): boolean {
    if (this.memoryStore.has(state.state)) {
      logger.warn({ state: state.state }, 'State already exists in memory (potential replay)');
      return false;
    }

    this.memoryStore.set(state.state, state);
    logger.debug({ state: state.state, providerId: state.providerId }, 'State stored in memory');
    return true;
  }

  /**
   * Get authorization state without consuming it
   *
   * @param stateParam - The state parameter to look up
   * @returns The authorization state if found and not expired, undefined otherwise
   */
  async get(stateParam: string): Promise<AuthorizationState | undefined> {
    const key = this.getKey(stateParam);

    // Try Redis first
    if (this.isRedisAvailable()) {
      try {
        const data = await this.redis!.get(key);

        if (!data) {
          // Check memory fallback in case of Redis failover
          if (this.enableMemoryFallback && this.memoryStore.has(stateParam)) {
            return this.getFromMemory(stateParam);
          }
          return undefined;
        }

        const state = this.deserialize(data);

        // Check expiration (Redis TTL should handle this, but double-check)
        if (new Date() > state.expiresAt) {
          // Expired - delete and return undefined
          await this.redis!.del(key);
          return undefined;
        }

        return state;
      } catch (error) {
        logger.error({ error, state: stateParam }, 'Failed to get state from Redis');

        // Fall back to memory
        if (this.enableMemoryFallback) {
          return this.getFromMemory(stateParam);
        }

        throw error;
      }
    }

    // Use in-memory fallback
    if (this.enableMemoryFallback) {
      return this.getFromMemory(stateParam);
    }

    throw new Error('Redis not available and memory fallback is disabled');
  }

  /**
   * Get state from memory (fallback)
   */
  private getFromMemory(stateParam: string): AuthorizationState | undefined {
    const state = this.memoryStore.get(stateParam);

    if (!state) {
      return undefined;
    }

    // Check expiration
    if (new Date() > state.expiresAt) {
      this.memoryStore.delete(stateParam);
      return undefined;
    }

    return state;
  }

  /**
   * Consume authorization state atomically
   *
   * Gets and deletes the state in a single atomic operation to prevent
   * replay attacks. This is the recommended way to retrieve state during
   * the OAuth callback.
   *
   * @param stateParam - The state parameter to consume
   * @returns Result indicating success/failure with the consumed state
   */
  async consume(stateParam: string): Promise<ConsumeStateResult> {
    const key = this.getKey(stateParam);

    // Try Redis first
    if (this.isRedisAvailable()) {
      try {
        let data: string | null = null;

        // Use EVALSHA if script is loaded, otherwise use EVAL
        if (this.consumeScriptSha) {
          try {
            data = await this.redis!.evalsha(
              this.consumeScriptSha,
              1,
              key
            ) as string | null;
          } catch (error) {
            // Script might have been flushed, try reloading
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('NOSCRIPT')) {
              await this.loadConsumeScript();
              data = await this.redis!.evalsha(
                this.consumeScriptSha!,
                1,
                key
              ) as string | null;
            } else {
              throw error;
            }
          }
        } else {
          // Fallback to EVAL
          data = await this.redis!.eval(
            RedisStateStore.CONSUME_SCRIPT,
            1,
            key
          ) as string | null;
        }

        if (!data) {
          // Check memory fallback in case of Redis failover
          if (this.enableMemoryFallback && this.memoryStore.has(stateParam)) {
            return this.consumeFromMemory(stateParam);
          }

          return {
            success: false,
            error: 'State not found or already consumed',
          };
        }

        const state = this.deserialize(data);

        // Check expiration
        if (new Date() > state.expiresAt) {
          return {
            success: false,
            error: 'State expired',
          };
        }

        logger.debug({ state: stateParam, providerId: state.providerId }, 'State consumed from Redis');

        return {
          success: true,
          state,
        };
      } catch (error) {
        logger.error({ error, state: stateParam }, 'Failed to consume state from Redis');

        // Fall back to memory
        if (this.enableMemoryFallback && this.memoryStore.has(stateParam)) {
          return this.consumeFromMemory(stateParam);
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    // Use in-memory fallback
    if (this.enableMemoryFallback) {
      return this.consumeFromMemory(stateParam);
    }

    return {
      success: false,
      error: 'Redis not available and memory fallback is disabled',
    };
  }

  /**
   * Consume state from memory (fallback)
   */
  private consumeFromMemory(stateParam: string): ConsumeStateResult {
    const state = this.memoryStore.get(stateParam);

    if (!state) {
      return {
        success: false,
        error: 'State not found or already consumed',
      };
    }

    // Delete atomically (Map operations are synchronous)
    this.memoryStore.delete(stateParam);

    // Check expiration
    if (new Date() > state.expiresAt) {
      return {
        success: false,
        error: 'State expired',
      };
    }

    logger.debug({ state: stateParam, providerId: state.providerId }, 'State consumed from memory');

    return {
      success: true,
      state,
    };
  }

  /**
   * Delete a specific state
   *
   * @param stateParam - The state parameter to delete
   * @returns true if deleted, false if not found
   */
  async delete(stateParam: string): Promise<boolean> {
    const key = this.getKey(stateParam);

    if (this.isRedisAvailable()) {
      try {
        const deleted = await this.redis!.del(key);

        // Also delete from memory if it exists there
        if (this.enableMemoryFallback) {
          this.memoryStore.delete(stateParam);
        }

        return deleted > 0;
      } catch (error) {
        logger.error({ error, state: stateParam }, 'Failed to delete state from Redis');

        // Try memory fallback
        if (this.enableMemoryFallback) {
          return this.memoryStore.delete(stateParam);
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      return this.memoryStore.delete(stateParam);
    }

    return false;
  }

  /**
   * Clean up expired states
   *
   * Note: Redis TTL handles expiration automatically.
   * This method is mainly for the in-memory fallback.
   *
   * @returns Number of expired states cleaned up
   */
  async cleanup(): Promise<number> {
    // Clean up memory store
    const memoryCleanedCount = this.cleanupExpiredMemoryStates();

    // Redis handles its own expiration via TTL
    // No need to scan and delete

    return memoryCleanedCount;
  }

  /**
   * Get statistics about the state store
   */
  async getStats(): Promise<{
    redisAvailable: boolean;
    memoryStoreSize: number;
    usingFallback: boolean;
  }> {
    const redisAvailable = this.isRedisAvailable();

    return {
      redisAvailable,
      memoryStoreSize: this.memoryStore.size,
      usingFallback: !redisAvailable && this.enableMemoryFallback,
    };
  }

  /**
   * Clear all states (mainly for testing)
   */
  async clear(): Promise<void> {
    // Clear memory store
    this.memoryStore.clear();

    // Clear Redis keys matching our prefix
    if (this.isRedisAvailable()) {
      try {
        // Use SCAN to find and delete keys
        let cursor = '0';
        do {
          const [newCursor, keys] = await this.redis!.scan(
            cursor,
            'MATCH',
            `${this.keyPrefix}*`,
            'COUNT',
            100
          );
          cursor = newCursor;

          if (keys.length > 0) {
            await this.redis!.del(...keys);
          }
        } while (cursor !== '0');

        logger.info('Cleared all states from Redis');
      } catch (error) {
        logger.error({ error }, 'Failed to clear states from Redis');
      }
    }
  }

  /**
   * Shutdown the state store
   */
  shutdown(): void {
    if (this.memoryCleanupInterval) {
      clearInterval(this.memoryCleanupInterval);
      this.memoryCleanupInterval = null;
    }

    this.memoryStore.clear();
    logger.info('RedisStateStore shutdown');
  }
}

/**
 * Create a new RedisStateStore instance
 */
export function createRedisStateStore(config: RedisStateStoreConfig): RedisStateStore {
  return new RedisStateStore(config);
}
