/**
 * Context-Aware Trust Decay Profiles
 *
 * Implements half-life based exponential decay with:
 * - Environment-aware profiles (volatile, standard, stable)
 * - Failure acceleration multipliers
 * - Entity-specific profile overrides
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Profile type names
 */
export type EnvironmentProfileType = "volatile" | "standard" | "stable";

/**
 * Environment profile configuration
 *
 * Defines decay characteristics for different operational contexts.
 */
export interface EnvironmentProfile {
  /** Profile type identifier */
  type: EnvironmentProfileType;

  /** Base half-life in days (time for score to decay to 50%) */
  baseHalfLifeDays: number;

  /** Multiplier applied per failure (exponential: multiplier^failureCount) */
  failureMultiplier: number;
}

/**
 * Detailed result from decay calculation
 */
export interface DecayCalculationResult {
  /** Final decayed score */
  decayedScore: number;

  /** Base decay factor before failure acceleration (0-1) */
  baseDecayFactor: number;

  /** Effective decay factor after failure acceleration */
  effectiveDecayFactor: number;

  /** Failure acceleration divisor (failureMultiplier^failureCount) */
  failureAcceleration: number;

  /** Name of profile used for calculation */
  profileUsed: EnvironmentProfileType;
}

/**
 * Configuration for decay profile resolution
 */
export interface DecayConfig {
  /** Enable automatic classification based on activity rate */
  autoClassification: boolean;

  /** Manual profile overrides by entity ID */
  overrideByAgentId: Map<string, EnvironmentProfile>;
}

/**
 * Options for creating a DecayConfig
 */
export interface DecayConfigOptions {
  autoClassification?: boolean;
  overrideByAgentId?: Map<string, EnvironmentProfile>;
}

// ============================================================================
// Default Profiles
// ============================================================================

/**
 * Default decay profiles for different environment types
 *
 * - **Volatile**: High-frequency trading, real-time systems
 *   - 30-day half-life (fast decay for frequently-used agents)
 *   - 4x failure multiplier (harsh penalties for failures)
 *
 * - **Standard**: General-purpose agents, typical workloads
 *   - 182-day half-life (~6 months)
 *   - 3x failure multiplier (moderate penalties)
 *
 * - **Stable**: Audit systems, compliance agents, infrequent operations
 *   - 365-day half-life (slow decay for long-running agents)
 *   - 2x failure multiplier (lenient penalties)
 */
export const DEFAULT_DECAY_PROFILES = {
  profiles: {
    volatile: {
      type: "volatile" as const,
      baseHalfLifeDays: 30,
      failureMultiplier: 4.0,
    },
    standard: {
      type: "standard" as const,
      baseHalfLifeDays: 182,
      failureMultiplier: 3.0,
    },
    stable: {
      type: "stable" as const,
      baseHalfLifeDays: 365,
      failureMultiplier: 2.0,
    },
  },
} as const;

// ============================================================================
// Core Decay Functions
// ============================================================================

/**
 * Calculate context-aware trust decay
 *
 * Uses exponential decay formula with half-life:
 * `score * (0.5 ^ (days / halfLife)) / (failureMultiplier ^ failureCount)`
 *
 * @param initialScore - Starting trust score (0-1000)
 * @param daysSinceLastAction - Days since last trust-relevant action
 * @param profile - Environment profile to use for decay calculation
 * @param failureCount - Number of recent failures (0 for no failures)
 * @returns Decayed trust score, floored at 0
 */
export function calculateContextAwareDecay(
  initialScore: number,
  daysSinceLastAction: number,
  profile: EnvironmentProfile,
  failureCount: number,
): number {
  // Calculate base decay factor using half-life formula
  // At half-life days, this equals 0.5 (50% remaining)
  const baseDecayFactor = Math.pow(
    0.5,
    daysSinceLastAction / profile.baseHalfLifeDays,
  );

  // Calculate failure acceleration (exponential penalty)
  // Treat negative failure counts as 0
  const effectiveFailures = Math.max(0, failureCount);
  const failureAcceleration = Math.pow(
    profile.failureMultiplier,
    effectiveFailures,
  );

  // Apply decay: score * baseFactor / failureAcceleration
  const decayedScore = (initialScore * baseDecayFactor) / failureAcceleration;

  // Floor at 0
  return Math.max(0, decayedScore);
}

/**
 * Calculate context-aware decay with detailed breakdown
 *
 * Returns full calculation details for debugging, logging, and analysis.
 *
 * @param initialScore - Starting trust score (0-1000)
 * @param daysSinceLastAction - Days since last trust-relevant action
 * @param profile - Environment profile to use
 * @param failureCount - Number of recent failures
 * @returns Detailed calculation result
 */
export function calculateContextAwareDecayWithDetails(
  initialScore: number,
  daysSinceLastAction: number,
  profile: EnvironmentProfile,
  failureCount: number,
): DecayCalculationResult {
  // Calculate base decay factor
  const baseDecayFactor = Math.pow(
    0.5,
    daysSinceLastAction / profile.baseHalfLifeDays,
  );

  // Calculate failure acceleration
  const effectiveFailures = Math.max(0, failureCount);
  const failureAcceleration = Math.pow(
    profile.failureMultiplier,
    effectiveFailures,
  );

  // Calculate effective decay factor (after failure penalty)
  const effectiveDecayFactor = baseDecayFactor / failureAcceleration;

  // Calculate final score
  const decayedScore = Math.max(0, initialScore * effectiveDecayFactor);

  return {
    decayedScore,
    baseDecayFactor,
    effectiveDecayFactor,
    failureAcceleration,
    profileUsed: profile.type,
  };
}

/**
 * Calculate days until score decays to target value
 *
 * Inverse of the decay formula to predict when a threshold will be reached.
 *
 * @param currentScore - Current trust score
 * @param targetScore - Target score to calculate time for
 * @param profile - Environment profile
 * @param failureCount - Number of recent failures
 * @returns Days until target is reached, or Infinity if unreachable
 */
export function calculateDaysUntilDecay(
  currentScore: number,
  targetScore: number,
  profile: EnvironmentProfile,
  failureCount: number,
): number {
  // If already at or below target, return Infinity (already there)
  if (currentScore <= targetScore) {
    return Infinity;
  }

  // If target is zero or negative, return Infinity (asymptotic)
  if (targetScore <= 0) {
    return Infinity;
  }

  // Calculate failure acceleration
  const effectiveFailures = Math.max(0, failureCount);
  const failureAcceleration = Math.pow(
    profile.failureMultiplier,
    effectiveFailures,
  );

  // Adjust current score for failure acceleration
  const effectiveCurrentScore = currentScore / failureAcceleration;

  // If effective current is already at or below target, return 0
  if (effectiveCurrentScore <= targetScore) {
    return 0;
  }

  // Solve for days: target = current * (0.5 ^ (days / halfLife))
  // target / current = 0.5 ^ (days / halfLife)
  // log(target / current) = (days / halfLife) * log(0.5)
  // days = halfLife * log(target / current) / log(0.5)
  const ratio = targetScore / effectiveCurrentScore;
  const days = (profile.baseHalfLifeDays * Math.log(ratio)) / Math.log(0.5);

  return Math.max(0, days);
}

// ============================================================================
// Profile Classification
// ============================================================================

/**
 * Activity rate thresholds for profile classification
 */
const ACTIVITY_THRESHOLDS = {
  volatile: 100, // >= 100 actions/day = volatile
  standard: 10, // >= 10 actions/day = standard
  // < 10 actions/day = stable
};

/**
 * Classify environment profile based on activity rate
 *
 * Automatically determines the appropriate decay profile based on
 * how frequently an agent performs trust-relevant actions.
 *
 * @param actionsPerDay - Average number of actions per day
 * @returns Appropriate environment profile
 */
export function classifyEnvironmentProfile(
  actionsPerDay: number,
): EnvironmentProfile {
  if (actionsPerDay >= ACTIVITY_THRESHOLDS.volatile) {
    return DEFAULT_DECAY_PROFILES.profiles.volatile;
  }

  if (actionsPerDay >= ACTIVITY_THRESHOLDS.standard) {
    return DEFAULT_DECAY_PROFILES.profiles.standard;
  }

  return DEFAULT_DECAY_PROFILES.profiles.stable;
}

/**
 * Get the appropriate profile for a specific entity
 *
 * Checks for manual overrides first, then falls back to
 * auto-classification or default profile.
 *
 * @param entityId - Entity identifier
 * @param actionsPerDay - Activity rate for auto-classification
 * @param config - Decay configuration with overrides
 * @returns Environment profile for the entity
 */
export function getProfileForEntity(
  entityId: string,
  actionsPerDay: number,
  config: DecayConfig,
): EnvironmentProfile {
  // Check for manual override first
  const override = config.overrideByAgentId.get(entityId);
  if (override) {
    return override;
  }

  // Use auto-classification if enabled
  if (config.autoClassification) {
    return classifyEnvironmentProfile(actionsPerDay);
  }

  // Default to standard profile
  return DEFAULT_DECAY_PROFILES.profiles.standard;
}

// ============================================================================
// Configuration Factory
// ============================================================================

/**
 * Create a decay configuration with defaults
 *
 * @param options - Configuration options
 * @returns Complete decay configuration
 */
export function createDecayConfig(
  options: DecayConfigOptions = {},
): DecayConfig {
  return {
    autoClassification: options.autoClassification ?? true,
    overrideByAgentId: options.overrideByAgentId ?? new Map(),
  };
}
