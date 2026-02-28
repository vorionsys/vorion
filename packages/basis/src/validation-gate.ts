/**
 * BASIS Validation Gate
 *
 * Central validation gate that verifies agent manifests before execution.
 * Combines CAR parsing, schema validation, and capability matching.
 *
 * This gate returns PASS/REJECT decisions for the Kaizen pipeline.
 */

import { z } from "zod";
import { TrustTier, TIER_THRESHOLDS } from "./trust-factors.js";
import {
  hasCapability,
  getCapabilitiesForTier,
  type Capability,
} from "./trust-capabilities.js";

// =============================================================================
// VALIDATION GATE TYPES
// =============================================================================

/**
 * Gate decision - determines whether agent can proceed
 */
export enum GateDecision {
  /** Agent passes validation, proceed to Layer 2 */
  PASS = "PASS",
  /** Agent fails validation, block execution */
  REJECT = "REJECT",
  /** Agent requires human review before proceeding */
  ESCALATE = "ESCALATE",
}

/**
 * Validation error severity levels
 */
export enum ValidationSeverity {
  /** Informational - does not affect decision */
  INFO = "info",
  /** Warning - may affect future decisions */
  WARNING = "warning",
  /** Error - causes rejection */
  ERROR = "error",
  /** Critical - immediate rejection with logging */
  CRITICAL = "critical",
}

/**
 * A single validation issue
 */
export interface ValidationIssue {
  /** Unique code for this issue type */
  code: string;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Field path that caused the issue */
  path?: string;
  /** Expected value or format */
  expected?: string;
  /** Actual value received */
  actual?: string;
}

/**
 * Result of validation gate check
 */
export interface ValidationGateResult {
  /** Gate decision: PASS, REJECT, or ESCALATE */
  decision: GateDecision;
  /** Whether validation passed */
  valid: boolean;
  /** Agent identifier (CAR string or ID) */
  agentId: string;
  /** Agent's current trust tier */
  trustTier?: TrustTier;
  /** Agent's trust score (0-1000) */
  trustScore?: number;
  /** List of validation issues found */
  issues: ValidationIssue[];
  /** Summary of errors (severity=error or critical) */
  errors: ValidationIssue[];
  /** Summary of warnings */
  warnings: ValidationIssue[];
  /** Timestamp of validation */
  validatedAt: Date;
  /** Duration of validation in milliseconds */
  durationMs: number;
  /** Capabilities the agent is allowed to use */
  allowedCapabilities?: string[];
  /** Capabilities that were requested but denied */
  deniedCapabilities?: string[];
  /** Recommendations for improving validation result */
  recommendations?: string[];
}

/**
 * Agent manifest for validation
 */
export interface AgentManifest {
  /** Agent identifier (CAR string format preferred) */
  agentId: string;
  /** Organization/owner of the agent */
  organization?: string;
  /** Agent classification/type */
  agentClass?: string;
  /** Capability domains the agent claims */
  domains?: string[];
  /** Capability level claimed (L0-L7) */
  capabilityLevel?: number;
  /** Version string */
  version?: string;
  /** Current trust score (0-1000) */
  trustScore?: number;
  /** Capabilities the agent claims to need */
  requestedCapabilities?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Registered agent profile (from registry)
 */
export interface RegisteredProfile {
  /** Agent ID */
  agentId: string;
  /** Organization */
  organization: string;
  /** Agent class */
  agentClass: string;
  /** Approved domains */
  approvedDomains: string[];
  /** Maximum capability level */
  maxCapabilityLevel: number;
  /** Approved capabilities */
  approvedCapabilities: string[];
  /** Current trust score */
  trustScore: number;
  /** Registration date */
  registeredAt: Date;
  /** Last verification date */
  lastVerifiedAt?: Date;
}

/**
 * Options for validation gate
 */
export interface ValidationGateOptions {
  /** Strict mode - treat warnings as errors */
  strict?: boolean;
  /** Require registered profile match */
  requireRegisteredProfile?: boolean;
  /** Allow capability escalation request */
  allowCapabilityEscalation?: boolean;
  /** Custom domain requirements */
  requiredDomains?: string[];
  /** Minimum trust tier required */
  minimumTrustTier?: TrustTier;
  /** Custom validators to run */
  customValidators?: CustomValidator[];
}

/**
 * Custom validator function
 */
export type CustomValidator = (
  manifest: AgentManifest,
  profile?: RegisteredProfile,
) => ValidationIssue[];

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const validationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.nativeEnum(ValidationSeverity),
  path: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
});

export const agentManifestSchema = z.object({
  agentId: z.string().min(1),
  organization: z.string().optional(),
  agentClass: z.string().optional(),
  domains: z.array(z.string()).optional(),
  capabilityLevel: z.number().int().min(0).max(7).optional(),
  version: z.string().optional(),
  trustScore: z.number().min(0).max(1000).optional(),
  requestedCapabilities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const registeredProfileSchema = z.object({
  agentId: z.string(),
  organization: z.string(),
  agentClass: z.string(),
  approvedDomains: z.array(z.string()),
  maxCapabilityLevel: z.number().int().min(0).max(7),
  approvedCapabilities: z.array(z.string()),
  trustScore: z.number().min(0).max(1000),
  registeredAt: z.date(),
  lastVerifiedAt: z.date().optional(),
});

export const validationGateResultSchema = z.object({
  decision: z.nativeEnum(GateDecision),
  valid: z.boolean(),
  agentId: z.string(),
  trustTier: z.nativeEnum(TrustTier).optional(),
  trustScore: z.number().optional(),
  issues: z.array(validationIssueSchema),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
  validatedAt: z.date(),
  durationMs: z.number(),
  allowedCapabilities: z.array(z.string()).optional(),
  deniedCapabilities: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert trust score to trust tier
 */
export function scoreToTier(score: number): TrustTier {
  // Iterate through tiers in reverse order (highest first)
  const tiers = [
    TrustTier.T7_AUTONOMOUS,
    TrustTier.T6_CERTIFIED,
    TrustTier.T5_TRUSTED,
    TrustTier.T4_STANDARD,
    TrustTier.T3_MONITORED,
    TrustTier.T2_PROVISIONAL,
    TrustTier.T1_OBSERVED,
    TrustTier.T0_SANDBOX,
  ];

  for (const tier of tiers) {
    const thresholds = TIER_THRESHOLDS[tier];
    if (score >= thresholds.min && score <= thresholds.max) {
      return tier;
    }
  }
  return TrustTier.T0_SANDBOX;
}

/**
 * Validate CAR string format
 */
function validateCARFormat(agentId: string | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Handle undefined/empty agentId
  if (!agentId) {
    issues.push({
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
      severity: ValidationSeverity.ERROR,
      path: "agentId",
    });
    return issues;
  }

  // Basic CAR format: registry.org.class:DOMAINS-Ln@version
  const carRegex =
    /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])@(\d+\.\d+\.\d+)(?:#[a-z0-9,_-]+)?$/;

  if (!carRegex.test(agentId)) {
    // Check if it looks like a legacy format or just an ID
    if (agentId.includes(":") && agentId.includes("@")) {
      issues.push({
        code: "INVALID_CAR_FORMAT",
        message: "CAR string format is invalid",
        severity: ValidationSeverity.ERROR,
        path: "agentId",
        expected: "registry.org.class:DOMAINS-Ln@x.y.z",
        actual: agentId,
      });
    } else if (!agentId.includes(".")) {
      // Simple ID format - acceptable but noted
      issues.push({
        code: "SIMPLE_ID_FORMAT",
        message: "Agent uses simple ID format instead of full CAR string",
        severity: ValidationSeverity.INFO,
        path: "agentId",
      });
    }
  }

  return issues;
}

/**
 * Validate manifest against registered profile
 */
function validateAgainstProfile(
  manifest: AgentManifest,
  profile: RegisteredProfile,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check organization match
  if (manifest.organization && manifest.organization !== profile.organization) {
    issues.push({
      code: "ORG_MISMATCH",
      message: "Organization does not match registered profile",
      severity: ValidationSeverity.ERROR,
      path: "organization",
      expected: profile.organization,
      actual: manifest.organization,
    });
  }

  // Check agent class match
  if (manifest.agentClass && manifest.agentClass !== profile.agentClass) {
    issues.push({
      code: "CLASS_MISMATCH",
      message: "Agent class does not match registered profile",
      severity: ValidationSeverity.ERROR,
      path: "agentClass",
      expected: profile.agentClass,
      actual: manifest.agentClass,
    });
  }

  // Check capability level
  if (manifest.capabilityLevel !== undefined) {
    if (manifest.capabilityLevel > profile.maxCapabilityLevel) {
      issues.push({
        code: "CAPABILITY_LEVEL_EXCEEDED",
        message: "Claimed capability level exceeds registered maximum",
        severity: ValidationSeverity.ERROR,
        path: "capabilityLevel",
        expected: `<= ${profile.maxCapabilityLevel}`,
        actual: String(manifest.capabilityLevel),
      });
    }
  }

  // Check domains
  if (manifest.domains) {
    const unauthorizedDomains = manifest.domains.filter(
      (d) => !profile.approvedDomains.includes(d),
    );
    if (unauthorizedDomains.length > 0) {
      issues.push({
        code: "UNAUTHORIZED_DOMAINS",
        message: `Agent claims unauthorized domains: ${unauthorizedDomains.join(", ")}`,
        severity: ValidationSeverity.ERROR,
        path: "domains",
        expected: profile.approvedDomains.join(", "),
        actual: manifest.domains.join(", "),
      });
    }
  }

  // Check requested capabilities
  if (manifest.requestedCapabilities) {
    const unauthorizedCaps = manifest.requestedCapabilities.filter(
      (c) => !profile.approvedCapabilities.includes(c),
    );
    if (unauthorizedCaps.length > 0) {
      issues.push({
        code: "UNAUTHORIZED_CAPABILITIES",
        message: `Agent requests unauthorized capabilities: ${unauthorizedCaps.join(", ")}`,
        severity: ValidationSeverity.WARNING,
        path: "requestedCapabilities",
      });
    }
  }

  return issues;
}

/**
 * Validate trust tier requirements
 */
function validateTrustTier(
  manifest: AgentManifest,
  minimumTier?: TrustTier,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (manifest.trustScore === undefined) {
    issues.push({
      code: "MISSING_TRUST_SCORE",
      message: "Agent manifest does not include trust score",
      severity: ValidationSeverity.WARNING,
      path: "trustScore",
    });
    return issues;
  }

  const agentTier = scoreToTier(manifest.trustScore);

  if (minimumTier !== undefined) {
    // Compare numeric tier values directly (TrustTier is a numeric enum 0-7)
    if (agentTier < minimumTier) {
      issues.push({
        code: "INSUFFICIENT_TRUST_TIER",
        message: `Agent trust tier T${agentTier} is below minimum required T${minimumTier}`,
        severity: ValidationSeverity.ERROR,
        path: "trustScore",
        expected: `>= T${minimumTier}`,
        actual: `T${agentTier}`,
      });
    }
  }

  return issues;
}

/**
 * Validate requested capabilities against trust tier
 */
function validateCapabilitiesAgainstTier(manifest: AgentManifest): {
  issues: ValidationIssue[];
  allowed: string[];
  denied: string[];
} {
  const issues: ValidationIssue[] = [];
  const allowed: string[] = [];
  const denied: string[] = [];

  if (
    !manifest.requestedCapabilities ||
    manifest.requestedCapabilities.length === 0
  ) {
    return { issues, allowed, denied };
  }

  const trustScore = manifest.trustScore ?? 0;
  const agentTier = scoreToTier(trustScore);

  for (const capability of manifest.requestedCapabilities) {
    if (hasCapability(agentTier, capability)) {
      allowed.push(capability);
    } else {
      denied.push(capability);
      issues.push({
        code: "CAPABILITY_TIER_INSUFFICIENT",
        message: `Capability ${capability} requires higher trust tier than ${agentTier}`,
        severity: ValidationSeverity.WARNING,
        path: "requestedCapabilities",
        actual: capability,
      });
    }
  }

  return { issues, allowed, denied };
}

// =============================================================================
// MAIN VALIDATION GATE
// =============================================================================

/**
 * BASIS Validation Gate
 *
 * Validates an agent manifest and returns a PASS/REJECT/ESCALATE decision.
 *
 * @param manifest - Agent manifest to validate
 * @param profile - Optional registered profile for comparison
 * @param options - Validation options
 * @returns Validation result with decision
 *
 * @example
 * ```typescript
 * const result = validateAgent({
 *   agentId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
 *   trustScore: 450,
 *   requestedCapabilities: ['CAP-DB-READ', 'CAP-WRITE-APPROVED'],
 * });
 *
 * if (result.decision === GateDecision.PASS) {
 *   // Proceed to Layer 2 (INTENT)
 * } else if (result.decision === GateDecision.REJECT) {
 *   // Block execution, log reasons
 *   console.log('Rejected:', result.errors);
 * }
 * ```
 */
export function validateAgent(
  manifest: AgentManifest,
  profile?: RegisteredProfile,
  options: ValidationGateOptions = {},
): ValidationGateResult {
  const startTime = Date.now();
  const issues: ValidationIssue[] = [];

  // 1. Validate manifest schema
  const schemaResult = agentManifestSchema.safeParse(manifest);
  if (!schemaResult.success) {
    for (const error of schemaResult.error.errors) {
      issues.push({
        code: "SCHEMA_VALIDATION_FAILED",
        message: error.message,
        severity: ValidationSeverity.ERROR,
        path: error.path.join("."),
      });
    }
  }

  // 2. Validate CAR format (handles undefined agentId)
  const carIssues = validateCARFormat(manifest.agentId);
  issues.push(...carIssues);

  // If agentId is missing, short-circuit with early rejection
  if (carIssues.some((i) => i.code === "MISSING_AGENT_ID")) {
    return {
      decision: GateDecision.REJECT,
      valid: false,
      agentId: manifest.agentId ?? "unknown",
      issues,
      errors: issues.filter(
        (i) =>
          i.severity === ValidationSeverity.ERROR ||
          i.severity === ValidationSeverity.CRITICAL,
      ),
      warnings: issues.filter((i) => i.severity === ValidationSeverity.WARNING),
      validatedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Validate against registered profile
  if (profile) {
    issues.push(...validateAgainstProfile(manifest, profile));
  } else if (options.requireRegisteredProfile) {
    issues.push({
      code: "PROFILE_NOT_FOUND",
      message: "Agent must have a registered profile",
      severity: ValidationSeverity.ERROR,
      path: "agentId",
    });
  }

  // 4. Validate trust tier requirements
  issues.push(...validateTrustTier(manifest, options.minimumTrustTier));

  // 5. Validate required domains
  if (options.requiredDomains && options.requiredDomains.length > 0) {
    const agentDomains = manifest.domains || [];
    const missingDomains = options.requiredDomains.filter(
      (d) => !agentDomains.includes(d),
    );
    if (missingDomains.length > 0) {
      issues.push({
        code: "MISSING_REQUIRED_DOMAINS",
        message: `Agent missing required domains: ${missingDomains.join(", ")}`,
        severity: ValidationSeverity.ERROR,
        path: "domains",
        expected: options.requiredDomains.join(", "),
        actual: agentDomains.join(", ") || "none",
      });
    }
  }

  // 6. Validate capabilities against trust tier
  const capValidation = validateCapabilitiesAgainstTier(manifest);
  issues.push(...capValidation.issues);

  // 7. Run custom validators
  if (options.customValidators) {
    for (const validator of options.customValidators) {
      try {
        issues.push(...validator(manifest, profile));
      } catch (e) {
        issues.push({
          code: "CUSTOM_VALIDATOR_ERROR",
          message: `Custom validator failed: ${e instanceof Error ? e.message : String(e)}`,
          severity: ValidationSeverity.WARNING,
        });
      }
    }
  }

  // Separate errors and warnings
  const errors = issues.filter(
    (i) =>
      i.severity === ValidationSeverity.ERROR ||
      i.severity === ValidationSeverity.CRITICAL,
  );
  const warnings = issues.filter(
    (i) => i.severity === ValidationSeverity.WARNING,
  );

  // Determine decision
  let decision: GateDecision;
  let valid: boolean;

  const hasCritical = issues.some(
    (i) => i.severity === ValidationSeverity.CRITICAL,
  );
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (hasCritical || hasErrors) {
    decision = GateDecision.REJECT;
    valid = false;
  } else if (options.strict && hasWarnings) {
    decision = GateDecision.REJECT;
    valid = false;
  } else if (
    !options.strict &&
    hasWarnings &&
    capValidation.denied.length > 0
  ) {
    // Agent wants capabilities they can't have - escalate for review
    decision = options.allowCapabilityEscalation
      ? GateDecision.ESCALATE
      : GateDecision.REJECT;
    valid = decision === GateDecision.ESCALATE;
  } else {
    decision = GateDecision.PASS;
    valid = true;
  }

  // Build recommendations
  const recommendations: string[] = [];
  if (capValidation.denied.length > 0) {
    recommendations.push(
      `Increase trust score to access denied capabilities: ${capValidation.denied.join(", ")}`,
    );
  }
  if (!profile && !options.requireRegisteredProfile) {
    recommendations.push(
      "Consider registering agent profile for enhanced validation",
    );
  }

  // Calculate trust tier
  const trustTier =
    manifest.trustScore !== undefined
      ? scoreToTier(manifest.trustScore)
      : undefined;

  return {
    decision,
    valid,
    agentId: manifest.agentId,
    trustTier,
    trustScore: manifest.trustScore,
    issues,
    errors,
    warnings,
    validatedAt: new Date(),
    durationMs: Date.now() - startTime,
    allowedCapabilities:
      capValidation.allowed.length > 0 ? capValidation.allowed : undefined,
    deniedCapabilities:
      capValidation.denied.length > 0 ? capValidation.denied : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

/**
 * Quick validation check - returns boolean
 */
export function isValidAgent(
  manifest: AgentManifest,
  profile?: RegisteredProfile,
  options?: ValidationGateOptions,
): boolean {
  return validateAgent(manifest, profile, options).valid;
}

/**
 * Create a validation gate with preset options
 */
export function createValidationGate(defaultOptions: ValidationGateOptions) {
  return {
    validate: (
      manifest: AgentManifest,
      profile?: RegisteredProfile,
      options?: ValidationGateOptions,
    ) => validateAgent(manifest, profile, { ...defaultOptions, ...options }),
    isValid: (
      manifest: AgentManifest,
      profile?: RegisteredProfile,
      options?: ValidationGateOptions,
    ) => isValidAgent(manifest, profile, { ...defaultOptions, ...options }),
  };
}

/**
 * Strict validation gate - treats warnings as errors
 */
export const strictValidationGate = createValidationGate({ strict: true });

/**
 * Production validation gate - requires registered profile
 */
export const productionValidationGate = createValidationGate({
  requireRegisteredProfile: true,
  minimumTrustTier: TrustTier.T2_PROVISIONAL,
});
