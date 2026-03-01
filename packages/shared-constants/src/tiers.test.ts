import { describe, it, expect } from 'vitest';
import {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier,
  getTierThreshold,
  getTierName,
  getTierColor,
  getTierMinScore,
  getTierMaxScore,
  meetsTierRequirement,
  getTierCode,
  parseTier,
  ALL_TIERS,
} from './tiers.js';

describe('TrustTier enum', () => {
  it('has 8 tiers (T0-T7)', () => {
    expect(ALL_TIERS).toHaveLength(8);
  });

  it('tiers are numbered 0-7', () => {
    expect(TrustTier.T0_SANDBOX).toBe(0);
    expect(TrustTier.T1_OBSERVED).toBe(1);
    expect(TrustTier.T2_PROVISIONAL).toBe(2);
    expect(TrustTier.T3_MONITORED).toBe(3);
    expect(TrustTier.T4_STANDARD).toBe(4);
    expect(TrustTier.T5_TRUSTED).toBe(5);
    expect(TrustTier.T6_CERTIFIED).toBe(6);
    expect(TrustTier.T7_AUTONOMOUS).toBe(7);
  });
});

describe('TIER_THRESHOLDS', () => {
  it('has an entry for every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_THRESHOLDS[tier]).toBeDefined();
    }
  });

  it('thresholds cover 0-1000 without gaps', () => {
    const sorted = ALL_TIERS.map(t => TIER_THRESHOLDS[t]).sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    expect(sorted[sorted.length - 1].max).toBe(1000);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
  });

  it('each threshold has required fields', () => {
    for (const tier of ALL_TIERS) {
      const t = TIER_THRESHOLDS[tier];
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.textColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.min).toBeGreaterThanOrEqual(0);
      expect(t.max).toBeLessThanOrEqual(1000);
      expect(t.max).toBeGreaterThanOrEqual(t.min);
    }
  });
});

describe('scoreToTier', () => {
  it('maps boundary scores correctly', () => {
    expect(scoreToTier(0)).toBe(TrustTier.T0_SANDBOX);
    expect(scoreToTier(199)).toBe(TrustTier.T0_SANDBOX);
    expect(scoreToTier(200)).toBe(TrustTier.T1_OBSERVED);
    expect(scoreToTier(349)).toBe(TrustTier.T1_OBSERVED);
    expect(scoreToTier(350)).toBe(TrustTier.T2_PROVISIONAL);
    expect(scoreToTier(499)).toBe(TrustTier.T2_PROVISIONAL);
    expect(scoreToTier(500)).toBe(TrustTier.T3_MONITORED);
    expect(scoreToTier(649)).toBe(TrustTier.T3_MONITORED);
    expect(scoreToTier(650)).toBe(TrustTier.T4_STANDARD);
    expect(scoreToTier(799)).toBe(TrustTier.T4_STANDARD);
    expect(scoreToTier(800)).toBe(TrustTier.T5_TRUSTED);
    expect(scoreToTier(875)).toBe(TrustTier.T5_TRUSTED);
    expect(scoreToTier(876)).toBe(TrustTier.T6_CERTIFIED);
    expect(scoreToTier(950)).toBe(TrustTier.T6_CERTIFIED);
    expect(scoreToTier(951)).toBe(TrustTier.T7_AUTONOMOUS);
    expect(scoreToTier(1000)).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('throws for scores below 0', () => {
    expect(() => scoreToTier(-1)).toThrow('Trust score must be between 0 and 1000');
  });

  it('throws for scores above 1000', () => {
    expect(() => scoreToTier(1001)).toThrow('Trust score must be between 0 and 1000');
  });
});

describe('getTierThreshold', () => {
  it('returns correct threshold for each tier', () => {
    const t0 = getTierThreshold(TrustTier.T0_SANDBOX);
    expect(t0.min).toBe(0);
    expect(t0.max).toBe(199);
    expect(t0.name).toBe('Sandbox');

    const t7 = getTierThreshold(TrustTier.T7_AUTONOMOUS);
    expect(t7.min).toBe(951);
    expect(t7.max).toBe(1000);
    expect(t7.name).toBe('Autonomous');
  });
});

describe('getTierName', () => {
  it('returns correct names', () => {
    expect(getTierName(TrustTier.T0_SANDBOX)).toBe('Sandbox');
    expect(getTierName(TrustTier.T1_OBSERVED)).toBe('Observed');
    expect(getTierName(TrustTier.T2_PROVISIONAL)).toBe('Provisional');
    expect(getTierName(TrustTier.T3_MONITORED)).toBe('Monitored');
    expect(getTierName(TrustTier.T4_STANDARD)).toBe('Standard');
    expect(getTierName(TrustTier.T5_TRUSTED)).toBe('Trusted');
    expect(getTierName(TrustTier.T6_CERTIFIED)).toBe('Certified');
    expect(getTierName(TrustTier.T7_AUTONOMOUS)).toBe('Autonomous');
  });
});

describe('getTierColor', () => {
  it('returns valid hex colors', () => {
    for (const tier of ALL_TIERS) {
      expect(getTierColor(tier)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('getTierMinScore / getTierMaxScore', () => {
  it('returns correct min/max for each tier', () => {
    expect(getTierMinScore(TrustTier.T0_SANDBOX)).toBe(0);
    expect(getTierMaxScore(TrustTier.T0_SANDBOX)).toBe(199);
    expect(getTierMinScore(TrustTier.T7_AUTONOMOUS)).toBe(951);
    expect(getTierMaxScore(TrustTier.T7_AUTONOMOUS)).toBe(1000);
  });

  it('min is always <= max', () => {
    for (const tier of ALL_TIERS) {
      expect(getTierMinScore(tier)).toBeLessThanOrEqual(getTierMaxScore(tier));
    }
  });
});

describe('meetsTierRequirement', () => {
  it('returns true when score meets tier', () => {
    expect(meetsTierRequirement(800, TrustTier.T3_MONITORED)).toBe(true);
    expect(meetsTierRequirement(500, TrustTier.T3_MONITORED)).toBe(true);
  });

  it('returns false when score is below tier', () => {
    expect(meetsTierRequirement(200, TrustTier.T5_TRUSTED)).toBe(false);
    expect(meetsTierRequirement(0, TrustTier.T1_OBSERVED)).toBe(false);
  });

  it('returns true when score exactly meets tier minimum', () => {
    expect(meetsTierRequirement(650, TrustTier.T4_STANDARD)).toBe(true);
  });

  it('returns true for same tier', () => {
    expect(meetsTierRequirement(100, TrustTier.T0_SANDBOX)).toBe(true);
  });
});

describe('getTierCode', () => {
  it('returns T# format', () => {
    expect(getTierCode(TrustTier.T0_SANDBOX)).toBe('T0');
    expect(getTierCode(TrustTier.T4_STANDARD)).toBe('T4');
    expect(getTierCode(TrustTier.T7_AUTONOMOUS)).toBe('T7');
  });
});

describe('parseTier', () => {
  it('parses T# format', () => {
    expect(parseTier('T0')).toBe(TrustTier.T0_SANDBOX);
    expect(parseTier('T4')).toBe(TrustTier.T4_STANDARD);
    expect(parseTier('T7')).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('parses bare number format', () => {
    expect(parseTier('0')).toBe(TrustTier.T0_SANDBOX);
    expect(parseTier('3')).toBe(TrustTier.T3_MONITORED);
    expect(parseTier('7')).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('parses name format (case-insensitive)', () => {
    expect(parseTier('Sandbox')).toBe(TrustTier.T0_SANDBOX);
    expect(parseTier('MONITORED')).toBe(TrustTier.T3_MONITORED);
    expect(parseTier('autonomous')).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('handles lowercase T# format', () => {
    expect(parseTier('t4')).toBe(TrustTier.T4_STANDARD);
  });

  it('returns null for invalid input', () => {
    expect(parseTier('T8')).toBeNull();
    expect(parseTier('T9')).toBeNull();
    expect(parseTier('invalid')).toBeNull();
    expect(parseTier('T-1')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(parseTier('  T3  ')).toBe(TrustTier.T3_MONITORED);
    expect(parseTier(' Trusted ')).toBe(TrustTier.T5_TRUSTED);
  });
});

describe('ALL_TIERS', () => {
  it('contains exactly 8 tiers', () => {
    expect(ALL_TIERS).toHaveLength(8);
  });

  it('is in ascending order', () => {
    for (let i = 0; i < ALL_TIERS.length; i++) {
      expect(ALL_TIERS[i]).toBe(i);
    }
  });
});
