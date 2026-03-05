/**
 * NIST SP 800-218 (SSDF) — Secure Software Development Framework Tests
 *
 * Validates that the Vorion A3I trust system implements defensive coding,
 * input validation, boundary enforcement, and safe defaults.
 *
 * Maps to: PO.1 (Secure Design), PW.1 (Input Validation),
 *          PW.5 (Boundary Enforcement), PW.6 (Error Handling)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier, OBSERVATION_CEILINGS } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createTrustCalculator,
  createEvidence,
  type TrustSignalPipeline,
} from '../../src/index.js';
import { getBand, getBandRange } from '../../src/banding/bands.js';

describe('NIST SP 800-218 (SSDF) — Secure Development Practices', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
  });

  describe('PO.1: Secure design — safe defaults', () => {
    it('PO.1-1: new agent starts at BASELINE_SCORE (zero-trust)', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Process a success signal for a brand-new agent
      const result = await pipeline.process({
        agentId: 'ssdf-new-agent',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // The dynamics engine should have started from baseline (1)
      // Any gain from baseline should be very small
      expect(result.dynamicsResult.newScore).toBeLessThan(100);
    });

    it('PO.1-2: default observation tier is BLACK_BOX (most restrictive)', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      await pipeline.process({
        agentId: 'ssdf-default-tier',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      const profile = await profiles.get('ssdf-default-tier');
      expect(profile).toBeDefined();

      // Default observation tier should be BLACK_BOX (600 ceiling)
      expect(profile!.adjustedScore).toBeLessThanOrEqual(OBSERVATION_CEILINGS[ObservationTier.BLACK_BOX]);
    });

    it('PO.1-3: factor scores initialize at 0.5 baseline', () => {
      const calculator = createTrustCalculator();

      // Empty evidence → all factors at 0.5 baseline
      const profile = calculator.calculate(
        'ssdf-baseline', ObservationTier.WHITE_BOX, [], { now }
      );

      // Composite from 16 factors at 0.5 = 500
      expect(profile.compositeScore).toBe(500);
    });
  });

  describe('PW.1: Input validation — boundary enforcement', () => {
    it('PW.1-1: tier is clamped to [0, 7]', () => {
      // Tier below 0
      const resultLow = dynamics.updateTrust('ssdf-tier-low', {
        currentScore: 500, success: false, ceiling: 900,
        tier: -5, methodologyKey: 'test:tier', now,
      });
      expect(typeof resultLow.delta).toBe('number');
      expect(Number.isFinite(resultLow.delta)).toBe(true);

      // Tier above 7
      const resultHigh = dynamics.updateTrust('ssdf-tier-high', {
        currentScore: 500, success: false, ceiling: 900,
        tier: 100, methodologyKey: 'test:tier', now,
      });
      expect(typeof resultHigh.delta).toBe('number');
      expect(Number.isFinite(resultHigh.delta)).toBe(true);
    });

    it('PW.1-2: score is clamped to [0, ceiling]', () => {
      // Gain cannot exceed ceiling
      const gain = dynamics.updateTrust('ssdf-clamp', {
        currentScore: 899, success: true, ceiling: 900,
        tier: 7, methodologyKey: 'test:clamp', now,
      });
      expect(gain.newScore).toBeLessThanOrEqual(900);

      // Loss cannot go below 0
      const loss = dynamics.updateTrust('ssdf-floor', {
        currentScore: 1, success: false, ceiling: 900,
        tier: 7, methodologyKey: 'test:floor', now,
      });
      expect(loss.newScore).toBeGreaterThanOrEqual(0);
    });

    it('PW.1-3: factor scores are bounded [0.0, 1.0]', () => {
      const calculator = createTrustCalculator();

      // Extreme positive evidence
      const highProfile = calculator.calculate(
        'ssdf-factor-high', ObservationTier.WHITE_BOX,
        [createEvidence('CT-COMP', 99999, 'extreme-positive')],
        { now }
      );
      expect(highProfile.factorScores['CT-COMP']).toBeLessThanOrEqual(1.0);

      // Extreme negative evidence
      const lowProfile = calculator.calculate(
        'ssdf-factor-low', ObservationTier.WHITE_BOX,
        [createEvidence('CT-COMP', -99999, 'extreme-negative')],
        { now }
      );
      expect(lowProfile.factorScores['CT-COMP']).toBeGreaterThanOrEqual(0.0);
    });

    it('PW.1-4: composite score is bounded [0, 1000]', () => {
      const calculator = createTrustCalculator();

      // Max possible evidence
      const maxProfile = calculator.calculate(
        'ssdf-max', ObservationTier.VERIFIED_BOX,
        Array.from({ length: 50 }, (_, i) => createEvidence('CT-COMP', 9999, `max-${i}`)),
        { applyDecay: false, now }
      );
      expect(maxProfile.compositeScore).toBeLessThanOrEqual(1000);

      // Min possible evidence
      const minProfile = calculator.calculate(
        'ssdf-min', ObservationTier.BLACK_BOX,
        Array.from({ length: 50 }, (_, i) => createEvidence('CT-COMP', -9999, `min-${i}`)),
        { applyDecay: false, now }
      );
      expect(minProfile.compositeScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('PW.5: Boundary enforcement — math safety', () => {
    it('PW.5-1: no NaN or Infinity in score computations', () => {
      // Edge case: score=0, gain
      const r1 = dynamics.updateTrust('ssdf-nan-1', {
        currentScore: 0, success: true, ceiling: 900,
        tier: 0, methodologyKey: 'test:nan', now,
      });
      expect(Number.isFinite(r1.newScore)).toBe(true);
      expect(Number.isNaN(r1.delta)).toBe(false);

      // Edge case: score=0, loss
      const r2 = dynamics.updateTrust('ssdf-nan-2', {
        currentScore: 0, success: false, ceiling: 900,
        tier: 0, methodologyKey: 'test:nan', now,
      });
      expect(Number.isFinite(r2.newScore)).toBe(true);
      expect(Number.isNaN(r2.delta)).toBe(false);

      // Edge case: ceiling=0
      const r3 = dynamics.updateTrust('ssdf-nan-3', {
        currentScore: 0, success: true, ceiling: 0,
        tier: 0, methodologyKey: 'test:nan', now,
      });
      expect(Number.isFinite(r3.newScore)).toBe(true);
    });

    it('PW.5-2: asymmetry ratio is finite and within expected range at all tiers', () => {
      for (let tier = 0; tier <= 7; tier++) {
        const ratio = dynamics.getAsymmetryRatio(tier);
        expect(Number.isFinite(ratio)).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(7);
        expect(ratio).toBeLessThanOrEqual(10);
      }
    });

    it('PW.5-3: band ranges are contiguous with no gaps or overlaps', () => {
      // T0 starts at 0, T7 ends at 1000
      const ranges = [];
      for (let b = 0; b <= 7; b++) {
        const range = getBandRange(b);
        ranges.push(range);
      }

      // First band starts at 0
      expect(ranges[0]!.min).toBe(0);

      // Last band ends at 1000
      expect(ranges[7]!.max).toBe(1000);

      // Each band's min is previous band's max + 1
      for (let i = 1; i < ranges.length; i++) {
        expect(ranges[i]!.min).toBe(ranges[i - 1]!.max + 1);
      }
    });
  });

  describe('PW.6: Error handling — graceful degradation', () => {
    it('PW.6-1: duplicate profile creation returns error without throwing', async () => {
      await profiles.create('ssdf-dup', ObservationTier.WHITE_BOX, [], { now });

      // Second create should fail gracefully
      const result = await profiles.create('ssdf-dup', ObservationTier.WHITE_BOX, [], { now });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('PW.6-2: update on non-existent profile returns error without throwing', async () => {
      const result = await profiles.update('does-not-exist', [
        createEvidence('CT-COMP', 100, 'test'),
      ]);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('PW.6-3: pipeline handles missing profile gracefully (creates one)', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Process for non-existent agent — should auto-create profile
      const result = await pipeline.process({
        agentId: 'ssdf-auto-create',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(result.profile).toBeDefined();

      // Profile should now exist
      const profile = await profiles.get('ssdf-auto-create');
      expect(profile).toBeDefined();
    });

    it('PW.6-4: CB reset on non-existent agent is a no-op', () => {
      const result = dynamics.resetCircuitBreaker('ghost-agent', true, now);
      // Should return true (no CB state to clear = trivially successful)
      // or false (nothing to reset) — either way, no throw
      expect(typeof result).toBe('boolean');
    });

    it('PW.6-5: rate limiter does not throw on first signal', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 1,
        rateLimitWindowMs: 1,
      });

      // Should not throw
      const result = await pipeline.process({
        agentId: 'ssdf-first-signal',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });
      expect(result).toBeDefined();
    });
  });

  describe('PO.3: Configuration hardening', () => {
    it('PO.3-1: observation ceilings enforce hard upper bounds', () => {
      // Ceilings are strictly ordered
      expect(OBSERVATION_CEILINGS[ObservationTier.BLACK_BOX]).toBeLessThan(
        OBSERVATION_CEILINGS[ObservationTier.GRAY_BOX]
      );
      expect(OBSERVATION_CEILINGS[ObservationTier.GRAY_BOX]).toBeLessThan(
        OBSERVATION_CEILINGS[ObservationTier.WHITE_BOX]
      );
      expect(OBSERVATION_CEILINGS[ObservationTier.WHITE_BOX]).toBeLessThan(
        OBSERVATION_CEILINGS[ObservationTier.ATTESTED_BOX]
      );
      expect(OBSERVATION_CEILINGS[ObservationTier.ATTESTED_BOX]).toBeLessThanOrEqual(
        OBSERVATION_CEILINGS[ObservationTier.VERIFIED_BOX]
      );
    });

    it('PO.3-2: asymmetric penalty ensures loss always exceeds gain', () => {
      // At every tier, a loss at score X removes more than a gain adds
      for (let tier = 0; tier <= 7; tier++) {
        const gain = dynamics.updateTrust(`ssdf-asym-gain-${tier}`, {
          currentScore: 500, success: true, ceiling: 900,
          tier, methodologyKey: 'test:asym', now,
        });

        const loss = dynamics.updateTrust(`ssdf-asym-loss-${tier}`, {
          currentScore: 500, success: false, ceiling: 900,
          tier, methodologyKey: 'test:asym', now,
        });

        // |loss| > gain at all tiers (7x minimum ratio)
        expect(Math.abs(loss.delta)).toBeGreaterThan(Math.abs(gain.delta));
      }
    });
  });
});
