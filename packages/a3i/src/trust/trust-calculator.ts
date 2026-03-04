/**
 * TrustCalculator Class - Core trust scoring engine
 *
 * Provides a stateful calculator for computing and managing
 * trust scores with proper evidence handling and decay.
 *
 * Uses the 16-factor trust model where each factor is scored 0.0-1.0
 * and the composite score is the average of all factor scores x 1000.
 */

import { v4 as uuidv4 } from 'uuid';
import { FACTOR_CODE_LIST } from '@vorionsys/basis';

import {
  DEFAULT_BANDING_CONFIG,
  OBSERVATION_CEILINGS,
  EVIDENCE_TYPE_MULTIPLIERS,
} from '@vorionsys/contracts';

import { getBand } from '../banding/bands.js';
import { HysteresisCalculator } from '../banding/hysteresis.js';

import type {
  TrustProfile,
  TrustFactorScores,
  TrustEvidence,
  ObservationTier,
  BandingConfig,
  EvidenceType,
} from '@vorionsys/contracts';

/** Default initial factor score for factors with no evidence (baseline) */
const INITIAL_FACTOR_SCORE = 0.5;

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
 * Configuration for the TrustCalculator
 */
export interface TrustCalculatorConfig {
  /** Banding configuration */
  bandingConfig?: Partial<BandingConfig>;
  /** Enable time decay */
  enableDecay?: boolean;
  /** Decay rate per day (0.0 to 1.0) */
  decayRate?: number;
  /** Maximum age of evidence in days before it's ignored */
  maxEvidenceAgeDays?: number;
  /**
   * Enable evidence type weighting
   * HITL approvals weighted 5x, examinations 3x, etc.
   * @default true
   */
  enableEvidenceTypeWeighting?: boolean;
  /**
   * Custom evidence type multipliers
   * Override default EVIDENCE_TYPE_MULTIPLIERS
   */
  evidenceTypeMultipliers?: Partial<Record<EvidenceType, number>>;
}

/**
 * Options for a single calculation
 */
export interface CalculateOptions {
  /** Override decay setting for this calculation */
  applyDecay?: boolean;
  /** Current time (for testing) */
  now?: Date;
}

/**
 * Result of evidence aggregation
 */
export interface AggregationResult {
  factorScores: TrustFactorScores;
  validEvidenceCount: number;
  expiredEvidenceCount: number;
  oldestEvidence: Date | null;
  newestEvidence: Date | null;
}

/**
 * TrustCalculator - Main trust scoring engine
 */
export class TrustCalculator {
  private readonly config: Required<TrustCalculatorConfig>;
  private readonly hysteresisCalculator: HysteresisCalculator;
  private readonly evidenceMultipliers: Record<EvidenceType, number>;

  constructor(config: TrustCalculatorConfig = {}) {
    this.config = {
      bandingConfig: { ...DEFAULT_BANDING_CONFIG, ...config.bandingConfig },
      enableDecay: config.enableDecay ?? true,
      decayRate: config.decayRate ?? DEFAULT_BANDING_CONFIG.decayRate,
      maxEvidenceAgeDays: config.maxEvidenceAgeDays ?? 365,
      enableEvidenceTypeWeighting: config.enableEvidenceTypeWeighting ?? true,
      evidenceTypeMultipliers: config.evidenceTypeMultipliers ?? {},
    };

    // Merge custom multipliers with defaults
    this.evidenceMultipliers = {
      ...EVIDENCE_TYPE_MULTIPLIERS,
      ...this.config.evidenceTypeMultipliers,
    };

    this.hysteresisCalculator = new HysteresisCalculator(this.config.bandingConfig);
  }

  /**
   * Calculate a new trust profile from evidence
   */
  calculate(
    agentId: string,
    observationTier: ObservationTier,
    evidence: TrustEvidence[],
    options: CalculateOptions = {}
  ): TrustProfile {
    const now = options.now ?? new Date();
    const applyDecay = options.applyDecay ?? this.config.enableDecay;

    // Aggregate evidence into factor scores
    const aggregation = this.aggregateEvidence(evidence, now, applyDecay);
    const factorScores = aggregation.factorScores;

    // Calculate composite score (average of factor scores x 1000)
    const compositeScore = this.computeCompositeScore(factorScores);

    // Apply observation ceiling
    const adjustedScore = this.applyCeiling(compositeScore, observationTier);

    // Determine trust band
    const band = getBand(adjustedScore, this.config.bandingConfig.thresholds);

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
   * Recalculate an existing profile with new evidence
   */
  recalculate(
    existingProfile: TrustProfile,
    newEvidence: TrustEvidence[],
    options: CalculateOptions = {}
  ): TrustProfile {
    const now = options.now ?? new Date();
    const applyDecay = options.applyDecay ?? this.config.enableDecay;

    // Combine all evidence
    const allEvidence = [...existingProfile.evidence, ...newEvidence];

    // Aggregate with decay
    const aggregation = this.aggregateEvidence(allEvidence, now, applyDecay);

    // Calculate new composite score
    const compositeScore = this.computeCompositeScore(aggregation.factorScores);

    // Apply observation ceiling
    const adjustedScore = this.applyCeiling(compositeScore, existingProfile.observationTier);

    // Calculate new band with hysteresis
    const band = this.hysteresisCalculator.calculateBandWithHysteresis(
      existingProfile.band,
      adjustedScore
    );

    return {
      profileId: uuidv4(),
      agentId: existingProfile.agentId,
      factorScores: aggregation.factorScores,
      compositeScore,
      observationTier: existingProfile.observationTier,
      adjustedScore,
      band,
      calculatedAt: now,
      evidence: allEvidence,
      version: existingProfile.version + 1,
    };
  }

  /**
   * Apply time decay to a profile without new evidence
   */
  applyDecay(
    profile: TrustProfile,
    options: { now?: Date } = {}
  ): TrustProfile {
    const now = options.now ?? new Date();

    // Re-aggregate with decay
    const aggregation = this.aggregateEvidence(profile.evidence, now, true);

    // Recalculate scores
    const compositeScore = this.computeCompositeScore(aggregation.factorScores);
    const adjustedScore = this.applyCeiling(compositeScore, profile.observationTier);

    // Apply hysteresis for band changes
    const band = this.hysteresisCalculator.calculateBandWithHysteresis(
      profile.band,
      adjustedScore
    );

    return {
      ...profile,
      profileId: uuidv4(),
      factorScores: aggregation.factorScores,
      compositeScore,
      adjustedScore,
      band,
      calculatedAt: now,
      version: profile.version + 1,
    };
  }

  /**
   * Compute the composite score from factor scores.
   * Composite = average of all factor scores x 1000.
   */
  computeCompositeScore(
    factorScores: TrustFactorScores
  ): number {
    // Validate factor scores
    this.validateFactorScores(factorScores);

    const values = Object.values(factorScores);
    if (values.length === 0) return 0;

    const average = values.reduce((a, b) => a + b, 0) / values.length;

    // Round to 2 decimal places
    return Math.round(average * 1000 * 100) / 100;
  }

  /**
   * Apply observation tier ceiling to a score
   */
  applyCeiling(score: number, tier: ObservationTier): number {
    const ceiling = OBSERVATION_CEILINGS[tier];
    return Math.min(score, ceiling);
  }

  /**
   * Aggregate evidence into factor scores
   */
  aggregateEvidence(
    evidence: TrustEvidence[],
    now: Date = new Date(),
    applyDecay: boolean = true
  ): AggregationResult {
    // Collect impacts per factor code
    const factorImpacts: Record<string, number[]> = {};

    let validCount = 0;
    let expiredCount = 0;
    let oldestEvidence: Date | null = null;
    let newestEvidence: Date | null = null;

    const maxAge = this.config.maxEvidenceAgeDays * 24 * 60 * 60 * 1000;

    for (const ev of evidence) {
      // Skip expired evidence
      if (ev.expiresAt && ev.expiresAt < now) {
        expiredCount++;
        continue;
      }

      // Skip evidence older than max age
      const age = now.getTime() - ev.collectedAt.getTime();
      if (age > maxAge) {
        expiredCount++;
        continue;
      }

      // Calculate impact with optional decay
      let impact = ev.impact;
      if (applyDecay) {
        const daysSinceCollection = age / (1000 * 60 * 60 * 24);
        const decayFactor = Math.pow(1 - this.config.decayRate, daysSinceCollection);
        impact = ev.impact * decayFactor;
      }

      // Apply evidence type multiplier to POSITIVE evidence only.
      // Negative evidence is never amplified by type multipliers — the tier-scaled
      // penalty formula (7-10x gainRate) is the sole amplification mechanism for failures.
      if (this.config.enableEvidenceTypeWeighting && impact > 0) {
        const evidenceType = ev.evidenceType ?? 'automated';
        const multiplier = this.evidenceMultipliers[evidenceType] ?? 1.0;
        impact = impact * multiplier;
      }

      if (!factorImpacts[ev.factorCode]) {
        factorImpacts[ev.factorCode] = [];
      }
      factorImpacts[ev.factorCode]!.push(impact);
      validCount++;

      // Track date range
      if (!oldestEvidence || ev.collectedAt < oldestEvidence) {
        oldestEvidence = ev.collectedAt;
      }
      if (!newestEvidence || ev.collectedAt > newestEvidence) {
        newestEvidence = ev.collectedAt;
      }
    }

    // Calculate final factor scores from impacts
    const factorScores = this.computeFactorScoresFromImpacts(factorImpacts);

    return {
      factorScores,
      validEvidenceCount: validCount,
      expiredEvidenceCount: expiredCount,
      oldestEvidence,
      newestEvidence,
    };
  }

  /**
   * Compute factor scores from impact arrays
   */
  private computeFactorScoresFromImpacts(
    impacts: Record<string, number[]>
  ): TrustFactorScores {
    const factorScores = createInitialFactorScores();

    for (const [factorCode, factorImpacts] of Object.entries(impacts)) {
      if (factorImpacts.length > 0) {
        // Use average of impacts
        const avgImpact = factorImpacts.reduce((a, b) => a + b, 0) / factorImpacts.length;
        // Impacts are on -1000 to +1000 scale; factor scores are 0.0-1.0
        // Convert impact to factor score delta: impact / 1000
        const baseline = factorScores[factorCode] ?? INITIAL_FACTOR_SCORE;
        factorScores[factorCode] = clampFactorScore(baseline + avgImpact / 1000);
      }
    }

    return factorScores;
  }

  /**
   * Validate factor score values
   */
  private validateFactorScores(factorScores: TrustFactorScores): void {
    for (const [key, value] of Object.entries(factorScores)) {
      if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(`Invalid factor score value for ${key}: ${value}`);
      }
      if (value < 0.0 || value > 1.0) {
        throw new Error(`Factor score ${key} out of range [0.0, 1.0]: ${value}`);
      }
    }
  }

  /**
   * Get the calculator configuration
   */
  getConfig(): Readonly<Required<TrustCalculatorConfig>> {
    return { ...this.config };
  }

  /**
   * Get the hysteresis calculator
   */
  getHysteresisCalculator(): HysteresisCalculator {
    return this.hysteresisCalculator;
  }
}

/**
 * Create a TrustCalculator with default configuration
 */
export function createTrustCalculator(
  config?: TrustCalculatorConfig
): TrustCalculator {
  return new TrustCalculator(config);
}
