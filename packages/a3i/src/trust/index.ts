/**
 * A3I Trust Module
 *
 * Core trust scoring functionality including factor scores,
 * composite scoring, and calculation.
 */

// Factor Scores (16-factor model)
export {
  // New 16-factor API
  TRUST_FACTOR_CODES,
  INITIAL_FACTOR_SCORES,
  MIN_FACTOR_SCORE,
  MAX_FACTOR_SCORE,
  createFactorScores,
  clampScore,
  validateFactorScores,
  isValidFactorScores,
  getMinFactor,
  getMaxFactor,
  getFactorDelta,
  adjustFactorScores,
  computeCompositeScore,
  FACTOR_DESCRIPTIONS,
  // Deprecated aliases for backwards compatibility
  INITIAL_DIMENSIONS,
  MIN_DIMENSION_SCORE,
  MAX_DIMENSION_SCORE,
  createDimensions,
  validateDimensions,
  isValidDimensions,
  getMinDimension,
  getMaxDimension,
  getDimensionDelta,
  adjustDimensions,
  DIMENSION_DESCRIPTIONS,
} from './dimensions.js';

// Weights (deprecated - composite score is now average of factor scores * 1000)
export {
  DEFAULT_TRUST_WEIGHTS,
  createWeights,
  normalizeWeights,
  validateWeights,
  isValidWeights,
  weightsAreSummedCorrectly,
  WEIGHT_PRESETS,
  getWeightPreset,
  listWeightPresets,
} from './weights.js';

// Legacy calculator functions (for backwards compatibility)
export {
  type CalculationOptions,
  calculateCompositeScore,
  applyObservationCeiling,
  aggregateEvidence,
  calculateTrustProfile,
  recalculateProfile,
  applyDecay,
  createEvidence,
} from './calculator.js';

// TrustCalculator class (recommended)
export {
  TrustCalculator,
  createTrustCalculator,
  type TrustCalculatorConfig,
  type CalculateOptions,
  type AggregationResult,
} from './trust-calculator.js';

// Profile Store
export {
  type TrustProfileStore,
  type ProfileQueryOptions,
  type ProfileQueryFilter,
  type ProfileQueryResult,
  type ProfileHistoryEntry,
  InMemoryProfileStore,
  createInMemoryStore,
} from './profile-store.js';

// Profile Service
export {
  TrustProfileService,
  createProfileService,
  type ProfileServiceConfig,
  type CreateProfileOptions,
  type UpdateProfileOptions,
  type ProfileOperationResult,
} from './profile-service.js';

// Trust Dynamics (ATSF v2.0)
export {
  TrustDynamicsEngine,
  createTrustDynamicsEngine,
  type TrustUpdateResult,
  type TrustUpdateOptions,
} from './trust-dynamics.js';
