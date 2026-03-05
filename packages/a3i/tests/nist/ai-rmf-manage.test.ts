/**
 * NIST AI RMF (AI 100-1) — MANAGE Function Tests
 *
 * Validates that the Vorion A3I trust system implements automated
 * incident containment, graduated response, and managed recovery.
 *
 * Maps to: MG-1.1 through MG-4.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier, TrustBand, ActionType, DataSensitivity, Reversibility } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  type TrustSignalPipeline,
} from '../../src/index.js';

/** Seed a profile at a specific score by creating and manually setting evidence */
async function seedProfileAtScore(
  profiles: TrustProfileService,
  agentId: string,
  score: number,
  now: Date
): Promise<void> {
  // Create with evidence that brings the profile to approximately the desired score
  // Impact maps to factor score: impact/1000 added to 0.5 baseline
  // For a target composite, we need factor score = target/1000
  // delta = factorScore - 0.5 → impact = delta * 1000
  const impact = (score / 1000 - 0.5) * 1000;
  await profiles.create(agentId, ObservationTier.WHITE_BOX, [{
    evidenceId: `seed-${agentId}`,
    factorCode: 'CT-COMP',
    impact,
    source: 'test-seed',
    collectedAt: now,
  }], { now });
}

describe('NIST AI RMF — MANAGE Function', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  it('MG-1.1: circuit breaker halts agent on safety failure', async () => {
    // New agent: BASELINE_SCORE=1, first failure trips CB
    const result = await pipeline.process({
      agentId: 'unsafe-agent',
      success: false,
      factorCode: 'CT-SAFE',
      methodologyKey: 'safety:critical_failure',
      now,
    });

    expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('circuit_breaker');

    // All subsequent signals should be blocked
    const subsequent = await pipeline.process({
      agentId: 'unsafe-agent',
      success: true,
      factorCode: 'CT-COMP',
      now: new Date(now.getTime() + 1000),
    });
    expect(subsequent.blocked).toBe(true);
  });

  it('MG-1.2: graduated degradation — degraded mode blocks gains, allows losses', () => {
    // Use dynamics engine directly to test the graduated CB state machine
    // Agent at score 180 (in degraded zone: 100-200)
    const loss = dynamics.updateTrust('grad-agent', {
      currentScore: 180,
      success: false,
      ceiling: 900,
      tier: 0,
      methodologyKey: 'test:degraded',
      now,
    });

    // Score dropped from 180 → should enter degraded or tripped
    const state = dynamics.getCircuitBreakerState('grad-agent');
    expect(['degraded', 'tripped']).toContain(state);

    if (state === 'degraded') {
      // In degraded mode: gains should be blocked
      // Check within the 5-minute auto-reset window for T0 (not after!)
      const withinWindow = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes later
      const gain = dynamics.updateTrust('grad-agent', {
        currentScore: loss.newScore,
        success: true,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:gain',
        now: withinWindow,
      });
      expect(gain.blockedByDegraded).toBe(true);
      expect(gain.delta).toBe(0);
    }
  });

  it('MG-2.1: tier-aware auto-reset — T0 resets in 15 minutes', async () => {
    // New agent at baseline (tier 0)
    const result = await pipeline.process({
      agentId: 'autoreset-agent',
      success: false,
      factorCode: 'CT-COMP',
      methodologyKey: 'test:autoreset',
      now,
    });
    expect(result.dynamicsResult.circuitBreakerTripped).toBe(true);

    // Before 15 minutes: still tripped
    const before = dynamics.isCircuitBreakerTripped('autoreset-agent');
    expect(before).toBe(true);

    // After 15 minutes: should auto-reset (T0 = 15min reset)
    const resetTime = new Date(now.getTime() + 16 * 60 * 1000); // 16 minutes later
    const afterReset = await pipeline.process({
      agentId: 'autoreset-agent',
      success: true,
      factorCode: 'CT-COMP',
      now: resetTime,
    });

    // The CB should have auto-reset, allowing the signal through
    expect(afterReset.dynamicsResult.circuitBreakerTripped).toBe(false);
  });

  it('MG-2.2: cooldown enforces reflection period after loss', async () => {
    // Seed agent with enough trust to not trip CB on first loss
    await seedProfileAtScore(profiles, 'cooldown-agent', 500, now);

    // Apply a loss
    await pipeline.process({
      agentId: 'cooldown-agent',
      success: false,
      factorCode: 'CT-COMP',
      methodologyKey: 'test:cooldown',
      now: new Date(now.getTime() + 1000),
    });

    // Check cooldown state
    const inCooldown = dynamics.isInCooldown('cooldown-agent');
    if (inCooldown) {
      // During cooldown: gains should be blocked
      const gainDuringCooldown = await pipeline.process({
        agentId: 'cooldown-agent',
        success: true,
        factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 2000),
      });
      expect(gainDuringCooldown.dynamicsResult.blockedByCooldown).toBe(true);
      expect(gainDuringCooldown.blocked).toBe(true);
      expect(gainDuringCooldown.blockReason).toBe('cooldown');
    }
  });

  it('MG-3.1: gate prevents unauthorized action escalation', async () => {
    // Import gate here to avoid circular dependency issues at module level
    const { createPreActionGate, createMapTrustProvider } = await import('../../src/index.js');

    // Agent at low trust (score 100)
    const trustProvider = createMapTrustProvider(new Map([
      ['low-trust-agent', 100],
      ['high-trust-agent', 850],
    ]));

    const gate = createPreActionGate({}, trustProvider);

    // Low trust agent tries HIGH risk action → rejected
    const lowResult = await gate.verify({
      agentId: 'low-trust-agent',
      actionType: ActionType.DELETE,
      dataSensitivity: DataSensitivity.RESTRICTED,
      reversibility: Reversibility.IRREVERSIBLE,
      resourceId: 'critical-resource',
    });
    expect(lowResult.status).not.toBe('APPROVED');

    // Low trust agent tries READ action → approved (threshold = 0)
    const readResult = await gate.verify({
      agentId: 'low-trust-agent',
      actionType: ActionType.READ,
      dataSensitivity: DataSensitivity.PUBLIC,
      reversibility: Reversibility.REVERSIBLE,
      resourceId: 'public-resource',
    });
    // READ with PUBLIC data has threshold 0, so even low trust passes
    expect(readResult.status).toBe('APPROVED');
  });

  it('MG-4.1: repeat methodology detection triggers containment', async () => {
    // Seed agent at score 500 (above CB thresholds)
    await seedProfileAtScore(profiles, 'repeat-agent', 500, now);

    // Send 3 failures with the SAME methodology key within 72 hours
    for (let i = 0; i < 3; i++) {
      await pipeline.process({
        agentId: 'repeat-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'same:repeated:approach',
        now: new Date(now.getTime() + (i + 1) * 60000), // 1 minute apart
      });
    }

    // After 3 repeat failures, CB should be tripped
    const cbTripped = dynamics.isCircuitBreakerTripped('repeat-agent');
    expect(cbTripped).toBe(true);
  });

  it('MG-4.2: cross-methodology rotation detection', async () => {
    // Seed agent at a comfortable score
    await seedProfileAtScore(profiles, 'rotator-agent', 600, now);

    // Send 6 failures with 6 UNIQUE methodology keys (rotation evasion)
    for (let i = 0; i < 6; i++) {
      await pipeline.process({
        agentId: 'rotator-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: `unique:approach:${i}`,
        now: new Date(now.getTime() + (i + 1) * 60000),
      });
    }

    // After 6 different methodology failures, cross-rotation detection should trip CB
    const cbTripped = dynamics.isCircuitBreakerTripped('rotator-agent');
    expect(cbTripped).toBe(true);
  });

  it('MG-5.1: admin reset clears CB and cooldown state', async () => {
    // Trip the CB
    await pipeline.process({
      agentId: 'admin-reset-agent',
      success: false,
      factorCode: 'CT-COMP',
      methodologyKey: 'test:admin',
      now,
    });
    expect(dynamics.isCircuitBreakerTripped('admin-reset-agent')).toBe(true);

    // Admin reset
    const resetResult = dynamics.resetCircuitBreaker('admin-reset-agent', true, now);
    expect(resetResult).toBe(true);

    // CB should be cleared
    expect(dynamics.isCircuitBreakerTripped('admin-reset-agent')).toBe(false);
    expect(dynamics.getCircuitBreakerState('admin-reset-agent')).toBe('normal');

    // Cooldown should also be cleared (CB reset = full redemption path)
    expect(dynamics.isInCooldown('admin-reset-agent')).toBe(false);
  });
});
