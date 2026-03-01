/**
 * @fileoverview Trust Configuration Presets for Vorion Native Agents
 * @module vorion/cognigate/trust-presets
 *
 * This configuration defines trust scoring presets used when bootstrap
 * agents graduate to Vorion-Native mode. Based on ACI spec canonical
 * presets with Axiom-specific deltas (per Q4 decision).
 *
 * 16-Factor Trust Model:
 *   Core Trust (CT-*):   OBS, COMP, ACCT, TRANS, PRIV, ID, REL, SAFE, SEC
 *   Operational (OP-*):  CONTEXT, ALIGN, HUMAN, STEW
 *   Safety (SF-*):       HUM, ADAPT, LEARN
 */

// =============================================================================
// FACTOR WEIGHT CONFIGURATION (16-factor model)
// =============================================================================

/**
 * Factor weight configuration using 16 factor codes.
 * Keys are factor codes (e.g. 'CT-OBS', 'OP-CONTEXT').
 * Values are numeric weights that should sum to 1.0.
 */
export type FactorWeightConfig = Record<string, number>;

/** @deprecated Use FactorWeightConfig */
export type WeightConfig = FactorWeightConfig;

// =============================================================================
// TRUST TYPES
// =============================================================================

export interface RoleGate {
  name: string;
  description: string;
  allowedTiers: string[];
  capabilities: string[];
}

export interface CapabilityGate {
  minTier: string;
  rateLimit?: number;
}

export type CreationType = 'fresh' | 'cloned' | 'evolved' | 'promoted' | 'imported';

export interface TrustConfig {
  agentId: string;
  creation: {
    type: CreationType | string;
    parentId?: string;
    modifier: number;
  };
  initialScore: number;
  targetTier: string;
  context: string;
  roleGates: {
    role: string;
    allowedTiers: string[];
  };
  weights: FactorWeightConfig;
  capabilities: Record<string, CapabilityGate>;
}

export interface TrustPreset {
  name: string;
  weights: FactorWeightConfig;
}

/**
 * All 16 trust factor codes used in the system (from @vorionsys/basis).
 */
import { FACTOR_CODE_LIST, type FactorCodeString } from '@vorionsys/basis';

export const FACTOR_CODES = FACTOR_CODE_LIST;

export type FactorCode = FactorCodeString;

// =============================================================================
// CAR CANONICAL PRESETS (from @vorionsys/car-spec)
// =============================================================================

/**
 * Canonical weight presets from BASIS standard.
 * These are immutable reference values - do not modify.
 *
 * Migrated from 4-dimension model to 16-factor model.
 * All weights sum to 1.0.
 */
export const BASIS_CANONICAL_PRESETS: Record<string, FactorWeightConfig> = {
  /**
   * Default balanced preset
   * Use for general-purpose agents with no specific bias
   * Each of 16 factors gets equal weight: 1/16 = 0.0625
   */
  default: {
    'CT-OBS':     0.0625,
    'CT-COMP':    0.0625,
    'CT-ACCT':    0.0625,
    'CT-TRANS':   0.0625,
    'CT-PRIV':    0.0625,
    'CT-ID':      0.0625,
    'CT-REL':     0.0625,
    'CT-SAFE':    0.0625,
    'CT-SEC':     0.0625,
    'OP-CONTEXT': 0.0625,
    'OP-ALIGN':   0.0625,
    'OP-HUMAN':   0.0625,
    'OP-STEW':    0.0625,
    'SF-HUM':     0.0625,
    'SF-ADAPT':   0.0625,
    'SF-LEARN':   0.0625,
  },

  /**
   * High confidence preset
   * Use for agents that need to build trust quickly through observable behavior.
   * Emphasizes observability (CT-OBS), accountability (CT-ACCT),
   * reliability (CT-REL), and safety (CT-SAFE).
   *
   * Old mapping: observability=0.30, capability=0.25, behavior=0.30, context=0.15
   */
  high_confidence: {
    'CT-OBS':     0.10,
    'CT-COMP':    0.08,
    'CT-ACCT':    0.10,
    'CT-TRANS':   0.06,
    'CT-PRIV':    0.04,
    'CT-ID':      0.05,
    'CT-REL':     0.09,
    'CT-SAFE':    0.08,
    'CT-SEC':     0.05,
    'OP-CONTEXT': 0.06,
    'OP-ALIGN':   0.07,
    'OP-HUMAN':   0.06,
    'OP-STEW':    0.04,
    'SF-HUM':     0.04,
    'SF-ADAPT':   0.04,
    'SF-LEARN':   0.04,
  },

  /**
   * Governance focus preset
   * Use for agents in regulatory or compliance-heavy environments.
   * Emphasizes accountability (CT-ACCT), transparency (CT-TRANS),
   * security (CT-SEC), and alignment (OP-ALIGN).
   *
   * Old mapping: observability=0.30, capability=0.20, behavior=0.35, context=0.15
   */
  governance_focus: {
    'CT-OBS':     0.09,
    'CT-COMP':    0.05,
    'CT-ACCT':    0.10,
    'CT-TRANS':   0.08,
    'CT-PRIV':    0.06,
    'CT-ID':      0.06,
    'CT-REL':     0.05,
    'CT-SAFE':    0.08,
    'CT-SEC':     0.08,
    'OP-CONTEXT': 0.05,
    'OP-ALIGN':   0.09,
    'OP-HUMAN':   0.06,
    'OP-STEW':    0.04,
    'SF-HUM':     0.04,
    'SF-ADAPT':   0.04,
    'SF-LEARN':   0.03,
  },

  /**
   * Capability focus preset
   * Use for specialized agents where skill demonstration is primary.
   * Emphasizes competence (CT-COMP), reliability (CT-REL),
   * observability (CT-OBS), and learning (SF-LEARN).
   *
   * Old mapping: observability=0.20, capability=0.40, behavior=0.25, context=0.15
   */
  capability_focus: {
    'CT-OBS':     0.07,
    'CT-COMP':    0.12,
    'CT-ACCT':    0.06,
    'CT-TRANS':   0.05,
    'CT-PRIV':    0.04,
    'CT-ID':      0.04,
    'CT-REL':     0.10,
    'CT-SAFE':    0.06,
    'CT-SEC':     0.04,
    'OP-CONTEXT': 0.06,
    'OP-ALIGN':   0.06,
    'OP-HUMAN':   0.06,
    'OP-STEW':    0.05,
    'SF-HUM':     0.04,
    'SF-ADAPT':   0.06,
    'SF-LEARN':   0.09,
  },

  /**
   * Context-sensitive preset
   * Use for agents operating across multiple deployment contexts.
   * Emphasizes context (OP-CONTEXT), alignment (OP-ALIGN),
   * adaptability (SF-ADAPT), and human coordination (OP-HUMAN).
   *
   * Old mapping: observability=0.20, capability=0.20, behavior=0.25, context=0.35
   */
  context_sensitive: {
    'CT-OBS':     0.06,
    'CT-COMP':    0.06,
    'CT-ACCT':    0.06,
    'CT-TRANS':   0.05,
    'CT-PRIV':    0.05,
    'CT-ID':      0.04,
    'CT-REL':     0.06,
    'CT-SAFE':    0.05,
    'CT-SEC':     0.04,
    'OP-CONTEXT': 0.12,
    'OP-ALIGN':   0.09,
    'OP-HUMAN':   0.08,
    'OP-STEW':    0.05,
    'SF-HUM':     0.05,
    'SF-ADAPT':   0.09,
    'SF-LEARN':   0.05,
  },
};

// =============================================================================
// AXIOM DELTAS (Vorion-specific customizations)
// =============================================================================

/**
 * Axiom-specific deltas applied to canonical presets.
 * These override specific factor weights while maintaining BASIS compatibility.
 * Factor codes replace the old dimension names.
 */
export const AXIOM_DELTAS: Record<string, Partial<FactorWeightConfig>> = {
  /**
   * Sentinel agents need higher observability + security for security decisions
   * Old: observability: 0.35 → mapped to CT-OBS + CT-SEC boost
   */
  sentinel_override: {
    'CT-OBS': 0.12,  // +0.03 from governance_focus
    'CT-SEC': 0.10,  // +0.02 from governance_focus
  },

  /**
   * Builder agents need proven competence + reliability
   * Old: capability: 0.30 → mapped to CT-COMP + CT-REL boost
   */
  builder_override: {
    'CT-COMP': 0.10, // +0.02 from high_confidence
    'CT-REL':  0.11, // +0.02 from high_confidence
  },

  /**
   * Architect agents need accountability + alignment for decision quality
   * Old: behavior: 0.35 → mapped to CT-ACCT + OP-ALIGN boost
   */
  architect_override: {
    'CT-ACCT':  0.12, // +0.02 from governance_focus
    'OP-ALIGN': 0.11, // +0.02 from governance_focus
  },
};

/**
 * Merge canonical preset with Axiom delta
 */
export function createAxiomPreset(
  canonicalName: keyof typeof BASIS_CANONICAL_PRESETS,
  deltaName?: keyof typeof AXIOM_DELTAS
): FactorWeightConfig {
  const canonical = BASIS_CANONICAL_PRESETS[canonicalName];
  if (!deltaName) return { ...canonical };

  const delta = AXIOM_DELTAS[deltaName];
  const merged = { ...canonical };
  for (const [k, v] of Object.entries(delta)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

// =============================================================================
// CREATION TYPE MODIFIERS (per Q5 decision - Instantiation Time)
// =============================================================================

/**
 * Trust score modifiers applied at agent instantiation based on creation type.
 * These are immutable facts about agent origin.
 */
export const CREATION_MODIFIERS: Record<CreationType, number> = {
  fresh: 0,       // New agent, baseline trust
  cloned: -50,    // Inherited from parent, slight risk
  evolved: 25,    // Improved from parent, slight bonus
  promoted: 50,   // Explicitly elevated by governance
  imported: -100, // External, unvetted, maximum caution
};

// =============================================================================
// ROLE GATES (per Q3 decision - Dual Layer enforcement)
// =============================================================================

/**
 * Role definitions for bootstrap agents.
 * R-L levels indicate increasing authority/access.
 */
export const ROLE_DEFINITIONS: Record<string, RoleGate> = {
  'R-L1': {
    name: 'Observer',
    description: 'Read-only access, no modifications',
    allowedTiers: ['T1', 'T2', 'T3', 'T4', 'T5'],
    capabilities: ['read'],
  },
  'R-L2': {
    name: 'Chronicler',
    description: 'Documentation and logging',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
    capabilities: ['read', 'write:docs', 'write:logs'],
  },
  'R-L3': {
    name: 'Contributor',
    description: 'Code and artifact creation',
    allowedTiers: ['T3', 'T4', 'T5'],
    capabilities: ['read', 'write:code', 'write:tests', 'execute:local'],
  },
  'R-L4': {
    name: 'Validator',
    description: 'Review and approval authority',
    allowedTiers: ['T4', 'T5'],
    capabilities: ['read', 'review', 'approve', 'block'],
  },
  'R-L5': {
    name: 'Operator',
    description: 'Deployment and infrastructure',
    allowedTiers: ['T5'],
    capabilities: ['read', 'deploy', 'configure', 'execute:production'],
  },
};

// =============================================================================
// TRUST TIER DEFINITIONS
// =============================================================================

/**
 * Trust tier boundaries and descriptions.
 * Based on Q1 decision - scores clamped to [0, 1000] at kernel level.
 */
export const TRUST_TIERS = {
  T0: { min: 0, max: 199, name: 'Sandbox', description: 'Isolated testing' },
  T1: { min: 200, max: 349, name: 'Observed', description: 'Read-only, monitored' },
  T2: { min: 350, max: 499, name: 'Provisional', description: 'Basic operations, heavy supervision' },
  T3: { min: 500, max: 649, name: 'Monitored', description: 'Standard operations, continuous monitoring' },
  T4: { min: 650, max: 799, name: 'Standard', description: 'External API access, policy-governed' },
  T5: { min: 800, max: 875, name: 'Trusted', description: 'Cross-agent communication' },
  T6: { min: 876, max: 950, name: 'Certified', description: 'Admin tasks, minimal oversight' },
  T7: { min: 951, max: 1000, name: 'Autonomous', description: 'Full autonomy, self-governance' },
} as const;

/**
 * Baseline trust score for new agents (T3 midpoint)
 */
export const T3_BASELINE = 500;

// =============================================================================
// BOOTSTRAP AGENT TRUST CONFIGURATIONS
// =============================================================================

/**
 * Trust configuration for Architect agent when graduated to Native mode
 */
export const architectTrustConfig: TrustConfig = {
  agentId: 'vorion.native.architect',

  creation: {
    type: 'cloned',
    parentId: 'vorion.bootstrap.architect',
    modifier: CREATION_MODIFIERS.cloned,
  },

  initialScore: T3_BASELINE + CREATION_MODIFIERS.cloned, // 450
  targetTier: 'T3',

  context: 'enterprise', // Immutable per Q2

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createAxiomPreset('governance_focus', 'architect_override'),

  capabilities: {
    'architecture.review': { minTier: 'T3', rateLimit: 100 },
    'architecture.propose': { minTier: 'T3', rateLimit: 50 },
    'architecture.approve': { minTier: 'T4', rateLimit: 20 },
  },
};

/**
 * Trust configuration for Scribe agent when graduated to Native mode
 */
export const scribeTrustConfig: TrustConfig = {
  agentId: 'vorion.native.scribe',

  creation: {
    type: 'cloned',
    parentId: 'vorion.bootstrap.scribe',
    modifier: CREATION_MODIFIERS.cloned,
  },

  initialScore: T3_BASELINE + CREATION_MODIFIERS.cloned, // 450
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createAxiomPreset('high_confidence'),

  capabilities: {
    'docs.create': { minTier: 'T2', rateLimit: 200 },
    'docs.update': { minTier: 'T2', rateLimit: 500 },
    'changelog.update': { minTier: 'T3', rateLimit: 50 },
    'spec.create': { minTier: 'T3', rateLimit: 30 },
  },
};

/**
 * Trust configuration for Sentinel agent when graduated to Native mode
 * NOTE: Sentinel requires T4 to operate (elevated trust requirement)
 */
export const sentinelTrustConfig: TrustConfig = {
  agentId: 'vorion.native.sentinel',

  creation: {
    type: 'cloned',
    parentId: 'vorion.bootstrap.sentinel',
    modifier: CREATION_MODIFIERS.cloned,
  },

  initialScore: T3_BASELINE + CREATION_MODIFIERS.cloned, // 450
  targetTier: 'T4', // Must earn T4 before full operation

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'], // Strict requirement
  },

  weights: createAxiomPreset('governance_focus', 'sentinel_override'),

  capabilities: {
    'review.read': { minTier: 'T3', rateLimit: 500 },
    'review.comment': { minTier: 'T3', rateLimit: 200 },
    'review.approve': { minTier: 'T4', rateLimit: 50 },
    'review.block': { minTier: 'T4', rateLimit: 20 },
    'security.scan': { minTier: 'T4', rateLimit: 100 },
    'security.alert': { minTier: 'T4', rateLimit: 10 },
  },
};

/**
 * Trust configuration for Builder agent when graduated to Native mode
 */
export const builderTrustConfig: TrustConfig = {
  agentId: 'vorion.native.builder',

  creation: {
    type: 'cloned',
    parentId: 'vorion.bootstrap.builder',
    modifier: CREATION_MODIFIERS.cloned,
  },

  initialScore: T3_BASELINE + CREATION_MODIFIERS.cloned, // 450
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createAxiomPreset('high_confidence', 'builder_override'),

  capabilities: {
    'code.read': { minTier: 'T2', rateLimit: 1000 },
    'code.write': { minTier: 'T3', rateLimit: 500 },
    'code.test': { minTier: 'T2', rateLimit: 500 },
    'git.branch': { minTier: 'T3', rateLimit: 50 },
    'git.commit': { minTier: 'T3', rateLimit: 200 },
    'git.push': { minTier: 'T3', rateLimit: 50 },
    'pr.create': { minTier: 'T3', rateLimit: 20 },
  },
};

/**
 * Trust configuration for Tester agent when graduated to Native mode
 */
export const testerTrustConfig: TrustConfig = {
  agentId: 'vorion.native.tester',

  creation: {
    type: 'cloned',
    parentId: 'vorion.bootstrap.tester',
    modifier: CREATION_MODIFIERS.cloned,
  },

  initialScore: T3_BASELINE + CREATION_MODIFIERS.cloned, // 450
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createAxiomPreset('high_confidence'),

  capabilities: {
    'test.read': { minTier: 'T2', rateLimit: 1000 },
    'test.write': { minTier: 'T3', rateLimit: 500 },
    'test.execute': { minTier: 'T2', rateLimit: 200 },
    'coverage.report': { minTier: 'T2', rateLimit: 100 },
  },
};

// =============================================================================
// EXPORT ALL CONFIGURATIONS
// =============================================================================

export const bootstrapAgentTrustConfigs = {
  architect: architectTrustConfig,
  scribe: scribeTrustConfig,
  sentinel: sentinelTrustConfig,
  builder: builderTrustConfig,
  tester: testerTrustConfig,
};

export default bootstrapAgentTrustConfigs;
