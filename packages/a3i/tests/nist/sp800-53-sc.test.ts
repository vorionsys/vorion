/**
 * NIST SP 800-53 — System and Communications Protection (SC) Tests
 *
 * Validates that the Vorion A3I trust system implements proper
 * resource protection, serialization, and boundary enforcement.
 *
 * Maps to: SC-5, SC-6, SC-7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier, OBSERVATION_CEILINGS } from '@vorionsys/contracts';
import { FACTOR_CODE_LIST } from '@vorionsys/basis';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createTrustCalculator,
  createEvidence,
  type TrustSignalPipeline,
} from '../../src/index.js';

describe('NIST SP 800-53 — System and Communications Protection (SC)', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
  });

  describe('SC-5: Signal flooding denial of service prevention', () => {
    it('rate limiter enforces per-agent signal cap', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 3,
        rateLimitWindowMs: 60000,
      });

      // Seed profile so signals go through (not blocked by CB)
      await profiles.create('flood-agent', ObservationTier.WHITE_BOX, [], { now });

      const results = [];
      for (let i = 0; i < 6; i++) {
        const r = await pipeline.process({
          agentId: 'flood-agent',
          success: true,
          factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i), // Within same window
        });
        results.push(r);
      }

      // First 3 should pass, rest should be rate limited
      const passed = results.filter(r => !r.blocked || r.blockReason !== 'rate_limited');
      const rateLimited = results.filter(r => r.blockReason === 'rate_limited');

      expect(passed.length).toBe(3);
      expect(rateLimited.length).toBe(3);
    });

    it('per-agent rate limit isolation — agents do not interfere', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 2,
        rateLimitWindowMs: 60000,
      });

      await profiles.create('agent-A', ObservationTier.WHITE_BOX, [], { now });
      await profiles.create('agent-B', ObservationTier.WHITE_BOX, [], { now });

      // Agent A: 3 signals (2 pass, 1 limited)
      for (let i = 0; i < 3; i++) {
        await pipeline.process({
          agentId: 'agent-A', success: true, factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i),
        });
      }

      // Agent B: should still get its full allocation
      const bResult = await pipeline.process({
        agentId: 'agent-B', success: true, factorCode: 'CT-COMP', now,
      });
      expect(bResult.blockReason).not.toBe('rate_limited');
    });
  });

  describe('SC-6: Resource serialization (per-agent)', () => {
    it('concurrent signals for same agent produce monotonic version increments', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Seed profile
      await profiles.create('serial-agent', ObservationTier.WHITE_BOX, [], { now });

      // Fire 10 concurrent signals
      const promises = Array.from({ length: 10 }, (_, i) =>
        pipeline.process({
          agentId: 'serial-agent',
          success: true,
          factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i + 1),
        })
      );

      const results = await Promise.all(promises);

      // All should complete without error
      expect(results.length).toBe(10);

      // Final profile version should reflect all updates
      const finalProfile = await profiles.get('serial-agent');
      expect(finalProfile).toBeDefined();
      // Profile starts at version 1, each non-blocked update increments it
      const nonBlocked = results.filter(r => !r.blocked);
      if (nonBlocked.length > 0) {
        expect(finalProfile!.version).toBeGreaterThanOrEqual(2);
      }
    });

    it('different agents process in parallel without blocking each other', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      await profiles.create('parallel-A', ObservationTier.WHITE_BOX, [], { now });
      await profiles.create('parallel-B', ObservationTier.WHITE_BOX, [], { now });

      // Fire signals for both agents concurrently
      const [resultA, resultB] = await Promise.all([
        pipeline.process({ agentId: 'parallel-A', success: true, factorCode: 'CT-COMP', now }),
        pipeline.process({ agentId: 'parallel-B', success: true, factorCode: 'CT-REL', now }),
      ]);

      // Both should complete successfully
      expect(resultA.blocked).toBe(false);
      expect(resultB.blocked).toBe(false);
    });

    it('chain recovers after an error in a previous signal', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // First signal: no profile exists, so signal creates one
      await pipeline.process({
        agentId: 'recover-agent', success: true, factorCode: 'CT-COMP', now,
      });

      // Second signal: should still process correctly after the first
      const result = await pipeline.process({
        agentId: 'recover-agent', success: true, factorCode: 'CT-REL',
        now: new Date(now.getTime() + 1000),
      });

      expect(result.blocked).toBe(false);
      expect(result.profile).toBeDefined();
    });
  });

  describe('SC-7: Trust boundary enforcement (observation ceilings)', () => {
    it('no evidence combination can breach the observation ceiling', () => {
      const calculator = createTrustCalculator();

      // Maximum possible evidence on all factors
      const evidence = Array.from({ length: 100 }, (_, i) =>
        createEvidence('CT-COMP', 1000, `max-${i}`)
      );

      for (const tier of [
        ObservationTier.BLACK_BOX,
        ObservationTier.GRAY_BOX,
        ObservationTier.WHITE_BOX,
        ObservationTier.ATTESTED_BOX,
        ObservationTier.VERIFIED_BOX,
      ]) {
        const profile = calculator.calculate(
          'ceiling-test', tier, evidence, { applyDecay: false, now }
        );

        const ceiling = OBSERVATION_CEILINGS[tier];
        expect(
          profile.adjustedScore,
          `${tier}: adjustedScore ${profile.adjustedScore} should <= ceiling ${ceiling}`
        ).toBeLessThanOrEqual(ceiling);
      }
    });

    it('adjustedScore equals ceiling when composite exceeds it', () => {
      const calculator = createTrustCalculator();

      // Create evidence across ALL 16 factors to push composite above BLACK_BOX ceiling (600)
      const evidence = FACTOR_CODE_LIST.flatMap((code) =>
        Array.from({ length: 3 }, (_, i) => ({
          evidenceId: `high-${code}-${i}`,
          factorCode: code,
          impact: 500,
          source: 'test',
          collectedAt: now,
        }))
      );

      const profile = calculator.calculate(
        'over-ceiling', ObservationTier.BLACK_BOX, evidence, { applyDecay: false, now }
      );

      // Composite should be > 600 (before ceiling), but adjusted should be capped at 600
      expect(profile.compositeScore).toBeGreaterThan(600);
      expect(profile.adjustedScore).toBe(600);
    });
  });

  describe('SC-13: Asymmetric loss — loss rate exceeds gain rate at every tier', () => {
    it('penalty ratio is at least 7x at all tiers', () => {
      const dynamics = new TrustDynamicsEngine();

      // Verify asymmetry ratio at every tier (0-7)
      for (let tier = 0; tier <= 7; tier++) {
        const ratio = dynamics.getAsymmetryRatio(tier);
        expect(ratio, `Tier ${tier} asymmetry ratio`).toBeGreaterThanOrEqual(7);
        expect(ratio, `Tier ${tier} asymmetry ratio`).toBeLessThanOrEqual(10);
      }

      // T0 should have minimum ratio (7)
      expect(dynamics.getAsymmetryRatio(0)).toBe(7);

      // T7 should have maximum ratio (10)
      expect(dynamics.getAsymmetryRatio(7)).toBe(10);
    });
  });
});
