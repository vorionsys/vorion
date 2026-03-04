/**
 * Trust Weights - DEPRECATED
 *
 * The 16-factor trust model no longer uses per-dimension weights.
 * The composite score is computed as: average of all factor scores * 1000.
 *
 * This module provides backwards-compatible stubs so existing code
 * that imports weight utilities can still compile. All weight-related
 * functions are no-ops or return empty/default values.
 *
 * @deprecated Weights have been removed from the trust model.
 * The composite score is now: (sum of factor scores / count) * 1000.
 */

import { computeCompositeScore } from './dimensions.js';

/**
 * @deprecated No longer used. Composite score is average of factor scores * 1000.
 */
export const DEFAULT_TRUST_WEIGHTS = {};

/**
 * @deprecated Weights are no longer part of the trust model.
 * Returns the input unchanged since there are no weights to apply.
 */
export function createWeights(partial: Record<string, number> = {}): Record<string, number> {
  return { ...partial };
}

/**
 * @deprecated Weights are no longer part of the trust model.
 * Returns the input unchanged.
 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  return { ...weights };
}

/**
 * @deprecated Weights are no longer part of the trust model.
 * Always returns true.
 */
export function validateWeights(_weights: unknown): Record<string, number> {
  if (typeof _weights === 'object' && _weights !== null) {
    return _weights as Record<string, number>;
  }
  return {};
}

/**
 * @deprecated Weights are no longer part of the trust model.
 * Always returns true.
 */
export function isValidWeights(_weights: unknown): boolean {
  return true;
}

/**
 * @deprecated Weights are no longer part of the trust model.
 * Always returns true.
 */
export function weightsAreSummedCorrectly(_weights: Record<string, number>): boolean {
  return true;
}

/**
 * @deprecated Weights have been removed. Use computeCompositeScore from dimensions.ts instead.
 */
export const WEIGHT_PRESETS: Record<string, Record<string, number>> = {};

/**
 * @deprecated Weights have been removed. Returns empty object.
 */
export function getWeightPreset(_name: string): Record<string, number> {
  return {};
}

/**
 * @deprecated Weights have been removed. Returns empty array.
 */
export function listWeightPresets(): string[] {
  return [];
}

// Re-export computeCompositeScore for convenience during migration
export { computeCompositeScore };
