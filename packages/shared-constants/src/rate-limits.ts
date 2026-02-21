/**
 * @vorionsys/shared-constants - Rate Limits
 *
 * Rate limits by trust tier - used across all APIs
 * Higher trust = higher limits
 *
 * @see https://cognigate.dev/docs/rate-limits
 */

import { TrustTier } from './tiers.js';

// =============================================================================
// RATE LIMIT DEFINITIONS
// =============================================================================

export interface RateLimitConfig {
  /** Requests per second */
  requestsPerSecond: number;

  /** Requests per minute */
  requestsPerMinute: number;

  /** Requests per hour */
  requestsPerHour: number;

  /** Requests per day */
  requestsPerDay: number;

  /** Burst limit (max concurrent) */
  burstLimit: number;

  /** Max payload size in bytes */
  maxPayloadBytes: number;

  /** Max response size in bytes */
  maxResponseBytes: number;

  /** Connection timeout in ms */
  connectionTimeoutMs: number;

  /** Request timeout in ms */
  requestTimeoutMs: number;
}

// =============================================================================
// RATE LIMITS BY TIER
// =============================================================================

export const RATE_LIMITS: Record<TrustTier, RateLimitConfig> = {
  [TrustTier.T0_SANDBOX]: {
    requestsPerSecond: 1,
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 500,
    burstLimit: 2,
    maxPayloadBytes: 1024 * 10,        // 10 KB
    maxResponseBytes: 1024 * 100,      // 100 KB
    connectionTimeoutMs: 5000,
    requestTimeoutMs: 10000,
  },

  [TrustTier.T1_OBSERVED]: {
    requestsPerSecond: 2,
    requestsPerMinute: 30,
    requestsPerHour: 500,
    requestsPerDay: 2000,
    burstLimit: 5,
    maxPayloadBytes: 1024 * 50,        // 50 KB
    maxResponseBytes: 1024 * 500,      // 500 KB
    connectionTimeoutMs: 5000,
    requestTimeoutMs: 15000,
  },

  [TrustTier.T2_PROVISIONAL]: {
    requestsPerSecond: 5,
    requestsPerMinute: 100,
    requestsPerHour: 2000,
    requestsPerDay: 10000,
    burstLimit: 10,
    maxPayloadBytes: 1024 * 100,       // 100 KB
    maxResponseBytes: 1024 * 1024,     // 1 MB
    connectionTimeoutMs: 10000,
    requestTimeoutMs: 30000,
  },

  [TrustTier.T3_MONITORED]: {
    requestsPerSecond: 10,
    requestsPerMinute: 300,
    requestsPerHour: 5000,
    requestsPerDay: 50000,
    burstLimit: 20,
    maxPayloadBytes: 1024 * 500,       // 500 KB
    maxResponseBytes: 1024 * 1024 * 5, // 5 MB
    connectionTimeoutMs: 10000,
    requestTimeoutMs: 60000,
  },

  [TrustTier.T4_STANDARD]: {
    requestsPerSecond: 20,
    requestsPerMinute: 600,
    requestsPerHour: 10000,
    requestsPerDay: 100000,
    burstLimit: 50,
    maxPayloadBytes: 1024 * 1024,      // 1 MB
    maxResponseBytes: 1024 * 1024 * 10, // 10 MB
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 120000,
  },

  [TrustTier.T5_TRUSTED]: {
    requestsPerSecond: 50,
    requestsPerMinute: 1500,
    requestsPerHour: 30000,
    requestsPerDay: 300000,
    burstLimit: 100,
    maxPayloadBytes: 1024 * 1024 * 5,  // 5 MB
    maxResponseBytes: 1024 * 1024 * 50, // 50 MB
    connectionTimeoutMs: 30000,
    requestTimeoutMs: 300000,
  },

  [TrustTier.T6_CERTIFIED]: {
    requestsPerSecond: 100,
    requestsPerMinute: 3000,
    requestsPerHour: 100000,
    requestsPerDay: 1000000,
    burstLimit: 200,
    maxPayloadBytes: 1024 * 1024 * 10, // 10 MB
    maxResponseBytes: 1024 * 1024 * 100, // 100 MB
    connectionTimeoutMs: 60000,
    requestTimeoutMs: 600000,
  },

  [TrustTier.T7_AUTONOMOUS]: {
    requestsPerSecond: 500,
    requestsPerMinute: 10000,
    requestsPerHour: 500000,
    requestsPerDay: 5000000,
    burstLimit: 500,
    maxPayloadBytes: 1024 * 1024 * 50, // 50 MB
    maxResponseBytes: 1024 * 1024 * 500, // 500 MB
    connectionTimeoutMs: 120000,
    requestTimeoutMs: 1200000,
  },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get rate limits for a trust tier
 */
export function getRateLimits(tier: TrustTier): RateLimitConfig {
  return RATE_LIMITS[tier];
}

/**
 * Get the minimum tier required for specific rate limits
 */
export function getMinTierForLimits(config: {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
}): TrustTier {
  const tiers = Object.values(TrustTier).filter(t => typeof t === 'number') as TrustTier[];

  for (const tier of tiers) {
    const limits = RATE_LIMITS[tier];
    if (
      (config.requestsPerSecond === undefined || limits.requestsPerSecond >= config.requestsPerSecond) &&
      (config.requestsPerMinute === undefined || limits.requestsPerMinute >= config.requestsPerMinute) &&
      (config.requestsPerHour === undefined || limits.requestsPerHour >= config.requestsPerHour) &&
      (config.requestsPerDay === undefined || limits.requestsPerDay >= config.requestsPerDay)
    ) {
      return tier;
    }
  }

  return TrustTier.T7_AUTONOMOUS;
}

/**
 * Check if a rate limit would be exceeded
 */
export function wouldExceedLimit(
  tier: TrustTier,
  window: 'second' | 'minute' | 'hour' | 'day',
  currentCount: number,
): boolean {
  const limits = RATE_LIMITS[tier];
  switch (window) {
    case 'second':
      return currentCount >= limits.requestsPerSecond;
    case 'minute':
      return currentCount >= limits.requestsPerMinute;
    case 'hour':
      return currentCount >= limits.requestsPerHour;
    case 'day':
      return currentCount >= limits.requestsPerDay;
  }
}

/**
 * Format rate limit for display
 */
export function formatRateLimit(tier: TrustTier): string {
  const limits = RATE_LIMITS[tier];
  return `${limits.requestsPerSecond}/s, ${limits.requestsPerMinute}/min, ${limits.requestsPerHour}/hr`;
}

// =============================================================================
// QUOTA DEFINITIONS (for billing/usage)
// =============================================================================

export interface QuotaConfig {
  /** Monthly API calls included */
  monthlyApiCalls: number;

  /** Monthly compute units included */
  monthlyComputeUnits: number;

  /** Monthly storage (bytes) */
  monthlyStorageBytes: number;

  /** Monthly bandwidth (bytes) */
  monthlyBandwidthBytes: number;

  /** Max agents allowed */
  maxAgents: number;

  /** Max webhooks */
  maxWebhooks: number;

  /** Max team members */
  maxTeamMembers: number;
}

export const TIER_QUOTAS: Record<TrustTier, QuotaConfig> = {
  [TrustTier.T0_SANDBOX]: {
    monthlyApiCalls: 1000,
    monthlyComputeUnits: 100,
    monthlyStorageBytes: 1024 * 1024 * 10,      // 10 MB
    monthlyBandwidthBytes: 1024 * 1024 * 100,   // 100 MB
    maxAgents: 1,
    maxWebhooks: 1,
    maxTeamMembers: 1,
  },

  [TrustTier.T1_OBSERVED]: {
    monthlyApiCalls: 10000,
    monthlyComputeUnits: 1000,
    monthlyStorageBytes: 1024 * 1024 * 100,     // 100 MB
    monthlyBandwidthBytes: 1024 * 1024 * 1024,  // 1 GB
    maxAgents: 5,
    maxWebhooks: 5,
    maxTeamMembers: 3,
  },

  [TrustTier.T2_PROVISIONAL]: {
    monthlyApiCalls: 50000,
    monthlyComputeUnits: 5000,
    monthlyStorageBytes: 1024 * 1024 * 500,     // 500 MB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 5, // 5 GB
    maxAgents: 10,
    maxWebhooks: 10,
    maxTeamMembers: 5,
  },

  [TrustTier.T3_MONITORED]: {
    monthlyApiCalls: 250000,
    monthlyComputeUnits: 25000,
    monthlyStorageBytes: 1024 * 1024 * 1024 * 2, // 2 GB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 25, // 25 GB
    maxAgents: 50,
    maxWebhooks: 25,
    maxTeamMembers: 10,
  },

  [TrustTier.T4_STANDARD]: {
    monthlyApiCalls: 1000000,
    monthlyComputeUnits: 100000,
    monthlyStorageBytes: 1024 * 1024 * 1024 * 10, // 10 GB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 100, // 100 GB
    maxAgents: 200,
    maxWebhooks: 50,
    maxTeamMembers: 25,
  },

  [TrustTier.T5_TRUSTED]: {
    monthlyApiCalls: 5000000,
    monthlyComputeUnits: 500000,
    monthlyStorageBytes: 1024 * 1024 * 1024 * 50, // 50 GB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 500, // 500 GB
    maxAgents: 1000,
    maxWebhooks: 100,
    maxTeamMembers: 50,
  },

  [TrustTier.T6_CERTIFIED]: {
    monthlyApiCalls: 25000000,
    monthlyComputeUnits: 2500000,
    monthlyStorageBytes: 1024 * 1024 * 1024 * 250, // 250 GB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 2500, // 2.5 TB
    maxAgents: 5000,
    maxWebhooks: 250,
    maxTeamMembers: 100,
  },

  [TrustTier.T7_AUTONOMOUS]: {
    monthlyApiCalls: -1, // Unlimited
    monthlyComputeUnits: -1, // Unlimited
    monthlyStorageBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
    monthlyBandwidthBytes: 1024 * 1024 * 1024 * 10000, // 10 TB
    maxAgents: -1, // Unlimited
    maxWebhooks: -1, // Unlimited
    maxTeamMembers: -1, // Unlimited
  },
} as const;

/**
 * Get quota for a tier
 */
export function getQuota(tier: TrustTier): QuotaConfig {
  return TIER_QUOTAS[tier];
}

/**
 * Check if quota is unlimited (-1)
 */
export function isUnlimited(value: number): boolean {
  return value === -1;
}
