/**
 * CAR Integration for Trust Engine
 *
 * Bridges CAR identity layer with Vorion runtime trust enforcement.
 *
 * **CRITICAL DESIGN PRINCIPLE:**
 * The CAR is an IMMUTABLE identifier. Trust is NOT embedded in the CAR.
 * Trust is computed at RUNTIME from:
 * 1. Attestations (external certifications linked to the CAR identity)
 * 2. Behavioral signals (runtime observations)
 * 3. Deployment context policies
 *
 * This separation ensures:
 * - CAR remains stable (like a passport number)
 * - Trust can evolve independently
 * - Same agent can have different trust in different deployments
 *
 * @packageDocumentation
 */

import {
  ParsedCAR,
  ParsedACI,
  CertificationTier,
  RuntimeTier,
  CapabilityLevel,
  parseCAR,
  getCARIdentity,
  type CARIdentity,
  type ACIIdentity,
} from '@vorionsys/contracts/car';
import type { TrustLevel, TrustScore, ID } from '../common/types.js';
import { createLogger } from '../common/logger.js';
import { z } from 'zod';

const logger = createLogger({ component: 'car-integration' });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert CertificationTier to RuntimeTier
 * Both use 0-5 values, so we can safely convert via unknown
 */
function certificationToRuntimeTier(certTier: CertificationTier): RuntimeTier {
  return certTier as unknown as RuntimeTier;
}

/**
 * Default certification tier when no attestation exists
 */
const DEFAULT_CERTIFICATION_TIER: CertificationTier = 0; // T0: Unverified

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Attestation record from CAR certification
 */
export interface Attestation {
  /** Unique attestation identifier */
  id: string;
  /** Subject entity (agent) this attestation is for */
  subject: ID;
  /** Issuing authority (e.g., auditor, certifier) */
  issuer: string;
  /** Certified trust tier (T0-T5) */
  trustTier: CertificationTier;
  /** Scope of the attestation (domains, capabilities) */
  scope: string[];
  /** When the attestation was issued */
  issuedAt: Date;
  /** When the attestation expires */
  expiresAt: Date;
  /** Supporting evidence references */
  evidence: string[];
}

/**
 * CAR Trust Context
 *
 * Combines identity (from CAR) with trust (from attestations + runtime).
 *
 * IMPORTANT: The certificationTier comes from ATTESTATIONS, not the CAR itself.
 * The CAR is just an identifier; trust is computed at runtime.
 */
export interface CARTrustContext {
  // CAR Identity (immutable)
  /** Parsed CAR string (identifier only, no trust info) */
  car: ParsedCAR;
  /** Unique identity portion: registry.organization.agentClass */
  identity: CARIdentity;
  /** Competence/capability level from CAR */
  competenceLevel: CapabilityLevel;
  /** Domains the agent operates in (from CAR) */
  operationalDomains: string[];

  // Certification (from attestations, NOT from CAR)
  /** Certification tier from attestations (T0-T5) - defaults to T0 if no attestation */
  certificationTier: CertificationTier;
  /** Whether a valid attestation exists for this agent */
  hasValidAttestation: boolean;
  /** Attestation expiry (if any) */
  attestationExpiresAt?: Date;

  // Vorion Runtime (deployment-specific)
  /** Current runtime trust tier based on behavioral signals */
  runtimeTier: RuntimeTier;
  /** Current runtime trust score (0-1000) */
  runtimeScore: TrustScore;

  // Ceilings (limits on effective trust)
  /** Max tier based on observability class */
  observabilityCeiling: RuntimeTier;
  /** Max tier based on deployment context policy */
  contextPolicyCeiling: RuntimeTier;

  // Effective (computed minimum of all factors)
  /** Effective tier after applying all ceilings */
  effectiveTier: RuntimeTier;
  /** Effective score after applying all ceilings */
  effectiveScore: TrustScore;
}

/** @deprecated Use CARTrustContext instead */
export type ACITrustContext = CARTrustContext;

/**
 * Result of effective permission calculation
 */
export interface EffectivePermission {
  /** Effective trust tier */
  tier: RuntimeTier;
  /** Effective trust score */
  score: TrustScore;
  /** Certified domains */
  domains: string[];
  /** Capability level */
  level: CapabilityLevel;
  /** Reason why the ceiling was applied (if any) */
  ceilingReason?: string;
}

/**
 * Trust signal derived from an attestation
 */
export interface TrustSignal {
  /** Unique signal identifier */
  id: string;
  /** Entity this signal is for */
  entityId: ID;
  /** Signal type */
  type: string;
  /** Signal value (impact on trust) */
  value: number;
  /** Weight multiplier */
  weight: number;
  /** Source of the signal */
  source: string;
  /** When this signal was created */
  timestamp: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Effective trust tier */
  effectiveTier: RuntimeTier;
  /** Effective trust score */
  effectiveScore: TrustScore;
  /** Reason for denial (if not allowed) */
  reason?: string;
  /** Explanation of which ceiling limited the permission */
  ceilingReason?: string;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Schema for Attestation validation
 */
export const AttestationSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  issuer: z.string(),
  trustTier: z.number().int().min(0).max(7) as z.ZodType<CertificationTier>,
  scope: z.array(z.string()),
  issuedAt: z.date(),
  expiresAt: z.date(),
  evidence: z.array(z.string()),
});

// ============================================================================
// Tier/Score Conversion Utilities
// ============================================================================

/**
 * Tier to minimum score mapping (aligned with TRUST_THRESHOLDS)
 */
const TIER_TO_MIN_SCORE: Record<RuntimeTier, TrustScore> = {
  0: 0,    // T0_SANDBOX
  1: 200,  // T1_OBSERVED
  2: 350,  // T2_PROVISIONAL
  3: 500,  // T3_MONITORED
  4: 650,  // T4_STANDARD
  5: 800,  // T5_TRUSTED
  6: 876,  // T6_CERTIFIED
  7: 951,  // T7_AUTONOMOUS
};

/**
 * Tier to maximum score mapping (aligned with TIER_TO_MIN_SCORE)
 */
const TIER_TO_MAX_SCORE: Record<RuntimeTier, TrustScore> = {
  0: 199,   // T0_SANDBOX: 0-199
  1: 349,   // T1_OBSERVED: 200-349
  2: 499,   // T2_PROVISIONAL: 350-499
  3: 649,   // T3_MONITORED: 500-649
  4: 799,   // T4_STANDARD: 650-799
  5: 875,   // T5_TRUSTED: 800-875
  6: 950,   // T6_CERTIFIED: 876-950
  7: 1000,  // T7_AUTONOMOUS: 951-1000
};

/**
 * Convert certification tier to minimum trust score
 */
export function certificationTierToMinScore(tier: CertificationTier): TrustScore {
  return TIER_TO_MIN_SCORE[certificationToRuntimeTier(tier)] ?? 0;
}

/**
 * Convert certification tier to maximum trust score
 */
export function certificationTierToMaxScore(tier: CertificationTier): TrustScore {
  return TIER_TO_MAX_SCORE[certificationToRuntimeTier(tier)] ?? 1000;
}

/**
 * Convert certification tier to a representative trust score
 */
export function certificationTierToScore(tier: CertificationTier): number {
  const runtimeTier = certificationToRuntimeTier(tier);
  const min = TIER_TO_MIN_SCORE[runtimeTier] ?? 0;
  const max = TIER_TO_MAX_SCORE[runtimeTier] ?? 199;
  return Math.floor((min + max) / 2);
}

/**
 * Convert trust score to runtime tier
 */
export function scoreToTier(score: TrustScore): RuntimeTier {
  if (score >= 951) return 7;  // T7_AUTONOMOUS
  if (score >= 876) return 6;  // T6_CERTIFIED
  if (score >= 800) return 5;  // T5_TRUSTED
  if (score >= 650) return 4;  // T4_STANDARD
  if (score >= 500) return 3;  // T3_MONITORED
  if (score >= 350) return 2;  // T2_PROVISIONAL
  if (score >= 200) return 1;  // T1_OBSERVED
  return 0;                    // T0_SANDBOX
}

/**
 * Get minimum score for a given tier
 */
export function tierToMinScore(tier: RuntimeTier): TrustScore {
  return TIER_TO_MIN_SCORE[tier] ?? 0;
}

/**
 * Convert competence level to ceiling tier
 */
export function competenceLevelToCeiling(level: CapabilityLevel): RuntimeTier {
  if (typeof level === 'number') {
    return Math.min(7, level) as RuntimeTier;
  }
  const levelMap: Record<string, RuntimeTier> = {
    none: 0,
    basic: 1,
    intermediate: 2,
    advanced: 3,
    expert: 4,
    master: 5,
    certified: 6,
    autonomous: 7,
  };
  return levelMap[String(level).toLowerCase()] ?? 2;
}

// ============================================================================
// Core CAR Integration Functions
// ============================================================================

/**
 * Determine which factor is limiting the effective tier
 */
export function determineCeilingReason(
  ctx: CARTrustContext,
  effectiveTier: RuntimeTier
): string | undefined {
  const certTierAsRuntime = certificationToRuntimeTier(ctx.certificationTier);

  if (effectiveTier === certTierAsRuntime) {
    if (!ctx.hasValidAttestation) {
      return 'Limited by lack of attestation (default T0)';
    }
    return 'Limited by attestation certification tier';
  }
  if (effectiveTier === competenceLevelToCeiling(ctx.competenceLevel)) {
    return 'Limited by competence level';
  }
  if (effectiveTier === ctx.runtimeTier) {
    return 'Limited by runtime behavioral trust';
  }
  if (effectiveTier === ctx.observabilityCeiling) {
    return 'Limited by observability class';
  }
  if (effectiveTier === ctx.contextPolicyCeiling) {
    return 'Limited by deployment context policy';
  }
  return undefined;
}

/**
 * Calculate effective permission from CAR context
 *
 * The effective tier is the minimum of:
 * 1. Certification tier (from attestations, NOT the CAR itself)
 * 2. Competence ceiling (what the agent's capability allows)
 * 3. Runtime tier (what behavioral signals indicate)
 * 4. Observability ceiling (what we can verify)
 * 5. Context policy ceiling (what the deployment allows)
 */
export function calculateEffectiveFromCAR(ctx: CARTrustContext): EffectivePermission {
  const effectiveTier = Math.min(
    certificationToRuntimeTier(ctx.certificationTier),
    competenceLevelToCeiling(ctx.competenceLevel),
    ctx.runtimeTier,
    ctx.observabilityCeiling,
    ctx.contextPolicyCeiling
  ) as RuntimeTier;

  logger.debug(
    {
      identity: ctx.identity,
      certificationTier: ctx.certificationTier,
      hasValidAttestation: ctx.hasValidAttestation,
      competenceCeiling: competenceLevelToCeiling(ctx.competenceLevel),
      runtimeTier: ctx.runtimeTier,
      observabilityCeiling: ctx.observabilityCeiling,
      contextPolicyCeiling: ctx.contextPolicyCeiling,
      effectiveTier,
    },
    'Calculated effective tier from CAR context'
  );

  return {
    tier: effectiveTier,
    score: tierToMinScore(effectiveTier),
    domains: [...ctx.operationalDomains],
    level: ctx.competenceLevel,
    ceilingReason: determineCeilingReason(ctx, effectiveTier),
  };
}

/** @deprecated Use calculateEffectiveFromCAR instead */
export const calculateEffectiveFromACI = calculateEffectiveFromCAR;

/**
 * Create a CAR Trust Context from a parsed CAR and attestation lookup.
 */
export function createCARTrustContext(
  parsedCAR: ParsedCAR,
  attestation: Attestation | null,
  runtimeScore: TrustScore,
  observabilityCeiling: RuntimeTier,
  contextCeiling: RuntimeTier
): CARTrustContext {
  const identity = getCARIdentity(parsedCAR);

  const certificationTier = attestation?.trustTier ?? DEFAULT_CERTIFICATION_TIER;
  const hasValidAttestation = attestation !== null && attestation.expiresAt > new Date();

  const runtimeTier = scoreToTier(runtimeScore);

  const effectiveTier = Math.min(
    certificationToRuntimeTier(certificationTier),
    competenceLevelToCeiling(parsedCAR.level),
    runtimeTier,
    observabilityCeiling,
    contextCeiling
  ) as RuntimeTier;

  const effectiveScore = calculateEffectiveScoreFromFactors(
    runtimeScore,
    certificationTier,
    observabilityCeiling,
    contextCeiling
  );

  return {
    car: parsedCAR,
    identity,
    competenceLevel: parsedCAR.level,
    operationalDomains: [...parsedCAR.domains],
    certificationTier,
    hasValidAttestation,
    attestationExpiresAt: attestation?.expiresAt,
    runtimeTier,
    runtimeScore,
    observabilityCeiling,
    contextPolicyCeiling: contextCeiling,
    effectiveTier,
    effectiveScore,
  };
}

/** @deprecated Use createCARTrustContext instead */
export const createACITrustContext = createCARTrustContext;

/**
 * Calculate effective score from multiple factors.
 */
function calculateEffectiveScoreFromFactors(
  runtimeScore: TrustScore,
  certificationTier: CertificationTier,
  observabilityCeiling: RuntimeTier,
  contextCeiling: RuntimeTier
): TrustScore {
  let score = applyCARFloor(runtimeScore, certificationTier);
  score = enforceCARCeiling(score, certificationTier);

  const observabilityMax = TIER_TO_MAX_SCORE[observabilityCeiling];
  score = Math.min(score, observabilityMax);

  const contextMax = TIER_TO_MAX_SCORE[contextCeiling];
  score = Math.min(score, contextMax);

  return score as TrustScore;
}

/**
 * Convert attestation to Vorion trust signal
 */
export function attestationToTrustSignal(attestation: Attestation): TrustSignal {
  return {
    id: crypto.randomUUID(),
    entityId: attestation.subject,
    type: 'ATTESTATION',
    value: certificationTierToScore(attestation.trustTier),
    weight: 1.0,
    source: attestation.issuer,
    timestamp: attestation.issuedAt.toISOString(),
    metadata: {
      scope: attestation.scope,
      expiresAt: attestation.expiresAt.toISOString(),
      evidence: attestation.evidence,
      attestationId: attestation.id,
    },
  };
}

/**
 * Apply CAR floor to runtime trust
 *
 * An agent with T3 certification starts at minimum T3 score.
 * The certification tier provides a "floor".
 */
export function applyCARFloor(
  runtimeScore: TrustScore,
  certificationTier: CertificationTier
): TrustScore {
  const floorScore = certificationTierToMinScore(certificationTier);
  const result = Math.max(runtimeScore, floorScore);

  if (result > runtimeScore) {
    logger.debug(
      { runtimeScore, floorScore, result, certificationTier },
      'Applied CAR floor to runtime score'
    );
  }

  return result as TrustScore;
}

/** @deprecated Use applyCARFloor instead */
export const applyACIFloor = applyCARFloor;

/**
 * Enforce CAR ceiling on runtime trust
 *
 * Runtime cannot exceed what the agent is certified for.
 */
export function enforceCARCeiling(
  runtimeScore: TrustScore,
  certificationTier: CertificationTier
): TrustScore {
  const ceilingScore = certificationTierToMaxScore(certificationTier);
  const result = Math.min(runtimeScore, ceilingScore);

  if (result < runtimeScore) {
    logger.debug(
      { runtimeScore, ceilingScore, result, certificationTier },
      'Enforced CAR ceiling on runtime score'
    );
  }

  return result as TrustScore;
}

/** @deprecated Use enforceCARCeiling instead */
export const enforceACICeiling = enforceCARCeiling;

/**
 * Calculate effective tier combining multiple factors
 */
export function calculateEffectiveTier(
  certificationTier: CertificationTier,
  competenceLevel: CapabilityLevel,
  runtimeTier: RuntimeTier,
  observabilityCeiling: RuntimeTier,
  contextCeiling: RuntimeTier
): RuntimeTier {
  return Math.min(
    certificationToRuntimeTier(certificationTier),
    competenceLevelToCeiling(competenceLevel),
    runtimeTier,
    observabilityCeiling,
    contextCeiling
  ) as RuntimeTier;
}

/**
 * Calculate effective score combining multiple factors
 */
export function calculateEffectiveScore(
  certificationTier: CertificationTier,
  runtimeScore: TrustScore,
  observabilityCeiling: RuntimeTier,
  contextCeiling: RuntimeTier
): TrustScore {
  let score = applyCARFloor(runtimeScore, certificationTier);
  score = enforceCARCeiling(score, certificationTier);

  const observabilityMax = TIER_TO_MAX_SCORE[observabilityCeiling];
  score = Math.min(score, observabilityMax);

  const contextMax = TIER_TO_MAX_SCORE[contextCeiling];
  score = Math.min(score, contextMax);

  return score as TrustScore;
}

/**
 * Look up the certification tier for a CAR identity from attestations.
 */
export function lookupCertificationTier(
  identity: CARIdentity,
  attestations: Attestation[]
): CertificationTier {
  const now = new Date();

  const validAttestations = attestations.filter(
    (a) => a.subject === identity && a.expiresAt > now
  );

  if (validAttestations.length === 0) {
    logger.debug({ identity }, 'No valid attestations found, using default tier');
    return DEFAULT_CERTIFICATION_TIER;
  }

  const maxTier = Math.max(...validAttestations.map((a) => a.trustTier)) as CertificationTier;

  logger.debug(
    { identity, attestationCount: validAttestations.length, maxTier },
    'Found valid attestations for identity'
  );

  return maxTier;
}
