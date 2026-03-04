/**
 * API Key Metadata Cache
 *
 * High-performance caching layer for API key validation to eliminate
 * database lookups on every request. Provides:
 * - In-memory LRU cache (max 10,000 entries)
 * - Redis backing for distributed deployments
 * - Short TTL (30 seconds) to catch revocations quickly
 * - Redis pub/sub for cross-instance cache invalidation
 *
 * Expected performance improvement: 10-30ms -> 1-2ms for cached lookups.
 *
 * @packageDocumentation
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import { getRedis, checkRedisHealth } from '../../common/redis.js';
import type {
  ApiKey,
  ApiKeyScope,
  ApiKeyStatus,
  ApiKeyRateLimit,
} from './types.js';

const logger = createLogger({ component: 'api-key-cache' });

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maximum number of entries in the LRU cache */
const MAX_CACHE_ENTRIES = 10_000;

/** TTL for cached entries in milliseconds (30 seconds - short to catch revocations) */
const CACHE_TTL_MS = 30_000;

/** Redis key prefix for cached API key metadata */
const REDIS_KEY_PREFIX = 'vorion:apikey:cache';

/** Redis pub/sub channel for cache invalidation events */
const INVALIDATION_CHANNEL = 'vorion:apikey:invalidation';

/** Redis TTL for cached entries in seconds */
const REDIS_CACHE_TTL_SECONDS = 30;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Cached API key metadata structure
 *
 * Contains only the fields needed for validation, reducing memory footprint.
 */
export interface CachedApiKeyMetadata {
  /** Key ID */
  id: string;
  /** Key hash (for validation) */
  keyHash: string;
  /** API key prefix (first 8 chars) - used as cache key */
  prefix: string;
  /** Tenant ID */
  tenantId: string;
  /** Granted scopes */
  scopes: ApiKeyScope[];
  /** Expiration timestamp (null = never expires) */
  expiresAt: number | null;
  /** Rate limit configuration */
  rateLimit: ApiKeyRateLimit;
  /** Key status (active/revoked/expired) */
  status: ApiKeyStatus;
  /** IP whitelist (if set) */
  allowedIps?: string[];
  /** When this cache entry was created */
  cachedAt: number;
  /** When this cache entry expires */
  expiresAtCache: number;
}

/**
 * Cache invalidation event published via Redis pub/sub
 */
export interface CacheInvalidationEvent {
  /** Type of invalidation */
  type: 'revoke' | 'update' | 'expire' | 'delete';
  /** API key prefix to invalidate */
  prefix: string;
  /** API key ID */
  keyId: string;
  /** Tenant ID */
  tenantId: string;
  /** Timestamp of the event */
  timestamp: number;
  /** Source instance ID */
  sourceInstance: string;
  /** Optional reason for invalidation */
  reason?: string;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Number of entries in local cache */
  localCacheSize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate percentage */
  hitRate: number;
  /** Number of invalidations received */
  invalidationsReceived: number;
  /** Number of invalidations published */
  invalidationsPublished: number;
  /** Whether Redis subscriber is connected */
  redisSubscribed: boolean;
  /** Instance ID */
  instanceId: string;
}

// =============================================================================
// LRU CACHE NODE
// =============================================================================

/**
 * Doubly linked list node for LRU cache
 */
interface LRUNode {
  key: string;
  value: CachedApiKeyMetadata;
  prev: LRUNode | null;
  next: LRUNode | null;
  expiresAt: number;
}

// =============================================================================
// API KEY METADATA CACHE
// =============================================================================

/**
 * API Key Metadata Cache
 *
 * Implements a two-tier caching strategy:
 * 1. Local LRU cache for fastest access (< 0.1ms)
 * 2. Redis cache for distributed deployments (< 1-2ms)
 *
 * Cache invalidation is propagated across instances via Redis pub/sub.
 */
export class ApiKeyMetadataCache {
  /** Local LRU cache map */
  private cache: Map<string, LRUNode> = new Map();

  /** Head of LRU list (most recently used) */
  private head: LRUNode | null = null;

  /** Tail of LRU list (least recently used) */
  private tail: LRUNode | null = null;

  /** Redis client for distributed caching */
  private redis: Redis | null = null;

  /** Redis subscriber for invalidation events */
  private subscriber: Redis | null = null;

  /** Whether Redis subscriber is connected */
  private isSubscribed: boolean = false;

  /** Unique instance ID for pub/sub filtering */
  private readonly instanceId: string;

  /** Cleanup interval handle */
  private cleanupInterval: NodeJS.Timeout | null = null;

  /** Cache statistics */
  private stats = {
    hits: 0,
    misses: 0,
    invalidationsReceived: 0,
    invalidationsPublished: 0,
  };

  constructor() {
    this.instanceId = crypto.randomUUID();
    this.startCleanupInterval();
    logger.info({ instanceId: this.instanceId }, 'API key metadata cache initialized');
  }

  // ===========================================================================
  // CACHE OPERATIONS
  // ===========================================================================

  /**
   * Get cached API key metadata by prefix
   *
   * Checks local cache first, then Redis if not found locally.
   * This is the primary lookup path for API key validation.
   *
   * @param prefix - API key prefix (first 8 characters)
   * @returns Cached metadata or null if not found/expired
   */
  async get(prefix: string): Promise<CachedApiKeyMetadata | null> {
    // Try local cache first (fastest path)
    const localResult = this.getFromLocal(prefix);
    if (localResult) {
      this.stats.hits++;
      return localResult;
    }

    // Try Redis cache (distributed path)
    const redisResult = await this.getFromRedis(prefix);
    if (redisResult) {
      // Populate local cache for subsequent requests
      this.setLocal(prefix, redisResult);
      this.stats.hits++;
      return redisResult;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store API key metadata in cache
   *
   * Stores in both local LRU cache and Redis for distributed access.
   *
   * @param apiKey - Full API key record to cache
   */
  async set(apiKey: ApiKey): Promise<void> {
    const metadata = this.apiKeyToMetadata(apiKey);

    // Store in local cache
    this.setLocal(metadata.prefix, metadata);

    // Store in Redis
    await this.setInRedis(metadata);

    logger.debug(
      { prefix: metadata.prefix, keyId: metadata.id },
      'API key metadata cached'
    );
  }

  /**
   * Invalidate cached API key metadata
   *
   * Removes from local cache and Redis, and publishes invalidation
   * event to other instances.
   *
   * @param prefix - API key prefix to invalidate
   * @param keyId - API key ID
   * @param tenantId - Tenant ID
   * @param type - Type of invalidation
   * @param reason - Optional reason for invalidation
   */
  async invalidate(
    prefix: string,
    keyId: string,
    tenantId: string,
    type: CacheInvalidationEvent['type'],
    reason?: string
  ): Promise<void> {
    // Remove from local cache
    this.removeFromLocal(prefix);

    // Remove from Redis
    await this.removeFromRedis(prefix);

    // Publish invalidation event to other instances
    await this.publishInvalidation({
      type,
      prefix,
      keyId,
      tenantId,
      timestamp: Date.now(),
      sourceInstance: this.instanceId,
      reason,
    });

    logger.debug(
      { prefix, keyId, type, reason },
      'API key cache invalidated'
    );
  }

  /**
   * Bulk invalidate all cached entries for a tenant
   *
   * @param tenantId - Tenant ID to invalidate
   * @param reason - Reason for invalidation
   */
  async invalidateTenant(tenantId: string, reason?: string): Promise<number> {
    let invalidatedCount = 0;

    // Remove matching entries from local cache
    for (const [prefix, node] of this.cache.entries()) {
      if (node.value.tenantId === tenantId) {
        this.removeFromLocal(prefix);
        await this.removeFromRedis(prefix);
        invalidatedCount++;
      }
    }

    // Publish bulk invalidation event
    await this.publishInvalidation({
      type: 'delete',
      prefix: '*',
      keyId: '*',
      tenantId,
      timestamp: Date.now(),
      sourceInstance: this.instanceId,
      reason: reason ?? `Tenant ${tenantId} bulk invalidation`,
    });

    logger.info(
      { tenantId, invalidatedCount },
      'Tenant API key cache invalidated'
    );

    return invalidatedCount;
  }

  // ===========================================================================
  // LOCAL LRU CACHE
  // ===========================================================================

  /**
   * Get from local LRU cache
   */
  private getFromLocal(prefix: string): CachedApiKeyMetadata | null {
    const node = this.cache.get(prefix);
    if (!node) {
      return null;
    }

    // Check expiration
    if (Date.now() > node.expiresAt) {
      this.removeFromLocal(prefix);
      return null;
    }

    // Move to front (most recently used)
    this.moveToFront(node);

    return node.value;
  }

  /**
   * Set in local LRU cache
   */
  private setLocal(prefix: string, metadata: CachedApiKeyMetadata): void {
    // Check if already exists
    const existing = this.cache.get(prefix);
    if (existing) {
      // Update value and move to front
      existing.value = metadata;
      existing.expiresAt = metadata.expiresAtCache;
      this.moveToFront(existing);
      return;
    }

    // Evict if at capacity
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.evictLRU();
    }

    // Create new node
    const node: LRUNode = {
      key: prefix,
      value: metadata,
      prev: null,
      next: this.head,
      expiresAt: metadata.expiresAtCache,
    };

    // Add to front
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }

    this.cache.set(prefix, node);
  }

  /**
   * Remove from local LRU cache
   */
  private removeFromLocal(prefix: string): void {
    const node = this.cache.get(prefix);
    if (!node) {
      return;
    }

    // Remove from linked list
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    this.cache.delete(prefix);
  }

  /**
   * Move node to front of LRU list
   */
  private moveToFront(node: LRUNode): void {
    if (node === this.head) {
      return; // Already at front
    }

    // Remove from current position
    if (node.prev) {
      node.prev.next = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    // Move to front
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (!this.tail) {
      return;
    }

    const evictedKey = this.tail.key;
    this.removeFromLocal(evictedKey);

    logger.debug({ prefix: evictedKey }, 'API key cache entry evicted (LRU)');
  }

  // ===========================================================================
  // REDIS CACHE
  // ===========================================================================

  /**
   * Get Redis client, initializing if needed
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();
      await this.subscribeToInvalidations();
    }
    return this.redis;
  }

  /**
   * Generate Redis key for cached metadata
   */
  private redisKey(prefix: string): string {
    return `${REDIS_KEY_PREFIX}:${prefix}`;
  }

  /**
   * Get from Redis cache
   */
  private async getFromRedis(prefix: string): Promise<CachedApiKeyMetadata | null> {
    try {
      const redis = await this.getRedis();
      const data = await redis.get(this.redisKey(prefix));

      if (!data) {
        return null;
      }

      const metadata = this.deserializeMetadata(JSON.parse(data));

      // Check if expired (belt and suspenders with Redis TTL)
      if (Date.now() > metadata.expiresAtCache) {
        await this.removeFromRedis(prefix);
        return null;
      }

      return metadata;
    } catch (error) {
      logger.warn({ error, prefix }, 'Failed to get from Redis cache');
      return null;
    }
  }

  /**
   * Set in Redis cache
   */
  private async setInRedis(metadata: CachedApiKeyMetadata): Promise<void> {
    try {
      const redis = await this.getRedis();
      const serialized = JSON.stringify(this.serializeMetadata(metadata));

      await redis.setex(
        this.redisKey(metadata.prefix),
        REDIS_CACHE_TTL_SECONDS,
        serialized
      );
    } catch (error) {
      logger.warn({ error, prefix: metadata.prefix }, 'Failed to set in Redis cache');
    }
  }

  /**
   * Remove from Redis cache
   */
  private async removeFromRedis(prefix: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.del(this.redisKey(prefix));
    } catch (error) {
      logger.warn({ error, prefix }, 'Failed to remove from Redis cache');
    }
  }

  // ===========================================================================
  // PUB/SUB INVALIDATION
  // ===========================================================================

  /**
   * Subscribe to cache invalidation events from other instances
   */
  private async subscribeToInvalidations(): Promise<void> {
    if (this.isSubscribed || this.subscriber) {
      return;
    }

    try {
      // Create a separate connection for subscribing
      this.subscriber = getRedis().duplicate();

      await this.subscriber.subscribe(INVALIDATION_CHANNEL);

      this.subscriber.on('message', (channel, message) => {
        if (channel === INVALIDATION_CHANNEL) {
          this.handleInvalidationEvent(message);
        }
      });

      this.isSubscribed = true;
      logger.info('Subscribed to API key cache invalidation events');
    } catch (error) {
      logger.warn({ error }, 'Failed to subscribe to cache invalidation events');
    }
  }

  /**
   * Handle incoming invalidation event from another instance
   */
  private handleInvalidationEvent(message: string): void {
    try {
      const event = JSON.parse(message) as CacheInvalidationEvent;

      // Don't process our own events
      if (event.sourceInstance === this.instanceId) {
        return;
      }

      this.stats.invalidationsReceived++;

      // Handle bulk tenant invalidation
      if (event.prefix === '*') {
        for (const [prefix, node] of this.cache.entries()) {
          if (node.value.tenantId === event.tenantId) {
            this.removeFromLocal(prefix);
          }
        }
        logger.debug(
          { tenantId: event.tenantId, type: event.type },
          'Processed bulk tenant cache invalidation from another instance'
        );
        return;
      }

      // Handle single key invalidation
      this.removeFromLocal(event.prefix);

      logger.debug(
        { prefix: event.prefix, type: event.type, reason: event.reason },
        'Processed cache invalidation from another instance'
      );
    } catch (error) {
      logger.error({ error, message }, 'Failed to parse cache invalidation event');
    }
  }

  /**
   * Publish cache invalidation event to other instances
   */
  private async publishInvalidation(event: CacheInvalidationEvent): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.publish(INVALIDATION_CHANNEL, JSON.stringify(event));
      this.stats.invalidationsPublished++;
    } catch (error) {
      logger.warn({ error, event }, 'Failed to publish cache invalidation event');
    }
  }

  // ===========================================================================
  // CONVERSION HELPERS
  // ===========================================================================

  /**
   * Convert full API key to cached metadata
   */
  private apiKeyToMetadata(apiKey: ApiKey): CachedApiKeyMetadata {
    const now = Date.now();
    return {
      id: apiKey.id,
      keyHash: apiKey.hashedKey,
      prefix: apiKey.prefix,
      tenantId: apiKey.tenantId,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.getTime() ?? null,
      rateLimit: apiKey.rateLimit,
      status: apiKey.status,
      allowedIps: apiKey.allowedIps,
      cachedAt: now,
      expiresAtCache: now + CACHE_TTL_MS,
    };
  }

  /**
   * Serialize metadata for Redis storage
   */
  private serializeMetadata(metadata: CachedApiKeyMetadata): Record<string, unknown> {
    return {
      ...metadata,
      // Ensure dates are stored as numbers
      expiresAt: metadata.expiresAt,
      cachedAt: metadata.cachedAt,
      expiresAtCache: metadata.expiresAtCache,
    };
  }

  /**
   * Deserialize metadata from Redis storage
   */
  private deserializeMetadata(data: Record<string, unknown>): CachedApiKeyMetadata {
    return {
      id: data['id'] as string,
      keyHash: data['keyHash'] as string,
      prefix: data['prefix'] as string,
      tenantId: data['tenantId'] as string,
      scopes: data['scopes'] as ApiKeyScope[],
      expiresAt: data['expiresAt'] as number | null,
      rateLimit: data['rateLimit'] as ApiKeyRateLimit,
      status: data['status'] as ApiKeyStatus,
      allowedIps: data['allowedIps'] as string[] | undefined,
      cachedAt: data['cachedAt'] as number,
      expiresAtCache: data['expiresAtCache'] as number,
    };
  }

  // ===========================================================================
  // CLEANUP & LIFECYCLE
  // ===========================================================================

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanupInterval(): void {
    // Clean up expired entries every 10 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [prefix, node] of this.cache.entries()) {
        if (now > node.expiresAt) {
          this.removeFromLocal(prefix);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.debug({ expiredCount }, 'Cleaned up expired cache entries');
      }
    }, 10_000);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cache and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe(INVALIDATION_CHANNEL);
      await this.subscriber.quit();
      this.subscriber = null;
      this.isSubscribed = false;
    }

    this.cache.clear();
    this.head = null;
    this.tail = null;

    logger.info('API key metadata cache stopped');
  }

  /**
   * Clear all cached entries (for testing)
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.head = null;
    this.tail = null;

    this.stats = {
      hits: 0,
      misses: 0,
      invalidationsReceived: 0,
      invalidationsPublished: 0,
    };

    logger.info('API key metadata cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      localCacheSize: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0,
      invalidationsReceived: this.stats.invalidationsReceived,
      invalidationsPublished: this.stats.invalidationsPublished,
      redisSubscribed: this.isSubscribed,
      instanceId: this.instanceId,
    };
  }

  /**
   * Check cache health including Redis connectivity
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    localCacheSize: number;
    redisHealthy: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const localCacheSize = this.cache.size;
    const redisHealth = await checkRedisHealth();

    return {
      healthy: redisHealth.healthy,
      localCacheSize,
      redisHealthy: redisHealth.healthy,
      latencyMs: redisHealth.latencyMs,
      error: redisHealth.error,
    };
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

let cacheInstance: ApiKeyMetadataCache | null = null;

/**
 * Get the API key metadata cache singleton
 */
export function getApiKeyMetadataCache(): ApiKeyMetadataCache {
  if (!cacheInstance) {
    cacheInstance = new ApiKeyMetadataCache();
    logger.info('API key metadata cache singleton initialized');
  }
  return cacheInstance;
}

/**
 * Create a new API key metadata cache instance (for testing)
 */
export function createApiKeyMetadataCache(): ApiKeyMetadataCache {
  return new ApiKeyMetadataCache();
}

/**
 * Reset the API key metadata cache singleton (for testing)
 */
export async function resetApiKeyMetadataCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.stop();
    cacheInstance = null;
  }
  logger.info('API key metadata cache singleton reset');
}
