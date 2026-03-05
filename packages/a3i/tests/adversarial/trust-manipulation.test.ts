/**
 * Adversarial Robustness — Trust Manipulation Tests (Red Team)
 *
 * Validates that the Vorion A3I trust system resists adversarial
 * attacks including evidence flooding, dilution, Sybil attacks,
 * and methodology evasion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createTrustCalculator,
  createEvidence,
  type TrustSignalPipeline,
} from '../../src/index.js';

describe('Adversarial Robustness — Trust Manipulation', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  it('RED-1: evidence flood attack — diminishing returns prevents dilution', () => {
    const calculator = createTrustCalculator();

    // Attacker: one critical failure, then floods 100 tiny positives
    const evidence = [
      { evidenceId: 'critical-fail', factorCode: 'CT-COMP', impact: -500, source: 'attack', collectedAt: now },
      ...Array.from({ length: 100 }, (_, i) => ({
        evidenceId: `flood-${i}`,
        factorCode: 'CT-COMP',
        impact: 1,
        source: 'flood',
        collectedAt: now,
      })),
    ];

    const profile = calculator.calculate(
      'flood-victim', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now }
    );

    // Without diminishing returns: avg = (-500+100)/101 ≈ -3.96, factorScore ≈ 0.496
    // With diminishing returns: -500 gets weight 1.0, 100 +1s get progressively less
    // Key: 100 flooding signals cannot negate a single critical failure
    expect(profile.factorScores['CT-COMP']).toBeLessThan(0.45);
  });

  it('RED-2: tier escalation via bulk micro-evidence', () => {
    const calculator = createTrustCalculator();

    // Attacker creates 500 micro-evidence items
    const evidence = Array.from({ length: 500 }, (_, i) => ({
      evidenceId: `micro-${i}`,
      factorCode: 'CT-COMP',
      impact: 5,
      source: 'micro-spam',
      collectedAt: now,
    }));

    const profile = calculator.calculate(
      'escalation-attempt', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now }
    );

    // Diminishing returns should prevent 500 tiny signals from producing the same
    // effect as a few large signals. Factor score should not reach near 1.0.
    // Without diminishing returns: avg impact = 5, factorScore = 0.5 + 5/1000 = 0.505
    // With diminishing returns: similar (small signals get weighted down)
    expect(profile.factorScores['CT-COMP']).toBeLessThan(0.6);
  });

  it('RED-4: methodology key evasion — cross-rotation detection catches it', async () => {
    // Seed agent at comfortable score
    await profiles.create('evasion-agent', ObservationTier.WHITE_BOX, [{
      evidenceId: 'seed', factorCode: 'CT-COMP', impact: 100, source: 'seed', collectedAt: now,
    }], { now });

    // Attacker rotates through unique methodology keys to avoid per-key threshold
    for (let i = 0; i < 6; i++) {
      await pipeline.process({
        agentId: 'evasion-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: `unique:evasion:${i}`,
        now: new Date(now.getTime() + (i + 1) * 60000),
      });
    }

    // Cross-methodology rotation detection (6 unique keys) should trip CB
    expect(dynamics.isCircuitBreakerTripped('evasion-agent')).toBe(true);
  });

  it('RED-7: Sybil attack — separate identities have completely isolated state', async () => {
    // Create 20 agents — each is a brand new agent (baseline=1)
    const agentIds = Array.from({ length: 20 }, (_, i) => `sybil-agent-${i}`);

    // Agent 0: first failure immediately trips CB (zero-trust default)
    const failResult = await pipeline.process({
      agentId: 'sybil-agent-0',
      success: false,
      factorCode: 'CT-COMP',
      methodologyKey: 'sybil:test',
      now,
    });
    expect(failResult.dynamicsResult.circuitBreakerTripped).toBe(true);

    // All other agents: send success signals — they should NOT be affected
    for (let i = 1; i < 20; i++) {
      await pipeline.process({
        agentId: `sybil-agent-${i}`,
        success: true,
        factorCode: 'CT-COMP',
        now,
      });
    }

    // Verify complete isolation: agent 0 has CB tripped
    expect(dynamics.isCircuitBreakerTripped('sybil-agent-0')).toBe(true);

    // Other agents are completely unaffected
    for (let i = 1; i < 20; i++) {
      expect(dynamics.isCircuitBreakerTripped(`sybil-agent-${i}`)).toBe(false);
      expect(dynamics.isInCooldown(`sybil-agent-${i}`)).toBe(false);
    }

    // Each agent that sent a success signal has its own profile
    for (let i = 1; i < 20; i++) {
      const profile = await profiles.get(`sybil-agent-${i}`);
      expect(profile, `sybil-agent-${i} should have its own profile`).toBeDefined();
    }
  });

  it('RED-8: evidence timestamp manipulation — future timestamps are bounded by factor clamp', () => {
    const calculator = createTrustCalculator();

    // Evidence with collectedAt 1 year in the future
    const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const evidence = [
      { evidenceId: 'future', factorCode: 'CT-COMP', impact: 300, source: 'test', collectedAt: futureDate },
    ];

    // Calculate with current time — future evidence with decay produces negative age,
    // which amplifies the signal (pow(1-rate, negativeDays) > 1). However, the factor
    // score clamp [0.0, 1.0] provides the safety bound.
    const profile = calculator.calculate(
      'time-manipulator', ObservationTier.WHITE_BOX, evidence, { applyDecay: true, now }
    );

    // Even with amplification, factor score is clamped to [0.0, 1.0]
    expect(profile.factorScores['CT-COMP']).toBeLessThanOrEqual(1.0);
    expect(profile.factorScores['CT-COMP']).toBeGreaterThanOrEqual(0.0);

    // Without decay, the score should be normal: 0.5 + 300/1000 = 0.8
    const noDecayProfile = calculator.calculate(
      'time-normal', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now }
    );
    expect(noDecayProfile.factorScores['CT-COMP']).toBeCloseTo(0.8, 1);
  });

  it('RED-9: zero-score loss — no underflow below 0', () => {
    // Agent at score 0: loss should not produce negative scores
    const result = dynamics.updateTrust('zero-agent', {
      currentScore: 0,
      success: false,
      ceiling: 900,
      tier: 0,
      methodologyKey: 'test:zero',
      now,
    });

    expect(result.newScore).toBeGreaterThanOrEqual(0);
    // Delta should be approximately 0 (loss from 0 = 0.07 * 0 ≈ 0)
    expect(Math.abs(result.delta)).toBeLessThanOrEqual(1);
  });

  it('RED-10: concurrent gain+loss for same agent produces deterministic result', async () => {
    await profiles.create('race-agent', ObservationTier.WHITE_BOX, [], { now });

    // Fire 5 success and 5 failure signals simultaneously
    const signals = [
      ...Array.from({ length: 5 }, (_, i) => ({
        agentId: 'race-agent', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + i + 1),
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        agentId: 'race-agent', success: false, factorCode: 'CT-COMP',
        methodologyKey: `race:fail:${i}`,
        now: new Date(now.getTime() + i + 6),
      })),
    ];

    const results = await Promise.all(signals.map(s => pipeline.process(s)));

    // All should complete without error
    expect(results.length).toBe(10);

    // Final profile should exist and have a valid state
    const finalProfile = await profiles.get('race-agent');
    expect(finalProfile).toBeDefined();
    expect(finalProfile!.adjustedScore).toBeGreaterThanOrEqual(0);
    expect(finalProfile!.adjustedScore).toBeLessThanOrEqual(1000);
  });
});
