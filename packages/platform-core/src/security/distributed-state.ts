/**
 * Distributed State Provider for Redis-Backed Security Features
 *
 * Provides a unified interface for distributed state management across
 * multi-instance deployments. Features include:
 * - Generic key-value operations with TTL
 * - Atomic increment for rate limiting
 * - Pub/sub for cache invalidation
 * - Connection health checking
 * - Graceful fallback behavior when Redis unavailable
 *
 * @packageDocumentation
 * @module security/distributed-state
 */

import type { Redis, RedisOptions } from 'ioredis';
import IORedis from 'ioredis';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'distributed-state' });

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the Redis state provider
 */
export interface RedisStateConfig {
  /** Redis URL (overrides host/port if provided) */
  url?: string;
  /** Redis host */
  host: string;
  /** Redis port */
  port: number;
  /** Redis password */
  password?: string;
  /** Redis database number */
  db: number;
  /** Key prefix for all operations */
  keyPrefix: string;
  /** Connection pool size (max connections) */
  maxConnections: number;
  /** Connection timeout in ms */
  connectTimeoutMs: number;
  /** Command timeout in ms */
  commandTimeoutMs: number;
  /** Retry strategy - max retries */
  maxRetries: number;
  /** Retry delay base in ms (exponential backoff applied) */
  retryDelayMs: number;
  /** Max retry delay in ms */
  maxRetryDelayMs: number;
  /** Enable keep-alive for connections */
  keepAlive: boolean;
  /** Keep-alive interval in ms */
  keepAliveIntervalMs: number;
  /** Enable lazy connect (don't connect until first command) */
  lazyConnect: boolean;
  /** Enable fallback to in-memory when Redis unavailable */
  enableFallback: boolean;
  /** Fallback cache max size */
  fallbackMaxSize: number;
  /** Health check interval in ms */
  healthCheckIntervalMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_REDIS_STATE_CONFIG: RedisStateConfig = {
  host: 'localhost',
  port: 6379,
  db: 0,
  keyPrefix: 'vorion:security:',
  maxConnections: 10,
  connectTimeoutMs: 5000,
  commandTimeoutMs: 3000,
  maxRetries: 3,
  retryDelayMs: 100,
  maxRetryDelayMs: 3000,
  keepAlive: true,
  keepAliveIntervalMs: 30000,
  lazyConnect: false,
  enableFallback: true,
  fallbackMaxSize: 10000,
  healthCheckIntervalMs: 30000,
};

/**
 * Health status of the Redis connection
 */
export interface RedisHealthStatus {
  /** Whether Redis is healthy */
  healthy: boolean;
  /** Response latency in ms */
  latencyMs?: number;
  /** Last successful ping timestamp */
  lastPingAt?: Date;
  /** Error message if unhealthy */
  error?: string;
  /** Whether currently using fallback mode */
  usingFallback: boolean;
  /** Number of operations in fallback cache */
  fallbackCacheSize: number;
}

/**
 * Result of an atomic increment operation
 */
export interface IncrementResult {
  /** New value after increment */
  value: number;
  /** TTL remaining in seconds */
  ttlSeconds: number;
  /** Whether this was the first increment (key created) */
  isNew: boolean;
}

/**
 * Cache invalidation event
 */
export interface InvalidationEvent {
  /** Type of invalidation */
  type: 'key' | 'pattern' | 'all';
  /** Key or pattern to invalidate */
  key?: string;
  /** Timestamp of the event */
  timestamp: Date;
  /** Source instance identifier */
  sourceInstance?: string;
}

/**
 * Subscriber callback for invalidation events
 */
export type InvalidationCallback = (event: InvalidationEvent) => void | Promise<void>;

// =============================================================================
// In-Memory Fallback Cache
// =============================================================================

/**
 * Simple LRU-like in-memory cache for fallback mode
 */
class FallbackCache {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
    this.cache.set(key, { value, expiresAt });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  incr(key: string, ttlSeconds?: number): number {
    const existing = this.get(key);
    const newValue = existing ? parseInt(existing, 10) + 1 : 1;

    if (Number.isNaN(newValue)) {
      throw new Error('Value is not an integer');
    }

    this.set(key, newValue.toString(), ttlSeconds);
    return newValue;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// =============================================================================
// RedisStateProvider Class
// =============================================================================

/**
 * Redis-backed distributed state provider for security features
 *
 * @example
 * ```typescript
 * const provider = new RedisStateProvider({
 *   url: process.env.REDIS_URL,
 *   keyPrefix: 'vorion:security:',
 * });
 *
 * // Store a value with TTL
 * await provider.set('session:abc123', JSON.stringify(sessionData), 3600);
 *
 * // Atomic increment for rate limiting
 * const result = await provider.increment('ratelimit:user:123', 60);
 * if (result.value > 100) {
 *   throw new Error('Rate limit exceeded');
 * }
 * ```
 */
export class RedisStateProvider {
  private readonly config: RedisStateConfig;
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly fallbackCache: FallbackCache;
  private readonly invalidationCallbacks: InvalidationCallback[] = [];
  private isHealthy: boolean = false;
  private lastPingAt: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly instanceId: string;

  /**
   * Create a new RedisStateProvider
   *
   * @param config - Configuration options
   */
  constructor(config: Partial<RedisStateConfig> = {}) {
    this.config = { ...DEFAULT_REDIS_STATE_CONFIG, ...config };
    this.fallbackCache = new FallbackCache(this.config.fallbackMaxSize);
    this.instanceId = crypto.randomUUID();

    logger.info(
      {
        host: this.config.host,
        port: this.config.port,
        keyPrefix: this.config.keyPrefix,
        enableFallback: this.config.enableFallback,
      },
      'RedisStateProvider initialized'
    );
  }

  /**
   * Get or create the Redis client
   */
  private async getClient(): Promise<Redis> {
    if (this.client) {
      return this.client;
    }

    const options = this.buildRedisOptions();

    try {
      if (this.config.url) {
        this.client = new IORedis(this.config.url, options);
      } else {
        this.client = new IORedis(options);
      }

      this.setupEventHandlers(this.client);

      // Wait for connection if not lazy
      if (!this.config.lazyConnect) {
        await this.waitForConnection(this.client);
      }

      // Start health check
      this.startHealthCheck();

      return this.client;
    } catch (error) {
      logger.error({ error }, 'Failed to create Redis client');
      throw error;
    }
  }

  /**
   * Build Redis connection options
   */
  private buildRedisOptions(): RedisOptions {
    const options: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      lazyConnect: this.config.lazyConnect,
      connectTimeout: this.config.connectTimeoutMs,
      commandTimeout: this.config.commandTimeoutMs,
      maxRetriesPerRequest: this.config.maxRetries,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > this.config.maxRetries) {
          logger.error({ retries: times }, 'Redis max retries exceeded');
          return null; // Stop retrying
        }
        const delay = Math.min(
          this.config.retryDelayMs * Math.pow(2, times - 1),
          this.config.maxRetryDelayMs
        );
        logger.warn({ retryCount: times, delayMs: delay }, 'Redis connection retry');
        return delay;
      },
    };

    if (this.config.password) {
      options.password = this.config.password;
    }

    if (this.config.keepAlive) {
      options.keepAlive = this.config.keepAliveIntervalMs;
    }

    return options;
  }

  /**
   * Wait for Redis connection to be ready
   */
  private async waitForConnection(client: Redis): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, this.config.connectTimeoutMs);

      client.once('ready', () => {
        clearTimeout(timeout);
        this.isHealthy = true;
        this.lastPingAt = new Date();
        resolve();
      });

      client.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Setup event handlers for the Redis client
   */
  private setupEventHandlers(client: Redis): void {
    client.on('connect', () => {
      logger.info('Redis connected');
    });

    client.on('ready', () => {
      logger.info('Redis ready');
      this.isHealthy = true;
      this.lastPingAt = new Date();
    });

    client.on('error', (error) => {
      logger.error({ error }, 'Redis error');
      this.isHealthy = false;
    });

    client.on('close', () => {
      logger.warn('Redis connection closed');
      this.isHealthy = false;
    });

    client.on('reconnecting', () => {
      logger.info('Redis reconnecting');
    });

    client.on('end', () => {
      logger.info('Redis connection ended');
      this.isHealthy = false;
    });
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.ping();
      } catch (error) {
        logger.warn({ error }, 'Redis health check failed');
      }
    }, this.config.healthCheckIntervalMs);

    this.healthCheckInterval.unref();
  }

  /**
   * Execute a Redis command with fallback handling
   */
  private async executeWithFallback<T>(
    operation: (client: Redis) => Promise<T>,
    fallbackFn?: () => T
  ): Promise<T> {
    try {
      const client = await this.getClient();
      return await operation(client);
    } catch (error) {
      logger.warn({ error }, 'Redis operation failed');

      if (this.config.enableFallback && fallbackFn) {
        logger.info('Using fallback cache');
        return fallbackFn();
      }

      throw error;
    }
  }

  /**
   * Get the full key with prefix
   */
  private prefixKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  // ===========================================================================
  // Public API - Key-Value Operations
  // ===========================================================================

  /**
   * Get a value by key
   *
   * @param key - The key to get
   * @returns The value or null if not found
   */
  async get(key: string): Promise<string | null> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => client.get(prefixedKey),
      () => this.fallbackCache.get(prefixedKey)
    );
  }

  /**
   * Set a value with optional TTL
   *
   * @param key - The key to set
   * @param value - The value to store
   * @param ttlSeconds - Optional TTL in seconds
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);

    await this.executeWithFallback(
      async (client) => {
        if (ttlSeconds) {
          await client.setex(prefixedKey, ttlSeconds, value);
        } else {
          await client.set(prefixedKey, value);
        }
      },
      () => {
        this.fallbackCache.set(prefixedKey, value, ttlSeconds);
      }
    );
  }

  /**
   * Set a value only if it doesn't exist
   *
   * @param key - The key to set
   * @param value - The value to store
   * @param ttlSeconds - Optional TTL in seconds
   * @returns true if the key was set, false if it already existed
   */
  async setNX(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        if (ttlSeconds) {
          const result = await client.set(prefixedKey, value, 'EX', ttlSeconds, 'NX');
          return result === 'OK';
        } else {
          const result = await client.setnx(prefixedKey, value);
          return result === 1;
        }
      },
      () => {
        const existing = this.fallbackCache.get(prefixedKey);
        if (existing !== null) {
          return false;
        }
        this.fallbackCache.set(prefixedKey, value, ttlSeconds);
        return true;
      }
    );
  }

  /**
   * Delete a key
   *
   * @param key - The key to delete
   * @returns true if the key was deleted
   */
  async delete(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        const result = await client.del(prefixedKey);
        return result > 0;
      },
      () => this.fallbackCache.delete(prefixedKey)
    );
  }

  /**
   * Check if a key exists
   *
   * @param key - The key to check
   * @returns true if the key exists
   */
  async exists(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        const result = await client.exists(prefixedKey);
        return result > 0;
      },
      () => this.fallbackCache.get(prefixedKey) !== null
    );
  }

  /**
   * Set the TTL on an existing key
   *
   * @param key - The key to update
   * @param ttlSeconds - TTL in seconds
   * @returns true if the TTL was set
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        const result = await client.expire(prefixedKey, ttlSeconds);
        return result === 1;
      },
      () => {
        // Fallback doesn't support updating TTL on existing keys
        return false;
      }
    );
  }

  /**
   * Get the TTL of a key
   *
   * @param key - The key to check
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => client.ttl(prefixedKey),
      () => -1 // Fallback doesn't track TTL
    );
  }

  // ===========================================================================
  // Public API - Atomic Increment (Rate Limiting)
  // ===========================================================================

  /**
   * Atomically increment a counter with optional TTL
   *
   * This is the core operation for rate limiting. Uses MULTI/EXEC for atomicity.
   *
   * @param key - The key to increment
   * @param ttlSeconds - TTL in seconds (applied only on first increment)
   * @returns The new value and TTL info
   *
   * @example
   * ```typescript
   * const result = await provider.increment('ratelimit:api:user123', 60);
   * if (result.value > 100) {
   *   throw new RateLimitError('Too many requests');
   * }
   * ```
   */
  async increment(key: string, ttlSeconds?: number): Promise<IncrementResult> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        // Use INCR + EXPIRE in a pipeline for atomicity
        const pipeline = client.pipeline();
        pipeline.incr(prefixedKey);
        pipeline.ttl(prefixedKey);

        const results = await pipeline.exec();

        if (!results) {
          throw new Error('Pipeline execution failed');
        }

        const [incrResult, ttlResult] = results;
        const newValue = incrResult?.[1] as number;
        const currentTtl = ttlResult?.[1] as number;

        // If this is a new key (TTL is -1 or value is 1) and TTL is specified, set it
        const isNew = newValue === 1 || currentTtl === -1;
        if (isNew && ttlSeconds) {
          await client.expire(prefixedKey, ttlSeconds);
        }

        return {
          value: newValue,
          ttlSeconds: isNew && ttlSeconds ? ttlSeconds : Math.max(0, currentTtl),
          isNew,
        };
      },
      () => ({
        value: this.fallbackCache.incr(prefixedKey, ttlSeconds),
        ttlSeconds: ttlSeconds ?? -1,
        isNew: true,
      })
    );
  }

  /**
   * Atomically increment by a specific amount
   *
   * @param key - The key to increment
   * @param amount - Amount to increment by
   * @param ttlSeconds - TTL in seconds (applied only on first increment)
   * @returns The new value
   */
  async incrementBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const prefixedKey = this.prefixKey(key);

    return this.executeWithFallback(
      async (client) => {
        const pipeline = client.pipeline();
        pipeline.incrby(prefixedKey, amount);
        pipeline.ttl(prefixedKey);

        const results = await pipeline.exec();

        if (!results) {
          throw new Error('Pipeline execution failed');
        }

        const [incrResult, ttlResult] = results;
        const newValue = incrResult?.[1] as number;
        const currentTtl = ttlResult?.[1] as number;

        // Set TTL if new key
        if ((currentTtl === -1 || newValue === amount) && ttlSeconds) {
          await client.expire(prefixedKey, ttlSeconds);
        }

        return newValue;
      },
      () => {
        let value = this.fallbackCache.incr(prefixedKey, ttlSeconds);
        // Increment by additional amount (we already added 1)
        for (let i = 1; i < amount; i++) {
          value = this.fallbackCache.incr(prefixedKey, ttlSeconds);
        }
        return value;
      }
    );
  }

  /**
   * Get multiple counters at once
   *
   * @param keys - Keys to get
   * @returns Map of key to value (0 if not exists)
   */
  async getCounters(keys: string[]): Promise<Map<string, number>> {
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const result = new Map<string, number>();

    await this.executeWithFallback(
      async (client) => {
        const values = await client.mget(...prefixedKeys);
        keys.forEach((key, index) => {
          const val = values[index];
          result.set(key, val ? parseInt(val, 10) : 0);
        });
      },
      () => {
        keys.forEach((key) => {
          const val = this.fallbackCache.get(this.prefixKey(key));
          result.set(key, val ? parseInt(val, 10) : 0);
        });
      }
    );

    return result;
  }

  // ===========================================================================
  // Public API - Pub/Sub for Cache Invalidation
  // ===========================================================================

  /**
   * Subscribe to cache invalidation events
   *
   * @param callback - Function to call when invalidation event received
   */
  async subscribeToInvalidations(callback: InvalidationCallback): Promise<void> {
    this.invalidationCallbacks.push(callback);

    // Create subscriber client if not exists
    if (!this.subscriber) {
      const options = this.buildRedisOptions();

      if (this.config.url) {
        this.subscriber = new IORedis(this.config.url, options);
      } else {
        this.subscriber = new IORedis(options);
      }

      const channel = `${this.config.keyPrefix}invalidation`;

      await this.subscriber.subscribe(channel);

      this.subscriber.on('message', async (ch, message) => {
        if (ch === channel) {
          try {
            const event = JSON.parse(message) as InvalidationEvent;

            // Don't process our own events
            if (event.sourceInstance === this.instanceId) {
              return;
            }

            for (const cb of this.invalidationCallbacks) {
              try {
                await cb(event);
              } catch (error) {
                logger.error({ error }, 'Error in invalidation callback');
              }
            }
          } catch (error) {
            logger.error({ error, message }, 'Failed to parse invalidation message');
          }
        }
      });

      logger.info({ channel }, 'Subscribed to invalidation events');
    }
  }

  /**
   * Publish a cache invalidation event
   *
   * @param event - The invalidation event to publish
   */
  async publishInvalidation(event: Omit<InvalidationEvent, 'timestamp' | 'sourceInstance'>): Promise<void> {
    const fullEvent: InvalidationEvent = {
      ...event,
      timestamp: new Date(),
      sourceInstance: this.instanceId,
    };

    const channel = `${this.config.keyPrefix}invalidation`;

    await this.executeWithFallback(
      async (client) => {
        await client.publish(channel, JSON.stringify(fullEvent));
      },
      () => {
        // In fallback mode, just call local callbacks
        for (const cb of this.invalidationCallbacks) {
          try {
            cb(fullEvent);
          } catch (error) {
            logger.error({ error }, 'Error in local invalidation callback');
          }
        }
      }
    );

    logger.debug({ event: fullEvent }, 'Published invalidation event');
  }

  /**
   * Invalidate a specific key and notify other instances
   *
   * @param key - Key to invalidate
   */
  async invalidateKey(key: string): Promise<void> {
    await this.delete(key);
    await this.publishInvalidation({ type: 'key', key });
  }

  /**
   * Invalidate all keys matching a pattern
   *
   * @param pattern - Pattern to match (e.g., 'session:*')
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const prefixedPattern = this.prefixKey(pattern);

    await this.executeWithFallback(
      async (client) => {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await client.scan(
            cursor,
            'MATCH',
            prefixedPattern,
            'COUNT',
            100
          );
          cursor = nextCursor;

          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== '0');
      },
      () => {
        // Fallback: clear entire cache (no pattern matching)
        this.fallbackCache.clear();
      }
    );

    await this.publishInvalidation({ type: 'pattern', key: pattern });
  }

  // ===========================================================================
  // Public API - Health Checking
  // ===========================================================================

  /**
   * Ping Redis to check connectivity
   *
   * @returns Latency in milliseconds
   */
  async ping(): Promise<number> {
    const start = performance.now();

    const client = await this.getClient();
    const result = await client.ping();

    if (result !== 'PONG') {
      throw new Error(`Unexpected ping response: ${result}`);
    }

    const latency = Math.round(performance.now() - start);
    this.isHealthy = true;
    this.lastPingAt = new Date();

    return latency;
  }

  /**
   * Get the current health status
   *
   * @returns Health status object
   */
  async getHealthStatus(): Promise<RedisHealthStatus> {
    try {
      const latencyMs = await this.ping();

      return {
        healthy: true,
        latencyMs,
        lastPingAt: this.lastPingAt ?? undefined,
        usingFallback: false,
        fallbackCacheSize: this.fallbackCache.size,
      };
    } catch (error) {
      return {
        healthy: false,
        lastPingAt: this.lastPingAt ?? undefined,
        error: error instanceof Error ? error.message : 'Unknown error',
        usingFallback: this.config.enableFallback,
        fallbackCacheSize: this.fallbackCache.size,
      };
    }
  }

  /**
   * Check if Redis is currently healthy
   */
  get healthy(): boolean {
    return this.isHealthy;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }

    if (this.client) {
      await this.client.quit();
      this.client = null;
    }

    this.isHealthy = false;
    logger.info('RedisStateProvider closed');
  }

  /**
   * Get the raw Redis client (for advanced operations)
   * Use with caution - prefer the high-level API
   */
  async getRawClient(): Promise<Redis> {
    return this.getClient();
  }

  /**
   * Clear the fallback cache
   */
  clearFallbackCache(): void {
    this.fallbackCache.clear();
  }

  /**
   * Cleanup expired entries in fallback cache
   */
  cleanupFallbackCache(): void {
    this.fallbackCache.cleanup();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: RedisStateProvider | null = null;

/**
 * Get or create the singleton RedisStateProvider
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton RedisStateProvider instance
 */
export function getRedisStateProvider(config?: Partial<RedisStateConfig>): RedisStateProvider {
  if (!instance) {
    // Check for REDIS_URL environment variable
    const envConfig: Partial<RedisStateConfig> = {};

    if (process.env['REDIS_URL']) {
      envConfig.url = process.env['REDIS_URL'];
    }

    if (process.env['VORION_REDIS_HOST']) {
      envConfig.host = process.env['VORION_REDIS_HOST'];
    }

    if (process.env['VORION_REDIS_PORT']) {
      envConfig.port = parseInt(process.env['VORION_REDIS_PORT'], 10);
    }

    if (process.env['VORION_REDIS_PASSWORD']) {
      envConfig.password = process.env['VORION_REDIS_PASSWORD'];
    }

    if (process.env['VORION_REDIS_DB']) {
      envConfig.db = parseInt(process.env['VORION_REDIS_DB'], 10);
    }

    instance = new RedisStateProvider({ ...envConfig, ...config });
  }

  return instance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export async function resetRedisStateProvider(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

/**
 * Create a new RedisStateProvider instance (for testing or isolated use)
 */
export function createRedisStateProvider(config?: Partial<RedisStateConfig>): RedisStateProvider {
  return new RedisStateProvider(config);
}

export default RedisStateProvider;
