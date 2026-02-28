/**
 * @vorionsys/shared-constants - Trust Tiers
 *
 * Single source of truth for the 8-tier trust model (T0-T7)
 * Used across all Vorion ecosystem products and sites
 *
 * @see https://basis.vorion.org/tiers
 */

// =============================================================================
// TRUST TIER ENUM
// =============================================================================

export enum TrustTier {
  T0_SANDBOX = 0,
  T1_OBSERVED = 1,
  T2_PROVISIONAL = 2,
  T3_MONITORED = 3,
  T4_STANDARD = 4,
  T5_TRUSTED = 5,
  T6_CERTIFIED = 6,
  T7_AUTONOMOUS = 7,
}

// =============================================================================
// TIER THRESHOLDS - SINGLE SOURCE OF TRUTH
// =============================================================================

export interface TierThreshold {
  readonly min: number;
  readonly max: number;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly textColor: string;
}

/**
 * Official tier thresholds for the BASIS trust model
 * All products MUST use these values for consistency
 */
export const TIER_THRESHOLDS: Readonly<Record<TrustTier, TierThreshold>> = {
  [TrustTier.T0_SANDBOX]: {
    min: 0,
    max: 199,
    name: "Sandbox",
    description: "Isolated, no external access, observation only",
    color: "#78716c",
    textColor: "#ffffff",
  },
  [TrustTier.T1_OBSERVED]: {
    min: 200,
    max: 349,
    name: "Observed",
    description: "Read-only, sandboxed execution, monitored",
    color: "#ef4444",
    textColor: "#ffffff",
  },
  [TrustTier.T2_PROVISIONAL]: {
    min: 350,
    max: 499,
    name: "Provisional",
    description: "Basic operations, heavy supervision",
    color: "#f97316",
    textColor: "#ffffff",
  },
  [TrustTier.T3_MONITORED]: {
    min: 500,
    max: 649,
    name: "Monitored",
    description: "Standard operations with continuous monitoring",
    color: "#eab308",
    textColor: "#000000",
  },
  [TrustTier.T4_STANDARD]: {
    min: 650,
    max: 799,
    name: "Standard",
    description: "External API access, policy-governed",
    color: "#22c55e",
    textColor: "#ffffff",
  },
  [TrustTier.T5_TRUSTED]: {
    min: 800,
    max: 875,
    name: "Trusted",
    description: "Cross-agent communication, delegated tasks",
    color: "#3b82f6",
    textColor: "#ffffff",
  },
  [TrustTier.T6_CERTIFIED]: {
    min: 876,
    max: 950,
    name: "Certified",
    description: "Admin tasks, agent spawning, minimal oversight",
    color: "#8b5cf6",
    textColor: "#ffffff",
  },
  [TrustTier.T7_AUTONOMOUS]: {
    min: 951,
    max: 1000,
    name: "Autonomous",
    description: "Full autonomy, self-governance, strategic only",
    color: "#06b6d4",
    textColor: "#ffffff",
  },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert a trust score (0-1000) to a trust tier
 */
export function scoreToTier(score: number): TrustTier {
  if (score < 0 || score > 1000) {
    throw new Error(`Trust score must be between 0 and 1000, got ${score}`);
  }

  if (score >= 951) return TrustTier.T7_AUTONOMOUS;
  if (score >= 876) return TrustTier.T6_CERTIFIED;
  if (score >= 800) return TrustTier.T5_TRUSTED;
  if (score >= 650) return TrustTier.T4_STANDARD;
  if (score >= 500) return TrustTier.T3_MONITORED;
  if (score >= 350) return TrustTier.T2_PROVISIONAL;
  if (score >= 200) return TrustTier.T1_OBSERVED;
  return TrustTier.T0_SANDBOX;
}

/**
 * Get tier threshold configuration
 */
export function getTierThreshold(tier: TrustTier): TierThreshold {
  return TIER_THRESHOLDS[tier];
}

/**
 * Get human-readable tier name
 */
export function getTierName(tier: TrustTier): string {
  return TIER_THRESHOLDS[tier].name;
}

/**
 * Get tier display color
 */
export function getTierColor(tier: TrustTier): string {
  return TIER_THRESHOLDS[tier].color;
}

/**
 * Get minimum score required for a tier
 */
export function getTierMinScore(tier: TrustTier): number {
  return TIER_THRESHOLDS[tier].min;
}

/**
 * Get maximum score for a tier
 */
export function getTierMaxScore(tier: TrustTier): number {
  return TIER_THRESHOLDS[tier].max;
}

/**
 * Check if a score meets the minimum tier requirement
 */
export function meetsTierRequirement(
  score: number,
  minTier: TrustTier,
): boolean {
  const actualTier = scoreToTier(score);
  return actualTier >= minTier;
}

/**
 * Get tier short code (T0, T1, etc.)
 */
export function getTierCode(tier: TrustTier): string {
  return `T${tier}`;
}

/**
 * Parse tier from string (e.g., "T3", "3", "MONITORED")
 */
export function parseTier(input: string): TrustTier | null {
  const normalized = input.toUpperCase().trim();

  // Try T# format
  const tMatch = normalized.match(/^T?(\d)$/);
  if (tMatch) {
    const num = parseInt(tMatch[1], 10);
    if (num >= 0 && num <= 7) {
      return num as TrustTier;
    }
  }

  // Try name format
  const nameMap: Record<string, TrustTier> = {
    SANDBOX: TrustTier.T0_SANDBOX,
    OBSERVED: TrustTier.T1_OBSERVED,
    PROVISIONAL: TrustTier.T2_PROVISIONAL,
    MONITORED: TrustTier.T3_MONITORED,
    STANDARD: TrustTier.T4_STANDARD,
    TRUSTED: TrustTier.T5_TRUSTED,
    CERTIFIED: TrustTier.T6_CERTIFIED,
    AUTONOMOUS: TrustTier.T7_AUTONOMOUS,
  };

  return nameMap[normalized] ?? null;
}

/**
 * Get all tiers in order
 */
export const ALL_TIERS: readonly TrustTier[] = [
  TrustTier.T0_SANDBOX,
  TrustTier.T1_OBSERVED,
  TrustTier.T2_PROVISIONAL,
  TrustTier.T3_MONITORED,
  TrustTier.T4_STANDARD,
  TrustTier.T5_TRUSTED,
  TrustTier.T6_CERTIFIED,
  TrustTier.T7_AUTONOMOUS,
] as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type TrustTierName =
  | "Sandbox"
  | "Observed"
  | "Provisional"
  | "Monitored"
  | "Standard"
  | "Trusted"
  | "Certified"
  | "Autonomous";

export type TrustTierCode =
  | "T0"
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7";
