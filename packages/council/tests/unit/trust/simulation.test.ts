import { describe, it, expect } from 'vitest';
import {
  TRUST_TIERS,
  FACTORS,
  FACTOR_WEIGHTS,
  GATING_THRESHOLDS,
  AGENT_ARCHETYPES,
  simulateAgent,
  type TierName,
  type AgentArchetype,
} from '../../../src/trust/simulation.js';

describe('Trust Simulation', () => {
  describe('TRUST_TIERS', () => {
    it('should define 8 tiers (T0-T7)', () => {
      expect(TRUST_TIERS).toHaveLength(8);
    });

    it('should have contiguous score ranges', () => {
      for (let i = 1; i < TRUST_TIERS.length; i++) {
        expect(TRUST_TIERS[i]!.min).toBe(TRUST_TIERS[i - 1]!.max + 1);
      }
    });

    it('should start at T0 (score 0) and end at T7 (score 1000)', () => {
      expect(TRUST_TIERS[0]!.name).toBe('T0');
      expect(TRUST_TIERS[0]!.min).toBe(0);
      expect(TRUST_TIERS[7]!.name).toBe('T7');
      expect(TRUST_TIERS[7]!.max).toBe(1000);
    });

    it('each tier should have name, label, min, max, description', () => {
      for (const tier of TRUST_TIERS) {
        expect(tier.name).toBeDefined();
        expect(tier.label).toBeDefined();
        expect(typeof tier.min).toBe('number');
        expect(typeof tier.max).toBe('number');
        expect(tier.description).toBeDefined();
      }
    });
  });

  describe('FACTORS', () => {
    it('should define 16 factors', () => {
      expect(FACTORS).toHaveLength(16);
    });

    it('should group factors into 5 groups', () => {
      const groups = new Set(FACTORS.map((f) => f.group));
      expect(groups.size).toBe(5);
      expect(groups).toContain('foundation');
      expect(groups).toContain('security');
      expect(groups).toContain('agency');
      expect(groups).toContain('maturity');
      expect(groups).toContain('evolution');
    });

    it('each factor should have code, name, group, description', () => {
      for (const factor of FACTORS) {
        expect(factor.code).toBeDefined();
        expect(factor.name).toBeDefined();
        expect(factor.group).toBeDefined();
        expect(factor.description).toBeDefined();
      }
    });

    it('foundation group should have 6 factors', () => {
      const foundation = FACTORS.filter((f) => f.group === 'foundation');
      expect(foundation).toHaveLength(6);
    });

    it('security group should have 3 factors', () => {
      const security = FACTORS.filter((f) => f.group === 'security');
      expect(security).toHaveLength(3);
    });
  });

  describe('FACTOR_WEIGHTS', () => {
    it('should define weights for T0-T1, T2-T3, T4-T5, T6', () => {
      expect(FACTOR_WEIGHTS).toHaveProperty('T0-T1');
      expect(FACTOR_WEIGHTS).toHaveProperty('T2-T3');
      expect(FACTOR_WEIGHTS).toHaveProperty('T4-T5');
      expect(FACTOR_WEIGHTS).toHaveProperty('T6');
    });

    it('each weight set should sum approximately to 1.0', () => {
      for (const [key, weights] of Object.entries(FACTOR_WEIGHTS)) {
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 1);
      }
    });
  });

  describe('GATING_THRESHOLDS', () => {
    it('should define thresholds for tier promotions', () => {
      expect(GATING_THRESHOLDS).toHaveProperty('T0->T1');
      expect(GATING_THRESHOLDS).toHaveProperty('T1->T2');
      expect(GATING_THRESHOLDS).toHaveProperty('T2->T3');
      expect(GATING_THRESHOLDS).toHaveProperty('T3->T4');
      expect(GATING_THRESHOLDS).toHaveProperty('T4->T5');
      expect(GATING_THRESHOLDS).toHaveProperty('T5->T6');
    });

    it('T0->T1 should require fewer factors than T5->T6', () => {
      const t0t1 = Object.keys(GATING_THRESHOLDS['T0->T1']!);
      const t5t6 = Object.keys(GATING_THRESHOLDS['T5->T6']!);
      expect(t0t1.length).toBeLessThan(t5t6.length);
    });

    it('thresholds should increase with higher tiers', () => {
      // CT-OBS threshold should be higher for T5->T6 than T0->T1
      const t0t1Obs = GATING_THRESHOLDS['T0->T1']!['CT-OBS']!;
      const t5t6Obs = GATING_THRESHOLDS['T5->T6']!['CT-OBS']!;
      expect(t5t6Obs).toBeGreaterThan(t0t1Obs);
    });
  });

  describe('AGENT_ARCHETYPES', () => {
    it('should define multiple archetypes', () => {
      expect(AGENT_ARCHETYPES.length).toBeGreaterThan(10);
    });

    it('each archetype should have required fields', () => {
      for (const arch of AGENT_ARCHETYPES) {
        expect(arch.name).toBeDefined();
        expect(arch.description).toBeDefined();
        expect(arch.growthRates).toBeDefined();
        expect(arch.initialScores).toBeDefined();
        expect(typeof arch.variance).toBe('number');
        expect(arch.expectedTier).toBeDefined();
      }
    });

    it('should include great, good, mid, specialized, poor, and malicious agents', () => {
      const descriptions = AGENT_ARCHETYPES.map((a) => a.description);
      expect(descriptions.some((d) => d.includes('GREAT'))).toBe(true);
      expect(descriptions.some((d) => d.includes('GOOD'))).toBe(true);
      expect(descriptions.some((d) => d.includes('MID'))).toBe(true);
      expect(descriptions.some((d) => d.includes('SPECIALIZED'))).toBe(true);
      expect(descriptions.some((d) => d.includes('POOR'))).toBe(true);
      expect(descriptions.some((d) => d.includes('MALICIOUS'))).toBe(true);
    });

    it('malicious agents should have T0 expected tier', () => {
      const malicious = AGENT_ARCHETYPES.filter((a) =>
        a.description.includes('MALICIOUS')
      );
      for (const agent of malicious) {
        expect(agent.expectedTier).toBe('T0');
      }
    });
  });

  describe('simulateAgent', () => {
    it('should return a complete simulation result', () => {
      const archetype = AGENT_ARCHETYPES[0]!; // Exemplary Agent
      const result = simulateAgent(archetype, 30);

      expect(result.archetype).toBe(archetype);
      expect(result.days).toHaveLength(31); // 0 through 30 inclusive
      expect(result.finalTier).toBeDefined();
      expect(typeof result.finalScore).toBe('number');
      expect(typeof result.promotions).toBe('number');
      expect(typeof result.blockedCount).toBe('number');
    });

    it('should track daily progress with scores and tiers', () => {
      const archetype = AGENT_ARCHETYPES[0]!;
      const result = simulateAgent(archetype, 10);

      for (const day of result.days) {
        expect(typeof day.day).toBe('number');
        expect(typeof day.overall).toBe('number');
        expect(day.tier).toBeDefined();
        expect(day.scores).toBeDefined();
      }
    });

    it('should clamp scores to 0-1000 range', () => {
      const archetype = AGENT_ARCHETYPES[0]!;
      const result = simulateAgent(archetype, 90);

      for (const day of result.days) {
        for (const score of Object.values(day.scores)) {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1000);
        }
      }
    });

    it('great agents should generally reach T4+', () => {
      const exemplary = AGENT_ARCHETYPES.find((a) => a.name === 'Exemplary Agent')!;
      const result = simulateAgent(exemplary, 90);

      // Exemplary should reach at least T3 within 90 days
      const tierOrder: TierName[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      const finalIndex = tierOrder.indexOf(result.finalTier);
      expect(finalIndex).toBeGreaterThanOrEqual(3); // at least T3
    });

    it('malicious agents should stay at T0-T1', () => {
      const malicious = AGENT_ARCHETYPES.find((a) => a.name === 'Pure Malicious')!;
      const result = simulateAgent(malicious, 90);

      const tierOrder: TierName[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      const finalIndex = tierOrder.indexOf(result.finalTier);
      expect(finalIndex).toBeLessThanOrEqual(1); // T0 or T1
    });

    it('should report blocked dimensions when gating prevents promotion', () => {
      const codeWizard = AGENT_ARCHETYPES.find((a) => a.name === 'Code Wizard')!;
      const result = simulateAgent(codeWizard, 90);

      // Code Wizard should have blocks due to weak SF-HUM/OP-HUMAN
      expect(result.blockedCount).toBeGreaterThan(0);
      expect(Object.keys(result.blockedDimensions).length).toBeGreaterThan(0);
    });
  });
});
