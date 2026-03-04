/**
 * Canonical Type Adapters for AgentAnchor
 *
 * This module provides adapters and utilities for converting between
 * legacy AgentAnchor types and the canonical @vorion/contracts types.
 *
 * CANONICAL TYPES (from @vorion/contracts):
 * - TrustBand: T0_SANDBOX through T7_AUTONOMOUS (0-1000 scale)
 * - TrustProfile: Multi-dimensional trust with CT, BT, GT, XT, AC
 * - RiskLevel: 'low' | 'medium' | 'high' | 'critical'
 * - DataSensitivity: PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED
 * - Reversibility: REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE
 *
 * LEGACY TYPES (AgentAnchor):
 * - TrustTier: untrusted, novice, proven, trusted, elite, legendary (0-1000 scale)
 * - RiskLevel (numeric): 0-4
 * - TrustScore: 300-1000 range
 */

// =============================================================================
// Canonical Type Definitions (mirrored from @vorion/contracts for local use)
// =============================================================================

/**
 * Canonical TrustBand enum values (8-tier T0-T7)
 */
export type TrustBand =
  | 'T0_SANDBOX'
  | 'T1_OBSERVED'
  | 'T2_PROVISIONAL'
  | 'T3_MONITORED'
  | 'T4_STANDARD'
  | 'T5_TRUSTED'
  | 'T6_CERTIFIED'
  | 'T7_AUTONOMOUS';

/**
 * Canonical TrustBand as numeric enum for interop
 */
export enum TrustBandEnum {
  T0_SANDBOX = 0,
  T1_OBSERVED = 1,
  T2_PROVISIONAL = 2,
  T3_MONITORED = 3,
  T4_STANDARD = 4,
  T5_TRUSTED = 5,
  T6_CERTIFIED = 6,
  T7_AUTONOMOUS = 7,
}

/**
 * Canonical RiskLevel string union
 */
export type CanonicalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Canonical DataSensitivity enum
 */
export type DataSensitivity = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

/**
 * Canonical Reversibility enum
 */
export type Reversibility = 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';

/**
 * Canonical trust dimensions
 */
export interface TrustDimensions {
  /** Capability Trust - Does the agent have the skills? */
  CT: number;
  /** Behavioral Trust - Has the agent acted reliably? */
  BT: number;
  /** Governance Trust - Is the agent properly governed? */
  GT: number;
  /** Contextual Trust - Is this the right context for the agent? */
  XT: number;
  /** Assurance Confidence - How confident are we in our assessment? */
  AC: number;
}

// =============================================================================
// Legacy Type Definitions
// =============================================================================

/**
 * Legacy TrustTier from agents/types.ts
 */
export type LegacyAgentTrustTier = 'untrusted' | 'novice' | 'proven' | 'trusted' | 'elite' | 'legendary';

/**
 * Legacy TrustTier from governance/types.ts
 */
export type LegacyGovernanceTrustTier =
  | 'untrusted'
  | 'provisional'
  | 'established'
  | 'trusted'
  | 'verified'
  | 'certified';

/**
 * Legacy numeric RiskLevel from council/types.ts
 */
export type LegacyNumericRiskLevel = 0 | 1 | 2 | 3 | 4;

// =============================================================================
// Canonical Band Thresholds (0-1000 scale)
// =============================================================================

export const CANONICAL_BAND_THRESHOLDS: Record<TrustBand, { min: number; max: number }> = {
  T0_SANDBOX: { min: 0, max: 199 },
  T1_OBSERVED: { min: 200, max: 349 },
  T2_PROVISIONAL: { min: 350, max: 499 },
  T3_MONITORED: { min: 500, max: 649 },
  T4_STANDARD: { min: 650, max: 799 },
  T5_TRUSTED: { min: 800, max: 875 },
  T6_CERTIFIED: { min: 876, max: 950 },
  T7_AUTONOMOUS: { min: 951, max: 1000 },
};

// =============================================================================
// TrustTier <-> TrustBand Adapters
// =============================================================================

/**
 * Maps legacy agent TrustTier to canonical TrustBand
 */
export const AGENT_TIER_TO_BAND: Record<LegacyAgentTrustTier, TrustBand> = {
  untrusted: 'T0_SANDBOX',
  novice: 'T1_OBSERVED',
  proven: 'T2_PROVISIONAL',
  trusted: 'T4_STANDARD',
  elite: 'T6_CERTIFIED',
  legendary: 'T7_AUTONOMOUS',
};

/**
 * Maps legacy governance TrustTier to canonical TrustBand
 */
export const GOVERNANCE_TIER_TO_BAND: Record<LegacyGovernanceTrustTier, TrustBand> = {
  untrusted: 'T0_SANDBOX',
  provisional: 'T1_OBSERVED',
  established: 'T2_PROVISIONAL',
  trusted: 'T4_STANDARD',
  verified: 'T5_TRUSTED',
  certified: 'T7_AUTONOMOUS',
};

/**
 * Maps canonical TrustBand to legacy agent TrustTier
 */
export const BAND_TO_AGENT_TIER: Record<TrustBand, LegacyAgentTrustTier> = {
  T0_SANDBOX: 'untrusted',
  T1_OBSERVED: 'novice',
  T2_PROVISIONAL: 'proven',
  T3_MONITORED: 'proven',
  T4_STANDARD: 'trusted',
  T5_TRUSTED: 'trusted',
  T6_CERTIFIED: 'elite',
  T7_AUTONOMOUS: 'legendary',
};

/**
 * Maps canonical TrustBand to legacy governance TrustTier
 */
export const BAND_TO_GOVERNANCE_TIER: Record<TrustBand, LegacyGovernanceTrustTier> = {
  T0_SANDBOX: 'untrusted',
  T1_OBSERVED: 'provisional',
  T2_PROVISIONAL: 'established',
  T3_MONITORED: 'established',
  T4_STANDARD: 'trusted',
  T5_TRUSTED: 'verified',
  T6_CERTIFIED: 'certified',
  T7_AUTONOMOUS: 'certified',
};

/**
 * Convert legacy agent TrustTier to canonical TrustBand
 */
export function agentTierToBand(tier: LegacyAgentTrustTier): TrustBand {
  return AGENT_TIER_TO_BAND[tier];
}

/**
 * Convert legacy governance TrustTier to canonical TrustBand
 */
export function governanceTierToBand(tier: LegacyGovernanceTrustTier): TrustBand {
  return GOVERNANCE_TIER_TO_BAND[tier];
}

/**
 * Convert canonical TrustBand to legacy agent TrustTier
 */
export function bandToAgentTier(band: TrustBand): LegacyAgentTrustTier {
  return BAND_TO_AGENT_TIER[band];
}

/**
 * Convert canonical TrustBand to legacy governance TrustTier
 */
export function bandToGovernanceTier(band: TrustBand): LegacyGovernanceTrustTier {
  return BAND_TO_GOVERNANCE_TIER[band];
}

// =============================================================================
// Trust Score Adapters
// =============================================================================

/**
 * Normalize legacy 0-1000 score (identity function - canonical now uses 0-1000)
 */
export function legacyScoreToCanonical(legacyScore: number): number {
  return Math.round(Math.max(0, Math.min(1000, legacyScore)));
}

/**
 * Normalize canonical 0-1000 score (identity function)
 */
export function canonicalScoreToLegacy(canonicalScore: number): number {
  return Math.round(Math.max(0, Math.min(1000, canonicalScore)));
}

/**
 * Convert legacy bot-trust 300-1000 score to canonical 0-1000 scale
 */
export function legacyBotTrustScoreToCanonical(legacyScore: number): number {
  const normalized = Math.max(0, Math.min(1000, legacyScore));
  if (normalized < 300) return 0;
  return Math.round(((normalized - 300) / 700) * 1000);
}

/**
 * Convert canonical 0-1000 score to legacy bot-trust 300-1000 scale
 */
export function canonicalScoreToLegacyBotTrust(canonicalScore: number): number {
  const normalized = Math.max(0, Math.min(1000, canonicalScore));
  return Math.round(300 + (normalized / 1000) * 700);
}

/**
 * Get canonical TrustBand from a 0-1000 score
 */
export function getBandFromScore(score: number): TrustBand {
  if (score < 200) return 'T0_SANDBOX';
  if (score < 350) return 'T1_OBSERVED';
  if (score < 500) return 'T2_PROVISIONAL';
  if (score < 650) return 'T3_MONITORED';
  if (score < 800) return 'T4_STANDARD';
  if (score < 876) return 'T5_TRUSTED';
  if (score < 951) return 'T6_CERTIFIED';
  return 'T7_AUTONOMOUS';
}

/**
 * Get TrustBand numeric value (0-7)
 */
export function getBandNumeric(band: TrustBand): TrustBandEnum {
  return TrustBandEnum[band];
}

// =============================================================================
// RiskLevel Adapters
// =============================================================================

/**
 * Convert legacy numeric RiskLevel to canonical string
 */
export function numericRiskToCanonical(numeric: LegacyNumericRiskLevel): CanonicalRiskLevel {
  switch (numeric) {
    case 0:
    case 1:
      return 'low';
    case 2:
      return 'medium';
    case 3:
      return 'high';
    case 4:
      return 'critical';
    default:
      return 'low';
  }
}

/**
 * Convert canonical RiskLevel string to numeric
 */
export function canonicalRiskToNumeric(canonical: CanonicalRiskLevel): LegacyNumericRiskLevel {
  switch (canonical) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'critical':
      return 4;
    default:
      return 1;
  }
}

/**
 * Normalize any RiskLevel (numeric or string) to canonical string
 */
export function normalizeRiskLevel(level: LegacyNumericRiskLevel | CanonicalRiskLevel): CanonicalRiskLevel {
  if (typeof level === 'number') {
    return numericRiskToCanonical(level);
  }
  return level;
}

// =============================================================================
// Trust Dimensions Adapters
// =============================================================================

/**
 * Convert legacy bot-trust components to canonical TrustDimensions
 */
export function legacyComponentsToTrustDimensions(components: {
  decision_accuracy: number;
  ethics_compliance: number;
  training_success: number;
  operational_stability: number;
  peer_reviews: number;
}): TrustDimensions {
  return {
    CT: components.decision_accuracy,   // Capability Trust
    BT: components.training_success,    // Behavioral Trust
    GT: components.ethics_compliance,   // Governance Trust
    XT: components.operational_stability, // Contextual Trust
    AC: components.peer_reviews,        // Assurance Confidence
  };
}

/**
 * Convert canonical TrustDimensions to legacy bot-trust components
 */
export function trustDimensionsToLegacyComponents(dimensions: TrustDimensions): {
  decision_accuracy: number;
  ethics_compliance: number;
  training_success: number;
  operational_stability: number;
  peer_reviews: number;
} {
  return {
    decision_accuracy: dimensions.CT,
    ethics_compliance: dimensions.GT,
    training_success: dimensions.BT,
    operational_stability: dimensions.XT,
    peer_reviews: dimensions.AC,
  };
}

/**
 * Calculate composite trust score from dimensions using default weights
 */
export function calculateCompositeScore(dimensions: TrustDimensions): number {
  const weights = {
    CT: 0.25,
    BT: 0.25,
    GT: 0.20,
    XT: 0.15,
    AC: 0.15,
  };

  return Math.round(
    dimensions.CT * weights.CT +
    dimensions.BT * weights.BT +
    dimensions.GT * weights.GT +
    dimensions.XT * weights.XT +
    dimensions.AC * weights.AC
  );
}

// =============================================================================
// Autonomy Level Adapters
// =============================================================================

/**
 * Maps bot-trust AutonomyLevel to canonical TrustBand
 */
export const AUTONOMY_TO_BAND: Record<number, TrustBand> = {
  1: 'T0_SANDBOX',     // ASK_LEARN
  2: 'T1_OBSERVED',    // SUGGEST
  3: 'T2_PROVISIONAL', // EXECUTE_REVIEW
  4: 'T4_STANDARD',    // AUTONOMOUS_EXCEPTIONS
  5: 'T5_TRUSTED',     // DELEGATED
  6: 'T6_CERTIFIED',   // INDEPENDENT
  7: 'T7_AUTONOMOUS',  // FULLY_AUTONOMOUS
};

/**
 * Maps canonical TrustBand to bot-trust AutonomyLevel
 */
export const BAND_TO_AUTONOMY: Record<TrustBand, number> = {
  T0_SANDBOX: 1,
  T1_OBSERVED: 2,
  T2_PROVISIONAL: 3,
  T3_MONITORED: 3,
  T4_STANDARD: 4,
  T5_TRUSTED: 5,
  T6_CERTIFIED: 6,
  T7_AUTONOMOUS: 7,
};

/**
 * Convert bot-trust AutonomyLevel to canonical TrustBand
 */
export function autonomyLevelToBand(level: number): TrustBand {
  return AUTONOMY_TO_BAND[level] || 'T0_SANDBOX';
}

/**
 * Convert canonical TrustBand to bot-trust AutonomyLevel
 */
export function bandToAutonomyLevel(band: TrustBand): number {
  return BAND_TO_AUTONOMY[band];
}

// =============================================================================
// Risk to Trust Band Mapping
// =============================================================================

/**
 * Maps canonical RiskLevel to minimum required TrustBand
 */
export const RISK_TO_MIN_BAND: Record<CanonicalRiskLevel, TrustBand> = {
  low: 'T0_SANDBOX',
  medium: 'T2_PROVISIONAL',
  high: 'T4_STANDARD',
  critical: 'T6_CERTIFIED',
};

/**
 * Maps canonical TrustBand to maximum allowed RiskLevel for autonomous action
 */
export const BAND_TO_MAX_RISK: Record<TrustBand, CanonicalRiskLevel> = {
  T0_SANDBOX: 'low',
  T1_OBSERVED: 'low',
  T2_PROVISIONAL: 'medium',
  T3_MONITORED: 'medium',
  T4_STANDARD: 'high',
  T5_TRUSTED: 'high',
  T6_CERTIFIED: 'critical',
  T7_AUTONOMOUS: 'critical',
};

/**
 * Check if a trust band can autonomously perform an action at a given risk level
 */
export function canActAutonomously(band: TrustBand, riskLevel: CanonicalRiskLevel): boolean {
  const riskOrder: CanonicalRiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const maxRisk = BAND_TO_MAX_RISK[band];
  return riskOrder.indexOf(riskLevel) <= riskOrder.indexOf(maxRisk);
}

/**
 * Get minimum trust band required for autonomous action at given risk level
 */
export function getMinimumBandForRisk(riskLevel: CanonicalRiskLevel): TrustBand {
  return RISK_TO_MIN_BAND[riskLevel];
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate that a score is within canonical 0-1000 range
 */
export function isValidCanonicalScore(score: number): boolean {
  return score >= 0 && score <= 1000;
}

/**
 * Validate that a score is within legacy 0-1000 range
 */
export function isValidLegacyScore(score: number): boolean {
  return score >= 0 && score <= 1000;
}

/**
 * Validate that a score is within legacy bot-trust 300-1000 range
 */
export function isValidLegacyBotTrustScore(score: number): boolean {
  return score >= 300 && score <= 1000;
}

/**
 * Type guard for canonical RiskLevel
 */
export function isCanonicalRiskLevel(value: unknown): value is CanonicalRiskLevel {
  return typeof value === 'string' && ['low', 'medium', 'high', 'critical'].includes(value);
}

/**
 * Type guard for legacy numeric RiskLevel
 */
export function isLegacyNumericRiskLevel(value: unknown): value is LegacyNumericRiskLevel {
  return typeof value === 'number' && [0, 1, 2, 3, 4].includes(value);
}

/**
 * Type guard for TrustBand
 */
export function isTrustBand(value: unknown): value is TrustBand {
  return typeof value === 'string' && [
    'T0_SANDBOX',
    'T1_OBSERVED',
    'T2_PROVISIONAL',
    'T3_MONITORED',
    'T4_STANDARD',
    'T5_TRUSTED',
    'T6_CERTIFIED',
    'T7_AUTONOMOUS',
  ].includes(value);
}
