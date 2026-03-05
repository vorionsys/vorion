/**
 * NIST SP 800-53 — Access Control (AC) Tests
 *
 * Validates that the Vorion A3I trust system implements proper
 * access control enforcement aligned with NIST SP 800-53 controls.
 *
 * Maps to: AC-3, AC-4, AC-6, AC-7
 */

import { describe, it, expect } from 'vitest';
import {
  TrustBand,
  RiskLevel,
  TRUST_THRESHOLDS,
  ObservationTier,
  OBSERVATION_CEILINGS,
  ActionType,
  DataSensitivity,
} from '@vorionsys/contracts';
import {
  createPreActionGate,
  createMapTrustProvider,
  ACTION_TYPE_REQUIREMENTS,
  DATA_SENSITIVITY_REQUIREMENTS,
  BAND_CONSTRAINT_PRESETS,
} from '../../src/index.js';
import { getBand } from '../../src/banding/bands.js';

describe('NIST SP 800-53 — Access Control (AC)', () => {

  describe('AC-3: Trust-gated action enforcement', () => {
    it('should enforce correct thresholds at every boundary point', () => {
      // TRUST_THRESHOLDS defines the minimum score for each risk level
      expect(TRUST_THRESHOLDS[RiskLevel.READ]).toBe(0);
      expect(TRUST_THRESHOLDS[RiskLevel.LOW]).toBe(200);
      expect(TRUST_THRESHOLDS[RiskLevel.MEDIUM]).toBe(400);
      expect(TRUST_THRESHOLDS[RiskLevel.HIGH]).toBe(600);
      expect(TRUST_THRESHOLDS[RiskLevel.CRITICAL]).toBe(800);

      // All thresholds are on the 0-1000 scale
      for (const [level, threshold] of Object.entries(TRUST_THRESHOLDS)) {
        expect(threshold).toBeGreaterThanOrEqual(0);
        expect(threshold).toBeLessThanOrEqual(1000);
      }
    });

    it('should reject when score is 1 below threshold', async () => {
      const gate = createPreActionGate();

      // At LOW threshold (200): score 199 should fail
      const result = await gate.verify({
        agentId: 'boundary-agent',
        actionType: ActionType.WRITE,
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: 'REVERSIBLE' as any,
        resourceId: 'test',
      }, 199);

      expect(result.status).not.toBe('APPROVED');
    });

    it('should approve when score meets threshold exactly', async () => {
      const gate = createPreActionGate();

      // READ actions have threshold 0 — should always pass
      const readResult = await gate.verify({
        agentId: 'boundary-agent',
        actionType: ActionType.READ,
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: 'REVERSIBLE' as any,
        resourceId: 'test',
      }, 0);

      expect(readResult.status).toBe('APPROVED');
    });
  });

  describe('AC-6: Least privilege enforcement', () => {
    it('T0 Sandbox agents get zero permissions', () => {
      const t0 = BAND_CONSTRAINT_PRESETS[TrustBand.T0_SANDBOX];
      expect(t0.defaultTools).toHaveLength(0);
      expect(t0.defaultDataScopes).toHaveLength(0);
      expect(t0.maxExecutionTimeMs).toBe(0);
    });

    it('each action type maps to a minimum trust band', () => {
      // Every ActionType must have a defined minimum band
      for (const actionType of Object.values(ActionType)) {
        const required = ACTION_TYPE_REQUIREMENTS[actionType];
        expect(required, `ActionType ${actionType} should have a required band`).toBeDefined();
        expect(required).toBeGreaterThanOrEqual(TrustBand.T0_SANDBOX);
        expect(required).toBeLessThanOrEqual(TrustBand.T7_AUTONOMOUS);
      }

      // READ requires the lowest band
      expect(ACTION_TYPE_REQUIREMENTS[ActionType.READ]).toBe(TrustBand.T1_OBSERVED);

      // TRANSFER requires higher trust than READ
      expect(ACTION_TYPE_REQUIREMENTS[ActionType.TRANSFER]).toBeGreaterThan(
        ACTION_TYPE_REQUIREMENTS[ActionType.READ]
      );
    });

    it('each data sensitivity level maps to a minimum trust band', () => {
      for (const sensitivity of Object.values(DataSensitivity)) {
        const required = DATA_SENSITIVITY_REQUIREMENTS[sensitivity];
        expect(required, `DataSensitivity ${sensitivity} should have a required band`).toBeDefined();
      }

      // RESTRICTED requires higher trust than PUBLIC
      expect(DATA_SENSITIVITY_REQUIREMENTS[DataSensitivity.RESTRICTED]).toBeGreaterThan(
        DATA_SENSITIVITY_REQUIREMENTS[DataSensitivity.PUBLIC]
      );
    });
  });

  describe('AC-6(9): Observation ceiling limits trust ceiling', () => {
    it('BLACK_BOX agent cannot exceed score 600 regardless of evidence', () => {
      expect(OBSERVATION_CEILINGS[ObservationTier.BLACK_BOX]).toBe(600);

      // Score 600 maps to T3_MONITORED (500-649)
      const band = getBand(600);
      expect(band).toBe(TrustBand.T3_MONITORED);

      // Cannot reach T4 (650+) with BLACK_BOX observation
    });

    it('observation ceilings increase monotonically with observability', () => {
      const tiers = [
        ObservationTier.BLACK_BOX,
        ObservationTier.GRAY_BOX,
        ObservationTier.WHITE_BOX,
        ObservationTier.ATTESTED_BOX,
        ObservationTier.VERIFIED_BOX,
      ];

      for (let i = 1; i < tiers.length; i++) {
        expect(
          OBSERVATION_CEILINGS[tiers[i]!],
          `${tiers[i]} ceiling should be >= ${tiers[i - 1]} ceiling`
        ).toBeGreaterThanOrEqual(OBSERVATION_CEILINGS[tiers[i - 1]!]);
      }
    });

    it('only VERIFIED_BOX can reach score 1000', () => {
      for (const tier of [
        ObservationTier.BLACK_BOX,
        ObservationTier.GRAY_BOX,
        ObservationTier.WHITE_BOX,
        ObservationTier.ATTESTED_BOX,
      ]) {
        expect(OBSERVATION_CEILINGS[tier]).toBeLessThan(1000);
      }
      expect(OBSERVATION_CEILINGS[ObservationTier.VERIFIED_BOX]).toBe(1000);
    });
  });

  describe('AC-7: Unsuccessful trust attempts trigger lockout', () => {
    it('3 repeat methodology failures trigger circuit breaker lockout', async () => {
      const { TrustDynamicsEngine } = await import('../../src/index.js');
      const dynamics = new TrustDynamicsEngine();

      // Agent at score 500 (above CB thresholds)
      for (let i = 0; i < 3; i++) {
        dynamics.updateTrust('lockout-agent', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          tier: 3,
          methodologyKey: 'same:method',
          now: new Date(Date.now() + i * 60000),
        });
      }

      expect(dynamics.isCircuitBreakerTripped('lockout-agent')).toBe(true);
    });
  });
});
