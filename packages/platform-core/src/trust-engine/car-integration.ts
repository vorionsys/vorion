/**
 * CAR Integration for Trust Engine
 *
 * Bridges the @vorionsys/contracts/car module with the Trust Engine,
 * providing trust-aware operations on CAR (Capability Authority Record) strings.
 *
 * CAR = Categorical Agentic Registry (formerly ACI - Categorical Agentic Registry)
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  type Attestation,
  type EffectivePermission,
  type PermissionCheckResult,
  type EffectivePermissionContext,
  attestationSchema,
  effectivePermissionSchema,
  permissionCheckResultSchema,
  calculateEffectivePermission,
  checkPermission,
  CertificationTier,
  RuntimeTier,
  CapabilityLevel,
  certificationTierToRuntimeTier,
} from '@vorionsys/contracts/car';

import {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier as sharedScoreToTier,
} from '@vorionsys/shared-constants';

// =============================================================================
// RE-EXPORTS FROM CONTRACTS
// =============================================================================

export {
  type Attestation,
  type EffectivePermission,
  type PermissionCheckResult,
  attestationSchema,
  effectivePermissionSchema,
  permissionCheckResultSchema,
  CertificationTier,
  RuntimeTier,
  CapabilityLevel,
};

// Alias for backwards compatibility
export const AttestationSchema = attestationSchema;

// =============================================================================
// CAR TRUST CONTEXT
// =============================================================================

/**
 * Trust context for CAR-based permission calculations
 */
export interface CARTrustContext {
  /** The CAR string being evaluated */
  car: string;
  /** Current trust score (0-1000) */
  trustScore: number;
  /** Current trust tier */
  trustTier: TrustTier;
  /** Certification tier from attestations */
  certificationTier?: CertificationTier;
  /** Runtime deployment tier */
  runtimeTier?: RuntimeTier;
  /** Capability level from CAR */
  capabilityLevel: CapabilityLevel;
  /** Active attestations */
  attestations: Attestation[];
  /** Observability ceiling */
  observabilityCeiling?: number;
  /** Context policy ceiling */
  contextPolicyCeiling?: number;
}

/**
 * @deprecated Use CARTrustContext instead
 */
export type ACITrustContext = CARTrustContext;

// =============================================================================
// TIER/SCORE CONVERSIONS
// =============================================================================

/**
 * Convert trust score to tier
 */
export function scoreToTier(score: number): TrustTier {
  return sharedScoreToTier(score);
}

/**
 * Get minimum score for a certification tier
 */
export function certificationTierToMinScore(tier: CertificationTier): number {
  const mapping: Record<CertificationTier, number> = {
    [CertificationTier.T0_SANDBOX]: 0,
    [CertificationTier.T1_OBSERVED]: 200,
    [CertificationTier.T2_PROVISIONAL]: 350,
    [CertificationTier.T3_MONITORED]: 501,
    [CertificationTier.T4_STANDARD]: 650,
    [CertificationTier.T5_TRUSTED]: 800,
    [CertificationTier.T6_CERTIFIED]: 876,
    [CertificationTier.T7_AUTONOMOUS]: 951,
  };
  return mapping[tier] ?? 0;
}

/**
 * Get maximum score for a certification tier
 */
export function certificationTierToMaxScore(tier: CertificationTier): number {
  const mapping: Record<CertificationTier, number> = {
    [CertificationTier.T0_SANDBOX]: 199,
    [CertificationTier.T1_OBSERVED]: 349,
    [CertificationTier.T2_PROVISIONAL]: 499,
    [CertificationTier.T3_MONITORED]: 649,
    [CertificationTier.T4_STANDARD]: 799,
    [CertificationTier.T5_TRUSTED]: 875,
    [CertificationTier.T6_CERTIFIED]: 950,
    [CertificationTier.T7_AUTONOMOUS]: 1000,
  };
  return mapping[tier] ?? 199;
}

/**
 * Get representative score for a certification tier (midpoint)
 */
export function certificationTierToScore(tier: CertificationTier): number {
  const min = certificationTierToMinScore(tier);
  const max = certificationTierToMaxScore(tier);
  return Math.floor((min + max) / 2);
}

/**
 * Get minimum score for a trust tier
 */
export function tierToMinScore(tier: TrustTier): number {
  return TIER_THRESHOLDS[tier].min;
}

/**
 * Lookup certification tier from trust score (without hysteresis)
 */
export function lookupCertificationTier(score: number): CertificationTier {
  if (score >= 951) return CertificationTier.T7_AUTONOMOUS;
  if (score >= 876) return CertificationTier.T6_CERTIFIED;
  if (score >= 800) return CertificationTier.T5_TRUSTED;
  if (score >= 650) return CertificationTier.T4_STANDARD;
  if (score >= 501) return CertificationTier.T3_MONITORED;
  if (score >= 350) return CertificationTier.T2_PROVISIONAL;
  if (score >= 200) return CertificationTier.T1_OBSERVED;
  return CertificationTier.T0_SANDBOX;
}

/** Default hysteresis buffer for demotion protection */
export const DEFAULT_DEMOTION_HYSTERESIS = 25;

/**
 * Lookup certification tier with demotion hysteresis protection.
 *
 * - Promotion: Immediate when score reaches tier minimum
 * - Demotion: Only when score falls below (tier minimum - hysteresis)
 *
 * This prevents tier flapping when scores fluctuate near boundaries,
 * giving agents grace to recover before being demoted.
 *
 * @param score - Current trust score (0-1000)
 * @param currentTier - Agent's current certification tier (undefined for new agents)
 * @param hysteresis - Buffer below threshold before demotion (default: 25)
 */
export function lookupCertificationTierWithHysteresis(
  score: number,
  currentTier: CertificationTier | undefined,
  hysteresis: number = DEFAULT_DEMOTION_HYSTERESIS
): CertificationTier {
  // For new agents (no current tier), use standard lookup
  if (currentTier === undefined) {
    return lookupCertificationTier(score);
  }

  // Calculate what tier the score would normally map to
  const naiveTier = lookupCertificationTier(score);

  // If score qualifies for same or higher tier, use naive result (promotion is immediate)
  if (naiveTier >= currentTier) {
    return naiveTier;
  }

  // Score dropped - check if it's below the demotion threshold
  const currentTierMin = certificationTierToMinScore(currentTier);
  const demotionThreshold = currentTierMin - hysteresis;

  // If score is in the grace zone, maintain current tier
  if (score >= demotionThreshold) {
    return currentTier;
  }

  // Score fell below grace zone - allow demotion
  return naiveTier;
}

// =============================================================================
// CAPABILITY LEVEL OPERATIONS
// =============================================================================

/**
 * Get maximum capability level allowed by competence
 */
export function competenceLevelToCeiling(level: CapabilityLevel): number {
  // Capability levels map directly to ceiling values
  return level;
}

/**
 * Determine reason for capability ceiling
 */
export function determineCeilingReason(
  context: CARTrustContext
): { ceiling: number; reason: string } {
  const ceilings: { ceiling: number; reason: string }[] = [];

  // Trust score ceiling
  const trustCeiling = Math.floor(context.trustScore / 125); // 0-7 based on 0-1000
  ceilings.push({
    ceiling: Math.min(trustCeiling, 7),
    reason: `Trust score (${context.trustScore}) limits to L${Math.min(trustCeiling, 7)}`,
  });

  // Certification tier ceiling
  if (context.certificationTier !== undefined) {
    const certCeiling = certificationTierToCeiling(context.certificationTier);
    ceilings.push({
      ceiling: certCeiling,
      reason: `Certification tier limits to L${certCeiling}`,
    });
  }

  // Observability ceiling
  if (context.observabilityCeiling !== undefined) {
    ceilings.push({
      ceiling: context.observabilityCeiling,
      reason: `Observability limits to L${context.observabilityCeiling}`,
    });
  }

  // Context policy ceiling
  if (context.contextPolicyCeiling !== undefined) {
    ceilings.push({
      ceiling: context.contextPolicyCeiling,
      reason: `Context policy limits to L${context.contextPolicyCeiling}`,
    });
  }

  // Return the most restrictive ceiling
  ceilings.sort((a, b) => a.ceiling - b.ceiling);
  return ceilings[0] ?? { ceiling: 7, reason: 'No restrictions' };
}

function certificationTierToCeiling(tier: CertificationTier): number {
  const mapping: Record<CertificationTier, number> = {
    [CertificationTier.T0_SANDBOX]: 0,
    [CertificationTier.T1_OBSERVED]: 1,
    [CertificationTier.T2_PROVISIONAL]: 2,
    [CertificationTier.T3_MONITORED]: 3,
    [CertificationTier.T4_STANDARD]: 4,
    [CertificationTier.T5_TRUSTED]: 5,
    [CertificationTier.T6_CERTIFIED]: 6,
    [CertificationTier.T7_AUTONOMOUS]: 7,
  };
  return mapping[tier] ?? 0;
}

// =============================================================================
// TRUST SIGNAL CONVERSION
// =============================================================================

/**
 * Convert attestation to trust signal
 */
export function attestationToTrustSignal(attestation: Attestation): {
  source: string;
  weight: number;
  score: number;
  timestamp: Date;
} {
  // Calculate score contribution based on attestation scope and status
  const scopeWeights: Record<string, number> = {
    domain: 100,
    capability: 150,
    identity: 200,
    compliance: 250,
  };

  const weight = scopeWeights[attestation.scope] ?? 100;
  const score = attestation.status === 'active' ? weight : 0;

  return {
    source: `attestation:${attestation.scope}`,
    weight: weight / 250, // Normalize to 0-1
    score,
    timestamp: attestation.issuedAt,
  };
}

// =============================================================================
// EFFECTIVE CALCULATION
// =============================================================================

/**
 * Calculate effective permission from CAR trust context
 */
export function calculateEffectiveFromCAR(
  context: CARTrustContext
): EffectivePermission {
  const permContext: EffectivePermissionContext = {
    certificationTier: context.certificationTier ?? lookupCertificationTier(context.trustScore),
    competenceLevel: context.capabilityLevel,
    runtimeTier: context.runtimeTier ?? certificationTierToRuntimeTier(
      context.certificationTier ?? lookupCertificationTier(context.trustScore)
    ),
    observabilityCeiling: context.observabilityCeiling,
    contextPolicyCeiling: context.contextPolicyCeiling,
  };

  return calculateEffectivePermission(permContext);
}

/**
 * @deprecated Use calculateEffectiveFromCAR instead
 */
export const calculateEffectiveFromACI = calculateEffectiveFromCAR;

/**
 * Calculate effective tier from context
 */
export function calculateEffectiveTier(context: CARTrustContext): TrustTier {
  const { ceiling } = determineCeilingReason(context);
  // Map ceiling (0-7) to tier
  const tierMap: TrustTier[] = [
    TrustTier.T0_SANDBOX,
    TrustTier.T1_OBSERVED,
    TrustTier.T2_PROVISIONAL,
    TrustTier.T3_MONITORED,
    TrustTier.T4_STANDARD,
    TrustTier.T5_TRUSTED,
    TrustTier.T6_CERTIFIED,
    TrustTier.T7_AUTONOMOUS,
  ];
  return tierMap[Math.min(ceiling, 7)] ?? TrustTier.T0_SANDBOX;
}

/**
 * Calculate effective score from context
 */
export function calculateEffectiveScore(context: CARTrustContext): number {
  const effectiveTier = calculateEffectiveTier(context);
  const tierThreshold = TIER_THRESHOLDS[effectiveTier];
  // Return midpoint of effective tier range, capped by actual score
  const midpoint = Math.floor((tierThreshold.min + tierThreshold.max) / 2);
  return Math.min(context.trustScore, midpoint);
}

// =============================================================================
// FLOOR AND CEILING ENFORCEMENT
// =============================================================================

/**
 * Apply CAR floor to trust score
 * Floor ensures minimum trust based on attestations
 */
export function applyCARFloor(
  context: CARTrustContext,
  score: number
): number {
  // Calculate floor from attestations
  let floor = 0;
  for (const attestation of context.attestations) {
    if (attestation.status === 'active') {
      const signal = attestationToTrustSignal(attestation);
      floor = Math.max(floor, signal.score);
    }
  }
  return Math.max(score, floor);
}

/**
 * @deprecated Use applyCARFloor instead
 */
export const applyACIFloor = applyCARFloor;

/**
 * Enforce CAR ceiling on trust score
 * Ceiling prevents exceeding capability level limits
 */
export function enforceCARCeiling(
  context: CARTrustContext,
  score: number
): number {
  const { ceiling } = determineCeilingReason(context);
  // Convert capability ceiling to max score
  const maxScore = (ceiling + 1) * 125 - 1; // L0=124, L1=249, ..., L7=999
  return Math.min(score, Math.min(maxScore, 1000));
}

/**
 * @deprecated Use enforceCARCeiling instead
 */
export const enforceACICeiling = enforceCARCeiling;

// =============================================================================
// CONTEXT CREATION
// =============================================================================

/**
 * Create a CAR trust context
 */
export function createCARTrustContext(options: {
  car: string;
  trustScore: number;
  capabilityLevel: CapabilityLevel;
  attestations?: Attestation[];
  certificationTier?: CertificationTier;
  runtimeTier?: RuntimeTier;
  observabilityCeiling?: number;
  contextPolicyCeiling?: number;
}): CARTrustContext {
  return {
    car: options.car,
    trustScore: options.trustScore,
    trustTier: scoreToTier(options.trustScore),
    capabilityLevel: options.capabilityLevel,
    attestations: options.attestations ?? [],
    certificationTier: options.certificationTier,
    runtimeTier: options.runtimeTier,
    observabilityCeiling: options.observabilityCeiling,
    contextPolicyCeiling: options.contextPolicyCeiling,
  };
}

/**
 * @deprecated Use createCARTrustContext instead
 */
export const createACITrustContext = createCARTrustContext;
