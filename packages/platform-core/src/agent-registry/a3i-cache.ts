/**
 * A3I Cache Layer
 *
 * Fast data layer (Agent Anchor AI) for caching trust scores, agent data,
 * and batching attestations for sync to the primary database.
 *
 * @packageDocumentation
 */

import { createLogger } from "../common/logger.js";
import { getRedis } from "../common/redis.js";

import type { Agent, Attestation } from "@vorionsys/contracts/db";
import type { Redis } from "ioredis";

const logger = createLogger({ component: "a3i-cache" });

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache key prefixes
 */
const CACHE_KEYS = {
  AGENT: "a3i:agent:",
  TRUST_SCORE: "a3i:trust:",
  ATTESTATION_QUEUE: "a3i:attestations:queue",
  SYNC_STATUS: "a3i:sync:status",
} as const;

/**
 * Default TTLs in seconds
 */
const DEFAULT_TTL = {
  AGENT: 300, // 5 minutes
  TRUST_SCORE: 5, // 5 seconds (critical data)
  SYNC_STATUS: 60, // 1 minute
} as const;

/**
 * Batch configuration
 */
const BATCH_CONFIG = {
  MAX_SIZE: 100, // Max attestations per batch
  FLUSH_INTERVAL_MS: 5000, // Flush every 5 seconds
} as const;

// ============================================================================
// Types
// ============================================================================

export interface CachedTrustScore {
  score: number;
  tier: number;
  cachedAt: number;
  stale: boolean;
}

export interface CachedAgent {
  agent: Agent;
  cachedAt: number;
}

export interface A3ISyncStatus {
  lastSyncAt: number;
  pendingAttestations: number;
  syncLagMs: number;
  healthy: boolean;
}

export interface A3ICacheConfig {
  agentTtl?: number;
  trustScoreTtl?: number;
  batchSize?: number;
  flushIntervalMs?: number;
}

// ============================================================================
// A3I Cache Service
// ============================================================================

export class A3ICacheService {
  private redis: Redis;
  private config: Required<A3ICacheConfig>;
  private flushTimer: NodeJS.Timeout | null = null;
  private attestationBuffer: Array<{
    carId: string;
    attestation: Partial<Attestation>;
  }> = [];

  constructor(config: A3ICacheConfig = {}) {
    this.redis = getRedis();
    this.config = {
      agentTtl: config.agentTtl ?? DEFAULT_TTL.AGENT,
      trustScoreTtl: config.trustScoreTtl ?? DEFAULT_TTL.TRUST_SCORE,
      batchSize: config.batchSize ?? BATCH_CONFIG.MAX_SIZE,
      flushIntervalMs: config.flushIntervalMs ?? BATCH_CONFIG.FLUSH_INTERVAL_MS,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the cache service (begin periodic flush)
   */
  start(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flushAttestations().catch((err) => {
        logger.error({ error: err }, "Failed to flush attestations");
      });
    }, this.config.flushIntervalMs);

    logger.info("A3I cache service started");
  }

  /**
   * Stop the cache service
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining attestations
    await this.flushAttestations();

    logger.info("A3I cache service stopped");
  }

  // ==========================================================================
  // Agent Caching
  // ==========================================================================

  /**
   * Cache an agent
   */
  async cacheAgent(agent: Agent): Promise<void> {
    const key = CACHE_KEYS.AGENT + agent.carId;
    const data: CachedAgent = {
      agent,
      cachedAt: Date.now(),
    };

    await this.redis.setex(key, this.config.agentTtl, JSON.stringify(data));
    logger.debug({ carId: agent.carId }, "Agent cached");
  }

  /**
   * Get cached agent
   */
  async getCachedAgent(carId: string): Promise<CachedAgent | null> {
    const key = CACHE_KEYS.AGENT + carId;
    const data = await this.redis.get(key);

    if (!data) return null;

    try {
      return JSON.parse(data) as CachedAgent;
    } catch {
      return null;
    }
  }

  /**
   * Invalidate agent cache
   */
  async invalidateAgent(carId: string): Promise<void> {
    const key = CACHE_KEYS.AGENT + carId;
    await this.redis.del(key);
    logger.debug({ carId }, "Agent cache invalidated");
  }

  // ==========================================================================
  // Trust Score Caching
  // ==========================================================================

  /**
   * Cache a trust score
   */
  async cacheTrustScore(
    carId: string,
    score: number,
    tier: number,
  ): Promise<void> {
    const key = CACHE_KEYS.TRUST_SCORE + carId;
    const data: CachedTrustScore = {
      score,
      tier,
      cachedAt: Date.now(),
      stale: false,
    };

    await this.redis.setex(
      key,
      this.config.trustScoreTtl,
      JSON.stringify(data),
    );
    logger.debug({ carId, score, tier }, "Trust score cached");
  }

  /**
   * Get cached trust score
   */
  async getCachedTrustScore(carId: string): Promise<CachedTrustScore | null> {
    const key = CACHE_KEYS.TRUST_SCORE + carId;
    const data = await this.redis.get(key);

    if (!data) return null;

    try {
      const cached = JSON.parse(data) as CachedTrustScore;

      // Mark as stale if approaching TTL
      const ageMs = Date.now() - cached.cachedAt;
      if (ageMs > this.config.trustScoreTtl * 1000 * 0.8) {
        cached.stale = true;
      }

      return cached;
    } catch {
      return null;
    }
  }

  /**
   * Get trust score with cache (returns cached if available, otherwise null)
   */
  async getTrustScoreFast(
    carId: string,
  ): Promise<{
    score: number;
    tier: number;
    cached: boolean;
    cacheAge?: number;
  } | null> {
    const cached = await this.getCachedTrustScore(carId);

    if (cached) {
      return {
        score: cached.score,
        tier: cached.tier,
        cached: true,
        cacheAge: Date.now() - cached.cachedAt,
      };
    }

    return null;
  }

  /**
   * Invalidate trust score cache
   */
  async invalidateTrustScore(carId: string): Promise<void> {
    const key = CACHE_KEYS.TRUST_SCORE + carId;
    await this.redis.del(key);
  }

  // ==========================================================================
  // Attestation Batching
  // ==========================================================================

  /**
   * Queue an attestation for batch processing
   */
  async queueAttestation(
    carId: string,
    attestation: Partial<Attestation>,
  ): Promise<void> {
    this.attestationBuffer.push({ carId, attestation });

    // Flush if buffer is full
    if (this.attestationBuffer.length >= this.config.batchSize) {
      await this.flushAttestations();
    }

    // Also add to Redis for durability
    await this.redis.rpush(
      CACHE_KEYS.ATTESTATION_QUEUE,
      JSON.stringify({ carId, attestation, queuedAt: Date.now() }),
    );
  }

  /**
   * Flush attestation buffer to primary storage
   *
   * This is a placeholder - actual implementation would call the
   * AgentRegistryService to process attestations
   */
  async flushAttestations(): Promise<number> {
    if (this.attestationBuffer.length === 0) {
      return 0;
    }

    const batch = [...this.attestationBuffer];
    this.attestationBuffer = [];

    logger.info({ count: batch.length }, "Flushing attestation batch");

    // In production, this would:
    // 1. Call AgentRegistryService.submitAttestation for each
    // 2. Update sync status
    // 3. Clear from Redis queue

    // For now, just clear the Redis queue
    await this.redis.ltrim(CACHE_KEYS.ATTESTATION_QUEUE, batch.length, -1);

    return batch.length;
  }

  /**
   * Get pending attestation count
   */
  async getPendingAttestationCount(): Promise<number> {
    return this.redis.llen(CACHE_KEYS.ATTESTATION_QUEUE);
  }

  // ==========================================================================
  // Sync Status
  // ==========================================================================

  /**
   * Update sync status
   */
  async updateSyncStatus(status: Partial<A3ISyncStatus>): Promise<void> {
    const current = await this.getSyncStatus();
    const updated: A3ISyncStatus = {
      lastSyncAt: status.lastSyncAt ?? current?.lastSyncAt ?? Date.now(),
      pendingAttestations:
        status.pendingAttestations ?? (await this.getPendingAttestationCount()),
      syncLagMs: status.syncLagMs ?? 0,
      healthy: status.healthy ?? true,
    };

    await this.redis.setex(
      CACHE_KEYS.SYNC_STATUS,
      DEFAULT_TTL.SYNC_STATUS,
      JSON.stringify(updated),
    );
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<A3ISyncStatus | null> {
    const data = await this.redis.get(CACHE_KEYS.SYNC_STATUS);

    if (!data) return null;

    try {
      return JSON.parse(data) as A3ISyncStatus;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Check cache health
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    details: Record<string, unknown>;
  }> {
    const start = Date.now();

    try {
      // Test Redis connectivity
      await this.redis.ping();

      const latencyMs = Date.now() - start;
      const syncStatus = await this.getSyncStatus();
      const pendingCount = await this.getPendingAttestationCount();

      return {
        healthy: true,
        latencyMs,
        details: {
          syncStatus,
          pendingAttestations: pendingCount,
          bufferSize: this.attestationBuffer.length,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: A3ICacheService | null = null;

export function createA3ICacheService(
  config?: A3ICacheConfig,
): A3ICacheService {
  if (!instance) {
    instance = new A3ICacheService(config);
  }
  return instance;
}

export function getA3ICacheService(): A3ICacheService {
  if (!instance) {
    throw new Error("A3ICacheService not initialized");
  }
  return instance;
}
