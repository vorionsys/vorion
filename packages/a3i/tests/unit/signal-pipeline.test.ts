/**
 * Tests for TrustSignalPipeline (Pattern C: fast lane ↔ slow lane bridge)
 *
 * Zero-trust default: BASELINE_SCORE = 1. A new agent's first failure
 * immediately trips the hard CB. T0 Sandbox auto-resets in 15 minutes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  type TrustSignalPipeline,
} from '../../src/trust/index.js';

/** Helper: pre-seed a profile so the agent has adjustedScore ≈ 500 (above CB thresholds) */
async function seedProfile(
  profiles: TrustProfileService,
  agentId: string,
  now: Date,
  tier: ObservationTier = ObservationTier.WHITE_BOX
): Promise<void> {
  await profiles.create(agentId, tier, [], { now });
}

describe('TrustSignalPipeline', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-03T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  // ============================================================
  // Basic signal flow
  // ============================================================

  describe('basic signal flow', () => {
    it('creates a profile on first SUCCESS signal (not blocked)', async () => {
      // Success from baseline score 1: gain = 0.01 * ln(601) ≈ 0.064
      // newScore ≈ 1.064 — CB checks only apply on losses, so this proceeds
      const result = await pipeline.process({
        agentId: 'agent-1',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(result.blocked).toBe(false);
      expect(result.profile).not.toBeNull();
      expect(result.profile!.agentId).toBe('agent-1');
      expect(result.evidence).not.toBeNull();
      expect(result.evidence!.factorCode).toBe('CT-COMP');
      expect(result.evidence!.source).toBe('trust_dynamics');
      expect(result.evidence!.evidenceType).toBe('automated');
      expect(result.evidence!.impact).toBeGreaterThan(0);
    });

    it('zero-trust: first failure from new agent trips CB immediately', async () => {
      // Baseline = 1; loss delta ≈ -0.07; newScore ≈ 0.93 < 100 → hard trip
      const result = await pipeline.process({
        agentId: 'agent-zt',
        success: false,
        factorCode: 'SA-SAFE',
        now,
      });

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('circuit_breaker');
      expect(result.evidence).toBeNull();
      expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);
    });

    it('updates existing profile on subsequent success signal', async () => {
      // Seed a profile first so score is above thresholds
      await seedProfile(profiles, 'agent-3', now);

      const first = await pipeline.process({
        agentId: 'agent-3',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });
      const firstVersion = first.profile!.version;

      // Second success — no cooldown after success, proceeds normally
      const later = new Date(now.getTime() + 60_000);
      const second = await pipeline.process({
        agentId: 'agent-3',
        success: true,
        factorCode: 'CT-COMP',
        now: later,
      });

      expect(second.blocked).toBe(false);
      expect(second.profile!.version).toBeGreaterThan(firstVersion);
    });

    it('evidence delta matches dynamics result delta', async () => {
      // Use success (not failure) to avoid CB trip from baseline=1
      const result = await pipeline.process({
        agentId: 'agent-4',
        success: true,
        factorCode: 'OP-ALIGN',
        now,
      });

      expect(result.blocked).toBe(false);
      expect(result.evidence!.impact).toBe(result.dynamicsResult.delta);
    });

    it('evidence is written with correct collectedAt timestamp', async () => {
      const result = await pipeline.process({
        agentId: 'agent-ts',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(result.evidence!.collectedAt).toEqual(now);
    });
  });

  // ============================================================
  // Blocking behaviour
  // ============================================================

  describe('blocking behaviour', () => {
    it('blocks gain during cooldown after a loss (seeded agent)', async () => {
      // Seed profile at score ≈ 500 so first failure doesn't trip CB (500 - 35 = 465 > 100)
      await seedProfile(profiles, 'agent-cd', now);

      // Loss — cooldown starts, no CB (465 > 100)
      await pipeline.process({ agentId: 'agent-cd', success: false, factorCode: 'SA-SAFE', now });

      // 1 minute later: cooldown still active (168h), gain is blocked
      const later = new Date(now.getTime() + 60_000);
      const result = await pipeline.process({
        agentId: 'agent-cd',
        success: true,
        factorCode: 'SA-SAFE',
        now: later,
      });

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('cooldown');
      expect(result.evidence).toBeNull();
    });

    it('does not block a loss during cooldown (seeded agent)', async () => {
      await seedProfile(profiles, 'agent-lcd', now);

      // First loss — cooldown starts
      await pipeline.process({ agentId: 'agent-lcd', success: false, factorCode: 'SA-SAFE', now });

      // Second loss 1min later — losses pass through cooldown
      const later = new Date(now.getTime() + 60_000);
      const result = await pipeline.process({
        agentId: 'agent-lcd',
        success: false,
        factorCode: 'SA-SAFE',
        now: later,
      });

      expect(result.blocked).toBe(false);
      expect(result.evidence!.impact).toBeLessThan(0);
    });

    it('blocks when circuit breaker trips (score below threshold)', async () => {
      // Extreme penalty drives score from 1 straight to ~0 < 100 → hard trip
      const extremeDynamics = new TrustDynamicsEngine({
        penaltyRatioMin: 900,
        penaltyRatioMax: 1000,
      });
      const extremePipeline = createSignalPipeline(extremeDynamics, profiles);

      const result = await extremePipeline.process({
        agentId: 'agent-extreme',
        success: false,
        factorCode: 'SA-SAFE',
        now,
      });

      expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('circuit_breaker');
      expect(result.evidence).toBeNull();
    });

    it('blocks subsequent signals when circuit breaker is already tripped', async () => {
      // First failure trips CB (zero-trust: baseline=1 → score<100 immediately)
      await pipeline.process({ agentId: 'agent-post-cb', success: false, factorCode: 'SA-SAFE', now });

      // Second attempt also blocked
      const result = await pipeline.process({
        agentId: 'agent-post-cb',
        success: true,
        factorCode: 'SA-SAFE',
        now: new Date(now.getTime() + 1000),
      });

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('circuit_breaker');
    });

    it('blocks on repeat methodology failures (circuit breaker)', async () => {
      const freshDynamics = new TrustDynamicsEngine({
        methodologyFailureThreshold: 3,
        methodologyWindowHours: 72,
      });
      const freshProfiles = new TrustProfileService();
      const freshPipeline = createSignalPipeline(freshDynamics, freshProfiles);

      const agentId = 'agent-repeat';
      // Seed a profile so the agent has score ~500 (avoids CB on score threshold)
      await seedProfile(freshProfiles, agentId, now);

      const key = 'safety:blocked_content';
      const results: Array<Awaited<ReturnType<typeof freshPipeline.process>>> = [];
      for (let i = 0; i < 3; i++) {
        const t = new Date(now.getTime() + i * 60_000);
        results.push(
          await freshPipeline.process({
            agentId,
            success: false,
            factorCode: 'SA-SAFE',
            methodologyKey: key,
            now: t,
          })
        );
      }

      const third = results[2]!;
      expect(third.dynamicsResult.circuitBreakerTripped).toBe(true);
      expect(third.dynamicsResult.circuitBreakerReason).toBe(`repeat_methodology_failure:${key}`);
      expect(third.blocked).toBe(true);
      expect(third.blockReason).toBe('circuit_breaker');
    });
  });

  // ============================================================
  // Degraded circuit breaker (soft CB)
  // ============================================================

  describe('degraded circuit breaker', () => {
    it('enters degraded mode when score drops into warning zone (100-200)', async () => {
      const agentId = 'agent-deg';
      const customDynamics = new TrustDynamicsEngine();
      const customProfiles = new TrustProfileService();
      const customPipeline = createSignalPipeline(customDynamics, customProfiles);

      // Seed all 16 real factors at impact -300 → factor = 0.5 - 0.3 = 0.2 each
      // composite = 0.2 * 1000 = 200 → adjustedScore = 200 (exactly at degradedThreshold)
      const allNeg = ['CT-COMP','CT-REL','CT-OBS','CT-TRANS','CT-ACCT','CT-SAFE',
                      'CT-SEC','CT-PRIV','CT-ID','OP-HUMAN','OP-ALIGN','OP-CONTEXT',
                      'OP-STEW','SF-HUM','SF-ADAPT','SF-LEARN'];
      await customProfiles.create(agentId, ObservationTier.WHITE_BOX,
        allNeg.map((fc, i) => ({ evidenceId: `e${i}`, factorCode: fc, impact: -300, source: 'test', collectedAt: now })),
        { now }
      );

      // Loss from score 200: delta = -0.07 * 200 = -14 → newScore = 186
      // 186 >= 100 (not hard trip) AND 186 < 200 (degradedThreshold) → DEGRADED ✓
      const result = await customPipeline.process({
        agentId,
        success: false,
        factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 1000),
      });

      expect(customDynamics.isCircuitBreakerDegraded(agentId)).toBe(true);
      expect(result.dynamicsResult.circuitBreakerDegraded).toBe(true);
      expect(result.dynamicsResult.circuitBreakerTripped).toBe(false);
      // Loss still went through (evidence written)
      expect(result.blocked).toBe(false);
      expect(result.evidence!.impact).toBeLessThan(0);
    });

    it('degraded mode blocks gains but allows losses', async () => {
      // Use custom engine that auto-resets quickly (very long timeout to avoid auto-reset in test)
      const eng = new TrustDynamicsEngine({ cbDegradedAutoResetMinutes: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] });
      const svc = new TrustProfileService();
      const pl = createSignalPipeline(eng, svc);
      const agentId = 'agent-deg-block';

      // Seed all 16 real factors at impact -300 → score ~200 (exactly at degradedThreshold)
      const allNeg = ['CT-COMP','CT-REL','CT-OBS','CT-TRANS','CT-ACCT','CT-SAFE',
                      'CT-SEC','CT-PRIV','CT-ID','OP-HUMAN','OP-ALIGN','OP-CONTEXT',
                      'OP-STEW','SF-HUM','SF-ADAPT','SF-LEARN'];
      await svc.create(agentId, ObservationTier.WHITE_BOX,
        allNeg.map((fc, i) => ({ evidenceId: `e${i}`, factorCode: fc, impact: -300, source: 'test', collectedAt: now })),
        { now }
      );

      // First: loss drives into degraded
      await pl.process({ agentId, success: false, factorCode: 'CT-COMP', now: new Date(now.getTime() + 1000) });
      expect(eng.isCircuitBreakerDegraded(agentId)).toBe(true);

      // Gain attempt → blocked by degraded
      const gainResult = await pl.process({ agentId, success: true, factorCode: 'CT-COMP', now: new Date(now.getTime() + 2000) });
      expect(gainResult.blocked).toBe(true);
      expect(gainResult.blockReason).toBe('degraded');

      // Another loss → not blocked (losses still apply in degraded)
      const lossResult = await pl.process({ agentId, success: false, factorCode: 'CT-COMP', now: new Date(now.getTime() + 3000) });
      expect(lossResult.blocked).toBe(false);
      expect(lossResult.evidence!.impact).toBeLessThan(0);
    });

    it('T0 sandbox CB auto-resets in 15 minutes', async () => {
      // Zero-trust default: first failure from score 1 trips CB
      await pipeline.process({ agentId: 'agent-t0', success: false, factorCode: 'SA-SAFE', now });
      expect(dynamics.isCircuitBreakerTripped('agent-t0')).toBe(true);

      // 14 minutes later: still blocked
      const t14 = new Date(now.getTime() + 14 * 60_000);
      const stillBlocked = await pipeline.process({ agentId: 'agent-t0', success: true, factorCode: 'SA-SAFE', now: t14 });
      expect(stillBlocked.blocked).toBe(true);

      // 16 minutes later: auto-reset (T0: 15min), gain proceeds
      const t16 = new Date(now.getTime() + 16 * 60_000);
      const recovered = await pipeline.process({ agentId: 'agent-t0', success: true, factorCode: 'SA-SAFE', now: t16 });
      expect(dynamics.isCircuitBreakerTripped('agent-t0')).toBe(false);
      expect(recovered.blocked).toBe(false);
    });

    it('escalates degraded → tripped when score drops below hard threshold', async () => {
      // Prove the state machine transition: normal → degraded → tripped.
      // We test via the dynamics engine directly since the pipeline's slow-lane
      // evidence averaging makes sustained low scores hard to control across calls.
      const eng = new TrustDynamicsEngine();
      const svc = new TrustProfileService();
      const pl = createSignalPipeline(eng, svc);
      const agentId = 'agent-escalate';

      // Seed all 16 real factors at score ~150
      // factor = 0.5 - 0.35 = 0.15 each → composite = 150
      const allNeg = ['CT-COMP','CT-REL','CT-OBS','CT-TRANS','CT-ACCT','CT-SAFE',
                      'CT-SEC','CT-PRIV','CT-ID','OP-HUMAN','OP-ALIGN','OP-CONTEXT',
                      'OP-STEW','SF-HUM','SF-ADAPT','SF-LEARN'];
      await svc.create(agentId, ObservationTier.WHITE_BOX,
        allNeg.map((fc, i) => ({ evidenceId: `e${i}`, factorCode: fc, impact: -350, source: 'test', collectedAt: now })),
        { now }
      );

      // Step 1 — pipeline loss from score ~150:
      //   delta = -0.07 * 150 = -10.5 → newScore = 139.5 → in warning zone → DEGRADED
      const t1 = new Date(now.getTime() + 1000);
      await pl.process({ agentId, success: false, factorCode: 'CT-COMP', now: t1 });
      expect(eng.isCircuitBreakerDegraded(agentId)).toBe(true);

      // Step 2 — dynamics loss with score already below hard threshold → TRIPPED
      //   Direct engine call with currentScore=95: delta = -0.07*95 = -6.65
      //   newScore = 88.35 < circuitBreakerThreshold(100) → escalates to hard trip
      const t2 = new Date(now.getTime() + 2000);
      const escalate = eng.updateTrust(agentId, {
        currentScore: 95,
        success: false,
        ceiling: 900,
        tier: 0,
        now: t2,
      });
      expect(eng.isCircuitBreakerTripped(agentId)).toBe(true);
      expect(escalate.circuitBreakerReason).toBe('trust_below_threshold');
    });
  });

  // ============================================================
  // methodologyKey handling
  // ============================================================

  describe('methodologyKey handling', () => {
    it('defaults methodologyKey to factorCode when not specified', async () => {
      const eng = new TrustDynamicsEngine({ methodologyFailureThreshold: 2, methodologyWindowHours: 1 });
      const svc = new TrustProfileService();
      const pl = createSignalPipeline(eng, svc);
      const agentId = 'agent-mk-default';

      await seedProfile(svc, agentId, now);

      for (let i = 0; i < 2; i++) {
        await pl.process({ agentId, success: false, factorCode: 'CT-COMP', now: new Date(now.getTime() + i * 1000) });
      }

      expect(eng.isCircuitBreakerTripped(agentId)).toBe(true);
    });
  });

  // ============================================================
  // Configuration
  // ============================================================

  describe('configuration', () => {
    it('uses defaultObservationTier for new agents', async () => {
      const customPipeline = createSignalPipeline(dynamics, profiles, {
        defaultObservationTier: ObservationTier.GRAY_BOX,
      });

      const result = await customPipeline.process({
        agentId: 'agent-tier',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(result.profile!.observationTier).toBe(ObservationTier.GRAY_BOX);
    });

    it('uses custom evidenceSource label', async () => {
      const customPipeline = createSignalPipeline(dynamics, profiles, {
        evidenceSource: 'canary_probe',
      });

      const result = await customPipeline.process({
        agentId: 'agent-src',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(result.evidence!.source).toBe('canary_probe');
    });
  });

  // ============================================================
  // Round-trip: slow lane score feeds fast lane
  // ============================================================

  describe('round-trip: slow lane score feeds fast lane', () => {
    it('uses profile adjustedScore as currentScore for fast lane', async () => {
      const agentId = 'agent-loop';

      await profiles.create(agentId, ObservationTier.WHITE_BOX, [
        { evidenceId: 'e1', factorCode: 'CT-COMP', impact: 300, source: 'test', collectedAt: now },
      ], { now });

      const profile = await profiles.get(agentId);
      const knownScore = profile!.adjustedScore;
      expect(knownScore).toBeGreaterThan(0);

      // Failure: delta = -0.07 * knownScore (proportional to actual score, not 0)
      const result = await pipeline.process({
        agentId,
        success: false,
        factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 1000),
      });

      expect(result.dynamicsResult.delta).toBeLessThan(0);
      expect(Math.abs(result.dynamicsResult.delta)).toBeGreaterThan(0);
    });

    it('zero-trust: new agent uses BASELINE_SCORE=1 (not 500)', async () => {
      // From score 1, a failure trips CB (newScore ≈ 0.93 < 100)
      // confirming BASELINE_SCORE is 1, not 500
      const result = await pipeline.process({
        agentId: 'agent-zt-baseline',
        success: false,
        factorCode: 'CT-COMP',
        now,
      });

      // If baseline were 500: score would drop to 465 (no CB)
      // Since baseline is 1: score drops to ~0.93 → hard CB
      expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);
      expect(result.blocked).toBe(true);
    });
  });
});
