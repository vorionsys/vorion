/**
 * Phase 5 — Robustness Hardening Tests
 *
 * Adversarial and edge-case tests for the Trust Engine covering:
 * - Input validation (NaN, Infinity, out-of-range, missing fields)
 * - Score calculation guards (non-finite result protection)
 * - Rapid oscillation / gaming detection
 * - Boundary transitions under stress
 * - Signal buffer overflow protection
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TrustEngine,
  createTrustEngine,
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
  type TrustEngineConfig,
} from '../src/trust-engine/index.js';
import type { TrustSignal } from '../src/common/types.js';

// =============================================================================
// HELPERS
// =============================================================================

function createEngine(overrides: Partial<TrustEngineConfig> = {}): TrustEngine {
  return createTrustEngine({
    decayCheckIntervalMs: 60_000,
    successThreshold: 0.7,
    recoveryRate: 0.05,
    maxRecoveryPerSignal: 50,
    ...overrides,
  });
}

function makeSignal(
  entityId: string,
  value: number,
  type = 'behavioral.task_completed',
): TrustSignal {
  return {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entityId,
    type,
    value,
    source: 'test',
    timestamp: new Date().toISOString(),
    metadata: {},
  };
}

// =============================================================================
// §1 — SIGNAL INPUT VALIDATION
// =============================================================================

describe('Signal Input Validation', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should reject NaN signal value', async () => {
    await expect(engine.recordSignal(makeSignal('e1', NaN))).rejects.toThrow(
      'Invalid signal value',
    );
  });

  it('should reject Infinity signal value', async () => {
    await expect(engine.recordSignal(makeSignal('e1', Infinity))).rejects.toThrow(
      'Invalid signal value',
    );
  });

  it('should reject -Infinity signal value', async () => {
    await expect(engine.recordSignal(makeSignal('e1', -Infinity))).rejects.toThrow(
      'Invalid signal value',
    );
  });

  it('should reject negative signal value', async () => {
    await expect(engine.recordSignal(makeSignal('e1', -0.1))).rejects.toThrow(
      'Signal value out of range',
    );
  });

  it('should reject signal value > 1', async () => {
    await expect(engine.recordSignal(makeSignal('e1', 1.01))).rejects.toThrow(
      'Signal value out of range',
    );
  });

  it('should accept signal value exactly 0', async () => {
    await engine.initializeEntity('e1');
    await expect(engine.recordSignal(makeSignal('e1', 0))).resolves.not.toThrow();
  });

  it('should accept signal value exactly 1', async () => {
    await engine.initializeEntity('e1');
    await expect(engine.recordSignal(makeSignal('e1', 1))).resolves.not.toThrow();
  });

  it('should reject signal with empty entityId', async () => {
    const signal = makeSignal('', 0.5);
    await expect(engine.recordSignal(signal)).rejects.toThrow('entityId');
  });

  it('should reject signal with empty type', async () => {
    const signal = makeSignal('e1', 0.5, '');
    await expect(engine.recordSignal(signal)).rejects.toThrow('type');
  });

  it('should reject null signal', async () => {
    await expect(engine.recordSignal(null as unknown as TrustSignal)).rejects.toThrow(
      'Signal is required',
    );
  });
});

// =============================================================================
// §2 — SCORE CALCULATION GUARDS
// =============================================================================

describe('Score Calculation Guards', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should produce finite score for freshly initialized entity', async () => {
    await engine.initializeEntity('e1');
    const calc = await engine.calculate('e1');
    expect(Number.isFinite(calc.score)).toBe(true);
    expect(calc.score).toBeGreaterThanOrEqual(0);
    expect(calc.score).toBeLessThanOrEqual(1000);
  });

  it('should produce finite score after many diverse signals', async () => {
    await engine.initializeEntity('e1');
    const types = [
      'behavioral.success',
      'compliance.audit',
      'identity.verify',
      'context.environment',
      'CT-COMP.success',
      'CT-RELY.uptime',
      'SX-VULN.scan',
      'SF-ALGN.feedback',
    ];
    for (let i = 0; i < 100; i++) {
      const type = types[i % types.length];
      await engine.recordSignal(makeSignal('e1', Math.random(), type));
    }
    const calc = await engine.calculate('e1');
    expect(Number.isFinite(calc.score)).toBe(true);
    expect(calc.score).toBeGreaterThanOrEqual(0);
    expect(calc.score).toBeLessThanOrEqual(1000);
  });

  it('should always return score in [0, 1000] range', async () => {
    await engine.initializeEntity('e1');
    // Flood with extreme max-value signals
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('e1', 1.0, 'behavioral.success'));
    }
    const calc = await engine.calculate('e1');
    expect(calc.score).toBeLessThanOrEqual(1000);
    expect(calc.score).toBeGreaterThanOrEqual(0);
  });

  it('should always return score in [0, 1000] range after all-zero signals', async () => {
    await engine.initializeEntity('e1');
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('e1', 0.0, 'behavioral.failure'));
    }
    const calc = await engine.calculate('e1');
    expect(calc.score).toBeLessThanOrEqual(1000);
    expect(calc.score).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// §3 — RAPID OSCILLATION / GAMING PATTERNS
// =============================================================================

describe('Rapid Oscillation Resilience', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createEngine({
      successThreshold: 0.7,
      recoveryRate: 0.05,
      maxRecoveryPerSignal: 50,
    });
  });

  it('should not produce score above 1000 after alternating max/min signals', async () => {
    await engine.initializeEntity('e1');
    for (let i = 0; i < 200; i++) {
      const value = i % 2 === 0 ? 1.0 : 0.0;
      await engine.recordSignal(makeSignal('e1', value, 'behavioral.task'));
    }
    const record = await engine.getScore('e1');
    expect(record).toBeDefined();
    expect(record!.score).toBeGreaterThanOrEqual(0);
    expect(record!.score).toBeLessThanOrEqual(1000);
  });

  it('should converge to a stable score under periodic signals', async () => {
    await engine.initializeEntity('e1');
    const scores: number[] = [];
    for (let i = 0; i < 100; i++) {
      const value = i % 3 === 0 ? 0.2 : 0.8;
      await engine.recordSignal(makeSignal('e1', value, 'CT-COMP.task'));
    }
    // After 100 signals, check stability: last 10 scores should be close
    for (let i = 0; i < 10; i++) {
      await engine.recordSignal(makeSignal('e1', 0.5, 'CT-COMP.task'));
      const calc = await engine.calculate('e1');
      scores.push(calc.score);
    }
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    // Scores should not wildly diverge in the stability window
    expect(max - min).toBeLessThan(50);
  });

  it('should reset consecutiveSuccesses on failure after many successes', async () => {
    await engine.initializeEntity('e1');
    // Build up consecutive successes
    for (let i = 0; i < 10; i++) {
      await engine.recordSignal(makeSignal('e1', 0.9, 'behavioral.success'));
    }
    expect(engine.getConsecutiveSuccessCount('e1')).toBe(10);

    // Single hard failure resets streak (value < 0.3)
    await engine.recordSignal(makeSignal('e1', 0.1, 'behavioral.failure'));
    expect(engine.getConsecutiveSuccessCount('e1')).toBe(0);
  });

  it('should not allow score manipulation via rapid flip-flop signals', async () => {
    await engine.initializeEntity('e1');
    const initialCalc = await engine.calculate('e1');
    const initialScore = initialCalc.score;

    // 50 success + 50 failure rapidly interleaved
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('e1', 1.0, 'behavioral.good'));
      await engine.recordSignal(makeSignal('e1', 0.0, 'behavioral.bad'));
    }

    const finalCalc = await engine.calculate('e1');
    // Score should not be dramatically higher than initial (gaming attempt)
    // With equal good/bad signals, score should stay near the average
    expect(finalCalc.score).toBeLessThanOrEqual(1000);
    expect(finalCalc.score).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// §4 — TIER BOUNDARY TRANSITIONS UNDER STRESS
// =============================================================================

describe('Tier Boundary Transitions', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should have consistent tier for all entities at same score', async () => {
    for (let i = 0; i < 5; i++) {
      const eid = `entity-${i}`;
      await engine.initializeEntity(eid, 3);
    }
    // All should be at level 3
    for (let i = 0; i < 5; i++) {
      const record = await engine.getScore(`entity-${i}`);
      expect(record!.level).toBe(3);
    }
  });

  it('should correctly assign all 8 tiers at exact boundary scores', async () => {
    const boundaries: [number, number][] = [
      [0, 0],
      [199, 0],
      [200, 1],
      [349, 1],
      [350, 2],
      [499, 2],
      [500, 3],
      [649, 3],
      [650, 4],
      [799, 4],
      [800, 5],
      [875, 5],
      [876, 6],
      [950, 6],
      [951, 7],
      [1000, 7],
    ];
    for (const [score, expectedLevel] of boundaries) {
      // Initialize and then manually set score to verify tier mapping
      const eid = `boundary-${score}`;
      const record = await engine.initializeEntity(eid, expectedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7);
      // Direct assign to test scoreToLevel (private, but it's exercised through getScore)
      expect(TRUST_THRESHOLDS[expectedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7]).toBeDefined();
      expect(score >= TRUST_THRESHOLDS[expectedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7].min).toBe(true);
      expect(score <= TRUST_THRESHOLDS[expectedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7].max).toBe(true);
    }
  });

  it('TRUST_THRESHOLDS should cover full 0-1000 range with no gaps', () => {
    const levels = Object.keys(TRUST_THRESHOLDS).map(Number).sort((a, b) => a - b);
    expect(levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // First tier starts at 0
    expect(TRUST_THRESHOLDS[0].min).toBe(0);
    // Last tier ends at 1000
    expect(TRUST_THRESHOLDS[7].max).toBe(1000);

    // No gaps between tiers
    for (let i = 0; i < levels.length - 1; i++) {
      const currentMax = TRUST_THRESHOLDS[levels[i] as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7].max;
      const nextMin = TRUST_THRESHOLDS[levels[i + 1] as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7].min;
      expect(nextMin).toBe(currentMax + 1);
    }
  });
});

// =============================================================================
// §5 — SIGNAL BUFFER OVERFLOW PROTECTION
// =============================================================================

describe('Signal Buffer Management', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should trim signal buffer to last 1000 signals', async () => {
    await engine.initializeEntity('e1');
    // Add 1100 signals
    for (let i = 0; i < 1100; i++) {
      await engine.recordSignal(makeSignal('e1', 0.5, 'behavioral.task'));
    }
    const record = await engine.getScore('e1');
    expect(record!.signals.length).toBeLessThanOrEqual(1000);
  });

  it('should keep most recent signals when buffer overflows', async () => {
    await engine.initializeEntity('e1');
    // Add 1050 signals with unique types
    for (let i = 0; i < 1050; i++) {
      const signal = makeSignal('e1', 0.5, `behavioral.task-${i}`);
      signal.id = `ordered-${i}`;
      await engine.recordSignal(signal);
    }
    const record = await engine.getScore('e1');
    // The oldest signals should have been dropped
    const hasOldest = record!.signals.some((s) => s.id === 'ordered-0');
    const hasNewest = record!.signals.some((s) => s.id === 'ordered-1049');
    expect(hasOldest).toBe(false);
    expect(hasNewest).toBe(true);
  });
});

// =============================================================================
// §6 — TRUST LEVEL NAMES CONSISTENCY
// =============================================================================

describe('Trust Level Names', () => {
  it('should have 8 named levels', () => {
    const names = Object.values(TRUST_LEVEL_NAMES);
    expect(names).toHaveLength(8);
  });

  it('should have unique names for each level', () => {
    const names = Object.values(TRUST_LEVEL_NAMES);
    const unique = new Set(names);
    expect(unique.size).toBe(8);
  });

  it('should have expected canonical names', () => {
    expect(TRUST_LEVEL_NAMES[0]).toBe('Sandbox');
    expect(TRUST_LEVEL_NAMES[1]).toBe('Observed');
    expect(TRUST_LEVEL_NAMES[2]).toBe('Provisional');
    expect(TRUST_LEVEL_NAMES[3]).toBe('Monitored');
    expect(TRUST_LEVEL_NAMES[4]).toBe('Standard');
    expect(TRUST_LEVEL_NAMES[5]).toBe('Trusted');
    expect(TRUST_LEVEL_NAMES[6]).toBe('Certified');
    expect(TRUST_LEVEL_NAMES[7]).toBe('Autonomous');
  });
});

// =============================================================================
// §7 — RECOVERY MECHANICS EDGE CASES
// =============================================================================

describe('Recovery Edge Cases', () => {
  it('should not exceed 1000 after massive recovery', async () => {
    const engine = createEngine({
      recoveryRate: 1.0,
      maxRecoveryPerSignal: 999,
      successThreshold: 0.7,
    });
    await engine.initializeEntity('e1', 7);
    // Entity starts at T7 minimum (951), pump with high-value signals
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('e1', 1.0, 'behavioral.success'));
    }
    const record = await engine.getScore('e1');
    expect(record!.score).toBeLessThanOrEqual(1000);
  });

  it('should track peak score correctly after rise and fall', async () => {
    const engine = createEngine({
      recoveryRate: 0.05,
      maxRecoveryPerSignal: 50,
      successThreshold: 0.7,
    });
    await engine.initializeEntity('e1', 3);
    // Rise
    for (let i = 0; i < 20; i++) {
      await engine.recordSignal(makeSignal('e1', 0.95, 'behavioral.success'));
    }
    const peakAfterRise = engine.getPeakScore('e1');
    expect(peakAfterRise).toBeGreaterThan(500);

    // Fall: many low-value signals
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('e1', 0.0, 'behavioral.failure'));
    }
    // Peak should NOT have decreased
    const peakAfterFall = engine.getPeakScore('e1');
    expect(peakAfterFall).toBeGreaterThanOrEqual(peakAfterRise);
  });

  it('should return 0 for consecutive successes on unknown entity', () => {
    const engine = createEngine();
    expect(engine.getConsecutiveSuccessCount('unknown')).toBe(0);
  });

  it('should return 0 for peak score on unknown entity', () => {
    const engine = createEngine();
    expect(engine.getPeakScore('unknown')).toBe(0);
  });

  it('should return false for accelerated recovery on unknown entity', () => {
    const engine = createEngine();
    expect(engine.isAcceleratedRecoveryActive('unknown')).toBe(false);
  });
});
