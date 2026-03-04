import { describe, it, expect, beforeEach } from 'vitest';
import {
  TrustBand,
  getBand,
  getBandRange,
  getBandName,
  getNextBand,
  getPreviousBand,
  isHigherBand,
  BAND_DESCRIPTIONS,
} from '../../src/banding/bands.js';
import {
  HysteresisCalculator,
  createHysteresisCalculator,
  type BandHistoryEntry,
} from '../../src/banding/hysteresis.js';
import {
  BandCalculator,
  createBandCalculator,
  TransitionType,
} from '../../src/banding/band-calculator.js';

describe('Trust Bands', () => {
  describe('getBand', () => {
    it('should map scores to correct bands', () => {
      expect(getBand(100)).toBe(TrustBand.T0_SANDBOX);      // 0-199
      expect(getBand(300)).toBe(TrustBand.T1_OBSERVED);     // 200-349
      expect(getBand(450)).toBe(TrustBand.T2_PROVISIONAL);  // 350-499
      expect(getBand(600)).toBe(TrustBand.T3_MONITORED);    // 500-649
      expect(getBand(700)).toBe(TrustBand.T4_STANDARD);     // 650-799
      expect(getBand(850)).toBe(TrustBand.T5_TRUSTED);      // 800-875
      expect(getBand(900)).toBe(TrustBand.T6_CERTIFIED);    // 876-950
      expect(getBand(975)).toBe(TrustBand.T7_AUTONOMOUS);   // 951-1000
    });

    it('should handle boundary values', () => {
      expect(getBand(0)).toBe(TrustBand.T0_SANDBOX);
      expect(getBand(199)).toBe(TrustBand.T0_SANDBOX);
      expect(getBand(200)).toBe(TrustBand.T1_OBSERVED);
      expect(getBand(1000)).toBe(TrustBand.T7_AUTONOMOUS);
    });
  });

  describe('getBandRange', () => {
    it('should return correct range for each band', () => {
      expect(getBandRange(TrustBand.T0_SANDBOX)).toEqual({ min: 0, max: 199 });
      expect(getBandRange(TrustBand.T3_MONITORED)).toEqual({ min: 500, max: 649 });
      expect(getBandRange(TrustBand.T7_AUTONOMOUS)).toEqual({ min: 951, max: 1000 });
    });
  });

  describe('getBandName', () => {
    it('should return human-readable names', () => {
      expect(getBandName(TrustBand.T0_SANDBOX)).toBe('Sandbox');
      expect(getBandName(TrustBand.T5_TRUSTED)).toBe('Trusted');
      expect(getBandName(TrustBand.T7_AUTONOMOUS)).toBe('Autonomous');
    });
  });

  describe('getNextBand', () => {
    it('should return next band', () => {
      expect(getNextBand(TrustBand.T2_PROVISIONAL)).toBe(TrustBand.T3_MONITORED);
      expect(getNextBand(TrustBand.T7_AUTONOMOUS)).toBe(null);
    });
  });

  describe('getPreviousBand', () => {
    it('should return previous band', () => {
      expect(getPreviousBand(TrustBand.T3_MONITORED)).toBe(TrustBand.T2_PROVISIONAL);
      expect(getPreviousBand(TrustBand.T0_SANDBOX)).toBe(null);
    });
  });

  describe('isHigherBand', () => {
    it('should compare bands correctly', () => {
      expect(isHigherBand(TrustBand.T4_STANDARD, TrustBand.T2_PROVISIONAL)).toBe(true);
      expect(isHigherBand(TrustBand.T1_OBSERVED, TrustBand.T3_MONITORED)).toBe(false);
    });
  });

  describe('BAND_DESCRIPTIONS', () => {
    it('should have descriptions for all bands', () => {
      for (const band of Object.values(TrustBand).filter(v => typeof v === 'number')) {
        expect(BAND_DESCRIPTIONS[band as TrustBand]).toBeDefined();
        expect(BAND_DESCRIPTIONS[band as TrustBand].name).toBeDefined();
        expect(BAND_DESCRIPTIONS[band as TrustBand].typicalCapabilities.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('Hysteresis', () => {
  let hysteresis: HysteresisCalculator;

  beforeEach(() => {
    hysteresis = createHysteresisCalculator({ hysteresis: 10 });
  });

  describe('calculateBandWithHysteresis', () => {
    it('should prevent oscillation near thresholds', () => {
      // Score of 355 is just above T1 max (349), but within hysteresis of 10
      // Should stay at T1 if currently T1
      const result = hysteresis.calculateBandWithHysteresis(
        TrustBand.T1_OBSERVED,
        355
      );
      expect(result).toBe(TrustBand.T1_OBSERVED);
    });

    it('should allow transitions outside hysteresis zone', () => {
      // Score of 450 is well above T1 max (349) + hysteresis (10)
      const result = hysteresis.calculateBandWithHysteresis(
        TrustBand.T1_OBSERVED,
        450
      );
      expect(result).toBe(TrustBand.T2_PROVISIONAL);
    });

    it('should prevent demotion in hysteresis zone', () => {
      // Score of 345 is just below T2 min (350) with hysteresis of 10
      // Should stay T2 if currently T2
      const result = hysteresis.calculateBandWithHysteresis(
        TrustBand.T2_PROVISIONAL,
        345
      );
      expect(result).toBe(TrustBand.T2_PROVISIONAL);
    });
  });

  describe('canPromoteByTime', () => {
    it('should require minimum days at band', () => {
      const history: BandHistoryEntry[] = [
        {
          band: TrustBand.T2_PROVISIONAL,
          score: 450,
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        },
      ];

      const result = hysteresis.canPromoteByTime(history, TrustBand.T3_MONITORED);
      expect(result.allowed).toBe(false);
      expect(result.daysAtCurrentBand).toBe(3);
      expect(result.daysRequired).toBe(7); // Default promotion delay
    });

    it('should allow promotion after sufficient time', () => {
      const history: BandHistoryEntry[] = [
        {
          band: TrustBand.T2_PROVISIONAL,
          score: 450,
          timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        },
      ];

      const result = hysteresis.canPromoteByTime(history, TrustBand.T3_MONITORED);
      expect(result.allowed).toBe(true);
    });
  });

  describe('getPromotionThreshold', () => {
    it('should return correct threshold', () => {
      // T2 max is 499, hysteresis is 10, so threshold is 509
      const threshold = hysteresis.getPromotionThreshold(TrustBand.T2_PROVISIONAL);
      expect(threshold).toBe(509);
    });

    it('should return null for max band', () => {
      expect(hysteresis.getPromotionThreshold(TrustBand.T7_AUTONOMOUS)).toBe(null);
    });
  });

  describe('getDemotionThreshold', () => {
    it('should return correct threshold', () => {
      // T2 min is 350, hysteresis is 10, so threshold is 340
      const threshold = hysteresis.getDemotionThreshold(TrustBand.T2_PROVISIONAL);
      expect(threshold).toBe(340);
    });

    it('should return null for min band', () => {
      expect(hysteresis.getDemotionThreshold(TrustBand.T0_SANDBOX)).toBe(null);
    });
  });
});

describe('BandCalculator', () => {
  let calculator: BandCalculator;

  beforeEach(() => {
    calculator = createBandCalculator({ promotionDelay: 7, hysteresis: 30 });
  });

  describe('evaluateTransition', () => {
    it('should allow immediate demotion', () => {
      calculator.recordScoreSnapshot('agent-1', TrustBand.T3_MONITORED, 600);

      const result = calculator.evaluateTransition(
        'agent-1',
        TrustBand.T3_MONITORED,
        300 // Clear demotion to T1
      );

      expect(result.allowed).toBe(true);
      expect(result.transitionType).toBe(TransitionType.DEMOTION);
      expect(result.newBand).toBeLessThan(TrustBand.T3_MONITORED);
    });

    it('should block promotion without time requirement', () => {
      // Record that agent just entered T2
      calculator.recordScoreSnapshot('agent-1', TrustBand.T2_PROVISIONAL, 450);

      const result = calculator.evaluateTransition(
        'agent-1',
        TrustBand.T2_PROVISIONAL,
        600 // Would be T3
      );

      expect(result.allowed).toBe(false);
      expect(result.transitionType).toBe(TransitionType.PROMOTION);
      expect(result.daysUntilPromotion).toBeGreaterThan(0);
    });

    it('should allow promotion after time requirement', () => {
      // Record that agent has been at T2 for 10 days
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      calculator.recordScoreSnapshot('agent-1', TrustBand.T2_PROVISIONAL, 450, tenDaysAgo);

      const result = calculator.evaluateTransition(
        'agent-1',
        TrustBand.T2_PROVISIONAL,
        600 // Clear promotion
      );

      expect(result.allowed).toBe(true);
      expect(result.transitionType).toBe(TransitionType.PROMOTION);
      expect(result.newBand).toBe(TrustBand.T3_MONITORED);
    });

    it('should block transition within hysteresis zone', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      calculator.recordScoreSnapshot('agent-1', TrustBand.T2_PROVISIONAL, 450, tenDaysAgo);

      // Score of 515 is above T2 max (499) but within hysteresis (30)
      const result = calculator.evaluateTransition(
        'agent-1',
        TrustBand.T2_PROVISIONAL,
        515
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hysteresis');
    });
  });

  describe('calculateStability', () => {
    it('should calculate stability metrics', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      calculator.recordScoreSnapshot('agent-1', TrustBand.T3_MONITORED, 600, thirtyDaysAgo);

      const stability = calculator.calculateStability('agent-1');

      expect(stability.currentBand).toBe(TrustBand.T3_MONITORED);
      expect(stability.daysAtBand).toBeGreaterThanOrEqual(29);
      expect(stability.recentTransitions).toBe(0);
      expect(stability.stable).toBe(true);
    });

    it('should detect unstable agents', () => {
      const now = new Date();

      // Simulate multiple transitions
      calculator.recordScoreSnapshot('agent-1', TrustBand.T2_PROVISIONAL, 450, new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000));
      calculator.recordScoreSnapshot('agent-1', TrustBand.T3_MONITORED, 600, new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000));
      calculator.recordScoreSnapshot('agent-1', TrustBand.T2_PROVISIONAL, 400, new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000));
      calculator.recordScoreSnapshot('agent-1', TrustBand.T3_MONITORED, 620, new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000));

      const stability = calculator.calculateStability('agent-1', now);

      expect(stability.recentTransitions).toBeGreaterThan(0);
      expect(stability.stabilityScore).toBeLessThan(0.7);
    });
  });

  describe('getTransitionEvents', () => {
    it('should record transition events', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      calculator.recordScoreSnapshot('agent-1', TrustBand.T3_MONITORED, 600, tenDaysAgo);

      // Force a demotion
      calculator.evaluateTransition('agent-1', TrustBand.T3_MONITORED, 100);

      const events = calculator.getTransitionEvents('agent-1');
      expect(events.length).toBe(1);
      expect(events[0]!.transitionType).toBe(TransitionType.DEMOTION);
    });
  });
});
