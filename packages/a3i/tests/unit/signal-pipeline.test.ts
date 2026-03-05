/**
 * Tests for TrustSignalPipeline (Pattern C: fast lane ↔ slow lane bridge)
 *
 * Zero-trust default: BASELINE_SCORE = 1. A new agent's first failure
 * immediately trips the hard CB. T0 Sandbox auto-resets in 15 minutes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  // Per-agent serialization (P1)
  // ============================================================

  describe('per-agent serialization', () => {
    it('serializes concurrent signals for the same agent', async () => {
      // Seed a profile so score is above CB thresholds
      await seedProfile(profiles, 'agent-serial', now);

      // Fire 5 concurrent success signals for the same agent
      const signals = Array.from({ length: 5 }, (_, i) =>
        pipeline.process({
          agentId: 'agent-serial',
          success: true,
          factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i * 100),
        })
      );

      const results = await Promise.all(signals);

      // All should succeed (serialized, no race condition)
      for (const r of results) {
        expect(r.blocked).toBe(false);
        expect(r.evidence).not.toBeNull();
      }

      // Profile versions should increment monotonically (serialized writes)
      const versions = results.map(r => r.profile!.version);
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]!);
      }
    });

    it('allows concurrent signals for different agents', async () => {
      // Two different agents can process in parallel without blocking each other
      await seedProfile(profiles, 'agent-a', now);
      await seedProfile(profiles, 'agent-b', now);

      const [resultA, resultB] = await Promise.all([
        pipeline.process({
          agentId: 'agent-a',
          success: true,
          factorCode: 'CT-COMP',
          now,
        }),
        pipeline.process({
          agentId: 'agent-b',
          success: true,
          factorCode: 'CT-COMP',
          now,
        }),
      ]);

      expect(resultA.blocked).toBe(false);
      expect(resultB.blocked).toBe(false);
      expect(resultA.profile!.agentId).toBe('agent-a');
      expect(resultB.profile!.agentId).toBe('agent-b');
    });

    it('continues processing after a previous signal in the chain fails', async () => {
      // Override profile service to fail on first get, succeed on second
      const failingProfiles = new TrustProfileService();
      let callCount = 0;
      const originalGet = failingProfiles.get.bind(failingProfiles);
      failingProfiles.get = async (agentId: string) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient DB error');
        }
        return originalGet(agentId);
      };

      const failPipeline = createSignalPipeline(dynamics, failingProfiles);

      // First call will fail (due to injected error)
      const p1 = failPipeline.process({
        agentId: 'agent-fail',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // Second call should still succeed (chained after first)
      const p2 = failPipeline.process({
        agentId: 'agent-fail',
        success: true,
        factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 1000),
      });

      await expect(p1).rejects.toThrow('Transient DB error');
      const result2 = await p2;
      expect(result2.blocked).toBe(false);
    });
  });

  // ============================================================
  // dispatchSignal (P1)
  // ============================================================

  describe('dispatchSignal', () => {
    it('processes signal without awaiting', async () => {
      // dispatchSignal is fire-and-forget but still routes through process()
      await seedProfile(profiles, 'agent-dispatch', now);

      pipeline.dispatchSignal({
        agentId: 'agent-dispatch',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // Wait for the microtask queue to flush
      await new Promise(resolve => setTimeout(resolve, 50));

      // Profile should have been updated
      const profile = await profiles.get('agent-dispatch');
      expect(profile).not.toBeNull();
      expect(profile!.version).toBeGreaterThanOrEqual(1);
    });

    it('calls onDispatchError when processing fails', async () => {
      const errors: Array<{ error: unknown; agentId: string }> = [];
      const errorHandler = (error: unknown, signal: { agentId: string }) => {
        errors.push({ error, agentId: signal.agentId });
      };

      // Create a profile service that always fails
      const brokenProfiles = new TrustProfileService();
      brokenProfiles.get = async () => { throw new Error('DB down'); };

      const brokenPipeline = createSignalPipeline(dynamics, brokenProfiles, {
        onDispatchError: errorHandler,
      });

      brokenPipeline.dispatchSignal({
        agentId: 'agent-broken',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // Wait for the microtask queue to flush
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errors.length).toBe(1);
      expect(errors[0]!.agentId).toBe('agent-broken');
      expect((errors[0]!.error as Error).message).toBe('DB down');
    });

    it('uses default error handler (console.error) when no custom handler provided', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const brokenProfiles = new TrustProfileService();
      brokenProfiles.get = async () => { throw new Error('Network error'); };

      // No custom onDispatchError — should use default console.error
      const defaultPipeline = createSignalPipeline(dynamics, brokenProfiles);

      defaultPipeline.dispatchSignal({
        agentId: 'agent-default-err',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ============================================================
  // Rate limiting (P2)
  // ============================================================

  describe('rate limiting', () => {
    it('drops signals when rate limit is exceeded', async () => {
      const ratePipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 3,
        rateLimitWindowMs: 60_000,
      });
      await seedProfile(profiles, 'agent-rl', now);

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(
          await ratePipeline.process({
            agentId: 'agent-rl',
            success: true,
            factorCode: 'CT-COMP',
            now: new Date(now.getTime() + i * 100), // all within the same window
          })
        );
      }

      // First 3 should succeed, 4th and 5th should be rate limited
      expect(results[0]!.blocked).toBe(false);
      expect(results[1]!.blocked).toBe(false);
      expect(results[2]!.blocked).toBe(false);
      expect(results[3]!.blocked).toBe(true);
      expect(results[3]!.blockReason).toBe('rate_limited');
      expect(results[4]!.blocked).toBe(true);
      expect(results[4]!.blockReason).toBe('rate_limited');
    });

    it('allows signals after the rate limit window expires', async () => {
      const ratePipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 2,
        rateLimitWindowMs: 1_000, // 1 second window
      });
      await seedProfile(profiles, 'agent-rl2', now);

      // Use up the limit
      await ratePipeline.process({ agentId: 'agent-rl2', success: true, factorCode: 'CT-COMP', now });
      await ratePipeline.process({
        agentId: 'agent-rl2', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 100),
      });

      // 3rd within window — blocked
      const blocked = await ratePipeline.process({
        agentId: 'agent-rl2', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 200),
      });
      expect(blocked.blockReason).toBe('rate_limited');

      // After window expires — should succeed
      const afterWindow = await ratePipeline.process({
        agentId: 'agent-rl2', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 1500),
      });
      expect(afterWindow.blocked).toBe(false);
    });

    it('rate limits are per-agent (different agents have separate counters)', async () => {
      const ratePipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 1,
        rateLimitWindowMs: 60_000,
      });
      await seedProfile(profiles, 'agent-rl-a', now);
      await seedProfile(profiles, 'agent-rl-b', now);

      // Each agent gets 1 signal
      const a = await ratePipeline.process({
        agentId: 'agent-rl-a', success: true, factorCode: 'CT-COMP', now,
      });
      const b = await ratePipeline.process({
        agentId: 'agent-rl-b', success: true, factorCode: 'CT-COMP', now,
      });

      expect(a.blocked).toBe(false);
      expect(b.blocked).toBe(false);

      // Second signal for agent-a is blocked, but agent-b could still go (already used its 1)
      const a2 = await ratePipeline.process({
        agentId: 'agent-rl-a', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 100),
      });
      expect(a2.blockReason).toBe('rate_limited');
    });

    it('does not rate limit when disabled (rateLimitPerAgent=0)', async () => {
      // Default config has rateLimitPerAgent=0
      await seedProfile(profiles, 'agent-no-rl', now);

      const results = [];
      for (let i = 0; i < 20; i++) {
        results.push(
          await pipeline.process({
            agentId: 'agent-no-rl',
            success: true,
            factorCode: 'CT-COMP',
            now: new Date(now.getTime() + i * 100),
          })
        );
      }

      // None should be rate limited (might be blocked for other reasons like cooldown)
      expect(results.filter(r => r.blockReason === 'rate_limited').length).toBe(0);
    });
  });

  // ============================================================
  // Audit trail - onBlocked (P2)
  // ============================================================

  describe('audit trail (onBlocked)', () => {
    it('emits BlockedSignalEvent on circuit breaker trip', async () => {
      const blocked: Array<{ reason: string; agentId: string }> = [];
      const auditPipeline = createSignalPipeline(dynamics, profiles, {
        onBlocked: (event) => {
          blocked.push({ reason: event.blockReason, agentId: event.agentId });
        },
      });

      // Zero-trust: first failure trips CB
      await auditPipeline.process({
        agentId: 'agent-audit-cb',
        success: false,
        factorCode: 'SA-SAFE',
        now,
      });

      expect(blocked.length).toBe(1);
      expect(blocked[0]!.reason).toBe('circuit_breaker');
      expect(blocked[0]!.agentId).toBe('agent-audit-cb');
    });

    it('emits BlockedSignalEvent on rate limit', async () => {
      const blocked: Array<{ reason: string; factorCode: string }> = [];
      const auditPipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 1,
        rateLimitWindowMs: 60_000,
        onBlocked: (event) => {
          blocked.push({ reason: event.blockReason, factorCode: event.factorCode });
        },
      });
      await seedProfile(profiles, 'agent-audit-rl', now);

      // First goes through
      await auditPipeline.process({
        agentId: 'agent-audit-rl', success: true, factorCode: 'CT-COMP', now,
      });
      // Second is rate limited
      await auditPipeline.process({
        agentId: 'agent-audit-rl', success: true, factorCode: 'CT-REL',
        now: new Date(now.getTime() + 100),
      });

      expect(blocked.length).toBe(1);
      expect(blocked[0]!.reason).toBe('rate_limited');
      expect(blocked[0]!.factorCode).toBe('CT-REL');
    });

    it('does not emit onBlocked for successful signals', async () => {
      const blocked: string[] = [];
      const auditPipeline = createSignalPipeline(dynamics, profiles, {
        onBlocked: (event) => { blocked.push(event.blockReason); },
      });
      await seedProfile(profiles, 'agent-audit-ok', now);

      await auditPipeline.process({
        agentId: 'agent-audit-ok', success: true, factorCode: 'CT-COMP', now,
      });

      expect(blocked.length).toBe(0);
    });
  });

  // ============================================================
  // Metrics - onSignalProcessed (P3)
  // ============================================================

  describe('metrics (onSignalProcessed)', () => {
    it('emits metrics for every signal (blocked and unblocked)', async () => {
      const metrics: Array<{ blocked: boolean; delta: number; agentId: string }> = [];
      const metricsPipeline = createSignalPipeline(dynamics, profiles, {
        onSignalProcessed: (m) => {
          metrics.push({ blocked: m.blocked, delta: m.delta, agentId: m.agentId });
        },
      });
      await seedProfile(profiles, 'agent-metrics', now);

      // Success signal (not blocked)
      await metricsPipeline.process({
        agentId: 'agent-metrics', success: true, factorCode: 'CT-COMP', now,
      });

      expect(metrics.length).toBe(1);
      expect(metrics[0]!.blocked).toBe(false);
      expect(metrics[0]!.delta).toBeGreaterThan(0);
    });

    it('emits metrics with correct blockReason on blocked signal', async () => {
      const metrics: Array<{ blockReason?: string }> = [];
      const metricsPipeline = createSignalPipeline(dynamics, profiles, {
        onSignalProcessed: (m) => { metrics.push({ blockReason: m.blockReason }); },
      });

      // Zero-trust failure → CB trip
      await metricsPipeline.process({
        agentId: 'agent-metrics-cb', success: false, factorCode: 'SA-SAFE', now,
      });

      expect(metrics.length).toBe(1);
      expect(metrics[0]!.blockReason).toBe('circuit_breaker');
    });

    it('includes durationMs in metrics', async () => {
      const durations: number[] = [];
      const metricsPipeline = createSignalPipeline(dynamics, profiles, {
        onSignalProcessed: (m) => { durations.push(m.durationMs); },
      });
      await seedProfile(profiles, 'agent-dur', now);

      await metricsPipeline.process({
        agentId: 'agent-dur', success: true, factorCode: 'CT-COMP', now,
      });

      expect(durations.length).toBe(1);
      expect(durations[0]).toBeGreaterThanOrEqual(0);
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
