// Council Types and Interfaces
//
// CANONICAL ALIGNMENT NOTE:
// This module aligns with @vorion/contracts canonical types:
// - RiskLevel: Now uses canonical string union alongside numeric for compatibility
// - TrustBand: Uses T0-T7 canonical bands (8-tier system)

export type ValidatorId = 'guardian' | 'arbiter' | 'scholar' | 'advocate'

export type VoteDecision = 'approve' | 'deny' | 'abstain'

/**
 * Canonical RiskLevel string union aligned with @vorion/contracts
 */
export type CanonicalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * @deprecated Use CanonicalRiskLevel instead. Numeric risk levels for backwards compatibility.
 * Maps: 0='low', 1='low', 2='medium', 3='high', 4='critical'
 */
export type NumericRiskLevel = 0 | 1 | 2 | 3 | 4

/**
 * Combined RiskLevel type supporting both numeric (legacy) and string (canonical) formats
 */
export type RiskLevel = NumericRiskLevel | CanonicalRiskLevel;

/**
 * Canonical TrustBand aligned with @vorion/contracts (8-tier T0-T7)
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

export interface ValidatorVote {
  validatorId: ValidatorId
  decision: VoteDecision
  reasoning: string
  confidence: number // 0-1
  votedAt: string
}

export interface UpchainRequest {
  id: string
  agentId: string
  actionType: string
  actionDetails: string
  context: Record<string, any>
  justification: string
  /** Supports both numeric (legacy) and string (canonical) risk levels */
  riskLevel: RiskLevel
  requestedAt: string
}

export interface CouncilDecision {
  id: string
  requestId: string
  agentId: string
  votes: ValidatorVote[]
  outcome: 'approved' | 'denied' | 'escalated' | 'pending'
  finalReasoning: string
  createsPrecedent: boolean
  precedentId?: string
  decidedAt: string
  recordedOnTruthChain: boolean
}

export interface ValidatorConfig {
  id: ValidatorId
  name: string
  domain: string
  description: string
  icon: string
  systemPrompt: string
}

// =============================================================================
// Risk Level Definitions and Adapters
// =============================================================================

/**
 * @deprecated Use CANONICAL_RISK_LEVELS instead.
 * Legacy numeric risk level definitions for backwards compatibility.
 */
export const RISK_LEVELS: Record<NumericRiskLevel, { name: string; description: string; approval: string }> = {
  0: {
    name: 'Routine',
    description: 'Read data, format text',
    approval: 'Auto (logged)',
  },
  1: {
    name: 'Standard',
    description: 'Generate content, analyze',
    approval: 'Auto (logged)',
  },
  2: {
    name: 'Elevated',
    description: 'External API call, create file',
    approval: 'Single validator',
  },
  3: {
    name: 'Significant',
    description: 'Modify system, send email',
    approval: 'Majority (3/4)',
  },
  4: {
    name: 'Critical',
    description: 'Delete data, financial action',
    approval: 'Unanimous + Human',
  },
}

/**
 * Canonical risk level definitions aligned with @vorion/contracts
 */
export const CANONICAL_RISK_LEVELS: Record<CanonicalRiskLevel, { name: string; description: string; approval: string; numericEquivalent: NumericRiskLevel }> = {
  low: {
    name: 'Low',
    description: 'Read data, format text, generate content',
    approval: 'Auto (logged)',
    numericEquivalent: 1,
  },
  medium: {
    name: 'Medium',
    description: 'External API call, create file',
    approval: 'Single validator',
    numericEquivalent: 2,
  },
  high: {
    name: 'High',
    description: 'Modify system, send email',
    approval: 'Majority (3/4)',
    numericEquivalent: 3,
  },
  critical: {
    name: 'Critical',
    description: 'Delete data, financial action',
    approval: 'Unanimous + Human',
    numericEquivalent: 4,
  },
}

/**
 * Convert numeric risk level to canonical string risk level
 */
export function numericToCanonicalRisk(numeric: NumericRiskLevel): CanonicalRiskLevel {
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
 * Convert canonical string risk level to numeric risk level
 */
export function canonicalToNumericRisk(canonical: CanonicalRiskLevel): NumericRiskLevel {
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
 * Normalize any RiskLevel to canonical string format
 */
export function normalizeRiskLevel(level: RiskLevel): CanonicalRiskLevel {
  if (typeof level === 'number') {
    return numericToCanonicalRisk(level);
  }
  return level;
}

// =============================================================================
// Trust Band to Autonomy Mapping
// =============================================================================

/**
 * @deprecated Use TRUST_BAND_AUTONOMY instead.
 * Legacy trust tier to numeric risk level mapping.
 */
export const TRUST_TIER_AUTONOMY: Record<string, NumericRiskLevel> = {
  untrusted: 0,  // Can only do L0 actions automatically
  novice: 1,     // L0-L1 automatically
  proven: 2,     // L0-L2 automatically
  trusted: 2,    // L0-L2 automatically, L3 with single vote
  elite: 3,      // L0-L3 automatically
  legendary: 3,  // L0-L3 automatically, L4 with majority
}

/**
 * Canonical TrustBand to maximum allowed canonical RiskLevel mapping
 */
export const TRUST_BAND_AUTONOMY: Record<TrustBand, CanonicalRiskLevel> = {
  T0_SANDBOX: 'low',       // Can only do low-risk actions automatically
  T1_OBSERVED: 'low',      // Low-risk actions automatically
  T2_PROVISIONAL: 'medium', // Low-medium automatically
  T3_MONITORED: 'medium',  // Low-medium automatically
  T4_STANDARD: 'high',     // Low-high automatically
  T5_TRUSTED: 'high',      // Low-high automatically
  T6_CERTIFIED: 'critical', // Low-critical with oversight
  T7_AUTONOMOUS: 'critical', // Full autonomy
}

/**
 * Maps legacy tier names to canonical TrustBand
 */
export const LEGACY_TIER_TO_BAND: Record<string, TrustBand> = {
  untrusted: 'T0_SANDBOX',
  novice: 'T1_OBSERVED',
  proven: 'T2_PROVISIONAL',
  trusted: 'T4_STANDARD',
  elite: 'T6_CERTIFIED',
  legendary: 'T7_AUTONOMOUS',
}
