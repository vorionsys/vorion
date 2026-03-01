/**
 * Re-export phase6 types for test consumption.
 * Source of truth: src/trust-engine/phase6-types.ts
 */
export {
  TrustEvent,
  TrustMetrics,
  AgentContextPolicy,
  ContextType,
  CONTEXT_CEILINGS,
  ROLE_GATE_MATRIX,
  RoleLevel,
  TrustTier,
  RoleGateValidation,
  CANONICAL_TRUST_PRESETS,
  TrustWeights,
  PresetDelta,
  PresetAudit,
  CREATION_TYPE_MODIFIERS,
  CreationType,
  AgentCreationInfo,
  CreationModifierApplication,
  AgentMigrationEvent,
  TrustEfficiencyMetric,
  computeEfficiencyMetric,
  validateTrustScore,
  validateContextType,
  validateCreationType,
  validateWeights,
  Phase6ValidationError,
} from '../src/trust-engine/phase6-types';
