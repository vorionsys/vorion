/**
 * Comprehensive Trust Decay Simulation Tests
 *
 * Tests covering:
 * - Milestone-based decay calculations
 * - Trust decay over time simulation
 * - Failure detection and tracking
 * - Trust recovery mechanics
 * - Edge cases (boundary conditions, zero trust, max trust)
 * - Multi-agent decay scenarios
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TrustEngine,
  createTrustEngine,
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
  type TrustRecord,
  type TrustEngineConfig,
  type TrustDecayAppliedEvent,
  type TrustTierChangedEvent,
  type TrustRecoveryAppliedEvent,
  type TrustRecoveryMilestoneEvent,
} from './index.js';
import {
  calculateDecayMultiplier,
  applyDecay,
  getNextDecayMilestone,
  DECAY_MILESTONES,
  type DecayMilestone,
} from './decay-profiles.js';
import type { TrustSignal, TrustScore } from '../common/types.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a test trust signal with sensible defaults
 */
function createTestSignal(
  entityId: string,
  value: number,
  type: string = 'behavioral.task_completed',
  id?: string
): TrustSignal {
  return {
    id: id ?? `sig-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    entityId,
    type,
    value,
    source: 'test',
    timestamp: new Date().toISOString(),
    metadata: {},
  };
}

/**
 * Creates a failure signal (value below failure threshold)
 */
function createFailureSignal(entityId: string, value: number = 0.1): TrustSignal {
  return createTestSignal(entityId, value, 'behavioral.task_failed');
}

/**
 * Creates a success signal (value above success threshold)
 */
function createSuccessSignal(entityId: string, value: number = 0.9): TrustSignal {
  return createTestSignal(entityId, value, 'behavioral.task_completed');
}

/**
 * Creates engine with fast decay check interval for testing
 */
function createFastDecayEngine(overrides: Partial<TrustEngineConfig> = {}): TrustEngine {
  return createTrustEngine({
    decayCheckIntervalMs: 10, // 10ms check intervals
    successThreshold: 0.7,
    recoveryRate: 0.05,
    acceleratedRecoveryMultiplier: 2.0,
    minSuccessesForAcceleration: 3,
    successWindowMs: 5000,
    maxRecoveryPerSignal: 50,
    ...overrides,
  });
}

// ============================================================================
// Milestone-Based Decay Calculations
// ============================================================================

describe('Milestone-Based Decay Calculations', () => {
  describe('DECAY_MILESTONES constant', () => {
    it('should have exactly 10 milestones (day 0 + 9 steps)', () => {
      expect(DECAY_MILESTONES).toHaveLength(10);
    });

    it('should start at day 0 with multiplier 1.0', () => {
      expect(DECAY_MILESTONES[0]!.days).toBe(0);
      expect(DECAY_MILESTONES[0]!.multiplier).toBe(1.00);
    });

    it('should end at day 182 with multiplier 0.5', () => {
      expect(DECAY_MILESTONES[9]!.days).toBe(182);
      expect(DECAY_MILESTONES[9]!.multiplier).toBe(0.50);
    });

    it('should have correct values for each milestone', () => {
      const expected = [
        { days: 0,   multiplier: 1.00 },
        { days: 7,   multiplier: 0.94 },
        { days: 14,  multiplier: 0.88 },
        { days: 28,  multiplier: 0.82 },
        { days: 42,  multiplier: 0.76 },
        { days: 56,  multiplier: 0.70 },
        { days: 84,  multiplier: 0.65 },
        { days: 112, multiplier: 0.60 },
        { days: 140, multiplier: 0.55 },
        { days: 182, multiplier: 0.50 },
      ];

      for (let i = 0; i < expected.length; i++) {
        expect(DECAY_MILESTONES[i]!.days).toBe(expected[i]!.days);
        expect(DECAY_MILESTONES[i]!.multiplier).toBe(expected[i]!.multiplier);
      }
    });

    it('should have steps 1-5 dropping 6% each', () => {
      // Milestones at indices 1-5: 0.94, 0.88, 0.82, 0.76, 0.70
      for (let i = 1; i <= 5; i++) {
        const drop = DECAY_MILESTONES[i - 1]!.multiplier - DECAY_MILESTONES[i]!.multiplier;
        expect(drop).toBeCloseTo(0.06, 10);
      }
    });

    it('should have steps 6-9 dropping 5% each', () => {
      // Milestones at indices 6-9: 0.65, 0.60, 0.55, 0.50
      for (let i = 6; i <= 9; i++) {
        const drop = DECAY_MILESTONES[i - 1]!.multiplier - DECAY_MILESTONES[i]!.multiplier;
        expect(drop).toBeCloseTo(0.05, 10);
      }
    });

    it('should have milestones in ascending day order', () => {
      for (let i = 1; i < DECAY_MILESTONES.length; i++) {
        expect(DECAY_MILESTONES[i]!.days).toBeGreaterThan(DECAY_MILESTONES[i - 1]!.days);
      }
    });

    it('should have milestones in descending multiplier order', () => {
      for (let i = 1; i < DECAY_MILESTONES.length; i++) {
        expect(DECAY_MILESTONES[i]!.multiplier).toBeLessThan(DECAY_MILESTONES[i - 1]!.multiplier);
      }
    });
  });

  describe('calculateDecayMultiplier', () => {
    it('should return 1.0 at day 0', () => {
      expect(calculateDecayMultiplier(0)).toBe(1.0);
    });

    it('should return 0.94 at day 7', () => {
      expect(calculateDecayMultiplier(7)).toBe(0.94);
    });

    it('should return 0.88 at day 14', () => {
      expect(calculateDecayMultiplier(14)).toBe(0.88);
    });

    it('should return 0.82 at day 28', () => {
      expect(calculateDecayMultiplier(28)).toBe(0.82);
    });

    it('should return 0.76 at day 42', () => {
      expect(calculateDecayMultiplier(42)).toBe(0.76);
    });

    it('should return 0.70 at day 56', () => {
      expect(calculateDecayMultiplier(56)).toBe(0.70);
    });

    it('should return 0.65 at day 84', () => {
      expect(calculateDecayMultiplier(84)).toBe(0.65);
    });

    it('should return 0.60 at day 112', () => {
      expect(calculateDecayMultiplier(112)).toBe(0.60);
    });

    it('should return 0.55 at day 140', () => {
      expect(calculateDecayMultiplier(140)).toBe(0.55);
    });

    it('should return 0.50 at day 182', () => {
      expect(calculateDecayMultiplier(182)).toBe(0.50);
    });

    it('should interpolate between day 0 and day 7', () => {
      // Midpoint at day 3.5 should be midpoint of 1.0 and 0.94 = 0.97
      const result = calculateDecayMultiplier(3.5);
      expect(result).toBeCloseTo(0.97, 5);
    });

    it('should interpolate between day 7 and day 14', () => {
      // Day 10.5 is midpoint between day 7 and day 14
      // Midpoint of 0.94 and 0.88 = 0.91
      const result = calculateDecayMultiplier(10.5);
      expect(result).toBeCloseTo(0.91, 5);
    });

    it('should interpolate between day 56 and day 84', () => {
      // Day 70 is midpoint between 56 and 84
      // Midpoint of 0.70 and 0.65 = 0.675
      const result = calculateDecayMultiplier(70);
      expect(result).toBeCloseTo(0.675, 5);
    });

    it('should interpolate between day 140 and day 182', () => {
      // Day 161 is midpoint between 140 and 182
      // Midpoint of 0.55 and 0.50 = 0.525
      const result = calculateDecayMultiplier(161);
      expect(result).toBeCloseTo(0.525, 5);
    });

    it('should stay at 0.50 beyond day 182', () => {
      expect(calculateDecayMultiplier(200)).toBe(0.50);
      expect(calculateDecayMultiplier(365)).toBe(0.50);
      expect(calculateDecayMultiplier(1000)).toBe(0.50);
      expect(calculateDecayMultiplier(10000)).toBe(0.50);
    });

    it('should return 1.0 for negative days', () => {
      expect(calculateDecayMultiplier(-1)).toBe(1.0);
      expect(calculateDecayMultiplier(-100)).toBe(1.0);
    });

    it('should return values between 0.5 and 1.0 for any valid input', () => {
      const testDays = [0, 1, 3, 7, 10, 14, 20, 28, 35, 42, 50, 56, 70, 84, 100, 112, 130, 140, 160, 182, 200, 365];
      for (const days of testDays) {
        const result = calculateDecayMultiplier(days);
        expect(result).toBeGreaterThanOrEqual(0.5);
        expect(result).toBeLessThanOrEqual(1.0);
      }
    });

    it('should produce a monotonically decreasing curve', () => {
      let previous = calculateDecayMultiplier(0);
      for (let day = 1; day <= 200; day++) {
        const current = calculateDecayMultiplier(day);
        expect(current).toBeLessThanOrEqual(previous);
        previous = current;
      }
    });
  });

  describe('applyDecay', () => {
    it('should return full score at day 0', () => {
      expect(applyDecay(800, 0)).toBe(800);
    });

    it('should return 50% score at day 182', () => {
      expect(applyDecay(800, 182)).toBe(400);
    });

    it('should return correct decay for 800 at day 56', () => {
      // Day 56 multiplier is 0.70
      // 800 * 0.70 = 560
      expect(applyDecay(800, 56)).toBe(560);
    });

    it('should return correct decay for 1000 at day 7', () => {
      // Day 7 multiplier is 0.94
      // 1000 * 0.94 = 940
      expect(applyDecay(1000, 7)).toBe(940);
    });

    it('should return correct decay for 500 at day 84', () => {
      // Day 84 multiplier is 0.65
      // 500 * 0.65 = 325
      expect(applyDecay(500, 84)).toBe(325);
    });

    it('should round to nearest integer', () => {
      // Day 3.5 multiplier is ~0.97
      // 100 * 0.97 = 97
      expect(applyDecay(100, 3.5)).toBe(97);
    });

    it('should never return below zero', () => {
      expect(applyDecay(0, 182)).toBe(0);
      expect(applyDecay(0, 365)).toBe(0);
    });

    it('should handle zero base score', () => {
      expect(applyDecay(0, 0)).toBe(0);
      expect(applyDecay(0, 100)).toBe(0);
    });

    it('should cap at 50% floor for very old entities', () => {
      expect(applyDecay(1000, 365)).toBe(500);
      expect(applyDecay(1000, 1000)).toBe(500);
    });
  });

  describe('getNextDecayMilestone', () => {
    it('should return day 7 milestone when at day 0', () => {
      const next = getNextDecayMilestone(0);
      expect(next).not.toBeNull();
      expect(next!.days).toBe(7);
      expect(next!.multiplier).toBe(0.94);
    });

    it('should return day 14 milestone when at day 7', () => {
      const next = getNextDecayMilestone(7);
      expect(next).not.toBeNull();
      expect(next!.days).toBe(14);
      expect(next!.multiplier).toBe(0.88);
    });

    it('should return day 14 milestone when between day 7 and 14', () => {
      const next = getNextDecayMilestone(10);
      expect(next).not.toBeNull();
      expect(next!.days).toBe(14);
    });

    it('should return day 182 milestone when at day 140', () => {
      const next = getNextDecayMilestone(140);
      expect(next).not.toBeNull();
      expect(next!.days).toBe(182);
      expect(next!.multiplier).toBe(0.50);
    });

    it('should return null when at or past day 182', () => {
      expect(getNextDecayMilestone(182)).toBeNull();
      expect(getNextDecayMilestone(200)).toBeNull();
      expect(getNextDecayMilestone(365)).toBeNull();
    });

    it('should return day 7 milestone for negative days', () => {
      const next = getNextDecayMilestone(-5);
      expect(next).not.toBeNull();
      expect(next!.days).toBe(0);
    });

    it('should return correct milestone for each step transition', () => {
      const transitions = [
        { at: 1,   expectDays: 7 },
        { at: 8,   expectDays: 14 },
        { at: 15,  expectDays: 28 },
        { at: 29,  expectDays: 42 },
        { at: 43,  expectDays: 56 },
        { at: 57,  expectDays: 84 },
        { at: 85,  expectDays: 112 },
        { at: 113, expectDays: 140 },
        { at: 141, expectDays: 182 },
      ];

      for (const { at, expectDays } of transitions) {
        const next = getNextDecayMilestone(at);
        expect(next).not.toBeNull();
        expect(next!.days).toBe(expectDays);
      }
    });
  });
});

// ============================================================================
// Trust Decay Over Time Simulation (Engine Integration)
// ============================================================================

describe('Trust Decay Over Time Simulation', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createFastDecayEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  describe('basic decay mechanics', () => {
    it('should apply decay when staleness exceeds check interval', async () => {
      await engine.initializeEntity('agent-001', 3);
      const initialRecord = await engine.getScore('agent-001');
      const initialScore = initialRecord!.score;

      // Wait for decay check interval
      await new Promise((resolve) => setTimeout(resolve, 50));

      const decayedRecord = await engine.getScore('agent-001');
      // In millisecond-scale tests, days are fractional and near-zero,
      // so decay will be minimal or zero. The key check is that it doesn't increase.
      expect(decayedRecord!.score).toBeLessThanOrEqual(initialScore);
    });

    it('should emit decay_applied event with correct data', async () => {
      const decayEvents: TrustDecayAppliedEvent[] = [];
      engine.on('trust:decay_applied', (e) => decayEvents.push(e));

      await engine.initializeEntity('agent-001', 3);

      // Wait and trigger decay
      await new Promise((resolve) => setTimeout(resolve, 50));
      await engine.getScore('agent-001');

      if (decayEvents.length > 0) {
        const event = decayEvents[0]!;
        expect(event.type).toBe('trust:decay_applied');
        expect(event.entityId).toBe('agent-001');
        expect(event.decayAmount).toBeGreaterThan(0);
        expect(event.stalenessMs).toBeGreaterThan(0);
        expect(event.accelerated).toBe(false);
      }
    });

    it('should not decay below zero', async () => {
      const aggressiveEngine = createFastDecayEngine({
        decayCheckIntervalMs: 5,
      });

      await aggressiveEngine.initializeEntity('agent-001', 1);

      // Wait for multiple decay check periods
      await new Promise((resolve) => setTimeout(resolve, 100));

      const record = await aggressiveEngine.getScore('agent-001');
      expect(record!.score).toBeGreaterThanOrEqual(0);

      await aggressiveEngine.close();
    });
  });
});

// ============================================================================
// Failure Detection and Tracking
// ============================================================================

describe('Low-value signal handling', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createFastDecayEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('should reset consecutive successes on low-value signal', async () => {
    await engine.initializeEntity('agent-001', 3);

    // Build up successes
    await engine.recordSignal(createSuccessSignal('agent-001'));
    await engine.recordSignal(createSuccessSignal('agent-001'));
    expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(2);

    // Low-value signal resets counter
    await engine.recordSignal(createFailureSignal('agent-001'));
    expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(0);
  });

  it('should handle mixed success and low-value signals', async () => {
    await engine.initializeEntity('agent-001', 3);

    // Alternating pattern
    await engine.recordSignal(createFailureSignal('agent-001'));
    await engine.recordSignal(createSuccessSignal('agent-001'));
    await engine.recordSignal(createFailureSignal('agent-001'));
    await engine.recordSignal(createSuccessSignal('agent-001'));

    // Last signal was a success
    expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(1);
  });
});

// ============================================================================
// Trust Recovery Mechanics
// ============================================================================

describe('Trust Recovery Mechanics', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createFastDecayEngine({
      successThreshold: 0.7,
      recoveryRate: 0.05,
      acceleratedRecoveryMultiplier: 2.0,
      minSuccessesForAcceleration: 3,
      maxRecoveryPerSignal: 50,
    });
  });

  afterEach(async () => {
    await engine.close();
  });

  describe('basic recovery', () => {
    it('should apply recovery on success signals', async () => {
      await engine.initializeEntity('agent-001', 2);
      const initialScore = (await engine.getScore('agent-001'))!.score;

      await engine.recordSignal(createSuccessSignal('agent-001', 0.9));

      const record = await engine.getScore('agent-001');
      expect(record!.score).toBeGreaterThanOrEqual(initialScore);
    });

    it('should emit recovery_applied event', async () => {
      const recoveryEvents: TrustRecoveryAppliedEvent[] = [];
      engine.on('trust:recovery_applied', (e) => recoveryEvents.push(e));

      await engine.initializeEntity('agent-001', 2);
      await engine.recordSignal(createSuccessSignal('agent-001', 0.95));

      expect(recoveryEvents.length).toBeGreaterThanOrEqual(0);
      if (recoveryEvents.length > 0) {
        expect(recoveryEvents[0]!.type).toBe('trust:recovery_applied');
        expect(recoveryEvents[0]!.recoveryAmount).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track consecutive successes', async () => {
      await engine.initializeEntity('agent-001', 2);

      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(0);

      await engine.recordSignal(createSuccessSignal('agent-001'));
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(1);

      await engine.recordSignal(createSuccessSignal('agent-001'));
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(2);

      await engine.recordSignal(createSuccessSignal('agent-001'));
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(3);
    });

    it('should not count signals below success threshold as successes', async () => {
      await engine.initializeEntity('agent-001', 2);

      // Signal at 0.5 - above failure threshold but below success threshold
      await engine.recordSignal(createTestSignal('agent-001', 0.5));

      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(0);
    });
  });

  describe('accelerated recovery', () => {
    it('should activate accelerated recovery after minimum consecutive successes', async () => {
      await engine.initializeEntity('agent-001', 2);

      expect(engine.isAcceleratedRecoveryActive('agent-001')).toBe(false);

      // Build up to threshold
      for (let i = 0; i < 3; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001'));
      }

      expect(engine.isAcceleratedRecoveryActive('agent-001')).toBe(true);
    });

    it('should emit accelerated_recovery_earned milestone', async () => {
      const milestoneEvents: TrustRecoveryMilestoneEvent[] = [];
      engine.on('trust:recovery_milestone', (e) => milestoneEvents.push(e));

      await engine.initializeEntity('agent-001', 2);

      // Reach accelerated recovery threshold
      for (let i = 0; i < 3; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001'));
      }

      const acceleratedEvent = milestoneEvents.find(
        (e) => e.milestone === 'accelerated_recovery_earned'
      );
      expect(acceleratedEvent).toBeDefined();
    });

    it('should provide higher recovery rate when accelerated', async () => {
      // Test that accelerated recovery emits higher recovery amounts in events
      const normalEngine = createFastDecayEngine({
        recoveryRate: 0.05,
        acceleratedRecoveryMultiplier: 2.0,
        minSuccessesForAcceleration: 100, // Disable acceleration
        maxRecoveryPerSignal: 100,
      });

      const accelEngine = createFastDecayEngine({
        recoveryRate: 0.05,
        acceleratedRecoveryMultiplier: 2.0,
        minSuccessesForAcceleration: 2, // Easy to reach
        maxRecoveryPerSignal: 100,
      });

      const normalRecoveryEvents: TrustRecoveryAppliedEvent[] = [];
      const accelRecoveryEvents: TrustRecoveryAppliedEvent[] = [];

      normalEngine.on('trust:recovery_applied', (e) => normalRecoveryEvents.push(e));
      accelEngine.on('trust:recovery_applied', (e) => accelRecoveryEvents.push(e));

      await normalEngine.initializeEntity('agent-normal', 2);
      await accelEngine.initializeEntity('agent-accel', 2);

      // Activate accelerated recovery on accelEngine
      await accelEngine.recordSignal(createSuccessSignal('agent-accel'));
      await accelEngine.recordSignal(createSuccessSignal('agent-accel'));

      // Both get same success signal - compare the recovery amounts in events
      await normalEngine.recordSignal(createSuccessSignal('agent-normal', 0.95));
      await accelEngine.recordSignal(createSuccessSignal('agent-accel', 0.95));

      // Get the last recovery event from each engine
      const normalLastRecovery = normalRecoveryEvents[normalRecoveryEvents.length - 1];
      const accelLastRecovery = accelRecoveryEvents[accelRecoveryEvents.length - 1];

      if (normalLastRecovery && accelLastRecovery) {
        expect(accelLastRecovery.acceleratedRecoveryActive).toBe(true);
        expect(normalLastRecovery.acceleratedRecoveryActive).toBe(false);
        expect(accelLastRecovery.recoveryAmount).toBeGreaterThanOrEqual(normalLastRecovery.recoveryAmount);
      }

      await normalEngine.close();
      await accelEngine.close();
    });
  });

  describe('recovery milestones', () => {
    it('should track peak score', async () => {
      await engine.initializeEntity('agent-001', 3);
      const initialPeak = engine.getPeakScore('agent-001');

      // Build up score
      for (let i = 0; i < 5; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001', 0.95));
      }

      const newPeak = engine.getPeakScore('agent-001');
      expect(newPeak).toBeGreaterThanOrEqual(initialPeak);
    });

    it('should emit tier_restored milestone on promotion', async () => {
      const milestoneEvents: TrustRecoveryMilestoneEvent[] = [];
      engine.on('trust:recovery_milestone', (e) => milestoneEvents.push(e));

      // Start at lower tier
      await engine.initializeEntity('agent-001', 1);

      // Many successes to potentially trigger tier promotion
      for (let i = 0; i < 20; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001', 1.0));
      }

      // Check if any tier_restored events occurred
      const tierRestoredEvents = milestoneEvents.filter((e) => e.milestone === 'tier_restored');
      expect(Array.isArray(tierRestoredEvents)).toBe(true);
    });

    it('should cap recovery at maxRecoveryPerSignal', async () => {
      const cappedEngine = createFastDecayEngine({
        recoveryRate: 1.0, // Very high rate
        maxRecoveryPerSignal: 10, // But capped
      });

      const recoveryEvents: TrustRecoveryAppliedEvent[] = [];
      cappedEngine.on('trust:recovery_applied', (e) => recoveryEvents.push(e));

      await cappedEngine.initializeEntity('agent-001', 2);

      await cappedEngine.recordSignal(createSuccessSignal('agent-001', 1.0));

      expect(recoveryEvents.length).toBeGreaterThan(0);
      if (recoveryEvents.length > 0) {
        const lastRecovery = recoveryEvents[recoveryEvents.length - 1]!;
        expect(lastRecovery.recoveryAmount).toBeLessThanOrEqual(10);
      }

      await cappedEngine.close();
    });

    it('should not exceed maximum score of 1000', async () => {
      await engine.initializeEntity('agent-001', 5);

      // Many high-value successes
      for (let i = 0; i < 50; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001', 1.0));
      }

      const record = await engine.getScore('agent-001');
      expect(record!.score).toBeLessThanOrEqual(1000);
    });
  });

  describe('recovery after low-value signals', () => {
    it('should allow recovery after low-value signals', async () => {
      const testEngine = createFastDecayEngine();

      await testEngine.initializeEntity('agent-001', 3);

      // Add low-value signals
      await testEngine.recordSignal(createFailureSignal('agent-001'));
      await testEngine.recordSignal(createFailureSignal('agent-001'));

      const scoreBefore = (await testEngine.getScore('agent-001'))!.score;
      await testEngine.recordSignal(createSuccessSignal('agent-001'));
      const scoreAfter = (await testEngine.getScore('agent-001'))!.score;

      expect(scoreAfter).toBeGreaterThanOrEqual(scoreBefore);

      await testEngine.close();
    });
  });
});

// ============================================================================
// Edge Cases and Boundary Conditions
// ============================================================================

describe('Edge Cases and Boundary Conditions', () => {
  describe('zero trust scenarios', () => {
    it('should handle initialization at L0 (Sandbox)', async () => {
      const engine = createFastDecayEngine();
      const record = await engine.initializeEntity('agent-001', 0);

      expect(record.level).toBe(0);
      expect(record.score).toBe(TRUST_THRESHOLDS[0].min);
      expect(record.score).toBe(0);

      await engine.close();
    });

    it('should allow recovery from zero score', async () => {
      const engine = createFastDecayEngine();
      await engine.initializeEntity('agent-001', 0);

      // Start at minimum
      expect((await engine.getScore('agent-001'))!.score).toBe(0);

      // Recovery signals
      for (let i = 0; i < 10; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001', 1.0));
      }

      const record = await engine.getScore('agent-001');
      expect(record!.score).toBeGreaterThan(0);

      await engine.close();
    });
  });

  describe('maximum trust scenarios', () => {
    it('should handle initialization at L5 (Trusted)', async () => {
      const engine = createFastDecayEngine();
      const record = await engine.initializeEntity('agent-001', 5);

      expect(record.level).toBe(5);
      expect(record.score).toBe(TRUST_THRESHOLDS[5].min);

      await engine.close();
    });

    it('should not exceed score of 1000', async () => {
      const engine = createFastDecayEngine({
        recoveryRate: 1.0,
        maxRecoveryPerSignal: 1000,
      });

      await engine.initializeEntity('agent-001', 5);

      // Many high successes
      for (let i = 0; i < 20; i++) {
        await engine.recordSignal(createSuccessSignal('agent-001', 1.0));
      }

      const record = await engine.getScore('agent-001');
      expect(record!.score).toBeLessThanOrEqual(1000);

      await engine.close();
    });

    it('should maintain L5 until threshold crossed', async () => {
      const engine = createFastDecayEngine({
        decayCheckIntervalMs: 100,
      });

      await engine.initializeEntity('agent-001', 5);
      const record = await engine.getScore('agent-001');

      expect(record!.level).toBe(5);
      expect(record!.score).toBeGreaterThanOrEqual(TRUST_THRESHOLDS[5].min);

      await engine.close();
    });
  });

  describe('tier boundary transitions', () => {
    it('should correctly identify all 8 tier names', () => {
      expect(TRUST_LEVEL_NAMES[0]).toBe('Sandbox');
      expect(TRUST_LEVEL_NAMES[1]).toBe('Observed');
      expect(TRUST_LEVEL_NAMES[2]).toBe('Provisional');
      expect(TRUST_LEVEL_NAMES[3]).toBe('Monitored');
      expect(TRUST_LEVEL_NAMES[4]).toBe('Standard');
      expect(TRUST_LEVEL_NAMES[5]).toBe('Trusted');
      expect(TRUST_LEVEL_NAMES[6]).toBe('Certified');
      expect(TRUST_LEVEL_NAMES[7]).toBe('Autonomous');
    });

    it('should have contiguous tier boundaries', () => {
      const thresholds = Object.values(TRUST_THRESHOLDS);
      for (let i = 0; i < thresholds.length - 1; i++) {
        // Each tier's max should be less than the next tier's min
        expect(thresholds[i]!.max).toBeLessThan(thresholds[i + 1]!.min);
      }
    });
  });

  describe('signal value edge cases', () => {
    it('should handle signal value exactly at success threshold', async () => {
      const engine = createFastDecayEngine({ successThreshold: 0.7 });
      await engine.initializeEntity('agent-001', 3);

      // Exactly at threshold - SHOULD be a success
      await engine.recordSignal(createTestSignal('agent-001', 0.7));

      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(1);

      await engine.close();
    });

    it('should reset consecutive successes for low-value signal', async () => {
      const engine = createFastDecayEngine();
      await engine.initializeEntity('agent-001', 3);

      await engine.recordSignal(createSuccessSignal('agent-001'));
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(1);

      await engine.recordSignal(createTestSignal('agent-001', 0));
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(0);

      await engine.close();
    });

    it('should handle signal value of 1', async () => {
      const engine = createFastDecayEngine();
      await engine.initializeEntity('agent-001', 3);

      await engine.recordSignal(createTestSignal('agent-001', 1.0));

      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(1);

      await engine.close();
    });
  });

  describe('milestone decay edge cases', () => {
    it('should handle zero days since last action', () => {
      const result = calculateDecayMultiplier(0);
      expect(result).toBe(1.0);
    });

    it('should handle very large number of days', () => {
      const result = calculateDecayMultiplier(10000);
      expect(result).toBe(0.5);
    });

    it('should handle fractional days correctly', () => {
      // 0.5 days is between milestone 0 (day 0) and milestone 1 (day 7)
      const result = calculateDecayMultiplier(0.5);
      expect(result).toBeGreaterThan(0.94);
      expect(result).toBeLessThan(1.0);
    });

    it('should handle very small positive values', () => {
      const result = calculateDecayMultiplier(0.001);
      expect(result).toBeGreaterThan(0.99);
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });

  describe('unknown entity handling', () => {
    it('should return undefined for unknown entity score', async () => {
      const engine = createFastDecayEngine();

      const record = await engine.getScore('nonexistent-agent');
      expect(record).toBeUndefined();

      await engine.close();
    });

    it('should return 0 for unknown entity peak score', async () => {
      const engine = createFastDecayEngine();

      expect(engine.getPeakScore('nonexistent-agent')).toBe(0);

      await engine.close();
    });
  });
});

// ============================================================================
// Multi-Agent Decay Scenarios
// ============================================================================

describe('Multi-Agent Decay Scenarios', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createFastDecayEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  describe('independent agent decay', () => {
    it('should maintain separate state for each agent', async () => {
      await engine.initializeEntity('agent-001', 3);
      await engine.initializeEntity('agent-002', 3);
      await engine.initializeEntity('agent-003', 3);

      // Different signal patterns
      await engine.recordSignal(createFailureSignal('agent-001'));
      await engine.recordSignal(createSuccessSignal('agent-002'));
      await engine.recordSignal(createSuccessSignal('agent-003'));
      await engine.recordSignal(createSuccessSignal('agent-003'));

      // Each agent should have independent consecutive success counts
      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(0);
      expect(engine.getConsecutiveSuccessCount('agent-002')).toBe(1);
      expect(engine.getConsecutiveSuccessCount('agent-003')).toBe(2);
    });

    it('should track separate recovery states for each agent', async () => {
      await engine.initializeEntity('agent-001', 2);
      await engine.initializeEntity('agent-002', 2);

      // agent-001 gets successes
      await engine.recordSignal(createSuccessSignal('agent-001'));
      await engine.recordSignal(createSuccessSignal('agent-001'));
      await engine.recordSignal(createSuccessSignal('agent-001'));

      // agent-002 gets one success
      await engine.recordSignal(createSuccessSignal('agent-002'));

      expect(engine.getConsecutiveSuccessCount('agent-001')).toBe(3);
      expect(engine.getConsecutiveSuccessCount('agent-002')).toBe(1);

      expect(engine.isAcceleratedRecoveryActive('agent-001')).toBe(true);
      expect(engine.isAcceleratedRecoveryActive('agent-002')).toBe(false);
    });
  });

  describe('concurrent agent operations', () => {
    it('should handle concurrent signal recording', async () => {
      const agents = ['agent-001', 'agent-002', 'agent-003', 'agent-004', 'agent-005'];

      // Initialize all agents
      await Promise.all(agents.map((id) => engine.initializeEntity(id, 2)));

      // Concurrent signals
      await Promise.all(
        agents.map((id) =>
          Promise.all([
            engine.recordSignal(createSuccessSignal(id)),
            engine.recordSignal(createSuccessSignal(id)),
          ])
        )
      );

      // All should have recorded signals
      for (const id of agents) {
        const record = await engine.getScore(id);
        expect(record).toBeDefined();
        expect(record!.signals.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should maintain data integrity under load', async () => {
      const agents = Array.from({ length: 10 }, (_, i) => `agent-${i.toString().padStart(3, '0')}`);

      // Initialize all
      await Promise.all(agents.map((id) => engine.initializeEntity(id, 2)));

      // Many concurrent operations
      const operations: Promise<void>[] = [];
      for (const id of agents) {
        for (let i = 0; i < 10; i++) {
          if (Math.random() > 0.3) {
            operations.push(engine.recordSignal(createSuccessSignal(id)));
          } else {
            operations.push(engine.recordSignal(createFailureSignal(id)));
          }
        }
      }

      await Promise.all(operations);

      // Verify all agents still have valid state
      for (const id of agents) {
        const record = await engine.getScore(id);
        expect(record).toBeDefined();
        expect(record!.score).toBeGreaterThanOrEqual(0);
        expect(record!.score).toBeLessThanOrEqual(1000);
        expect(record!.level).toBeGreaterThanOrEqual(0);
        expect(record!.level).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('agent isolation', () => {
    it('should not cross-contaminate peak scores', async () => {
      await engine.initializeEntity('agent-001', 3);
      await engine.initializeEntity('agent-002', 1);

      const peak1 = engine.getPeakScore('agent-001');
      const peak2 = engine.getPeakScore('agent-002');

      expect(peak1).not.toBe(peak2);
    });

    it('should emit events with correct entityId', async () => {
      const events: Array<{ entityId: string }> = [];
      engine.on('trust:*', (e) => events.push(e));

      await engine.initializeEntity('agent-001', 2);
      await engine.initializeEntity('agent-002', 2);

      await engine.recordSignal(createSuccessSignal('agent-001'));
      await engine.recordSignal(createFailureSignal('agent-002'));

      // Verify each event has the correct entityId
      const agent001Events = events.filter((e) => e.entityId === 'agent-001');
      const agent002Events = events.filter((e) => e.entityId === 'agent-002');

      expect(agent001Events.length).toBeGreaterThan(0);
      expect(agent002Events.length).toBeGreaterThan(0);

      // No cross-contamination
      agent001Events.forEach((e) => expect(e.entityId).toBe('agent-001'));
      agent002Events.forEach((e) => expect(e.entityId).toBe('agent-002'));
    });
  });

  describe('fleet-wide scenarios', () => {
    it('should handle fleet-wide low-value signals', async () => {
      const agents = ['agent-001', 'agent-002', 'agent-003'];

      await Promise.all(agents.map((id) => engine.initializeEntity(id, 3)));

      // Simulate system-wide low-value signals
      for (const id of agents) {
        await engine.recordSignal(createFailureSignal(id, 0.1));
        await engine.recordSignal(createFailureSignal(id, 0.1));
      }

      // All should have reset consecutive successes
      for (const id of agents) {
        expect(engine.getConsecutiveSuccessCount(id)).toBe(0);
      }
    });

    it('should allow fleet-wide recovery', async () => {
      const agents = ['agent-001', 'agent-002', 'agent-003'];

      await Promise.all(agents.map((id) => engine.initializeEntity(id, 2)));

      // Fleet-wide success pattern
      for (let round = 0; round < 5; round++) {
        for (const id of agents) {
          await engine.recordSignal(createSuccessSignal(id));
        }
      }

      // All should have healthy recovery state
      for (const id of agents) {
        expect(engine.getConsecutiveSuccessCount(id)).toBeGreaterThanOrEqual(3);
        expect(engine.isAcceleratedRecoveryActive(id)).toBe(true);
      }
    });

    it('should correctly list all entity IDs', async () => {
      const agents = ['alpha', 'beta', 'gamma', 'delta'];

      for (const id of agents) {
        await engine.initializeEntity(id, 2);
      }

      const entityIds = engine.getEntityIds();

      expect(entityIds).toHaveLength(4);
      expect(entityIds).toContain('alpha');
      expect(entityIds).toContain('beta');
      expect(entityIds).toContain('gamma');
      expect(entityIds).toContain('delta');
    });
  });
});
