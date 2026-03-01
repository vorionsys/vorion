/**
 * Trust Engine Decay Tests
 *
 * Tests for the stepped decay algorithm that reduces trust scores
 * based on inactivity. Uses 182-day half-life with 9 milestones (not counting day 0).
 *
 * @see stepped-decay-specification.md
 */

import { describe, it, expect, vi } from 'vitest';

// Mock prom-client to prevent duplicate metric registration errors
// Everything must be defined inside the factory since vi.mock is hoisted
vi.mock('prom-client', () => {
  const mockFn = () => {};
  const mockReturnThis = function(this: unknown) { return this; };

  const createMockMetric = () => ({
    inc: mockFn,
    dec: mockFn,
    set: mockFn,
    observe: mockFn,
    labels: mockReturnThis,
    reset: mockFn,
    startTimer: () => mockFn,
  });

  const mockRegistry = {
    registerMetric: mockFn,
    metrics: () => Promise.resolve(''),
    contentType: 'text/plain',
    clear: mockFn,
    resetMetrics: mockFn,
    getSingleMetric: mockFn,
    getMetricsAsJSON: () => Promise.resolve([]),
    setDefaultLabels: mockFn,
    removeSingleMetric: mockFn,
  };

  return {
    Registry: function() { return mockRegistry; },
    Counter: function() { return createMockMetric(); },
    Histogram: function() { return createMockMetric(); },
    Gauge: function() { return createMockMetric(); },
    Summary: function() { return createMockMetric(); },
    collectDefaultMetrics: mockFn,
    register: mockRegistry,
  };
});

// Mock logger to prevent console noise
vi.mock('../../../packages/security/src/common/logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import {
  DECAY_MILESTONES,
  calculateDecayMultiplier,
  applyDecay,
  getNextDecayMilestone,
  type DecayMilestone,
} from '../../../src/trust-engine/index.js';

describe('Decay Milestones', () => {
  it('should have 10 entries (day 0 + 9 milestones)', () => {
    expect(DECAY_MILESTONES).toHaveLength(10);
  });

  it('should start at day 0 with multiplier 1.0', () => {
    expect(DECAY_MILESTONES[0]).toEqual({ days: 0, multiplier: 1.0 });
  });

  it('should end at day 182 with multiplier 0.5 (half-life)', () => {
    expect(DECAY_MILESTONES[9]).toEqual({ days: 182, multiplier: 0.5 });
  });

  it('should have milestones in ascending day order', () => {
    for (let i = 1; i < DECAY_MILESTONES.length; i++) {
      expect(DECAY_MILESTONES[i]!.days).toBeGreaterThan(
        DECAY_MILESTONES[i - 1]!.days
      );
    }
  });

  it('should have multipliers in descending order', () => {
    for (let i = 1; i < DECAY_MILESTONES.length; i++) {
      expect(DECAY_MILESTONES[i]!.multiplier).toBeLessThan(
        DECAY_MILESTONES[i - 1]!.multiplier
      );
    }
  });

  it('should match specification values', () => {
    const expected: DecayMilestone[] = [
      { days: 0, multiplier: 1.00 },
      { days: 7, multiplier: 0.94 },
      { days: 14, multiplier: 0.88 },
      { days: 28, multiplier: 0.82 },
      { days: 42, multiplier: 0.76 },
      { days: 56, multiplier: 0.70 },
      { days: 84, multiplier: 0.65 },
      { days: 112, multiplier: 0.60 },
      { days: 140, multiplier: 0.55 },
      { days: 182, multiplier: 0.50 },
    ];
    expect(DECAY_MILESTONES).toEqual(expected);
  });
});

describe('calculateDecayMultiplier', () => {
  describe('exact milestone values', () => {
    it('should return 1.0 for day 0', () => {
      expect(calculateDecayMultiplier(0)).toBe(1.0);
    });

    it('should return 0.94 for day 7', () => {
      expect(calculateDecayMultiplier(7)).toBe(0.94);
    });

    it('should return 0.88 for day 14', () => {
      expect(calculateDecayMultiplier(14)).toBe(0.88);
    });

    it('should return 0.82 for day 28', () => {
      expect(calculateDecayMultiplier(28)).toBe(0.82);
    });

    it('should return 0.76 for day 42', () => {
      expect(calculateDecayMultiplier(42)).toBe(0.76);
    });

    it('should return 0.70 for day 56', () => {
      expect(calculateDecayMultiplier(56)).toBe(0.70);
    });

    it('should return 0.65 for day 84', () => {
      expect(calculateDecayMultiplier(84)).toBe(0.65);
    });

    it('should return 0.60 for day 112', () => {
      expect(calculateDecayMultiplier(112)).toBe(0.60);
    });

    it('should return 0.55 for day 140', () => {
      expect(calculateDecayMultiplier(140)).toBe(0.55);
    });

    it('should return 0.50 for day 182', () => {
      expect(calculateDecayMultiplier(182)).toBe(0.50);
    });
  });

  describe('interpolation between milestones', () => {
    it('should interpolate between day 0 and day 7', () => {
      // Day 3.5 should be halfway between 1.0 and 0.94
      const multiplier = calculateDecayMultiplier(3.5);
      expect(multiplier).toBeCloseTo(0.97, 2); // (1.0 + 0.94) / 2
    });

    it('should interpolate at day 3 (3/7 of way from M0 to M1)', () => {
      // Progress = 3/7 ≈ 0.4286
      // Decay range = 1.0 - 0.94 = 0.06
      // Expected = 1.0 - (0.06 * 0.4286) ≈ 0.9743
      const multiplier = calculateDecayMultiplier(3);
      expect(multiplier).toBeCloseTo(0.9743, 3);
    });

    it('should interpolate between day 7 and day 14', () => {
      // Day 10.5 should be halfway between 0.94 and 0.88
      const multiplier = calculateDecayMultiplier(10.5);
      expect(multiplier).toBeCloseTo(0.91, 2); // (0.94 + 0.88) / 2
    });

    it('should interpolate between day 28 and day 42', () => {
      // Day 35 should be halfway between 0.82 and 0.76
      const multiplier = calculateDecayMultiplier(35);
      expect(multiplier).toBeCloseTo(0.79, 2); // (0.82 + 0.76) / 2
    });

    it('should interpolate between day 140 and day 182', () => {
      // Day 161 should be halfway between 0.55 and 0.50
      const multiplier = calculateDecayMultiplier(161);
      expect(multiplier).toBeCloseTo(0.525, 2); // (0.55 + 0.50) / 2
    });
  });

  describe('beyond final milestone', () => {
    it('should return 0.5 for day 182', () => {
      expect(calculateDecayMultiplier(182)).toBe(0.5);
    });

    it('should return 0.5 for day 200', () => {
      expect(calculateDecayMultiplier(200)).toBe(0.5);
    });

    it('should return 0.5 for day 365', () => {
      expect(calculateDecayMultiplier(365)).toBe(0.5);
    });

    it('should return 0.5 for day 1000', () => {
      expect(calculateDecayMultiplier(1000)).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('should handle negative days as day 0', () => {
      // Negative days shouldn't happen, but should not break
      const multiplier = calculateDecayMultiplier(-1);
      expect(multiplier).toBe(1.0);
    });

    it('should handle fractional days', () => {
      const multiplier = calculateDecayMultiplier(0.5);
      expect(multiplier).toBeGreaterThan(0.99);
      expect(multiplier).toBeLessThan(1.0);
    });
  });
});

describe('applyDecay', () => {
  describe('no decay (day 0)', () => {
    it('should return same score at day 0', () => {
      expect(applyDecay(500, 0)).toBe(500);
    });

    it('should return same score at day 0 for max score', () => {
      expect(applyDecay(1000, 0)).toBe(1000);
    });

    it('should return same score at day 0 for min score', () => {
      expect(applyDecay(0, 0)).toBe(0);
    });
  });

  describe('milestone decay values', () => {
    const baseScore = 1000;

    it('should return 940 for score 1000 at day 7', () => {
      expect(applyDecay(baseScore, 7)).toBe(940);
    });

    it('should return 880 for score 1000 at day 14', () => {
      expect(applyDecay(baseScore, 14)).toBe(880);
    });

    it('should return 820 for score 1000 at day 28', () => {
      expect(applyDecay(baseScore, 28)).toBe(820);
    });

    it('should return 700 for score 1000 at day 56', () => {
      expect(applyDecay(baseScore, 56)).toBe(700);
    });

    it('should return 650 for score 1000 at day 84', () => {
      expect(applyDecay(baseScore, 84)).toBe(650);
    });

    it('should return 600 for score 1000 at day 112', () => {
      expect(applyDecay(baseScore, 112)).toBe(600);
    });

    it('should return 550 for score 1000 at day 140', () => {
      expect(applyDecay(baseScore, 140)).toBe(550);
    });

    it('should return 500 for score 1000 at day 182 (half-life)', () => {
      expect(applyDecay(baseScore, 182)).toBe(500);
    });
  });

  describe('decay with various base scores', () => {
    it('should decay score 500 to 250 at day 182', () => {
      expect(applyDecay(500, 182)).toBe(250);
    });

    it('should decay score 800 to 400 at day 182', () => {
      expect(applyDecay(800, 182)).toBe(400);
    });

    it('should decay score 200 to 100 at day 182', () => {
      expect(applyDecay(200, 182)).toBe(100);
    });

    it('should decay score 750 to 705 at day 7', () => {
      // 750 * 0.94 = 705
      expect(applyDecay(750, 7)).toBe(705);
    });
  });

  describe('rounding behavior', () => {
    it('should round to nearest integer', () => {
      // 500 * 0.94 = 470
      expect(applyDecay(500, 7)).toBe(470);
    });

    it('should round 0.5 up', () => {
      // Score that results in .5 decimal
      // 545 * 0.94 = 512.3 → 512
      expect(applyDecay(545, 7)).toBe(512);
    });

    it('should handle small scores', () => {
      // 10 * 0.5 = 5
      expect(applyDecay(10, 182)).toBe(5);
    });
  });

  describe('beyond half-life', () => {
    it('should not decay below 50% even at day 365', () => {
      const baseScore = 1000;
      const decayed = applyDecay(baseScore, 365);
      expect(decayed).toBe(500); // Still 50%
    });

    it('should not decay below 50% even at day 1000', () => {
      const baseScore = 800;
      const decayed = applyDecay(baseScore, 1000);
      expect(decayed).toBe(400); // Still 50%
    });
  });
});

describe('getNextDecayMilestone', () => {
  it('should return day 7 milestone for day 0', () => {
    const next = getNextDecayMilestone(0);
    expect(next).toEqual({ days: 7, multiplier: 0.94 });
  });

  it('should return day 7 milestone for day 5', () => {
    const next = getNextDecayMilestone(5);
    expect(next).toEqual({ days: 7, multiplier: 0.94 });
  });

  it('should return day 14 milestone for day 7', () => {
    const next = getNextDecayMilestone(7);
    expect(next).toEqual({ days: 14, multiplier: 0.88 });
  });

  it('should return day 14 milestone for day 10', () => {
    const next = getNextDecayMilestone(10);
    expect(next).toEqual({ days: 14, multiplier: 0.88 });
  });

  it('should return day 28 milestone for day 14', () => {
    const next = getNextDecayMilestone(14);
    expect(next).toEqual({ days: 28, multiplier: 0.82 });
  });

  it('should return day 42 milestone for day 28', () => {
    const next = getNextDecayMilestone(28);
    expect(next).toEqual({ days: 42, multiplier: 0.76 });
  });

  it('should return day 56 milestone for day 42', () => {
    const next = getNextDecayMilestone(42);
    expect(next).toEqual({ days: 56, multiplier: 0.70 });
  });

  it('should return day 84 milestone for day 56', () => {
    const next = getNextDecayMilestone(56);
    expect(next).toEqual({ days: 84, multiplier: 0.65 });
  });

  it('should return day 112 milestone for day 84', () => {
    const next = getNextDecayMilestone(84);
    expect(next).toEqual({ days: 112, multiplier: 0.60 });
  });

  it('should return day 140 milestone for day 112', () => {
    const next = getNextDecayMilestone(112);
    expect(next).toEqual({ days: 140, multiplier: 0.55 });
  });

  it('should return day 182 milestone for day 140', () => {
    const next = getNextDecayMilestone(140);
    expect(next).toEqual({ days: 182, multiplier: 0.50 });
  });

  it('should return null for day 182 (at final milestone)', () => {
    const next = getNextDecayMilestone(182);
    expect(next).toBeNull();
  });

  it('should return null for day 365 (beyond final milestone)', () => {
    const next = getNextDecayMilestone(365);
    expect(next).toBeNull();
  });
});

describe('Decay Properties', () => {
  describe('monotonicity', () => {
    it('decay multiplier should never increase with more inactive days', () => {
      let prevMultiplier = 1.0;
      for (let day = 0; day <= 200; day++) {
        const multiplier = calculateDecayMultiplier(day);
        expect(multiplier).toBeLessThanOrEqual(prevMultiplier);
        prevMultiplier = multiplier;
      }
    });

    it('decayed score should never exceed base score', () => {
      const baseScore = 750;
      for (let day = 0; day <= 200; day++) {
        const decayed = applyDecay(baseScore, day);
        expect(decayed).toBeLessThanOrEqual(baseScore);
      }
    });
  });

  describe('bounds', () => {
    it('decay multiplier should always be between 0.5 and 1.0', () => {
      for (let day = 0; day <= 500; day += 10) {
        const multiplier = calculateDecayMultiplier(day);
        expect(multiplier).toBeGreaterThanOrEqual(0.5);
        expect(multiplier).toBeLessThanOrEqual(1.0);
      }
    });

    it('decayed score should always be at least 50% of base', () => {
      const testScores = [100, 250, 500, 750, 1000];
      for (const baseScore of testScores) {
        for (let day = 0; day <= 500; day += 50) {
          const decayed = applyDecay(baseScore, day);
          expect(decayed).toBeGreaterThanOrEqual(Math.round(baseScore * 0.5));
        }
      }
    });
  });

  describe('half-life property', () => {
    it('score should be exactly 50% at day 182', () => {
      const baseScore = 1000;
      const decayed = applyDecay(baseScore, 182);
      expect(decayed).toBe(baseScore * 0.5);
    });

    it('score should be more than 50% before day 182', () => {
      const baseScore = 1000;
      const decayed = applyDecay(baseScore, 181);
      expect(decayed).toBeGreaterThan(baseScore * 0.5);
    });
  });
});

describe('Score never goes below zero', () => {
  it('should return 0 when base score is 0', () => {
    expect(applyDecay(0, 0)).toBe(0);
    expect(applyDecay(0, 182)).toBe(0);
    expect(applyDecay(0, 365)).toBe(0);
  });

  it('should handle very small scores without going negative', () => {
    expect(applyDecay(1, 0)).toBe(1);
    expect(applyDecay(1, 182)).toBe(1); // 1 * 0.5 = 0.5 rounds to 1
    expect(applyDecay(2, 182)).toBe(1); // 2 * 0.5 = 1
  });

  it('should never produce negative values regardless of input', () => {
    for (let score = 0; score <= 1000; score += 10) {
      for (let day = 0; day <= 365; day += 30) {
        const decayed = applyDecay(score, day);
        expect(decayed).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('getNextDecayMilestone date calculation', () => {
  it('should calculate correct days until next milestone from day 0', () => {
    const next = getNextDecayMilestone(0);
    expect(next).not.toBeNull();
    const daysUntil = next!.days - 0;
    expect(daysUntil).toBe(7);
  });

  it('should calculate correct days until next milestone from day 5', () => {
    const next = getNextDecayMilestone(5);
    expect(next).not.toBeNull();
    const daysUntil = next!.days - 5;
    expect(daysUntil).toBe(2); // 7 - 5 = 2 days until milestone
  });

  it('should calculate correct days until next milestone from day 100', () => {
    const next = getNextDecayMilestone(100);
    expect(next).not.toBeNull();
    const daysUntil = next!.days - 100;
    expect(daysUntil).toBe(12); // 112 - 100 = 12 days until milestone
  });

  it('should allow calculating next milestone date given current date', () => {
    const currentDaysInactive = 50;
    const next = getNextDecayMilestone(currentDaysInactive);
    expect(next).not.toBeNull();

    // Calculate the actual date when milestone would be reached
    const now = new Date();
    const daysUntilMilestone = next!.days - currentDaysInactive;
    const milestoneDate = new Date(now.getTime() + daysUntilMilestone * 24 * 60 * 60 * 1000);

    // Verify milestone date is in the future
    expect(milestoneDate.getTime()).toBeGreaterThan(now.getTime());
    // Day 50 is between milestone day 42 and day 56, so next is day 56
    // Verify it's the expected 6 days away (56 - 50 = 6)
    expect(daysUntilMilestone).toBe(6);
  });
});

describe('Real-world scenarios', () => {
  describe('new agent (score 200)', () => {
    const initialScore = 200; // Provisional trust level

    it('should have minimal decay in first week', () => {
      // Day 0: 200 * 1.0 = 200
      // Day 6: progress = 6/7 ≈ 0.857, multiplier = 1.0 - (0.06 * 0.857) ≈ 0.949
      //        200 * 0.949 = 189.7 ≈ 190 (still > 94% retained)
      for (let day = 0; day <= 6; day++) {
        const decayed = applyDecay(initialScore, day);
        expect(decayed).toBeGreaterThanOrEqual(188); // At least 94% retained
      }
    });

    it('should drop to ~188 after 1 week of inactivity', () => {
      expect(applyDecay(initialScore, 7)).toBe(188);
    });

    it('should drop to ~100 after 6 months of inactivity', () => {
      expect(applyDecay(initialScore, 182)).toBe(100);
    });
  });

  describe('trusted agent (score 500)', () => {
    const trustedScore = 500;

    it('should maintain trust level at day 14', () => {
      // At day 14, score = 500 * 0.88 = 440, still in Level 2 (400-599)
      expect(applyDecay(trustedScore, 14)).toBeGreaterThanOrEqual(400);
    });

    it('should maintain trust level at day 21', () => {
      // Day 21: between milestone 14 (0.88) and 28 (0.82)
      // progress = 7/14 = 0.5, multiplier = 0.88 - (0.06 * 0.5) = 0.85
      // score = 500 * 0.85 = 425, still >= 400
      const day21Score = applyDecay(trustedScore, 21);
      expect(day21Score).toBeGreaterThanOrEqual(400);
    });

    it('should drop below trusted level after ~4 weeks', () => {
      // Need to find when 500 * multiplier < 400
      // multiplier < 0.8, which happens between day 28 (0.82) and day 42 (0.76)
      // At day 35, multiplier ≈ 0.79, score ≈ 395
      const day35Score = applyDecay(trustedScore, 35);
      expect(day35Score).toBeLessThan(400);
    });
  });

  describe('privileged agent (score 850)', () => {
    const privilegedScore = 850;

    it('should drop below privileged level (800+) at day 7', () => {
      // 850 * 0.94 = 799, drops below 800
      const day7Score = applyDecay(privilegedScore, 7);
      expect(day7Score).toBeLessThan(800);
    });

    it('needs activity within first few days to maintain privileged', () => {
      // Find when 850 * multiplier < 800
      // multiplier < 800/850 ≈ 0.9412
      // Day 5: progress = 5/7 ≈ 0.714, multiplier = 1.0 - (0.06 * 0.714) ≈ 0.957
      // 850 * 0.957 ≈ 813
      const day5Score = applyDecay(privilegedScore, 5);
      expect(day5Score).toBeGreaterThanOrEqual(800);
    });
  });
});
