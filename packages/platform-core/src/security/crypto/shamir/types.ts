/**
 * Shamir Secret Sharing - Type Definitions
 *
 * Provides strong type definitions for verified Shamir Secret Sharing implementation.
 * All types are designed to enforce mathematical constraints at the type level.
 *
 * @module security/crypto/shamir/types
 */

/**
 * A share index in the range [1, 255].
 * Index 0 is reserved as it represents the secret itself (f(0) = secret).
 *
 * Mathematical constraint: x in GF(2^8) \ {0}
 */
export type ShareIndex = number & { readonly __brand: 'ShareIndex' };

/**
 * A field element in GF(2^8), represented as a byte [0, 255].
 */
export type GF256Element = number & { readonly __brand: 'GF256Element' };

/**
 * Verified share with integrity protection.
 *
 * @remarks
 * Each share contains:
 * - index: The x-coordinate in polynomial evaluation (1-255)
 * - value: The y-coordinates for each byte of the secret
 * - checksum: SHA-256 of (index || value) for integrity verification
 *
 * The checksum provides:
 * - Detection of accidental corruption
 * - Binding between index and value (prevents index substitution attacks)
 */
export interface VerifiedShare {
  /** Share index (x-coordinate), always in range [1, 255] */
  readonly index: ShareIndex;

  /** Share value (y-coordinates), one byte per secret byte */
  readonly value: Uint8Array;

  /** SHA-256 checksum of (index || value) for integrity verification */
  readonly checksum: Uint8Array;

  /** ISO timestamp of share creation */
  readonly createdAt: string;

  /** Optional metadata for share management */
  readonly metadata?: ShareMetadata;
}

/**
 * Optional metadata attached to a share.
 */
export interface ShareMetadata {
  /** Human-readable label for the share */
  readonly label?: string;

  /** Custodian identifier */
  readonly custodianId?: string;

  /** Key ceremony identifier */
  readonly ceremonyId?: string;

  /** Additional custom metadata */
  readonly custom?: Record<string, unknown>;
}

/**
 * Parameters for Shamir Secret Sharing scheme.
 *
 * @remarks
 * Constraints:
 * - 1 <= threshold <= totalShares <= 255
 * - threshold = 1 provides no security (any single share reveals the secret)
 * - threshold = totalShares requires all shares (no redundancy)
 *
 * Security recommendation: threshold >= 2 for any meaningful security
 */
export interface ShamirParams {
  /**
   * Minimum shares required for reconstruction (k).
   * Also known as the "threshold" or "quorum".
   * Must be in range [1, 255].
   */
  readonly threshold: number;

  /**
   * Total number of shares to generate (n).
   * Must be in range [threshold, 255].
   */
  readonly totalShares: number;

  /**
   * Length of the secret in bytes.
   * Each byte is shared independently using GF(2^8).
   */
  readonly secretLength: number;
}

/**
 * Result of share validation.
 */
export interface ShareValidationResult {
  /** Whether the share is valid */
  readonly valid: boolean;

  /** Error message if invalid */
  readonly error?: string;

  /** Warnings that don't invalidate the share */
  readonly warnings?: string[];
}

/**
 * Result of secret reconstruction.
 */
export interface ReconstructionResult {
  /** The reconstructed secret */
  readonly secret: Uint8Array;

  /** Share indices used in reconstruction */
  readonly usedShares: ShareIndex[];

  /** Time taken for reconstruction in milliseconds */
  readonly reconstructionTimeMs: number;

  /** Whether constant-time operations were used */
  readonly constantTime: boolean;
}

/**
 * Split operation result with additional metadata.
 */
export interface SplitResult {
  /** Generated shares */
  readonly shares: VerifiedShare[];

  /** Parameters used for splitting */
  readonly params: ShamirParams;

  /** Time taken for splitting in milliseconds */
  readonly splitTimeMs: number;

  /** Random bytes consumed (for entropy tracking) */
  readonly randomBytesConsumed: number;
}

/**
 * Configuration for the Shamir implementation.
 */
export interface ShamirConfig {
  /**
   * Use constant-time operations to prevent timing attacks.
   * Default: true
   */
  readonly constantTime?: boolean;

  /**
   * Verify share checksums during reconstruction.
   * Default: true
   */
  readonly verifyChecksums?: boolean;

  /**
   * Custom random number generator for testing.
   * Default: crypto.getRandomValues
   */
  readonly rng?: (bytes: Uint8Array) => Uint8Array;

  /**
   * Enable detailed logging for debugging.
   * Default: false
   * WARNING: May leak sensitive timing information
   */
  readonly debug?: boolean;
}

/**
 * GF(2^8) field operations interface.
 * All operations are over the Galois Field with 256 elements.
 */
export interface GF256Operations {
  /** Addition in GF(2^8) (XOR) */
  add(a: GF256Element, b: GF256Element): GF256Element;

  /** Subtraction in GF(2^8) (same as addition due to characteristic 2) */
  sub(a: GF256Element, b: GF256Element): GF256Element;

  /** Multiplication in GF(2^8) */
  mul(a: GF256Element, b: GF256Element): GF256Element;

  /** Division in GF(2^8) */
  div(a: GF256Element, b: GF256Element): GF256Element;

  /** Multiplicative inverse in GF(2^8) */
  inv(a: GF256Element): GF256Element;

  /** Exponentiation in GF(2^8) */
  pow(base: GF256Element, exp: number): GF256Element;
}

/**
 * Polynomial over GF(2^8).
 */
export interface GF256Polynomial {
  /** Coefficients from constant term to highest degree */
  readonly coefficients: readonly GF256Element[];

  /** Degree of the polynomial */
  readonly degree: number;

  /** Evaluate polynomial at point x */
  evaluate(x: GF256Element): GF256Element;
}

/**
 * Test vector for verification.
 */
export interface TestVector {
  /** Test vector identifier */
  readonly id: string;

  /** Description of the test */
  readonly description: string;

  /** Source of the test vector (e.g., "NIST", "academic paper") */
  readonly source?: string;

  /** Input secret */
  readonly secret: Uint8Array;

  /** Shamir parameters */
  readonly params: ShamirParams;

  /** Expected shares (for deterministic testing) */
  readonly expectedShares?: Array<{
    index: number;
    value: Uint8Array;
  }>;

  /** Shares to use for reconstruction test */
  readonly reconstructionShares?: number[];
}

/**
 * Security analysis result.
 */
export interface SecurityAnalysisResult {
  /** Overall security assessment */
  readonly secure: boolean;

  /** Individual checks performed */
  readonly checks: SecurityCheck[];

  /** Recommendations for improvement */
  readonly recommendations?: string[];

  /** Estimated security level in bits */
  readonly securityBits?: number;
}

/**
 * Individual security check result.
 */
export interface SecurityCheck {
  /** Name of the check */
  readonly name: string;

  /** Whether the check passed */
  readonly passed: boolean;

  /** Details about the check result */
  readonly details: string;

  /** Severity if failed */
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Entropy analysis result.
 */
export interface EntropyAnalysis {
  /** Shannon entropy in bits per byte */
  readonly shannonEntropy: number;

  /** Min-entropy (conservative estimate) */
  readonly minEntropy: number;

  /** Whether entropy is sufficient for cryptographic use */
  readonly sufficient: boolean;

  /** Byte frequency distribution */
  readonly byteDistribution: number[];
}

/**
 * Timing analysis result.
 */
export interface TimingAnalysis {
  /** Average execution time in nanoseconds */
  readonly avgTimeNs: number;

  /** Standard deviation in nanoseconds */
  readonly stdDevNs: number;

  /** Maximum deviation from mean */
  readonly maxDeviationNs: number;

  /** Whether timing appears constant */
  readonly constantTime: boolean;

  /** Number of samples analyzed */
  readonly sampleCount: number;
}

/**
 * Type guard for ShareIndex.
 */
export function isShareIndex(value: number): value is ShareIndex {
  return Number.isInteger(value) && value >= 1 && value <= 255;
}

/**
 * Type guard for GF256Element.
 */
export function isGF256Element(value: number): value is GF256Element {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Create a ShareIndex from a number (validates range).
 * @throws Error if value is not in valid range [1, 255]
 */
export function createShareIndex(value: number): ShareIndex {
  if (!isShareIndex(value)) {
    throw new RangeError(`Share index must be in range [1, 255], got ${value}`);
  }
  return value as ShareIndex;
}

/**
 * Create a GF256Element from a number (validates range).
 * @throws Error if value is not in valid range [0, 255]
 */
export function createGF256Element(value: number): GF256Element {
  if (!isGF256Element(value)) {
    throw new RangeError(`GF(2^8) element must be in range [0, 255], got ${value}`);
  }
  return value as GF256Element;
}

/**
 * Validate ShamirParams.
 */
export function validateShamirParams(params: ShamirParams): ShareValidationResult {
  const warnings: string[] = [];

  if (!Number.isInteger(params.threshold)) {
    return { valid: false, error: 'Threshold must be an integer' };
  }

  if (!Number.isInteger(params.totalShares)) {
    return { valid: false, error: 'Total shares must be an integer' };
  }

  if (!Number.isInteger(params.secretLength)) {
    return { valid: false, error: 'Secret length must be an integer' };
  }

  if (params.threshold < 1) {
    return { valid: false, error: 'Threshold must be at least 1' };
  }

  if (params.threshold > 255) {
    return { valid: false, error: 'Threshold cannot exceed 255' };
  }

  if (params.totalShares < params.threshold) {
    return { valid: false, error: 'Total shares must be >= threshold' };
  }

  if (params.totalShares > 255) {
    return { valid: false, error: 'Total shares cannot exceed 255' };
  }

  if (params.secretLength < 1) {
    return { valid: false, error: 'Secret length must be at least 1 byte' };
  }

  // Warnings for potentially insecure configurations
  if (params.threshold === 1) {
    warnings.push('Threshold of 1 provides no security - any single share reveals the secret');
  }

  if (params.threshold === params.totalShares) {
    warnings.push('Threshold equals total shares - no redundancy, all shares required');
  }

  if (params.threshold < 3 && params.totalShares > 3) {
    warnings.push('Low threshold relative to total shares may indicate weak security requirements');
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}
