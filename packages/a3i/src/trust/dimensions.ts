/**
 * Trust Factor Scores - The 16-factor trust model
 *
 * Replaces the legacy 5-dimension model (CT, BT, GT, XT, AC) with
 * 16 granular trust factors scored 0.0-1.0.
 *
 * Factor codes:
 *   CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE,
 *   CT-SEC, CT-PRIV, CT-ID, OP-HUMAN, OP-ALIGN, OP-CONTEXT,
 *   OP-STEW, SF-HUM, SF-ADAPT, SF-LEARN
 *
 * Composite score = average of all factor scores * 1000 (0-1000 scale)
 */

import { FACTOR_CODE_LIST } from '@vorionsys/basis';
import { trustFactorScoresSchema } from '@vorionsys/contracts/validators';

import type { TrustFactorScores } from '@vorionsys/contracts';

/** The 16 core trust factor codes (re-exported from @vorionsys/basis) */
export const TRUST_FACTOR_CODES = FACTOR_CODE_LIST;

/** Initial factor scores for a new agent (neutral starting point, all 0.3) */
export const INITIAL_FACTOR_SCORES: TrustFactorScores = Object.fromEntries(
  TRUST_FACTOR_CODES.map((code) => [code, 0.3])
);

/**
 * @deprecated Use INITIAL_FACTOR_SCORES instead.
 * Provided for backwards compatibility with code that imports INITIAL_DIMENSIONS.
 */
export const INITIAL_DIMENSIONS: TrustFactorScores = INITIAL_FACTOR_SCORES;

/** Minimum valid factor score */
export const MIN_FACTOR_SCORE = 0.0;

/** Maximum valid factor score */
export const MAX_FACTOR_SCORE = 1.0;

/**
 * @deprecated Use MIN_FACTOR_SCORE instead.
 */
export const MIN_DIMENSION_SCORE = MIN_FACTOR_SCORE;

/**
 * @deprecated Use MAX_FACTOR_SCORE instead.
 */
export const MAX_DIMENSION_SCORE = MAX_FACTOR_SCORE;

/**
 * Create a new TrustFactorScores object with validation.
 * Merges provided scores with initial defaults and clamps all values to [0.0, 1.0].
 */
export function createFactorScores(
  partial: TrustFactorScores = {}
): TrustFactorScores {
  const merged: TrustFactorScores = {
    ...INITIAL_FACTOR_SCORES,
    ...partial,
  };

  // Clamp all scores to valid range
  const clamped: TrustFactorScores = {};
  for (const [key, value] of Object.entries(merged)) {
    clamped[key] = clampScore(value);
  }
  return clamped;
}

/**
 * @deprecated Use createFactorScores instead.
 * Provided for backwards compatibility with code that imports createDimensions.
 */
export const createDimensions = createFactorScores;

/**
 * Clamp a factor score to valid range [0.0, 1.0]
 */
export function clampScore(score: number): number {
  return Math.max(MIN_FACTOR_SCORE, Math.min(MAX_FACTOR_SCORE, score));
}

/**
 * Validate trust factor scores using Zod schema
 * @throws if validation fails
 */
export function validateFactorScores(scores: unknown): TrustFactorScores {
  return trustFactorScoresSchema.parse(scores);
}

/**
 * @deprecated Use validateFactorScores instead.
 */
export const validateDimensions = validateFactorScores;

/**
 * Check if factor scores are valid without throwing
 */
export function isValidFactorScores(
  scores: unknown
): scores is TrustFactorScores {
  return trustFactorScoresSchema.safeParse(scores).success;
}

/**
 * @deprecated Use isValidFactorScores instead.
 */
export const isValidDimensions = isValidFactorScores;

/**
 * Get the minimum factor score (weakest link)
 */
export function getMinFactor(scores: TrustFactorScores): {
  factor: string;
  score: number;
} {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { factor: '', score: 0 };
  }
  return entries.reduce(
    (acc, [key, value]) =>
      value < acc.score ? { factor: key, score: value } : acc,
    { factor: entries[0]![0], score: 1.0 }
  );
}

/**
 * @deprecated Use getMinFactor instead.
 */
export function getMinDimension(scores: TrustFactorScores): {
  dimension: string;
  score: number;
} {
  const result = getMinFactor(scores);
  return { dimension: result.factor, score: result.score };
}

/**
 * Get the maximum factor score (strongest area)
 */
export function getMaxFactor(scores: TrustFactorScores): {
  factor: string;
  score: number;
} {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { factor: '', score: 0 };
  }
  return entries.reduce(
    (acc, [key, value]) =>
      value > acc.score ? { factor: key, score: value } : acc,
    { factor: entries[0]![0], score: 0.0 }
  );
}

/**
 * @deprecated Use getMaxFactor instead.
 */
export function getMaxDimension(scores: TrustFactorScores): {
  dimension: string;
  score: number;
} {
  const result = getMaxFactor(scores);
  return { dimension: result.factor, score: result.score };
}

/**
 * Calculate factor score delta between two profiles
 */
export function getFactorDelta(
  previous: TrustFactorScores,
  current: TrustFactorScores
): TrustFactorScores {
  const delta: TrustFactorScores = {};
  const allKeys = new Set([
    ...Object.keys(previous),
    ...Object.keys(current),
  ]);
  for (const key of allKeys) {
    delta[key] = (current[key] ?? 0) - (previous[key] ?? 0);
  }
  return delta;
}

/**
 * @deprecated Use getFactorDelta instead.
 */
export const getDimensionDelta = getFactorDelta;

/**
 * Apply adjustments to factor scores
 */
export function adjustFactorScores(
  scores: TrustFactorScores,
  adjustments: Partial<TrustFactorScores>
): TrustFactorScores {
  const adjusted: TrustFactorScores = { ...scores };
  for (const [key, value] of Object.entries(adjustments)) {
    if (value !== undefined) {
      adjusted[key] = (scores[key] ?? 0) + value;
    }
  }
  return createFactorScores(adjusted);
}

/**
 * @deprecated Use adjustFactorScores instead.
 */
export const adjustDimensions = adjustFactorScores;

/**
 * Compute composite trust score from factor scores.
 * Composite = average of all factor scores * 1000 (0-1000 scale).
 */
export function computeCompositeScore(scores: TrustFactorScores): number {
  const values = Object.values(scores);
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(avg * 1000 * 100) / 100; // 2 decimal places on 0-1000 scale
}

/**
 * Factor descriptions for documentation/UI
 */
export const FACTOR_DESCRIPTIONS: Record<string, {
  name: string;
  code: string;
  description: string;
}> = {
  'CT-COMP': {
    name: 'Competence',
    code: 'CT-COMP',
    description: 'Ability to successfully complete tasks within defined conditions',
  },
  'CT-REL': {
    name: 'Reliability',
    code: 'CT-REL',
    description: 'Consistent, predictable behavior over time and under stress',
  },
  'CT-OBS': {
    name: 'Observability',
    code: 'CT-OBS',
    description: 'Real-time tracking of states and actions',
  },
  'CT-TRANS': {
    name: 'Transparency',
    code: 'CT-TRANS',
    description: 'Clear insights into decisions and reasoning',
  },
  'CT-ACCT': {
    name: 'Accountability',
    code: 'CT-ACCT',
    description: 'Traceable actions with clear responsibility attribution',
  },
  'CT-SAFE': {
    name: 'Safety',
    code: 'CT-SAFE',
    description: 'Respecting boundaries, avoiding harm, ensuring non-discrimination',
  },
  'CT-SEC': {
    name: 'Security',
    code: 'CT-SEC',
    description: 'Protection against threats, injections, unauthorized access',
  },
  'CT-PRIV': {
    name: 'Privacy',
    code: 'CT-PRIV',
    description: 'Secure data handling, regulatory compliance',
  },
  'CT-ID': {
    name: 'Identity',
    code: 'CT-ID',
    description: 'Unique, verifiable agent identifiers',
  },
  'OP-HUMAN': {
    name: 'Human Oversight',
    code: 'OP-HUMAN',
    description: 'Mechanisms for intervention and control',
  },
  'OP-ALIGN': {
    name: 'Alignment',
    code: 'OP-ALIGN',
    description: 'Goals and actions match human values',
  },
  'OP-CONTEXT': {
    name: 'Context Awareness',
    code: 'OP-CONTEXT',
    description: 'Awareness of operational context, environment, and situational appropriateness',
  },
  'OP-STEW': {
    name: 'Stewardship',
    code: 'OP-STEW',
    description: 'Efficient, responsible resource usage',
  },
  'SF-HUM': {
    name: 'Humility',
    code: 'SF-HUM',
    description: 'Recognizing limits, appropriate escalation',
  },
  'SF-ADAPT': {
    name: 'Adaptability',
    code: 'SF-ADAPT',
    description: 'Safe operation in dynamic/unknown environments',
  },
  'SF-LEARN': {
    name: 'Continuous Learning',
    code: 'SF-LEARN',
    description: 'Improving from experience without ethical drift',
  },
};

/**
 * @deprecated Use FACTOR_DESCRIPTIONS instead.
 * Legacy alias for backwards compatibility.
 */
export const DIMENSION_DESCRIPTIONS = FACTOR_DESCRIPTIONS;
