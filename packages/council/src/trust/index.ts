/**
 * Trust System - 7-Tier 16-Factor Gating
 *
 * Exports:
 * - Simulation: 16-factor trust model definitions and simulation engine
 * - Telemetry: Real-time behavior metric collection
 * - Gating: Live promotion/demotion enforcement
 * - Presets: ACI-compliant weight configurations
 */

// Core types and constants (16-factor model)
export {
    TRUST_TIERS,
    FACTORS,
    /** @deprecated Use FACTORS */
    DIMENSIONS,
    FACTOR_WEIGHTS,
    /** @deprecated Use FACTOR_WEIGHTS */
    DIMENSION_WEIGHTS,
    GATING_THRESHOLDS,
    AGENT_ARCHETYPES,
    type TierName,
    type TrustTier,
    type TrustFactor,
    /** @deprecated Use TrustFactor */
    type Dimension,
    type AgentArchetype,
    type SimulationResult,
    type SimulationDay,
    simulateAgent,
    runAllSimulations,
} from './simulation.js';

// Telemetry collection
export {
    TelemetryCollector,
    getTelemetryCollector,
    recordTaskSuccess,
    recordTaskFailure,
    recordPolicyViolation,
    recordConsentEvent,
    recordCollaboration,
    EVENT_FACTOR_MAP,
    type TelemetryEvent,
    type TelemetryEventType,
    type AgentTrustState,
    type FactorState,
    /** @deprecated Use FactorState */
    type DimensionState,
    type TrustSnapshot,
} from './telemetry.js';

// Gating engine
export {
    GatingEngine,
    getGatingEngine,
    canPromote,
    requestPromotion,
    runAutoGating,
    type GatingDecision,
    type PromotionRequest,
    type TierChangeAudit,
} from './gating.js';

// Presets (BASIS compatibility, 16-factor model)
export {
    BASIS_CANONICAL_PRESETS,
    AXIOM_DELTAS,
    TRUST_TIERS as LEGACY_TRUST_TIERS,
    CREATION_MODIFIERS,
    ROLE_DEFINITIONS,
    T3_BASELINE,
    FACTOR_CODES,
    type FactorCode,
    type FactorWeightConfig,
    /** @deprecated Use FactorWeightConfig */
    type WeightConfig,
    createAxiomPreset,
    bootstrapAgentTrustConfigs,
} from './presets.js';

// Re-export for convenience
export { default as bmadPresets } from './bmad-presets.js';
