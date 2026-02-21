/**
 * @fileoverview CAR JWT Claims for OpenID Connect
 *
 * Defines JWT claim structures for CAR-aware authentication and authorization.
 * These claims extend standard OIDC claims with CAR-specific information,
 * enabling capability-based access control in JWT tokens.
 *
 * @module @vorionsys/contracts/car/jwt-claims
 */

import { z } from 'zod';
import { type DomainCode, domainCodeArraySchema, CAPABILITY_DOMAINS } from './domains.js';
import { CapabilityLevel, capabilityLevelSchema } from './levels.js';
import { CertificationTier, certificationTierSchema, RuntimeTier, runtimeTierSchema } from './tiers.js';
import { type ParsedCAR } from './car-string.js';

// ============================================================================
// Standard JWT Claims
// ============================================================================

/**
 * Standard JWT claims (RFC 7519).
 */
export interface StandardJWTClaims {
  /** Issuer */
  iss?: string;
  /** Subject */
  sub?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Not before (Unix timestamp) */
  nbf?: number;
  /** Issued at (Unix timestamp) */
  iat?: number;
  /** JWT ID */
  jti?: string;
}

/**
 * Zod schema for StandardJWTClaims.
 */
export const standardJWTClaimsSchema = z.object({
  iss: z.string().optional(),
  sub: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().int().positive().optional(),
  nbf: z.number().int().positive().optional(),
  iat: z.number().int().positive().optional(),
  jti: z.string().optional(),
});

// ============================================================================
// CAR JWT Claims
// ============================================================================

/**
 * CAR-specific JWT claims.
 *
 * These claims encode agent capabilities in JWT tokens for use in
 * authentication and authorization flows.
 *
 * NOTE: `car_trust` is OPTIONAL because trust tier is NOT embedded in the CAR.
 * Trust comes from attestations at runtime. If attestations are included,
 * the highest valid attestation tier should be used for `car_trust`.
 */
export interface CARJWTClaims extends StandardJWTClaims {
  /** Full CAR string (immutable identifier, no trust info) */
  car: string;
  /** @deprecated Use car instead */
  carId?: string;
  /** Domain bitmask for efficient validation */
  car_domains: number;
  /** @deprecated Use car_domains instead */
  carId_domains?: number;
  /** Domain codes array for readability */
  car_domains_list: DomainCode[];
  /** @deprecated Use car_domains_list instead */
  carId_domains_list?: DomainCode[];
  /** Capability level */
  car_level: CapabilityLevel;
  /** @deprecated Use car_level instead */
  carId_level?: CapabilityLevel;
  /**
   * Certification tier from attestations (OPTIONAL).
   * This is NOT from the CAR itself - it comes from valid attestations.
   * Defaults to T0 if no attestations exist.
   */
  car_trust?: CertificationTier;
  /** @deprecated Use car_trust instead */
  carId_trust?: CertificationTier;
  /** Registry */
  car_registry: string;
  /** @deprecated Use car_registry instead */
  carId_registry?: string;
  /** Organization */
  car_org: string;
  /** @deprecated Use car_org instead */
  carId_org?: string;
  /** Agent class */
  car_class: string;
  /** @deprecated Use car_class instead */
  carId_class?: string;
  /** CAR version */
  car_version: string;
  /** @deprecated Use car_version instead */
  carId_version?: string;
  /** Agent DID (optional) */
  car_did?: string;
  /** @deprecated Use car_did instead */
  carId_did?: string;
  /** Runtime tier in current context (optional) */
  car_runtime_tier?: RuntimeTier;
  /** @deprecated Use car_runtime_tier instead */
  carId_runtime_tier?: RuntimeTier;
  /** Attestation summaries - source of car_trust value */
  car_attestations?: CARAttestationClaim[];
  /** @deprecated Use car_attestations instead */
  carId_attestations?: CARAttestationClaim[];
  /** Effective permission ceiling (optional) */
  car_permission_ceiling?: number;
  /** @deprecated Use car_permission_ceiling instead */
  carId_permission_ceiling?: number;
  /** Session-specific constraints (optional) */
  car_constraints?: CARConstraintsClaim;
  /** @deprecated Use car_constraints instead */
  carId_constraints?: CARConstraintsClaim;
}

/** @deprecated Use CARJWTClaims instead */
export type ACIJWTClaims = CARJWTClaims;

/**
 * Attestation claim for JWT.
 * Attestations are the SOURCE of trust tier, not the CAR.
 */
export interface CARAttestationClaim {
  /** Issuer DID */
  iss: string;
  /** Certified trust tier from this attestation */
  tier: CertificationTier;
  /** Attestation scope (domains covered) */
  scope: string;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
  /** Evidence URL (optional) */
  evidence?: string;
}

/** @deprecated Use CARAttestationClaim instead */
export type ACIAttestationClaim = CARAttestationClaim;

/**
 * Constraints claim for session-specific limitations.
 */
export interface CARConstraintsClaim {
  /** Maximum operations allowed in this session */
  max_operations?: number;
  /** Allowed resource patterns */
  allowed_resources?: string[];
  /** Blocked resource patterns */
  blocked_resources?: string[];
  /** Time window end (Unix timestamp) */
  valid_until?: number;
  /** Required human approval for actions */
  requires_approval?: boolean;
  /** Custom constraints */
  custom?: Record<string, unknown>;
}

/** @deprecated Use CARConstraintsClaim instead */
export type ACIConstraintsClaim = CARConstraintsClaim;

/**
 * Zod schema for CARAttestationClaim.
 */
export const carAttestationClaimSchema = z.object({
  iss: z.string().min(1),
  tier: certificationTierSchema,
  scope: z.string().min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  evidence: z.string().url().optional(),
});

/** @deprecated Use carAttestationClaimSchema instead */
export const aciAttestationClaimSchema = carAttestationClaimSchema;

/**
 * Zod schema for CARConstraintsClaim.
 */
export const carConstraintsClaimSchema = z.object({
  max_operations: z.number().int().positive().optional(),
  allowed_resources: z.array(z.string()).optional(),
  blocked_resources: z.array(z.string()).optional(),
  valid_until: z.number().int().positive().optional(),
  requires_approval: z.boolean().optional(),
  custom: z.record(z.unknown()).optional(),
});

/** @deprecated Use carConstraintsClaimSchema instead */
export const aciConstraintsClaimSchema = carConstraintsClaimSchema;

/**
 * Zod schema for CARJWTClaims validation.
 */
export const carJWTClaimsSchema = standardJWTClaimsSchema.extend({
  car: z.string().min(1),
  carId: z.string().min(1).optional(),
  car_domains: z.number().int().min(0),
  carId_domains: z.number().int().min(0).optional(),
  car_domains_list: domainCodeArraySchema,
  carId_domains_list: domainCodeArraySchema.optional(),
  car_level: capabilityLevelSchema,
  carId_level: capabilityLevelSchema.optional(),
  car_trust: certificationTierSchema.optional(),
  carId_trust: certificationTierSchema.optional(),
  car_registry: z.string().min(1),
  carId_registry: z.string().min(1).optional(),
  car_org: z.string().min(1),
  carId_org: z.string().min(1).optional(),
  car_class: z.string().min(1),
  carId_class: z.string().min(1).optional(),
  car_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  carId_version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  car_did: z.string().optional(),
  carId_did: z.string().optional(),
  car_runtime_tier: runtimeTierSchema.optional(),
  carId_runtime_tier: runtimeTierSchema.optional(),
  car_attestations: z.array(carAttestationClaimSchema).optional(),
  carId_attestations: z.array(carAttestationClaimSchema).optional(),
  car_permission_ceiling: z.number().int().min(0).max(7).optional(),
  carId_permission_ceiling: z.number().int().min(0).max(7).optional(),
  car_constraints: carConstraintsClaimSchema.optional(),
  carId_constraints: carConstraintsClaimSchema.optional(),
});

/** @deprecated Use carJWTClaimsSchema instead */
export const aciJWTClaimsSchema = carJWTClaimsSchema;

// ============================================================================
// JWT Claims Generation
// ============================================================================

/**
 * Options for generating JWT claims.
 */
export interface GenerateJWTClaimsOptions {
  /** Parsed CAR */
  parsed: ParsedCAR;
  /** Agent DID (optional) */
  did?: string;
  /** Issuer (optional) */
  issuer?: string;
  /** Audience (optional) */
  audience?: string | string[];
  /** Validity duration in seconds (default: 1 hour) */
  validitySeconds?: number;
  /** Runtime tier (optional) */
  runtimeTier?: RuntimeTier;
  /** Attestation claims (optional) */
  attestations?: CARAttestationClaim[];
  /** Permission ceiling (optional) */
  permissionCeiling?: number;
  /** Constraints (optional) */
  constraints?: CARConstraintsClaim;
}

/**
 * Generates JWT claims from a parsed CAR.
 *
 * @param options - Generation options
 * @returns CAR JWT claims
 *
 * @example
 * ```typescript
 * const claims = generateJWTClaims({
 *   parsed: parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'),
 *   did: 'did:web:agent.acme.com',
 *   issuer: 'did:web:auth.acme.com',
 *   validitySeconds: 3600,
 * });
 * ```
 */
export function generateJWTClaims(options: GenerateJWTClaimsOptions): CARJWTClaims {
  const {
    parsed,
    did,
    issuer,
    audience,
    validitySeconds = 3600,
    runtimeTier,
    attestations,
    permissionCeiling,
    constraints,
  } = options;

  const now = Math.floor(Date.now() / 1000);

  return {
    // Standard claims
    iss: issuer,
    sub: did ?? parsed.car,
    aud: audience,
    iat: now,
    nbf: now,
    exp: now + validitySeconds,
    jti: crypto.randomUUID(),

    // CAR claims (identity only - trust comes from attestations)
    car: parsed.car,
    carId: parsed.car, // backwards compat
    car_domains: parsed.domainsBitmask,
    carId_domains: parsed.domainsBitmask, // backwards compat
    car_domains_list: [...parsed.domains],
    carId_domains_list: [...parsed.domains], // backwards compat
    car_level: parsed.level,
    carId_level: parsed.level, // backwards compat
    // NOTE: car_trust is derived from attestations, not the CAR
    car_trust: attestations && attestations.length > 0
      ? (Math.max(...attestations.map((a) => a.tier)) as CertificationTier)
      : undefined,
    carId_trust: attestations && attestations.length > 0
      ? (Math.max(...attestations.map((a) => a.tier)) as CertificationTier)
      : undefined, // backwards compat
    car_registry: parsed.registry,
    carId_registry: parsed.registry, // backwards compat
    car_org: parsed.organization,
    carId_org: parsed.organization, // backwards compat
    car_class: parsed.agentClass,
    carId_class: parsed.agentClass, // backwards compat
    car_version: parsed.version,
    carId_version: parsed.version, // backwards compat
    car_did: did,
    carId_did: did, // backwards compat
    car_runtime_tier: runtimeTier,
    carId_runtime_tier: runtimeTier, // backwards compat
    car_attestations: attestations,
    carId_attestations: attestations, // backwards compat
    car_permission_ceiling: permissionCeiling,
    carId_permission_ceiling: permissionCeiling, // backwards compat
    car_constraints: constraints,
    carId_constraints: constraints, // backwards compat
  };
}

/**
 * Generates minimal JWT claims from a parsed CAR.
 *
 * NOTE: car_trust is NOT included because trust comes from attestations,
 * not the CAR itself. Use generateJWTClaims with attestations for full claims.
 *
 * @param parsed - Parsed CAR
 * @param did - Optional agent DID
 * @returns Minimal CAR JWT claims (without trust tier)
 */
export function generateMinimalJWTClaims(parsed: ParsedCAR, did?: string): CARJWTClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    iat: now,
    car: parsed.car,
    carId: parsed.car, // backwards compat
    car_domains: parsed.domainsBitmask,
    carId_domains: parsed.domainsBitmask, // backwards compat
    car_domains_list: [...parsed.domains],
    carId_domains_list: [...parsed.domains], // backwards compat
    car_level: parsed.level,
    carId_level: parsed.level, // backwards compat
    // car_trust intentionally omitted - comes from attestations at runtime
    car_registry: parsed.registry,
    carId_registry: parsed.registry, // backwards compat
    car_org: parsed.organization,
    carId_org: parsed.organization, // backwards compat
    car_class: parsed.agentClass,
    carId_class: parsed.agentClass, // backwards compat
    car_version: parsed.version,
    carId_version: parsed.version, // backwards compat
    car_did: did,
    carId_did: did, // backwards compat
  };
}

// ============================================================================
// JWT Claims Validation
// ============================================================================

/**
 * Validation error for JWT claims.
 */
export interface JWTClaimsValidationError {
  /** Error code */
  code: JWTClaimsErrorCode;
  /** Human-readable message */
  message: string;
  /** Claim path (if applicable) */
  path?: string;
}

/**
 * Error codes for JWT claims validation.
 */
export type JWTClaimsErrorCode =
  | 'MISSING_CAR'
  | 'INVALID_CAR'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'INVALID_DOMAINS'
  | 'INVALID_LEVEL'
  | 'INVALID_TIER'
  | 'DOMAINS_MISMATCH'
  | 'INVALID_FORMAT';

/**
 * Result of JWT claims validation.
 */
export interface JWTClaimsValidationResult {
  /** Whether the claims are valid */
  valid: boolean;
  /** Validation errors */
  errors: JWTClaimsValidationError[];
  /** Validated claims (if valid) */
  claims?: CARJWTClaims;
}

/**
 * Validates CAR JWT claims.
 *
 * @param claims - Claims to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateJWTClaims(claims, {
 *   checkExpiry: true,
 *   validateDomainsMismatch: true,
 * });
 * ```
 */
export function validateJWTClaims(
  claims: unknown,
  options: {
    checkExpiry?: boolean;
    validateDomainsMismatch?: boolean;
  } = {}
): JWTClaimsValidationResult {
  const errors: JWTClaimsValidationError[] = [];
  const { checkExpiry = true, validateDomainsMismatch = true } = options;

  // Parse with Zod
  const parseResult = carJWTClaimsSchema.safeParse(claims);

  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.issues.map((issue) => ({
        code: 'INVALID_FORMAT' as const,
        message: issue.message,
        path: issue.path.join('.'),
      })),
    };
  }

  const parsed = parseResult.data;
  const now = Math.floor(Date.now() / 1000);

  // Check expiry
  if (checkExpiry) {
    if (parsed.exp && parsed.exp < now) {
      errors.push({
        code: 'EXPIRED',
        message: `Token expired at ${new Date(parsed.exp * 1000).toISOString()}`,
      });
    }

    if (parsed.nbf && parsed.nbf > now) {
      errors.push({
        code: 'NOT_YET_VALID',
        message: `Token not valid until ${new Date(parsed.nbf * 1000).toISOString()}`,
      });
    }
  }

  // Validate domains bitmask matches domains list
  if (validateDomainsMismatch) {
    const bits = Object.fromEntries(
      Object.entries(CAPABILITY_DOMAINS).map(([code, def]) => [code, def.bit])
    ) as Record<DomainCode, number>;
    const expectedBitmask = parsed.car_domains_list.reduce((mask, code) => {
      return mask | bits[code];
    }, 0);

    if (expectedBitmask !== parsed.car_domains) {
      errors.push({
        code: 'DOMAINS_MISMATCH',
        message: `Domain bitmask ${parsed.car_domains} does not match domains list (expected ${expectedBitmask})`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    claims: errors.length === 0 ? parsed : undefined,
  };
}

// ============================================================================
// JWT Claims Extraction
// ============================================================================

/**
 * Extracts capability information from JWT claims.
 *
 * NOTE: certificationTier is optional because it comes from attestations,
 * not the CAR. If no attestations are present, it will be undefined.
 *
 * @param claims - CAR JWT claims
 * @returns Capability information
 */
export function extractCapabilityFromClaims(claims: CARJWTClaims): {
  domains: DomainCode[];
  domainsBitmask: number;
  level: CapabilityLevel;
  certificationTier?: CertificationTier;
  runtimeTier?: RuntimeTier;
} {
  return {
    domains: claims.car_domains_list,
    domainsBitmask: claims.car_domains,
    level: claims.car_level,
    certificationTier: claims.car_trust, // Optional - from attestations
    runtimeTier: claims.car_runtime_tier,
  };
}

/**
 * Extracts identity information from JWT claims.
 *
 * @param claims - CAR JWT claims
 * @returns Identity information
 */
export function extractIdentityFromClaims(claims: CARJWTClaims): {
  car: string;
  did?: string;
  registry: string;
  organization: string;
  agentClass: string;
  version: string;
} {
  return {
    car: claims.car,
    did: claims.car_did,
    registry: claims.car_registry,
    organization: claims.car_org,
    agentClass: claims.car_class,
    version: claims.car_version,
  };
}

/**
 * Checks if claims have specific domain capability.
 *
 * @param claims - CAR JWT claims
 * @param domain - Domain to check
 * @returns True if the domain is present
 */
export function claimsHaveDomain(claims: CARJWTClaims, domain: DomainCode): boolean {
  return (claims.car_domains & CAPABILITY_DOMAINS[domain].bit) !== 0;
}

/**
 * Checks if claims meet minimum capability requirements.
 *
 * @param claims - CAR JWT claims
 * @param requirements - Minimum requirements
 * @returns True if requirements are met
 */
export function claimsMeetRequirements(
  claims: CARJWTClaims,
  requirements: {
    domains?: DomainCode[];
    minLevel?: CapabilityLevel;
    minCertificationTier?: CertificationTier;
    minRuntimeTier?: RuntimeTier;
  }
): boolean {
  // Check domains
  if (requirements.domains) {
    for (const domain of requirements.domains) {
      if (!claimsHaveDomain(claims, domain)) {
        return false;
      }
    }
  }

  // Check level
  if (requirements.minLevel !== undefined && claims.car_level < requirements.minLevel) {
    return false;
  }

  // Check certification tier (comes from attestations, may be undefined)
  if (requirements.minCertificationTier !== undefined) {
    // If no attestation-based trust, treat as T0 (sandbox)
    const effectiveTrust = claims.car_trust ?? CertificationTier.T0_SANDBOX;
    if (effectiveTrust < requirements.minCertificationTier) {
      return false;
    }
  }

  // Check runtime tier
  if (
    requirements.minRuntimeTier !== undefined &&
    claims.car_runtime_tier !== undefined &&
    claims.car_runtime_tier < requirements.minRuntimeTier
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Zod schema for JWT claims validation options.
 */
export const jwtClaimsValidationOptionsSchema = z.object({
  checkExpiry: z.boolean().optional(),
  validateDomainsMismatch: z.boolean().optional(),
});

/**
 * Zod schema for JWTClaimsValidationError.
 */
export const jwtClaimsValidationErrorSchema = z.object({
  code: z.enum([
    'MISSING_CAR',
    'INVALID_CAR',
    'EXPIRED',
    'NOT_YET_VALID',
    'INVALID_DOMAINS',
    'INVALID_LEVEL',
    'INVALID_TIER',
    'DOMAINS_MISMATCH',
    'INVALID_FORMAT',
  ]),
  message: z.string(),
  path: z.string().optional(),
});

/**
 * Zod schema for JWTClaimsValidationResult.
 */
export const jwtClaimsValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(jwtClaimsValidationErrorSchema),
  claims: carJWTClaimsSchema.optional(),
});
