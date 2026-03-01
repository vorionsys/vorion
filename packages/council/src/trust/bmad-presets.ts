/**
 * @fileoverview Trust Configuration Presets for BMAD Agents
 * @module @vorionsys/council/trust/bmad-presets
 *
 * Trust scoring presets for BMAD agents when integrated into the Vorion
 * trust system. Based on ACI spec canonical presets with BMAD-specific deltas.
 *
 * Migrated from 4-dimension model to 16-factor model.
 * Factor codes replace old dimension names throughout.
 */

import type { TrustConfig, FactorWeightConfig, CreationType } from './presets.js';
import { BASIS_CANONICAL_PRESETS, CREATION_MODIFIERS, T3_BASELINE } from './presets.js';

// =============================================================================
// BMAD-SPECIFIC WEIGHT DELTAS
// =============================================================================

/**
 * BMAD-specific deltas applied to canonical presets.
 * These customize factor weights for BMAD agent archetypes.
 *
 * Factor code mapping from old dimension names:
 *   observability -> CT-OBS    capability -> CT-COMP
 *   behavior      -> CT-ACCT   context    -> OP-CONTEXT
 */
export const BMAD_DELTAS: Record<string, Partial<FactorWeightConfig>> = {
  /**
   * Orchestrator agents (bmad-master) need high observability for coordination.
   * Old: observability=0.35, behavior=0.30
   * Mapped: CT-OBS boost, CT-ACCT boost, plus OP-HUMAN for coordination
   */
  orchestrator_override: {
    'CT-OBS':   0.12,
    'CT-ACCT':  0.09,
    'OP-HUMAN': 0.08,
    'SF-LEARN': 0.04,
  },

  /**
   * Builder agents need proven capability for agent/workflow creation.
   * Old: capability=0.35, behavior=0.25
   * Mapped: CT-COMP boost, CT-REL boost for dependable builds
   */
  builder_override: {
    'CT-COMP':  0.14,
    'CT-REL':   0.11,
    'CT-ACCT':  0.07,
    'SF-LEARN': 0.05,
  },

  /**
   * Advisor agents (analysts, strategists) need behavior history.
   * Old: behavior=0.30, context=0.25
   * Mapped: CT-ACCT boost, OP-CONTEXT boost, OP-ALIGN for strategic alignment
   */
  advisor_override: {
    'CT-ACCT':    0.09,
    'OP-CONTEXT': 0.09,
    'OP-ALIGN':   0.08,
    'SF-HUM':     0.06,
  },

  /**
   * Executor agents (dev, quick-flow) need capability focus.
   * Old: capability=0.35, observability=0.25
   * Mapped: CT-COMP boost, CT-OBS boost, CT-REL for reliable execution
   */
  executor_override: {
    'CT-COMP':  0.13,
    'CT-OBS':   0.09,
    'CT-REL':   0.10,
    'SF-ADAPT': 0.05,
  },

  /**
   * Chronicler agents (writers, storytellers) are lower risk.
   * Old: observability=0.20, capability=0.30
   * Mapped: CT-OBS moderate, CT-COMP boost, CT-TRANS for clear output
   */
  chronicler_override: {
    'CT-OBS':   0.07,
    'CT-COMP':  0.10,
    'CT-TRANS': 0.08,
    'CT-SAFE':  0.06,
  },

  /**
   * Validator agents (test architect) need high observability.
   * Old: observability=0.35, capability=0.30
   * Mapped: CT-OBS boost, CT-COMP boost, CT-SEC for validation rigor
   */
  validator_override: {
    'CT-OBS':  0.12,
    'CT-COMP': 0.10,
    'CT-SEC':  0.08,
    'CT-REL':  0.08,
  },
};

/**
 * Merge canonical preset with BMAD delta
 */
export function createBmadPreset(
  canonicalName: keyof typeof BASIS_CANONICAL_PRESETS,
  deltaName?: keyof typeof BMAD_DELTAS
): FactorWeightConfig {
  const canonical = BASIS_CANONICAL_PRESETS[canonicalName];
  if (!deltaName) return { ...canonical };

  const delta = BMAD_DELTAS[deltaName];
  const merged = { ...canonical };
  for (const [k, v] of Object.entries(delta)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

// =============================================================================
// BMAD CORE MODULE TRUST CONFIGS
// =============================================================================

export const bmadMasterTrustConfig: TrustConfig = {
  agentId: 'bmad.core.master',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE + 200, // 700 - starts at T4 for orchestration
  targetTier: 'T4',

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'],
  },

  weights: createBmadPreset('governance_focus', 'orchestrator_override'),

  capabilities: {
    'workflow.orchestrate': { minTier: 'T4', rateLimit: 100 },
    'knowledge.curate': { minTier: 'T3', rateLimit: 200 },
    'party.mode': { minTier: 'T3', rateLimit: 50 },
  },
};

// =============================================================================
// BMAD BMB MODULE TRUST CONFIGS
// =============================================================================

export const agentBuilderTrustConfig: TrustConfig = {
  agentId: 'bmad.bmb.agent-builder',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('capability_focus', 'builder_override'),

  capabilities: {
    'agent.create': { minTier: 'T3', rateLimit: 50 },
    'agent.edit': { minTier: 'T3', rateLimit: 100 },
    'compliance.validate': { minTier: 'T2', rateLimit: 200 },
  },
};

export const moduleBuilderTrustConfig: TrustConfig = {
  agentId: 'bmad.bmb.module-builder',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('capability_focus', 'builder_override'),

  capabilities: {
    'module.create': { minTier: 'T3', rateLimit: 30 },
    'module.edit': { minTier: 'T3', rateLimit: 50 },
    'brief.create': { minTier: 'T2', rateLimit: 100 },
  },
};

export const workflowBuilderTrustConfig: TrustConfig = {
  agentId: 'bmad.bmb.workflow-builder',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('capability_focus', 'builder_override'),

  capabilities: {
    'workflow.create': { minTier: 'T3', rateLimit: 50 },
    'workflow.validate': { minTier: 'T2', rateLimit: 200 },
    'process.optimize': { minTier: 'T3', rateLimit: 100 },
  },
};

// =============================================================================
// BMAD BMM MODULE TRUST CONFIGS
// =============================================================================

export const analystTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.analyst',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'advisor_override'),

  capabilities: {
    'research.conduct': { minTier: 'T2', rateLimit: 100 },
    'requirements.elicit': { minTier: 'T3', rateLimit: 50 },
    'brief.create': { minTier: 'T2', rateLimit: 100 },
  },
};

export const bmmArchitectTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.architect',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE + 200, // 700 - elevated for architecture decisions
  targetTier: 'T4',

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'],
  },

  weights: createBmadPreset('governance_focus', 'advisor_override'),

  capabilities: {
    'architecture.create': { minTier: 'T4', rateLimit: 50 },
    'architecture.review': { minTier: 'T3', rateLimit: 100 },
    'design.validate': { minTier: 'T3', rateLimit: 200 },
  },
};

export const devTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.dev',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'executor_override'),

  capabilities: {
    'code.write': { minTier: 'T3', rateLimit: 500 },
    'code.review': { minTier: 'T3', rateLimit: 200 },
    'test.maintain': { minTier: 'T2', rateLimit: 500 },
  },
};

export const pmTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.pm',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE + 200, // 700 - elevated for product decisions
  targetTier: 'T4',

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'],
  },

  weights: createBmadPreset('governance_focus', 'advisor_override'),

  capabilities: {
    'prd.create': { minTier: 'T4', rateLimit: 30 },
    'epics.create': { minTier: 'T3', rateLimit: 50 },
    'course.correct': { minTier: 'T4', rateLimit: 20 },
  },
};

export const smTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.sm',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'chronicler_override'),

  capabilities: {
    'sprint.plan': { minTier: 'T3', rateLimit: 50 },
    'story.create': { minTier: 'T2', rateLimit: 200 },
    'retro.facilitate': { minTier: 'T2', rateLimit: 50 },
  },
};

export const teaTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.tea',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE + 200, // 700 - elevated for test architecture
  targetTier: 'T4',

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'],
  },

  weights: createBmadPreset('governance_focus', 'validator_override'),

  capabilities: {
    'test.framework': { minTier: 'T4', rateLimit: 20 },
    'test.generate': { minTier: 'T3', rateLimit: 200 },
    'test.review': { minTier: 'T3', rateLimit: 100 },
    'ci.scaffold': { minTier: 'T4', rateLimit: 20 },
  },
};

export const techWriterTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.tech-writer',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE - 200, // 300 - lower risk documentation
  targetTier: 'T2',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'chronicler_override'),

  capabilities: {
    'docs.create': { minTier: 'T2', rateLimit: 500 },
    'docs.validate': { minTier: 'T2', rateLimit: 200 },
    'diagram.generate': { minTier: 'T2', rateLimit: 200 },
  },
};

export const uxDesignerTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.ux-designer',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'advisor_override'),

  capabilities: {
    'ux.design': { minTier: 'T3', rateLimit: 100 },
    'wireframe.create': { minTier: 'T2', rateLimit: 200 },
    'prototype.iterate': { minTier: 'T3', rateLimit: 100 },
  },
};

export const quickFlowSoloDevTrustConfig: TrustConfig = {
  agentId: 'bmad.bmm.quick-flow-solo-dev',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L3',
    allowedTiers: ['T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('capability_focus', 'executor_override'),

  capabilities: {
    'spec.create': { minTier: 'T3', rateLimit: 50 },
    'implement.solo': { minTier: 'T3', rateLimit: 100 },
    'code.review': { minTier: 'T3', rateLimit: 100 },
  },
};

// =============================================================================
// BMAD CIS MODULE TRUST CONFIGS
// =============================================================================

export const brainstormingCoachTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.brainstorming-coach',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE - 200, // 300 - low risk ideation
  targetTier: 'T2',

  context: 'enterprise',

  roleGates: {
    role: 'R-L1',
    allowedTiers: ['T1', 'T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('context_sensitive', 'advisor_override'),

  capabilities: {
    'brainstorm.facilitate': { minTier: 'T2', rateLimit: 100 },
    'ideas.capture': { minTier: 'T1', rateLimit: 500 },
  },
};

export const creativeProblemSolverTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.creative-problem-solver',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('high_confidence', 'advisor_override'),

  capabilities: {
    'problem.analyze': { minTier: 'T3', rateLimit: 100 },
    'solution.architect': { minTier: 'T3', rateLimit: 50 },
  },
};

export const designThinkingCoachTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.design-thinking-coach',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE, // 500
  targetTier: 'T3',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('context_sensitive', 'advisor_override'),

  capabilities: {
    'design.thinking': { minTier: 'T2', rateLimit: 100 },
    'empathy.map': { minTier: 'T2', rateLimit: 200 },
  },
};

export const innovationStrategistTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.innovation-strategist',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE + 200, // 700 - elevated for strategic decisions
  targetTier: 'T4',

  context: 'enterprise',

  roleGates: {
    role: 'R-L4',
    allowedTiers: ['T4', 'T5'],
  },

  weights: createBmadPreset('governance_focus', 'advisor_override'),

  capabilities: {
    'disruption.identify': { minTier: 'T4', rateLimit: 30 },
    'model.innovate': { minTier: 'T4', rateLimit: 20 },
  },
};

export const presentationMasterTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.presentation-master',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE - 200, // 300 - low risk content creation
  targetTier: 'T2',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('capability_focus', 'chronicler_override'),

  capabilities: {
    'presentation.create': { minTier: 'T2', rateLimit: 100 },
    'pitch.design': { minTier: 'T2', rateLimit: 50 },
    'visual.communicate': { minTier: 'T2', rateLimit: 200 },
  },
};

export const storytellerTrustConfig: TrustConfig = {
  agentId: 'bmad.cis.storyteller',

  creation: {
    type: 'fresh' as CreationType,
    modifier: CREATION_MODIFIERS.fresh,
  },

  initialScore: T3_BASELINE - 200, // 300 - low risk narrative
  targetTier: 'T2',

  context: 'enterprise',

  roleGates: {
    role: 'R-L2',
    allowedTiers: ['T2', 'T3', 'T4', 'T5'],
  },

  weights: createBmadPreset('context_sensitive', 'chronicler_override'),

  capabilities: {
    'narrative.craft': { minTier: 'T2', rateLimit: 100 },
    'story.structure': { minTier: 'T2', rateLimit: 200 },
  },
};

// =============================================================================
// EXPORT ALL BMAD TRUST CONFIGURATIONS
// =============================================================================

export const bmadAgentTrustConfigs = {
  // Core
  'bmad-master': bmadMasterTrustConfig,

  // BMB
  'agent-builder': agentBuilderTrustConfig,
  'module-builder': moduleBuilderTrustConfig,
  'workflow-builder': workflowBuilderTrustConfig,

  // BMM
  analyst: analystTrustConfig,
  'bmm-architect': bmmArchitectTrustConfig,
  dev: devTrustConfig,
  pm: pmTrustConfig,
  sm: smTrustConfig,
  tea: teaTrustConfig,
  'tech-writer': techWriterTrustConfig,
  'ux-designer': uxDesignerTrustConfig,
  'quick-flow-solo-dev': quickFlowSoloDevTrustConfig,

  // CIS
  'brainstorming-coach': brainstormingCoachTrustConfig,
  'creative-problem-solver': creativeProblemSolverTrustConfig,
  'design-thinking-coach': designThinkingCoachTrustConfig,
  'innovation-strategist': innovationStrategistTrustConfig,
  'presentation-master': presentationMasterTrustConfig,
  storyteller: storytellerTrustConfig,
};

export default bmadAgentTrustConfigs;
