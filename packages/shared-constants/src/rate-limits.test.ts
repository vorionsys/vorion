import { describe, it, expect } from 'vitest';
import { TrustTier, ALL_TIERS } from './tiers.js';
import {
  RATE_LIMITS,
  getRateLimits,
  getMinTierForLimits,
  wouldExceedLimit,
  formatRateLimit,
  TIER_QUOTAS,
  getQuota,
  isUnlimited,
} from './rate-limits.js';

describe('RATE_LIMITS', () => {
  it('has limits for every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(RATE_LIMITS[tier]).toBeDefined();
    }
  });

  it('higher tiers have higher or equal requestsPerSecond', () => {
    for (let i = 1; i < ALL_TIERS.length; i++) {
      expect(RATE_LIMITS[ALL_TIERS[i]].requestsPerSecond)
        .toBeGreaterThanOrEqual(RATE_LIMITS[ALL_TIERS[i - 1]].requestsPerSecond);
    }
  });

  it('higher tiers have higher or equal requestsPerDay', () => {
    for (let i = 1; i < ALL_TIERS.length; i++) {
      expect(RATE_LIMITS[ALL_TIERS[i]].requestsPerDay)
        .toBeGreaterThanOrEqual(RATE_LIMITS[ALL_TIERS[i - 1]].requestsPerDay);
    }
  });

  it('higher tiers have higher or equal burstLimit', () => {
    for (let i = 1; i < ALL_TIERS.length; i++) {
      expect(RATE_LIMITS[ALL_TIERS[i]].burstLimit)
        .toBeGreaterThanOrEqual(RATE_LIMITS[ALL_TIERS[i - 1]].burstLimit);
    }
  });

  it('all limits have positive values', () => {
    for (const tier of ALL_TIERS) {
      const limits = RATE_LIMITS[tier];
      expect(limits.requestsPerSecond).toBeGreaterThan(0);
      expect(limits.requestsPerMinute).toBeGreaterThan(0);
      expect(limits.requestsPerHour).toBeGreaterThan(0);
      expect(limits.requestsPerDay).toBeGreaterThan(0);
      expect(limits.burstLimit).toBeGreaterThan(0);
      expect(limits.maxPayloadBytes).toBeGreaterThan(0);
      expect(limits.maxResponseBytes).toBeGreaterThan(0);
      expect(limits.connectionTimeoutMs).toBeGreaterThan(0);
      expect(limits.requestTimeoutMs).toBeGreaterThan(0);
    }
  });

  it('requestsPerMinute > requestsPerSecond for all tiers', () => {
    for (const tier of ALL_TIERS) {
      const limits = RATE_LIMITS[tier];
      expect(limits.requestsPerMinute).toBeGreaterThan(limits.requestsPerSecond);
    }
  });
});

describe('getRateLimits', () => {
  it('returns correct limits for T0', () => {
    const limits = getRateLimits(TrustTier.T0_SANDBOX);
    expect(limits.requestsPerSecond).toBe(1);
    expect(limits.requestsPerMinute).toBe(10);
    expect(limits.burstLimit).toBe(2);
  });

  it('returns correct limits for T7', () => {
    const limits = getRateLimits(TrustTier.T7_AUTONOMOUS);
    expect(limits.requestsPerSecond).toBe(500);
    expect(limits.burstLimit).toBe(500);
  });

  it('returns same object as RATE_LIMITS indexing', () => {
    for (const tier of ALL_TIERS) {
      expect(getRateLimits(tier)).toBe(RATE_LIMITS[tier]);
    }
  });
});

describe('getMinTierForLimits', () => {
  it('returns T0 for minimal requirements', () => {
    expect(getMinTierForLimits({ requestsPerSecond: 1 })).toBe(TrustTier.T0_SANDBOX);
  });

  it('returns higher tier for higher requirements', () => {
    expect(getMinTierForLimits({ requestsPerSecond: 50 })).toBe(TrustTier.T5_TRUSTED);
  });

  it('returns T7 for extreme requirements', () => {
    expect(getMinTierForLimits({ requestsPerSecond: 500 })).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('considers multiple limit types', () => {
    const tier = getMinTierForLimits({
      requestsPerSecond: 5,
      requestsPerDay: 50000,
    });
    expect(tier).toBe(TrustTier.T3_MONITORED);
  });

  it('returns T0 when all limits undefined', () => {
    expect(getMinTierForLimits({})).toBe(TrustTier.T0_SANDBOX);
  });
});

describe('wouldExceedLimit', () => {
  it('returns false when under limit', () => {
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'second', 0)).toBe(false);
  });

  it('returns true when at limit', () => {
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'second', 1)).toBe(true);
  });

  it('returns true when over limit', () => {
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'second', 5)).toBe(true);
  });

  it('checks all window types', () => {
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'minute', 9)).toBe(false);
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'minute', 10)).toBe(true);
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'hour', 99)).toBe(false);
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'hour', 100)).toBe(true);
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'day', 499)).toBe(false);
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'day', 500)).toBe(true);
  });

  it('higher tiers tolerate more requests', () => {
    expect(wouldExceedLimit(TrustTier.T0_SANDBOX, 'second', 2)).toBe(true);
    expect(wouldExceedLimit(TrustTier.T4_STANDARD, 'second', 2)).toBe(false);
  });
});

describe('formatRateLimit', () => {
  it('formats T0 limits', () => {
    expect(formatRateLimit(TrustTier.T0_SANDBOX)).toBe('1/s, 10/min, 100/hr');
  });

  it('formats T7 limits', () => {
    expect(formatRateLimit(TrustTier.T7_AUTONOMOUS)).toBe('500/s, 10000/min, 500000/hr');
  });

  it('returns a string for all tiers', () => {
    for (const tier of ALL_TIERS) {
      const result = formatRateLimit(tier);
      expect(typeof result).toBe('string');
      expect(result).toContain('/s');
      expect(result).toContain('/min');
      expect(result).toContain('/hr');
    }
  });
});

describe('TIER_QUOTAS', () => {
  it('has quotas for every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_QUOTAS[tier]).toBeDefined();
    }
  });

  it('higher tiers have more monthly API calls (or unlimited)', () => {
    for (let i = 1; i < ALL_TIERS.length; i++) {
      const prev = TIER_QUOTAS[ALL_TIERS[i - 1]].monthlyApiCalls;
      const curr = TIER_QUOTAS[ALL_TIERS[i]].monthlyApiCalls;
      if (isUnlimited(curr)) continue;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('T7 has unlimited agents, webhooks, and team members', () => {
    const t7 = TIER_QUOTAS[TrustTier.T7_AUTONOMOUS];
    expect(isUnlimited(t7.maxAgents)).toBe(true);
    expect(isUnlimited(t7.maxWebhooks)).toBe(true);
    expect(isUnlimited(t7.maxTeamMembers)).toBe(true);
  });
});

describe('getQuota', () => {
  it('returns correct quota for T0', () => {
    const quota = getQuota(TrustTier.T0_SANDBOX);
    expect(quota.monthlyApiCalls).toBe(1000);
    expect(quota.maxAgents).toBe(1);
  });

  it('returns same object as TIER_QUOTAS indexing', () => {
    for (const tier of ALL_TIERS) {
      expect(getQuota(tier)).toBe(TIER_QUOTAS[tier]);
    }
  });
});

describe('isUnlimited', () => {
  it('returns true for -1', () => {
    expect(isUnlimited(-1)).toBe(true);
  });

  it('returns false for positive values', () => {
    expect(isUnlimited(0)).toBe(false);
    expect(isUnlimited(100)).toBe(false);
    expect(isUnlimited(1000000)).toBe(false);
  });
});
