import { describe, it, expect } from 'vitest';
import {
  createDimensions,
  clampScore,
  isValidDimensions,
  getMinDimension,
  getMaxDimension,
  getDimensionDelta,
  adjustDimensions,
  INITIAL_DIMENSIONS,
} from '../../src/trust/dimensions.js';
import {
  createWeights,
  normalizeWeights,
  isValidWeights,
  weightsAreSummedCorrectly,
  DEFAULT_TRUST_WEIGHTS,
  WEIGHT_PRESETS,
} from '../../src/trust/weights.js';
import {
  calculateCompositeScore,
  applyObservationCeiling,
  calculateTrustProfile,
  createEvidence,
} from '../../src/trust/calculator.js';
import { TrustBand, ObservationTier } from '@vorionsys/contracts';

describe('Trust Dimensions', () => {
  describe('createDimensions', () => {
    it('should create dimensions with initial values', () => {
      const dims = createDimensions();
      expect(dims).toEqual(INITIAL_DIMENSIONS);
    });

    it('should override partial dimensions', () => {
      const dims = createDimensions({ 'CT-COMP': 0.8 });
      expect(dims['CT-COMP']).toBe(0.8);
      expect(dims['CT-REL']).toBe(INITIAL_DIMENSIONS['CT-REL']);
    });

    it('should clamp values to valid range', () => {
      const dims = createDimensions({ 'CT-COMP': 1.5, 'CT-REL': -0.1 });
      expect(dims['CT-COMP']).toBe(1.0);
      expect(dims['CT-REL']).toBe(0);
    });
  });

  describe('clampScore', () => {
    it('should clamp high values to 1.0', () => {
      expect(clampScore(1.5)).toBe(1.0);
    });

    it('should clamp low values to 0', () => {
      expect(clampScore(-0.5)).toBe(0);
    });

    it('should preserve valid values', () => {
      expect(clampScore(0.75)).toBe(0.75);
    });
  });

  describe('isValidDimensions', () => {
    it('should return true for valid dimensions', () => {
      expect(isValidDimensions(INITIAL_DIMENSIONS)).toBe(true);
    });

    it('should return false for invalid dimensions', () => {
      // Values outside 0.0-1.0 are invalid
      expect(isValidDimensions({ 'CT-COMP': 1.5 })).toBe(false);
      expect(isValidDimensions({ 'CT-COMP': -0.1 })).toBe(false);
    });
  });

  describe('getMinDimension', () => {
    it('should find the minimum dimension', () => {
      const dims = { 'CT-COMP': 0.8, 'CT-REL': 0.3, 'CT-OBS': 0.5, 'CT-TRANS': 0.6, 'CT-ACCT': 0.4 };
      const result = getMinDimension(dims);
      expect(result.dimension).toBe('CT-REL');
      expect(result.score).toBe(0.3);
    });
  });

  describe('getMaxDimension', () => {
    it('should find the maximum dimension', () => {
      const dims = { 'CT-COMP': 0.8, 'CT-REL': 0.3, 'CT-OBS': 0.5, 'CT-TRANS': 0.6, 'CT-ACCT': 0.4 };
      const result = getMaxDimension(dims);
      expect(result.dimension).toBe('CT-COMP');
      expect(result.score).toBe(0.8);
    });
  });

  describe('getDimensionDelta', () => {
    it('should calculate dimension changes', () => {
      const prev = { 'CT-COMP': 0.5, 'CT-REL': 0.5, 'CT-OBS': 0.5, 'CT-TRANS': 0.5, 'CT-ACCT': 0.5 };
      const curr = { 'CT-COMP': 0.6, 'CT-REL': 0.4, 'CT-OBS': 0.5, 'CT-TRANS': 0.55, 'CT-ACCT': 0.45 };
      const delta = getDimensionDelta(prev, curr);

      expect(delta['CT-COMP']).toBeCloseTo(0.1);
      expect(delta['CT-REL']).toBeCloseTo(-0.1);
      expect(delta['CT-OBS']).toBeCloseTo(0);
      expect(delta['CT-TRANS']).toBeCloseTo(0.05);
      expect(delta['CT-ACCT']).toBeCloseTo(-0.05);
    });
  });

  describe('adjustDimensions', () => {
    it('should apply adjustments', () => {
      const dims = { 'CT-COMP': 0.5, 'CT-REL': 0.5, 'CT-OBS': 0.5 };
      const result = adjustDimensions(dims, { 'CT-COMP': 0.2, 'CT-REL': -0.1 });

      expect(result['CT-COMP']).toBeCloseTo(0.7);
      expect(result['CT-REL']).toBeCloseTo(0.4);
      expect(result['CT-OBS']).toBeCloseTo(0.5);
    });

    it('should clamp adjusted values', () => {
      const dims = { 'CT-COMP': 0.9, 'CT-REL': 0.1, 'CT-OBS': 0.5 };
      const result = adjustDimensions(dims, { 'CT-COMP': 0.2, 'CT-REL': -0.2 });

      expect(result['CT-COMP']).toBe(1.0);
      expect(result['CT-REL']).toBe(0);
    });
  });
});

describe('Trust Weights', () => {
  describe('createWeights', () => {
    it('should create default weights', () => {
      const weights = createWeights();
      // Weights are deprecated - DEFAULT_TRUST_WEIGHTS is now empty
      expect(weights).toEqual(DEFAULT_TRUST_WEIGHTS);
    });

    it('should return provided weights as-is (deprecated stub)', () => {
      const weights = createWeights({ 'CT-COMP': 0.5, 'CT-REL': 0.5 });
      // createWeights is a deprecated stub that returns input unchanged
      expect(weights['CT-COMP']).toBe(0.5);
      expect(weights['CT-REL']).toBe(0.5);
    });
  });

  describe('normalizeWeights', () => {
    it('should return weights unchanged (deprecated stub)', () => {
      const input = { 'CT-COMP': 2, 'CT-REL': 2 };
      const result = normalizeWeights(input);
      // normalizeWeights is a deprecated stub that returns input unchanged
      expect(result['CT-COMP']).toBe(2);
      expect(result['CT-REL']).toBe(2);
    });
  });

  describe('isValidWeights', () => {
    it('should always return true (deprecated stub)', () => {
      expect(isValidWeights(DEFAULT_TRUST_WEIGHTS)).toBe(true);
    });

    it('should always return true for any object (deprecated stub)', () => {
      const any = { 'CT-COMP': 0.5, 'CT-REL': 0.5 };
      expect(isValidWeights(any)).toBe(true);
    });
  });

  describe('weightsAreSummedCorrectly', () => {
    it('should always return true (deprecated stub)', () => {
      expect(weightsAreSummedCorrectly(DEFAULT_TRUST_WEIGHTS)).toBe(true);
    });

    it('should always return true for any weights (deprecated stub)', () => {
      const any = { 'CT-COMP': 0.1 };
      expect(weightsAreSummedCorrectly(any)).toBe(true);
    });
  });

  describe('WEIGHT_PRESETS', () => {
    it('should be an empty object (deprecated)', () => {
      // WEIGHT_PRESETS is now empty since weights are removed
      expect(Object.keys(WEIGHT_PRESETS).length).toBe(0);
    });
  });
});

describe('Trust Calculator', () => {
  describe('calculateCompositeScore', () => {
    it('should calculate average of factor scores times 1000', () => {
      // All factors at 1.0 -> average 1.0 -> composite 1000
      const factors = { 'CT-COMP': 1.0, 'CT-REL': 1.0, 'CT-OBS': 1.0 };
      expect(calculateCompositeScore(factors)).toBe(1000);
    });

    it('should handle single factor', () => {
      const factors = { 'CT-COMP': 0.5 };
      expect(calculateCompositeScore(factors)).toBe(500);
    });

    it('should handle mixed scores', () => {
      // Average of 0.8, 0.6, 0.7, 0.5, 0.4 = 3.0 / 5 = 0.6 -> 600
      const factors = { 'CT-COMP': 0.8, 'CT-REL': 0.6, 'CT-OBS': 0.7, 'CT-TRANS': 0.5, 'CT-ACCT': 0.4 };
      expect(calculateCompositeScore(factors)).toBe(600);
    });
  });

  describe('applyObservationCeiling', () => {
    it('should cap BLACK_BOX at 600', () => {
      expect(applyObservationCeiling(800, ObservationTier.BLACK_BOX)).toBe(600);
    });

    it('should cap GRAY_BOX at 750', () => {
      expect(applyObservationCeiling(800, ObservationTier.GRAY_BOX)).toBe(750);
    });

    it('should cap WHITE_BOX at 900 (per ATSF v2.0 RTA)', () => {
      expect(applyObservationCeiling(1000, ObservationTier.WHITE_BOX)).toBe(900);
    });

    it('should cap ATTESTED_BOX at 950 (per ATSF v2.0 RTA)', () => {
      expect(applyObservationCeiling(1000, ObservationTier.ATTESTED_BOX)).toBe(950);
    });

    it('should allow VERIFIED_BOX to reach 1000', () => {
      expect(applyObservationCeiling(1000, ObservationTier.VERIFIED_BOX)).toBe(1000);
    });

    it('should not modify scores below ceiling', () => {
      expect(applyObservationCeiling(500, ObservationTier.BLACK_BOX)).toBe(500);
    });
  });

  describe('createEvidence', () => {
    it('should create valid evidence', () => {
      const evidence = createEvidence('CT-COMP', 100, 'test');
      expect(evidence.factorCode).toBe('CT-COMP');
      expect(evidence.impact).toBe(100);
      expect(evidence.source).toBe('test');
      expect(evidence.evidenceId).toBeDefined();
    });

    it('should clamp impact to valid range', () => {
      const ev1 = createEvidence('CT-COMP', 1500, 'test');
      const ev2 = createEvidence('CT-COMP', -1500, 'test');
      expect(ev1.impact).toBe(1000);
      expect(ev2.impact).toBe(-1000);
    });
  });

  describe('calculateTrustProfile', () => {
    it('should create a complete trust profile', () => {
      const evidence = [
        createEvidence('CT-COMP', 300, 'successful task'),
        createEvidence('CT-REL', 200, 'consistent behavior'),
      ];

      const profile = calculateTrustProfile(
        'agent-123',
        ObservationTier.WHITE_BOX,
        evidence
      );

      expect(profile.agentId).toBe('agent-123');
      expect(profile.observationTier).toBe(ObservationTier.WHITE_BOX);
      // Factor scores for CT-COMP and CT-REL should be above baseline 0.5
      expect(profile.factorScores['CT-COMP']).toBeGreaterThan(0.5);
      expect(profile.factorScores['CT-REL']).toBeGreaterThan(0.5);
      expect(profile.compositeScore).toBeGreaterThan(0);
      expect(profile.band).toBeDefined();
      expect(profile.version).toBe(1);
    });

    it('should apply observation ceiling', () => {
      // Create evidence that would push score above BLACK_BOX ceiling (600)
      const evidence = Array(10).fill(null).map(() =>
        createEvidence('CT-COMP', 500, 'test')
      );

      const profile = calculateTrustProfile(
        'agent-123',
        ObservationTier.BLACK_BOX,
        evidence
      );

      expect(profile.adjustedScore).toBeLessThanOrEqual(600);
    });
  });
});
