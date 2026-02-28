/**
 * @fileoverview CAR String Parser and Generator
 *
 * Provides parsing, generation, and validation for Categorical Agent
 * Registry (CAR) strings. CAR strings follow the format:
 *
 *   `{registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]`
 *
 * Example: `a3i.acme-corp.invoice-bot:ABF-L3@1.0.0`
 *
 * **CRITICAL DESIGN PRINCIPLE:**
 * The CAR is an IMMUTABLE identifier (like a certificate or passport number).
 * Trust is NOT encoded in the CAR - it is computed at RUNTIME based on:
 * - Attestations (stored separately)
 * - Behavioral signals
 * - Deployment context policies
 *
 * The optional extensions (section 5+) are mutable and can be defined by
 * industry or community standards.
 *
 * @module @vorionsys/contracts/car/car-string
 */

import { z } from "zod";
import {
  type DomainCode,
  domainCodeSchema,
  encodeDomains,
  formatDomainString,
  isDomainCode,
} from "./domains.js";
import { CapabilityLevel, isCapabilityLevel } from "./levels.js";

// ============================================================================
// CAR Regex Pattern
// ============================================================================

/**
 * Regular expression for parsing CAR strings.
 *
 * Format: `{registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]`
 *
 * Groups:
 * 1. registry - Certifying registry (e.g., 'a3i')
 * 2. organization - Operating organization (e.g., 'acme-corp')
 * 3. agentClass - Agent classification (e.g., 'invoice-bot')
 * 4. domains - Capability domain codes (e.g., 'ABF')
 * 5. level - Autonomy level (0-7)
 * 6. version - Semantic version (e.g., '1.0.0')
 * 7. extensions - Optional comma-separated extensions (e.g., 'gov,audit')
 *
 * NOTE: Trust tier is NOT part of the CAR. Trust is computed at runtime
 * from attestations, behavioral signals, and deployment context.
 */
export const CAR_REGEX =
  /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])@(\d+\.\d+\.\d+)(?:#([a-z0-9,_-]+))?$/;

/**
 * Looser regex for partial CAR validation.
 */
export const CAR_PARTIAL_REGEX =
  /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])(@\d+\.\d+\.\d+)?(?:#([a-z0-9,_-]+))?$/;

/**
 * Legacy regex for parsing old-format CAR strings that include trust tier.
 * Used for migration/compatibility only.
 * @deprecated Use CAR_REGEX instead - trust tier should not be in the identifier
 */
export const CAR_LEGACY_REGEX =
  /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])-T([0-7])@(\d+\.\d+\.\d+)$/;

// Legacy CAR ID aliases for backwards compatibility
/** @deprecated Use CAR_REGEX instead */
export const ACI_REGEX = CAR_REGEX;
/** @deprecated Use CAR_PARTIAL_REGEX instead */
export const ACI_PARTIAL_REGEX = CAR_PARTIAL_REGEX;
/** @deprecated Use CAR_LEGACY_REGEX instead */
export const ACI_LEGACY_REGEX = CAR_LEGACY_REGEX;

// ============================================================================
// Parsed CAR Interface
// ============================================================================

/**
 * Parsed components of a CAR string.
 *
 * NOTE: Trust tier is NOT included because the CAR is an immutable identifier.
 * Trust is computed at runtime from:
 * - Attestations (external certifications)
 * - Behavioral signals (runtime observations)
 * - Deployment context policies
 */
export interface ParsedCAR {
  /** Full CAR string */
  readonly car: string;
  /** Certifying registry (e.g., 'a3i') */
  readonly registry: string;
  /** Operating organization */
  readonly organization: string;
  /** Agent classification */
  readonly agentClass: string;
  /** Capability domain codes */
  readonly domains: readonly DomainCode[];
  /** Domain bitmask for efficient queries */
  readonly domainsBitmask: number;
  /** Autonomy/capability level */
  readonly level: CapabilityLevel;
  /** Semantic version string */
  readonly version: string;
  /** Optional extensions (mutable, industry/community defined) */
  readonly extensions: readonly string[];
}

/**
 * @deprecated Use ParsedCAR instead
 */
export interface ParsedACI extends ParsedCAR {
  /** @deprecated Use car instead */
  readonly carId: string;
}

/**
 * Unique identity portion of the CAR (immutable core).
 * Format: {registry}.{organization}.{agentClass}
 */
export type CARIdentity = `${string}.${string}.${string}`;

/**
 * @deprecated Use CARIdentity instead
 */
export type ACIIdentity = CARIdentity;

/**
 * Extracts the identity portion from a parsed CAR.
 */
export function getCARIdentity(parsed: ParsedCAR): CARIdentity {
  return `${parsed.registry}.${parsed.organization}.${parsed.agentClass}` as CARIdentity;
}

/**
 * @deprecated Use getCARIdentity instead
 */
export function getACIIdentity(parsed: ParsedCAR): CARIdentity {
  return getCARIdentity(parsed);
}

/**
 * Zod schema for ParsedCAR validation.
 */
export const parsedCARSchema = z.object({
  car: z.string().min(1),
  registry: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+$/),
  organization: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  agentClass: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  domains: z.array(domainCodeSchema).min(1),
  domainsBitmask: z.number().int().min(0),
  level: z.nativeEnum(CapabilityLevel),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  extensions: z.array(z.string()).default([]),
});

/** @deprecated Use parsedCARSchema instead */
export const parsedACISchema = parsedCARSchema;

// ============================================================================
// CAR Parse Error
// ============================================================================

/**
 * Error thrown when CAR parsing fails.
 */
export class CARParseError extends Error {
  /** The invalid CAR string that caused the error */
  public readonly car: string;
  /** Error code for programmatic handling */
  public readonly code: CARParseErrorCode;

  constructor(
    message: string,
    car: string,
    code: CARParseErrorCode = "INVALID_FORMAT",
  ) {
    super(message);
    this.name = "CARParseError";
    this.car = car;
    this.code = code;
  }
}

/**
 * @deprecated Use CARParseError instead
 */
export class ACIParseError extends CARParseError {
  /** @deprecated Use car instead */
  public readonly carId: string;

  constructor(
    message: string,
    carId: string,
    code: CARParseErrorCode = "INVALID_FORMAT",
  ) {
    super(message, carId, code);
    this.name = "ACIParseError";
    this.carId = carId;
  }
}

/**
 * Error codes for CAR parse errors.
 */
export type CARParseErrorCode =
  | "INVALID_FORMAT"
  | "INVALID_REGISTRY"
  | "INVALID_ORGANIZATION"
  | "INVALID_AGENT_CLASS"
  | "INVALID_DOMAINS"
  | "NO_DOMAINS"
  | "INVALID_LEVEL"
  | "INVALID_VERSION"
  | "INVALID_EXTENSIONS"
  | "LEGACY_FORMAT";

/** @deprecated Use CARParseErrorCode instead */
export type ACIParseErrorCode = CARParseErrorCode;

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parses a CAR string into its components.
 *
 * @param car - The CAR string to parse
 * @returns Parsed CAR components
 * @throws CARParseError if the CAR string is invalid
 *
 * @example
 * ```typescript
 * const parsed = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');
 * // {
 * //   car: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
 * //   registry: 'a3i',
 * //   organization: 'acme-corp',
 * //   agentClass: 'invoice-bot',
 * //   domains: ['A', 'B', 'F'],
 * //   domainsBitmask: 0x023,
 * //   level: CapabilityLevel.L3_EXECUTE,
 * //   version: '1.0.0',
 * //   extensions: []
 * // }
 * ```
 */
export function parseCAR(car: string): ParsedCAR {
  // Check for legacy format with embedded trust tier
  if (CAR_LEGACY_REGEX.test(car)) {
    throw new CARParseError(
      `Legacy CAR format detected with embedded trust tier. ` +
        `Trust should not be part of the identifier - use parseLegacyCAR() for migration.`,
      car,
      "LEGACY_FORMAT",
    );
  }

  const match = car.match(CAR_REGEX);

  if (!match) {
    throw new CARParseError(
      `Invalid CAR format: ${car}`,
      car,
      "INVALID_FORMAT",
    );
  }

  const [
    ,
    registry,
    organization,
    agentClass,
    domainsStr,
    levelStr,
    version,
    extensionsStr,
  ] = match;

  // Validate and parse domains
  const domainChars = domainsStr!.split("");
  const invalidDomains = domainChars.filter((d) => !isDomainCode(d));

  if (invalidDomains.length > 0) {
    throw new CARParseError(
      `Invalid domain codes: ${invalidDomains.join(", ")}`,
      car,
      "INVALID_DOMAINS",
    );
  }

  if (domainChars.length === 0) {
    throw new CARParseError(
      "CAR must have at least one domain",
      car,
      "NO_DOMAINS",
    );
  }

  const domains = domainChars as DomainCode[];
  const domainsBitmask = encodeDomains(domains);

  // Parse level (no tier - trust is computed at runtime)
  const level = parseInt(levelStr!, 10) as CapabilityLevel;

  // Parse optional extensions
  const extensions = extensionsStr
    ? extensionsStr.split(",").filter((e) => e.length > 0)
    : [];

  return {
    car,
    registry: registry!,
    organization: organization!,
    agentClass: agentClass!,
    domains,
    domainsBitmask,
    level,
    version: version!,
    extensions,
  };
}

/**
 * @deprecated Use parseCAR instead
 */
export function parseACI(carId: string): ParsedCAR & { carId: string } {
  const parsed = parseCAR(carId);
  return { ...parsed, carId: parsed.car };
}

/**
 * Parses a legacy CAR string that includes trust tier.
 * Returns the parsed CAR (without tier) plus the extracted tier value.
 *
 * @deprecated Use parseCAR() - trust should not be in the identifier
 * @param car - Legacy CAR string with embedded tier
 * @returns Parsed CAR plus extracted tier
 */
export function parseLegacyCAR(car: string): {
  parsed: ParsedCAR;
  legacyTier: number;
} {
  const match = car.match(CAR_LEGACY_REGEX);

  if (!match) {
    throw new CARParseError(
      `Invalid legacy CAR format: ${car}`,
      car,
      "INVALID_FORMAT",
    );
  }

  const [
    ,
    registry,
    organization,
    agentClass,
    domainsStr,
    levelStr,
    tierStr,
    version,
  ] = match;

  // Validate and parse domains
  const domainChars = domainsStr!.split("");
  const invalidDomains = domainChars.filter((d) => !isDomainCode(d));

  if (invalidDomains.length > 0) {
    throw new CARParseError(
      `Invalid domain codes: ${invalidDomains.join(", ")}`,
      car,
      "INVALID_DOMAINS",
    );
  }

  const domains = domainChars as DomainCode[];
  const domainsBitmask = encodeDomains(domains);
  const level = parseInt(levelStr!, 10) as CapabilityLevel;
  const legacyTier = parseInt(tierStr!, 10);

  // Generate the new CAR format (without tier)
  const newCar = `${registry}.${organization}.${agentClass}:${formatDomainString(domains)}-L${level}@${version}`;

  return {
    parsed: {
      car: newCar,
      registry: registry!,
      organization: organization!,
      agentClass: agentClass!,
      domains,
      domainsBitmask,
      level,
      version: version!,
      extensions: [],
    },
    legacyTier,
  };
}

/**
 * @deprecated Use parseLegacyCAR instead
 */
export function parseLegacyACI(carId: string): {
  parsed: ParsedCAR & { carId: string };
  legacyTier: number;
} {
  const result = parseLegacyCAR(carId);
  return {
    parsed: { ...result.parsed, carId: result.parsed.car },
    legacyTier: result.legacyTier,
  };
}

/**
 * Safely parses a CAR string, returning null on failure.
 *
 * @param car - The CAR string to parse
 * @returns Parsed CAR or null if invalid
 */
export function tryParseCAR(car: string): ParsedCAR | null {
  try {
    return parseCAR(car);
  } catch {
    return null;
  }
}

/**
 * @deprecated Use tryParseCAR instead
 */
export function tryParseACI(
  carId: string,
): (ParsedCAR & { carId: string }) | null {
  try {
    return parseACI(carId);
  } catch {
    return null;
  }
}

/**
 * Safely parses a CAR string, returning a result object.
 *
 * @param car - The CAR string to parse
 * @returns Result object with success flag and parsed CAR or error
 */
export function safeParseCAR(
  car: string,
):
  | { success: true; data: ParsedCAR }
  | { success: false; error: CARParseError } {
  try {
    return { success: true, data: parseCAR(car) };
  } catch (error) {
    if (error instanceof CARParseError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new CARParseError(String(error), car, "INVALID_FORMAT"),
    };
  }
}

/**
 * @deprecated Use safeParseCAR instead
 */
export function safeParseACI(
  carId: string,
):
  | { success: true; data: ParsedCAR & { carId: string } }
  | { success: false; error: CARParseError } {
  try {
    return { success: true, data: parseACI(carId) };
  } catch (error) {
    if (error instanceof CARParseError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new CARParseError(String(error), carId, "INVALID_FORMAT"),
    };
  }
}

// ============================================================================
// Generation Functions
// ============================================================================

/**
 * Options for generating a CAR string.
 *
 * NOTE: Trust tier is NOT included because CAR is an immutable identifier.
 * Trust is computed at runtime from attestations and behavioral signals.
 */
export interface GenerateCAROptions {
  /** Certifying registry (e.g., 'a3i') */
  registry: string;
  /** Operating organization */
  organization: string;
  /** Agent classification */
  agentClass: string;
  /** Capability domains */
  domains: readonly DomainCode[];
  /** Autonomy level */
  level: CapabilityLevel;
  /** Semantic version */
  version: string;
  /** Optional extensions (mutable, industry/community defined) */
  extensions?: readonly string[];
}

/** @deprecated Use GenerateCAROptions instead */
export type GenerateACIOptions = GenerateCAROptions;

/**
 * Generates a CAR string from components.
 *
 * @param options - CAR components
 * @returns Generated CAR string
 *
 * @example
 * ```typescript
 * const car = generateCAR({
 *   registry: 'a3i',
 *   organization: 'acme-corp',
 *   agentClass: 'invoice-bot',
 *   domains: ['A', 'B', 'F'],
 *   level: CapabilityLevel.L3_EXECUTE,
 *   version: '1.0.0',
 * });
 * // 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'
 *
 * // With extensions:
 * const carWithExt = generateCAR({
 *   registry: 'a3i',
 *   organization: 'acme-corp',
 *   agentClass: 'invoice-bot',
 *   domains: ['A', 'B', 'F'],
 *   level: CapabilityLevel.L3_EXECUTE,
 *   version: '1.0.0',
 *   extensions: ['gov', 'audit'],
 * });
 * // 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0#gov,audit'
 * ```
 */
export function generateCAR(options: GenerateCAROptions): string {
  const {
    registry,
    organization,
    agentClass,
    domains,
    level,
    version,
    extensions = [],
  } = options;

  // Validate components
  if (!/^[a-z0-9]+$/.test(registry)) {
    throw new Error(
      `Invalid registry: ${registry}. Must be lowercase alphanumeric.`,
    );
  }

  if (!/^[a-z0-9-]+$/.test(organization)) {
    throw new Error(
      `Invalid organization: ${organization}. Must be lowercase alphanumeric with hyphens.`,
    );
  }

  if (!/^[a-z0-9-]+$/.test(agentClass)) {
    throw new Error(
      `Invalid agent class: ${agentClass}. Must be lowercase alphanumeric with hyphens.`,
    );
  }

  if (domains.length === 0) {
    throw new Error("At least one domain is required.");
  }

  const invalidDomains = domains.filter((d) => !isDomainCode(d));
  if (invalidDomains.length > 0) {
    throw new Error(`Invalid domain codes: ${invalidDomains.join(", ")}`);
  }

  if (!isCapabilityLevel(level)) {
    throw new Error(`Invalid level: ${level}. Must be 0-7.`);
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Invalid version: ${version}. Must be semantic version (e.g., 1.0.0).`,
    );
  }

  // Validate extensions if provided
  if (extensions.length > 0) {
    const invalidExtensions = extensions.filter(
      (e) => !/^[a-z0-9_-]+$/.test(e),
    );
    if (invalidExtensions.length > 0) {
      throw new Error(
        `Invalid extensions: ${invalidExtensions.join(", ")}. Must be lowercase alphanumeric with hyphens/underscores.`,
      );
    }
  }

  // Format domains (sorted, deduplicated)
  const domainsStr = formatDomainString(domains);

  // Build CAR string
  let car = `${registry}.${organization}.${agentClass}:${domainsStr}-L${level}@${version}`;

  // Append extensions if present
  if (extensions.length > 0) {
    car += `#${extensions.join(",")}`;
  }

  return car;
}

/**
 * @deprecated Use generateCAR instead
 */
export function generateACI(options: GenerateCAROptions): string {
  return generateCAR(options);
}

/**
 * Generates a CAR string from individual parameters.
 *
 * @param registry - Certifying registry
 * @param organization - Operating organization
 * @param agentClass - Agent classification
 * @param domains - Capability domains
 * @param level - Autonomy level
 * @param version - Semantic version
 * @param extensions - Optional extensions
 * @returns Generated CAR string
 */
export function generateCARString(
  registry: string,
  organization: string,
  agentClass: string,
  domains: readonly DomainCode[],
  level: CapabilityLevel,
  version: string,
  extensions?: readonly string[],
): string {
  return generateCAR({
    registry,
    organization,
    agentClass,
    domains,
    level,
    version,
    extensions,
  });
}

/**
 * @deprecated Use generateCARString instead
 */
export function generateACIString(
  registry: string,
  organization: string,
  agentClass: string,
  domains: readonly DomainCode[],
  level: CapabilityLevel,
  version: string,
  extensions?: readonly string[],
): string {
  return generateCARString(
    registry,
    organization,
    agentClass,
    domains,
    level,
    version,
    extensions,
  );
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation error for CAR strings.
 */
export interface CARValidationError {
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Path to the error (if applicable) */
  path?: string;
}

/** @deprecated Use CARValidationError instead */
export type ACIValidationError = CARValidationError;

/**
 * Validation warning for CAR strings.
 */
export interface CARValidationWarning {
  /** Warning code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Path to the warning (if applicable) */
  path?: string;
}

/** @deprecated Use CARValidationWarning instead */
export type ACIValidationWarning = CARValidationWarning;

/**
 * Result of CAR validation.
 */
export interface CARValidationResult {
  /** Whether the CAR is valid */
  valid: boolean;
  /** Validation errors */
  errors: CARValidationError[];
  /** Validation warnings */
  warnings: CARValidationWarning[];
  /** Parsed CAR if valid */
  parsed?: ParsedCAR;
}

/** @deprecated Use CARValidationResult instead */
export type ACIValidationResult = CARValidationResult;

/**
 * Validates a CAR string.
 *
 * @param car - The CAR string to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateCAR('a3i.acme-corp.bot:A-L5@1.0.0');
 * // {
 * //   valid: true,
 * //   errors: [],
 * //   warnings: [],
 * //   parsed: { ... }
 * // }
 * ```
 */
export function validateCAR(car: string): CARValidationResult {
  const errors: CARValidationError[] = [];
  const warnings: CARValidationWarning[] = [];

  // Check for legacy format with embedded trust tier
  if (CAR_LEGACY_REGEX.test(car)) {
    warnings.push({
      code: "LEGACY_FORMAT",
      message:
        "CAR contains embedded trust tier which is deprecated. " +
        "Trust should be computed at runtime, not encoded in the identifier.",
    });
  }

  try {
    const parsed = parseCAR(car);

    // Validate capability level constraints
    // Note: Trust checks are now done at RUNTIME, not in the CAR itself

    // L7 agents operate at maximum autonomy - should be rare
    if (parsed.level === CapabilityLevel.L7_AUTONOMOUS) {
      warnings.push({
        code: "L7_AUTONOMOUS_LEVEL",
        message:
          "L7 (Autonomous) level grants maximum autonomy. " +
          "Ensure runtime trust policies are configured appropriately.",
      });
    }

    // Security domain agents require careful runtime trust
    if (parsed.domains.includes("S")) {
      warnings.push({
        code: "SECURITY_DOMAIN",
        message:
          "Security domain agent. Runtime attestations and behavioral scoring " +
          "should be configured to enforce appropriate trust levels.",
      });
    }

    // Finance domain agents require careful runtime trust
    if (parsed.domains.includes("F")) {
      warnings.push({
        code: "FINANCE_DOMAIN",
        message:
          "Finance domain agent. Runtime attestations and behavioral scoring " +
          "should be configured to enforce appropriate trust levels.",
      });
    }

    return {
      valid: true,
      errors,
      warnings,
      parsed,
    };
  } catch (e) {
    if (e instanceof CARParseError) {
      // If it's a legacy format error, try parsing with legacy parser
      if (e.code === "LEGACY_FORMAT") {
        try {
          const { parsed } = parseLegacyCAR(car);
          warnings.push({
            code: "LEGACY_FORMAT_MIGRATED",
            message:
              "Legacy CAR migrated to new format. Trust tier has been removed from identifier.",
          });
          return {
            valid: true,
            errors,
            warnings,
            parsed,
          };
        } catch {
          errors.push({ code: e.code, message: e.message });
        }
      } else {
        errors.push({ code: e.code, message: e.message });
      }
    } else {
      errors.push({ code: "UNKNOWN_ERROR", message: String(e) });
    }

    return { valid: false, errors, warnings };
  }
}

/**
 * @deprecated Use validateCAR instead
 */
export function validateACI(carId: string): CARValidationResult {
  return validateCAR(carId);
}

/**
 * Checks if a string is a valid CAR format.
 *
 * @param car - String to check
 * @returns True if the string is a valid CAR
 */
export function isValidCAR(car: string): boolean {
  return CAR_REGEX.test(car) && validateCAR(car).valid;
}

/**
 * @deprecated Use isValidCAR instead
 */
export function isValidACI(carId: string): boolean {
  return isValidCAR(carId);
}

/**
 * Type guard to check if a value is a valid CAR string.
 *
 * @param value - Value to check
 * @returns True if value is a valid CAR string
 */
export function isCARString(value: unknown): value is string {
  return typeof value === "string" && isValidCAR(value);
}

/**
 * @deprecated Use isCARString instead
 */
export function isACIString(value: unknown): value is string {
  return isCARString(value);
}

// ============================================================================
// CAR Manipulation
// ============================================================================

/**
 * Updates specific fields in a CAR and returns a new CAR string.
 *
 * @param car - Original CAR string
 * @param updates - Fields to update
 * @returns New CAR string with updates applied
 */
export function updateCAR(
  car: string,
  updates: Partial<
    Omit<GenerateCAROptions, "registry" | "organization" | "agentClass">
  >,
): string {
  const parsed = parseCAR(car);

  return generateCAR({
    registry: parsed.registry,
    organization: parsed.organization,
    agentClass: parsed.agentClass,
    domains: updates.domains ?? parsed.domains,
    level: updates.level ?? parsed.level,
    version: updates.version ?? parsed.version,
    extensions: updates.extensions ?? parsed.extensions,
  });
}

/**
 * @deprecated Use updateCAR instead
 */
export function updateACI(
  carId: string,
  updates: Partial<
    Omit<GenerateCAROptions, "registry" | "organization" | "agentClass">
  >,
): string {
  return updateCAR(carId, updates);
}

/**
 * Adds extensions to a CAR string.
 *
 * @param car - Original CAR string
 * @param newExtensions - Extensions to add
 * @returns New CAR string with extensions added
 */
export function addCARExtensions(
  car: string,
  newExtensions: readonly string[],
): string {
  const parsed = parseCAR(car);
  const allExtensions = [...new Set([...parsed.extensions, ...newExtensions])];
  return updateCAR(car, { extensions: allExtensions });
}

/**
 * @deprecated Use addCARExtensions instead
 */
export function addACIExtensions(
  carId: string,
  newExtensions: readonly string[],
): string {
  return addCARExtensions(carId, newExtensions);
}

/**
 * Removes extensions from a CAR string.
 *
 * @param car - Original CAR string
 * @param extensionsToRemove - Extensions to remove
 * @returns New CAR string with extensions removed
 */
export function removeCARExtensions(
  car: string,
  extensionsToRemove: readonly string[],
): string {
  const parsed = parseCAR(car);
  const remaining = parsed.extensions.filter(
    (e) => !extensionsToRemove.includes(e),
  );
  return updateCAR(car, { extensions: remaining });
}

/**
 * @deprecated Use removeCARExtensions instead
 */
export function removeACIExtensions(
  carId: string,
  extensionsToRemove: readonly string[],
): string {
  return removeCARExtensions(carId, extensionsToRemove);
}

/**
 * Increments the version in a CAR string.
 *
 * @param car - Original CAR string
 * @param type - Version component to increment ('major' | 'minor' | 'patch')
 * @returns New CAR string with incremented version
 */
export function incrementCARVersion(
  car: string,
  type: "major" | "minor" | "patch" = "patch",
): string {
  const parsed = parseCAR(car);
  const [major, minor, patch] = parsed.version.split(".").map(Number);

  let newVersion: string;
  switch (type) {
    case "major":
      newVersion = `${major! + 1}.0.0`;
      break;
    case "minor":
      newVersion = `${major}.${minor! + 1}.0`;
      break;
    case "patch":
    default:
      newVersion = `${major}.${minor}.${patch! + 1}`;
      break;
  }

  return updateCAR(car, { version: newVersion });
}

/**
 * @deprecated Use incrementCARVersion instead
 */
export function incrementACIVersion(
  carId: string,
  type: "major" | "minor" | "patch" = "patch",
): string {
  return incrementCARVersion(carId, type);
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for CAR string validation.
 */
export const carStringSchema = z.string().refine((val) => CAR_REGEX.test(val), {
  message:
    "Invalid CAR format. Expected: registry.org.class:DOMAINS-Ln@x.y.z[#extensions]",
});

/** @deprecated Use carStringSchema instead */
export const aciStringSchema = carStringSchema;

/**
 * Zod schema for CAR string with parsing transform.
 */
export const carSchema = carStringSchema.transform((car) => parseCAR(car));

/** @deprecated Use carSchema instead */
export const aciSchema = carStringSchema.transform((carId) => parseACI(carId));

/**
 * Zod schema for GenerateCAROptions.
 */
export const generateCAROptionsSchema = z.object({
  registry: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+$/),
  organization: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  agentClass: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  domains: z.array(domainCodeSchema).min(1),
  level: z.nativeEnum(CapabilityLevel),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  extensions: z.array(z.string().regex(/^[a-z0-9_-]+$/)).optional(),
});

/** @deprecated Use generateCAROptionsSchema instead */
export const generateACIOptionsSchema = generateCAROptionsSchema;

/**
 * Zod schema for CARValidationError.
 */
export const carValidationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

/** @deprecated Use carValidationErrorSchema instead */
export const aciValidationErrorSchema = carValidationErrorSchema;

/**
 * Zod schema for CARValidationWarning.
 */
export const carValidationWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

/** @deprecated Use carValidationWarningSchema instead */
export const aciValidationWarningSchema = carValidationWarningSchema;

/**
 * Zod schema for CARValidationResult.
 */
export const carValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(carValidationErrorSchema),
  warnings: z.array(carValidationWarningSchema),
  parsed: parsedCARSchema.optional(),
});

/** @deprecated Use carValidationResultSchema instead */
export const aciValidationResultSchema = carValidationResultSchema;
