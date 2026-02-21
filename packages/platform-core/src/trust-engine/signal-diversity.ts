/**
 * Signal Diversity Requirements for Trust Tier Promotion
 *
 * Prevents gaming by requiring diverse signal sources and types
 * before allowing tier promotion. Agents cannot inflate their trust
 * score from a single source or signal dimension.
 *
 * @packageDocumentation
 */

import type { TrustSignal as TrustSignalType, TrustLevel } from '../common/types.js';
import { CertificationTier } from '@vorionsys/contracts/car';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Signal diversity configuration
 */
export interface SignalDiversityConfig {
  /** Minimum unique signal sources required for each tier */
  minSourcesForTier: Record<TrustLevel, number>;
  /** Minimum signal dimensions (behavioral, compliance, identity, context) required */
  minDimensionsForTier: Record<TrustLevel, number>;
  /** Time window for diversity calculation (default: 30 days) */
  diversityWindowDays: number;
  /** Minimum signals per dimension to count as "covered" */
  minSignalsPerDimension: number;
}

/**
 * Default diversity requirements
 *
 * Higher tiers require more diverse signal sources to prevent
 * single-source trust inflation attacks.
 */
export const DEFAULT_DIVERSITY_CONFIG: SignalDiversityConfig = {
  minSourcesForTier: {
    0: 0, // T0 Sandbox: no requirements
    1: 1, // T1 Observed: at least 1 source
    2: 2, // T2 Provisional: at least 2 sources
    3: 2, // T3 Monitored: at least 2 sources
    4: 3, // T4 Standard: at least 3 sources
    5: 3, // T5 Trusted: at least 3 sources
    6: 4, // T6 Certified: at least 4 sources
    7: 4, // T7 Autonomous: at least 4 sources
  },
  minDimensionsForTier: {
    0: 0, // T0: no requirements
    1: 1, // T1: 1 dimension
    2: 2, // T2: 2 dimensions
    3: 3, // T3: 3 dimensions
    4: 4, // T4: all 4 dimensions
    5: 4, // T5: all 4 dimensions
    6: 4, // T6: all 4 dimensions
    7: 4, // T7: all 4 dimensions
  },
  diversityWindowDays: 30,
  minSignalsPerDimension: 2, // Need at least 2 signals to count as covered
};

// =============================================================================
// DIMENSION DETECTION
// =============================================================================

/** Trust signal dimensions */
export type SignalDimension = 'behavioral' | 'compliance' | 'identity' | 'context';

/** All signal dimensions */
export const ALL_DIMENSIONS: SignalDimension[] = [
  'behavioral',
  'compliance',
  'identity',
  'context',
];

/**
 * Extract dimension from signal type
 *
 * Signal types are expected to be prefixed with dimension, e.g.:
 * - "behavioral.action_success"
 * - "compliance.audit_passed"
 * - "identity.verification_complete"
 * - "context.environment_stable"
 */
export function getSignalDimension(signalType: string): SignalDimension | null {
  const prefix = signalType.split('.')[0];
  if (ALL_DIMENSIONS.includes(prefix as SignalDimension)) {
    return prefix as SignalDimension;
  }
  return null;
}

// =============================================================================
// DIVERSITY ANALYSIS
// =============================================================================

/**
 * Signal diversity analysis result
 */
export interface DiversityAnalysis {
  /** Unique sources found */
  uniqueSources: Set<string>;
  /** Dimensions covered (with sufficient signals) */
  coveredDimensions: Set<SignalDimension>;
  /** Signals per dimension */
  signalsPerDimension: Record<SignalDimension, number>;
  /** Total signals analyzed */
  totalSignals: number;
  /** Signals within the diversity window */
  signalsInWindow: number;
}

/**
 * Analyze signal diversity within a time window
 *
 * @param signals - All signals to analyze
 * @param config - Diversity configuration
 * @returns Diversity analysis results
 */
export function analyzeSignalDiversity(
  signals: TrustSignalType[],
  config: SignalDiversityConfig = DEFAULT_DIVERSITY_CONFIG
): DiversityAnalysis {
  const uniqueSources = new Set<string>();
  const coveredDimensions = new Set<SignalDimension>();
  const signalsPerDimension: Record<SignalDimension, number> = {
    behavioral: 0,
    compliance: 0,
    identity: 0,
    context: 0,
  };

  const now = Date.now();
  const windowMs = config.diversityWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  let signalsInWindow = 0;

  for (const signal of signals) {
    const signalTime = new Date(signal.timestamp).getTime();
    if (signalTime < cutoff) continue;

    signalsInWindow++;

    // Track unique sources
    if (signal.source) {
      uniqueSources.add(signal.source);
    }

    // Track dimension coverage
    const dimension = getSignalDimension(signal.type);
    if (dimension) {
      signalsPerDimension[dimension]++;
    }
  }

  // Determine which dimensions are "covered" (have enough signals)
  for (const dimension of ALL_DIMENSIONS) {
    if (signalsPerDimension[dimension] >= config.minSignalsPerDimension) {
      coveredDimensions.add(dimension);
    }
  }

  return {
    uniqueSources,
    coveredDimensions,
    signalsPerDimension,
    totalSignals: signals.length,
    signalsInWindow,
  };
}

// =============================================================================
// TIER PROMOTION VALIDATION
// =============================================================================

/**
 * Result of tier promotion validation
 */
export interface TierPromotionValidation {
  /** Whether the entity meets diversity requirements for target tier */
  valid: boolean;
  /** Current tier */
  currentTier: TrustLevel;
  /** Target tier */
  targetTier: TrustLevel;
  /** Gaps preventing promotion */
  gaps: string[];
  /** Details about current diversity */
  diversity: DiversityAnalysis;
  /** Requirements for target tier */
  requirements: {
    minSources: number;
    minDimensions: number;
  };
}

/**
 * Validate if an entity can be promoted to a target tier
 *
 * @param signals - Entity's trust signals
 * @param currentTier - Current trust tier
 * @param targetTier - Tier attempting to promote to
 * @param config - Diversity configuration
 * @returns Validation result with gaps if not valid
 */
export function validateTierPromotion(
  signals: TrustSignalType[],
  currentTier: TrustLevel,
  targetTier: TrustLevel,
  config: SignalDiversityConfig = DEFAULT_DIVERSITY_CONFIG
): TierPromotionValidation {
  // Same tier or demotion - no diversity check needed
  if (targetTier <= currentTier) {
    return {
      valid: true,
      currentTier,
      targetTier,
      gaps: [],
      diversity: analyzeSignalDiversity(signals, config),
      requirements: {
        minSources: config.minSourcesForTier[targetTier],
        minDimensions: config.minDimensionsForTier[targetTier],
      },
    };
  }

  const diversity = analyzeSignalDiversity(signals, config);
  const requiredSources = config.minSourcesForTier[targetTier];
  const requiredDimensions = config.minDimensionsForTier[targetTier];

  const gaps: string[] = [];

  // Check source diversity
  if (diversity.uniqueSources.size < requiredSources) {
    gaps.push(
      `Insufficient signal sources: have ${diversity.uniqueSources.size}, need ${requiredSources} for T${targetTier}`
    );
  }

  // Check dimension coverage
  if (diversity.coveredDimensions.size < requiredDimensions) {
    const missing = ALL_DIMENSIONS.filter((d) => !diversity.coveredDimensions.has(d));
    gaps.push(
      `Insufficient dimension coverage: have ${diversity.coveredDimensions.size}, need ${requiredDimensions}. Missing: ${missing.join(', ')}`
    );
  }

  return {
    valid: gaps.length === 0,
    currentTier,
    targetTier,
    gaps,
    diversity,
    requirements: {
      minSources: requiredSources,
      minDimensions: requiredDimensions,
    },
  };
}

/**
 * Calculate the maximum tier achievable given current signal diversity
 *
 * @param signals - Entity's trust signals
 * @param config - Diversity configuration
 * @returns Maximum tier that diversity requirements allow
 */
export function getMaxTierForDiversity(
  signals: TrustSignalType[],
  config: SignalDiversityConfig = DEFAULT_DIVERSITY_CONFIG
): TrustLevel {
  const diversity = analyzeSignalDiversity(signals, config);

  // Find highest tier where requirements are met
  for (let tier = 7 as TrustLevel; tier >= 0; tier--) {
    const requiredSources = config.minSourcesForTier[tier];
    const requiredDimensions = config.minDimensionsForTier[tier];

    if (
      diversity.uniqueSources.size >= requiredSources &&
      diversity.coveredDimensions.size >= requiredDimensions
    ) {
      return tier;
    }
  }

  return 0;
}

// =============================================================================
// CERTIFICATION TIER CONVERSION
// =============================================================================

/**
 * Convert TrustLevel to CertificationTier
 */
export function trustLevelToCertificationTier(level: TrustLevel): CertificationTier {
  const mapping: Record<TrustLevel, CertificationTier> = {
    0: CertificationTier.T0_SANDBOX,
    1: CertificationTier.T1_OBSERVED,
    2: CertificationTier.T2_PROVISIONAL,
    3: CertificationTier.T3_MONITORED,
    4: CertificationTier.T4_STANDARD,
    5: CertificationTier.T5_TRUSTED,
    6: CertificationTier.T6_CERTIFIED,
    7: CertificationTier.T7_AUTONOMOUS,
  };
  return mapping[level];
}

/**
 * Validate certification tier promotion using diversity
 *
 * @param signals - Entity's trust signals
 * @param currentTier - Current certification tier
 * @param targetTier - Target certification tier
 * @param config - Diversity configuration
 */
export function validateCertificationTierPromotion(
  signals: TrustSignalType[],
  currentTier: CertificationTier,
  targetTier: CertificationTier,
  config: SignalDiversityConfig = DEFAULT_DIVERSITY_CONFIG
): TierPromotionValidation {
  // Convert certification tiers to trust levels (they align 0-7)
  const currentLevel = Object.values(CertificationTier).indexOf(currentTier) as TrustLevel;
  const targetLevel = Object.values(CertificationTier).indexOf(targetTier) as TrustLevel;

  return validateTierPromotion(signals, currentLevel, targetLevel, config);
}

// =============================================================================
// DIVERSITY SCORE
// =============================================================================

/**
 * Calculate a diversity score (0-100) for an entity's signals
 *
 * Higher score = more diverse signal portfolio
 *
 * @param signals - Entity's trust signals
 * @param config - Diversity configuration
 * @returns Diversity score 0-100
 */
export function calculateDiversityScore(
  signals: TrustSignalType[],
  config: SignalDiversityConfig = DEFAULT_DIVERSITY_CONFIG
): number {
  const diversity = analyzeSignalDiversity(signals, config);

  // Max requirements for T7
  const maxSources = config.minSourcesForTier[7];
  const maxDimensions = config.minDimensionsForTier[7];

  // Source diversity (50% weight)
  const sourceScore = Math.min(diversity.uniqueSources.size / maxSources, 1) * 50;

  // Dimension coverage (50% weight)
  const dimensionScore = Math.min(diversity.coveredDimensions.size / maxDimensions, 1) * 50;

  return Math.round(sourceScore + dimensionScore);
}
