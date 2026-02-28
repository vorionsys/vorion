/**
 * @fileoverview CAR Certification Tiers and Vorion Runtime Tiers
 *
 * Defines two distinct tier systems with 8 levels (T0-T7):
 *
 * 1. **CertificationTier (T0-T7)**: External attestation status from CAR spec.
 *    Represents the level of external verification and certification an agent
 *    has received from certification authorities.
 *
 * 2. **RuntimeTier (T0-T7)**: Vorion deployment-specific autonomy levels.
 *    Represents the operational autonomy granted to an agent in a specific
 *    Vorion deployment context.
 *
 * These two systems are conceptually different but can be mapped to each other
 * for interoperability.
 *
 * @module @vorionsys/contracts/car/tiers
 */

import { z } from "zod";

// ============================================================================
// CAR ID Certification Tiers (T0-T7)
// ============================================================================

/**
 * CAR ID Certification Tiers representing external attestation status.
 *
 * These tiers indicate the level of external verification and certification
 * an agent has received from certification authorities:
 *
 * - T0: No external verification (Sandbox)
 * - T1: Basic observation period (Observed)
 * - T2: Initial capabilities verified (Provisional)
 * - T3: Continuous monitoring active (Monitored)
 * - T4: Standard certification achieved (Standard)
 * - T5: Full trust established (Trusted)
 * - T6: Third-party audit completed (Certified)
 * - T7: Highest assurance level (Autonomous)
 */
export enum CertificationTier {
  /** Sandbox - No external verification, isolated testing */
  T0_SANDBOX = 0,
  /** Observed - Basic observation period, identity registered */
  T1_OBSERVED = 1,
  /** Provisional - Initial capabilities verified */
  T2_PROVISIONAL = 2,
  /** Monitored - Continuous behavioral monitoring active */
  T3_MONITORED = 3,
  /** Standard - Standard certification achieved */
  T4_STANDARD = 4,
  /** Trusted - Full trust established through track record */
  T5_TRUSTED = 5,
  /** Certified - Independent third-party audit completed */
  T6_CERTIFIED = 6,
  /** Autonomous - Highest assurance level with full certification */
  T7_AUTONOMOUS = 7,
}

/**
 * Array of all certification tiers in ascending order.
 */
export const CERTIFICATION_TIERS = [
  CertificationTier.T0_SANDBOX,
  CertificationTier.T1_OBSERVED,
  CertificationTier.T2_PROVISIONAL,
  CertificationTier.T3_MONITORED,
  CertificationTier.T4_STANDARD,
  CertificationTier.T5_TRUSTED,
  CertificationTier.T6_CERTIFIED,
  CertificationTier.T7_AUTONOMOUS,
] as const;

/**
 * Zod schema for CertificationTier enum validation.
 */
export const certificationTierSchema = z.nativeEnum(CertificationTier, {
  errorMap: () => ({
    message: "Invalid certification tier. Must be T0-T7 (0-7).",
  }),
});

/**
 * Human-readable names for certification tiers.
 */
export const CERTIFICATION_TIER_NAMES: Readonly<
  Record<CertificationTier, string>
> = {
  [CertificationTier.T0_SANDBOX]: "Sandbox",
  [CertificationTier.T1_OBSERVED]: "Observed",
  [CertificationTier.T2_PROVISIONAL]: "Provisional",
  [CertificationTier.T3_MONITORED]: "Monitored",
  [CertificationTier.T4_STANDARD]: "Standard",
  [CertificationTier.T5_TRUSTED]: "Trusted",
  [CertificationTier.T6_CERTIFIED]: "Certified",
  [CertificationTier.T7_AUTONOMOUS]: "Autonomous",
} as const;

/**
 * Detailed descriptions for certification tiers.
 */
export const CERTIFICATION_TIER_DESCRIPTIONS: Readonly<
  Record<CertificationTier, string>
> = {
  [CertificationTier.T0_SANDBOX]:
    "Isolated sandbox environment. No external verification, all actions are simulated.",
  [CertificationTier.T1_OBSERVED]:
    "Basic observation period. Identity registered, behavior being monitored.",
  [CertificationTier.T2_PROVISIONAL]:
    "Provisional status. Initial capabilities verified, limited operations permitted.",
  [CertificationTier.T3_MONITORED]:
    "Continuous monitoring active. Ongoing verification of safe operation.",
  [CertificationTier.T4_STANDARD]:
    "Standard certification achieved. Can perform routine operations.",
  [CertificationTier.T5_TRUSTED]:
    "Full trust established. Proven track record of reliable behavior.",
  [CertificationTier.T6_CERTIFIED]:
    "Third-party certified. Independent audit completed, verified compliance.",
  [CertificationTier.T7_AUTONOMOUS]:
    "Highest assurance level. Full certification with autonomous authority.",
} as const;

/**
 * Trust score ranges for certification tiers (CAR ID spec scale: 0-1000).
 */
export const CERTIFICATION_TIER_SCORES: Readonly<
  Record<CertificationTier, { min: number; max: number }>
> = {
  [CertificationTier.T0_SANDBOX]: { min: 0, max: 199 },
  [CertificationTier.T1_OBSERVED]: { min: 200, max: 349 },
  [CertificationTier.T2_PROVISIONAL]: { min: 350, max: 499 },
  [CertificationTier.T3_MONITORED]: { min: 500, max: 649 },
  [CertificationTier.T4_STANDARD]: { min: 650, max: 799 },
  [CertificationTier.T5_TRUSTED]: { min: 800, max: 875 },
  [CertificationTier.T6_CERTIFIED]: { min: 876, max: 950 },
  [CertificationTier.T7_AUTONOMOUS]: { min: 951, max: 1000 },
} as const;

// ============================================================================
// Vorion Runtime Tiers (T0-T7)
// ============================================================================

/**
 * Vorion Runtime Tiers representing deployment-specific autonomy.
 *
 * These tiers indicate the operational autonomy granted to an agent
 * in a specific Vorion deployment context:
 *
 * - T0: Sandbox - No autonomy, isolated testing
 * - T1: Observed - Human observes all actions
 * - T2: Provisional - Limited autonomy with strict constraints
 * - T3: Monitored - Continuous monitoring, some autonomy
 * - T4: Standard - Standard operations permitted
 * - T5: Trusted - Expanded trust, minimal oversight
 * - T6: Certified - Independent operation with auditing
 * - T7: Autonomous - Full autonomy for mission-critical operations
 */
export enum RuntimeTier {
  /** Sandbox - No autonomy, isolated testing environment */
  T0_SANDBOX = 0,
  /** Observed - Human observes all actions, learning period */
  T1_OBSERVED = 1,
  /** Provisional - Limited autonomy with strict constraints */
  T2_PROVISIONAL = 2,
  /** Monitored - Continuous monitoring, expanding autonomy */
  T3_MONITORED = 3,
  /** Standard - Standard operations without individual approval */
  T4_STANDARD = 4,
  /** Trusted - Expanded trust with minimal oversight */
  T5_TRUSTED = 5,
  /** Certified - Independent operation with audit trail */
  T6_CERTIFIED = 6,
  /** Autonomous - Full autonomy for mission-critical operations */
  T7_AUTONOMOUS = 7,
}

/**
 * Array of all runtime tiers in ascending order.
 */
export const RUNTIME_TIERS = [
  RuntimeTier.T0_SANDBOX,
  RuntimeTier.T1_OBSERVED,
  RuntimeTier.T2_PROVISIONAL,
  RuntimeTier.T3_MONITORED,
  RuntimeTier.T4_STANDARD,
  RuntimeTier.T5_TRUSTED,
  RuntimeTier.T6_CERTIFIED,
  RuntimeTier.T7_AUTONOMOUS,
] as const;

/**
 * Zod schema for RuntimeTier enum validation.
 */
export const runtimeTierSchema = z.nativeEnum(RuntimeTier, {
  errorMap: () => ({ message: "Invalid runtime tier. Must be T0-T7 (0-7)." }),
});

/**
 * Human-readable names for runtime tiers.
 */
export const RUNTIME_TIER_NAMES: Readonly<Record<RuntimeTier, string>> = {
  [RuntimeTier.T0_SANDBOX]: "Sandbox",
  [RuntimeTier.T1_OBSERVED]: "Observed",
  [RuntimeTier.T2_PROVISIONAL]: "Provisional",
  [RuntimeTier.T3_MONITORED]: "Monitored",
  [RuntimeTier.T4_STANDARD]: "Standard",
  [RuntimeTier.T5_TRUSTED]: "Trusted",
  [RuntimeTier.T6_CERTIFIED]: "Certified",
  [RuntimeTier.T7_AUTONOMOUS]: "Autonomous",
} as const;

/**
 * Detailed descriptions for runtime tiers.
 */
export const RUNTIME_TIER_DESCRIPTIONS: Readonly<Record<RuntimeTier, string>> =
  {
    [RuntimeTier.T0_SANDBOX]:
      "Isolated sandbox environment. No external access, all actions are simulated.",
    [RuntimeTier.T1_OBSERVED]:
      "Observation period. Every action is logged and reviewed, human oversight required.",
    [RuntimeTier.T2_PROVISIONAL]:
      "Provisional operations. Limited autonomy with strict policy constraints.",
    [RuntimeTier.T3_MONITORED]:
      "Monitored operations. Continuous monitoring with expanding operational freedom.",
    [RuntimeTier.T4_STANDARD]:
      "Standard operational trust. Can perform routine operations without approval.",
    [RuntimeTier.T5_TRUSTED]:
      "Trusted operations. Expanded capabilities with minimal oversight.",
    [RuntimeTier.T6_CERTIFIED]:
      "Certified operations. Independent operation with comprehensive audit trail.",
    [RuntimeTier.T7_AUTONOMOUS]:
      "Full autonomy. Mission-critical authority with autonomous decision-making.",
  } as const;

/**
 * Trust score ranges for runtime tiers (Vorion scale: 0-1000).
 */
export const RUNTIME_TIER_SCORES: Readonly<
  Record<RuntimeTier, { min: number; max: number }>
> = {
  [RuntimeTier.T0_SANDBOX]: { min: 0, max: 199 },
  [RuntimeTier.T1_OBSERVED]: { min: 200, max: 349 },
  [RuntimeTier.T2_PROVISIONAL]: { min: 350, max: 499 },
  [RuntimeTier.T3_MONITORED]: { min: 500, max: 649 },
  [RuntimeTier.T4_STANDARD]: { min: 650, max: 799 },
  [RuntimeTier.T5_TRUSTED]: { min: 800, max: 875 },
  [RuntimeTier.T6_CERTIFIED]: { min: 876, max: 950 },
  [RuntimeTier.T7_AUTONOMOUS]: { min: 951, max: 1000 },
} as const;

// ============================================================================
// Tier Configuration Types
// ============================================================================

/**
 * Configuration for a certification tier.
 */
export interface CertificationTierConfig {
  /** The certification tier */
  readonly tier: CertificationTier;
  /** Short code (T0-T7) */
  readonly code: string;
  /** Human-readable name */
  readonly name: string;
  /** Detailed description */
  readonly description: string;
  /** Trust score range */
  readonly scoreRange: { min: number; max: number };
  /** Required attestation types */
  readonly requiredAttestations: readonly string[];
  /** Maximum capability level allowed */
  readonly maxCapabilityLevel: number;
}

/**
 * Configuration for all certification tiers.
 */
export const CERTIFICATION_TIER_CONFIGS: Readonly<
  Record<CertificationTier, CertificationTierConfig>
> = {
  [CertificationTier.T0_SANDBOX]: {
    tier: CertificationTier.T0_SANDBOX,
    code: "T0",
    name: "Sandbox",
    description: CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T0_SANDBOX],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T0_SANDBOX],
    requiredAttestations: [],
    maxCapabilityLevel: 1,
  },
  [CertificationTier.T1_OBSERVED]: {
    tier: CertificationTier.T1_OBSERVED,
    code: "T1",
    name: "Observed",
    description: CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T1_OBSERVED],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T1_OBSERVED],
    requiredAttestations: ["identity"],
    maxCapabilityLevel: 2,
  },
  [CertificationTier.T2_PROVISIONAL]: {
    tier: CertificationTier.T2_PROVISIONAL,
    code: "T2",
    name: "Provisional",
    description:
      CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T2_PROVISIONAL],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T2_PROVISIONAL],
    requiredAttestations: ["identity", "capability_test"],
    maxCapabilityLevel: 3,
  },
  [CertificationTier.T3_MONITORED]: {
    tier: CertificationTier.T3_MONITORED,
    code: "T3",
    name: "Monitored",
    description:
      CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T3_MONITORED],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T3_MONITORED],
    requiredAttestations: [
      "identity",
      "capability_test",
      "continuous_monitoring",
    ],
    maxCapabilityLevel: 4,
  },
  [CertificationTier.T4_STANDARD]: {
    tier: CertificationTier.T4_STANDARD,
    code: "T4",
    name: "Standard",
    description: CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T4_STANDARD],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T4_STANDARD],
    requiredAttestations: [
      "identity",
      "capability_test",
      "continuous_monitoring",
      "track_record",
    ],
    maxCapabilityLevel: 5,
  },
  [CertificationTier.T5_TRUSTED]: {
    tier: CertificationTier.T5_TRUSTED,
    code: "T5",
    name: "Trusted",
    description: CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T5_TRUSTED],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T5_TRUSTED],
    requiredAttestations: [
      "identity",
      "capability_test",
      "continuous_monitoring",
      "track_record",
      "trust_verification",
    ],
    maxCapabilityLevel: 6,
  },
  [CertificationTier.T6_CERTIFIED]: {
    tier: CertificationTier.T6_CERTIFIED,
    code: "T6",
    name: "Certified",
    description:
      CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T6_CERTIFIED],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T6_CERTIFIED],
    requiredAttestations: [
      "identity",
      "capability_test",
      "continuous_monitoring",
      "track_record",
      "trust_verification",
      "third_party_audit",
    ],
    maxCapabilityLevel: 7,
  },
  [CertificationTier.T7_AUTONOMOUS]: {
    tier: CertificationTier.T7_AUTONOMOUS,
    code: "T7",
    name: "Autonomous",
    description:
      CERTIFICATION_TIER_DESCRIPTIONS[CertificationTier.T7_AUTONOMOUS],
    scoreRange: CERTIFICATION_TIER_SCORES[CertificationTier.T7_AUTONOMOUS],
    requiredAttestations: [
      "identity",
      "capability_test",
      "continuous_monitoring",
      "track_record",
      "trust_verification",
      "third_party_audit",
      "autonomous_certification",
    ],
    maxCapabilityLevel: 7,
  },
} as const;

/**
 * Configuration for a runtime tier.
 */
export interface RuntimeTierConfig {
  /** The runtime tier */
  readonly tier: RuntimeTier;
  /** Short code (T0-T7) */
  readonly code: string;
  /** Human-readable name */
  readonly name: string;
  /** Detailed description */
  readonly description: string;
  /** Trust score range */
  readonly scoreRange: { min: number; max: number };
  /** Whether human approval is required for actions */
  readonly requiresApproval: boolean;
  /** Whether operations are constrained by guardrails */
  readonly hasGuardrails: boolean;
  /** Whether autonomous operation is permitted */
  readonly allowsAutonomy: boolean;
}

/**
 * Configuration for all runtime tiers.
 */
export const RUNTIME_TIER_CONFIGS: Readonly<
  Record<RuntimeTier, RuntimeTierConfig>
> = {
  [RuntimeTier.T0_SANDBOX]: {
    tier: RuntimeTier.T0_SANDBOX,
    code: "T0",
    name: "Sandbox",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T0_SANDBOX],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T0_SANDBOX],
    requiresApproval: false, // No approval needed - everything is isolated
    hasGuardrails: true,
    allowsAutonomy: false,
  },
  [RuntimeTier.T1_OBSERVED]: {
    tier: RuntimeTier.T1_OBSERVED,
    code: "T1",
    name: "Observed",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T1_OBSERVED],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T1_OBSERVED],
    requiresApproval: true,
    hasGuardrails: true,
    allowsAutonomy: false,
  },
  [RuntimeTier.T2_PROVISIONAL]: {
    tier: RuntimeTier.T2_PROVISIONAL,
    code: "T2",
    name: "Provisional",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T2_PROVISIONAL],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T2_PROVISIONAL],
    requiresApproval: true,
    hasGuardrails: true,
    allowsAutonomy: false,
  },
  [RuntimeTier.T3_MONITORED]: {
    tier: RuntimeTier.T3_MONITORED,
    code: "T3",
    name: "Monitored",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T3_MONITORED],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T3_MONITORED],
    requiresApproval: false,
    hasGuardrails: true,
    allowsAutonomy: false,
  },
  [RuntimeTier.T4_STANDARD]: {
    tier: RuntimeTier.T4_STANDARD,
    code: "T4",
    name: "Standard",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T4_STANDARD],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T4_STANDARD],
    requiresApproval: false,
    hasGuardrails: false,
    allowsAutonomy: false,
  },
  [RuntimeTier.T5_TRUSTED]: {
    tier: RuntimeTier.T5_TRUSTED,
    code: "T5",
    name: "Trusted",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T5_TRUSTED],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T5_TRUSTED],
    requiresApproval: false,
    hasGuardrails: false,
    allowsAutonomy: false,
  },
  [RuntimeTier.T6_CERTIFIED]: {
    tier: RuntimeTier.T6_CERTIFIED,
    code: "T6",
    name: "Certified",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T6_CERTIFIED],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T6_CERTIFIED],
    requiresApproval: false,
    hasGuardrails: false,
    allowsAutonomy: true,
  },
  [RuntimeTier.T7_AUTONOMOUS]: {
    tier: RuntimeTier.T7_AUTONOMOUS,
    code: "T7",
    name: "Autonomous",
    description: RUNTIME_TIER_DESCRIPTIONS[RuntimeTier.T7_AUTONOMOUS],
    scoreRange: RUNTIME_TIER_SCORES[RuntimeTier.T7_AUTONOMOUS],
    requiresApproval: false,
    hasGuardrails: false,
    allowsAutonomy: true,
  },
} as const;

// ============================================================================
// Tier Comparison Helpers
// ============================================================================

/**
 * Checks if one certification tier is higher than another.
 */
export function isCertificationTierHigher(
  tier: CertificationTier,
  other: CertificationTier,
): boolean {
  return tier > other;
}

/**
 * Checks if a certification tier meets a minimum requirement.
 */
export function meetsCertificationTier(
  tier: CertificationTier,
  minTier: CertificationTier,
): boolean {
  return tier >= minTier;
}

/**
 * Compares two certification tiers.
 */
export function compareCertificationTiers(
  a: CertificationTier,
  b: CertificationTier,
): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Checks if one runtime tier is higher than another.
 */
export function isRuntimeTierHigher(
  tier: RuntimeTier,
  other: RuntimeTier,
): boolean {
  return tier > other;
}

/**
 * Checks if a runtime tier meets a minimum requirement.
 */
export function meetsRuntimeTier(
  tier: RuntimeTier,
  minTier: RuntimeTier,
): boolean {
  return tier >= minTier;
}

/**
 * Compares two runtime tiers.
 */
export function compareRuntimeTiers(
  a: RuntimeTier,
  b: RuntimeTier,
): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ============================================================================
// Score Conversion
// ============================================================================

/**
 * Converts a trust score to a certification tier using CAR ID scale (0-1000).
 *
 * @param score - Trust score on 0-1000 scale
 * @returns Corresponding CertificationTier
 */
export function scoreToCertificationTier(score: number): CertificationTier {
  if (score < 0 || score > 1000) {
    throw new Error(`Trust score must be between 0 and 1000, got ${score}`);
  }

  if (score < 200) return CertificationTier.T0_SANDBOX;
  if (score < 350) return CertificationTier.T1_OBSERVED;
  if (score < 500) return CertificationTier.T2_PROVISIONAL;
  if (score < 650) return CertificationTier.T3_MONITORED;
  if (score < 800) return CertificationTier.T4_STANDARD;
  if (score < 876) return CertificationTier.T5_TRUSTED;
  if (score < 951) return CertificationTier.T6_CERTIFIED;
  return CertificationTier.T7_AUTONOMOUS;
}

/**
 * Converts a trust score to a runtime tier using Vorion scale (0-1000).
 *
 * @param score - Trust score on 0-1000 scale
 * @returns Corresponding RuntimeTier
 */
export function scoreToRuntimeTier(score: number): RuntimeTier {
  if (score < 0 || score > 1000) {
    throw new Error(`Trust score must be between 0 and 1000, got ${score}`);
  }

  if (score < 200) return RuntimeTier.T0_SANDBOX;
  if (score < 350) return RuntimeTier.T1_OBSERVED;
  if (score < 500) return RuntimeTier.T2_PROVISIONAL;
  if (score < 650) return RuntimeTier.T3_MONITORED;
  if (score < 800) return RuntimeTier.T4_STANDARD;
  if (score < 876) return RuntimeTier.T5_TRUSTED;
  if (score < 951) return RuntimeTier.T6_CERTIFIED;
  return RuntimeTier.T7_AUTONOMOUS;
}

/**
 * Gets the midpoint score for a certification tier.
 *
 * @param tier - The certification tier
 * @returns Midpoint score for the tier
 */
export function certificationTierToScore(tier: CertificationTier): number {
  const range = CERTIFICATION_TIER_SCORES[tier];
  return Math.round((range.min + range.max) / 2);
}

/**
 * Gets the midpoint score for a runtime tier.
 *
 * @param tier - The runtime tier
 * @returns Midpoint score for the tier
 */
export function runtimeTierToScore(tier: RuntimeTier): number {
  const range = RUNTIME_TIER_SCORES[tier];
  return Math.round((range.min + range.max) / 2);
}

/**
 * Gets the minimum score for a certification tier.
 */
export function getCertificationTierMinScore(tier: CertificationTier): number {
  return CERTIFICATION_TIER_SCORES[tier].min;
}

/**
 * Gets the maximum score for a certification tier.
 */
export function getCertificationTierMaxScore(tier: CertificationTier): number {
  return CERTIFICATION_TIER_SCORES[tier].max;
}

/**
 * Gets the minimum score for a runtime tier.
 */
export function getRuntimeTierMinScore(tier: RuntimeTier): number {
  return RUNTIME_TIER_SCORES[tier].min;
}

/**
 * Gets the maximum score for a runtime tier.
 */
export function getRuntimeTierMaxScore(tier: RuntimeTier): number {
  return RUNTIME_TIER_SCORES[tier].max;
}

// ============================================================================
// Tier Information Helpers
// ============================================================================

/**
 * Gets the configuration for a certification tier.
 */
export function getCertificationTierConfig(
  tier: CertificationTier,
): CertificationTierConfig {
  return CERTIFICATION_TIER_CONFIGS[tier];
}

/**
 * Gets the configuration for a runtime tier.
 */
export function getRuntimeTierConfig(tier: RuntimeTier): RuntimeTierConfig {
  return RUNTIME_TIER_CONFIGS[tier];
}

/**
 * Gets the name of a certification tier.
 */
export function getCertificationTierName(tier: CertificationTier): string {
  return CERTIFICATION_TIER_NAMES[tier];
}

/**
 * Gets the name of a runtime tier.
 */
export function getRuntimeTierName(tier: RuntimeTier): string {
  return RUNTIME_TIER_NAMES[tier];
}

/**
 * Gets the description of a certification tier.
 */
export function getCertificationTierDescription(
  tier: CertificationTier,
): string {
  return CERTIFICATION_TIER_DESCRIPTIONS[tier];
}

/**
 * Gets the description of a runtime tier.
 */
export function getRuntimeTierDescription(tier: RuntimeTier): string {
  return RUNTIME_TIER_DESCRIPTIONS[tier];
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parses a tier string (e.g., "T3" or "3") to a CertificationTier.
 *
 * @param tierStr - Tier string to parse
 * @returns Parsed CertificationTier
 * @throws Error if the string is not a valid tier
 */
export function parseCertificationTier(tierStr: string): CertificationTier {
  const normalized = tierStr.toUpperCase().replace(/^T/, "");
  const tier = parseInt(normalized, 10);

  if (isNaN(tier) || tier < 0 || tier > 7) {
    throw new Error(
      `Invalid certification tier: ${tierStr}. Must be T0-T7 or 0-7.`,
    );
  }

  return tier as CertificationTier;
}

/**
 * Parses a tier string (e.g., "T3" or "3") to a RuntimeTier.
 *
 * @param tierStr - Tier string to parse
 * @returns Parsed RuntimeTier
 * @throws Error if the string is not a valid tier
 */
export function parseRuntimeTier(tierStr: string): RuntimeTier {
  const normalized = tierStr.toUpperCase().replace(/^T/, "");
  const tier = parseInt(normalized, 10);

  if (isNaN(tier) || tier < 0 || tier > 7) {
    throw new Error(`Invalid runtime tier: ${tierStr}. Must be T0-T7 or 0-7.`);
  }

  return tier as RuntimeTier;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid CertificationTier.
 */
export function isCertificationTier(
  value: unknown,
): value is CertificationTier {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 7
  );
}

/**
 * Type guard to check if a value is a valid RuntimeTier.
 */
export function isRuntimeTier(value: unknown): value is RuntimeTier {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 7
  );
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for certification tier configuration.
 */
export const certificationTierConfigSchema = z.object({
  tier: certificationTierSchema,
  code: z.string().regex(/^T[0-7]$/),
  name: z.string().min(1),
  description: z.string().min(1),
  scoreRange: z.object({
    min: z.number().int().min(0).max(1000),
    max: z.number().int().min(0).max(1000),
  }),
  requiredAttestations: z.array(z.string()).readonly(),
  maxCapabilityLevel: z.number().int().min(0).max(7),
});

/**
 * Zod schema for runtime tier configuration.
 */
export const runtimeTierConfigSchema = z.object({
  tier: runtimeTierSchema,
  code: z.string().regex(/^T[0-7]$/),
  name: z.string().min(1),
  description: z.string().min(1),
  scoreRange: z.object({
    min: z.number().int().min(0).max(1000),
    max: z.number().int().min(0).max(1000),
  }),
  requiresApproval: z.boolean(),
  hasGuardrails: z.boolean(),
  allowsAutonomy: z.boolean(),
});

/**
 * Zod schema for parsing tier strings.
 */
export const tierStringSchema = z
  .string()
  .regex(/^[Tt]?[0-7]$/, "Tier must be T0-T7 or 0-7");

/**
 * Zod schema for parsing and transforming to CertificationTier.
 */
export const certificationTierStringSchema = tierStringSchema.transform((str) =>
  parseCertificationTier(str),
);

/**
 * Zod schema for parsing and transforming to RuntimeTier.
 */
export const runtimeTierStringSchema = tierStringSchema.transform((str) =>
  parseRuntimeTier(str),
);
