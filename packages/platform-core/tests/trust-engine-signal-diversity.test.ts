import { describe, it, expect } from 'vitest';
import {
  getSignalDimension,
  analyzeSignalDiversity,
  validateTierPromotion,
  getMaxTierForDiversity,
  calculateDiversityScore,
  ALL_DIMENSIONS,
  DEFAULT_DIVERSITY_CONFIG,
  type SignalDiversityConfig,
} from '../src/trust-engine/signal-diversity.js';
import type { TrustSignal, TrustLevel } from '../src/common/types.js';

function makeSignal(
  id: string,
  type: string,
  source: string,
  timestamp?: Date
): TrustSignal {
  return {
    id,
    entityId: 'entity-1',
    type,
    value: 100,
    weight: 1.0,
    source,
    timestamp: (timestamp ?? new Date()).toISOString(),
  } as unknown as TrustSignal;
}

describe('getSignalDimension', () => {
  it('extracts behavioral dimension', () => {
    expect(getSignalDimension('behavioral.action_success')).toBe('behavioral');
  });

  it('extracts compliance dimension', () => {
    expect(getSignalDimension('compliance.audit_passed')).toBe('compliance');
  });

  it('extracts identity dimension', () => {
    expect(getSignalDimension('identity.verification_complete')).toBe('identity');
  });

  it('extracts context dimension', () => {
    expect(getSignalDimension('context.environment_stable')).toBe('context');
  });

  it('returns null for unknown dimension prefix', () => {
    expect(getSignalDimension('unknown.something')).toBeNull();
  });

  it('returns null for signal without dot separator', () => {
    expect(getSignalDimension('nodot')).toBeNull();
  });
});

describe('analyzeSignalDiversity', () => {
  it('returns empty analysis for no signals', () => {
    const result = analyzeSignalDiversity([]);
    expect(result.uniqueSources.size).toBe(0);
    expect(result.coveredDimensions.size).toBe(0);
    expect(result.totalSignals).toBe(0);
    expect(result.signalsInWindow).toBe(0);
  });

  it('counts unique sources correctly', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'source-a'),
      makeSignal('s2', 'behavioral.b', 'source-a'),
      makeSignal('s3', 'behavioral.c', 'source-b'),
    ];
    const result = analyzeSignalDiversity(signals);
    expect(result.uniqueSources.size).toBe(2);
    expect(result.uniqueSources.has('source-a')).toBe(true);
    expect(result.uniqueSources.has('source-b')).toBe(true);
  });

  it('requires minSignalsPerDimension to mark dimension as covered', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      // Only 1 behavioral signal - default config requires 2
    ];
    const result = analyzeSignalDiversity(signals);
    expect(result.coveredDimensions.has('behavioral')).toBe(false);
    expect(result.signalsPerDimension.behavioral).toBe(1);
  });

  it('marks dimension as covered when threshold met', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
    ];
    const result = analyzeSignalDiversity(signals);
    expect(result.coveredDimensions.has('behavioral')).toBe(true);
  });

  it('excludes signals outside the diversity window', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1', oldDate),
      makeSignal('s2', 'behavioral.b', 'src2', oldDate),
    ];
    const result = analyzeSignalDiversity(signals);
    expect(result.signalsInWindow).toBe(0);
    expect(result.coveredDimensions.size).toBe(0);
  });

  it('counts all four dimensions correctly', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
      makeSignal('s3', 'compliance.a', 'src3'),
      makeSignal('s4', 'compliance.b', 'src4'),
      makeSignal('s5', 'identity.a', 'src1'),
      makeSignal('s6', 'identity.b', 'src2'),
      makeSignal('s7', 'context.a', 'src3'),
      makeSignal('s8', 'context.b', 'src4'),
    ];
    const result = analyzeSignalDiversity(signals);
    expect(result.coveredDimensions.size).toBe(4);
    expect(result.uniqueSources.size).toBe(4);
  });
});

describe('validateTierPromotion', () => {
  it('always valid for demotion (target <= current)', () => {
    const signals: TrustSignal[] = [];
    const result = validateTierPromotion(signals, 5 as TrustLevel, 3 as TrustLevel);
    expect(result.valid).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it('always valid for same tier', () => {
    const signals: TrustSignal[] = [];
    const result = validateTierPromotion(signals, 3 as TrustLevel, 3 as TrustLevel);
    expect(result.valid).toBe(true);
  });

  it('T0 to T1 requires at least 1 source and 1 dimension', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
    ];
    const result = validateTierPromotion(signals, 0 as TrustLevel, 1 as TrustLevel);
    // Need 1 source (have 1) but need 1 dimension - behavioral has 1 signal, need 2
    expect(result.requirements.minSources).toBe(1);
    expect(result.requirements.minDimensions).toBe(1);
  });

  it('reports gaps when diversity is insufficient for T4', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src1'),
    ];
    const result = validateTierPromotion(signals, 3 as TrustLevel, 4 as TrustLevel);
    expect(result.valid).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
    // T4 requires 3 sources (have 1) and 4 dimensions (have 1)
  });

  it('passes with sufficient diversity for T4', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
      makeSignal('s3', 'compliance.a', 'src3'),
      makeSignal('s4', 'compliance.b', 'src1'),
      makeSignal('s5', 'identity.a', 'src2'),
      makeSignal('s6', 'identity.b', 'src3'),
      makeSignal('s7', 'context.a', 'src1'),
      makeSignal('s8', 'context.b', 'src2'),
    ];
    const result = validateTierPromotion(signals, 3 as TrustLevel, 4 as TrustLevel);
    expect(result.valid).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });
});

describe('getMaxTierForDiversity', () => {
  it('returns T0 for no signals', () => {
    expect(getMaxTierForDiversity([])).toBe(0);
  });

  it('returns appropriate tier based on available diversity', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
      makeSignal('s3', 'compliance.a', 'src1'),
      makeSignal('s4', 'compliance.b', 'src2'),
    ];
    // 2 sources, 2 dimensions covered - should allow at most T3
    const maxTier = getMaxTierForDiversity(signals);
    expect(maxTier).toBeGreaterThanOrEqual(2);
    expect(maxTier).toBeLessThanOrEqual(3);
  });

  it('returns T7 with maximum diversity', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
      makeSignal('s3', 'compliance.a', 'src3'),
      makeSignal('s4', 'compliance.b', 'src4'),
      makeSignal('s5', 'identity.a', 'src1'),
      makeSignal('s6', 'identity.b', 'src2'),
      makeSignal('s7', 'context.a', 'src3'),
      makeSignal('s8', 'context.b', 'src4'),
    ];
    expect(getMaxTierForDiversity(signals)).toBe(7);
  });
});

describe('calculateDiversityScore', () => {
  it('returns 0 for no signals', () => {
    expect(calculateDiversityScore([])).toBe(0);
  });

  it('returns 100 for maximum diversity', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
      makeSignal('s3', 'compliance.a', 'src3'),
      makeSignal('s4', 'compliance.b', 'src4'),
      makeSignal('s5', 'identity.a', 'src1'),
      makeSignal('s6', 'identity.b', 'src2'),
      makeSignal('s7', 'context.a', 'src3'),
      makeSignal('s8', 'context.b', 'src4'),
    ];
    expect(calculateDiversityScore(signals)).toBe(100);
  });

  it('returns partial score for partial diversity', () => {
    const signals = [
      makeSignal('s1', 'behavioral.a', 'src1'),
      makeSignal('s2', 'behavioral.b', 'src2'),
    ];
    const score = calculateDiversityScore(signals);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});

describe('ALL_DIMENSIONS', () => {
  it('contains exactly 4 dimensions', () => {
    expect(ALL_DIMENSIONS).toHaveLength(4);
    expect(ALL_DIMENSIONS).toContain('behavioral');
    expect(ALL_DIMENSIONS).toContain('compliance');
    expect(ALL_DIMENSIONS).toContain('identity');
    expect(ALL_DIMENSIONS).toContain('context');
  });
});
