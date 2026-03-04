/**
 * Trust Banding - T0 to T7 trust bands with autonomy levels
 *
 * Trust bands map score ranges (0-1000) to autonomy levels:
 * - T0 (0-199): Sandbox - Isolated testing, no real operations
 * - T1 (200-349): Observed - Under active observation and supervision
 * - T2 (350-499): Provisional - Limited operations with strict constraints
 * - T3 (500-649): Monitored - Continuous monitoring with expanding freedom
 * - T4 (650-799): Standard - Trusted for routine operations
 * - T5 (800-875): Trusted - Expanded capabilities with minimal oversight
 * - T6 (876-950): Certified - Independent operation with audit trail
 * - T7 (951-1000): Autonomous - Full autonomy for mission-critical operations
 */

import { TrustBand, type BandThresholds, DEFAULT_BAND_THRESHOLDS } from '@vorionsys/contracts';

export { TrustBand, DEFAULT_BAND_THRESHOLDS };

/**
 * Get the trust band for a given score
 */
export function getBand(
  score: number,
  thresholds: BandThresholds = DEFAULT_BAND_THRESHOLDS
): TrustBand {
  if (score <= thresholds.T0.max) return TrustBand.T0_SANDBOX;
  if (score <= thresholds.T1.max) return TrustBand.T1_OBSERVED;
  if (score <= thresholds.T2.max) return TrustBand.T2_PROVISIONAL;
  if (score <= thresholds.T3.max) return TrustBand.T3_MONITORED;
  if (score <= thresholds.T4.max) return TrustBand.T4_STANDARD;
  if (score <= thresholds.T5.max) return TrustBand.T5_TRUSTED;
  if (score <= thresholds.T6.max) return TrustBand.T6_CERTIFIED;
  return TrustBand.T7_AUTONOMOUS;
}

/**
 * Get the score range for a band
 */
export function getBandRange(
  band: TrustBand,
  thresholds: BandThresholds = DEFAULT_BAND_THRESHOLDS
): { min: number; max: number } {
  switch (band) {
    case TrustBand.T0_SANDBOX:
      return thresholds.T0;
    case TrustBand.T1_OBSERVED:
      return thresholds.T1;
    case TrustBand.T2_PROVISIONAL:
      return thresholds.T2;
    case TrustBand.T3_MONITORED:
      return thresholds.T3;
    case TrustBand.T4_STANDARD:
      return thresholds.T4;
    case TrustBand.T5_TRUSTED:
      return thresholds.T5;
    case TrustBand.T6_CERTIFIED:
      return thresholds.T6;
    case TrustBand.T7_AUTONOMOUS:
      return thresholds.T7;
    default:
      return thresholds.T0;
  }
}

/**
 * Get band name (human readable)
 */
export function getBandName(band: TrustBand): string {
  switch (band) {
    case TrustBand.T0_SANDBOX:
      return 'Sandbox';
    case TrustBand.T1_OBSERVED:
      return 'Observed';
    case TrustBand.T2_PROVISIONAL:
      return 'Provisional';
    case TrustBand.T3_MONITORED:
      return 'Monitored';
    case TrustBand.T4_STANDARD:
      return 'Standard';
    case TrustBand.T5_TRUSTED:
      return 'Trusted';
    case TrustBand.T6_CERTIFIED:
      return 'Certified';
    case TrustBand.T7_AUTONOMOUS:
      return 'Autonomous';
    default:
      return 'Unknown';
  }
}

/**
 * Check if a band can be promoted to another
 */
export function canPromote(from: TrustBand, to: TrustBand): boolean {
  // Can only promote one level at a time
  return to === from + 1;
}

/**
 * Check if one band is higher than another
 */
export function isHigherBand(a: TrustBand, b: TrustBand): boolean {
  return a > b;
}

/**
 * Get the next band up (for promotion)
 */
export function getNextBand(band: TrustBand): TrustBand | null {
  if (band >= TrustBand.T7_AUTONOMOUS) return null;
  return (band + 1) as TrustBand;
}

/**
 * Get the previous band (for demotion)
 */
export function getPreviousBand(band: TrustBand): TrustBand | null {
  if (band <= TrustBand.T0_SANDBOX) return null;
  return (band - 1) as TrustBand;
}

/**
 * Band descriptions for documentation/UI
 */
export const BAND_DESCRIPTIONS: Record<TrustBand, {
  name: string;
  description: string;
  autonomyLevel: string;
  typicalCapabilities: string[];
}> = {
  [TrustBand.T0_SANDBOX]: {
    name: 'T0 - Sandbox',
    description: 'Isolated testing environment. No real operations allowed.',
    autonomyLevel: 'None',
    typicalCapabilities: [
      'Read-only data access',
      'Simulated operations only',
      'Informational responses only',
    ],
  },
  [TrustBand.T1_OBSERVED]: {
    name: 'T1 - Observed',
    description: 'Under active observation. All actions are supervised.',
    autonomyLevel: 'Minimal',
    typicalCapabilities: [
      'Prepare actions for review',
      'Suggest changes',
      'Execute approved read operations',
    ],
  },
  [TrustBand.T2_PROVISIONAL]: {
    name: 'T2 - Provisional',
    description: 'Limited operations with strict constraints and guardrails.',
    autonomyLevel: 'Limited',
    typicalCapabilities: [
      'Execute low-risk operations',
      'Write to non-critical systems',
      'Automated responses within templates',
    ],
  },
  [TrustBand.T3_MONITORED]: {
    name: 'T3 - Monitored',
    description: 'Continuous monitoring with expanding operational freedom.',
    autonomyLevel: 'Moderate',
    typicalCapabilities: [
      'Execute routine operations',
      'Make decisions within policy',
      'Access internal data',
    ],
  },
  [TrustBand.T4_STANDARD]: {
    name: 'T4 - Standard',
    description: 'Standard autonomy. Trusted for routine operations.',
    autonomyLevel: 'Standard',
    typicalCapabilities: [
      'Execute standard workflows',
      'Access business data',
      'Make routine decisions',
    ],
  },
  [TrustBand.T5_TRUSTED]: {
    name: 'T5 - Trusted',
    description: 'Expanded capabilities with minimal oversight required.',
    autonomyLevel: 'High',
    typicalCapabilities: [
      'Execute complex workflows',
      'Access sensitive data',
      'Make autonomous decisions',
    ],
  },
  [TrustBand.T6_CERTIFIED]: {
    name: 'T6 - Certified',
    description: 'Independent operation with comprehensive audit trail.',
    autonomyLevel: 'Very High',
    typicalCapabilities: [
      'Full system access',
      'Critical decision making',
      'Independent operation',
    ],
  },
  [TrustBand.T7_AUTONOMOUS]: {
    name: 'T7 - Autonomous',
    description: 'Full autonomy for mission-critical operations.',
    autonomyLevel: 'Full',
    typicalCapabilities: [
      'Unrestricted system access',
      'Autonomous mission-critical decisions',
      'Full operational authority',
    ],
  },
};
