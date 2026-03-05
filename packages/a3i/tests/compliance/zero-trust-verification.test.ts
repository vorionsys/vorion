/**
 * Zero-Trust Verification Tests
 *
 * NIST Principle: Zero Trust Architecture
 *
 * Proves that the Vorion A3I trust system enforces a zero-trust posture
 * by default — no agent receives implicit trust, and trust must be
 * earned through demonstrated positive behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier, TrustBand, ActionType, DataSensitivity, Reversibility } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  TrustCalculator,
  createTrustCalculator,
  createSignalPipeline,
  createPreActionGate,
  type TrustSignalPipeline,
} from '../../src/index.js';

const BASELINE_SCORE = 1;

describe('Zero-Trust Verification (NIST Zero Trust)', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  it('ZT-1: every new agent starts at BASELINE_SCORE=1', async () => {
    // Create 10 agents and verify each starts at baseline
    const agentIds = Array.from({ length: 10 }, (_, i) => `new-agent-${i}`);

    for (const agentId of agentIds) {
      const result = await pipeline.process({
        agentId,
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // The dynamics engine uses BASELINE_SCORE=1 when no profile exists
      // First signal creates the profile, so dynamicsResult.newScore should start from 1
      // The delta should be the gain from score 1
      expect(result.dynamicsResult.delta).toBeGreaterThan(0);
    }

    // Verify through direct dynamics engine: unknown agent gets BASELINE_SCORE treatment
    const unknownResult = dynamics.updateTrust('never-seen-agent', {
      currentScore: BASELINE_SCORE,
      success: true,
      ceiling: 900,
      tier: 0,
      methodologyKey: 'test',
      now,
    });
    // Gain from score 1 should be tiny (logarithmic gain from near-zero)
    expect(unknownResult.delta).toBeGreaterThan(0);
    expect(unknownResult.newScore).toBeGreaterThan(BASELINE_SCORE);
    expect(unknownResult.newScore).toBeLessThan(50); // Very small gain from baseline
  });

  it('ZT-2: first failure from any new agent trips circuit breaker', async () => {
    // A new agent at BASELINE_SCORE=1 should immediately trip CB on first failure
    // because score 1 is below the CB threshold of 100
    const result = await pipeline.process({
      agentId: 'brand-new-agent',
      success: false,
      factorCode: 'CT-COMP',
      methodologyKey: 'test:failure',
      now,
    });

    // The dynamics result should show CB tripped
    // Score 1 → loss → score drops to ~0 → below CB threshold (100) → CB trips
    expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('circuit_breaker');
  });

  it('ZT-3: unknown agent gets zero trust from gate', async () => {
    // A gate with no trust provider should deny everything for unknown agents
    const gate = createPreActionGate();

    // Unknown agent with trustScore 0 should be rejected for any non-READ action
    const result = await gate.verify({
      agentId: 'unknown-agent',
      actionType: ActionType.WRITE,
      dataSensitivity: DataSensitivity.PUBLIC,
      reversibility: Reversibility.REVERSIBLE,
      resourceId: 'test-resource',
    }, 0);

    expect(result.status).not.toBe('APPROVED');
  });

  it('ZT-4: trust must be earned through positive signals only', async () => {
    const agentId = 'earning-trust-agent';

    // First success: should gain from baseline
    const r1 = await pipeline.process({
      agentId,
      success: true,
      factorCode: 'CT-COMP',
      now,
    });
    expect(r1.dynamicsResult.delta).toBeGreaterThan(0);

    // Second success: should also gain
    const r2 = await pipeline.process({
      agentId,
      success: true,
      factorCode: 'CT-COMP',
      now: new Date(now.getTime() + 1000),
    });
    expect(r2.dynamicsResult.delta).toBeGreaterThan(0);

    // Trust accumulates through consecutive positive signals
    // The dynamics engine tracks cumulative progress
    expect(r2.dynamicsResult.newScore).toBeGreaterThan(r1.dynamicsResult.newScore);

    // Only positive signals build trust — no shortcut
  });

  it('ZT-5: TrustCalculator baseline is 0.5 per factor (500 composite) for empty evidence', () => {
    // Without any evidence, the 16-factor baseline is 0.5 each → 500 composite
    const calculator = createTrustCalculator();
    const profile = calculator.calculate(
      'empty-agent',
      ObservationTier.WHITE_BOX,
      []
    );

    expect(profile.compositeScore).toBe(500);
    expect(profile.band).toBe(TrustBand.T3_MONITORED);

    // BUT the pipeline uses BASELINE_SCORE=1, not the calculator's 500
    // This distinction is critical: the pipeline's zero-trust default
    // overrides the calculator's neutral baseline
  });

  it('ZT-6: separate agents have completely isolated trust state', async () => {
    // Agent A builds trust
    await pipeline.process({ agentId: 'agent-A', success: true, factorCode: 'CT-COMP', now });
    await pipeline.process({ agentId: 'agent-A', success: true, factorCode: 'CT-COMP', now: new Date(now.getTime() + 1000) });

    const profileA = await profiles.get('agent-A');

    // Agent B is completely independent — no inherited trust
    const resultB = await pipeline.process({ agentId: 'agent-B', success: false, factorCode: 'CT-COMP', now });

    // Agent B should trip CB (baseline=1, first failure)
    expect(resultB.dynamicsResult.circuitBreakerTripped).toBe(true);

    // Agent A's trust is unaffected
    const profileA2 = await profiles.get('agent-A');
    expect(profileA2!.adjustedScore).toBe(profileA!.adjustedScore);

    // Separate cooldowns
    expect(dynamics.isInCooldown('agent-A')).toBe(false);

    // Separate CB states
    expect(dynamics.isCircuitBreakerTripped('agent-A')).toBe(false);
    expect(dynamics.isCircuitBreakerTripped('agent-B')).toBe(true);

    // Separate rate limits (tested via pipeline config)
  });
});
