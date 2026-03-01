/**
 * Canonical Tier Boundary Tests — ATSF 8-Tier Model
 *
 * Exhaustively tests all 16 boundary values for getTierFromScore()
 * in both the Phase 6 types module and the ceiling-enforcement kernel.
 *
 * Canonical boundaries (per BASIS specification):
 *   T0: 0–199   (Sandbox)
 *   T1: 200–349  (Observed)
 *   T2: 350–499  (Provisional)
 *   T3: 500–649  (Monitored)
 *   T4: 650–799  (Standard)
 *   T5: 800–875  (Trusted)
 *   T6: 876–950  (Certified)
 *   T7: 951–1000 (Autonomous)
 */

import { describe, it, expect } from 'vitest';
import {
  TrustTier,
  getTierFromScore as phase6GetTier,
  TRUST_TIER_BOUNDARIES,
  clampToCeiling,
  getCeilingForContext,
  ContextType,
  CONTEXT_CEILINGS,
} from '../src/phase6/index.js';
import {
  getTierFromScore as kernelGetTier,
  clampTrustScore,
  getCeilingForContext as kernelGetCeiling,
  validateScoreForContext,
  getEffectiveAuthorizationTier,
  applyCeilingEnforcement,
  ContextType as KernelContextType,
} from '../src/trust-engine/ceiling-enforcement/kernel.js';

// =============================================================================
// PHASE 6 TYPES — getTierFromScore() EXHAUSTIVE BOUNDARY TESTS
// =============================================================================

describe('Phase 6 getTierFromScore — canonical 8-tier boundaries', () => {
  const BOUNDARY_EXPECTATIONS: [number, TrustTier][] = [
    // T0 range: 0–199
    [0, TrustTier.T0],
    [1, TrustTier.T0],
    [100, TrustTier.T0],
    [199, TrustTier.T0],
    // T1 range: 200–349
    [200, TrustTier.T1],
    [275, TrustTier.T1],
    [349, TrustTier.T1],
    // T2 range: 350–499
    [350, TrustTier.T2],
    [425, TrustTier.T2],
    [499, TrustTier.T2],
    // T3 range: 500–649
    [500, TrustTier.T3],
    [575, TrustTier.T3],
    [649, TrustTier.T3],
    // T4 range: 650–799
    [650, TrustTier.T4],
    [725, TrustTier.T4],
    [799, TrustTier.T4],
    // T5 range: 800–875
    [800, TrustTier.T5],
    [838, TrustTier.T5],
    [875, TrustTier.T5],
    // T6 range: 876–950
    [876, TrustTier.T6],
    [913, TrustTier.T6],
    [950, TrustTier.T6],
    // T7 range: 951–1000
    [951, TrustTier.T7],
    [975, TrustTier.T7],
    [1000, TrustTier.T7],
  ];

  it.each(BOUNDARY_EXPECTATIONS)(
    'score %d → %s',
    (score, expectedTier) => {
      expect(phase6GetTier(score)).toBe(expectedTier);
    }
  );

  it('should map TRUST_TIER_BOUNDARIES min values correctly', () => {
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T0].min)).toBe(TrustTier.T0);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T1].min)).toBe(TrustTier.T1);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T2].min)).toBe(TrustTier.T2);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T3].min)).toBe(TrustTier.T3);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T4].min)).toBe(TrustTier.T4);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T5].min)).toBe(TrustTier.T5);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T6].min)).toBe(TrustTier.T6);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T7].min)).toBe(TrustTier.T7);
  });

  it('should map TRUST_TIER_BOUNDARIES max values correctly', () => {
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T0].max)).toBe(TrustTier.T0);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T1].max)).toBe(TrustTier.T1);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T2].max)).toBe(TrustTier.T2);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T3].max)).toBe(TrustTier.T3);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T4].max)).toBe(TrustTier.T4);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T5].max)).toBe(TrustTier.T5);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T6].max)).toBe(TrustTier.T6);
    expect(phase6GetTier(TRUST_TIER_BOUNDARIES[TrustTier.T7].max)).toBe(TrustTier.T7);
  });

  it('should cover the full 0–1000 range with no gaps', () => {
    const tiers = Object.values(TrustTier);
    let coveredMin = Infinity;
    let coveredMax = -Infinity;
    for (const tier of tiers) {
      const b = TRUST_TIER_BOUNDARIES[tier];
      coveredMin = Math.min(coveredMin, b.min);
      coveredMax = Math.max(coveredMax, b.max);
    }
    expect(coveredMin).toBe(0);
    expect(coveredMax).toBe(1000);
  });

  it('should have contiguous tier ranges with no overlaps', () => {
    const sorted = Object.values(TrustTier)
      .map((t) => TRUST_TIER_BOUNDARIES[t])
      .sort((a, b) => a.min - b.min);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
  });
});

// =============================================================================
// KERNEL — getTierFromScore() EXHAUSTIVE BOUNDARY TESTS
// =============================================================================

describe('Kernel getTierFromScore — canonical 8-tier boundaries', () => {
  const BOUNDARY_EXPECTATIONS: [number, number][] = [
    [0, 0], [100, 0], [199, 0],
    [200, 1], [275, 1], [349, 1],
    [350, 2], [425, 2], [499, 2],
    [500, 3], [575, 3], [649, 3],
    [650, 4], [725, 4], [799, 4],
    [800, 5], [838, 5], [875, 5],
    [876, 6], [913, 6], [950, 6],
    [951, 7], [975, 7], [1000, 7],
  ];

  it.each(BOUNDARY_EXPECTATIONS)(
    'score %d → tier %d',
    (score, expectedTier) => {
      expect(kernelGetTier(score)).toBe(expectedTier);
    }
  );

  it('should throw on negative score', () => {
    expect(() => kernelGetTier(-1)).toThrow('Score out of range: -1');
    expect(() => kernelGetTier(-100)).toThrow('Score out of range');
  });

  it('should throw on score > 1000', () => {
    expect(() => kernelGetTier(1001)).toThrow('Score out of range: 1001');
    expect(() => kernelGetTier(5000)).toThrow('Score out of range');
  });
});

// =============================================================================
// KERNEL — clampTrustScore() TESTS
// =============================================================================

describe('Kernel clampTrustScore', () => {
  it('should clamp to local ceiling (700)', () => {
    const result = clampTrustScore(850, KernelContextType.LOCAL);
    expect(result.clampedScore).toBe(700);
    expect(result.rawScore).toBe(850);
    expect(result.ceiling).toBe(700);
    expect(result.ceilingApplied).toBe(true);
  });

  it('should clamp to enterprise ceiling (900)', () => {
    const result = clampTrustScore(950, KernelContextType.ENTERPRISE);
    expect(result.clampedScore).toBe(900);
    expect(result.ceilingApplied).toBe(true);
  });

  it('should not clamp below ceiling', () => {
    const result = clampTrustScore(500, KernelContextType.SOVEREIGN);
    expect(result.clampedScore).toBe(500);
    expect(result.ceilingApplied).toBe(false);
  });

  it('should allow full sovereign score', () => {
    const result = clampTrustScore(1000, KernelContextType.SOVEREIGN);
    expect(result.clampedScore).toBe(1000);
    expect(result.ceilingApplied).toBe(false);
  });

  it('should clamp negative scores to 0', () => {
    const result = clampTrustScore(-50, KernelContextType.SOVEREIGN);
    expect(result.clampedScore).toBe(0);
    expect(result.ceilingApplied).toBe(true);
  });

  it('should clamp large overflow scores', () => {
    const result = clampTrustScore(5000, KernelContextType.SOVEREIGN);
    expect(result.clampedScore).toBe(1000);
    expect(result.ceilingApplied).toBe(true);
  });

  it('should throw on NaN', () => {
    expect(() => clampTrustScore(NaN, KernelContextType.LOCAL)).toThrow('Invalid raw score');
  });

  it('should throw on Infinity', () => {
    expect(() => clampTrustScore(Infinity, KernelContextType.LOCAL)).toThrow('Invalid raw score');
  });

  it('should throw on -Infinity', () => {
    expect(() => clampTrustScore(-Infinity, KernelContextType.LOCAL)).toThrow('Invalid raw score');
  });
});

// =============================================================================
// KERNEL — validateScoreForContext() TESTS
// =============================================================================

describe('Kernel validateScoreForContext', () => {
  it('should validate score within local ceiling', () => {
    expect(validateScoreForContext(500, KernelContextType.LOCAL)).toBe(true);
    expect(validateScoreForContext(700, KernelContextType.LOCAL)).toBe(true);
  });

  it('should reject score above local ceiling', () => {
    expect(validateScoreForContext(701, KernelContextType.LOCAL)).toBe(false);
  });

  it('should validate score within enterprise ceiling', () => {
    expect(validateScoreForContext(900, KernelContextType.ENTERPRISE)).toBe(true);
  });

  it('should reject score above enterprise ceiling', () => {
    expect(validateScoreForContext(901, KernelContextType.ENTERPRISE)).toBe(false);
  });

  it('should validate full range for sovereign', () => {
    expect(validateScoreForContext(1000, KernelContextType.SOVEREIGN)).toBe(true);
  });

  it('should reject negative scores', () => {
    expect(validateScoreForContext(-1, KernelContextType.SOVEREIGN)).toBe(false);
  });
});

// =============================================================================
// KERNEL — getEffectiveAuthorizationTier() TESTS
// =============================================================================

describe('Kernel getEffectiveAuthorizationTier', () => {
  it('should return tier 0 for score 0 in sovereign context', () => {
    expect(getEffectiveAuthorizationTier(0, KernelContextType.SOVEREIGN)).toBe(0);
  });

  it('should return tier 7 for score 1000 in sovereign context', () => {
    expect(getEffectiveAuthorizationTier(1000, KernelContextType.SOVEREIGN)).toBe(7);
  });

  it('should return tier 4 for score 700 in local context', () => {
    expect(getEffectiveAuthorizationTier(700, KernelContextType.LOCAL)).toBe(4);
  });

  it('should return tier 6 for score 900 in enterprise context', () => {
    expect(getEffectiveAuthorizationTier(900, KernelContextType.ENTERPRISE)).toBe(6);
  });

  it('should throw if score violates ceiling', () => {
    expect(() => getEffectiveAuthorizationTier(800, KernelContextType.LOCAL))
      .toThrow('violates ceiling');
  });
});

// =============================================================================
// KERNEL — applyCeilingEnforcement() TESTS
// =============================================================================

describe('Kernel applyCeilingEnforcement', () => {
  it('should clamp event score to ceiling', () => {
    const event = { rawScore: 950, score: 950, ceilingApplied: false } as any;
    const result = applyCeilingEnforcement(event, KernelContextType.LOCAL);
    expect(result.score).toBe(700);
    expect(result.ceilingApplied).toBe(true);
  });

  it('should leave event score unchanged when within ceiling', () => {
    const event = { rawScore: 500, score: 500, ceilingApplied: false } as any;
    const result = applyCeilingEnforcement(event, KernelContextType.SOVEREIGN);
    expect(result.score).toBe(500);
    expect(result.ceilingApplied).toBe(false);
  });
});

// =============================================================================
// PHASE 6 — clampToCeiling() EDGE CASES
// =============================================================================

describe('Phase 6 clampToCeiling edge cases', () => {
  it('should clamp score at exact ceiling (no change)', () => {
    expect(clampToCeiling(700, 700)).toBe(700);
  });

  it('should clamp score of 0 (no change)', () => {
    expect(clampToCeiling(0, 1000)).toBe(0);
  });

  it('should clamp score of 1000 to ceiling of 1000', () => {
    expect(clampToCeiling(1000, 1000)).toBe(1000);
  });

  it('should clamp score above ceiling', () => {
    expect(clampToCeiling(950, 700)).toBe(700);
  });

  it('should clamp score of 0 with ceiling of 0', () => {
    expect(clampToCeiling(0, 0)).toBe(0);
  });
});

// =============================================================================
// CONTEXT CEILING CONSTANTS
// =============================================================================

describe('Context ceiling constants', () => {
  it('should define local ceiling at 700', () => {
    expect(CONTEXT_CEILINGS[ContextType.LOCAL]).toBe(700);
    expect(getCeilingForContext(ContextType.LOCAL)).toBe(700);
  });

  it('should define enterprise ceiling at 900', () => {
    expect(CONTEXT_CEILINGS[ContextType.ENTERPRISE]).toBe(900);
    expect(getCeilingForContext(ContextType.ENTERPRISE)).toBe(900);
  });

  it('should define sovereign ceiling at 1000', () => {
    expect(CONTEXT_CEILINGS[ContextType.SOVEREIGN]).toBe(1000);
    expect(getCeilingForContext(ContextType.SOVEREIGN)).toBe(1000);
  });
});
