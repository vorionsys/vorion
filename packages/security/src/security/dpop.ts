/**
 * DPoP (Demonstrating Proof-of-Possession) Service
 *
 * Implements sender-constrained tokens per RFC 9449 for CAR ID security hardening.
 * DPoP binds access tokens to a proof-of-possession key, preventing token theft
 * and replay attacks.
 *
 * Key features:
 * - DPoP proof generation with ES256/ES384/ES512
 * - Proof verification with replay prevention
 * - Access token binding validation
 * - JTI uniqueness enforcement
 * - Redis-backed JTI cache for multi-instance deployments
 *
 * @packageDocumentation
 */

/// <reference lib="dom" />

import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';
import { getRedis, checkRedisHealth } from '../common/redis.js';
import type { Redis } from 'ioredis';
import {
  type DPoPConfig,
  type DPoPProof,
  type DPoPVerificationResult,
  type JTICache,
  type TrustTier,
  dpopConfigSchema,
  dpopProofSchema,
} from './types.js';

const logger = createLogger({ component: 'security-dpop' });

// =============================================================================
// Metrics
// =============================================================================

const dpopProofsGenerated = new Counter({
  name: 'vorion_security_dpop_proofs_generated_total',
  help: 'Total DPoP proofs generated',
  registers: [vorionRegistry],
});

const dpopVerifications = new Counter({
  name: 'vorion_security_dpop_verifications_total',
  help: 'Total DPoP proof verifications',
  labelNames: ['result'] as const, // success, invalid, expired, replay
  registers: [vorionRegistry],
});

const dpopVerificationDuration = new Histogram({
  name: 'vorion_security_dpop_verification_duration_seconds',
  help: 'Duration of DPoP proof verification',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

// JTI Cache metrics
const jtiCacheHits = new Counter({
  name: 'vorion_security_dpop_jti_cache_hits_total',
  help: 'Total JTI cache hits (replay attempts blocked)',
  registers: [vorionRegistry],
});

const jtiCacheMisses = new Counter({
  name: 'vorion_security_dpop_jti_cache_misses_total',
  help: 'Total JTI cache misses (new JTIs)',
  registers: [vorionRegistry],
});

const jtiCacheRedisFailures = new Counter({
  name: 'vorion_security_dpop_jti_redis_failures_total',
  help: 'Total Redis failures in JTI cache operations',
  labelNames: ['operation'] as const, // store, exists, cleanup
  registers: [vorionRegistry],
});

const jtiCacheSize = new Gauge({
  name: 'vorion_security_dpop_jti_cache_size',
  help: 'Current size of JTI cache',
  labelNames: ['backend'] as const, // redis, memory
  registers: [vorionRegistry],
});

const jtiCacheFallbackActive = new Gauge({
  name: 'vorion_security_dpop_jti_fallback_active',
  help: 'Whether JTI cache is in fallback mode (1 = fallback to memory, 0 = using Redis)',
  registers: [vorionRegistry],
});

// =============================================================================
// Errors
// =============================================================================

/**
 * DPoP-specific error
 */
export class DPoPError extends VorionError {
  override code = 'DPOP_ERROR';
  override statusCode = 401;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'DPoPError';
  }
}

// =============================================================================
// JTI Cache Configuration
// =============================================================================

/** Redis key prefix for JTI entries */
const JTI_KEY_PREFIX = 'vorion:dpop:jti';

/** Redis key for the sorted set tracking all JTIs (for bounded size) */
const JTI_INDEX_KEY = 'vorion:dpop:jti:index';

/** Maximum number of JTIs to store in Redis */
const MAX_JTI_COUNT = 100_000;

/** Default JTI TTL in seconds (5 minutes, matching typical DPoP proof expiration) */
const DEFAULT_JTI_TTL_SECONDS = 300;

/** Cleanup batch size for removing expired entries from sorted set */
const CLEANUP_BATCH_SIZE = 1000;

// =============================================================================
// In-Memory JTI Cache (fallback for Redis unavailability)
// =============================================================================

/**
 * Simple in-memory JTI cache implementation
 * Used as fallback when Redis is unavailable
 */
class InMemoryJTICache implements JTICache {
  private cache = new Map<string, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async store(jti: string, expiresAt: Date): Promise<void> {
    // Enforce size limit by evicting oldest entries
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    this.cache.set(jti, expiresAt.getTime());
    jtiCacheSize.set({ backend: 'memory' }, this.cache.size);
  }

  async exists(jti: string): Promise<boolean> {
    const expiry = this.cache.get(jti);
    if (expiry === undefined) {
      return false;
    }
    // Check if expired
    if (Date.now() > expiry) {
      this.cache.delete(jti);
      jtiCacheSize.set({ backend: 'memory' }, this.cache.size);
      return false;
    }
    return true;
  }

  private evictOldest(): void {
    // Evict entries with earliest expiration times
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1] - b[1]);

    const toEvict = Math.max(1, Math.floor(this.maxSize * 0.1)); // Evict 10%
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      this.cache.delete(entries[i]![0]);
    }
    jtiCacheSize.set({ backend: 'memory' }, this.cache.size);
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [jti, expiry] of entries) {
      if (now > expiry) {
        this.cache.delete(jti);
      }
    }
    jtiCacheSize.set({ backend: 'memory' }, this.cache.size);
  }

  getSize(): number {
    return this.cache.size;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    jtiCacheSize.set({ backend: 'memory' }, 0);
  }
}

// =============================================================================
// Redis-backed JTI Cache
// =============================================================================

/**
 * Configuration for Redis JTI cache
 */
export interface RedisJTICacheConfig {
  /** Maximum number of JTIs to store (default: 100,000) */
  maxSize?: number;
  /** Default TTL in seconds for JTI entries (default: 300 = 5 minutes) */
  defaultTTLSeconds?: number;
  /** Interval in ms for cleanup of expired entries from sorted set (default: 60000 = 1 minute) */
  cleanupIntervalMs?: number;
  /** Whether to fall back to in-memory cache on Redis failure (default: true) */
  enableFallback?: boolean;
}

/**
 * Redis-backed JTI cache for scalable, multi-instance DPoP replay prevention
 *
 * Features:
 * - Uses SETNX for atomic "check and set" to prevent race conditions
 * - Bounded size with automatic eviction of oldest entries
 * - TTL-based expiration matching DPoP proof lifetime
 * - Graceful fallback to in-memory cache when Redis is unavailable
 * - Metrics for monitoring cache performance
 *
 * Key structure:
 * - Individual JTIs: `vorion:dpop:jti:{jti_hash}` (string with TTL)
 * - JTI index: `vorion:dpop:jti:index` (sorted set with timestamp scores for bounded size)
 */
export class RedisJTICache implements JTICache {
  private redis: Redis | null = null;
  private fallbackCache: InMemoryJTICache;
  private inFallbackMode: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly config: Required<RedisJTICacheConfig>;

  constructor(config: RedisJTICacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? MAX_JTI_COUNT,
      defaultTTLSeconds: config.defaultTTLSeconds ?? DEFAULT_JTI_TTL_SECONDS,
      cleanupIntervalMs: config.cleanupIntervalMs ?? 60000,
      enableFallback: config.enableFallback ?? true,
    };

    // Initialize fallback cache with smaller size
    this.fallbackCache = new InMemoryJTICache(Math.min(10000, this.config.maxSize / 10));

    // Start cleanup interval
    this.startCleanup();

    logger.info(
      {
        maxSize: this.config.maxSize,
        defaultTTLSeconds: this.config.defaultTTLSeconds,
        enableFallback: this.config.enableFallback,
      },
      'Redis JTI cache initialized'
    );
  }

  /**
   * Get Redis client, initializing if needed
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();
    }
    return this.redis;
  }

  /**
   * Calculate SHA-256 hash of JTI for key
   */
  private async hashJti(jti: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(jti);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    // Use hex encoding for Redis key compatibility
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build Redis key for a JTI
   */
  private buildKey(jtiHash: string): string {
    return `${JTI_KEY_PREFIX}:${jtiHash}`;
  }

  /**
   * Store a JTI with expiration, returning false if it already exists
   * Uses SETNX for atomic check-and-set
   */
  async store(jti: string, expiresAt: Date): Promise<void> {
    try {
      const redis = await this.getRedis();
      const jtiHash = await this.hashJti(jti);
      const key = this.buildKey(jtiHash);
      const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      const timestamp = Date.now();

      // Use pipeline for atomic operations
      const pipeline = redis.pipeline();

      // Store JTI with TTL using SETNX (only sets if not exists)
      // We use SET with NX and EX options for atomic operation
      pipeline.set(key, timestamp.toString(), 'EX', ttlSeconds, 'NX');

      // Add to sorted set for bounded size tracking (score = timestamp for eviction)
      pipeline.zadd(JTI_INDEX_KEY, timestamp, jtiHash);

      await pipeline.exec();

      // Check and enforce size limit
      await this.enforceSizeLimit();

      // Update metrics
      if (this.inFallbackMode) {
        this.inFallbackMode = false;
        jtiCacheFallbackActive.set(0);
        logger.info('Redis JTI cache recovered from fallback mode');
      }
    } catch (error) {
      jtiCacheRedisFailures.inc({ operation: 'store' });
      logger.warn({ error, jti: jti.substring(0, 8) + '...' }, 'Redis JTI store failed, using fallback');

      if (this.config.enableFallback) {
        if (!this.inFallbackMode) {
          this.inFallbackMode = true;
          jtiCacheFallbackActive.set(1);
          logger.warn('JTI cache entering fallback mode (in-memory)');
        }
        await this.fallbackCache.store(jti, expiresAt);
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if a JTI exists (has been seen before)
   * Uses SETNX semantics: if we can't set it, it exists
   */
  async exists(jti: string): Promise<boolean> {
    try {
      const redis = await this.getRedis();
      const jtiHash = await this.hashJti(jti);
      const key = this.buildKey(jtiHash);

      const exists = await redis.exists(key);

      if (exists) {
        jtiCacheHits.inc();
        return true;
      }

      jtiCacheMisses.inc();

      // Update metrics - recover from fallback if needed
      if (this.inFallbackMode) {
        this.inFallbackMode = false;
        jtiCacheFallbackActive.set(0);
        logger.info('Redis JTI cache recovered from fallback mode');
      }

      return false;
    } catch (error) {
      jtiCacheRedisFailures.inc({ operation: 'exists' });
      logger.warn({ error, jti: jti.substring(0, 8) + '...' }, 'Redis JTI exists check failed, using fallback');

      if (this.config.enableFallback) {
        if (!this.inFallbackMode) {
          this.inFallbackMode = true;
          jtiCacheFallbackActive.set(1);
          logger.warn('JTI cache entering fallback mode (in-memory)');
        }
        const fallbackExists = await this.fallbackCache.exists(jti);
        if (fallbackExists) {
          jtiCacheHits.inc();
        } else {
          jtiCacheMisses.inc();
        }
        return fallbackExists;
      } else {
        throw error;
      }
    }
  }

  /**
   * Atomically check if JTI exists and store it if not
   * Returns true if JTI was new (not a replay), false if it already existed (replay detected)
   */
  async checkAndStore(jti: string, expiresAt: Date): Promise<boolean> {
    try {
      const redis = await this.getRedis();
      const jtiHash = await this.hashJti(jti);
      const key = this.buildKey(jtiHash);
      const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      const timestamp = Date.now();

      // Use SET with NX (only set if not exists) - returns OK if set, null if already exists
      const result = await redis.set(key, timestamp.toString(), 'EX', ttlSeconds, 'NX');

      if (result === 'OK') {
        // JTI was new, add to index for size tracking
        await redis.zadd(JTI_INDEX_KEY, timestamp, jtiHash);
        await this.enforceSizeLimit();
        jtiCacheMisses.inc();

        if (this.inFallbackMode) {
          this.inFallbackMode = false;
          jtiCacheFallbackActive.set(0);
          logger.info('Redis JTI cache recovered from fallback mode');
        }

        return true; // New JTI, not a replay
      } else {
        jtiCacheHits.inc();
        return false; // JTI already exists, replay detected
      }
    } catch (error) {
      jtiCacheRedisFailures.inc({ operation: 'checkAndStore' });
      logger.warn({ error, jti: jti.substring(0, 8) + '...' }, 'Redis JTI checkAndStore failed, using fallback');

      if (this.config.enableFallback) {
        if (!this.inFallbackMode) {
          this.inFallbackMode = true;
          jtiCacheFallbackActive.set(1);
          logger.warn('JTI cache entering fallback mode (in-memory)');
        }

        // Fallback: check then store (not atomic, but best effort)
        const exists = await this.fallbackCache.exists(jti);
        if (exists) {
          jtiCacheHits.inc();
          return false;
        }
        await this.fallbackCache.store(jti, expiresAt);
        jtiCacheMisses.inc();
        return true;
      } else {
        throw error;
      }
    }
  }

  /**
   * Enforce maximum size limit by removing oldest entries
   */
  private async enforceSizeLimit(): Promise<void> {
    try {
      const redis = await this.getRedis();

      // Get current size of the sorted set
      const size = await redis.zcard(JTI_INDEX_KEY);
      jtiCacheSize.set({ backend: 'redis' }, size);

      if (size > this.config.maxSize) {
        // Remove oldest entries (lowest scores = oldest timestamps)
        const toRemove = size - this.config.maxSize + CLEANUP_BATCH_SIZE; // Remove extra to avoid frequent cleanup
        const oldestEntries = await redis.zrange(JTI_INDEX_KEY, 0, toRemove - 1);

        if (oldestEntries.length > 0) {
          const pipeline = redis.pipeline();

          // Remove JTI keys
          for (const jtiHash of oldestEntries) {
            pipeline.del(this.buildKey(jtiHash));
          }

          // Remove from sorted set
          pipeline.zrem(JTI_INDEX_KEY, ...oldestEntries);

          await pipeline.exec();

          logger.debug(
            { removedCount: oldestEntries.length, newSize: size - oldestEntries.length },
            'Evicted oldest JTIs to enforce size limit'
          );
        }
      }
    } catch (error) {
      jtiCacheRedisFailures.inc({ operation: 'cleanup' });
      logger.warn({ error }, 'Failed to enforce JTI cache size limit');
    }
  }

  /**
   * Clean up expired entries from the sorted set
   * Individual JTI keys auto-expire via TTL, but we need to clean up the index
   */
  private async cleanupExpiredFromIndex(): Promise<void> {
    try {
      const redis = await this.getRedis();

      // Remove entries older than the default TTL from the index
      const cutoffTime = Date.now() - (this.config.defaultTTLSeconds * 1000);
      const removed = await redis.zremrangebyscore(JTI_INDEX_KEY, '-inf', cutoffTime);

      if (removed > 0) {
        logger.debug({ removedCount: removed }, 'Cleaned up expired entries from JTI index');
      }

      // Update size metric
      const size = await redis.zcard(JTI_INDEX_KEY);
      jtiCacheSize.set({ backend: 'redis' }, size);
    } catch (error) {
      jtiCacheRedisFailures.inc({ operation: 'cleanup' });
      logger.warn({ error }, 'Failed to cleanup expired JTIs from index');
    }
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFromIndex().catch((error) => {
        logger.warn({ error }, 'JTI cleanup interval error');
      });
    }, this.config.cleanupIntervalMs);

    // Don't prevent Node.js from exiting
    this.cleanupInterval.unref();
  }

  /**
   * Get current cache statistics
   */
  async getStats(): Promise<{
    redisSize: number;
    fallbackSize: number;
    inFallbackMode: boolean;
    redisHealthy: boolean;
  }> {
    let redisSize = 0;
    let redisHealthy = false;

    try {
      const health = await checkRedisHealth();
      redisHealthy = health.healthy;

      if (redisHealthy) {
        const redis = await this.getRedis();
        redisSize = await redis.zcard(JTI_INDEX_KEY);
      }
    } catch {
      // Ignore errors for stats
    }

    return {
      redisSize,
      fallbackSize: this.fallbackCache.getSize(),
      inFallbackMode: this.inFallbackMode,
      redisHealthy,
    };
  }

  /**
   * Check if the cache is in fallback mode
   */
  isInFallbackMode(): boolean {
    return this.inFallbackMode;
  }

  /**
   * Destroy the cache and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.fallbackCache.destroy();
    this.redis = null;
    this.inFallbackMode = false;

    jtiCacheSize.set({ backend: 'redis' }, 0);
    jtiCacheFallbackActive.set(0);

    logger.info('Redis JTI cache destroyed');
  }
}

/**
 * Create a Redis-backed JTI cache
 */
export function createRedisJTICache(config?: RedisJTICacheConfig): RedisJTICache {
  return new RedisJTICache(config);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a random JTI (JWT ID)
 */
function generateJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Calculate JWK thumbprint per RFC 7638
 */
async function calculateJwkThumbprint(jwk: JsonWebKey): Promise<string> {
  // For EC keys, use required members: crv, kty, x, y
  const canonicalJwk: Record<string, unknown> = {
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  };

  // Sort keys lexicographically and create canonical JSON
  const sortedKeys = Object.keys(canonicalJwk).sort();
  const canonical = '{' + sortedKeys.map((k) => `"${k}":"${canonicalJwk[k]}"`).join(',') + '}';

  // SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Base64url encode
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Calculate access token hash (ath claim)
 */
async function calculateAccessTokenHash(accessToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(accessToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64url encode
 */
function base64urlEncode(data: string | ArrayBuffer): string {
  let binary: string;
  if (typeof data === 'string') {
    binary = data;
  } else {
    const bytes = new Uint8Array(data);
    binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64url decode
 */
function base64urlDecode(str: string): string {
  // Add padding
  const padding = (4 - (str.length % 4)) % 4;
  const padded = str + '='.repeat(padding);
  // Replace URL-safe chars
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

/**
 * Get algorithm name for Web Crypto
 */
function getAlgorithmParams(alg: string): EcdsaParams {
  switch (alg) {
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' };
    case 'ES384':
      return { name: 'ECDSA', hash: 'SHA-384' };
    case 'ES512':
      return { name: 'ECDSA', hash: 'SHA-512' };
    default:
      throw new DPoPError(`Unsupported algorithm: ${alg}`);
  }
}

/**
 * Get curve name for algorithm
 */
function getCurveForAlg(alg: string): string {
  switch (alg) {
    case 'ES256':
      return 'P-256';
    case 'ES384':
      return 'P-384';
    case 'ES512':
      return 'P-521';
    default:
      throw new DPoPError(`Unsupported algorithm: ${alg}`);
  }
}

// =============================================================================
// DPoP Service
// =============================================================================

/**
 * DPoP Service for generating and verifying DPoP proofs
 *
 * @example
 * ```typescript
 * const dpop = new DPoPService({
 *   requiredForTiers: [TrustTier.T2, TrustTier.T3, TrustTier.T4, TrustTier.T5],
 *   maxProofAge: 60,
 *   nonceRequired: false,
 *   clockSkewTolerance: 5,
 *   allowedAlgorithms: ['ES256'],
 * });
 *
 * // Generate a proof
 * const proof = await dpop.generateProof(privateKey, 'POST', 'https://api.example.com/token');
 *
 * // Verify a proof
 * const result = await dpop.verifyProof(proof, publicKey, 'POST', 'https://api.example.com/token');
 * ```
 */
export class DPoPService {
  private config: DPoPConfig;
  private jtiCache: JTICache;

  /**
   * Create a new DPoP service
   *
   * @param config - DPoP configuration
   * @param jtiCache - JTI cache for replay prevention (defaults to in-memory)
   */
  constructor(config: Partial<DPoPConfig>, jtiCache?: JTICache) {
    const defaultConfig: DPoPConfig = {
      requiredForTiers: [2, 3, 4, 5],
      maxProofAge: 60,
      nonceRequired: false,
      clockSkewTolerance: 5,
      allowedAlgorithms: ['ES256'],
    };
    this.config = { ...defaultConfig, ...dpopConfigSchema.parse(config) };
    this.jtiCache = jtiCache ?? new InMemoryJTICache();

    logger.info(
      {
        requiredForTiers: this.config.requiredForTiers,
        maxProofAge: this.config.maxProofAge,
        allowedAlgorithms: this.config.allowedAlgorithms,
      },
      'DPoP service initialized'
    );
  }

  /**
   * Generate a DPoP proof JWT
   *
   * @param privateKey - ECDSA private key for signing
   * @param method - HTTP method (e.g., 'GET', 'POST')
   * @param uri - Target URI
   * @param accessTokenHash - SHA-256 hash of access token (for bound tokens)
   * @param algorithm - Signing algorithm (default: ES256)
   * @returns Signed DPoP proof JWT
   */
  async generateProof(
    privateKey: CryptoKey,
    method: string,
    uri: string,
    accessTokenHash?: string,
    algorithm: 'ES256' | 'ES384' | 'ES512' = 'ES256'
  ): Promise<string> {
    // Export public key for JWK header
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', privateKey);
    // Remove private key component for the header
    delete publicKeyJwk.d;
    // Fix key_ops to indicate verify only (since we removed the private component)
    publicKeyJwk.key_ops = ['verify'];

    // Create header
    const header = {
      typ: 'dpop+jwt',
      alg: algorithm,
      jwk: publicKeyJwk,
    };

    // Create payload
    const payload: DPoPProof = {
      jti: generateJti(),
      htm: method.toUpperCase(),
      htu: uri,
      iat: Math.floor(Date.now() / 1000),
    };

    if (accessTokenHash) {
      payload.ath = accessTokenHash;
    }

    // Encode header and payload
    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedPayload = base64urlEncode(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    // Sign
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      getAlgorithmParams(algorithm),
      privateKey,
      encoder.encode(dataToSign)
    );

    const encodedSignature = base64urlEncode(signature);

    dpopProofsGenerated.inc();
    logger.debug({ method, uri, jti: payload.jti }, 'DPoP proof generated');

    return `${dataToSign}.${encodedSignature}`;
  }

  /**
   * Verify a DPoP proof JWT
   *
   * @param proof - DPoP proof JWT string
   * @param expectedMethod - Expected HTTP method
   * @param expectedUri - Expected target URI
   * @param expectedAth - Expected access token hash (for bound tokens)
   * @returns Verification result
   */
  async verifyProof(
    proof: string,
    expectedMethod: string,
    expectedUri: string,
    expectedAth?: string
  ): Promise<DPoPVerificationResult> {
    const startTime = Date.now();

    try {
      // Split JWT
      const parts = proof.split('.');
      if (parts.length !== 3) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Invalid DPoP proof format',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header
      let header: { typ?: string; alg?: string; jwk?: JsonWebKey };
      try {
        header = JSON.parse(base64urlDecode(headerB64!));
      } catch {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Invalid header encoding',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Validate header
      if (header.typ !== 'dpop+jwt') {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Invalid typ claim, expected dpop+jwt',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (!header.alg || !this.config.allowedAlgorithms.includes(header.alg as 'ES256' | 'ES384' | 'ES512')) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: `Unsupported algorithm: ${header.alg}`,
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (!header.jwk) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Missing jwk in header',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Decode payload
      let payload: DPoPProof;
      try {
        payload = JSON.parse(base64urlDecode(payloadB64!));
        dpopProofSchema.parse(payload);
      } catch {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Invalid payload',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check JTI replay - use atomic checkAndStore if available (Redis cache)
      // This prevents race conditions where two requests with the same JTI
      // could both pass the exists check before either stores the JTI
      const expiresAt = new Date((payload.iat + this.config.maxProofAge) * 1000);

      if ('checkAndStore' in this.jtiCache && typeof this.jtiCache.checkAndStore === 'function') {
        // Atomic check-and-store for Redis cache
        const isNewJti = await (this.jtiCache as RedisJTICache).checkAndStore(payload.jti, expiresAt);
        if (!isNewJti) {
          dpopVerifications.inc({ result: 'replay' });
          logger.warn({ jti: payload.jti }, 'DPoP proof replay detected');
          return {
            valid: false,
            error: 'DPoP proof replay detected',
            errorCode: 'REPLAY',
            verifiedAt: new Date().toISOString(),
          };
        }
        // JTI was atomically stored, continue with verification
      } else {
        // Fallback for non-Redis cache: check then store (not atomic)
        const jtiExists = await this.jtiCache.exists(payload.jti);
        if (jtiExists) {
          dpopVerifications.inc({ result: 'replay' });
          logger.warn({ jti: payload.jti }, 'DPoP proof replay detected');
          return {
            valid: false,
            error: 'DPoP proof replay detected',
            errorCode: 'REPLAY',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      const age = now - payload.iat;
      if (age > this.config.maxProofAge + this.config.clockSkewTolerance) {
        dpopVerifications.inc({ result: 'expired' });
        return {
          valid: false,
          error: `DPoP proof expired (age: ${age}s, max: ${this.config.maxProofAge}s)`,
          errorCode: 'EXPIRED',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check future proof (with clock skew tolerance)
      if (payload.iat > now + this.config.clockSkewTolerance) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'DPoP proof issued in the future',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check method
      if (payload.htm.toUpperCase() !== expectedMethod.toUpperCase()) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: `Method mismatch: expected ${expectedMethod}, got ${payload.htm}`,
          errorCode: 'METHOD_MISMATCH',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check URI
      if (payload.htu !== expectedUri) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: `URI mismatch: expected ${expectedUri}, got ${payload.htu}`,
          errorCode: 'URI_MISMATCH',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check access token hash if provided
      if (expectedAth && payload.ath !== expectedAth) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Access token hash mismatch',
          errorCode: 'INVALID_FORMAT',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Import public key
      const curve = getCurveForAlg(header.alg);
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        header.jwk,
        { name: 'ECDSA', namedCurve: curve },
        true,
        ['verify']
      );

      // Verify signature
      const encoder = new TextEncoder();
      const dataToVerify = `${headerB64}.${payloadB64}`;

      // Decode signature
      const signaturePadded = signatureB64 + '='.repeat((4 - (signatureB64!.length % 4)) % 4);
      const signatureBase64 = signaturePadded.replace(/-/g, '+').replace(/_/g, '/');
      const signatureBinary = atob(signatureBase64);
      const signatureBytes = new Uint8Array(signatureBinary.length);
      for (let i = 0; i < signatureBinary.length; i++) {
        signatureBytes[i] = signatureBinary.charCodeAt(i);
      }

      const valid = await crypto.subtle.verify(
        getAlgorithmParams(header.alg),
        publicKey,
        signatureBytes,
        encoder.encode(dataToVerify)
      );

      if (!valid) {
        dpopVerifications.inc({ result: 'invalid' });
        return {
          valid: false,
          error: 'Invalid signature',
          errorCode: 'INVALID_SIGNATURE',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Store JTI to prevent replay (only if we didn't use atomic checkAndStore)
      // If we used the atomic path, the JTI was already stored during the check
      if (!('checkAndStore' in this.jtiCache && typeof this.jtiCache.checkAndStore === 'function')) {
        await this.jtiCache.store(payload.jti, expiresAt);
      }

      // Calculate key thumbprint
      const keyThumbprint = await calculateJwkThumbprint(header.jwk);

      dpopVerifications.inc({ result: 'success' });
      logger.debug({ jti: payload.jti, keyThumbprint }, 'DPoP proof verified');

      return {
        valid: true,
        keyThumbprint,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      dpopVerificationDuration.observe(duration);
    }
  }

  /**
   * Check if DPoP is required for a given trust tier
   *
   * @param trustTier - Trust tier to check
   * @returns Whether DPoP is required
   */
  isRequired(trustTier: TrustTier): boolean {
    return this.config.requiredForTiers.includes(trustTier);
  }

  /**
   * Validate that an access token is properly bound to a DPoP key
   *
   * @param accessToken - The access token
   * @param dpopProof - The DPoP proof
   * @param expectedMethod - Expected HTTP method
   * @param expectedUri - Expected target URI
   * @param tokenCnf - The cnf claim from the access token (containing jkt)
   * @returns Whether the token is properly bound
   */
  async validateBoundToken(
    accessToken: string,
    dpopProof: string,
    expectedMethod: string,
    expectedUri: string,
    tokenCnf?: { jkt?: string }
  ): Promise<boolean> {
    // First verify the proof
    const expectedAth = await calculateAccessTokenHash(accessToken);
    const result = await this.verifyProof(dpopProof, expectedMethod, expectedUri, expectedAth);

    if (!result.valid) {
      logger.debug({ error: result.error }, 'DPoP proof verification failed');
      return false;
    }

    // If token has cnf.jkt, verify it matches the proof key
    if (tokenCnf?.jkt) {
      if (result.keyThumbprint !== tokenCnf.jkt) {
        logger.warn(
          { expected: tokenCnf.jkt, actual: result.keyThumbprint },
          'DPoP key thumbprint mismatch'
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Generate an access token hash for the ath claim
   *
   * @param accessToken - Access token to hash
   * @returns Base64url-encoded SHA-256 hash
   */
  async generateAccessTokenHash(accessToken: string): Promise<string> {
    return calculateAccessTokenHash(accessToken);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<DPoPConfig> {
    return { ...this.config };
  }

  /**
   * Get JTI cache statistics
   * Returns information about cache state including Redis/fallback status
   */
  async getJTICacheStats(): Promise<{
    redisSize?: number;
    fallbackSize?: number;
    inFallbackMode?: boolean;
    redisHealthy?: boolean;
    cacheType: 'redis' | 'memory';
  }> {
    if (this.jtiCache instanceof RedisJTICache) {
      const stats = await this.jtiCache.getStats();
      return {
        ...stats,
        cacheType: 'redis',
      };
    }

    // For in-memory cache, return basic info
    return {
      cacheType: 'memory',
      inFallbackMode: false,
    };
  }

  /**
   * Check if the JTI cache is in fallback mode (using in-memory instead of Redis)
   */
  isJTICacheInFallbackMode(): boolean {
    if (this.jtiCache instanceof RedisJTICache) {
      return this.jtiCache.isInFallbackMode();
    }
    return false;
  }

  /**
   * Destroy the service and cleanup resources.
   * This stops the JTI cache cleanup interval.
   */
  destroy(): void {
    // Check if the cache has a destroy method (InMemoryJTICache does)
    if ('destroy' in this.jtiCache && typeof this.jtiCache.destroy === 'function') {
      (this.jtiCache as { destroy: () => void }).destroy();
    }
    logger.info('DPoP service destroyed');
  }
}

/**
 * Options for creating a DPoP service
 */
export interface CreateDPoPServiceOptions {
  /** DPoP configuration */
  config?: Partial<DPoPConfig>;
  /** Custom JTI cache (if not provided, uses Redis-backed cache) */
  jtiCache?: JTICache;
  /** Redis JTI cache configuration (only used if jtiCache is not provided) */
  redisJTICacheConfig?: RedisJTICacheConfig;
  /** Use in-memory cache instead of Redis (for testing/development) */
  useInMemoryCache?: boolean;
}

/**
 * Create a DPoP service with default configuration for CAR ID
 *
 * By default, uses a Redis-backed JTI cache for scalability across multiple instances.
 * Set `useInMemoryCache: true` for development/testing with single instance.
 *
 * @example
 * ```typescript
 * // Production: Redis-backed cache (default)
 * const dpop = createDPoPService();
 *
 * // Development: In-memory cache
 * const dpop = createDPoPService({ useInMemoryCache: true });
 *
 * // Custom Redis cache configuration
 * const dpop = createDPoPService({
 *   redisJTICacheConfig: { maxSize: 50000, defaultTTLSeconds: 120 }
 * });
 * ```
 */
export function createDPoPService(
  options?: CreateDPoPServiceOptions | Partial<DPoPConfig>,
  jtiCache?: JTICache
): DPoPService {
  // Support legacy signature: createDPoPService(config, jtiCache)
  let config: Partial<DPoPConfig> | undefined;
  let cache: JTICache | undefined = jtiCache;
  let redisConfig: RedisJTICacheConfig | undefined;
  let useInMemory = false;

  if (options && ('config' in options || 'jtiCache' in options || 'redisJTICacheConfig' in options || 'useInMemoryCache' in options)) {
    // New options object signature
    const opts = options as CreateDPoPServiceOptions;
    config = opts.config;
    cache = opts.jtiCache;
    redisConfig = opts.redisJTICacheConfig;
    useInMemory = opts.useInMemoryCache ?? false;
  } else {
    // Legacy signature: first arg is config
    config = options as Partial<DPoPConfig> | undefined;
  }

  const defaultConfig: Partial<DPoPConfig> = {
    requiredForTiers: [2, 3, 4, 5], // T2+
    maxProofAge: 60,
    nonceRequired: false,
    clockSkewTolerance: 5,
    allowedAlgorithms: ['ES256'],
  };

  // Create JTI cache if not provided
  if (!cache) {
    if (useInMemory) {
      logger.info('Creating DPoP service with in-memory JTI cache (development mode)');
      // Will use default InMemoryJTICache in DPoPService constructor
    } else {
      // Create Redis-backed cache for production scalability
      cache = createRedisJTICache(redisConfig);
      logger.info('Creating DPoP service with Redis-backed JTI cache');
    }
  }

  return new DPoPService({ ...defaultConfig, ...config }, cache);
}
