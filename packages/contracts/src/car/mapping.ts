/**
 * @fileoverview Cross-System Mappings
 *
 * Provides mapping functions between different tier systems, domain namespaces,
 * and trust representations. These mappings enable interoperability between
 * the CAR specification and Vorion runtime systems.
 *
 * Key mappings:
 * - CertificationTier <-> RuntimeTier
 * - CAR Domains <-> Vorion Namespaces
 * - TrustBand <-> CertificationTier/RuntimeTier
 *
 * @module @vorionsys/contracts/car/mapping
 */

import { z } from "zod";
import { type DomainCode, domainCodeSchema } from "./domains.js";
import { CapabilityLevel } from "./levels.js";
import {
  CertificationTier,
  RuntimeTier,
  certificationTierSchema,
  runtimeTierSchema,
  CERTIFICATION_TIER_SCORES,
  RUNTIME_TIER_SCORES,
  scoreToCertificationTier,
  scoreToRuntimeTier,
} from "./tiers.js";

// ============================================================================
// Tier Mappings
// ============================================================================

/**
 * Maps a CertificationTier to the corresponding RuntimeTier.
 *
 * This is a direct 1:1 mapping since both use T0-T7 scale, but with
 * different semantic meanings:
 * - CertificationTier: External attestation status
 * - RuntimeTier: Deployment autonomy level
 *
 * @param certificationTier - CAR ID certification tier
 * @returns Corresponding Vorion runtime tier
 *
 * @example
 * ```typescript
 * certificationTierToRuntimeTier(CertificationTier.T3_MONITORED);
 * // RuntimeTier.T3_MONITORED
 * ```
 */
export function certificationTierToRuntimeTier(
  certificationTier: CertificationTier,
): RuntimeTier {
  // Direct mapping based on numeric value
  return certificationTier as unknown as RuntimeTier;
}

/**
 * Maps a RuntimeTier to the corresponding CertificationTier.
 *
 * @param runtimeTier - Vorion runtime tier
 * @returns Corresponding CAR ID certification tier
 *
 * @example
 * ```typescript
 * runtimeTierToCertificationTier(RuntimeTier.T3_MONITORED);
 * // CertificationTier.T3_MONITORED
 * ```
 */
export function runtimeTierToCertificationTier(
  runtimeTier: RuntimeTier,
): CertificationTier {
  return runtimeTier as unknown as CertificationTier;
}

/**
 * Mapping configuration for certification to runtime tier.
 */
export const CERTIFICATION_TO_RUNTIME_TIER_MAP: Readonly<
  Record<CertificationTier, RuntimeTier>
> = {
  [CertificationTier.T0_SANDBOX]: RuntimeTier.T0_SANDBOX,
  [CertificationTier.T1_OBSERVED]: RuntimeTier.T1_OBSERVED,
  [CertificationTier.T2_PROVISIONAL]: RuntimeTier.T2_PROVISIONAL,
  [CertificationTier.T3_MONITORED]: RuntimeTier.T3_MONITORED,
  [CertificationTier.T4_STANDARD]: RuntimeTier.T4_STANDARD,
  [CertificationTier.T5_TRUSTED]: RuntimeTier.T5_TRUSTED,
  [CertificationTier.T6_CERTIFIED]: RuntimeTier.T6_CERTIFIED,
  [CertificationTier.T7_AUTONOMOUS]: RuntimeTier.T7_AUTONOMOUS,
} as const;

/**
 * Mapping configuration for runtime to certification tier.
 */
export const RUNTIME_TO_CERTIFICATION_TIER_MAP: Readonly<
  Record<RuntimeTier, CertificationTier>
> = {
  [RuntimeTier.T0_SANDBOX]: CertificationTier.T0_SANDBOX,
  [RuntimeTier.T1_OBSERVED]: CertificationTier.T1_OBSERVED,
  [RuntimeTier.T2_PROVISIONAL]: CertificationTier.T2_PROVISIONAL,
  [RuntimeTier.T3_MONITORED]: CertificationTier.T3_MONITORED,
  [RuntimeTier.T4_STANDARD]: CertificationTier.T4_STANDARD,
  [RuntimeTier.T5_TRUSTED]: CertificationTier.T5_TRUSTED,
  [RuntimeTier.T6_CERTIFIED]: CertificationTier.T6_CERTIFIED,
  [RuntimeTier.T7_AUTONOMOUS]: CertificationTier.T7_AUTONOMOUS,
} as const;

// ============================================================================
// TrustBand Mappings (Integration with Vorion canonical types)
// ============================================================================

/**
 * TrustBand values from Vorion canonical types.
 * Replicated here to avoid circular dependencies.
 *
 * The 8-tier system (T0-T7) maps trust scores to discrete autonomy levels:
 * - T0: Sandbox - Isolated testing, no real operations (0-199)
 * - T1: Observed - Under active observation and supervision (200-349)
 * - T2: Provisional - Limited operations with strict constraints (350-499)
 * - T3: Monitored - Continuous monitoring with expanding freedom (500-649)
 * - T4: Standard - Trusted for routine operations (650-799)
 * - T5: Trusted - Expanded capabilities with minimal oversight (800-875)
 * - T6: Certified - Independent operation with audit trail (876-950)
 * - T7: Autonomous - Full autonomy for mission-critical operations (951-1000)
 */
export enum TrustBand {
  T0_SANDBOX = 0,
  T1_OBSERVED = 1,
  T2_PROVISIONAL = 2,
  T3_MONITORED = 3,
  T4_STANDARD = 4,
  T5_TRUSTED = 5,
  T6_CERTIFIED = 6,
  T7_AUTONOMOUS = 7,
}

/**
 * Zod schema for TrustBand validation.
 */
export const trustBandSchema = z.nativeEnum(TrustBand, {
  errorMap: () => ({ message: "Invalid trust band. Must be T0-T7 (0-7)." }),
});

/**
 * Maps a TrustBand to a CertificationTier.
 *
 * @param trustBand - Vorion trust band
 * @returns Corresponding CAR ID certification tier
 *
 * @example
 * ```typescript
 * trustBandToCertificationTier(TrustBand.T3_STANDARD);
 * // CertificationTier.T3_MONITORED
 * ```
 */
export function trustBandToCertificationTier(
  trustBand: TrustBand,
): CertificationTier {
  return trustBand as unknown as CertificationTier;
}

/**
 * Maps a TrustBand to a RuntimeTier.
 *
 * @param trustBand - Vorion trust band
 * @returns Corresponding Vorion runtime tier
 *
 * @example
 * ```typescript
 * trustBandToRuntimeTier(TrustBand.T3_STANDARD);
 * // RuntimeTier.T3_MONITORED
 * ```
 */
export function trustBandToRuntimeTier(trustBand: TrustBand): RuntimeTier {
  return trustBand as unknown as RuntimeTier;
}

/**
 * Maps a CertificationTier to a TrustBand.
 *
 * @param certificationTier - CAR ID certification tier
 * @returns Corresponding Vorion trust band
 */
export function certificationTierToTrustBand(
  certificationTier: CertificationTier,
): TrustBand {
  return certificationTier as unknown as TrustBand;
}

/**
 * Maps a RuntimeTier to a TrustBand.
 *
 * @param runtimeTier - Vorion runtime tier
 * @returns Corresponding Vorion trust band
 */
export function runtimeTierToTrustBand(runtimeTier: RuntimeTier): TrustBand {
  return runtimeTier as unknown as TrustBand;
}

// ============================================================================
// Trust Score Mappings
// ============================================================================

/**
 * Converts a trust score to both certification and runtime tiers.
 *
 * Note: CertificationTier and RuntimeTier use different score ranges,
 * so the same score may map to different tiers.
 *
 * @param score - Trust score (0-1000)
 * @returns Both certification and runtime tiers
 *
 * @example
 * ```typescript
 * scoreToBothTiers(550);
 * // { certificationTier: T3_MONITORED, runtimeTier: T3_TRUSTED }
 * ```
 */
export function scoreToBothTiers(score: number): {
  certificationTier: CertificationTier;
  runtimeTier: RuntimeTier;
} {
  return {
    certificationTier: scoreToCertificationTier(score),
    runtimeTier: scoreToRuntimeTier(score),
  };
}

/**
 * Normalizes a score between CAR ID and Vorion scales.
 *
 * CAR ID uses 0-1000 with boundaries at 100, 300, 500, 700, 900
 * Vorion uses 0-1000 with boundaries at 166, 333, 500, 666, 833
 *
 * @param score - Trust score
 * @param fromScale - Source scale ('carId' | 'vorion')
 * @param toScale - Target scale ('carId' | 'vorion')
 * @returns Normalized score in target scale
 */
export function normalizeScoreBetweenScales(
  score: number,
  fromScale: "carId" | "vorion",
  toScale: "carId" | "vorion",
): number {
  if (fromScale === toScale) {
    return score;
  }

  // Determine the tier in the source scale
  const sourceTier =
    fromScale === "carId"
      ? scoreToCertificationTier(score)
      : scoreToRuntimeTier(score);

  // Get the source tier's score range
  const sourceRange =
    fromScale === "carId"
      ? CERTIFICATION_TIER_SCORES[sourceTier as CertificationTier]
      : RUNTIME_TIER_SCORES[sourceTier as RuntimeTier];

  // Calculate position within source tier (0-1)
  const positionInTier =
    sourceRange.max === sourceRange.min
      ? 0.5
      : (score - sourceRange.min) / (sourceRange.max - sourceRange.min);

  // Get the target tier's score range (same tier index, different scale)
  const targetRange =
    toScale === "carId"
      ? CERTIFICATION_TIER_SCORES[sourceTier as CertificationTier]
      : RUNTIME_TIER_SCORES[sourceTier as RuntimeTier];

  // Map to target scale
  return Math.round(
    targetRange.min + positionInTier * (targetRange.max - targetRange.min),
  );
}

// ============================================================================
// Domain to Namespace Mappings
// ============================================================================

/**
 * Vorion namespace strings corresponding to CAR ID domains.
 */
export type VorionNamespace =
  | "administration"
  | "business"
  | "communications"
  | "data"
  | "external"
  | "finance"
  | "governance"
  | "healthcare"
  | "infrastructure"
  | "judicial"
  | "knowledge"
  | "logistics"
  | "manufacturing"
  | "nlp"
  | "operations"
  | "people"
  | "quality"
  | "research"
  | "security"
  | "training"
  | "utilities"
  | "verification"
  | "web"
  | "cross-domain"
  | "yield"
  | "reserved";

/**
 * Array of all Vorion namespaces.
 */
export const VORION_NAMESPACES: readonly VorionNamespace[] = [
  "administration",
  "business",
  "communications",
  "cross-domain",
  "data",
  "external",
  "finance",
  "governance",
  "healthcare",
  "infrastructure",
  "judicial",
  "knowledge",
  "logistics",
  "manufacturing",
  "nlp",
  "operations",
  "people",
  "quality",
  "research",
  "reserved",
  "security",
  "training",
  "utilities",
  "verification",
  "web",
  "yield",
] as const;

/**
 * Zod schema for VorionNamespace validation.
 */
export const vorionNamespaceSchema = z.enum([
  "administration",
  "business",
  "communications",
  "cross-domain",
  "data",
  "external",
  "finance",
  "governance",
  "healthcare",
  "infrastructure",
  "judicial",
  "knowledge",
  "logistics",
  "manufacturing",
  "nlp",
  "operations",
  "people",
  "quality",
  "research",
  "reserved",
  "security",
  "training",
  "utilities",
  "verification",
  "web",
  "yield",
]);

/**
 * Mapping from CAR ID domain codes to Vorion namespaces.
 */
export const DOMAIN_TO_NAMESPACE_MAP: Readonly<
  Record<DomainCode, VorionNamespace>
> = {
  A: "administration",
  B: "business",
  C: "communications",
  D: "data",
  E: "external",
  F: "finance",
  G: "governance",
  H: "healthcare",
  I: "infrastructure",
  J: "judicial",
  K: "knowledge",
  L: "logistics",
  M: "manufacturing",
  N: "nlp",
  O: "operations",
  P: "people",
  Q: "quality",
  R: "research",
  S: "security",
  T: "training",
  U: "utilities",
  V: "verification",
  W: "web",
  X: "cross-domain",
  Y: "yield",
  Z: "reserved",
} as const;

/**
 * Mapping from Vorion namespaces to CAR ID domain codes.
 */
export const NAMESPACE_TO_DOMAIN_MAP: Readonly<
  Record<VorionNamespace, DomainCode>
> = {
  administration: "A",
  business: "B",
  communications: "C",
  data: "D",
  external: "E",
  finance: "F",
  governance: "G",
  healthcare: "H",
  infrastructure: "I",
  judicial: "J",
  knowledge: "K",
  logistics: "L",
  manufacturing: "M",
  nlp: "N",
  operations: "O",
  people: "P",
  quality: "Q",
  research: "R",
  security: "S",
  training: "T",
  utilities: "U",
  verification: "V",
  web: "W",
  "cross-domain": "X",
  yield: "Y",
  reserved: "Z",
} as const;

/**
 * Maps a CAR ID domain code to a Vorion namespace.
 *
 * @param domain - CAR ID domain code
 * @returns Vorion namespace
 *
 * @example
 * ```typescript
 * carIdDomainToVorionNamespace('F');  // 'finance'
 * carIdDomainToVorionNamespace('S');  // 'security'
 * ```
 */
export function carIdDomainToVorionNamespace(
  domain: DomainCode,
): VorionNamespace {
  return DOMAIN_TO_NAMESPACE_MAP[domain];
}

/**
 * Maps a Vorion namespace to a CAR ID domain code.
 *
 * @param namespace - Vorion namespace
 * @returns CAR ID domain code
 *
 * @example
 * ```typescript
 * vorionNamespaceToCarIdDomain('finance');  // 'F'
 * vorionNamespaceToCarIdDomain('security'); // 'S'
 * ```
 */
export function vorionNamespaceToCarIdDomain(
  namespace: VorionNamespace,
): DomainCode {
  return NAMESPACE_TO_DOMAIN_MAP[namespace];
}

/**
 * Maps an array of CAR ID domains to Vorion namespaces.
 *
 * @param domains - Array of CAR ID domain codes
 * @returns Array of Vorion namespaces
 */
export function carIdDomainsToVorionNamespaces(
  domains: readonly DomainCode[],
): VorionNamespace[] {
  return domains.map(carIdDomainToVorionNamespace);
}

/**
 * Maps an array of Vorion namespaces to CAR ID domains.
 *
 * @param namespaces - Array of Vorion namespaces
 * @returns Array of CAR ID domain codes
 */
export function vorionNamespacesToCarIdDomains(
  namespaces: readonly VorionNamespace[],
): DomainCode[] {
  return namespaces.map(vorionNamespaceToCarIdDomain);
}

// ============================================================================
// Capability Level Mappings
// ============================================================================

/**
 * Maps a capability level to a human-readable autonomy description.
 *
 * @param level - Capability level
 * @returns Autonomy description
 */
export function capabilityLevelToAutonomyDescription(
  level: CapabilityLevel,
): string {
  const descriptions: Record<CapabilityLevel, string> = {
    [CapabilityLevel.L0_OBSERVE]: "Read-only, no autonomy",
    [CapabilityLevel.L1_ADVISE]: "Advisory only, cannot act",
    [CapabilityLevel.L2_DRAFT]: "Can draft, requires approval",
    [CapabilityLevel.L3_EXECUTE]: "Can execute with approval",
    [CapabilityLevel.L4_AUTONOMOUS]: "Autonomous within bounds",
    [CapabilityLevel.L5_TRUSTED]: "Expanded autonomy, minimal oversight",
    [CapabilityLevel.L6_CERTIFIED]: "Independent operation, audit trail",
    [CapabilityLevel.L7_AUTONOMOUS]: "Full autonomy",
  };
  return descriptions[level];
}

/**
 * Maps a capability level to a maximum allowed runtime tier.
 *
 * Higher capability levels require higher runtime tiers to operate.
 *
 * @param level - Capability level
 * @returns Minimum runtime tier required
 */
export function capabilityLevelToMinRuntimeTier(
  level: CapabilityLevel,
): RuntimeTier {
  return level as unknown as RuntimeTier;
}

// ============================================================================
// Bidirectional Mapping Helper
// ============================================================================

/**
 * A bidirectional mapping between two types.
 */
export interface BidirectionalMap<A, B> {
  forward: (a: A) => B;
  reverse: (b: B) => A;
  forwardMap: Readonly<Record<string, B>>;
  reverseMap: Readonly<Record<string, A>>;
}

/**
 * Creates a bidirectional mapping.
 *
 * @param mapping - Object mapping A values to B values
 * @returns Bidirectional map with forward and reverse functions
 */
export function createBidirectionalMap<
  A extends string | number,
  B extends string | number,
>(mapping: Record<A, B>): BidirectionalMap<A, B> {
  const reverseMapping = {} as Record<B, A>;

  for (const [key, value] of Object.entries(mapping)) {
    reverseMapping[value as B] = key as unknown as A;
  }

  return {
    forward: (a: A) => mapping[a],
    reverse: (b: B) => reverseMapping[b],
    forwardMap: mapping as Readonly<Record<string, B>>,
    reverseMap: reverseMapping as Readonly<Record<string, A>>,
  };
}

/**
 * Pre-built bidirectional map for domain <-> namespace.
 */
export const domainNamespaceMap = createBidirectionalMap(
  DOMAIN_TO_NAMESPACE_MAP,
);

/**
 * Pre-built bidirectional map for certification <-> runtime tier.
 */
export const certificationRuntimeMap = createBidirectionalMap(
  CERTIFICATION_TO_RUNTIME_TIER_MAP,
);

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for tier mapping result.
 */
export const tierMappingResultSchema = z.object({
  certificationTier: certificationTierSchema,
  runtimeTier: runtimeTierSchema,
});

/**
 * Zod schema for domain mapping result.
 */
export const domainMappingResultSchema = z.object({
  domain: domainCodeSchema,
  namespace: vorionNamespaceSchema,
});

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for VorionNamespace.
 */
export function isVorionNamespace(value: unknown): value is VorionNamespace {
  return (
    typeof value === "string" &&
    VORION_NAMESPACES.includes(value as VorionNamespace)
  );
}

/**
 * Type guard for TrustBand.
 */
export function isTrustBand(value: unknown): value is TrustBand {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 7
  );
}
