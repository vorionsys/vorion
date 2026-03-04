/**
 * Trust Calculator - Core trust scoring engine
 *
 * Calculates composite trust scores from factor scores,
 * applying observation tier ceilings and decay over time.
 *
 * Uses the 16-factor trust model where each factor is scored 0.0-1.0
 * and the composite score is the average of all factor scores x 1000.
 */

import { v4 as uuidv4 } from 'uuid';

import { FACTOR_CODE_LIST } from '@vorionsys/basis';

import {
  OBSERVATION_CEILINGS,
  DEFAULT_BANDING_CONFIG,
} from '@vorionsys/contracts';

import { getBand } from '../banding/bands.js';

import type {
  TrustProfile,
  TrustFactorScores,
  TrustEvidence,
  ObservationTier,
} from '@vorionsys/contracts';

/** Default initial factor score for factors with no evidence (baseline) */
const INITIAL_FACTOR_SCORE = 0.5;

/**
 * Options for trust calculation
 */
export interface CalculationOptions {
  /** Current time (for decay calculations) */
  now?: Date;
  /** Apply time decay to evidence (evidence freshness weighting, NOT inactivity decay) */
  applyDecay?: boolean;
  /**
   * Evidence freshness decay rate per day (0.0 to 1.0).
   * Reduces the weight of older evidence in scoring calculations.
   * NOTE: This is NOT the same as trust inactivity decay (stepped milestones).
   * See DECAY_MILESTONES in trust-engine packages for inactivity decay.
   */
  decayRate?: number;
}

/**
 * Result of aggregating evidence into factor scores
 */
interface EvidenceAggregation {
  factorScores: TrustFactorScores;
  evidenceCount: number;
  latestEvidence: Date | null;
}

/**
 * Create initial factor scores with baseline values for all 16 factors
 */
function createInitialFactorScores(): TrustFactorScores {
  const scores: TrustFactorScores = {};
  for (const code of FACTOR_CODE_LIST) {
    scores[code] = INITIAL_FACTOR_SCORE;
  }
  return scores;
}

/**
 * Clamp a factor score to valid range [0.0, 1.0]
 */
function clampFactorScore(score: number): number {
  return Math.max(0.0, Math.min(1.0, score));
}

/**
 * Calculate a composite trust score from factor scores.
 * Composite = average of all factor scores x 1000.
 */
export function calculateCompositeScore(
  factorScores: TrustFactorScores
): number {
  const values = Object.values(factorScores);
  if (values.length === 0) return 0;

  const average = values.reduce((a, b) => a + b, 0) / values.length;
  // Round to 2 decimal places
  return Math.round(average * 1000 * 100) / 100;
}

/**
 * Apply observation tier ceiling to a score
 */
export function applyObservationCeiling(
  score: number,
  tier: ObservationTier
): number {
  const ceiling = OBSERVATION_CEILINGS[tier];
  return Math.min(score, ceiling);
}

/**
 * Aggregate evidence into factor scores
 */
export function aggregateEvidence(
  evidence: TrustEvidence[],
  options: CalculationOptions = {}
): EvidenceAggregation {
  const { now = new Date(), applyDecay = true, decayRate = DEFAULT_BANDING_CONFIG.decayRate } = options;

  // Collect impacts per factor code
  const factorImpacts: Record<string, number[]> = {};

  let latestEvidence: Date | null = null;

  for (const ev of evidence) {
    // Skip expired evidence
    if (ev.expiresAt && ev.expiresAt < now) {
      continue;
    }

    // Calculate decay factor if enabled
    let impact = ev.impact;
    if (applyDecay) {
      const daysSinceCollection = Math.max(
        0,
        (now.getTime() - ev.collectedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const decayFactor = Math.pow(1 - decayRate, daysSinceCollection);
      impact = ev.impact * decayFactor;
    }

    if (!factorImpacts[ev.factorCode]) {
      factorImpacts[ev.factorCode] = [];
    }
    factorImpacts[ev.factorCode]!.push(impact);

    if (!latestEvidence || ev.collectedAt > latestEvidence) {
      latestEvidence = ev.collectedAt;
    }
  }

  // Start with initial factor scores, then apply averaged impacts
  const factorScores = createInitialFactorScores();
  for (const [factorCode, impacts] of Object.entries(factorImpacts)) {
    if (impacts.length > 0) {
      const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
      // Impacts are on -1000 to +1000 scale; factor scores are 0.0-1.0
      // Convert impact to factor score delta: impact / 1000
      const baseline = factorScores[factorCode] ?? INITIAL_FACTOR_SCORE;
      factorScores[factorCode] = clampFactorScore(baseline + avgImpact / 1000);
    }
  }

  return {
    factorScores,
    evidenceCount: evidence.length,
    latestEvidence,
  };
}

/**
 * Calculate a complete trust profile for an agent
 */
export function calculateTrustProfile(
  agentId: string,
  observationTier: ObservationTier,
  evidence: TrustEvidence[],
  options: CalculationOptions = {}
): TrustProfile {
  const now = options.now ?? new Date();

  // Aggregate evidence into factor scores
  const aggregation = aggregateEvidence(evidence, options);
  const factorScores = aggregation.factorScores;

  // Calculate composite score (average of factor scores x 1000)
  const compositeScore = calculateCompositeScore(factorScores);

  // Apply observation ceiling
  const adjustedScore = applyObservationCeiling(compositeScore, observationTier);

  // Determine trust band
  const band = getBand(adjustedScore);

  return {
    profileId: uuidv4(),
    agentId,
    factorScores,
    compositeScore,
    observationTier,
    adjustedScore,
    band,
    calculatedAt: now,
    evidence,
    version: 1,
  };
}

/**
 * Recalculate trust profile with additional evidence
 */
export function recalculateProfile(
  existingProfile: TrustProfile,
  newEvidence: TrustEvidence[],
  options: CalculationOptions = {}
): TrustProfile {
  // Combine existing and new evidence
  const allEvidence = [...existingProfile.evidence, ...newEvidence];

  // Recalculate from scratch
  const newProfile = calculateTrustProfile(
    existingProfile.agentId,
    existingProfile.observationTier,
    allEvidence,
    options
  );

  return {
    ...newProfile,
    version: existingProfile.version + 1,
  };
}

/**
 * Apply time decay to a profile without adding new evidence
 */
export function applyDecay(
  profile: TrustProfile,
  options: CalculationOptions = {}
): TrustProfile {
  return calculateTrustProfile(
    profile.agentId,
    profile.observationTier,
    profile.evidence,
    {
      ...options,
      applyDecay: true,
    }
  );
}

/**
 * Create evidence for a trust factor
 */
export function createEvidence(
  factorCode: string,
  impact: number,
  source: string,
  metadata?: Record<string, unknown>
): TrustEvidence {
  return {
    evidenceId: uuidv4(),
    factorCode,
    impact: Math.max(-1000, Math.min(1000, impact)),
    source,
    collectedAt: new Date(),
    metadata,
  };
}
