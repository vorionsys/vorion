/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * Canonical Bridge - Re-exports canonical types from @vorionsys/contracts
 *
 * This module provides a bridge between legacy types in src/common/types.ts
 * and the canonical types defined in packages/contracts/src/v2/.
 *
 * USAGE:
 * - For NEW code: Import canonical types directly from this module
 * - For EXISTING code: Continue using legacy types from ./types.ts
 * - For MIGRATIONS: Use adapter functions to convert between formats
 *
 * @packageDocumentation
 */

// =============================================================================
// CANONICAL TYPE RE-EXPORTS
// =============================================================================

// Enums - Use these for all new code
export {
  TrustBand,
  ObservationTier,
  OBSERVATION_CEILINGS,
  DataSensitivity,
  Reversibility,
  ActionType,
  ProofEventType,
  ComponentType,
  ComponentStatus,
  ApprovalType,
} from '@vorionsys/contracts/v2/enums';

// Trust Profile types
export type {
  TrustFactorScores,
  TrustEvidence,
  TrustProfile,
  TrustProfileSummary,
  TrustCalculationRequest,
  BandThresholds,
  BandingConfig,
  TrustDynamicsConfig,
  CooldownState,
  DirectionChange,
  TrustDynamicsState,
  ProvisionalOutcome,
} from '@vorionsys/contracts/v2/trust-profile';

export {
  DEFAULT_BAND_THRESHOLDS,
  DEFAULT_BANDING_CONFIG,
  RiskProfile,
  RISK_PROFILE_WINDOWS,
  DEFAULT_TRUST_DYNAMICS,
} from '@vorionsys/contracts/v2/trust-profile';

// Intent types (canonical)
export type {
  Intent as CanonicalIntent,
  IntentContext as CanonicalIntentContext,
  IntentSummary,
  CreateIntentRequest,
} from '@vorionsys/contracts/v2/intent';

// Decision types (canonical)
export type {
  Decision as CanonicalDecision,
  DecisionSummary,
  DecisionConstraints,
  RateLimit,
  ApprovalRequirement,
  AuthorizationRequest,
  AuthorizationResponse,
} from '@vorionsys/contracts/v2/decision';

export { DenialReason } from '@vorionsys/contracts/v2/decision';

// Governance types (canonical)
export type {
  AuthorizationResult,
  AuthorizationConstraints,
  AuthContext,
  HierarchyLevel,
  HierarchyLevelConfig,
  AuthorityScopeType,
  AuthorityScope,
  AuthorityScopeTimeRestriction,
  Authority,
  AuthorityAudit,
  AuthorityType,
  Permission,
  GovernanceRole,
  ControlAction as GovernanceControlAction,
} from '@vorionsys/contracts/canonical/governance';

export {
  GovernanceDenialReason,
  HIERARCHY_TIERS,
  HIERARCHY_ORDER,
  HIERARCHY_LEVELS,
  getHierarchyTier,
  getHierarchyLevelConfig,
  isHigherAuthority,
  canDelegate,
  getReportingChain,
  meetsMinimumTrust,
  createAllowedResult,
  createDeniedResult,
  createGovernanceDeniedResult,
  isHierarchyLevel,
  isAuthorityScopeType,
  // Zod schemas
  governanceDenialReasonSchema,
  authorizationConstraintsSchema,
  authorizationResultSchema,
  governanceRoleSchema,
  hierarchyLevelSchema,
  hierarchyLevelConfigSchema,
  authorityScopeTypeSchema,
  controlActionSchema,
  authorityScopeTimeRestrictionSchema,
  authorityScopeSchema,
  authorityTypeSchema,
  permissionSchema,
  authorityAuditSchema,
  authoritySchema,
  authContextSchema,
} from '@vorionsys/contracts/canonical/governance';

// =============================================================================
// LEGACY TYPE IMPORTS (for adapter functions)
// =============================================================================

import type { ID, Timestamp, TrustLevel, TrustScore, Intent, TrustSignal } from './types.js';
import { TrustBand, ActionType } from '@vorionsys/contracts/v2/enums';
import type { Intent as CanonicalIntent } from '@vorionsys/contracts/v2/intent';
import type { TrustEvidence } from '@vorionsys/contracts/v2/trust-profile';

// =============================================================================
// ADAPTER FUNCTIONS
// =============================================================================

/**
 * Convert legacy TrustLevel (0-7) to canonical TrustBand enum
 *
 * @param level - Legacy trust level (0-7)
 * @returns Canonical TrustBand enum value
 */
export function trustLevelToTrustBand(level: TrustLevel): TrustBand {
  switch (level) {
    case 0:
      return TrustBand.T0_SANDBOX;
    case 1:
      return TrustBand.T1_OBSERVED;
    case 2:
      return TrustBand.T2_PROVISIONAL;
    case 3:
      return TrustBand.T3_MONITORED;
    case 4:
      return TrustBand.T4_STANDARD;
    case 5:
      return TrustBand.T5_TRUSTED;
    case 6:
      return TrustBand.T6_CERTIFIED;
    case 7:
      return TrustBand.T7_AUTONOMOUS;
    default:
      throw new Error(`Invalid trust level: ${level}`);
  }
}

/**
 * Convert canonical TrustBand enum to legacy TrustLevel (0-5)
 *
 * @param band - Canonical TrustBand enum value
 * @returns Legacy trust level (0-5)
 */
export function trustBandToTrustLevel(band: TrustBand): TrustLevel {
  // TrustBand enum values are 0-5, which maps directly to TrustLevel
  return band as TrustLevel;
}

/**
 * @deprecated No longer needed - trust-profile.ts now uses 0-1000 scale
 *
 * Convert trust score (0-1000) to legacy dimension score (0-100)
 * This is provided for backwards compatibility with older code that
 * expected 0-100 scale dimensions.
 *
 * @param score - Trust score on 0-1000 scale
 * @returns Score on 0-100 scale
 */
export function trustScoreToDimensionScore(score: TrustScore): number {
  return Math.round(score / 10);
}

/**
 * @deprecated No longer needed - trust-profile.ts now uses 0-1000 scale
 *
 * Convert legacy dimension score (0-100) to trust score (0-1000)
 * This is provided for backwards compatibility with older code that
 * used 0-100 scale dimensions.
 *
 * @param dimensionScore - Score on 0-100 scale
 * @returns Trust score on 0-1000 scale
 */
export function dimensionScoreToTrustScore(dimensionScore: number): TrustScore {
  return Math.round(dimensionScore * 10);
}

/**
 * Calculate TrustBand from a TrustScore (0-1000)
 *
 * Band thresholds (0-1000 scale, asymmetric per ATSF v2.0):
 * - T0_SANDBOX: 0-199
 * - T1_OBSERVED: 200-349
 * - T2_PROVISIONAL: 350-499
 * - T3_MONITORED: 500-649
 * - T4_STANDARD: 650-799
 * - T5_TRUSTED: 800-875
 * - T6_CERTIFIED: 876-950
 * - T7_AUTONOMOUS: 951-1000
 *
 * @param score - Trust score on 0-1000 scale
 * @returns Corresponding TrustBand
 */
export function trustScoreToTrustBand(score: TrustScore): TrustBand {
  if (score < 200) return TrustBand.T0_SANDBOX;
  if (score < 350) return TrustBand.T1_OBSERVED;
  if (score < 500) return TrustBand.T2_PROVISIONAL;
  if (score < 650) return TrustBand.T3_MONITORED;
  if (score < 800) return TrustBand.T4_STANDARD;
  if (score < 876) return TrustBand.T5_TRUSTED;
  if (score < 951) return TrustBand.T6_CERTIFIED;
  return TrustBand.T7_AUTONOMOUS;
}

/**
 * Convert legacy TrustSignal to canonical TrustEvidence
 *
 * @param signal - Legacy TrustSignal
 * @param dimension - Which trust dimension this evidence affects
 * @returns Canonical TrustEvidence
 */
export function trustSignalToEvidence(
  signal: TrustSignal,
  factorCode: string = 'CT-REL'
): TrustEvidence {
  return {
    evidenceId: signal.id,
    factorCode,
    impact: signal.value * (signal.weight ?? 1),
    source: signal.source ?? 'legacy-signal',
    collectedAt: new Date(signal.timestamp),
    metadata: signal.metadata,
  };
}

/**
 * Convert canonical TrustEvidence to legacy TrustSignal
 *
 * @param evidence - Canonical TrustEvidence
 * @param entityId - Entity ID (required for legacy format)
 * @returns Legacy TrustSignal
 */
export function evidenceToTrustSignal(
  evidence: TrustEvidence,
  entityId: ID
): TrustSignal {
  return {
    id: evidence.evidenceId,
    entityId,
    type: evidence.factorCode,
    value: evidence.impact,
    weight: 1.0,
    source: evidence.source,
    timestamp: evidence.collectedAt.toISOString() as Timestamp,
    metadata: evidence.metadata,
  };
}

/**
 * Map string action type to ActionType enum
 */
const ACTION_TYPE_MAP: Record<'read' | 'write' | 'delete' | 'execute' | 'communicate' | 'transfer', ActionType> = {
  read: ActionType.READ,
  write: ActionType.WRITE,
  delete: ActionType.DELETE,
  execute: ActionType.EXECUTE,
  communicate: ActionType.COMMUNICATE,
  transfer: ActionType.TRANSFER,
};

/**
 * Convert legacy Intent to canonical Intent format
 *
 * Note: Some fields may require additional context that isn't available
 * in the legacy format. These are marked as optional in the canonical type.
 *
 * @param intent - Legacy Intent
 * @param actionType - ActionType (required for canonical, defaults to 'execute')
 * @returns Partial canonical Intent (missing some required fields)
 */
export function legacyIntentToCanonical(
  intent: Intent,
  actionType: 'read' | 'write' | 'delete' | 'execute' | 'communicate' | 'transfer' = 'execute'
): Partial<CanonicalIntent> {
  return {
    intentId: intent.id,
    agentId: intent.entityId,
    correlationId: intent.id, // Use intent ID as correlation if not available
    action: intent.goal,
    actionType: ACTION_TYPE_MAP[actionType],
    context: {
      metadata: intent.metadata,
      priority: intent.priority,
      ...intent.context,
    },
    createdAt: new Date(intent.createdAt),
  };
}

// =============================================================================
// BAND THRESHOLD CONSTANTS (0-1000 scale)
// =============================================================================

/**
 * Trust band thresholds on 0-1000 scale
 *
 * These are the canonical thresholds that should be used for API responses
 * and trust calculations. All trust dimensions and composite scores now
 * use the unified 0-1000 scale.
 */
export const TRUST_BAND_THRESHOLDS_1000 = {
  T0: { min: 0, max: 166 },
  T1: { min: 167, max: 332 },
  T2: { min: 333, max: 499 },
  T3: { min: 500, max: 665 },
  T4: { min: 666, max: 832 },
  T5: { min: 833, max: 1000 },
} as const;

/**
 * Get the minimum trust score required for a given TrustBand (0-1000 scale)
 *
 * @param band - Target TrustBand
 * @returns Minimum score required
 */
export function getMinScoreForBand(band: TrustBand): TrustScore {
  const bandKey = `T${band}` as keyof typeof TRUST_BAND_THRESHOLDS_1000;
  return TRUST_BAND_THRESHOLDS_1000[bandKey].min;
}

/**
 * Get the maximum trust score for a given TrustBand (0-1000 scale)
 *
 * @param band - Target TrustBand
 * @returns Maximum score for the band
 */
export function getMaxScoreForBand(band: TrustBand): TrustScore {
  const bandKey = `T${band}` as keyof typeof TRUST_BAND_THRESHOLDS_1000;
  return TRUST_BAND_THRESHOLDS_1000[bandKey].max;
}
