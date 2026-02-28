/**
 * @fileoverview Agent Identity Types
 *
 * Defines comprehensive agent identity types combining CAR classification,
 * decentralized identifiers (DIDs), capabilities, and attestations into
 * a unified identity model.
 *
 * @module @vorionsys/contracts/car/identity
 */

import { z } from "zod";
import { type DomainCode, domainCodeArraySchema } from "./domains.js";
import { CapabilityLevel, capabilityLevelSchema } from "./levels.js";
import {
  CertificationTier,
  certificationTierSchema,
  RuntimeTier,
  runtimeTierSchema,
} from "./tiers.js";
import { type Attestation, attestationSchema } from "./attestation.js";
import {
  type ParsedCAR,
  parsedCARSchema,
  carStringSchema,
} from "./car-string.js";
import {
  type SkillCode,
  skillCodeArraySchema,
  skillBitmaskSchema,
} from "./skills.js";

// ============================================================================
// Supervision Constants
// ============================================================================

/**
 * Maximum tier elevation allowed under supervision.
 *
 * A supervised agent can operate at most 2 tiers above its own
 * certification tier, and never above (supervisorTier - 1).
 */
export const MAX_SUPERVISION_ELEVATION = 2;

// Legacy CAR ID type aliases for backwards compatibility
/** @deprecated Use ParsedCAR instead */
export type ParsedACI = ParsedCAR;
/** @deprecated Use parsedCARSchema instead */
export const parsedACISchema = parsedCARSchema;
/** @deprecated Use carStringSchema instead */
export const aciStringSchema = carStringSchema;

// ============================================================================
// Capability Vector
// ============================================================================

/**
 * Capability vector for queries and comparisons.
 *
 * Represents a set of capability requirements or grants that can be
 * compared against other vectors for authorization decisions.
 */
/**
 * Capability vector describes what an agent CAN DO.
 *
 * NOTE: Trust/certification tier is NOT included here because:
 * - Trust is computed at runtime from attestations
 * - The CAR is an immutable identifier, not a trust indicator
 * - Same agent can have different trust in different deployments
 *
 * Skills use bitmask encoding for efficient matching (see skills.ts).
 */
export interface CapabilityVector {
  /** Required/granted domains */
  domains: readonly DomainCode[];
  /** Domain bitmask for efficient queries */
  domainsBitmask?: number;
  /** Minimum level required/granted */
  level: CapabilityLevel;
  /** Optional skill codes for fine-grained matching */
  skills?: readonly SkillCode[];
  /** Skill bitmask for efficient queries */
  skillsBitmask?: number;
}

/**
 * Zod schema for CapabilityVector validation.
 */
export const capabilityVectorSchema = z.object({
  domains: domainCodeArraySchema,
  domainsBitmask: z.number().int().min(0).optional(),
  level: capabilityLevelSchema,
  skills: skillCodeArraySchema.optional(),
  skillsBitmask: skillBitmaskSchema.optional(),
});

// ============================================================================
// Agent Metadata
// ============================================================================

/**
 * Metadata about an agent.
 */
export interface AgentMetadata {
  /** Human-readable description */
  description?: string;
  /** Agent software version */
  version?: string;
  /** Contact information (email, URL) */
  contact?: string;
  /** Documentation URL */
  documentation?: string;
  /** Support URL */
  support?: string;
  /** Terms of service URL */
  termsOfService?: string;
  /** Privacy policy URL */
  privacyPolicy?: string;
  /** Organization name */
  organization?: string;
  /** Organization logo URL */
  logo?: string;
  /** Additional custom properties */
  [key: string]: string | undefined;
}

/**
 * Zod schema for AgentMetadata validation.
 */
export const agentMetadataSchema = z
  .object({
    description: z.string().optional(),
    version: z.string().optional(),
    contact: z.string().optional(),
    documentation: z.string().url().optional(),
    support: z.string().url().optional(),
    termsOfService: z.string().url().optional(),
    privacyPolicy: z.string().url().optional(),
    organization: z.string().optional(),
    logo: z.string().url().optional(),
  })
  .catchall(z.string().optional());

// ============================================================================
// Supervision Context
// ============================================================================

/**
 * Context for supervised agent operations.
 *
 * When an agent operates under the supervision of a higher-tier agent,
 * it may be granted temporary tier elevation. The elevation is capped at
 * +2 tiers (MAX_SUPERVISION_ELEVATION) and can never exceed
 * (supervisor's tier - 1).
 */
export interface SupervisionContext {
  /** CAR string of the supervising agent */
  supervisorCAR: string;
  /** DID of the supervising agent */
  supervisorDID: string;
  /** Certification tier of the supervisor (determines elevation cap) */
  supervisorTier: CertificationTier;
  /** Number of tiers to elevate (0 to MAX_SUPERVISION_ELEVATION) */
  elevationTiers: number;
  /** When supervision was granted */
  grantedAt: Date;
  /** When supervision expires */
  expiresAt: Date;
  /** Heartbeat interval in milliseconds (0 = no heartbeat required) */
  heartbeatIntervalMs: number;
  /** Last heartbeat timestamp (if heartbeat required) */
  lastHeartbeat?: Date;
  /** Supervision scope description */
  scope?: string;
}

/**
 * Zod schema for SupervisionContext validation.
 */
export const supervisionContextSchema = z.object({
  supervisorCAR: carStringSchema,
  supervisorDID: z.string().min(1),
  supervisorTier: certificationTierSchema,
  elevationTiers: z.number().int().min(0).max(MAX_SUPERVISION_ELEVATION),
  grantedAt: z.date(),
  expiresAt: z.date(),
  heartbeatIntervalMs: z.number().int().min(0),
  lastHeartbeat: z.date().optional(),
  scope: z.string().optional(),
});

/**
 * Checks if a supervision context is currently active (not expired, heartbeat OK).
 *
 * @param ctx - Supervision context to check
 * @returns True if supervision is active
 */
export function isSupervisionActive(ctx: SupervisionContext): boolean {
  const now = new Date();

  // Check temporal bounds
  if (ctx.grantedAt > now || ctx.expiresAt <= now) {
    return false;
  }

  // Check heartbeat if required
  if (ctx.heartbeatIntervalMs > 0 && ctx.lastHeartbeat) {
    const heartbeatDeadline = new Date(
      ctx.lastHeartbeat.getTime() + ctx.heartbeatIntervalMs,
    );
    if (heartbeatDeadline < now) {
      return false;
    }
  }

  return true;
}

/**
 * Calculates the effective supervised tier for an agent.
 *
 * The supervised tier is: min(baseTier + elevation, supervisorTier - 1, T7)
 *
 * @param baseTier - Agent's own certification tier
 * @param supervision - Active supervision context
 * @returns Effective tier under supervision (or baseTier if supervision inactive)
 */
export function calculateSupervisedTier(
  baseTier: CertificationTier,
  supervision: SupervisionContext,
): CertificationTier {
  if (!isSupervisionActive(supervision)) {
    return baseTier;
  }

  const elevation = Math.min(
    supervision.elevationTiers,
    MAX_SUPERVISION_ELEVATION,
  );
  const supervisorCap = Math.max(0, supervision.supervisorTier - 1);
  const elevatedTier = Math.min(
    baseTier + elevation,
    supervisorCap,
    CertificationTier.T7_AUTONOMOUS,
  );

  return Math.max(baseTier, elevatedTier) as CertificationTier;
}

/**
 * Validates whether a supervision elevation request is valid.
 *
 * @param supervisorTier - Supervisor's certification tier
 * @param subjectTier - Subject agent's certification tier
 * @param requestedElevation - Requested tier elevation (0-2)
 * @returns Validation result with reason if invalid
 */
export function validateSupervisionElevation(
  supervisorTier: CertificationTier,
  subjectTier: CertificationTier,
  requestedElevation: number,
): { valid: boolean; reason?: string; effectiveTier?: CertificationTier } {
  if (
    requestedElevation < 0 ||
    requestedElevation > MAX_SUPERVISION_ELEVATION
  ) {
    return {
      valid: false,
      reason: `Elevation must be 0-${MAX_SUPERVISION_ELEVATION}, got ${requestedElevation}`,
    };
  }

  if (supervisorTier <= subjectTier) {
    return {
      valid: false,
      reason: `Supervisor tier (T${supervisorTier}) must be higher than subject tier (T${subjectTier})`,
    };
  }

  const supervisorCap = supervisorTier - 1;
  const effectiveTier = Math.min(
    subjectTier + requestedElevation,
    supervisorCap,
    CertificationTier.T7_AUTONOMOUS,
  ) as CertificationTier;

  return { valid: true, effectiveTier };
}

// ============================================================================
// Floating CAR References
// ============================================================================

/**
 * Optional references to other CARs that aren't resolved at creation time.
 *
 * These are "floating" because they can be set after identity creation
 * and may point to CARs that don't exist yet or are in other registries.
 */
export interface FloatingCARReferences {
  /** CAR of the supervising agent (if under supervision) */
  supervisorCAR?: string;
  /** CAR of the parent agent (if this is a child/sub-agent) */
  parentCAR?: string;
  /** CARs of agents this agent has delegated to */
  delegatedCARs?: string[];
  /** CARs of related agents (peers, collaborators) */
  relatedCARs?: string[];
}

/**
 * Zod schema for FloatingCARReferences validation.
 */
export const floatingCARReferencesSchema = z.object({
  supervisorCAR: carStringSchema.optional(),
  parentCAR: carStringSchema.optional(),
  delegatedCARs: z.array(carStringSchema).optional(),
  relatedCARs: z.array(carStringSchema).optional(),
});

// ============================================================================
// DID Document Types
// ============================================================================

/**
 * Verification method in a DID document.
 */
export interface VerificationMethod {
  /** Verification method ID */
  id: string;
  /** Type of verification method */
  type: string;
  /** Controller DID */
  controller: string;
  /** Public key in JWK format */
  publicKeyJwk?: Record<string, unknown>;
  /** Public key in multibase format */
  publicKeyMultibase?: string;
}

/**
 * Service endpoint in a DID document.
 */
export interface ServiceEndpoint {
  /** Service ID */
  id: string;
  /** Service type */
  type: string;
  /** Service endpoint URL */
  serviceEndpoint: string;
  /** Additional service properties */
  [key: string]: unknown;
}

/**
 * Zod schema for VerificationMethod.
 */
export const verificationMethodSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  controller: z.string().min(1),
  publicKeyJwk: z.record(z.unknown()).optional(),
  publicKeyMultibase: z.string().optional(),
});

/**
 * Zod schema for ServiceEndpoint.
 */
export const serviceEndpointSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    serviceEndpoint: z.string().url(),
  })
  .catchall(z.unknown());

// ============================================================================
// Agent Identity
// ============================================================================

/**
 * Full agent identity combining CAR, DID, and capabilities.
 *
 * This is the comprehensive identity structure for an agent in the system,
 * containing all information needed for authentication, authorization,
 * and capability verification.
 */
export interface AgentIdentity {
  /** Full CAR string */
  car: string;
  /** @deprecated Use car instead */
  carId?: string;
  /** Parsed CAR components */
  parsedCAR?: ParsedCAR;
  /** @deprecated Use parsedCAR instead */
  parsedCarId?: ParsedCAR;
  /** Agent DID (Decentralized Identifier) */
  did: string;
  /** Capability vector */
  capabilities: CapabilityVector;
  /** Active attestations */
  attestations: Attestation[];
  /** Service endpoint URL for agent communication */
  serviceEndpoint?: string;
  /** Additional service endpoints */
  services?: ServiceEndpoint[];
  /** Verification methods */
  verificationMethods?: VerificationMethod[];
  /** Agent metadata */
  metadata?: AgentMetadata;
  /** Runtime tier in current deployment */
  runtimeTier?: RuntimeTier;
  /** Active supervision context (if operating under a supervisor) */
  supervision?: SupervisionContext;
  /** Floating references to other CAR identities */
  floatingReferences?: FloatingCARReferences;
  /** Creation timestamp */
  created: Date;
  /** Last update timestamp */
  updated: Date;
  /** Whether the identity is currently active */
  active: boolean;
}

/**
 * Zod schema for AgentIdentity validation.
 */
export const agentIdentitySchema = z.object({
  car: carStringSchema,
  carId: carStringSchema.optional(),
  parsedCAR: parsedCARSchema.optional(),
  parsedCarId: parsedCARSchema.optional(),
  did: z.string().min(1),
  capabilities: capabilityVectorSchema,
  attestations: z.array(attestationSchema),
  serviceEndpoint: z.string().url().optional(),
  services: z.array(serviceEndpointSchema).optional(),
  verificationMethods: z.array(verificationMethodSchema).optional(),
  metadata: agentMetadataSchema.optional(),
  runtimeTier: runtimeTierSchema.optional(),
  supervision: supervisionContextSchema.optional(),
  floatingReferences: floatingCARReferencesSchema.optional(),
  created: z.date(),
  updated: z.date(),
  active: z.boolean(),
});

// ============================================================================
// Agent Identity Summary
// ============================================================================

/**
 * Lightweight summary of an agent identity.
 *
 * Used for listings, search results, and contexts where the full
 * identity is not needed.
 */
/**
 * Summarized agent identity for quick lookups.
 *
 * NOTE: certificationTier is OPTIONAL because it comes from attestations,
 * not the CAR. Use getHighestAttestationTier() to compute it.
 */
export interface AgentIdentitySummary {
  /** Full CAR string */
  car: string;
  /** @deprecated Use car instead */
  carId?: string;
  /** Agent DID */
  did: string;
  /** Capability domains */
  domains: readonly DomainCode[];
  /** Capability level */
  level: CapabilityLevel;
  /**
   * Certification tier from attestations (optional).
   * Compute from valid attestations; defaults to T0 if none.
   */
  certificationTier?: CertificationTier;
  /** Runtime tier (if available) */
  runtimeTier?: RuntimeTier;
  /** Agent name/description */
  name?: string;
  /** Whether the agent is active */
  active: boolean;
}

/**
 * Zod schema for AgentIdentitySummary.
 */
export const agentIdentitySummarySchema = z.object({
  car: carStringSchema,
  carId: carStringSchema.optional(),
  did: z.string().min(1),
  domains: domainCodeArraySchema,
  level: capabilityLevelSchema,
  certificationTier: certificationTierSchema.optional(),
  runtimeTier: runtimeTierSchema.optional(),
  name: z.string().optional(),
  active: z.boolean(),
});

// ============================================================================
// Agent Registration
// ============================================================================

/**
 * Options for registering a new agent identity.
 */
export interface AgentRegistrationOptions {
  /** CAR string or components */
  car: string;
  /** @deprecated Use car instead */
  carId?: string;
  /** Agent DID */
  did: string;
  /** Service endpoint URL */
  serviceEndpoint?: string;
  /** Additional services */
  services?: ServiceEndpoint[];
  /** Verification methods */
  verificationMethods?: VerificationMethod[];
  /** Agent metadata */
  metadata?: AgentMetadata;
  /** Initial attestations */
  attestations?: Attestation[];
}

/**
 * Zod schema for AgentRegistrationOptions.
 */
export const agentRegistrationOptionsSchema = z.object({
  car: carStringSchema,
  carId: carStringSchema.optional(),
  did: z.string().min(1),
  serviceEndpoint: z.string().url().optional(),
  services: z.array(serviceEndpointSchema).optional(),
  verificationMethods: z.array(verificationMethodSchema).optional(),
  metadata: agentMetadataSchema.optional(),
  attestations: z.array(attestationSchema).optional(),
});

// ============================================================================
// Identity Matching
// ============================================================================

/**
 * Criteria for matching agent identities.
 */
export interface AgentMatchCriteria {
  /** Required domains (all must be present) */
  requiredDomains?: readonly DomainCode[];
  /** Minimum capability level */
  minLevel?: CapabilityLevel;
  /** Minimum certification tier */
  minCertificationTier?: CertificationTier;
  /** Minimum runtime tier */
  minRuntimeTier?: RuntimeTier;
  /** Required skills (all must be present) */
  requiredSkills?: readonly SkillCode[];
  /** Must be active */
  mustBeActive?: boolean;
  /** Must have valid attestations */
  mustHaveValidAttestations?: boolean;
  /** Organization filter */
  organization?: string;
  /** Registry filter */
  registry?: string;
}

/**
 * Zod schema for AgentMatchCriteria.
 */
export const agentMatchCriteriaSchema = z.object({
  requiredDomains: domainCodeArraySchema.optional(),
  minLevel: capabilityLevelSchema.optional(),
  minCertificationTier: certificationTierSchema.optional(),
  minRuntimeTier: runtimeTierSchema.optional(),
  requiredSkills: skillCodeArraySchema.optional(),
  mustBeActive: z.boolean().optional(),
  mustHaveValidAttestations: z.boolean().optional(),
  organization: z.string().optional(),
  registry: z.string().optional(),
});

// ============================================================================
// Identity Factory Functions
// ============================================================================

/**
 * Creates an agent identity from registration options.
 *
 * @param options - Registration options
 * @param parsedCAR - Pre-parsed CAR (optional)
 * @returns New agent identity
 */
export function createAgentIdentity(
  options: AgentRegistrationOptions,
  parsedCAR?: ParsedCAR,
): AgentIdentity {
  const now = new Date();

  // If parsedCAR not provided, we'd need to parse it
  // For now, require the caller to provide it or handle parsing externally
  // NOTE: Trust tier is NOT included - it comes from attestations at runtime
  const capabilities: CapabilityVector = parsedCAR
    ? {
        domains: parsedCAR.domains,
        domainsBitmask: parsedCAR.domainsBitmask,
        level: parsedCAR.level,
      }
    : {
        domains: [],
        level: CapabilityLevel.L0_OBSERVE,
      };

  return {
    car: options.car,
    carId: options.car, // backwards compat
    parsedCAR,
    parsedCarId: parsedCAR, // backwards compat
    did: options.did,
    capabilities,
    attestations: options.attestations ?? [],
    serviceEndpoint: options.serviceEndpoint,
    services: options.services,
    verificationMethods: options.verificationMethods,
    metadata: options.metadata,
    created: now,
    updated: now,
    active: true,
  };
}

/**
 * Creates a summary from a full agent identity.
 *
 * @param identity - Full agent identity
 * @returns Agent identity summary
 */
/**
 * Converts an AgentIdentity to a summary view.
 *
 * @param identity - Full agent identity
 * @returns Summarized view
 */
export function toAgentIdentitySummary(
  identity: AgentIdentity,
): AgentIdentitySummary {
  // Compute certification tier from valid attestations
  const now = new Date();
  const validAttestations = identity.attestations.filter(
    (a) => a.expiresAt > now,
  );
  const certificationTier =
    validAttestations.length > 0
      ? (Math.max(
          ...validAttestations.map((a) => a.certificationTier),
        ) as CertificationTier)
      : undefined;

  return {
    car: identity.car,
    carId: identity.car, // backwards compat
    did: identity.did,
    domains: identity.capabilities.domains,
    level: identity.capabilities.level,
    certificationTier,
    runtimeTier: identity.runtimeTier,
    name: identity.metadata?.description,
    active: identity.active,
  };
}

// ============================================================================
// Identity Matching Functions
// ============================================================================

/**
 * Checks if an agent identity matches given criteria.
 *
 * @param identity - Agent identity to check
 * @param criteria - Matching criteria
 * @returns True if the identity matches all criteria
 */
export function matchesAgentCriteria(
  identity: AgentIdentity,
  criteria: AgentMatchCriteria,
): boolean {
  // Check active status
  if (criteria.mustBeActive && !identity.active) {
    return false;
  }

  // Check required domains
  if (criteria.requiredDomains && criteria.requiredDomains.length > 0) {
    const agentDomains = new Set(identity.capabilities.domains);
    const hasAllDomains = criteria.requiredDomains.every((d) =>
      agentDomains.has(d),
    );
    if (!hasAllDomains) {
      return false;
    }
  }

  // Check minimum level
  if (
    criteria.minLevel !== undefined &&
    identity.capabilities.level < criteria.minLevel
  ) {
    return false;
  }

  // Check minimum certification tier (computed from attestations)
  if (criteria.minCertificationTier !== undefined) {
    const now = new Date();
    const validAttestations = identity.attestations.filter(
      (a) => a.status === "active" && a.expiresAt > now,
    );
    const highestTier =
      validAttestations.length > 0
        ? Math.max(...validAttestations.map((a) => a.certificationTier))
        : 0; // Default to T0 if no attestations
    if (highestTier < criteria.minCertificationTier) {
      return false;
    }
  }

  // Check minimum runtime tier
  if (
    criteria.minRuntimeTier !== undefined &&
    identity.runtimeTier !== undefined &&
    identity.runtimeTier < criteria.minRuntimeTier
  ) {
    return false;
  }

  // Check required skills
  if (criteria.requiredSkills && criteria.requiredSkills.length > 0) {
    const agentSkills = new Set(identity.capabilities.skills ?? []);
    const hasAllSkills = criteria.requiredSkills.every((s) =>
      agentSkills.has(s),
    );
    if (!hasAllSkills) {
      return false;
    }
  }

  // Check valid attestations
  if (criteria.mustHaveValidAttestations) {
    const now = new Date();
    const hasValidAttestation = identity.attestations.some(
      (a) => a.status === "active" && a.expiresAt > now,
    );
    if (!hasValidAttestation) {
      return false;
    }
  }

  // Check organization (from parsed CAR)
  if (criteria.organization && identity.parsedCAR) {
    if (identity.parsedCAR.organization !== criteria.organization) {
      return false;
    }
  }

  // Check registry (from parsed CAR)
  if (criteria.registry && identity.parsedCAR) {
    if (identity.parsedCAR.registry !== criteria.registry) {
      return false;
    }
  }

  return true;
}

/**
 * Compares two capability vectors.
 *
 * NOTE: Certification tier is NOT compared here because it's not part
 * of CapabilityVector. Trust comes from attestations at runtime.
 * Use separate attestation comparison if needed.
 *
 * @param a - First capability vector
 * @param b - Second capability vector
 * @returns True if a satisfies or exceeds b (domains + level only)
 */
export function capabilityVectorSatisfies(
  a: CapabilityVector,
  b: CapabilityVector,
): boolean {
  // Check domains
  const aDomains = new Set(a.domains);
  const hasAllDomains = b.domains.every((d) => aDomains.has(d));
  if (!hasAllDomains) {
    return false;
  }

  // Check level
  if (a.level < b.level) {
    return false;
  }

  // NOTE: Certification tier comparison removed - trust comes from attestations

  // Check skills (if specified)
  if (b.skills && b.skills.length > 0) {
    const aSkills = new Set(a.skills ?? []);
    const hasAllSkills = b.skills.every((s) => aSkills.has(s));
    if (!hasAllSkills) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid CapabilityVector.
 */
export function isCapabilityVector(value: unknown): value is CapabilityVector {
  return (
    typeof value === "object" &&
    value !== null &&
    "domains" in value &&
    "level" in value
  );
}

/**
 * Type guard to check if a value is a valid AgentIdentity.
 */
export function isAgentIdentity(value: unknown): value is AgentIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    ("car" in value || "carId" in value) &&
    "did" in value &&
    "capabilities" in value &&
    "attestations" in value
  );
}

/**
 * Type guard to check if a value is a valid AgentIdentitySummary.
 */
export function isAgentIdentitySummary(
  value: unknown,
): value is AgentIdentitySummary {
  return (
    typeof value === "object" &&
    value !== null &&
    ("car" in value || "carId" in value) &&
    "did" in value &&
    "domains" in value &&
    "level" in value
  );
}
