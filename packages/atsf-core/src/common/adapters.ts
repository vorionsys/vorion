/**
 * Type Adapters for Legacy to Canonical Conversion
 *
 * Provides adapter functions to convert between legacy atsf-core types
 * and canonical types from @vorionsys/contracts for backwards compatibility.
 *
 * @packageDocumentation
 */

import type {
  TrustBand,
  TrustFactorScores,
  RiskProfile,
} from '@vorionsys/contracts';

import type {
  ID,
  Timestamp,
  TrustLevel,
  TrustComponents,
  IntentStatus,
  RiskLevel,
} from './types.js';

// ============================================================================
// Legacy Type Definitions (for explicit typing in adapters)
// ============================================================================

/**
 * Legacy intent structure used in older atsf-core code
 */
export interface LegacyIntent {
  id: ID;
  entityId: ID;
  goal: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: IntentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Legacy trust signal structure
 */
export interface LegacySignal {
  id: ID;
  entityId: ID;
  type: string;
  value: number;
  source?: string;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}

/**
 * Canonical intent structure from @vorionsys/contracts
 */
export interface CanonicalIntent {
  intentId: string;
  agentId: string;
  correlationId: string;
  action: string;
  actionType: string;
  resourceScope: string[];
  dataSensitivity: string;
  reversibility: string;
  context: Record<string, unknown>;
  createdAt: Date;
  expiresAt?: Date;
  source?: string;
}

/**
 * Canonical trust signal (TrustEvidence) from @vorionsys/contracts
 */
export interface CanonicalTrustSignal {
  evidenceId: string;
  /** Factor code (e.g. 'CT-COMP', 'CT-REL', 'OP-ALIGN') */
  factorCode: string;
  impact: number;
  source: string;
  collectedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Trust Level / Trust Band Adapters
// ============================================================================

/**
 * Trust band thresholds for score-to-band mapping (0-1000 scale)
 * Aligned with canonical DEFAULT_BAND_THRESHOLDS from @vorionsys/contracts (8-tier model)
 */
const TRUST_BAND_THRESHOLDS = {
  T0: { min: 0, max: 199 },
  T1: { min: 200, max: 349 },
  T2: { min: 350, max: 499 },
  T3: { min: 500, max: 649 },
  T4: { min: 650, max: 799 },
  T5: { min: 800, max: 875 },
  T6: { min: 876, max: 950 },
  T7: { min: 951, max: 1000 },
} as const;

/**
 * Adapts a legacy numeric trust level (0-7) to canonical TrustBand enum
 *
 * @param level - Legacy trust level (0-7)
 * @returns Canonical TrustBand value
 *
 * @example
 * ```typescript
 * const band = adaptLegacyTrustLevel(3);
 * // Returns TrustBand.T3_MONITORED (value: 3)
 * ```
 */
export function adaptLegacyTrustLevel(level: TrustLevel | number): TrustBand {
  // TrustBand enum values are 0-7, same as legacy TrustLevel
  const clampedLevel = Math.max(0, Math.min(7, Math.floor(level)));
  return clampedLevel as TrustBand;
}

/**
 * Adapts a canonical TrustBand to legacy numeric trust level
 *
 * @param band - Canonical TrustBand enum value
 * @returns Legacy trust level (0-5)
 */
export function adaptTrustBandToLevel(band: TrustBand): TrustLevel {
  return band as TrustLevel;
}

/**
 * Converts a trust score (0-100 or 0-1000) to canonical TrustBand (8-tier model)
 *
 * @param score - Trust score (auto-detects 0-100 vs 0-1000 scale)
 * @returns Canonical TrustBand value
 */
export function adaptScoreToTrustBand(score: number): TrustBand {
  // Normalize to 0-1000 scale if score appears to be on 0-100 scale
  const normalizedScore = score <= 100 ? score * 10 : score;
  const clampedScore = Math.max(0, Math.min(1000, normalizedScore));

  if (clampedScore <= TRUST_BAND_THRESHOLDS.T0.max) return 0 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T1.max) return 1 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T2.max) return 2 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T3.max) return 3 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T4.max) return 4 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T5.max) return 5 as TrustBand;
  if (clampedScore <= TRUST_BAND_THRESHOLDS.T6.max) return 6 as TrustBand;
  return 7 as TrustBand;
}

// ============================================================================
// Intent Adapters
// ============================================================================

/**
 * Adapts a legacy Intent to canonical Intent structure
 *
 * @param intent - Legacy intent from atsf-core
 * @returns Canonical intent compatible with @vorionsys/contracts
 *
 * @example
 * ```typescript
 * const legacyIntent: LegacyIntent = { id: '123', entityId: 'agent-1', ... };
 * const canonical = adaptLegacyIntent(legacyIntent);
 * ```
 */
export function adaptLegacyIntent(intent: LegacyIntent): CanonicalIntent {
  return {
    intentId: intent.id,
    agentId: intent.entityId,
    correlationId: intent.metadata?.correlationId as string ?? intent.id,
    action: intent.goal,
    actionType: (intent.context?.actionType as string) ?? 'execute',
    resourceScope: (intent.context?.resources as string[]) ?? [],
    dataSensitivity: (intent.context?.dataSensitivity as string) ?? 'INTERNAL',
    reversibility: (intent.context?.reversibility as string) ?? 'REVERSIBLE',
    context: {
      ...intent.context,
      metadata: intent.metadata,
      legacyStatus: intent.status,
    },
    createdAt: new Date(intent.createdAt),
    expiresAt: intent.metadata?.expiresAt
      ? new Date(intent.metadata.expiresAt as string)
      : undefined,
    source: (intent.metadata?.source as string) ?? 'atsf-core-legacy',
  };
}

/**
 * Adapts a canonical Intent back to legacy Intent structure
 *
 * @param intent - Canonical intent from @vorionsys/contracts
 * @returns Legacy intent compatible with atsf-core
 */
export function adaptCanonicalIntent(intent: CanonicalIntent): LegacyIntent {
  return {
    id: intent.intentId,
    entityId: intent.agentId,
    goal: intent.action,
    context: {
      actionType: intent.actionType,
      resources: intent.resourceScope,
      dataSensitivity: intent.dataSensitivity,
      reversibility: intent.reversibility,
      ...intent.context,
    },
    metadata: {
      correlationId: intent.correlationId,
      source: intent.source,
      ...(intent.context.metadata as Record<string, unknown> ?? {}),
    },
    status: (intent.context.legacyStatus as IntentStatus) ?? 'pending',
    createdAt: intent.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Trust Signal / Evidence Adapters
// ============================================================================

/**
 * Maps legacy signal types to canonical trust factor codes
 *
 * Legacy 5-dimension model (CT, BT, GT, XT, AC) maps to 16 factor codes:
 * - BT (Behavioral) → CT-REL (Reliability)
 * - GT (Governance) → CT-ACCT (Accountability)
 * - CT (Capability/Identity) → CT-ID (Identity Verification)
 * - XT (Contextual) → OP-CONTEXT (Context Awareness)
 * - AC (Assurance) → CT-OBS (Observability)
 */
const SIGNAL_TYPE_TO_FACTOR: Record<string, string> = {
  // Behavioral signals -> CT-REL (Reliability)
  'behavioral': 'CT-REL',
  'behavioral.task_completed': 'CT-REL',
  'behavioral.task_failed': 'CT-REL',
  'behavioral.api_success': 'CT-REL',
  'behavioral.api_error': 'CT-REL',
  'action': 'CT-REL',
  'error': 'CT-REL',

  // Compliance/Governance signals -> CT-ACCT (Accountability)
  'compliance': 'CT-ACCT',
  'credential': 'CT-ACCT',
  'policy': 'CT-ACCT',
  'governance': 'CT-ACCT',

  // Identity/Capability signals -> CT-ID (Identity Verification)
  'identity': 'CT-ID',
  'capability': 'CT-COMP',
  'skill': 'CT-COMP',

  // Context signals -> OP-CONTEXT (Context Awareness)
  'context': 'OP-CONTEXT',
  'environment': 'OP-CONTEXT',
  'temporal': 'OP-CONTEXT',

  // Assurance signals -> CT-OBS (Observability)
  'assurance': 'CT-OBS',
  'verification': 'CT-OBS',
  'audit': 'CT-OBS',
};

/**
 * Adapts a legacy TrustSignal to canonical TrustEvidence
 *
 * @param signal - Legacy trust signal from atsf-core
 * @returns Canonical TrustEvidence compatible with @vorionsys/contracts
 *
 * @example
 * ```typescript
 * const legacySignal: LegacySignal = { id: '123', type: 'behavioral', value: 0.8, ... };
 * const evidence = adaptLegacyTrustSignal(legacySignal);
 * ```
 */
export function adaptLegacyTrustSignal(signal: LegacySignal): CanonicalTrustSignal {
  // Determine factor code from signal type
  const signalTypeKey = signal.type.toLowerCase();
  const basePart = signalTypeKey.split('.')[0] ?? signalTypeKey;
  const factorCode = SIGNAL_TYPE_TO_FACTOR[signalTypeKey]
    ?? SIGNAL_TYPE_TO_FACTOR[basePart]
    ?? 'CT-REL'; // Default to Reliability

  // Convert value to impact (-1000 to +1000 scale)
  // Legacy values are typically 0-1 or 0-100
  let impact: number;
  if (signal.value >= -1 && signal.value <= 1) {
    // 0-1 scale, convert to -1000 to +1000
    impact = (signal.value - 0.5) * 2000;
  } else if (signal.value >= -100 && signal.value <= 100) {
    // -100 to +100 scale, convert to -1000 to +1000
    impact = signal.value * 10;
  } else {
    // 0-100 scale, convert to -1000 to +1000
    impact = (signal.value - 50) * 20;
  }

  return {
    evidenceId: signal.id,
    factorCode,
    impact: Math.max(-1000, Math.min(1000, impact)),
    source: signal.source ?? 'atsf-core-legacy',
    collectedAt: new Date(signal.timestamp),
    metadata: signal.metadata,
  };
}

/**
 * Adapts canonical TrustEvidence back to legacy TrustSignal
 *
 * @param evidence - Canonical TrustEvidence from @vorionsys/contracts
 * @param entityId - Entity ID to associate with the signal
 * @returns Legacy TrustSignal compatible with atsf-core
 */
export function adaptCanonicalTrustSignal(
  evidence: CanonicalTrustSignal,
  entityId: ID
): LegacySignal {
  // Convert impact back to 0-1 value scale (from -1000 to +1000)
  const value = (evidence.impact + 1000) / 2000;

  return {
    id: evidence.evidenceId,
    entityId,
    type: `${evidence.factorCode.toLowerCase()}.evidence`,
    value: Math.max(0, Math.min(1, value)),
    source: evidence.source,
    timestamp: evidence.collectedAt.toISOString(),
    metadata: evidence.metadata,
  };
}

// ============================================================================
// Risk Level Adapters
// ============================================================================

/**
 * Maps numeric risk values to RiskLevel
 */
export function adaptRiskLevelFromNumber(n: number): RiskLevel {
  if (n <= 0.25) return 'low';
  if (n <= 0.5) return 'medium';
  if (n <= 0.75) return 'high';
  return 'critical';
}

/**
 * Maps RiskLevel to numeric value
 */
export function adaptRiskLevelToNumber(level: RiskLevel): number {
  switch (level) {
    case 'low': return 0.125;
    case 'medium': return 0.375;
    case 'high': return 0.625;
    case 'critical': return 0.875;
    default: return 0.5;
  }
}

/**
 * Maps legacy RiskLevel to canonical RiskProfile
 *
 * @param level - Legacy risk level
 * @returns Canonical RiskProfile value
 */
export function adaptRiskLevelToProfile(level: RiskLevel): RiskProfile {
  switch (level) {
    case 'low': return 'IMMEDIATE' as RiskProfile;
    case 'medium': return 'SHORT_TERM' as RiskProfile;
    case 'high': return 'MEDIUM_TERM' as RiskProfile;
    case 'critical': return 'LONG_TERM' as RiskProfile;
    default: return 'SHORT_TERM' as RiskProfile;
  }
}

// ============================================================================
// Trust Components / Dimensions Adapters
// ============================================================================

/**
 * Adapts legacy 4-dimension TrustComponents to canonical TrustFactorScores
 *
 * Maps the 4 legacy dimensions to representative trust factors (0.0-1.0 scale).
 * Legacy values are on 0-100 scale, factor scores are 0.0-1.0.
 *
 * @param components - Legacy TrustComponents (behavioral, compliance, identity, context)
 * @returns Canonical TrustFactorScores (factor code → 0.0-1.0)
 */
export function adaptLegacyTrustComponents(components: TrustComponents): TrustFactorScores {
  return {
    'CT-REL': components.behavioral / 100,   // Reliability <- behavioral
    'CT-ACCT': components.compliance / 100,   // Accountability <- compliance
    'CT-ID': components.identity / 100,       // Identity <- identity
    'OP-CONTEXT': components.context / 100,   // Context Awareness <- context
  };
}

/**
 * Adapts canonical TrustFactorScores to legacy 4-dimension TrustComponents
 *
 * Maps representative trust factors back to the 4 legacy dimensions.
 * Factor scores are 0.0-1.0, legacy values are 0-100 scale.
 *
 * @param factors - Canonical TrustFactorScores (factor code → 0.0-1.0)
 * @returns Legacy TrustComponents (behavioral, compliance, identity, context)
 */
export function adaptCanonicalTrustFactors(factors: TrustFactorScores): TrustComponents {
  return {
    behavioral: (factors['CT-REL'] ?? 0.5) * 100,
    compliance: (factors['CT-ACCT'] ?? 0.5) * 100,
    identity: (factors['CT-ID'] ?? 0.5) * 100,
    context: (factors['OP-CONTEXT'] ?? 0.5) * 100,
  };
}

// ============================================================================
// Batch Adapters
// ============================================================================

/**
 * Batch adapt multiple legacy intents
 */
export function adaptLegacyIntents(intents: LegacyIntent[]): CanonicalIntent[] {
  return intents.map(adaptLegacyIntent);
}

/**
 * Batch adapt multiple legacy signals
 */
export function adaptLegacyTrustSignals(signals: LegacySignal[]): CanonicalTrustSignal[] {
  return signals.map(adaptLegacyTrustSignal);
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  TrustBand,
  TrustFactorScores,
  TrustEvidence,
  RiskProfile,
} from '@vorionsys/contracts';

export type {
  TrustLevel,
  TrustScore,
  TrustSignal,
  TrustComponents,
  Intent,
  IntentStatus,
  RiskLevel,
} from './types.js';
