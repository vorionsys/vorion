/**
 * Token Revocation Check Middleware
 *
 * Provides efficient token revocation checking using a two-tier approach:
 * 1. Bloom filter for fast negative lookups (not revoked)
 * 2. Redis fallback for bloom filter hits (possible false positives)
 *
 * The bloom filter provides O(1) lookup time and eliminates Redis roundtrips
 * for the majority of tokens (which are not revoked). On bloom filter hits,
 * we fall back to Redis for authoritative revocation status.
 *
 * Key features:
 * - In-memory bloom filter for < 0.1ms lookups
 * - Configurable false positive rate (default: 0.1%)
 * - Automatic synchronization via Redis pub/sub
 * - Graceful degradation on Redis unavailability
 *
 * @packageDocumentation
 */

import type {
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import { createLogger } from '../common/logger.js';
import { getRedis, checkRedisHealth } from '../common/redis.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';
import {
  createTokenRevocationService,
  type TokenRevocationService,
} from '../common/token-revocation.js';
import { getTokenLifecycleService } from './token-lifecycle.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../audit/security-logger.js';
import type { SecurityActor, SecurityResource } from '../audit/security-events.js';
import type { Redis } from 'ioredis';

const logger = createLogger({ component: 'revocation-check' });

// =============================================================================
// Metrics
// =============================================================================

const revocationChecksTotal = new Counter({
  name: 'vorion_revocation_check_total',
  help: 'Total revocation checks performed',
  labelNames: ['result', 'source'] as const, // result: allowed/blocked, source: bloom/redis
  registers: [vorionRegistry],
});

const revocationCheckDuration = new Histogram({
  name: 'vorion_revocation_check_duration_seconds',
  help: 'Duration of revocation check operations',
  labelNames: ['source'] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

const bloomFilterSize = new Gauge({
  name: 'vorion_revocation_bloom_filter_size',
  help: 'Current size of bloom filter (number of bits)',
  registers: [vorionRegistry],
});

const bloomFilterItems = new Gauge({
  name: 'vorion_revocation_bloom_filter_items',
  help: 'Number of items added to bloom filter',
  registers: [vorionRegistry],
});

const bloomFilterFalsePositives = new Counter({
  name: 'vorion_revocation_bloom_filter_false_positives_total',
  help: 'Number of bloom filter false positives (hit but not in Redis)',
  registers: [vorionRegistry],
});

// =============================================================================
// Bloom Filter Implementation
// =============================================================================

/**
 * Simple bloom filter implementation for token revocation checking
 *
 * Uses multiple hash functions derived from MurmurHash-style hashing
 * to achieve configurable false positive rates.
 */
class BloomFilter {
  private bitArray: Uint8Array;
  private bitCount: number;
  private hashCount: number;
  private itemCount: number = 0;

  /**
   * Create a new bloom filter
   *
   * @param expectedItems - Expected number of items to store
   * @param falsePositiveRate - Desired false positive rate (default: 0.001 = 0.1%)
   */
  constructor(expectedItems: number = 100000, falsePositiveRate: number = 0.001) {
    // Calculate optimal bit count: m = -n * ln(p) / (ln(2)^2)
    this.bitCount = Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / Math.pow(Math.log(2), 2)
    );

    // Round up to nearest byte boundary
    this.bitCount = Math.ceil(this.bitCount / 8) * 8;

    // Calculate optimal hash count: k = (m/n) * ln(2)
    this.hashCount = Math.ceil((this.bitCount / expectedItems) * Math.log(2));

    // Cap hash count at reasonable limit
    this.hashCount = Math.min(this.hashCount, 20);

    // Initialize bit array
    this.bitArray = new Uint8Array(this.bitCount / 8);

    bloomFilterSize.set(this.bitCount);

    logger.info(
      {
        bitCount: this.bitCount,
        hashCount: this.hashCount,
        expectedItems,
        falsePositiveRate,
        memoryBytes: this.bitArray.length,
      },
      'Bloom filter initialized'
    );
  }

  /**
   * Add an item to the bloom filter
   */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.bitCount;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      this.bitArray[byteIndex]! |= 1 << bitIndex;
    }
    this.itemCount++;
    bloomFilterItems.set(this.itemCount);
  }

  /**
   * Check if an item might be in the filter
   *
   * Returns false if definitely not in filter (negative result is authoritative)
   * Returns true if possibly in filter (may be a false positive)
   */
  mightContain(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.bitCount;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      if ((this.bitArray[byteIndex]! & (1 << bitIndex)) === 0) {
        return false; // Definitely not in filter
      }
    }
    return true; // Possibly in filter
  }

  /**
   * Clear the filter
   */
  clear(): void {
    this.bitArray.fill(0);
    this.itemCount = 0;
    bloomFilterItems.set(0);
  }

  /**
   * Get the number of items added
   */
  getItemCount(): number {
    return this.itemCount;
  }

  /**
   * Get the size in bytes
   */
  getSizeBytes(): number {
    return this.bitArray.length;
  }

  /**
   * Get the estimated false positive rate at current fill level
   */
  getEstimatedFalsePositiveRate(): number {
    // p = (1 - e^(-kn/m))^k
    const fillRatio = (this.hashCount * this.itemCount) / this.bitCount;
    return Math.pow(1 - Math.exp(-fillRatio), this.hashCount);
  }

  /**
   * Generate hash values for an item using enhanced double hashing
   *
   * Uses two base hashes and derives additional hashes via:
   * h(i) = h1 + i*h2 + i^2
   */
  private getHashes(item: string): number[] {
    const h1 = this.hash1(item);
    const h2 = this.hash2(item);
    const hashes: number[] = [];

    for (let i = 0; i < this.hashCount; i++) {
      // Enhanced double hashing with quadratic probing
      const hash = Math.abs((h1 + i * h2 + i * i) >>> 0);
      hashes.push(hash);
    }

    return hashes;
  }

  /**
   * First hash function (FNV-1a variant)
   */
  private hash1(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  /**
   * Second hash function (DJB2 variant)
   */
  private hash2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (((hash << 5) >>> 0) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Revocation check middleware options
 */
export interface RevocationCheckOptions {
  /** Paths to skip revocation checking */
  skipPaths?: string[];
  /** Expected number of revoked tokens (for bloom filter sizing) */
  expectedRevokedTokens?: number;
  /** Desired false positive rate (default: 0.001 = 0.1%) */
  falsePositiveRate?: number;
  /** Whether to check user-level revocation timestamps */
  checkUserRevocation?: boolean;
  /** Whether to check tenant-level revocation */
  checkTenantRevocation?: boolean;
  /** Redis key prefix for revoked tokens */
  redisKeyPrefix?: string;
  /** How often to sync with Redis (ms) */
  syncIntervalMs?: number;
}

/**
 * JWT payload with required claims for revocation checking
 */
interface JWTPayload {
  jti?: string;
  sub?: string;
  iat?: number;
  exp?: number;
  tenantId?: string;
}

/**
 * Revocation check result
 */
export interface RevocationCheckResult {
  /** Whether the token is revoked */
  revoked: boolean;
  /** Reason for revocation if revoked */
  reason?: string;
  /** Source of the check result */
  source: 'bloom_filter' | 'redis' | 'user_timestamp' | 'tenant';
  /** Duration of the check in milliseconds */
  durationMs: number;
}

// =============================================================================
// Revocation Check Service
// =============================================================================

/**
 * Token Revocation Check Service
 *
 * Provides efficient token revocation checking using a bloom filter
 * with Redis fallback for handling false positives.
 */
export class RevocationCheckService {
  private bloomFilter: BloomFilter;
  private redis: Redis | null = null;
  private subscriber: Redis | null = null;
  private isSubscribed: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private tokenRevocationService: TokenRevocationService;
  private securityLogger: SecurityAuditLogger;
  private readonly instanceId: string;
  private readonly redisKeyPrefix: string;
  private readonly revocationChannel: string;

  constructor(private options: RevocationCheckOptions = {}) {
    this.instanceId = crypto.randomUUID();
    this.redisKeyPrefix = options.redisKeyPrefix ?? 'token:revoked:';
    this.revocationChannel = 'vorion:token:revocation:bloom';

    // Initialize bloom filter
    this.bloomFilter = new BloomFilter(
      options.expectedRevokedTokens ?? 100000,
      options.falsePositiveRate ?? 0.001
    );

    // Initialize services
    this.tokenRevocationService = createTokenRevocationService();
    this.securityLogger = getSecurityAuditLogger();

    // Start sync interval
    if (options.syncIntervalMs) {
      this.startSyncInterval(options.syncIntervalMs);
    }

    logger.info({ instanceId: this.instanceId }, 'Revocation check service initialized');
  }

  /**
   * Check if a token is revoked
   *
   * Uses bloom filter for fast negative lookups, falling back to Redis
   * for bloom filter hits to handle false positives.
   *
   * @param jti - JWT ID (token identifier)
   * @param userId - User ID for user-level revocation check
   * @param issuedAt - Token issue timestamp for user-level revocation
   * @param tenantId - Tenant ID for tenant-level revocation
   * @returns Revocation check result
   */
  async checkRevocation(
    jti: string,
    userId?: string,
    issuedAt?: Date,
    tenantId?: string
  ): Promise<RevocationCheckResult> {
    const startTime = performance.now();

    // 1. Check tenant-level revocation first (if enabled)
    if (this.options.checkTenantRevocation !== false && tenantId) {
      const tenantRevoked = await this.checkTenantRevocation(tenantId);
      if (tenantRevoked) {
        const durationMs = performance.now() - startTime;
        revocationChecksTotal.inc({ result: 'blocked', source: 'tenant' });
        revocationCheckDuration.observe({ source: 'tenant' }, durationMs / 1000);
        return {
          revoked: true,
          reason: 'Tenant has been suspended',
          source: 'tenant',
          durationMs,
        };
      }
    }

    // 2. Check user-level revocation timestamp (if enabled)
    if (this.options.checkUserRevocation !== false && userId && issuedAt) {
      const userRevoked = await this.tokenRevocationService.isUserTokenRevoked(userId, issuedAt);
      if (userRevoked) {
        const durationMs = performance.now() - startTime;
        revocationChecksTotal.inc({ result: 'blocked', source: 'user_timestamp' });
        revocationCheckDuration.observe({ source: 'redis' }, durationMs / 1000);
        return {
          revoked: true,
          reason: 'User tokens have been revoked',
          source: 'user_timestamp',
          durationMs,
        };
      }
    }

    // 3. Check bloom filter for individual token revocation
    const mightBeRevoked = this.bloomFilter.mightContain(jti);

    if (!mightBeRevoked) {
      // Bloom filter says not revoked - this is authoritative
      const durationMs = performance.now() - startTime;
      revocationChecksTotal.inc({ result: 'allowed', source: 'bloom' });
      revocationCheckDuration.observe({ source: 'bloom' }, durationMs / 1000);
      return {
        revoked: false,
        source: 'bloom_filter',
        durationMs,
      };
    }

    // 4. Bloom filter hit - fall back to Redis for authoritative check
    const isRevoked = await this.checkRedis(jti);
    const durationMs = performance.now() - startTime;

    if (!isRevoked) {
      // False positive from bloom filter
      bloomFilterFalsePositives.inc();
      revocationChecksTotal.inc({ result: 'allowed', source: 'redis' });
    } else {
      revocationChecksTotal.inc({ result: 'blocked', source: 'redis' });
    }

    revocationCheckDuration.observe({ source: 'redis' }, durationMs / 1000);

    return {
      revoked: isRevoked,
      reason: isRevoked ? 'Token has been revoked' : undefined,
      source: 'redis',
      durationMs,
    };
  }

  /**
   * Add a revoked token to the bloom filter
   *
   * Called when a token is revoked to update the local filter.
   */
  addRevokedToken(jti: string): void {
    this.bloomFilter.add(jti);
    logger.debug({ jti: jti.substring(0, 8) }, 'Token added to revocation bloom filter');
  }

  /**
   * Check tenant-level revocation
   */
  private async checkTenantRevocation(tenantId: string): Promise<boolean> {
    try {
      const lifecycleService = getTokenLifecycleService();
      return lifecycleService.isTenantRevoked(tenantId);
    } catch (error) {
      logger.warn({ error, tenantId }, 'Failed to check tenant revocation');
      return false; // Fail open
    }
  }

  /**
   * Check Redis for token revocation
   */
  private async checkRedis(jti: string): Promise<boolean> {
    try {
      return this.tokenRevocationService.isRevoked(jti);
    } catch (error) {
      logger.warn({ error }, 'Failed to check Redis for token revocation');
      return false; // Fail open on Redis error
    }
  }

  /**
   * Get Redis client
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();
      await this.subscribeToRevocations();
    }
    return this.redis;
  }

  /**
   * Subscribe to revocation events for bloom filter updates
   */
  private async subscribeToRevocations(): Promise<void> {
    if (this.isSubscribed || this.subscriber) {
      return;
    }

    try {
      this.subscriber = getRedis().duplicate();
      await this.subscriber.subscribe(this.revocationChannel);

      this.subscriber.on('message', (channel, message) => {
        if (channel === this.revocationChannel) {
          this.handleRevocationEvent(message);
        }
      });

      this.isSubscribed = true;
      logger.info('Subscribed to bloom filter revocation events');
    } catch (error) {
      logger.warn({ error }, 'Failed to subscribe to revocation events');
    }
  }

  /**
   * Handle incoming revocation event
   */
  private handleRevocationEvent(message: string): void {
    try {
      const event = JSON.parse(message);
      if (event.jti && event.sourceInstance !== this.instanceId) {
        this.addRevokedToken(event.jti);
        logger.debug({ jti: event.jti.substring(0, 8) }, 'Received revocation event');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to handle revocation event');
    }
  }

  /**
   * Publish revocation event to other instances
   */
  async publishRevocation(jti: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.publish(
        this.revocationChannel,
        JSON.stringify({ jti, sourceInstance: this.instanceId, timestamp: Date.now() })
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to publish revocation event');
    }
  }

  /**
   * Start sync interval to periodically rebuild bloom filter from Redis
   */
  private startSyncInterval(intervalMs: number): void {
    this.syncInterval = setInterval(async () => {
      await this.syncFromRedis();
    }, intervalMs);
    this.syncInterval.unref();
  }

  /**
   * Sync bloom filter from Redis
   *
   * Rebuilds the bloom filter from all revoked tokens in Redis.
   * This handles cases where revocation events were missed.
   */
  async syncFromRedis(): Promise<void> {
    try {
      const redis = await this.getRedis();
      const pattern = `${this.redisKeyPrefix}*`;
      const keys = await redis.keys(pattern);

      // Create new bloom filter with current size estimate
      const newFilter = new BloomFilter(
        Math.max(keys.length * 2, this.options.expectedRevokedTokens ?? 100000),
        this.options.falsePositiveRate ?? 0.001
      );

      // Add all revoked tokens
      for (const key of keys) {
        const jti = key.replace(this.redisKeyPrefix, '');
        newFilter.add(jti);
      }

      // Replace the bloom filter
      this.bloomFilter = newFilter;

      logger.info(
        { itemCount: keys.length, filterSize: newFilter.getSizeBytes() },
        'Bloom filter synced from Redis'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to sync bloom filter from Redis');
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    bloomFilterItems: number;
    bloomFilterSizeBytes: number;
    estimatedFalsePositiveRate: number;
    isSubscribed: boolean;
    instanceId: string;
  } {
    return {
      bloomFilterItems: this.bloomFilter.getItemCount(),
      bloomFilterSizeBytes: this.bloomFilter.getSizeBytes(),
      estimatedFalsePositiveRate: this.bloomFilter.getEstimatedFalsePositiveRate(),
      isSubscribed: this.isSubscribed,
      instanceId: this.instanceId,
    };
  }

  /**
   * Check service health
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    bloomFilterHealthy: boolean;
    redisHealthy: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const redisHealth = await checkRedisHealth();

    return {
      healthy: redisHealth.healthy,
      bloomFilterHealthy: this.bloomFilter.getItemCount() >= 0,
      redisHealthy: redisHealth.healthy,
      latencyMs: redisHealth.latencyMs,
      error: redisHealth.error,
    };
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.revocationChannel);
      await this.subscriber.quit();
      this.subscriber = null;
      this.isSubscribed = false;
    }

    logger.info('Revocation check service stopped');
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Build security actor from request
 */
function buildRequestActor(request: FastifyRequest): SecurityActor {
  const user = (request as { user?: { sub?: string; did?: string; tenantId?: string } }).user;
  return {
    type: 'user',
    id: user?.sub ?? 'unknown',
    tenantId: user?.tenantId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    sessionId: request.headers['x-session-id'] as string | undefined,
  };
}

/**
 * Build security resource from request
 */
function buildRequestResource(request: FastifyRequest): SecurityResource {
  return {
    type: 'endpoint',
    id: request.routeOptions.url ?? request.url,
    path: request.url,
    attributes: {
      method: request.method,
    },
  };
}

/**
 * Create revocation check middleware
 *
 * Checks token revocation status before allowing request to proceed.
 * Uses bloom filter for efficient negative lookups with Redis fallback.
 *
 * @param service - Revocation check service instance
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * const revocationService = new RevocationCheckService({
 *   expectedRevokedTokens: 100000,
 *   falsePositiveRate: 0.001,
 * });
 *
 * fastify.addHook('preHandler', revocationCheckMiddleware(revocationService, {
 *   skipPaths: ['/health', '/metrics', '/docs'],
 * }));
 * ```
 */
export function revocationCheckMiddleware(
  service: RevocationCheckService,
  options: { skipPaths?: string[] } = {}
): preHandlerHookHandler {
  const skipPaths = new Set(options.skipPaths ?? []);
  const securityLogger = getSecurityAuditLogger();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip configured paths
    if (skipPaths.has(request.url) || skipPaths.has(request.routeOptions.url ?? '')) {
      return;
    }

    // Get JWT payload from request
    const user = (request as { user?: JWTPayload }).user;
    if (!user) {
      // No authenticated user, skip check
      return;
    }

    const { jti, sub: userId, iat, tenantId } = user;

    // If no jti claim, we can't check individual token revocation
    // But we can still check user-level and tenant-level revocation
    const issuedAt = iat ? new Date(iat * 1000) : undefined;

    const result = await service.checkRevocation(
      jti ?? '',
      userId,
      issuedAt,
      tenantId
    );

    if (result.revoked) {
      // Token is revoked - deny request
      const actor = buildRequestActor(request);
      const resource = buildRequestResource(request);

      await securityLogger.logAccessDenied(
        actor,
        resource,
        result.reason ?? 'Token has been revoked',
        {
          source: result.source,
          durationMs: result.durationMs,
          jti: jti?.substring(0, 8),
        }
      );

      logger.warn(
        {
          userId,
          tenantId,
          source: result.source,
          reason: result.reason,
        },
        'Request denied due to token revocation'
      );

      return reply.status(401).send({
        error: {
          code: 'TOKEN_REVOKED',
          message: result.reason ?? 'Token has been revoked',
        },
      });
    }
  };
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let revocationCheckService: RevocationCheckService | null = null;

/**
 * Get the revocation check service singleton
 */
export function getRevocationCheckService(options?: RevocationCheckOptions): RevocationCheckService {
  if (!revocationCheckService) {
    revocationCheckService = new RevocationCheckService(options);
    logger.info('Revocation check service singleton initialized');
  }
  return revocationCheckService;
}

/**
 * Create a new revocation check service instance (for testing)
 */
export function createRevocationCheckService(options?: RevocationCheckOptions): RevocationCheckService {
  return new RevocationCheckService(options);
}

/**
 * Reset the revocation check service singleton (for testing)
 */
export async function resetRevocationCheckService(): Promise<void> {
  if (revocationCheckService) {
    await revocationCheckService.stop();
    revocationCheckService = null;
  }
  logger.info('Revocation check service singleton reset');
}
