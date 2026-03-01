/**
 * @fileoverview Canonical TrustBand definitions for the Vorion Platform.
 *
 * This file provides the authoritative definition for trust bands (T0-T7),
 * including thresholds, conversion utilities, and Zod validation schemas.
 *
 * Trust bands represent discrete levels of autonomy granted to agents based
 * on their accumulated trust score. The system uses an 8-tier model with
 * variable divisions on a 0-1000 scale.
 *
 * @module @vorionsys/contracts/canonical/trust-band
 */

import { z } from 'zod';

/**
 * Trust bands representing agent autonomy levels.
 *
 * The 8-tier system (T0-T7) maps trust scores to discrete autonomy levels:
 * - T0: Sandbox - Isolated testing, no real operations
 * - T1: Observed - Under active observation and supervision
 * - T2: Provisional - Limited operations with strict constraints
 * - T3: Monitored - Continuous monitoring with expanding freedom
 * - T4: Standard - Trusted for routine operations
 * - T5: Trusted - Expanded capabilities with minimal oversight
 * - T6: Certified - Independent operation with audit trail
 * - T7: Autonomous - Full autonomy for mission-critical operations
 *
 * @enum {number}
 */
export enum TrustBand {
  /** Sandbox - Isolated testing environment, no real operations */
  T0_SANDBOX = 0,
  /** Observed - Under active observation and supervision */
  T1_OBSERVED = 1,
  /** Provisional - Limited operations with strict constraints */
  T2_PROVISIONAL = 2,
  /** Monitored - Continuous monitoring with expanding freedom */
  T3_MONITORED = 3,
  /** Standard - Trusted for routine operations */
  T4_STANDARD = 4,
  /** Trusted - Expanded capabilities with minimal oversight */
  T5_TRUSTED = 5,
  /** Certified - Independent operation with audit trail */
  T6_CERTIFIED = 6,
  /** Autonomous - Full autonomy for mission-critical operations */
  T7_AUTONOMOUS = 7,
}

/**
 * Threshold configuration for a single trust band.
 *
 * Defines the score range and human-readable label for a trust band.
 */
export interface TrustBandThreshold {
  /** Minimum score (inclusive) for this band */
  readonly min: number;
  /** Maximum score (inclusive) for this band */
  readonly max: number;
  /** Human-readable label for display */
  readonly label: string;
  /** Brief description of the autonomy level */
  readonly description: string;
}

/**
 * Trust band thresholds mapping each band to its score range.
 *
 * Uses a 0-1000 scale with variable divisions that tighten at higher tiers
 * to reflect the increasing difficulty of achieving higher trust levels.
 *
 * @constant
 */
export const TRUST_BAND_THRESHOLDS: Readonly<Record<TrustBand, TrustBandThreshold>> = {
  [TrustBand.T0_SANDBOX]: {
    min: 0,
    max: 199,
    label: 'Sandbox',
    description: 'Isolated testing environment - no real operations allowed',
  },
  [TrustBand.T1_OBSERVED]: {
    min: 200,
    max: 349,
    label: 'Observed',
    description: 'Under active observation - actions are supervised',
  },
  [TrustBand.T2_PROVISIONAL]: {
    min: 350,
    max: 499,
    label: 'Provisional',
    description: 'Limited operations - strict constraints and guardrails',
  },
  [TrustBand.T3_MONITORED]: {
    min: 500,
    max: 649,
    label: 'Monitored',
    description: 'Continuous monitoring - expanding operational freedom',
  },
  [TrustBand.T4_STANDARD]: {
    min: 650,
    max: 799,
    label: 'Standard',
    description: 'Standard autonomy - trusted for routine operations',
  },
  [TrustBand.T5_TRUSTED]: {
    min: 800,
    max: 875,
    label: 'Trusted',
    description: 'Expanded capabilities - minimal oversight required',
  },
  [TrustBand.T6_CERTIFIED]: {
    min: 876,
    max: 950,
    label: 'Certified',
    description: 'Independent operation - comprehensive audit trail',
  },
  [TrustBand.T7_AUTONOMOUS]: {
    min: 951,
    max: 1000,
    label: 'Autonomous',
    description: 'Full autonomy - mission-critical with autonomous decision-making',
  },
} as const;

/**
 * Array of all trust bands in ascending order.
 *
 * Useful for iteration and mapping operations.
 */
export const TRUST_BANDS = [
  TrustBand.T0_SANDBOX,
  TrustBand.T1_OBSERVED,
  TrustBand.T2_PROVISIONAL,
  TrustBand.T3_MONITORED,
  TrustBand.T4_STANDARD,
  TrustBand.T5_TRUSTED,
  TrustBand.T6_CERTIFIED,
  TrustBand.T7_AUTONOMOUS,
] as const;

/**
 * Converts a trust score (0-1000) to its corresponding trust band.
 *
 * Uses the canonical threshold boundaries defined in TRUST_BAND_THRESHOLDS.
 *
 * @param score - Trust score on 0-1000 scale
 * @returns The corresponding TrustBand
 * @throws {Error} If score is outside valid range (0-1000)
 *
 * @example
 * ```typescript
 * scoreToTrustBand(0);    // TrustBand.T0_SANDBOX
 * scoreToTrustBand(500);  // TrustBand.T3_MONITORED
 * scoreToTrustBand(975);  // TrustBand.T7_AUTONOMOUS
 * ```
 */
export function scoreToTrustBand(score: number): TrustBand {
  if (score < 0 || score > 1000) {
    throw new Error(`Trust score must be between 0 and 1000, got ${score}`);
  }

  if (score < 200) return TrustBand.T0_SANDBOX;
  if (score < 350) return TrustBand.T1_OBSERVED;
  if (score < 500) return TrustBand.T2_PROVISIONAL;
  if (score < 650) return TrustBand.T3_MONITORED;
  if (score < 800) return TrustBand.T4_STANDARD;
  if (score < 876) return TrustBand.T5_TRUSTED;
  if (score < 951) return TrustBand.T6_CERTIFIED;
  return TrustBand.T7_AUTONOMOUS;
}

/**
 * Converts a trust band to its midpoint score.
 *
 * Returns the midpoint of the band's score range, useful for
 * initializing agents at a given trust level.
 *
 * @param band - The trust band to convert
 * @returns The midpoint score for the band (0-1000 scale)
 *
 * @example
 * ```typescript
 * trustBandToScore(TrustBand.T0_SANDBOX);   // 100
 * trustBandToScore(TrustBand.T4_STANDARD);  // 725
 * trustBandToScore(TrustBand.T7_AUTONOMOUS); // 976
 * ```
 */
export function trustBandToScore(band: TrustBand): number {
  const threshold = TRUST_BAND_THRESHOLDS[band];
  return Math.round((threshold.min + threshold.max) / 2);
}

/**
 * Gets the minimum score required to achieve a trust band.
 *
 * @param band - The target trust band
 * @returns The minimum score needed to reach this band
 *
 * @example
 * ```typescript
 * getTrustBandMinScore(TrustBand.T4_STANDARD);  // 650
 * getTrustBandMinScore(TrustBand.T7_AUTONOMOUS); // 951
 * ```
 */
export function getTrustBandMinScore(band: TrustBand): number {
  return TRUST_BAND_THRESHOLDS[band].min;
}

/**
 * Gets the maximum score for a trust band.
 *
 * @param band - The target trust band
 * @returns The maximum score within this band
 *
 * @example
 * ```typescript
 * getTrustBandMaxScore(TrustBand.T0_SANDBOX);   // 199
 * getTrustBandMaxScore(TrustBand.T7_AUTONOMOUS); // 1000
 * ```
 */
export function getTrustBandMaxScore(band: TrustBand): number {
  return TRUST_BAND_THRESHOLDS[band].max;
}

/**
 * Gets the human-readable label for a trust band.
 *
 * @param band - The trust band
 * @returns Human-readable label string
 *
 * @example
 * ```typescript
 * getTrustBandLabel(TrustBand.T4_STANDARD); // "Standard"
 * ```
 */
export function getTrustBandLabel(band: TrustBand): string {
  return TRUST_BAND_THRESHOLDS[band].label;
}

/**
 * Gets the description for a trust band.
 *
 * @param band - The trust band
 * @returns Description of the autonomy level
 */
export function getTrustBandDescription(band: TrustBand): string {
  return TRUST_BAND_THRESHOLDS[band].description;
}

/**
 * Checks if a given band is higher (more trusted) than another.
 *
 * @param band - The band to check
 * @param otherBand - The band to compare against
 * @returns True if band is higher than otherBand
 *
 * @example
 * ```typescript
 * isTrustBandHigher(TrustBand.T5_TRUSTED, TrustBand.T2_PROVISIONAL); // true
 * isTrustBandHigher(TrustBand.T1_OBSERVED, TrustBand.T4_STANDARD); // false
 * ```
 */
export function isTrustBandHigher(band: TrustBand, otherBand: TrustBand): boolean {
  return band > otherBand;
}

/**
 * Checks if a given band meets or exceeds a required minimum band.
 *
 * @param band - The band to check
 * @param requiredBand - The minimum required band
 * @returns True if band meets or exceeds the requirement
 *
 * @example
 * ```typescript
 * meetsMinimumTrustBand(TrustBand.T5_TRUSTED, TrustBand.T4_STANDARD); // true
 * meetsMinimumTrustBand(TrustBand.T2_PROVISIONAL, TrustBand.T4_STANDARD); // false
 * ```
 */
export function meetsMinimumTrustBand(band: TrustBand, requiredBand: TrustBand): boolean {
  return band >= requiredBand;
}

// Note: isTrustBand type guard is exported from canonical/validation.ts to avoid duplication
// Note: trustScoreSchema is exported from canonical/trust-score.ts with branded type transformation

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for TrustBand enum validation.
 *
 * Validates that a value is a valid TrustBand enum member.
 *
 * @example
 * ```typescript
 * trustBandSchema.parse(TrustBand.T4_STANDARD); // Success
 * trustBandSchema.parse(4); // Success
 * trustBandSchema.parse(8); // Throws ZodError
 * ```
 */
export const trustBandSchema = z.nativeEnum(TrustBand, {
  errorMap: () => ({ message: 'Invalid trust band. Must be T0-T7 (0-7).' }),
});

/**
 * Zod schema for TrustBandThreshold validation.
 */
export const trustBandThresholdSchema = z.object({
  min: z.number().int().min(0).max(1000),
  max: z.number().int().min(0).max(1000),
  label: z.string().min(1),
  description: z.string().min(1),
}).refine(
  (data) => data.min <= data.max,
  { message: 'min must be less than or equal to max' }
);

/**
 * Zod schema for validating band comparison requests.
 */
export const bandComparisonSchema = z.object({
  band: trustBandSchema,
  otherBand: trustBandSchema,
});
