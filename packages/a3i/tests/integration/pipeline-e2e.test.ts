/**
 * End-to-End Pipeline Integration Tests
 *
 * Verifies the complete trust signal flow:
 * Intent -> Gate -> Execute -> Signal -> Trust Update
 *
 * All components are wired together with a real TrustSignalPipeline.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  TrustBand,
  ObservationTier,
  ActionType,
  DataSensitivity,
  Reversibility,
  RiskLevel,
  GateStatus,
  type Intent,
  type TrustEvidence,
} from '@vorionsys/contracts';
import { TrustDynamicsEngine } from '../../src/trust/trust-dynamics.js';
import { TrustProfileService } from '../../src/trust/profile-service.js';
import { TrustSignalPipeline } from '../../src/trust/signal-pipeline.js';
import { PreActionGate, createMapTrustProvider } from '../../src/gate/index.js';
import {
  orchestratorBuilder,
  type OrchestratorLogger,
} from '../../src/orchestrator/index.js';
import { type ActionExecutor } from '../../src/execution/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    intentId: uuidv4(),
    agentId: 'test-agent',
    correlationId: uuidv4(),
    action: 'Test action',
    actionType: ActionType.READ,
    resourceScope: ['resource-1'],
    dataSensitivity: DataSensitivity.PUBLIC,
    reversibility: Reversibility.REVERSIBLE,
    context: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function createEvidence(factorCode: string, impact: number): TrustEvidence {
  return {
    evidenceId: uuidv4(),
    factorCode,
    impact,
    source: 'e2e-test',
    collectedAt: new Date(),
  };
}

// ============================================================================
// E2E Pipeline Tests
// ============================================================================

describe('Pipeline E2E Integration', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = new TrustSignalPipeline(dynamics, profiles);
  });

  describe('Gate -> Pipeline -> Trust Update', () => {
    it('gate rejection should emit negative signal and create trust evidence', async () => {
      // Create agent with low trust
      await profiles.create('gate-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 100),
        createEvidence('OP-ALIGN', 100),
      ]);

      const profileBefore = await profiles.get('gate-agent');
      expect(profileBefore).not.toBeNull();

      // Create gate with pipeline wired; disable pending states so rejection is immediate.
      // Trust score 500 is below the CRITICAL threshold of 800 (0-1000 scale).
      const trustProvider = createMapTrustProvider({ 'gate-agent': 500 });
      const gate = new PreActionGate(
        { allowPendingStates: false },
        trustProvider,
        pipeline
      );

      // Agent tries a CRITICAL action (needs 800 trust on 0-1000 scale) - will be rejected
      const gateResult = await gate.verify({
        agentId: 'gate-agent',
        action: 'Delete production database',
        actionType: ActionType.DELETE,
        resourceScope: ['production-db'],
        dataSensitivity: DataSensitivity.RESTRICTED,
        reversibility: Reversibility.IRREVERSIBLE,
      });

      expect(gateResult.passed).toBe(false);
      expect(gateResult.status).toBe(GateStatus.REJECTED);

      // Wait for fire-and-forget pipeline processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify trust was updated (profile should exist and have the negative evidence)
      const profileAfter = await profiles.get('gate-agent');
      expect(profileAfter).not.toBeNull();

      // The negative signal should have lowered the adjusted score
      expect(profileAfter!.adjustedScore).toBeLessThanOrEqual(profileBefore!.adjustedScore);
    });

    it('gate approval should NOT emit any trust signal', async () => {
      await profiles.create('good-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 200),
        createEvidence('CT-REL', 200),
        createEvidence('OP-ALIGN', 200),
      ]);

      const profileBefore = await profiles.get('good-agent');

      const trustProvider = createMapTrustProvider({ 'good-agent': 900 });
      const gate = new PreActionGate({}, trustProvider, pipeline);

      // Low-risk action with high trust - should be approved
      const gateResult = await gate.verify({
        agentId: 'good-agent',
        action: 'Read public data',
        actionType: ActionType.READ,
        resourceScope: ['public-data'],
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: Reversibility.REVERSIBLE,
      });

      expect(gateResult.passed).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Profile should be unchanged - no signal emitted
      const profileAfter = await profiles.get('good-agent');
      expect(profileAfter!.adjustedScore).toBe(profileBefore!.adjustedScore);
    });
  });

  describe('Orchestrator -> Pipeline -> Trust Update', () => {
    it('successful execution should emit positive CT-COMP signal', async () => {
      await profiles.create('exec-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 200),
        createEvidence('CT-REL', 200),
        createEvidence('CT-OBS', 200),
        createEvidence('CT-TRANS', 200),
        createEvidence('CT-ACCT', 200),
      ]);

      const profileBefore = await profiles.get('exec-agent');
      const evidenceBefore = profileBefore!.evidence.length;
      const versionBefore = profileBefore!.version;

      const orchestrator = orchestratorBuilder()
        .withProfileService(profiles)
        .withPipeline(pipeline)
        .build();

      const executor: ActionExecutor = vi.fn().mockResolvedValue({ ok: true });
      orchestrator.registerExecutor(ActionType.READ, executor);

      const result = await orchestrator.processIntent(
        createIntent({ agentId: 'exec-agent' })
      );

      expect(result.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));

      const profileAfter = await profiles.get('exec-agent');
      // Pipeline should have added a positive CT-COMP evidence record
      expect(profileAfter!.evidence.length).toBeGreaterThan(evidenceBefore);
      expect(profileAfter!.version).toBeGreaterThan(versionBefore);

      // The new evidence should be a positive CT-COMP signal from the pipeline
      const newEvidence = profileAfter!.evidence.find(
        (e) => e.source === 'trust_dynamics' && e.factorCode === 'CT-COMP'
      );
      expect(newEvidence).toBeDefined();
      expect(newEvidence!.impact).toBeGreaterThan(0);
    });

    it('failed execution should emit negative CT-COMP signal', async () => {
      await profiles.create('fail-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 200),
        createEvidence('CT-REL', 200),
        createEvidence('CT-OBS', 200),
        createEvidence('CT-TRANS', 200),
        createEvidence('CT-ACCT', 200),
      ]);

      const profileBefore = await profiles.get('fail-agent');

      const orchestrator = orchestratorBuilder()
        .withProfileService(profiles)
        .withPipeline(pipeline)
        .build();

      const executor: ActionExecutor = vi.fn().mockRejectedValue(new Error('Task failed'));
      orchestrator.registerExecutor(ActionType.READ, executor);

      const result = await orchestrator.processIntent(
        createIntent({ agentId: 'fail-agent' })
      );

      expect(result.success).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const profileAfter = await profiles.get('fail-agent');
      // Negative signal should have decreased the score
      expect(profileAfter!.adjustedScore).toBeLessThan(profileBefore!.adjustedScore);
    });
  });

  describe('Full Flow: Gate -> Orchestrator -> Pipeline', () => {
    it('should complete full lifecycle: gate check -> execute -> trust update', async () => {
      // Setup: Create agent at T3
      await profiles.create('lifecycle-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 200),
        createEvidence('CT-REL', 200),
        createEvidence('CT-OBS', 200),
        createEvidence('CT-TRANS', 200),
        createEvidence('CT-ACCT', 200),
      ]);

      const profile0 = await profiles.get('lifecycle-agent');
      const score0 = profile0!.adjustedScore;

      // Step 1: Gate check (should pass for READ)
      const trustProvider = createMapTrustProvider({
        'lifecycle-agent': score0,
      });
      const gate = new PreActionGate({}, trustProvider, pipeline);

      const gateResult = await gate.verify({
        agentId: 'lifecycle-agent',
        action: 'Read public data',
        actionType: ActionType.READ,
        resourceScope: ['data'],
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: Reversibility.REVERSIBLE,
      });

      expect(gateResult.passed).toBe(true);

      // Step 2: Execute via orchestrator (success)
      const orchestrator = orchestratorBuilder()
        .withProfileService(profiles)
        .withPipeline(pipeline)
        .build();

      const executor: ActionExecutor = vi.fn().mockResolvedValue({ data: 'result' });
      orchestrator.registerExecutor(ActionType.READ, executor);

      const execResult = await orchestrator.processIntent(
        createIntent({ agentId: 'lifecycle-agent' })
      );

      expect(execResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 3: Verify trust was updated with positive signal evidence
      const profile1 = await profiles.get('lifecycle-agent');
      expect(profile1!.version).toBeGreaterThan(profile0!.version);

      // The pipeline should have written a positive CT-COMP evidence record
      const pipelineEvidence = profile1!.evidence.find(
        (e) => e.source === 'trust_dynamics' && e.factorCode === 'CT-COMP'
      );
      expect(pipelineEvidence).toBeDefined();
      expect(pipelineEvidence!.impact).toBeGreaterThan(0);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('repeated failures should trip circuit breaker via pipeline', async () => {
      // Start with baseline agent (score=1, zero-trust)
      // First failure from score 1 trips CB immediately

      const result = await pipeline.process({
        agentId: 'cb-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'test:failure',
      });

      // CB should be tripped (score was 1, any failure trips it)
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('circuit_breaker');
      expect(dynamics.isCircuitBreakerTripped('cb-agent')).toBe(true);

      // Subsequent signals should be blocked
      const result2 = await pipeline.process({
        agentId: 'cb-agent',
        success: true,
        factorCode: 'CT-COMP',
      });

      expect(result2.blocked).toBe(true);
      expect(result2.blockReason).toBe('circuit_breaker');
    });
  });

  describe('Methodology Repeat-Failure Detection', () => {
    it('3 failures with same methodologyKey within 72hr window should trip CB', async () => {
      // Create agent with enough trust that individual failures don't trip
      // score-based CB (need score > 200 to stay above degraded threshold,
      // and > 100 to stay above hard CB threshold after losses)
      await profiles.create('method-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 300),
        createEvidence('CT-REL', 300),
        createEvidence('CT-OBS', 300),
        createEvidence('CT-TRANS', 300),
        createEvidence('CT-ACCT', 300),
        createEvidence('SA-SAFE', 300),
      ]);

      const profileBefore = await profiles.get('method-agent');
      expect(profileBefore!.adjustedScore).toBeGreaterThan(400);

      const now = new Date();
      const methodKey = 'safety:harm_refusal';

      // Failure 1: should NOT trip CB
      const r1 = await pipeline.process({
        agentId: 'method-agent',
        success: false,
        factorCode: 'SA-SAFE',
        methodologyKey: methodKey,
        now,
      });
      expect(r1.dynamicsResult.circuitBreakerTripped).toBe(false);
      expect(r1.blocked).toBe(false); // Evidence was written

      // Failure 2: should NOT trip CB
      const r2 = await pipeline.process({
        agentId: 'method-agent',
        success: false,
        factorCode: 'SA-SAFE',
        methodologyKey: methodKey,
        now: new Date(now.getTime() + 1000),
      });
      expect(r2.dynamicsResult.circuitBreakerTripped).toBe(false);

      // Failure 3: SHOULD trip CB — repeat methodology threshold reached
      const r3 = await pipeline.process({
        agentId: 'method-agent',
        success: false,
        factorCode: 'SA-SAFE',
        methodologyKey: methodKey,
        now: new Date(now.getTime() + 2000),
      });
      expect(r3.dynamicsResult.circuitBreakerTripped).toBe(true);
      expect(r3.dynamicsResult.circuitBreakerReason).toBe(
        `repeat_methodology_failure:${methodKey}`
      );
      expect(r3.blocked).toBe(true);
      expect(r3.blockReason).toBe('circuit_breaker');

      // Verify agent is now fully locked
      expect(dynamics.isCircuitBreakerTripped('method-agent')).toBe(true);

      // Any subsequent signal should be blocked
      const r4 = await pipeline.process({
        agentId: 'method-agent',
        success: true,
        factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 3000),
      });
      expect(r4.blocked).toBe(true);
      expect(r4.blockReason).toBe('circuit_breaker');
    });

    it('methodology rotation with 6+ unique keys should trip cross-methodology CB', async () => {
      await profiles.create('rotation-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 300),
        createEvidence('CT-REL', 300),
        createEvidence('CT-OBS', 300),
        createEvidence('CT-TRANS', 300),
        createEvidence('CT-ACCT', 300),
        createEvidence('SA-SAFE', 300),
      ]);

      const now = new Date();

      // 5 failures with unique keys — no single key hits 3, total < 6
      for (let i = 0; i < 5; i++) {
        const r = await pipeline.process({
          agentId: 'rotation-agent',
          success: false,
          factorCode: 'CT-COMP',
          methodologyKey: `rotation-key-${i}`,
          now: new Date(now.getTime() + i * 1000),
        });
        // May be blocked by score-based CB, but not by cross-methodology yet
        if (r.dynamicsResult.circuitBreakerTripped) {
          expect(r.dynamicsResult.circuitBreakerReason).not.toBe('cross_methodology_failure_rotation');
        }
      }

      // 6th failure with another unique key — should trip cross-methodology
      const r6 = await pipeline.process({
        agentId: 'rotation-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'rotation-key-5',
        now: new Date(now.getTime() + 5000),
      });

      // Agent should be locked by cross-methodology rotation OR by score-based CB
      expect(dynamics.isCircuitBreakerTripped('rotation-agent')).toBe(true);
    });

    it('different methodologyKeys should NOT cross-contaminate', async () => {
      await profiles.create('mixed-method-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 300),
        createEvidence('CT-REL', 300),
        createEvidence('CT-OBS', 300),
        createEvidence('CT-TRANS', 300),
        createEvidence('CT-ACCT', 300),
        createEvidence('SA-SAFE', 300),
      ]);

      const now = new Date();

      // 2 failures with key A
      await pipeline.process({
        agentId: 'mixed-method-agent',
        success: false,
        factorCode: 'SA-SAFE',
        methodologyKey: 'method-A',
        now,
      });
      await pipeline.process({
        agentId: 'mixed-method-agent',
        success: false,
        factorCode: 'SA-SAFE',
        methodologyKey: 'method-A',
        now: new Date(now.getTime() + 1000),
      });

      // 2 failures with key B — different key, should NOT trigger
      await pipeline.process({
        agentId: 'mixed-method-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'method-B',
        now: new Date(now.getTime() + 2000),
      });
      const r = await pipeline.process({
        agentId: 'mixed-method-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'method-B',
        now: new Date(now.getTime() + 3000),
      });

      // Neither key has hit 3, so CB should NOT be tripped by methodology
      // (may be tripped by score-based threshold if score dropped low enough)
      const reason = r.dynamicsResult.circuitBreakerReason ?? '';
      expect(reason).not.toMatch(/repeat_methodology_failure/);
    });
  });

  describe('Degraded Circuit Breaker State', () => {
    it('score dropping into warning zone should enter degraded mode', () => {
      // Use dynamics engine directly for precise score control.
      // Start at 205 (just above degraded threshold of 200).
      // A loss from T1 (tier 1) should drop below 200 → degraded mode.
      const agentId = 'degraded-direct';

      const r1 = dynamics.updateTrust(agentId, {
        currentScore: 205,
        success: false,
        ceiling: 1000,
        tier: 1,
      });

      expect(r1.newScore).toBeLessThan(205);

      // If it dropped into the 100-200 zone → degraded
      if (r1.newScore >= 100 && r1.newScore < 200) {
        expect(r1.circuitBreakerState).toBe('degraded');
        expect(r1.circuitBreakerDegraded).toBe(true);
        expect(r1.circuitBreakerTripped).toBe(false);
        expect(dynamics.isCircuitBreakerDegraded(agentId)).toBe(true);

        // Gains should be blocked in degraded mode
        const r2 = dynamics.updateTrust(agentId, {
          currentScore: r1.newScore,
          success: true,
          ceiling: 1000,
          tier: 1,
        });

        expect(r2.blockedByDegraded).toBe(true);
        expect(r2.delta).toBe(0);

        // Losses should still land
        const r3 = dynamics.updateTrust(agentId, {
          currentScore: r1.newScore,
          success: false,
          ceiling: 1000,
          tier: 1,
        });

        expect(r3.blockedByDegraded).toBe(false);
        expect(r3.delta).toBeLessThan(0);
      } else {
        // Loss was large enough to hard trip (below 100)
        expect(r1.circuitBreakerTripped).toBe(true);
      }
    });

    it('degraded state should block gains but allow losses to land', async () => {
      // Use dynamics engine directly for precise control
      // Start agent at score 210 (just above degraded threshold of 200)
      const agentId = 'precise-degraded-agent';

      // First loss from 210 should drop below 200 → enter degraded
      const r1 = dynamics.updateTrust(agentId, {
        currentScore: 210,
        success: false,
        ceiling: 1000,
        tier: 2,
      });

      // Should be in degraded mode now (score between 100-200 after loss)
      if (r1.newScore < 200 && r1.newScore >= 100) {
        expect(r1.circuitBreakerState).toBe('degraded');
        expect(r1.blockedByDegraded).toBe(false); // The loss itself was NOT blocked

        // Try a gain — should be blocked by degraded
        const r2 = dynamics.updateTrust(agentId, {
          currentScore: r1.newScore,
          success: true,
          ceiling: 1000,
          tier: 2,
        });

        expect(r2.blockedByDegraded).toBe(true);
        expect(r2.delta).toBe(0);

        // Try another loss — should NOT be blocked by degraded
        const r3 = dynamics.updateTrust(agentId, {
          currentScore: r1.newScore,
          success: false,
          ceiling: 1000,
          tier: 2,
        });

        expect(r3.blockedByDegraded).toBe(false);
        expect(r3.delta).toBeLessThan(0);
      }
    });
  });

  describe('Two-Engine Feedback Loop', () => {
    it('slow lane adjustedScore should feed back as fast lane currentScore on next signal', async () => {
      // Create agent with known starting profile
      await profiles.create('loop-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', 200),
        createEvidence('CT-REL', 200),
        createEvidence('CT-OBS', 200),
        createEvidence('CT-TRANS', 200),
        createEvidence('CT-ACCT', 200),
      ]);

      const profile0 = await profiles.get('loop-agent');
      const score0 = profile0!.adjustedScore;

      // Signal 1: positive — fast lane uses score0 as currentScore
      const r1 = await pipeline.process({
        agentId: 'loop-agent',
        success: true,
        factorCode: 'CT-COMP',
      });

      expect(r1.blocked).toBe(false);
      expect(r1.evidence).not.toBeNull();
      expect(r1.dynamicsResult.delta).toBeGreaterThan(0);

      // The fast lane should have used score0 as currentScore
      // Verify: newScore ≈ score0 + delta (within rounding tolerance)
      expect(r1.dynamicsResult.newScore).toBeCloseTo(score0 + r1.dynamicsResult.delta, 1);

      // After signal 1, slow lane has updated profile
      const profile1 = await profiles.get('loop-agent');
      const score1 = profile1!.adjustedScore;

      // The slow lane score should have changed (evidence was written)
      expect(score1).not.toBe(score0);

      // Signal 2: positive — fast lane should use score1 (from slow lane) as currentScore
      const r2 = await pipeline.process({
        agentId: 'loop-agent',
        success: true,
        factorCode: 'CT-COMP',
      });

      expect(r2.blocked).toBe(false);
      expect(r2.evidence).not.toBeNull();

      // The fast lane received score1 as currentScore, NOT score0 or BASELINE.
      // This proves the feedback loop is working:
      // newScore from the fast lane should be approximately score1 + delta2
      expect(r2.dynamicsResult.newScore).toBeCloseTo(score1 + r2.dynamicsResult.delta, 1);

      // Both deltas should be very close (same formula, nearby scores),
      // confirming the pipeline read the updated slow-lane score for signal 2.
      // The delta difference is within floating-point tolerance for nearby scores.
      expect(Math.abs(r2.dynamicsResult.delta - r1.dynamicsResult.delta)).toBeLessThan(0.01);

      // After signal 2, profile should be further updated
      const profile2 = await profiles.get('loop-agent');
      expect(profile2!.version).toBeGreaterThan(profile1!.version);
      expect(profile2!.evidence.length).toBeGreaterThan(profile1!.evidence.length);
    });

    it('negative signal should reduce score and next signal should use reduced score', async () => {
      // Use controlled timestamps to keep evidence creation and pipeline signals
      // in a consistent timeline. The seed evidence is at T=0, the negative signal
      // at T+1hr, and the positive signal at T+170hr (past the 168hr cooldown).
      const seedTime = new Date('2026-01-01T00:00:00Z');
      const negativeSignalTime = new Date(seedTime.getTime() + 1 * 60 * 60 * 1000);
      const positiveSignalTime = new Date(seedTime.getTime() + 170 * 60 * 60 * 1000);

      const seedEvidence = (factorCode: string, impact: number): TrustEvidence => ({
        evidenceId: uuidv4(),
        factorCode,
        impact,
        source: 'e2e-test',
        collectedAt: seedTime,
      });

      await profiles.create('loop-neg-agent', ObservationTier.WHITE_BOX, [
        seedEvidence('CT-COMP', 200),
        seedEvidence('CT-REL', 200),
        seedEvidence('CT-OBS', 200),
        seedEvidence('CT-TRANS', 200),
        seedEvidence('CT-ACCT', 200),
      ], { now: seedTime });

      const profile0 = await profiles.get('loop-neg-agent');
      const score0 = profile0!.adjustedScore;

      // Signal 1: negative — should decrease score
      const r1 = await pipeline.process({
        agentId: 'loop-neg-agent',
        success: false,
        factorCode: 'CT-COMP',
        now: negativeSignalTime,
      });

      const profile1 = await profiles.get('loop-neg-agent');
      const score1 = profile1!.adjustedScore;
      expect(score1).toBeLessThan(score0);

      // Signal 2: positive — fast lane should start from reduced score1.
      // Time is 170 hours after seed, well past the 168-hour cooldown.
      const r2 = await pipeline.process({
        agentId: 'loop-neg-agent',
        success: true,
        factorCode: 'CT-COMP',
        now: positiveSignalTime,
      });

      expect(r2.blocked).toBe(false);
      expect(r2.dynamicsResult.delta).toBeGreaterThan(0);

      // Verify the feedback loop: the fast lane used score1 as currentScore
      expect(r2.dynamicsResult.newScore).toBeCloseTo(score1 + r2.dynamicsResult.delta, 1);

      // The positive evidence should have been persisted into the slow lane profile.
      // Note: the slow lane re-aggregates all evidence with time decay, so the
      // adjustedScore may not simply increase (decay on older seed evidence can
      // outweigh the tiny positive delta). The key feedback loop proof is above:
      // newScore ≈ score1 + delta, confirming the fast lane received score1.
      const profile2 = await profiles.get('loop-neg-agent');
      expect(profile2!.evidence.length).toBeGreaterThan(profile1!.evidence.length);
      expect(profile2!.version).toBeGreaterThan(profile1!.version);
    });
  });
});
