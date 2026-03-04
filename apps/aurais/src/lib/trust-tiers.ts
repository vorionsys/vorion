/**
 * Trust Tier Utilities for Aurais UI
 *
 * Single source of truth for tier display in the Aurais app.
 * All tier logic delegates to @vorionsys/shared-constants (canonical 8-tier T0-T7).
 * This module adds Tailwind CSS class mappings for the Aurais dark theme.
 */

import {
  TrustTier,
  scoreToTier,
  TIER_THRESHOLDS,
  getTierName,
  ALL_TIERS,
  type TierThreshold,
  type TrustTierName,
} from '@vorionsys/shared-constants'

// Re-export canonical types and helpers
export { TrustTier, scoreToTier, TIER_THRESHOLDS, getTierName, ALL_TIERS }
export type { TierThreshold, TrustTierName }

// =============================================================================
// TAILWIND CSS MAPPINGS
// =============================================================================

export interface TierStyle {
  readonly name: string
  readonly color: string
  readonly bg: string
}

/**
 * Tailwind CSS classes for each trust tier in the Aurais dark theme
 */
export const TIER_STYLES: Readonly<Record<TrustTier, TierStyle>> = {
  [TrustTier.T0_SANDBOX]: { name: 'Sandbox', color: 'text-stone-400', bg: 'bg-stone-500/20' },
  [TrustTier.T1_OBSERVED]: { name: 'Observed', color: 'text-red-400', bg: 'bg-red-500/20' },
  [TrustTier.T2_PROVISIONAL]: { name: 'Provisional', color: 'text-orange-400', bg: 'bg-orange-500/20' },
  [TrustTier.T3_MONITORED]: { name: 'Monitored', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  [TrustTier.T4_STANDARD]: { name: 'Standard', color: 'text-green-400', bg: 'bg-green-500/20' },
  [TrustTier.T5_TRUSTED]: { name: 'Trusted', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  [TrustTier.T6_CERTIFIED]: { name: 'Certified', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  [TrustTier.T7_AUTONOMOUS]: { name: 'Autonomous', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
}

// =============================================================================
// LOOKUP HELPERS
// =============================================================================

/**
 * Map lowercase tier name (from API responses) to TrustTier enum
 */
const TIER_NAME_MAP: Record<string, TrustTier> = {
  sandbox: TrustTier.T0_SANDBOX,
  observed: TrustTier.T1_OBSERVED,
  provisional: TrustTier.T2_PROVISIONAL,
  monitored: TrustTier.T3_MONITORED,
  standard: TrustTier.T4_STANDARD,
  trusted: TrustTier.T5_TRUSTED,
  certified: TrustTier.T6_CERTIFIED,
  autonomous: TrustTier.T7_AUTONOMOUS,
}

/**
 * Get Tailwind styles from a trust score (0-1000)
 */
export function getTierStylesFromScore(score: number): TierStyle {
  const clamped = Math.max(0, Math.min(1000, score))
  return TIER_STYLES[scoreToTier(clamped)]
}

/**
 * Get Tailwind styles from a lowercase tier name (API response)
 */
export function getTierStylesFromName(name: string): TierStyle {
  const tier = TIER_NAME_MAP[name.toLowerCase()]
  return tier !== undefined ? TIER_STYLES[tier] : TIER_STYLES[TrustTier.T0_SANDBOX]
}

/**
 * Get TrustTier enum from a lowercase tier name (API response)
 */
export function parseTierName(name: string): TrustTier {
  return TIER_NAME_MAP[name.toLowerCase()] ?? TrustTier.T0_SANDBOX
}

/**
 * Get Tailwind text color class for a tier name (API response)
 */
export function getTierColor(name: string): string {
  return getTierStylesFromName(name).color
}

/**
 * Get tier key string (e.g., 'T0_SANDBOX') from score — for use as object key
 */
export function getTierKeyFromScore(score: number): keyof typeof TIER_STYLES {
  return scoreToTier(Math.max(0, Math.min(1000, score)))
}

// =============================================================================
// COMBINED TIER INFO (for pages that need styles + thresholds + descriptions)
// =============================================================================

export interface TierInfo extends TierStyle {
  readonly min: number
  readonly max: number
  readonly description: string
}

/**
 * Combined tier data: Tailwind styles + canonical thresholds + descriptions
 * Keyed by TrustTier enum for use with scoreToTier()
 */
export const TIER_INFO: Readonly<Record<TrustTier, TierInfo>> = Object.fromEntries(
  ALL_TIERS.map((tier) => [
    tier,
    {
      ...TIER_STYLES[tier],
      min: TIER_THRESHOLDS[tier].min,
      max: TIER_THRESHOLDS[tier].max,
      description: TIER_THRESHOLDS[tier].description,
    },
  ])
) as Record<TrustTier, TierInfo>
