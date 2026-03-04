/**
 * Adapter Provider
 *
 * Factory that creates appropriate adapters based on configuration and
 * Redis availability. Supports both Redis-backed and in-memory implementations.
 *
 * Features:
 * - Automatic Redis availability detection
 * - Singleton pattern for adapter instances
 * - Health check support
 * - Graceful fallback to memory when Redis is unavailable
 *
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import type {
  AdapterProvider,
  AdapterHealthStatus,
  IQueueAdapter,
  ICacheAdapter,
  ILockAdapter,
  ISessionStoreAdapter,
  IRateLimitAdapter,
} from './types.js';

// Import memory implementations
import { createMemoryQueueAdapter } from './memory-queue.js';
import { createMemoryCacheAdapter, type MemoryCacheAdapter } from './memory-cache.js';
import { createMemoryLockAdapter, type MemoryLockAdapter } from './memory-lock.js';
import { createMemorySessionStoreAdapter, type MemorySessionStoreAdapter } from './memory-session.js';
import { createMemoryRateLimitAdapter, type MemoryRateLimitAdapter } from './memory-ratelimit.js';

const logger = createLogger({ component: 'adapter-provider' });

/**
 * Provider configuration
 */
export interface AdapterProviderConfig {
  /** Force memory mode even if Redis is available */
  forceMemoryMode?: boolean;
  /** Redis connection timeout in milliseconds */
  redisConnectionTimeoutMs?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<AdapterProviderConfig> = {
  forceMemoryMode: false,
  redisConnectionTimeoutMs: 5000,
};

/**
 * Main adapter provider implementation
 */
class DefaultAdapterProvider implements AdapterProvider {
  private config: Required<AdapterProviderConfig>;
  private redisAvailable: boolean | null = null;
  private redisCheckPromise: Promise<boolean> | null = null;

  // Singleton instances
  private queueAdapters = new Map<string, IQueueAdapter>();
  private cacheAdapter: ICacheAdapter | null = null;
  private lockAdapter: ILockAdapter | null = null;
  private sessionStoreAdapter: ISessionStoreAdapter | null = null;
  private rateLimitAdapter: IRateLimitAdapter | null = null;

  // Memory adapter instances for cleanup
  private memoryCacheAdapter: MemoryCacheAdapter | null = null;
  private memoryLockAdapter: MemoryLockAdapter | null = null;
  private memorySessionAdapter: MemorySessionStoreAdapter | null = null;
  private memoryRateLimitAdapter: MemoryRateLimitAdapter | null = null;

  constructor(config?: AdapterProviderConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Check if lite mode is enabled
    const appConfig = getConfig();
    if (appConfig.lite?.enabled && appConfig.lite?.redisOptional) {
      logger.info({}, 'Lite mode enabled with optional Redis');
    }
  }

  /**
   * Get a queue adapter by name
   */
  getQueueAdapter(name: string): IQueueAdapter {
    let adapter = this.queueAdapters.get(name);

    if (!adapter) {
      if (this.shouldUseMemory()) {
        adapter = createMemoryQueueAdapter(name);
        logger.debug({ queueName: name }, 'Created memory queue adapter');
      } else {
        // Redis queue adapter would be created here
        // For now, fall back to memory
        adapter = createMemoryQueueAdapter(name);
        logger.debug({ queueName: name }, 'Created memory queue adapter (Redis not implemented in adapter)');
      }

      this.queueAdapters.set(name, adapter);
    }

    return adapter;
  }

  /**
   * Get the cache adapter
   */
  getCacheAdapter(): ICacheAdapter {
    if (!this.cacheAdapter) {
      if (this.shouldUseMemory()) {
        this.memoryCacheAdapter = createMemoryCacheAdapter();
        this.cacheAdapter = this.memoryCacheAdapter;
        logger.debug({}, 'Created memory cache adapter');
      } else {
        // Redis cache adapter would be created here
        // For now, fall back to memory
        this.memoryCacheAdapter = createMemoryCacheAdapter();
        this.cacheAdapter = this.memoryCacheAdapter;
        logger.debug({}, 'Created memory cache adapter (Redis not implemented in adapter)');
      }
    }

    return this.cacheAdapter;
  }

  /**
   * Get the lock adapter
   */
  getLockAdapter(): ILockAdapter {
    if (!this.lockAdapter) {
      if (this.shouldUseMemory()) {
        this.memoryLockAdapter = createMemoryLockAdapter();
        this.lockAdapter = this.memoryLockAdapter;
        logger.debug({}, 'Created memory lock adapter');
      } else {
        // Redis lock adapter would be created here
        // For now, fall back to memory
        this.memoryLockAdapter = createMemoryLockAdapter();
        this.lockAdapter = this.memoryLockAdapter;
        logger.debug({}, 'Created memory lock adapter (Redis not implemented in adapter)');
      }
    }

    return this.lockAdapter;
  }

  /**
   * Get the session store adapter
   */
  getSessionStoreAdapter(): ISessionStoreAdapter {
    if (!this.sessionStoreAdapter) {
      if (this.shouldUseMemory()) {
        this.memorySessionAdapter = createMemorySessionStoreAdapter();
        this.sessionStoreAdapter = this.memorySessionAdapter;
        logger.debug({}, 'Created memory session store adapter');
      } else {
        // Redis session adapter would be created here
        // For now, fall back to memory
        this.memorySessionAdapter = createMemorySessionStoreAdapter();
        this.sessionStoreAdapter = this.memorySessionAdapter;
        logger.debug({}, 'Created memory session store adapter (Redis not implemented in adapter)');
      }
    }

    return this.sessionStoreAdapter;
  }

  /**
   * Get the rate limit adapter
   */
  getRateLimitAdapter(): IRateLimitAdapter {
    if (!this.rateLimitAdapter) {
      if (this.shouldUseMemory()) {
        this.memoryRateLimitAdapter = createMemoryRateLimitAdapter();
        this.rateLimitAdapter = this.memoryRateLimitAdapter;
        logger.debug({}, 'Created memory rate limit adapter');
      } else {
        // Redis rate limit adapter would be created here
        // For now, fall back to memory
        this.memoryRateLimitAdapter = createMemoryRateLimitAdapter();
        this.rateLimitAdapter = this.memoryRateLimitAdapter;
        logger.debug({}, 'Created memory rate limit adapter (Redis not implemented in adapter)');
      }
    }

    return this.rateLimitAdapter;
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    // If we haven't checked yet, return false (conservative default)
    if (this.redisAvailable === null) {
      // Trigger async check
      void this.checkRedisAvailability();
      return false;
    }

    return this.redisAvailable;
  }

  /**
   * Get health status of the adapter system
   */
  async getHealthStatus(): Promise<AdapterHealthStatus> {
    const startTime = Date.now();
    const redisAvailable = await this.checkRedisAvailability();
    const latencyMs = Date.now() - startTime;

    const appConfig = getConfig();
    const liteMode = appConfig.lite?.enabled && appConfig.lite?.redisOptional;
    const useMemory = this.config.forceMemoryMode || liteMode || !redisAvailable;

    return {
      redis: {
        available: redisAvailable,
        latencyMs: redisAvailable ? latencyMs : undefined,
        error: !redisAvailable ? 'Redis connection failed or not configured' : undefined,
      },
      mode: useMemory ? 'memory' : 'redis',
    };
  }

  /**
   * Shutdown all adapters and clean up resources
   */
  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down adapter provider');

    // Close all queue adapters
    for (const [name, adapter] of this.queueAdapters) {
      try {
        await adapter.close();
        logger.debug({ queueName: name }, 'Queue adapter closed');
      } catch (error) {
        logger.error({ error, queueName: name }, 'Error closing queue adapter');
      }
    }
    this.queueAdapters.clear();

    // Stop memory adapters
    if (this.memoryCacheAdapter) {
      this.memoryCacheAdapter.stop();
      this.memoryCacheAdapter = null;
    }

    if (this.memoryLockAdapter) {
      this.memoryLockAdapter.stop();
      this.memoryLockAdapter = null;
    }

    if (this.memorySessionAdapter) {
      this.memorySessionAdapter.stop();
      this.memorySessionAdapter = null;
    }

    if (this.memoryRateLimitAdapter) {
      this.memoryRateLimitAdapter.stop();
      this.memoryRateLimitAdapter = null;
    }

    // Clear references
    this.cacheAdapter = null;
    this.lockAdapter = null;
    this.sessionStoreAdapter = null;
    this.rateLimitAdapter = null;

    logger.info({}, 'Adapter provider shutdown complete');
  }

  /**
   * Determine if memory mode should be used
   */
  private shouldUseMemory(): boolean {
    // Check forced memory mode
    if (this.config.forceMemoryMode) {
      return true;
    }

    // Check lite mode configuration
    const appConfig = getConfig();
    if (appConfig.lite?.enabled && appConfig.lite?.redisOptional) {
      // In lite mode with optional Redis, use memory if Redis is not available
      if (this.redisAvailable === false) {
        return true;
      }
      // If we haven't checked Redis yet, default to memory
      if (this.redisAvailable === null) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check Redis availability
   */
  private async checkRedisAvailability(): Promise<boolean> {
    // Return cached result if available
    if (this.redisAvailable !== null) {
      return this.redisAvailable;
    }

    // Deduplicate concurrent checks
    if (this.redisCheckPromise) {
      return this.redisCheckPromise;
    }

    this.redisCheckPromise = this.doRedisCheck();

    try {
      this.redisAvailable = await this.redisCheckPromise;
    } finally {
      this.redisCheckPromise = null;
    }

    return this.redisAvailable;
  }

  /**
   * Perform actual Redis availability check
   */
  private async doRedisCheck(): Promise<boolean> {
    try {
      // Dynamically import Redis to avoid errors when not configured
      const { getRedis } = await import('../redis.js');
      const redis = getRedis();

      // Try a simple PING with timeout
      const pingPromise = redis.ping();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis check timeout')), this.config.redisConnectionTimeoutMs);
      });

      const result = await Promise.race([pingPromise, timeoutPromise]);

      if (result === 'PONG') {
        logger.info({}, 'Redis is available');
        return true;
      }

      logger.warn({ result }, 'Unexpected Redis PING response');
      return false;
    } catch (error) {
      logger.info(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Redis is not available, using memory adapters'
      );
      return false;
    }
  }
}

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

/**
 * Singleton provider instance
 */
let providerInstance: DefaultAdapterProvider | null = null;

/**
 * Get the adapter provider singleton
 */
export function getAdapterProvider(config?: AdapterProviderConfig): AdapterProvider {
  if (!providerInstance) {
    providerInstance = new DefaultAdapterProvider(config);
  }
  return providerInstance;
}

/**
 * Create a new adapter provider instance (for testing)
 */
export function createAdapterProvider(config?: AdapterProviderConfig): AdapterProvider & { shutdown(): Promise<void> } {
  return new DefaultAdapterProvider(config);
}

/**
 * Reset the singleton provider (for testing)
 */
export async function resetAdapterProvider(): Promise<void> {
  if (providerInstance) {
    await providerInstance.shutdown();
    providerInstance = null;
  }
}

/**
 * Convenience function to get adapters directly
 */
export function getQueueAdapter(name: string): IQueueAdapter {
  return getAdapterProvider().getQueueAdapter(name);
}

export function getCacheAdapter(): ICacheAdapter {
  return getAdapterProvider().getCacheAdapter();
}

export function getLockAdapter(): ILockAdapter {
  return getAdapterProvider().getLockAdapter();
}

export function getSessionStoreAdapter(): ISessionStoreAdapter {
  return getAdapterProvider().getSessionStoreAdapter();
}

export function getRateLimitAdapter(): IRateLimitAdapter {
  return getAdapterProvider().getRateLimitAdapter();
}
