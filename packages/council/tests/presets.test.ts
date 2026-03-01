import { describe, it, expect } from 'vitest';
import {
  BASIS_CANONICAL_PRESETS,
  AXIOM_DELTAS,
  CREATION_MODIFIERS,
  ROLE_DEFINITIONS,
  TRUST_TIERS,
  T3_BASELINE,
  FACTOR_CODES,
  createAxiomPreset,
  bootstrapAgentTrustConfigs,
} from '../src/trust/presets.js';

describe('FACTOR_CODES', () => {
  it('has exactly 16 factors', () => {
    expect(FACTOR_CODES).toHaveLength(16);
  });

  it('includes all CT- codes', () => {
    const ctCodes = FACTOR_CODES.filter(c => c.startsWith('CT-'));
    expect(ctCodes).toHaveLength(9);
  });

  it('includes all OP- codes', () => {
    const opCodes = FACTOR_CODES.filter(c => c.startsWith('OP-'));
    expect(opCodes).toHaveLength(4);
  });

  it('includes all SF- codes', () => {
    const sfCodes = FACTOR_CODES.filter(c => c.startsWith('SF-'));
    expect(sfCodes).toHaveLength(3);
  });
});

describe('BASIS_CANONICAL_PRESETS', () => {
  it('has 5 preset configurations', () => {
    expect(Object.keys(BASIS_CANONICAL_PRESETS)).toHaveLength(5);
  });

  it('includes expected presets', () => {
    expect(BASIS_CANONICAL_PRESETS.default).toBeDefined();
    expect(BASIS_CANONICAL_PRESETS.high_confidence).toBeDefined();
    expect(BASIS_CANONICAL_PRESETS.governance_focus).toBeDefined();
    expect(BASIS_CANONICAL_PRESETS.capability_focus).toBeDefined();
    expect(BASIS_CANONICAL_PRESETS.context_sensitive).toBeDefined();
  });

  it('all presets have weights summing to approximately 1.0', () => {
    for (const [name, preset] of Object.entries(BASIS_CANONICAL_PRESETS)) {
      const sum = Object.values(preset).reduce((acc, v) => acc + v, 0);
      expect(sum).toBeCloseTo(1.0, 1);
    }
  });

  it('default preset has equal weights', () => {
    const preset = BASIS_CANONICAL_PRESETS.default;
    const values = Object.values(preset);
    const first = values[0];
    for (const v of values) {
      expect(v).toBeCloseTo(first, 5);
    }
  });

  it('all presets have 16 factor weights', () => {
    for (const preset of Object.values(BASIS_CANONICAL_PRESETS)) {
      expect(Object.keys(preset)).toHaveLength(16);
    }
  });
});

describe('AXIOM_DELTAS', () => {
  it('has expected override configs', () => {
    expect(AXIOM_DELTAS.sentinel_override).toBeDefined();
    expect(AXIOM_DELTAS.builder_override).toBeDefined();
    expect(AXIOM_DELTAS.architect_override).toBeDefined();
  });

  it('overrides are partial weight configs', () => {
    for (const delta of Object.values(AXIOM_DELTAS)) {
      expect(Object.keys(delta).length).toBeGreaterThan(0);
      expect(Object.keys(delta).length).toBeLessThan(16);
      for (const v of Object.values(delta)) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('createAxiomPreset', () => {
  it('returns canonical preset when no delta', () => {
    const result = createAxiomPreset('default');
    expect(result).toEqual(BASIS_CANONICAL_PRESETS.default);
  });

  it('merges delta into canonical', () => {
    const result = createAxiomPreset('governance_focus', 'sentinel_override');
    // CT-OBS should be from sentinel_override (0.12), not governance_focus (0.09)
    expect(result['CT-OBS']).toBe(0.12);
    expect(result['CT-SEC']).toBe(0.10);
    // Other weights should remain from governance_focus
    expect(result['CT-TRANS']).toBe(0.08);
  });

  it('does not mutate original canonical preset', () => {
    const original = { ...BASIS_CANONICAL_PRESETS.default };
    createAxiomPreset('default', 'sentinel_override');
    expect(BASIS_CANONICAL_PRESETS.default).toEqual(original);
  });
});

describe('CREATION_MODIFIERS', () => {
  it('has all creation types', () => {
    expect(CREATION_MODIFIERS.fresh).toBe(0);
    expect(CREATION_MODIFIERS.cloned).toBe(-50);
    expect(CREATION_MODIFIERS.evolved).toBe(25);
    expect(CREATION_MODIFIERS.promoted).toBe(50);
    expect(CREATION_MODIFIERS.imported).toBe(-100);
  });

  it('fresh is baseline (0)', () => {
    expect(CREATION_MODIFIERS.fresh).toBe(0);
  });

  it('imported has most caution (most negative)', () => {
    const values = Object.values(CREATION_MODIFIERS);
    expect(CREATION_MODIFIERS.imported).toBe(Math.min(...values));
  });

  it('promoted has most trust (most positive)', () => {
    const values = Object.values(CREATION_MODIFIERS);
    expect(CREATION_MODIFIERS.promoted).toBe(Math.max(...values));
  });
});

describe('ROLE_DEFINITIONS', () => {
  it('has 5 role levels (R-L1 through R-L5)', () => {
    expect(ROLE_DEFINITIONS['R-L1']).toBeDefined();
    expect(ROLE_DEFINITIONS['R-L2']).toBeDefined();
    expect(ROLE_DEFINITIONS['R-L3']).toBeDefined();
    expect(ROLE_DEFINITIONS['R-L4']).toBeDefined();
    expect(ROLE_DEFINITIONS['R-L5']).toBeDefined();
  });

  it('each role has required fields', () => {
    for (const role of Object.values(ROLE_DEFINITIONS)) {
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.allowedTiers.length).toBeGreaterThan(0);
      expect(role.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('higher roles have fewer allowed tiers', () => {
    expect(ROLE_DEFINITIONS['R-L1'].allowedTiers.length).toBeGreaterThanOrEqual(
      ROLE_DEFINITIONS['R-L5'].allowedTiers.length
    );
  });

  it('all roles include read capability', () => {
    for (const role of Object.values(ROLE_DEFINITIONS)) {
      expect(role.capabilities).toContain('read');
    }
  });
});

describe('TRUST_TIERS', () => {
  it('has 8 tiers (T0-T7)', () => {
    expect(Object.keys(TRUST_TIERS)).toHaveLength(8);
  });

  it('tier ranges are contiguous', () => {
    const tierKeys = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;
    for (let i = 0; i < tierKeys.length - 1; i++) {
      const current = TRUST_TIERS[tierKeys[i]];
      const next = TRUST_TIERS[tierKeys[i + 1]];
      expect(next.min).toBe(current.max + 1);
    }
  });

  it('T0 starts at 0', () => {
    expect(TRUST_TIERS.T0.min).toBe(0);
  });

  it('T7 ends at 1000', () => {
    expect(TRUST_TIERS.T7.max).toBe(1000);
  });
});

describe('T3_BASELINE', () => {
  it('is 500', () => {
    expect(T3_BASELINE).toBe(500);
  });

  it('falls within T3 range', () => {
    expect(T3_BASELINE).toBeGreaterThanOrEqual(TRUST_TIERS.T3.min);
    expect(T3_BASELINE).toBeLessThanOrEqual(TRUST_TIERS.T3.max);
  });
});

describe('bootstrapAgentTrustConfigs', () => {
  it('has all bootstrap agents', () => {
    expect(bootstrapAgentTrustConfigs.architect).toBeDefined();
    expect(bootstrapAgentTrustConfigs.scribe).toBeDefined();
    expect(bootstrapAgentTrustConfigs.sentinel).toBeDefined();
    expect(bootstrapAgentTrustConfigs.builder).toBeDefined();
    expect(bootstrapAgentTrustConfigs.tester).toBeDefined();
  });

  it('all configs have required fields', () => {
    for (const config of Object.values(bootstrapAgentTrustConfigs)) {
      expect(config.agentId).toBeTruthy();
      expect(config.creation.type).toBeTruthy();
      expect(typeof config.initialScore).toBe('number');
      expect(config.targetTier).toBeTruthy();
      expect(config.context).toBe('enterprise');
      expect(config.roleGates.role).toBeTruthy();
      expect(Object.keys(config.weights).length).toBe(16);
      expect(Object.keys(config.capabilities).length).toBeGreaterThan(0);
    }
  });

  it('sentinel requires T4 (higher trust)', () => {
    expect(bootstrapAgentTrustConfigs.sentinel.targetTier).toBe('T4');
    expect(bootstrapAgentTrustConfigs.sentinel.roleGates.allowedTiers).toEqual(['T4', 'T5']);
  });

  it('cloned agents have correct initial score', () => {
    const expectedBase = T3_BASELINE + CREATION_MODIFIERS.cloned; // 500 + (-50) = 450
    expect(bootstrapAgentTrustConfigs.architect.initialScore).toBe(expectedBase);
    expect(bootstrapAgentTrustConfigs.builder.initialScore).toBe(expectedBase);
  });
});
