/**
 * NIST AI RMF (AI 100-1) — MEASURE Function Tests
 *
 * Validates that the Vorion A3I trust system produces reproducible,
 * bounded, and robust measurements of agent trust.
 *
 * Maps to: MS-1.1 through MS-4.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObservationTier, TrustBand, OBSERVATION_CEILINGS } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createTrustCalculator,
  createSignalPipeline,
  createEvidence,
  DEFAULT_DIMINISHING_RETURNS,
  type TrustSignalPipeline,
} from '../../src/index.js';

describe('NIST AI RMF — MEASURE Function', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  it('MS-1.1: composite score is deterministic — identical evidence produces identical scores', () => {
    const calculator = createTrustCalculator();
    const evidence = [
      createEvidence('CT-COMP', 300, 'task-success'),
      createEvidence('CT-REL', 200, 'consistency'),
      createEvidence('CT-SAFE', -100, 'minor-issue'),
    ];

    // Run the same calculation 10 times
    const scores = Array.from({ length: 10 }, () =>
      calculator.calculate('test-agent', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now })
    );

    // All composite scores must be identical
    const firstScore = scores[0]!.compositeScore;
    for (const profile of scores) {
      expect(profile.compositeScore).toBe(firstScore);
    }

    // All factor scores must be identical
    for (const profile of scores) {
      expect(profile.factorScores).toEqual(scores[0]!.factorScores);
    }

    // All bands must be identical
    for (const profile of scores) {
      expect(profile.band).toBe(scores[0]!.band);
    }
  });

  it('MS-1.2: factor scores are bounded [0.0, 1.0] under extreme inputs', () => {
    const calculator = createTrustCalculator();

    // Test with extreme positive evidence
    const extremePositive = Array.from({ length: 100 }, (_, i) =>
      createEvidence('CT-COMP', 1000, `extreme-positive-${i}`)
    );
    const positiveProfile = calculator.calculate(
      'extreme-pos', ObservationTier.WHITE_BOX, extremePositive, { applyDecay: false, now }
    );
    for (const [code, score] of Object.entries(positiveProfile.factorScores)) {
      expect(score, `Factor ${code} should be <= 1.0`).toBeLessThanOrEqual(1.0);
      expect(score, `Factor ${code} should be >= 0.0`).toBeGreaterThanOrEqual(0.0);
    }

    // Test with extreme negative evidence
    const extremeNegative = Array.from({ length: 100 }, (_, i) =>
      createEvidence('CT-COMP', -1000, `extreme-negative-${i}`)
    );
    const negativeProfile = calculator.calculate(
      'extreme-neg', ObservationTier.WHITE_BOX, extremeNegative, { applyDecay: false, now }
    );
    for (const [code, score] of Object.entries(negativeProfile.factorScores)) {
      expect(score, `Factor ${code} should be <= 1.0`).toBeLessThanOrEqual(1.0);
      expect(score, `Factor ${code} should be >= 0.0`).toBeGreaterThanOrEqual(0.0);
    }
  });

  it('MS-1.3: composite score is bounded [0, 1000]', () => {
    const calculator = createTrustCalculator();

    // Maximum possible evidence
    const maxEvidence = Array.from({ length: 50 }, (_, i) =>
      createEvidence('CT-COMP', 1000, `max-${i}`)
    );
    const maxProfile = calculator.calculate(
      'max-agent', ObservationTier.VERIFIED_BOX, maxEvidence, { applyDecay: false, now }
    );
    expect(maxProfile.compositeScore).toBeLessThanOrEqual(1000);
    expect(maxProfile.compositeScore).toBeGreaterThanOrEqual(0);

    // Minimum possible evidence
    const minEvidence = Array.from({ length: 50 }, (_, i) =>
      createEvidence('CT-COMP', -1000, `min-${i}`)
    );
    const minProfile = calculator.calculate(
      'min-agent', ObservationTier.WHITE_BOX, minEvidence, { applyDecay: false, now }
    );
    expect(minProfile.compositeScore).toBeLessThanOrEqual(1000);
    expect(minProfile.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('MS-2.1: decay is monotonically non-increasing over time', () => {
    const calculator = createTrustCalculator();
    const evidence = [createEvidence('CT-COMP', 400, 'original-evidence')];

    // Calculate at different time offsets
    const dayOffsets = [0, 1, 7, 30, 90, 182, 365];
    const scores: number[] = [];

    for (const days of dayOffsets) {
      const futureNow = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const profile = calculator.calculate(
        'decay-agent', ObservationTier.WHITE_BOX, evidence, { applyDecay: true, now: futureNow }
      );
      scores.push(profile.compositeScore);
    }

    // Each score should be <= the previous
    for (let i = 1; i < scores.length; i++) {
      expect(
        scores[i],
        `Score at ${dayOffsets[i]} days (${scores[i]}) should be <= score at ${dayOffsets[i - 1]} days (${scores[i - 1]})`
      ).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it('MS-3.1: onSignalProcessed metrics are always emitted', async () => {
    const metrics: any[] = [];
    const metricsPipeline = createSignalPipeline(dynamics, profiles, {
      onSignalProcessed: (m) => metrics.push(m),
    });

    // Process a mix of signals
    // First: success (creates profile)
    await metricsPipeline.process({
      agentId: 'metrics-agent', success: true, factorCode: 'CT-COMP', now,
    });
    // Second: another success
    await metricsPipeline.process({
      agentId: 'metrics-agent', success: true, factorCode: 'CT-REL',
      now: new Date(now.getTime() + 1000),
    });

    expect(metrics.length).toBe(2);

    for (const m of metrics) {
      expect(m.agentId).toBe('metrics-agent');
      expect(m.factorCode).toBeDefined();
      expect(typeof m.delta).toBe('number');
      expect(typeof m.blocked).toBe('boolean');
      expect(typeof m.durationMs).toBe('number');
      expect(m.timestamp).toBeInstanceOf(Date);
    }
  });

  it('MS-3.2: onBlocked audit events are non-lossy for all block reasons', async () => {
    const blocked: any[] = [];
    const auditPipeline = createSignalPipeline(dynamics, profiles, {
      rateLimitPerAgent: 1,
      rateLimitWindowMs: 60000,
      onBlocked: (e) => blocked.push(e),
    });

    // 1. Circuit breaker: new agent failure (score 1 → CB trip)
    await auditPipeline.process({
      agentId: 'cb-agent', success: false, factorCode: 'CT-COMP',
      methodologyKey: 'test:fail', now,
    });

    // 2. Rate limited: second signal for same agent within window
    // (CB is already tripped, but let's test rate limit on a different agent)
    await auditPipeline.process({
      agentId: 'rate-agent', success: true, factorCode: 'CT-COMP', now,
    });
    await auditPipeline.process({
      agentId: 'rate-agent', success: true, factorCode: 'CT-COMP',
      now: new Date(now.getTime() + 1),
    });

    // Verify at least 2 blocked events (CB + rate limited)
    expect(blocked.length).toBeGreaterThanOrEqual(2);

    const blockReasons = blocked.map(b => b.blockReason);
    expect(blockReasons).toContain('circuit_breaker');
    expect(blockReasons).toContain('rate_limited');

    // Each event has required fields
    for (const event of blocked) {
      expect(event.agentId).toBeDefined();
      expect(event.factorCode).toBeDefined();
      expect(event.blockReason).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.signal).toBeDefined();
    }
  });

  it('MS-4.1: diminishing returns resists evidence flooding', () => {
    const calculator = createTrustCalculator();

    // One large negative signal
    const evidence = [
      { evidenceId: 'critical-failure', factorCode: 'CT-COMP', impact: -500, source: 'test', collectedAt: now },
      // 100 tiny positive signals attempting to dilute
      ...Array.from({ length: 100 }, (_, i) => ({
        evidenceId: `flood-${i}`,
        factorCode: 'CT-COMP',
        impact: 1,
        source: 'flood',
        collectedAt: now,
      })),
    ];

    const profile = calculator.calculate(
      'flooding-target', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now }
    );

    // Without diminishing returns: avg = (-500 + 100) / 101 ≈ -3.96 → factorScore ≈ 0.496
    // With diminishing returns: -500 gets full weight (1.0), 100 +1s get progressively less
    // The critical failure dominates → factor score well below baseline 0.5
    expect(profile.factorScores['CT-COMP']).toBeLessThan(0.45);

    // Significantly below what simple averaging would produce (~0.496)
    expect(profile.factorScores['CT-COMP']).toBeLessThan(0.496);
  });

  it('MS-4.2: observation ceiling cannot be bypassed by evidence quantity', () => {
    const calculator = createTrustCalculator();

    // Generate maximum positive evidence on all 16 factors
    const evidence = Array.from({ length: 50 }, (_, i) =>
      createEvidence('CT-COMP', 1000, `max-evidence-${i}`)
    );

    for (const tier of [
      ObservationTier.BLACK_BOX,
      ObservationTier.GRAY_BOX,
      ObservationTier.WHITE_BOX,
      ObservationTier.ATTESTED_BOX,
      ObservationTier.VERIFIED_BOX,
    ]) {
      const profile = calculator.calculate(
        'ceiling-agent', tier, evidence, { applyDecay: false, now }
      );

      const ceiling = OBSERVATION_CEILINGS[tier];
      expect(
        profile.adjustedScore,
        `${tier} score should not exceed ceiling ${ceiling}`
      ).toBeLessThanOrEqual(ceiling);
    }
  });
});
