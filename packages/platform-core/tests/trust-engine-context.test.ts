import { describe, it, expect } from 'vitest';
import {
  DeploymentContext,
  CONTEXT_CEILINGS,
  CONTEXT_NAMES,
  getContextCeiling,
  getContextMaxScore,
  applyContextCeiling,
  requiresHumanApproval,
  requiresAttestation,
  evaluateContextPolicy,
  describeContextConstraints,
  detectDeploymentContext,
  DeploymentContextSchema,
  ContextConfigSchema,
} from '../src/trust-engine/context.js';

describe('DeploymentContext enum', () => {
  it('defines all five deployment contexts', () => {
    expect(DeploymentContext.C_LOCAL).toBe('local');
    expect(DeploymentContext.C_TEAM).toBe('team');
    expect(DeploymentContext.C_ENTERPRISE).toBe('enterprise');
    expect(DeploymentContext.C_REGULATED).toBe('regulated');
    expect(DeploymentContext.C_SOVEREIGN).toBe('sovereign');
  });
});

describe('getContextCeiling', () => {
  it('returns T7 for local context', () => {
    expect(getContextCeiling(DeploymentContext.C_LOCAL)).toBe(7);
  });

  it('returns T6 for team context', () => {
    expect(getContextCeiling(DeploymentContext.C_TEAM)).toBe(6);
  });

  it('returns T5 for enterprise context', () => {
    expect(getContextCeiling(DeploymentContext.C_ENTERPRISE)).toBe(5);
  });

  it('returns T4 for regulated context', () => {
    expect(getContextCeiling(DeploymentContext.C_REGULATED)).toBe(4);
  });

  it('returns T6 for sovereign context (with attestation)', () => {
    expect(getContextCeiling(DeploymentContext.C_SOVEREIGN)).toBe(6);
  });
});

describe('getContextMaxScore', () => {
  it('returns 1000 for local', () => {
    expect(getContextMaxScore(DeploymentContext.C_LOCAL)).toBe(1000);
  });

  it('returns 950 for team', () => {
    expect(getContextMaxScore(DeploymentContext.C_TEAM)).toBe(950);
  });

  it('returns 875 for enterprise', () => {
    expect(getContextMaxScore(DeploymentContext.C_ENTERPRISE)).toBe(875);
  });

  it('returns 799 for regulated', () => {
    expect(getContextMaxScore(DeploymentContext.C_REGULATED)).toBe(799);
  });

  it('returns 950 for sovereign', () => {
    expect(getContextMaxScore(DeploymentContext.C_SOVEREIGN)).toBe(950);
  });
});

describe('applyContextCeiling', () => {
  it('does not cap scores below ceiling', () => {
    const result = applyContextCeiling(500 as any, DeploymentContext.C_ENTERPRISE);
    expect(result).toBe(500);
  });

  it('caps scores that exceed enterprise ceiling', () => {
    const result = applyContextCeiling(900 as any, DeploymentContext.C_ENTERPRISE);
    expect(result).toBe(875);
  });

  it('caps scores at regulated ceiling', () => {
    const result = applyContextCeiling(850 as any, DeploymentContext.C_REGULATED);
    expect(result).toBe(799);
  });

  it('does not cap scores in local context', () => {
    const result = applyContextCeiling(1000 as any, DeploymentContext.C_LOCAL);
    expect(result).toBe(1000);
  });
});

describe('requiresHumanApproval', () => {
  it('returns false for local context at any tier', () => {
    expect(requiresHumanApproval(DeploymentContext.C_LOCAL, 7)).toBe(false);
  });

  it('returns false for team context', () => {
    expect(requiresHumanApproval(DeploymentContext.C_TEAM, 6)).toBe(false);
  });

  it('returns false for enterprise context', () => {
    expect(requiresHumanApproval(DeploymentContext.C_ENTERPRISE, 5)).toBe(false);
  });

  it('returns true for regulated context above T4', () => {
    expect(requiresHumanApproval(DeploymentContext.C_REGULATED, 5)).toBe(true);
    expect(requiresHumanApproval(DeploymentContext.C_REGULATED, 6)).toBe(true);
  });

  it('returns false for regulated context at or below T4', () => {
    expect(requiresHumanApproval(DeploymentContext.C_REGULATED, 4)).toBe(false);
    expect(requiresHumanApproval(DeploymentContext.C_REGULATED, 3)).toBe(false);
  });

  it('returns false for sovereign context (uses attestation, not human)', () => {
    expect(requiresHumanApproval(DeploymentContext.C_SOVEREIGN, 6)).toBe(false);
  });
});

describe('requiresAttestation', () => {
  it('returns true only for sovereign context', () => {
    expect(requiresAttestation(DeploymentContext.C_SOVEREIGN)).toBe(true);
    expect(requiresAttestation(DeploymentContext.C_LOCAL)).toBe(false);
    expect(requiresAttestation(DeploymentContext.C_TEAM)).toBe(false);
    expect(requiresAttestation(DeploymentContext.C_ENTERPRISE)).toBe(false);
    expect(requiresAttestation(DeploymentContext.C_REGULATED)).toBe(false);
  });
});

describe('evaluateContextPolicy', () => {
  it('allows actions within local context without restrictions', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_LOCAL, 7);
    expect(result.allowed).toBe(true);
    expect(result.maxTier).toBe(7);
    expect(result.humanApprovalRequired).toBe(false);
    expect(result.attestationRequired).toBe(false);
  });

  it('denies T6 in enterprise context (max is T5)', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_ENTERPRISE, 6);
    expect(result.allowed).toBe(false);
    expect(result.maxTier).toBe(5);
  });

  it('limits sovereign context without attestation to T2', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_SOVEREIGN, 5, false, false);
    expect(result.allowed).toBe(false);
    expect(result.maxTier).toBe(2);
    expect(result.attestationRequired).toBe(true);
    expect(result.reason).toContain('Attestation required');
  });

  it('allows sovereign context up to T6 with attestation', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_SOVEREIGN, 6, false, true);
    expect(result.allowed).toBe(true);
    expect(result.maxTier).toBe(6);
    expect(result.attestationRequired).toBe(false);
  });

  it('limits regulated context above T4 without human approval', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_REGULATED, 5, false);
    expect(result.allowed).toBe(false);
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.reason).toContain('Human approval required');
  });

  it('allows regulated context above T4 with human approval', () => {
    const result = evaluateContextPolicy(DeploymentContext.C_REGULATED, 4, true);
    expect(result.allowed).toBe(true);
  });
});

describe('describeContextConstraints', () => {
  it('includes context name and max tier', () => {
    const desc = describeContextConstraints(DeploymentContext.C_ENTERPRISE);
    expect(desc).toContain('Enterprise');
    expect(desc).toContain('T5');
  });

  it('includes human approval requirement for regulated', () => {
    const desc = describeContextConstraints(DeploymentContext.C_REGULATED);
    expect(desc).toContain('Human approval required');
    expect(desc).toContain('T4');
  });

  it('includes attestation requirement for sovereign', () => {
    const desc = describeContextConstraints(DeploymentContext.C_SOVEREIGN);
    expect(desc).toContain('attestation');
  });
});

describe('Zod schemas', () => {
  it('DeploymentContextSchema validates correct values', () => {
    expect(DeploymentContextSchema.safeParse('local').success).toBe(true);
    expect(DeploymentContextSchema.safeParse('team').success).toBe(true);
    expect(DeploymentContextSchema.safeParse('enterprise').success).toBe(true);
    expect(DeploymentContextSchema.safeParse('regulated').success).toBe(true);
    expect(DeploymentContextSchema.safeParse('sovereign').success).toBe(true);
  });

  it('DeploymentContextSchema rejects invalid values', () => {
    expect(DeploymentContextSchema.safeParse('invalid').success).toBe(false);
    expect(DeploymentContextSchema.safeParse(42).success).toBe(false);
  });

  it('ContextConfigSchema validates valid config', () => {
    const result = ContextConfigSchema.safeParse({
      context: 'local',
      customMaxTier: 5,
      customMaxScore: 800,
    });
    expect(result.success).toBe(true);
  });

  it('ContextConfigSchema rejects invalid tier values', () => {
    const result = ContextConfigSchema.safeParse({
      context: 'local',
      customMaxTier: 10,
    });
    expect(result.success).toBe(false);
  });
});
