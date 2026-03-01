import { describe, it, expect } from 'vitest';
import {
  BMAD_DELTAS,
  createBmadPreset,
  bmadAgentTrustConfigs,
} from '../src/trust/bmad-presets.js';
import { BASIS_CANONICAL_PRESETS, FACTOR_CODES, T3_BASELINE } from '../src/trust/presets.js';

describe('BMAD_DELTAS', () => {
  it('has expected override configs', () => {
    expect(BMAD_DELTAS.orchestrator_override).toBeDefined();
    expect(BMAD_DELTAS.builder_override).toBeDefined();
    expect(BMAD_DELTAS.advisor_override).toBeDefined();
    expect(BMAD_DELTAS.executor_override).toBeDefined();
    expect(BMAD_DELTAS.chronicler_override).toBeDefined();
    expect(BMAD_DELTAS.validator_override).toBeDefined();
  });

  it('overrides use valid factor codes', () => {
    for (const delta of Object.values(BMAD_DELTAS)) {
      for (const key of Object.keys(delta)) {
        expect(FACTOR_CODES).toContain(key);
      }
    }
  });

  it('all delta values are positive numbers', () => {
    for (const delta of Object.values(BMAD_DELTAS)) {
      for (const v of Object.values(delta)) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});

describe('createBmadPreset', () => {
  it('returns canonical when no delta', () => {
    const result = createBmadPreset('default');
    expect(result).toEqual(BASIS_CANONICAL_PRESETS.default);
  });

  it('merges delta into canonical', () => {
    const result = createBmadPreset('governance_focus', 'orchestrator_override');
    expect(result['CT-OBS']).toBe(0.12);
    expect(result['OP-HUMAN']).toBe(0.08);
  });

  it('does not mutate original', () => {
    const original = { ...BASIS_CANONICAL_PRESETS.default };
    createBmadPreset('default', 'orchestrator_override');
    expect(BASIS_CANONICAL_PRESETS.default).toEqual(original);
  });
});

describe('bmadAgentTrustConfigs', () => {
  it('has all expected agents', () => {
    const expectedAgents = [
      'bmad-master', 'agent-builder', 'module-builder', 'workflow-builder',
      'analyst', 'bmm-architect', 'dev', 'pm', 'sm', 'tea',
      'tech-writer', 'ux-designer', 'quick-flow-solo-dev',
      'brainstorming-coach', 'creative-problem-solver',
      'design-thinking-coach', 'innovation-strategist',
      'presentation-master', 'storyteller',
    ];
    for (const name of expectedAgents) {
      expect(bmadAgentTrustConfigs[name]).toBeDefined();
    }
    expect(Object.keys(bmadAgentTrustConfigs)).toHaveLength(expectedAgents.length);
  });

  it('all configs have required fields', () => {
    for (const config of Object.values(bmadAgentTrustConfigs)) {
      expect(config.agentId).toMatch(/^bmad\./);
      expect(config.creation.type).toBeTruthy();
      expect(typeof config.initialScore).toBe('number');
      expect(config.initialScore).toBeGreaterThanOrEqual(0);
      expect(config.initialScore).toBeLessThanOrEqual(1000);
      expect(config.targetTier).toMatch(/^T\d$/);
      expect(config.context).toBe('enterprise');
      expect(Object.keys(config.weights).length).toBe(16);
      expect(Object.keys(config.capabilities).length).toBeGreaterThan(0);
    }
  });

  it('bmad-master has elevated initial score', () => {
    expect(bmadAgentTrustConfigs['bmad-master'].initialScore).toBe(T3_BASELINE + 200);
    expect(bmadAgentTrustConfigs['bmad-master'].targetTier).toBe('T4');
  });

  it('low-risk agents have lower initial scores', () => {
    expect(bmadAgentTrustConfigs['tech-writer'].initialScore).toBe(T3_BASELINE - 200);
    expect(bmadAgentTrustConfigs['brainstorming-coach'].initialScore).toBe(T3_BASELINE - 200);
    expect(bmadAgentTrustConfigs.storyteller.initialScore).toBe(T3_BASELINE - 200);
  });

  it('all fresh agents have zero creation modifier', () => {
    for (const config of Object.values(bmadAgentTrustConfigs)) {
      expect(config.creation.modifier).toBe(0);
    }
  });

  it('capabilities have valid minTier values', () => {
    for (const config of Object.values(bmadAgentTrustConfigs)) {
      for (const cap of Object.values(config.capabilities)) {
        expect(cap.minTier).toMatch(/^T\d$/);
        if (cap.rateLimit !== undefined) {
          expect(cap.rateLimit).toBeGreaterThan(0);
        }
      }
    }
  });
});
