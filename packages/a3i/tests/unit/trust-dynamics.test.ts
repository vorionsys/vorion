/**
 * Tests for TrustDynamicsEngine - ATSF v2.0 Asymmetric Trust Updates
 *
 * Key principles tested:
 * - "Trust is hard to gain, easy to lose" (7-10x asymmetry, tier-scaled)
 * - Logarithmic gain (slow approach to ceiling)
 * - Tier-scaled exponential loss (7x at T0, 10x at T7)
 * - Single penalty mechanism — no stacking (no double jeopardy)
 * - 7-day cooldown after any trust drop
 * - Oscillation detection with circuit breaker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TrustDynamicsEngine,
  createTrustDynamicsEngine,
  type TrustUpdateOptions,
} from '../../src/trust/trust-dynamics.js';
import { DEFAULT_TRUST_DYNAMICS } from '@vorionsys/contracts';

describe('TrustDynamicsEngine', () => {
  let engine: TrustDynamicsEngine;

  beforeEach(() => {
    engine = createTrustDynamicsEngine();
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = engine.getConfig();
      expect(config.gainRate).toBe(0.01);
      expect(config.penaltyRatioMin).toBe(7);   // T0: 7x gain rate
      expect(config.penaltyRatioMax).toBe(10);  // T7: 10x gain rate
      expect(config.cooldownHours).toBe(168); // 7 days
      expect(config.oscillationThreshold).toBe(3);
      expect(config.oscillationWindowHours).toBe(24);
      expect(config.circuitBreakerThreshold).toBe(100);
      expect(config.methodologyFailureThreshold).toBe(3);
      expect(config.methodologyWindowHours).toBe(72);
    });

    it('should allow custom configuration', () => {
      const customEngine = createTrustDynamicsEngine({
        gainRate: 0.02,
        penaltyRatioMin: 6,
        penaltyRatioMax: 12,
      });
      const config = customEngine.getConfig();
      expect(config.gainRate).toBe(0.02);
      expect(config.penaltyRatioMin).toBe(6);
      expect(config.penaltyRatioMax).toBe(12);
    });

    it('should return 10:1 asymmetry ratio at T7 (max)', () => {
      expect(engine.getAsymmetryRatio(7)).toBe(10);
    });

    it('should return 7:1 asymmetry ratio at T0 (min)', () => {
      expect(engine.getAsymmetryRatio(0)).toBe(7);
    });

    it('should default getAsymmetryRatio to T7 (max)', () => {
      expect(engine.getAsymmetryRatio()).toBe(10);
    });
  });

  describe('Asymmetric Gain (Logarithmic)', () => {
    it('should gain trust slowly with logarithmic formula', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 500,
        success: true,
        ceiling: 900,
      });

      // delta = 0.01 * log(1 + (90 - 50)) = 0.01 * log(41) ≈ 0.037
      expect(result.delta).toBeGreaterThan(0);
      expect(result.delta).toBeLessThan(1);
      expect(result.newScore).toBeGreaterThan(50);
    });

    it('should have diminishing returns as trust approaches ceiling', () => {
      const lowResult = engine.updateTrust('agent1', {
        currentScore: 300,
        success: true,
        ceiling: 900,
      });

      const highResult = engine.updateTrust('agent2', {
        currentScore: 800,
        success: true,
        ceiling: 900,
      });

      // Higher starting point = less room = smaller gain
      expect(lowResult.delta).toBeGreaterThan(highResult.delta);
    });

    it('should not gain past ceiling', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 890,
        success: true,
        ceiling: 900,
      });

      expect(result.newScore).toBeLessThanOrEqual(900);
    });

    it('should have zero gain when at ceiling', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 900,
        success: true,
        ceiling: 900,
      });

      expect(result.delta).toBe(0);
      expect(result.newScore).toBe(900);
    });
  });

  describe('Asymmetric Loss (Tier-Scaled Exponential)', () => {
    it('should lose trust at T0 rate (7x gain rate) when no tier specified', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        // tier defaults to 0 (T0 Sandbox) — 7x lossRate = 0.07
      });

      // delta = -0.07 * 500 = -35
      expect(result.delta).toBe(-35);
      expect(result.newScore).toBe(465);
    });

    it('should lose trust at T7 rate (10x gain rate) for highest tier', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 7, // T7 Autonomous — 10x lossRate = 0.10
      });

      // delta = -0.10 * 500 = -50
      expect(result.delta).toBe(-50);
      expect(result.newScore).toBe(450);
    });

    it('should scale loss proportionally with tier', () => {
      const t0Result = engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 0,
      });

      const t7Result = engine.updateTrust('agent2', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 7,
      });

      // T7 should have larger absolute loss than T0
      expect(Math.abs(t7Result.delta)).toBeGreaterThan(Math.abs(t0Result.delta));
      expect(t0Result.delta).toBe(-35);  // -0.07 * 500
      expect(t7Result.delta).toBe(-50);  // -0.10 * 500
    });

    it('should lose proportionally more at higher trust levels (within same tier)', () => {
      const highResult = engine.updateTrust('agent1', {
        currentScore: 800,
        success: false,
        ceiling: 900,
        tier: 7,
      });

      const lowResult = engine.updateTrust('agent2', {
        currentScore: 400,
        success: false,
        ceiling: 900,
        tier: 7,
      });

      // Higher trust = bigger absolute loss (proportional loss property)
      expect(Math.abs(highResult.delta)).toBeGreaterThan(Math.abs(lowResult.delta));
      expect(highResult.delta).toBe(-80); // -0.10 * 800
      expect(lowResult.delta).toBe(-40);  // -0.10 * 400
    });

    it('should not go below zero', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 50,
        success: false,
        ceiling: 900,
      });

      expect(result.newScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Outcome Reversals', () => {
    it('should apply the same penalty as a normal failure (no extra multiplier)', () => {
      const normalResult = engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 7,
        isReversal: false,
      });

      const reversalResult = engine.updateTrust('agent2', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 7,
        isReversal: true,
      });

      // Reversal uses the same tier-scaled penalty — no extra multiplier (no double jeopardy)
      expect(reversalResult.delta).toBe(normalResult.delta);
      expect(normalResult.delta).toBe(-50);   // -0.10 * 500 at T7
      expect(reversalResult.delta).toBe(-50); // same — isReversal only affects cooldown label
    });

    it('should label cooldown reason as outcome_reversal when isReversal is true', () => {
      const now = new Date('2024-01-01T12:00:00Z');

      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        isReversal: true,
        now,
      });

      const info = engine.getCooldownInfo('agent1', now);
      expect(info.inCooldown).toBe(true);
      expect(info.reason).toBe('outcome_reversal');
    });
  });

  describe('Cooldown Periods', () => {
    it('should enter cooldown after trust loss', () => {
      const now = new Date('2024-01-01T12:00:00Z');

      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        now,
      });

      expect(engine.isInCooldown('agent1', now)).toBe(true);
    });

    it('should block trust gain during cooldown', () => {
      const now = new Date('2024-01-01T12:00:00Z');

      // First, cause a loss to trigger cooldown
      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        now,
      });

      // Try to gain trust immediately after
      const result = engine.updateTrust('agent1', {
        currentScore: 450,
        success: true,
        ceiling: 900,
        now,
      });

      expect(result.blockedByCooldown).toBe(true);
      expect(result.delta).toBe(0);
      expect(result.newScore).toBe(450);
    });

    it('should allow trust gain after cooldown expires', () => {
      const start = new Date('2024-01-01T12:00:00Z');
      const afterCooldown = new Date('2024-01-08T13:00:00Z'); // 7 days + 1 hour later

      // Trigger cooldown
      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        now: start,
      });

      // Try gain after cooldown
      const result = engine.updateTrust('agent1', {
        currentScore: 450,
        success: true,
        ceiling: 900,
        now: afterCooldown,
      });

      expect(result.blockedByCooldown).toBe(false);
      expect(result.delta).toBeGreaterThan(0);
    });

    it('should report cooldown remaining time', () => {
      const start = new Date('2024-01-01T12:00:00Z');
      const dayLater = new Date('2024-01-02T12:00:00Z');

      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        now: start,
      });

      const remaining = engine.getCooldownRemainingHours('agent1', dayLater);
      expect(remaining).toBeCloseTo(144, 0); // 168 - 24 = 144 hours
    });

    it('should return cooldown info', () => {
      const now = new Date('2024-01-01T12:00:00Z');

      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        isReversal: true,
        now,
      });

      const info = engine.getCooldownInfo('agent1', now);
      expect(info.inCooldown).toBe(true);
      expect(info.reason).toBe('outcome_reversal');
    });
  });

  describe('Oscillation Detection', () => {
    it('should track direction changes', () => {
      const engine = createTrustDynamicsEngine({
        oscillationThreshold: 3,
        oscillationWindowHours: 24,
      });

      const baseTime = new Date('2024-01-01T12:00:00Z');

      // Direction change 1: gain → loss
      engine.updateTrust('agent1', {
        currentScore: 500,
        success: true,
        ceiling: 900,
        now: baseTime,
      });
      engine.updateTrust('agent1', {
        currentScore: 505,
        success: false,
        ceiling: 900,
        now: new Date(baseTime.getTime() + 1000),
      });

      // Direction change 2: loss → gain (blocked by cooldown, but tracked)
      engine.updateTrust('agent1', {
        currentScore: 450,
        success: true,
        ceiling: 900,
        now: new Date(baseTime.getTime() + 2000),
      });

      // Direction change 3: gain → loss
      engine.updateTrust('agent1', {
        currentScore: 450,
        success: false,
        ceiling: 900,
        now: new Date(baseTime.getTime() + 3000),
      });

      // Circuit breaker should be tripped
      expect(engine.isCircuitBreakerTripped('agent1')).toBe(true);
    });

    it('should trip circuit breaker on oscillation', () => {
      const engine = createTrustDynamicsEngine({
        oscillationThreshold: 3,
        oscillationWindowHours: 24,
      });

      const now = new Date('2024-01-01T12:00:00Z');

      // Create rapid oscillations
      let score = 500;
      for (let i = 0; i < 5; i++) {
        const result = engine.updateTrust('agent1', {
          currentScore: score,
          success: i % 2 === 0,
          ceiling: 900,
          now: new Date(now.getTime() + i * 1000),
        });
        score = result.newScore;

        if (result.circuitBreakerTripped) {
          expect(result.circuitBreakerReason).toBe('oscillation_detected');
          break;
        }
      }

      expect(engine.isCircuitBreakerTripped('agent1')).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    it('should trip when trust falls below threshold', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 15,
        success: false,
        ceiling: 900,
      });

      // After loss: 15 - (0.10 * 15) = 13.5 → still above 10
      // Need to go lower
      const result2 = engine.updateTrust('agent1', {
        currentScore: 8,
        success: false,
        ceiling: 900,
      });

      expect(result2.circuitBreakerTripped).toBe(true);
      expect(result2.circuitBreakerReason).toBe('trust_below_threshold');
    });

    it('should block all updates when circuit breaker is tripped', () => {
      // Trip the circuit breaker
      engine.updateTrust('agent1', {
        currentScore: 50,
        success: false,
        ceiling: 900,
      });

      // Try to gain trust
      const result = engine.updateTrust('agent1', {
        currentScore: 20,
        success: true,
        ceiling: 900,
      });

      expect(result.circuitBreakerTripped).toBe(true);
      expect(result.delta).toBe(0);
    });

    it('should require admin override for immediate circuit breaker reset', () => {
      engine.updateTrust('agent1', {
        currentScore: 50,
        success: false,
        ceiling: 900,
      });

      // Without admin override, the reset behavior depends on internal time tracking
      // With admin override, it should always succeed
      const resetWithOverride = engine.resetCircuitBreaker('agent1', true);
      expect(resetWithOverride).toBe(true);
      expect(engine.isCircuitBreakerTripped('agent1')).toBe(false);
    });

    it('should return false for non-existent agent reset', () => {
      const reset = engine.resetCircuitBreaker('nonexistent', false);
      expect(reset).toBe(false);
    });
  });

  describe('Repeat Methodology Failures', () => {
    it('should trip circuit breaker after threshold same-methodology failures', () => {
      const baseTime = new Date('2024-01-01T12:00:00Z');
      let result;

      for (let i = 0; i < 3; i++) {
        result = engine.updateTrust('agent1', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          methodologyKey: 'CT-COMP',
          now: new Date(baseTime.getTime() + i * 60 * 60 * 1000), // 1 hour apart
        });
      }

      expect(result!.circuitBreakerTripped).toBe(true);
      expect(result!.circuitBreakerReason).toBe('repeat_methodology_failure:CT-COMP');
    });

    it('should not trip circuit breaker before threshold is reached', () => {
      const baseTime = new Date('2024-01-01T12:00:00Z');

      // Only 2 failures — threshold is 3
      for (let i = 0; i < 2; i++) {
        const result = engine.updateTrust('agent1', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          methodologyKey: 'CT-COMP',
          now: new Date(baseTime.getTime() + i * 60 * 60 * 1000),
        });
        expect(result.circuitBreakerTripped).toBe(false);
      }
    });

    it('should track different methodology keys independently', () => {
      const baseTime = new Date('2024-01-01T12:00:00Z');

      // 2 failures on CT-COMP, 1 failure on CT-REL — neither trips
      engine.updateTrust('agent1', { currentScore: 500, success: false, ceiling: 900, methodologyKey: 'CT-COMP', now: new Date(baseTime.getTime()) });
      engine.updateTrust('agent1', { currentScore: 465, success: false, ceiling: 900, methodologyKey: 'CT-COMP', now: new Date(baseTime.getTime() + 3600000) });
      engine.updateTrust('agent1', { currentScore: 432, success: false, ceiling: 900, methodologyKey: 'CT-REL', now: new Date(baseTime.getTime() + 7200000) });

      expect(engine.isCircuitBreakerTripped('agent1')).toBe(false);
    });

    it('should ignore methodology key on successful updates', () => {
      const baseTime = new Date('2024-01-01T12:00:00Z');

      // 3 successes with same key — should NOT trip circuit breaker
      for (let i = 0; i < 3; i++) {
        engine.updateTrust('agent1', {
          currentScore: 400,
          success: true,
          ceiling: 900,
          methodologyKey: 'CT-COMP',
          now: new Date(baseTime.getTime() + i * 3600000),
        });
      }

      expect(engine.isCircuitBreakerTripped('agent1')).toBe(false);
    });

    it('should expire old failures outside the rolling window', () => {
      const engine72 = createTrustDynamicsEngine({ methodologyFailureThreshold: 3, methodologyWindowHours: 1 });
      const baseTime = new Date('2024-01-01T12:00:00Z');

      // 2 failures within window
      engine72.updateTrust('agent1', { currentScore: 500, success: false, ceiling: 900, methodologyKey: 'CT-COMP', now: baseTime });
      engine72.updateTrust('agent1', { currentScore: 465, success: false, ceiling: 900, methodologyKey: 'CT-COMP', now: new Date(baseTime.getTime() + 10 * 60 * 1000) });

      // 3rd failure is 2 hours later — outside 1-hour window, so the first two are pruned
      const result = engine72.updateTrust('agent1', {
        currentScore: 432,
        success: false,
        ceiling: 900,
        methodologyKey: 'CT-COMP',
        now: new Date(baseTime.getTime() + 2 * 60 * 60 * 1000),
      });

      // Only 1 failure within window — no trip
      expect(result.circuitBreakerTripped).toBe(false);
    });

    it('should clear methodology failure history on circuit breaker reset', () => {
      const baseTime = new Date('2024-01-01T12:00:00Z');

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        engine.updateTrust('agent1', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          methodologyKey: 'CT-COMP',
          now: new Date(baseTime.getTime() + i * 3600000),
        });
      }
      expect(engine.isCircuitBreakerTripped('agent1')).toBe(true);

      // Admin reset
      engine.resetCircuitBreaker('agent1', true);
      expect(engine.isCircuitBreakerTripped('agent1')).toBe(false);

      // Now 2 more failures should NOT trip (history cleared)
      for (let i = 0; i < 2; i++) {
        const result = engine.updateTrust('agent1', {
          currentScore: 400,
          success: false,
          ceiling: 900,
          methodologyKey: 'CT-COMP',
          now: new Date(baseTime.getTime() + (i + 4) * 3600000),
        });
        expect(result.circuitBreakerTripped).toBe(false);
      }
    });

    it('should not track methodology when no key provided', () => {
      // 3 failures with no methodologyKey — should not trip methodology circuit breaker
      for (let i = 0; i < 3; i++) {
        const result = engine.updateTrust('agent1', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          // no methodologyKey
        });
        // May trip trust_below_threshold but not repeat_methodology_failure
        if (result.circuitBreakerTripped) {
          expect(result.circuitBreakerReason).not.toContain('repeat_methodology_failure');
        }
      }
    });
  });

  describe('Decay', () => {
    it('should apply time-based decay', () => {
      const score = 80;
      const days = 7;

      const decayed = engine.applyDecay(score, days);

      // decay = 80 * (1 - 0.01)^7 ≈ 80 * 0.932 ≈ 74.6
      expect(decayed).toBeLessThan(score);
      expect(decayed).toBeCloseTo(80 * Math.pow(0.99, 7), 2);
    });

    it('should have no decay for zero days', () => {
      const score = 80;
      const decayed = engine.applyDecay(score, 0);
      expect(decayed).toBe(score);
    });
  });

  describe('State Management', () => {
    it('should create initial state for new agents', () => {
      const state = engine.getState('new-agent');
      expect(state.agentId).toBe('new-agent');
      expect(state.cooldown.inCooldown).toBe(false);
      expect(state.circuitBreakerTripped).toBe(false);
      expect(state.lastDirection).toBe('none');
      expect(state.methodologyFailures).toEqual({});
    });

    it('should maintain separate state per agent', () => {
      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
      });

      expect(engine.isInCooldown('agent1')).toBe(true);
      expect(engine.isInCooldown('agent2')).toBe(false);
    });

    it('should clear all state', () => {
      engine.updateTrust('agent1', {
        currentScore: 500,
        success: false,
        ceiling: 900,
      });

      engine.clearAllState();

      expect(engine.isInCooldown('agent1')).toBe(false);
    });
  });

  describe('Update Result', () => {
    it('should return complete result object', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 500,
        success: true,
        ceiling: 900,
      });

      expect(result).toHaveProperty('newScore');
      expect(result).toHaveProperty('delta');
      expect(result).toHaveProperty('blockedByCooldown');
      expect(result).toHaveProperty('circuitBreakerTripped');
      expect(result).toHaveProperty('oscillationDetected');
      expect(result).toHaveProperty('state');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero current score', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 0,
        success: false,
        ceiling: 900,
      });

      // Note: -0.10 * 0 = -0 in JavaScript, so we check equality more flexibly
      expect(result.delta).toBeCloseTo(0, 10); // -0.10 * 0 ≈ 0
      expect(result.newScore).toBe(0);
    });

    it('should handle maximum score', () => {
      const result = engine.updateTrust('agent1', {
        currentScore: 100,
        success: true,
        ceiling: 100,
      });

      expect(result.delta).toBe(0);
      expect(result.newScore).toBe(100);
    });

    it('should handle non-existent agent for circuit breaker check', () => {
      expect(engine.isCircuitBreakerTripped('nonexistent')).toBe(false);
    });

    it('should handle non-existent agent for cooldown check', () => {
      expect(engine.isInCooldown('nonexistent')).toBe(false);
      expect(engine.getCooldownRemainingHours('nonexistent')).toBe(0);
    });
  });
});




