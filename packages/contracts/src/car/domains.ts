/**
 * @fileoverview CAR Domain Codes and Bitmask Operations
 *
 * Defines the capability domain codes used in CAR strings, with bitmask
 * encoding for efficient queries and domain matching.
 *
 * Domain codes represent high-level capability areas that agents can operate in.
 * Each domain has a single-character code, a human-readable name, a bitmask value,
 * and a description of its scope.
 *
 * @module @vorionsys/contracts/car/domains
 */

import { z } from "zod";

// ============================================================================
// Domain Code Type
// ============================================================================

/**
 * Single-character domain codes representing capability areas.
 *
 * Each code maps to a specific area of agent capability:
 * - A: Administration - System administration, user management, organizational operations
 * - B: Business - Business logic, workflows, approvals, process automation
 * - C: Communications - Email, messaging, notifications, real-time communication
 * - D: Data - Data processing, analytics, reporting, ETL pipelines
 * - E: External - Third-party integrations, external APIs, partner systems
 * - F: Finance - Financial operations, payments, accounting, treasury
 * - G: Governance - Policy enforcement, compliance, oversight, audit
 * - H: Healthcare - Clinical systems, patient data, medical devices, health records
 * - I: Infrastructure - Compute, storage, networking, cloud resource management
 * - J: Judicial - Legal operations, contract analysis, regulatory compliance
 * - K: Knowledge - Knowledge management, documentation, search, retrieval
 * - L: Logistics - Supply chain, inventory, shipping, warehouse management
 * - M: Manufacturing - Production systems, quality control, industrial automation
 * - N: NLP - Natural language processing, translation, content generation
 * - O: Operations - DevOps, SRE, incident response, operational management
 * - P: People - HR, recruitment, employee management, talent operations
 * - Q: Quality - Testing, QA, certification, standards compliance
 * - R: Research - R&D, experimentation, scientific computing, analysis
 * - S: Security - Authentication, authorization, threat detection, audit
 * - T: Training - Education, learning systems, skill development, onboarding
 * - U: Utilities - Shared services, scheduling, notifications, common tools
 * - V: Verification - Identity verification, attestation, proof validation
 * - W: Web - Web applications, digital experiences, content management
 * - X: Cross-domain - Multi-domain orchestration, cross-cutting concerns
 * - Y: Yield - Analytics, optimization, performance measurement, ROI
 * - Z: Reserved - Reserved for future domain expansion
 */
export type DomainCode =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

/**
 * Array of all valid domain codes.
 */
export const DOMAIN_CODES: readonly DomainCode[] = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const;

/**
 * Zod schema for DomainCode validation.
 */
export const domainCodeSchema = z.enum(
  [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
  ],
  {
    errorMap: () => ({ message: "Invalid domain code. Must be A-Z" }),
  },
);

// ============================================================================
// Domain Definition
// ============================================================================

/**
 * Complete definition for a capability domain.
 */
export interface DomainDefinition {
  /** Single-character domain code */
  readonly code: DomainCode;
  /** Human-readable domain name */
  readonly name: string;
  /** Bitmask value for efficient queries (power of 2) */
  readonly bit: number;
  /** Description of the domain's scope */
  readonly description: string;
}

/**
 * Capability domains with their definitions.
 *
 * Each domain has a unique bitmask value (power of 2) for efficient
 * storage and querying of domain combinations.
 */
export const CAPABILITY_DOMAINS: Readonly<
  Record<DomainCode, DomainDefinition>
> = {
  A: {
    code: "A",
    name: "Administration",
    bit: 1 << 0,
    description:
      "System administration, user management, organizational operations",
  },
  B: {
    code: "B",
    name: "Business",
    bit: 1 << 1,
    description: "Business logic, workflows, approvals, process automation",
  },
  C: {
    code: "C",
    name: "Communications",
    bit: 1 << 2,
    description: "Email, messaging, notifications, real-time communication",
  },
  D: {
    code: "D",
    name: "Data",
    bit: 1 << 3,
    description: "Data processing, analytics, reporting, ETL pipelines",
  },
  E: {
    code: "E",
    name: "External",
    bit: 1 << 4,
    description: "Third-party integrations, external APIs, partner systems",
  },
  F: {
    code: "F",
    name: "Finance",
    bit: 1 << 5,
    description: "Financial operations, payments, accounting, treasury",
  },
  G: {
    code: "G",
    name: "Governance",
    bit: 1 << 6,
    description: "Policy enforcement, compliance, oversight, audit",
  },
  H: {
    code: "H",
    name: "Healthcare",
    bit: 1 << 7,
    description:
      "Clinical systems, patient data, medical devices, health records",
  },
  I: {
    code: "I",
    name: "Infrastructure",
    bit: 1 << 8,
    description: "Compute, storage, networking, cloud resource management",
  },
  J: {
    code: "J",
    name: "Judicial",
    bit: 1 << 9,
    description: "Legal operations, contract analysis, regulatory compliance",
  },
  K: {
    code: "K",
    name: "Knowledge",
    bit: 1 << 10,
    description: "Knowledge management, documentation, search, retrieval",
  },
  L: {
    code: "L",
    name: "Logistics",
    bit: 1 << 11,
    description: "Supply chain, inventory, shipping, warehouse management",
  },
  M: {
    code: "M",
    name: "Manufacturing",
    bit: 1 << 12,
    description: "Production systems, quality control, industrial automation",
  },
  N: {
    code: "N",
    name: "NLP",
    bit: 1 << 13,
    description: "Natural language processing, translation, content generation",
  },
  O: {
    code: "O",
    name: "Operations",
    bit: 1 << 14,
    description: "DevOps, SRE, incident response, operational management",
  },
  P: {
    code: "P",
    name: "People",
    bit: 1 << 15,
    description: "HR, recruitment, employee management, talent operations",
  },
  Q: {
    code: "Q",
    name: "Quality",
    bit: 1 << 16,
    description: "Testing, QA, certification, standards compliance",
  },
  R: {
    code: "R",
    name: "Research",
    bit: 1 << 17,
    description: "R&D, experimentation, scientific computing, analysis",
  },
  S: {
    code: "S",
    name: "Security",
    bit: 1 << 18,
    description: "Authentication, authorization, threat detection, audit",
  },
  T: {
    code: "T",
    name: "Training",
    bit: 1 << 19,
    description: "Education, learning systems, skill development, onboarding",
  },
  U: {
    code: "U",
    name: "Utilities",
    bit: 1 << 20,
    description: "Shared services, scheduling, notifications, common tools",
  },
  V: {
    code: "V",
    name: "Verification",
    bit: 1 << 21,
    description: "Identity verification, attestation, proof validation",
  },
  W: {
    code: "W",
    name: "Web",
    bit: 1 << 22,
    description: "Web applications, digital experiences, content management",
  },
  X: {
    code: "X",
    name: "Cross-domain",
    bit: 1 << 23,
    description: "Multi-domain orchestration, cross-cutting concerns",
  },
  Y: {
    code: "Y",
    name: "Yield",
    bit: 1 << 24,
    description: "Analytics, optimization, performance measurement, ROI",
  },
  Z: {
    code: "Z",
    name: "Reserved",
    bit: 1 << 25,
    description: "Reserved for future domain expansion",
  },
} as const;

/**
 * Human-readable domain names indexed by code.
 */
export const DOMAIN_NAMES: Readonly<Record<DomainCode, string>> = {
  A: "Administration",
  B: "Business",
  C: "Communications",
  D: "Data",
  E: "External",
  F: "Finance",
  G: "Governance",
  H: "Healthcare",
  I: "Infrastructure",
  J: "Judicial",
  K: "Knowledge",
  L: "Logistics",
  M: "Manufacturing",
  N: "NLP",
  O: "Operations",
  P: "People",
  Q: "Quality",
  R: "Research",
  S: "Security",
  T: "Training",
  U: "Utilities",
  V: "Verification",
  W: "Web",
  X: "Cross-domain",
  Y: "Yield",
  Z: "Reserved",
} as const;

/**
 * Bitmask value representing all domains combined.
 */
export const ALL_DOMAINS_BITMASK = Object.values(CAPABILITY_DOMAINS).reduce(
  (mask, domain) => mask | domain.bit,
  0,
);

// ============================================================================
// Bitmask Encoding/Decoding
// ============================================================================

/**
 * Encodes an array of domain codes into a bitmask.
 *
 * @param domains - Array of domain codes to encode
 * @returns Bitmask integer representing the domains
 *
 * @example
 * ```typescript
 * encodeDomains(['A', 'B']);     // 0x003 (3)
 * encodeDomains(['A', 'S']);     // 0x201 (513)
 * encodeDomains([]);             // 0
 * ```
 */
export function encodeDomains(domains: readonly DomainCode[]): number {
  return domains.reduce((mask, code) => {
    const domain = CAPABILITY_DOMAINS[code];
    return mask | domain.bit;
  }, 0);
}

/**
 * Decodes a bitmask into an array of domain codes.
 *
 * @param bitmask - Bitmask integer to decode
 * @returns Array of domain codes present in the bitmask
 *
 * @example
 * ```typescript
 * decodeDomains(0x003);  // ['A', 'B']
 * decodeDomains(0x201);  // ['A', 'S']
 * decodeDomains(0);      // []
 * ```
 */
export function decodeDomains(bitmask: number): DomainCode[] {
  return DOMAIN_CODES.filter(
    (code) => (bitmask & CAPABILITY_DOMAINS[code].bit) !== 0,
  );
}

/**
 * Converts a domain string (e.g., "ABS") to an array of domain codes.
 *
 * @param domainString - String containing domain codes (e.g., "ABS")
 * @returns Array of domain codes
 * @throws Error if any character is not a valid domain code
 *
 * @example
 * ```typescript
 * parseDomainString('ABS');  // ['A', 'B', 'S']
 * parseDomainString('D');    // ['D']
 * ```
 */
export function parseDomainString(domainString: string): DomainCode[] {
  const codes = domainString.split("") as DomainCode[];
  const invalidCodes = codes.filter((c) => !DOMAIN_CODES.includes(c));

  if (invalidCodes.length > 0) {
    throw new Error(`Invalid domain codes: ${invalidCodes.join(", ")}`);
  }

  return codes;
}

/**
 * Converts an array of domain codes to a domain string.
 *
 * @param domains - Array of domain codes
 * @param sort - Whether to sort the codes alphabetically (default: true)
 * @returns String containing the domain codes
 *
 * @example
 * ```typescript
 * formatDomainString(['S', 'A', 'B']);  // 'ABS'
 * formatDomainString(['S', 'A'], false); // 'SA'
 * ```
 */
export function formatDomainString(
  domains: readonly DomainCode[],
  sort = true,
): string {
  const uniqueDomains = [...new Set(domains)];
  return sort ? uniqueDomains.sort().join("") : uniqueDomains.join("");
}

// ============================================================================
// Domain Matching
// ============================================================================

/**
 * Checks if a set of domains includes all required domains.
 *
 * @param agentDomains - Domains the agent has (array or bitmask)
 * @param requiredDomains - Domains required (array or bitmask)
 * @returns True if agent has all required domains
 *
 * @example
 * ```typescript
 * hasDomains(['A', 'B', 'C'], ['A', 'B']);  // true
 * hasDomains(['A', 'B'], ['A', 'B', 'C']);  // false
 * hasDomains(0x007, 0x003);                  // true (ABC has AB)
 * ```
 */
export function hasDomains(
  agentDomains: readonly DomainCode[] | number,
  requiredDomains: readonly DomainCode[] | number,
): boolean {
  const agentMask =
    typeof agentDomains === "number"
      ? agentDomains
      : encodeDomains(agentDomains);
  const requiredMask =
    typeof requiredDomains === "number"
      ? requiredDomains
      : encodeDomains(requiredDomains);

  return (agentMask & requiredMask) === requiredMask;
}

/**
 * Checks if a set of domains satisfies domain requirements.
 *
 * This is an alias for hasDomains with more semantic naming for
 * authorization contexts.
 *
 * @param agentDomains - Domains the agent has
 * @param requirements - Domain requirements to satisfy
 * @returns True if all requirements are satisfied
 */
export function satisfiesDomainRequirements(
  agentDomains: readonly DomainCode[] | number,
  requirements: readonly DomainCode[] | number,
): boolean {
  return hasDomains(agentDomains, requirements);
}

/**
 * Gets the intersection of two domain sets.
 *
 * @param domainsA - First domain set
 * @param domainsB - Second domain set
 * @returns Array of domains present in both sets
 *
 * @example
 * ```typescript
 * intersectDomains(['A', 'B', 'C'], ['B', 'C', 'D']);  // ['B', 'C']
 * ```
 */
export function intersectDomains(
  domainsA: readonly DomainCode[] | number,
  domainsB: readonly DomainCode[] | number,
): DomainCode[] {
  const maskA =
    typeof domainsA === "number" ? domainsA : encodeDomains(domainsA);
  const maskB =
    typeof domainsB === "number" ? domainsB : encodeDomains(domainsB);
  return decodeDomains(maskA & maskB);
}

/**
 * Gets the union of two domain sets.
 *
 * @param domainsA - First domain set
 * @param domainsB - Second domain set
 * @returns Array of domains present in either set
 *
 * @example
 * ```typescript
 * unionDomains(['A', 'B'], ['B', 'C']);  // ['A', 'B', 'C']
 * ```
 */
export function unionDomains(
  domainsA: readonly DomainCode[] | number,
  domainsB: readonly DomainCode[] | number,
): DomainCode[] {
  const maskA =
    typeof domainsA === "number" ? domainsA : encodeDomains(domainsA);
  const maskB =
    typeof domainsB === "number" ? domainsB : encodeDomains(domainsB);
  return decodeDomains(maskA | maskB);
}

/**
 * Gets domains in the first set that are not in the second.
 *
 * @param domainsA - First domain set
 * @param domainsB - Second domain set
 * @returns Array of domains in A but not in B
 *
 * @example
 * ```typescript
 * differenceDomains(['A', 'B', 'C'], ['B', 'C']);  // ['A']
 * ```
 */
export function differenceDomains(
  domainsA: readonly DomainCode[] | number,
  domainsB: readonly DomainCode[] | number,
): DomainCode[] {
  const maskA =
    typeof domainsA === "number" ? domainsA : encodeDomains(domainsA);
  const maskB =
    typeof domainsB === "number" ? domainsB : encodeDomains(domainsB);
  return decodeDomains(maskA & ~maskB);
}

// ============================================================================
// Domain Information
// ============================================================================

/**
 * Gets the full definition for a domain code.
 *
 * @param code - Domain code
 * @returns Domain definition
 */
export function getDomainDefinition(code: DomainCode): DomainDefinition {
  return CAPABILITY_DOMAINS[code];
}

/**
 * Gets the human-readable name for a domain code.
 *
 * @param code - Domain code
 * @returns Domain name
 */
export function getDomainName(code: DomainCode): string {
  return DOMAIN_NAMES[code];
}

/**
 * Gets the bitmask value for a domain code.
 *
 * @param code - Domain code
 * @returns Bitmask value
 */
export function getDomainBit(code: DomainCode): number {
  return CAPABILITY_DOMAINS[code].bit;
}

/**
 * Counts the number of domains in a bitmask.
 *
 * @param bitmask - Domain bitmask
 * @returns Number of domains
 */
export function countDomains(bitmask: number): number {
  let count = 0;
  let mask = bitmask;
  while (mask) {
    count += mask & 1;
    mask >>>= 1;
  }
  return count;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid DomainCode.
 *
 * @param value - Value to check
 * @returns True if value is a valid DomainCode
 */
export function isDomainCode(value: unknown): value is DomainCode {
  return (
    typeof value === "string" && DOMAIN_CODES.includes(value as DomainCode)
  );
}

/**
 * Type guard to check if all values in an array are valid DomainCodes.
 *
 * @param values - Array to check
 * @returns True if all values are valid DomainCodes
 */
export function isDomainCodeArray(values: unknown): values is DomainCode[] {
  return Array.isArray(values) && values.every(isDomainCode);
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for domain definition.
 */
export const domainDefinitionSchema = z.object({
  code: domainCodeSchema,
  name: z.string().min(1),
  bit: z.number().int().positive(),
  description: z.string().min(1),
});

/**
 * Zod schema for an array of domain codes.
 */
export const domainCodeArraySchema = z.array(domainCodeSchema);

/**
 * Zod schema for a domain bitmask (positive integer).
 */
export const domainBitmaskSchema = z
  .number()
  .int()
  .min(0)
  .max(ALL_DOMAINS_BITMASK);

/**
 * Zod schema for domain string (e.g., "ABS").
 */
export const domainStringSchema = z
  .string()
  .regex(/^[A-Z]+$/, "Domain string must only contain valid domain codes (A-Z)")
  .transform((str) => parseDomainString(str));
