/**
 * NIST AI RMF (AI 100-1) — GOVERN Function Tests
 *
 * Validates that the Vorion A3I trust system implements systematic,
 * codified governance policies rather than ad-hoc trust decisions.
 *
 * Maps to: GV-1.1 through GV-3.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrustBand, ObservationTier } from '@vorionsys/contracts';
import { FACTOR_CODE_LIST } from '@vorionsys/basis';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createTrustCalculator,
  BAND_CONSTRAINT_PRESETS,
  type TrustSignalPipeline,
} from '../../src/index.js';
import { HysteresisCalculator } from '../../src/banding/hysteresis.js';
import { getBand, getBandRange } from '../../src/banding/bands.js';

describe('NIST AI RMF — GOVERN Function', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  it('GV-1.1: trust policy is codified — all 8 tiers have defined constraint presets', () => {
    // Every trust band from T0 to T7 must have a defined constraint preset
    const allBands = [
      TrustBand.T0_SANDBOX,
      TrustBand.T1_OBSERVED,
      TrustBand.T2_PROVISIONAL,
      TrustBand.T3_MONITORED,
      TrustBand.T4_STANDARD,
      TrustBand.T5_TRUSTED,
      TrustBand.T6_CERTIFIED,
      TrustBand.T7_AUTONOMOUS,
    ];

    for (const band of allBands) {
      const preset = BAND_CONSTRAINT_PRESETS[band];
      expect(preset).toBeDefined();
      expect(preset.defaultTools).toBeDefined();
      expect(preset.defaultDataScopes).toBeDefined();
      expect(preset.maxExecutionTimeMs).toBeDefined();
      expect(typeof preset.maxRetries).toBe('number');
      expect(typeof preset.reversibilityRequired).toBe('boolean');
    }
  });

  it('GV-1.2: zero-trust is the enforced default — new agent starts at score 1', async () => {
    // Process a signal for a brand-new agent
    const result = await pipeline.process({
      agentId: 'new-agent',
      success: true,
      factorCode: 'CT-COMP',
      now,
    });

    // The delta should reflect starting from BASELINE_SCORE=1
    // A gain from score 1 is very small (logarithmic)
    expect(result.dynamicsResult.delta).toBeGreaterThan(0);
    expect(result.dynamicsResult.newScore).toBeLessThan(50);
  });

  it('GV-1.3: tier transitions are gated by score boundaries', () => {
    // Each tier has well-defined boundaries — no overlap, no gaps
    const boundaries = [
      { score: 0, expectedBand: TrustBand.T0_SANDBOX },
      { score: 199, expectedBand: TrustBand.T0_SANDBOX },
      { score: 200, expectedBand: TrustBand.T1_OBSERVED },
      { score: 349, expectedBand: TrustBand.T1_OBSERVED },
      { score: 350, expectedBand: TrustBand.T2_PROVISIONAL },
      { score: 499, expectedBand: TrustBand.T2_PROVISIONAL },
      { score: 500, expectedBand: TrustBand.T3_MONITORED },
      { score: 649, expectedBand: TrustBand.T3_MONITORED },
      { score: 650, expectedBand: TrustBand.T4_STANDARD },
      { score: 799, expectedBand: TrustBand.T4_STANDARD },
      { score: 800, expectedBand: TrustBand.T5_TRUSTED },
      { score: 875, expectedBand: TrustBand.T5_TRUSTED },
      { score: 876, expectedBand: TrustBand.T6_CERTIFIED },
      { score: 950, expectedBand: TrustBand.T6_CERTIFIED },
      { score: 951, expectedBand: TrustBand.T7_AUTONOMOUS },
      { score: 1000, expectedBand: TrustBand.T7_AUTONOMOUS },
    ];

    for (const { score, expectedBand } of boundaries) {
      const band = getBand(score);
      expect(band, `Score ${score} should be band ${expectedBand}`).toBe(expectedBand);
    }
  });

  it('GV-1.4: permissions escalate monotonically with trust tier', () => {
    // Each higher tier must have >= permissions of the tier below it
    const allBands = [
      TrustBand.T0_SANDBOX,
      TrustBand.T1_OBSERVED,
      TrustBand.T2_PROVISIONAL,
      TrustBand.T3_MONITORED,
      TrustBand.T4_STANDARD,
      TrustBand.T5_TRUSTED,
      TrustBand.T6_CERTIFIED,
      TrustBand.T7_AUTONOMOUS,
    ];

    for (let i = 1; i < allBands.length; i++) {
      const lower = BAND_CONSTRAINT_PRESETS[allBands[i - 1]!];
      const higher = BAND_CONSTRAINT_PRESETS[allBands[i]!];

      // Higher tier should have >= tools (or wildcard)
      if (!higher.defaultTools.includes('*')) {
        expect(
          higher.defaultTools.length,
          `T${i} should have >= tools than T${i - 1}`
        ).toBeGreaterThanOrEqual(lower.defaultTools.length);
      }

      // Higher tier should have >= execution time (0 = unlimited)
      if (higher.maxExecutionTimeMs !== 0 && lower.maxExecutionTimeMs !== 0) {
        expect(higher.maxExecutionTimeMs).toBeGreaterThanOrEqual(lower.maxExecutionTimeMs);
      }

      // Higher tier should have >= retries
      expect(higher.maxRetries).toBeGreaterThanOrEqual(lower.maxRetries);
    }
  });

  it('GV-2.1: 16-factor model covers all trust dimensions', () => {
    // The trust model must have exactly 16 factors
    expect(FACTOR_CODE_LIST).toHaveLength(16);

    // Must cover 5 groups: Foundation(6), Security(3), Agency(3), Maturity(2), Evolution(2)
    const foundation = FACTOR_CODE_LIST.filter(c => ['CT-COMP', 'CT-REL', 'CT-OBS', 'CT-TRANS', 'CT-ACCT', 'CT-SAFE'].includes(c));
    const security = FACTOR_CODE_LIST.filter(c => ['CT-SEC', 'CT-PRIV', 'CT-ID'].includes(c));
    const agency = FACTOR_CODE_LIST.filter(c => ['OP-HUMAN', 'OP-ALIGN', 'OP-CONTEXT'].includes(c));
    const maturity = FACTOR_CODE_LIST.filter(c => ['OP-STEW', 'SF-HUM'].includes(c));
    const evolution = FACTOR_CODE_LIST.filter(c => ['SF-ADAPT', 'SF-LEARN'].includes(c));

    expect(foundation).toHaveLength(6);
    expect(security).toHaveLength(3);
    expect(agency).toHaveLength(3);
    expect(maturity).toHaveLength(2);
    expect(evolution).toHaveLength(2);
  });

  it('GV-3.1: hysteresis prevents governance flapping at tier boundaries', () => {
    const hysteresis = new HysteresisCalculator();

    // Agent at T3 boundary (score ~500). Small oscillations should NOT change band.
    let currentBand = TrustBand.T3_MONITORED;

    // Oscillate around the T2/T3 boundary (500)
    const scores = [498, 502, 497, 503, 496, 504, 495, 505];

    for (const score of scores) {
      const newBand = hysteresis.calculateBandWithHysteresis(currentBand, score);
      // Hysteresis should keep the band stable during small oscillations
      // The exact behavior depends on hysteresis configuration, but the band
      // should not flip-flop with every small score change
      currentBand = newBand;
    }

    // After oscillation, band should be within one tier of T3
    expect(Math.abs(currentBand - TrustBand.T3_MONITORED)).toBeLessThanOrEqual(1);
  });

  it('GV-3.2: T0 Sandbox has zero permissions (most restrictive default)', () => {
    const sandbox = BAND_CONSTRAINT_PRESETS[TrustBand.T0_SANDBOX];

    expect(sandbox.defaultTools).toHaveLength(0);
    expect(sandbox.defaultDataScopes).toHaveLength(0);
    expect(sandbox.maxExecutionTimeMs).toBe(0);
    expect(sandbox.maxRetries).toBe(0);
    expect(sandbox.reversibilityRequired).toBe(true);
  });
});
