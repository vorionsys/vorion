import { describe, it, expect, beforeEach } from 'vitest';
import {
  TrustCalculator,
  createTrustCalculator,
  createEvidence,
  DEFAULT_DIMINISHING_RETURNS,
} from '../../src/trust/index.js';
import { ObservationTier, TrustBand } from '@vorionsys/contracts';

describe('TrustCalculator Class', () => {
  let calculator: TrustCalculator;

  beforeEach(() => {
    calculator = createTrustCalculator();
  });

  describe('calculate', () => {
    it('should create a trust profile from evidence', () => {
      const evidence = [
        createEvidence('CT-COMP', 300, 'successful task'),
        createEvidence('CT-REL', 200, 'consistent behavior'),
      ];

      const profile = calculator.calculate(
        'agent-123',
        ObservationTier.WHITE_BOX,
        evidence
      );

      expect(profile.agentId).toBe('agent-123');
      expect(profile.observationTier).toBe(ObservationTier.WHITE_BOX);
      expect(profile.compositeScore).toBeGreaterThan(0);
      expect(profile.version).toBe(1);
    });

    it('should apply observation ceiling', () => {
      // Create high-scoring evidence
      const evidence = Array(10).fill(null).map(() =>
        createEvidence('CT-COMP', 500, 'excellent')
      );

      const profile = calculator.calculate(
        'agent-123',
        ObservationTier.BLACK_BOX,
        evidence
      );

      expect(profile.adjustedScore).toBeLessThanOrEqual(600);
    });

    it('should handle empty evidence', () => {
      const profile = calculator.calculate(
        'agent-123',
        ObservationTier.WHITE_BOX,
        []
      );

      // With no evidence, all 16 factors at baseline 0.5
      // Composite = average(0.5) * 1000 = 500
      expect(profile.compositeScore).toBe(500);
      expect(profile.band).toBe(TrustBand.T3_MONITORED);
    });
  });

  describe('recalculate', () => {
    it('should increment version on recalculation', () => {
      const initial = calculator.calculate(
        'agent-123',
        ObservationTier.WHITE_BOX,
        [createEvidence('CT-COMP', 100, 'test')]
      );

      const updated = calculator.recalculate(initial, [
        createEvidence('CT-REL', 150, 'new evidence'),
      ]);

      expect(updated.version).toBe(2);
      expect(updated.evidence.length).toBe(2);
    });

    it('should apply hysteresis on band changes', () => {
      // Start with empty evidence - baseline score 500 = T3
      const initial = calculator.calculate(
        'agent-123',
        ObservationTier.WHITE_BOX,
        [createEvidence('CT-COMP', 100, 'test')]
      );
      expect(initial.band).toBe(TrustBand.T3_MONITORED);

      // Add small evidence - should not change band due to hysteresis
      const updated = calculator.recalculate(initial, [
        createEvidence('CT-COMP', 100, 'more'),
      ]);

      // Band should be stable due to hysteresis
      expect(updated.band).toBeLessThanOrEqual(TrustBand.T3_MONITORED);
    });
  });

  describe('applyDecay', () => {
    it('should reduce scores for old evidence', () => {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const evidence = [{
        evidenceId: 'test-1',
        factorCode: 'CT-COMP',
        impact: 300,
        source: 'old test',
        collectedAt: oldDate,
      }];

      const initial = calculator.calculate(
        'agent-123',
        ObservationTier.WHITE_BOX,
        evidence,
        { applyDecay: false }
      );

      const decayed = calculator.applyDecay(initial);

      expect(decayed.compositeScore).toBeLessThan(initial.compositeScore);
    });
  });

  describe('computeCompositeScore', () => {
    it('should calculate average of factor scores times 1000', () => {
      // All factors at 1.0 -> composite = 1000
      const factors = { 'CT-COMP': 1.0, 'CT-REL': 1.0, 'CT-OBS': 1.0 };
      expect(calculator.computeCompositeScore(factors)).toBe(1000);
    });

    it('should handle mixed scores', () => {
      // Average of 0.8, 0.6, 0.7, 0.5, 0.4 = 3.0/5 = 0.6 -> 600
      const factors = { 'CT-COMP': 0.8, 'CT-REL': 0.6, 'CT-OBS': 0.7, 'CT-TRANS': 0.5, 'CT-ACCT': 0.4 };
      const score = calculator.computeCompositeScore(factors);
      expect(score).toBeCloseTo(600, 1);
    });

    it('should throw for invalid dimensions', () => {
      // Factor scores must be in 0.0-1.0 range
      const invalid = { 'CT-COMP': 1.5, 'CT-REL': 0.5 };
      expect(() => calculator.computeCompositeScore(invalid)).toThrow();
    });
  });

  describe('aggregateEvidence', () => {
    it('should skip expired evidence', () => {
      const pastDate = new Date(Date.now() - 1000);
      const expiredEvidence = {
        evidenceId: 'expired',
        factorCode: 'CT-COMP',
        impact: 500,
        source: 'test',
        collectedAt: new Date(Date.now() - 10000),
        expiresAt: pastDate,
      };

      const result = calculator.aggregateEvidence([expiredEvidence]);
      expect(result.expiredEvidenceCount).toBe(1);
      expect(result.validEvidenceCount).toBe(0);
    });

    it('should track date range', () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-06-01');

      const evidence = [
        { ...createEvidence('CT-COMP', 100, 'old'), collectedAt: oldDate },
        { ...createEvidence('CT-REL', 100, 'new'), collectedAt: newDate },
      ];

      const result = calculator.aggregateEvidence(evidence, new Date('2024-12-01'), false);
      expect(result.oldestEvidence).toEqual(oldDate);
      expect(result.newestEvidence).toEqual(newDate);
    });
  });

  describe('Dilution Resistance (Diminishing Returns)', () => {
    it('should resist dilution of a large negative signal by many small positives', () => {
      const now = new Date();
      const evidence = [
        // One large negative signal
        { evidenceId: 'neg', factorCode: 'CT-COMP', impact: -500, source: 'test', collectedAt: now },
        // 100 tiny positive signals attempting to dilute it
        ...Array.from({ length: 100 }, (_, i) => ({
          evidenceId: `pos-${i}`,
          factorCode: 'CT-COMP',
          impact: 1,
          source: 'test',
          collectedAt: now,
        })),
      ];

      const profile = calculator.calculate('dilution-agent', ObservationTier.WHITE_BOX, evidence, {
        applyDecay: false,
        now,
      });

      // Without diminishing returns: avg = (-500 + 100) / 101 ≈ -3.96, factorScore ≈ 0.496
      // With diminishing returns: -500 gets 1.0 weight, 100 tiny +1s get progressively less
      // Weighted avg ≈ -60.9, factorScore ≈ 0.439 — well below baseline 0.5
      // Key property: 100 flooding signals cannot negate a single critical failure
      expect(profile.factorScores['CT-COMP']).toBeLessThan(0.45);
      // Also verify it's significantly lower than what simple averaging would give (~0.496)
      expect(profile.factorScores['CT-COMP']).toBeLessThan(0.496);
    });

    it('should give full weight to the largest signals', () => {
      const now = new Date();
      // Two signals: one large, one small
      const evidence = [
        { evidenceId: 'large', factorCode: 'CT-COMP', impact: 300, source: 'test', collectedAt: now },
        { evidenceId: 'small', factorCode: 'CT-COMP', impact: 10, source: 'test', collectedAt: now },
      ];

      const profile = calculator.calculate('weight-agent', ObservationTier.WHITE_BOX, evidence, {
        applyDecay: false,
        now,
      });

      // With diminishing returns: weighted avg = (300*1.0 + 10*0.7) / (1.0+0.7) ≈ 180.6
      // factorScore = 0.5 + 180.6/1000 ≈ 0.681
      // Simple avg would give (300+10)/2 = 155, factorScore = 0.5 + 0.155 = 0.655
      // Diminishing returns should give MORE weight to the large signal
      expect(profile.factorScores['CT-COMP']).toBeGreaterThan(0.65);
    });

    it('should still work correctly with a single evidence item', () => {
      const now = new Date();
      const evidence = [
        { evidenceId: 'single', factorCode: 'CT-COMP', impact: 200, source: 'test', collectedAt: now },
      ];

      const profile = calculator.calculate('single-agent', ObservationTier.WHITE_BOX, evidence, {
        applyDecay: false,
        now,
      });

      // Single evidence: weight = 1.0, avg = 200
      // factorScore = 0.5 + 200/1000 = 0.7
      expect(profile.factorScores['CT-COMP']).toBeCloseTo(0.7, 1);
    });
  });

  describe('Configurable Diminishing Returns (P3)', () => {
    it('DEFAULT_DIMINISHING_RETURNS produces known weights', () => {
      expect(DEFAULT_DIMINISHING_RETURNS(0)).toBe(1.0);
      expect(DEFAULT_DIMINISHING_RETURNS(1)).toBe(0.7);
      expect(DEFAULT_DIMINISHING_RETURNS(2)).toBe(0.5);
      expect(DEFAULT_DIMINISHING_RETURNS(5)).toBe(0.2);
      expect(DEFAULT_DIMINISHING_RETURNS(9)).toBe(0.2);
      expect(DEFAULT_DIMINISHING_RETURNS(10)).toBe(0.05);
      expect(DEFAULT_DIMINISHING_RETURNS(100)).toBe(0.05);
    });

    it('custom weight function changes dilution behavior', () => {
      const now = new Date();
      // Aggressive curve: only the first signal matters
      const aggressiveCalc = createTrustCalculator({
        diminishingReturns: (i) => (i === 0 ? 1.0 : 0.0),
      });
      // Flat curve: all signals weighted equally (like simple average)
      const flatCalc = createTrustCalculator({
        diminishingReturns: () => 1.0,
      });

      const evidence = [
        { evidenceId: 'neg', factorCode: 'CT-COMP', impact: -500, source: 'test', collectedAt: now },
        ...Array.from({ length: 10 }, (_, i) => ({
          evidenceId: `pos-${i}`, factorCode: 'CT-COMP', impact: 50, source: 'test', collectedAt: now,
        })),
      ];

      const aggressive = aggressiveCalc.calculate('a1', ObservationTier.WHITE_BOX, evidence, {
        applyDecay: false, now,
      });
      const flat = flatCalc.calculate('a2', ObservationTier.WHITE_BOX, evidence, {
        applyDecay: false, now,
      });

      // Aggressive: only -500 counts → factor ≈ 0.0 (clamped)
      // Flat: average = (-500 + 50*10) / 11 ≈ 0 → factor ≈ 0.5
      expect(aggressive.factorScores['CT-COMP']).toBeLessThan(0.05);
      expect(flat.factorScores['CT-COMP']).toBeGreaterThan(0.45);
    });

    it('default behavior is unchanged when no custom function provided', () => {
      const now = new Date();
      const defaultCalc = createTrustCalculator();
      const explicitCalc = createTrustCalculator({
        diminishingReturns: DEFAULT_DIMINISHING_RETURNS,
      });

      const evidence = [
        { evidenceId: 'e1', factorCode: 'CT-COMP', impact: 300, source: 'test', collectedAt: now },
        { evidenceId: 'e2', factorCode: 'CT-COMP', impact: -100, source: 'test', collectedAt: now },
      ];

      const d = defaultCalc.calculate('d', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now });
      const e = explicitCalc.calculate('e', ObservationTier.WHITE_BOX, evidence, { applyDecay: false, now });

      expect(d.factorScores['CT-COMP']).toBeCloseTo(e.factorScores['CT-COMP']!, 10);
    });
  });

  describe('configuration', () => {
    it('should use custom decay rate', () => {
      const fastDecay = createTrustCalculator({ decayRate: 0.1 });
      const slowDecay = createTrustCalculator({ decayRate: 0.01 });

      const oldEvidence = [{
        evidenceId: 'test',
        factorCode: 'CT-COMP',
        impact: 300,
        source: 'test',
        collectedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      }];

      const fastResult = fastDecay.aggregateEvidence(oldEvidence);
      const slowResult = slowDecay.aggregateEvidence(oldEvidence);

      // Fast decay should have lower factor scores for CT-COMP
      expect(fastResult.factorScores['CT-COMP']).toBeLessThan(slowResult.factorScores['CT-COMP']!);
    });
  });
});
