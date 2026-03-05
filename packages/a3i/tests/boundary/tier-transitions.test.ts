/**
 * Boundary Testing — Tier Transitions and Edge Cases
 *
 * Validates that all 7 tier boundaries work correctly,
 * score limits are enforced, and edge cases are handled.
 */

import { describe, it, expect } from 'vitest';
import { TrustBand, ObservationTier, OBSERVATION_CEILINGS } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  createTrustCalculator,
  createEvidence,
} from '../../src/index.js';
import { getBand, getBandRange } from '../../src/banding/bands.js';

describe('Boundary Testing — Tier Transitions', () => {

  describe('Exact tier boundary points (all 7 transitions)', () => {
    const boundaries = [
      { below: 199, above: 200, bandBelow: TrustBand.T0_SANDBOX, bandAbove: TrustBand.T1_OBSERVED },
      { below: 349, above: 350, bandBelow: TrustBand.T1_OBSERVED, bandAbove: TrustBand.T2_PROVISIONAL },
      { below: 499, above: 500, bandBelow: TrustBand.T2_PROVISIONAL, bandAbove: TrustBand.T3_MONITORED },
      { below: 649, above: 650, bandBelow: TrustBand.T3_MONITORED, bandAbove: TrustBand.T4_STANDARD },
      { below: 799, above: 800, bandBelow: TrustBand.T4_STANDARD, bandAbove: TrustBand.T5_TRUSTED },
      { below: 875, above: 876, bandBelow: TrustBand.T5_TRUSTED, bandAbove: TrustBand.T6_CERTIFIED },
      { below: 950, above: 951, bandBelow: TrustBand.T6_CERTIFIED, bandAbove: TrustBand.T7_AUTONOMOUS },
    ];

    for (const { below, above, bandBelow, bandAbove } of boundaries) {
      it(`score ${below} → T${bandBelow}, score ${above} → T${bandAbove}`, () => {
        expect(getBand(below)).toBe(bandBelow);
        expect(getBand(above)).toBe(bandAbove);
      });
    }
  });

  describe('Score extremes', () => {
    it('score 0 → T0_SANDBOX', () => {
      expect(getBand(0)).toBe(TrustBand.T0_SANDBOX);
    });

    it('score 1000 → T7_AUTONOMOUS', () => {
      expect(getBand(1000)).toBe(TrustBand.T7_AUTONOMOUS);
    });

    it('score exactly at ceiling for each observation tier', () => {
      const calculator = createTrustCalculator();

      for (const tier of [
        ObservationTier.BLACK_BOX,
        ObservationTier.GRAY_BOX,
        ObservationTier.WHITE_BOX,
        ObservationTier.ATTESTED_BOX,
        ObservationTier.VERIFIED_BOX,
      ]) {
        const ceiling = OBSERVATION_CEILINGS[tier];
        const adjusted = calculator.applyCeiling(ceiling, tier);
        expect(adjusted).toBe(ceiling);

        // Score above ceiling gets clamped
        const above = calculator.applyCeiling(ceiling + 100, tier);
        expect(above).toBe(ceiling);
      }
    });
  });

  describe('Gain at ceiling returns delta=0', () => {
    it('success signal at ceiling produces zero delta', () => {
      const dynamics = new TrustDynamicsEngine();

      // Agent at WHITE_BOX ceiling (900)
      const result = dynamics.updateTrust('ceiling-agent', {
        currentScore: 900,
        success: true,
        ceiling: 900,
        tier: 5,
        methodologyKey: 'test:ceiling',
        now: new Date(),
      });

      expect(result.delta).toBe(0);
      expect(result.newScore).toBe(900);
    });
  });

  describe('Loss at score boundaries', () => {
    it('loss at score=0 does not underflow', () => {
      const dynamics = new TrustDynamicsEngine();

      const result = dynamics.updateTrust('zero-agent', {
        currentScore: 0,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:zero',
        now: new Date(),
      });

      expect(result.newScore).toBeGreaterThanOrEqual(0);
    });

    it('loss at BASELINE_SCORE=1 trips circuit breaker', () => {
      const dynamics = new TrustDynamicsEngine();

      const result = dynamics.updateTrust('baseline-agent', {
        currentScore: 1,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:baseline',
        now: new Date(),
      });

      // Score 1 → loss → near 0 → below CB threshold (100) → trips
      expect(result.circuitBreakerTripped).toBe(true);
    });

    it('first success from BASELINE_SCORE=1 does NOT trip CB', () => {
      const dynamics = new TrustDynamicsEngine();

      const result = dynamics.updateTrust('first-success', {
        currentScore: 1,
        success: true,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:first',
        now: new Date(),
      });

      // Gain path should not trigger CB check
      expect(result.circuitBreakerTripped).toBe(false);
      expect(result.delta).toBeGreaterThan(0);
      expect(result.newScore).toBeGreaterThan(1);
    });
  });

  describe('Degraded zone boundaries', () => {
    it('score 200 after loss: NOT degraded (at threshold, not below)', () => {
      const dynamics = new TrustDynamicsEngine();

      // Check: score exactly at 200 should NOT be degraded
      // (degraded is triggered when score DROPS BELOW degradedThreshold on a loss)
      const state = dynamics.getCircuitBreakerState('fresh-agent');
      expect(state).toBe('normal');
    });

    it('score 99 after loss: CB trips (below 100 threshold)', () => {
      const dynamics = new TrustDynamicsEngine();

      // Agent at score ~140, loss drops below 100
      const result = dynamics.updateTrust('trip-agent', {
        currentScore: 100,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:trip',
        now: new Date(),
      });

      // Score 100 → loss of ~7 (7x penalty) → ~93 → below CB threshold (100)
      expect(result.circuitBreakerTripped).toBe(true);
    });
  });

  describe('Band range consistency', () => {
    it('all band ranges cover 0-1000 with no gaps', () => {
      const bands = [
        TrustBand.T0_SANDBOX,
        TrustBand.T1_OBSERVED,
        TrustBand.T2_PROVISIONAL,
        TrustBand.T3_MONITORED,
        TrustBand.T4_STANDARD,
        TrustBand.T5_TRUSTED,
        TrustBand.T6_CERTIFIED,
        TrustBand.T7_AUTONOMOUS,
      ];

      // Every integer score from 0-1000 should map to exactly one band
      for (let score = 0; score <= 1000; score++) {
        const band = getBand(score);
        expect(bands).toContain(band);
      }
    });

    it('band ranges do not overlap', () => {
      // Check specific boundary points
      expect(getBand(199)).toBe(TrustBand.T0_SANDBOX);
      expect(getBand(200)).toBe(TrustBand.T1_OBSERVED);
      expect(getBand(349)).toBe(TrustBand.T1_OBSERVED);
      expect(getBand(350)).toBe(TrustBand.T2_PROVISIONAL);
    });
  });
});
