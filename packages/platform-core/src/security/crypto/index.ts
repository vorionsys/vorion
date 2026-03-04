/**
 * Security Cryptography Module
 *
 * Provides cryptographic primitives and FIPS 140-2 compliant operations
 * for FedRAMP compliance. This module is the primary entry point for
 * secure cryptographic operations in Vorion.
 *
 * ## Features
 *
 * - **FIPS 140-2 Compliance**: Enforces use of only FIPS-approved algorithms
 * - **Algorithm Validation**: Validates algorithms before every operation
 * - **Key Length Enforcement**: Ensures minimum key lengths per NIST guidelines
 * - **Comprehensive Auditing**: Logs all crypto operations for compliance
 * - **Certificate Validation**: Validates X.509 certificates for FIPS compliance
 * - **TLS Enforcement**: Ensures TLS 1.2+ for transport security
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   FIPSCryptoProvider,
 *   fipsEncrypt,
 *   fipsHash,
 *   enableFIPSMode,
 *   validateAlgorithm,
 * } from './security/crypto';
 *
 * // Enable FIPS mode globally
 * enableFIPSMode();
 *
 * // Or use the provider directly
 * const provider = new FIPSCryptoProvider({ enabled: true, strictMode: true });
 * await provider.initialize();
 *
 * // Encrypt data with FIPS-compliant AES-256-GCM
 * const encrypted = await provider.fipsEncrypt(
 *   Buffer.from('sensitive data'),
 *   key,
 *   'aes-256-gcm'
 * );
 *
 * // Hash data with SHA-256
 * const hash = await provider.fipsHash(Buffer.from('data'), 'sha256');
 *
 * // Validate algorithms
 * if (!validateAlgorithm('md5')) {
 *   console.log('MD5 is not FIPS compliant');
 * }
 * ```
 *
 * ## FIPS Mode Configuration
 *
 * FIPS mode can be enabled via:
 * - Environment variable: `VORION_FIPS_MODE=true`
 * - Programmatically: `enableFIPSMode()`
 * - Per-provider: `new FIPSCryptoProvider({ enabled: true })`
 *
 * ## Approved Algorithms
 *
 * **Symmetric Encryption:**
 * - AES-128-GCM, AES-256-GCM
 * - AES-128-CBC, AES-256-CBC
 * - AES-128-CTR, AES-256-CTR
 *
 * **Hash Functions:**
 * - SHA-256, SHA-384, SHA-512
 * - (NO SHA-1, MD5)
 *
 * **Asymmetric:**
 * - RSA (2048+ bits)
 * - ECDSA (P-256, P-384, P-521)
 *
 * **MACs:**
 * - HMAC-SHA256, HMAC-SHA384, HMAC-SHA512
 *
 * **Key Derivation:**
 * - PBKDF2 with approved hashes
 * - HKDF with approved hashes
 *
 * @packageDocumentation
 * @module security/crypto
 */

// =============================================================================
// FIPS Mode - Core Types and Constants
// =============================================================================

export {
  // Algorithm Constants
  FIPS_SYMMETRIC_ALGORITHMS,
  FIPS_HASH_ALGORITHMS,
  FIPS_HMAC_ALGORITHMS,
  FIPS_ASYMMETRIC_ALGORITHMS,
  FIPS_ECDSA_CURVES,
  FIPS_MINIMUM_KEY_LENGTHS,
  NON_FIPS_ALGORITHMS,
  FIPS_TLS_VERSIONS,
  NON_FIPS_TLS_VERSIONS,

  // Algorithm Types
  type FIPSSymmetricAlgorithm,
  type FIPSHashAlgorithm,
  type FIPSHMACAlgorithm,
  type FIPSAsymmetricAlgorithm,
  type FIPSECDSACurve,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Configuration Types
// =============================================================================

export {
  // Configuration
  type FIPSModeConfig,
  fipsModeConfigSchema,
  DEFAULT_FIPS_CONFIG,

  // Certificate Validation
  type CertificateValidationOptions,
  DEFAULT_CERT_VALIDATION_OPTIONS,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Operation Types
// =============================================================================

export {
  // Operation Types
  CryptoOperationType,
  type CryptoOperation,
  cryptoOperationSchema,

  // Violation Types
  type FIPSViolation,
  fipsViolationSchema,

  // Audit Types
  type FIPSAuditEntry,
  fipsAuditEntrySchema,
  type FIPSAuditCallback,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Error Types
// =============================================================================

export {
  // Error
  FIPSError,
  FIPSErrorCode,
  type FIPSErrorCode as FIPSErrorCodeType,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Validation Functions
// =============================================================================

export {
  // Validation Functions
  validateAlgorithm,
  validateKeyLength,
  validateHash,
  isFIPSCompliant,
  validateTLSVersion,
  validateCipherSuite,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Provider
// =============================================================================

export {
  // Provider Class
  FIPSCryptoProvider,

  // Factory Functions
  createFIPSCryptoProvider,
  createFIPSCryptoProviderFromEnv,

  // Singleton Management
  getFIPSCryptoProvider,
  setFIPSCryptoProvider,
  resetFIPSCryptoProvider,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Global Control
// =============================================================================

export {
  // Global FIPS Mode Control
  enableFIPSMode,
  disableFIPSMode,
  isFIPSModeEnabled,
} from './fips-mode.js';

// =============================================================================
// FIPS Mode - Convenience Functions
// =============================================================================

export {
  // Convenience Functions (use default provider)
  fipsEncrypt,
  fipsDecrypt,
  fipsHash,
  fipsSign,
  fipsRandomBytes,
} from './fips-mode.js';

// =============================================================================
// Re-exports from Encryption Module (for convenience)
// =============================================================================

// Note: These are re-exported for convenience when using the crypto module
// directly. The encryption module has its own exports at ../encryption/index.js

/**
 * Check if FIPS mode should be enabled based on environment
 *
 * @returns true if FIPS mode is requested via environment variable
 */
export function shouldEnableFIPSMode(): boolean {
  return process.env['VORION_FIPS_MODE'] === 'true';
}

/**
 * Get FIPS configuration from environment variables
 *
 * @returns FIPS configuration object
 */
export function getFIPSConfigFromEnv(): Partial<import('./fips-mode.js').FIPSModeConfig> {
  return {
    enabled: process.env['VORION_FIPS_MODE'] === 'true',
    strictMode: process.env['VORION_FIPS_STRICT'] !== 'false',
    auditAllCryptoOperations: process.env['VORION_FIPS_AUDIT'] !== 'false',
    alertOnViolations: process.env['VORION_FIPS_ALERT'] !== 'false',
  };
}

/**
 * Initialize FIPS mode if required by environment
 *
 * This is a convenience function that checks the environment and
 * initializes FIPS mode if requested.
 *
 * @example
 * ```typescript
 * import { initializeFIPSModeIfRequired } from './security/crypto';
 *
 * // In application startup
 * await initializeFIPSModeIfRequired();
 * ```
 */
export async function initializeFIPSModeIfRequired(): Promise<void> {
  const { enableFIPSMode: enable, getFIPSCryptoProvider: getProvider } = await import(
    './fips-mode.js'
  );

  if (shouldEnableFIPSMode()) {
    enable();
    const provider = getProvider();
    await provider.initialize();
  }
}

/**
 * Validate that an operation would be allowed in FIPS mode
 *
 * This is useful for checking compliance without actually performing
 * the operation.
 *
 * @param algorithm - The algorithm to validate
 * @param keyLength - Optional key length in bits
 * @param hashFunction - Optional hash function for composite operations
 * @returns Validation result with details
 *
 * @example
 * ```typescript
 * const result = validateFIPSOperation('aes-256-gcm', 256);
 * if (!result.compliant) {
 *   console.log('Non-compliant:', result.reason);
 * }
 * ```
 */
export function validateFIPSOperation(
  algorithm: string,
  keyLength?: number,
  hashFunction?: string
): {
  compliant: boolean;
  reason?: string;
  algorithmValid: boolean;
  keyLengthValid: boolean;
  hashValid: boolean;
} {
  // Import the validation functions
  const {
    validateAlgorithm: valAlg,
    validateKeyLength: valKey,
    validateHash: valHash,
  } = require('./fips-mode.js');

  const algorithmValid = valAlg(algorithm);
  const keyLengthValid = keyLength === undefined ? true : valKey(algorithm, keyLength);
  const hashValid = hashFunction === undefined ? true : valHash(hashFunction);

  const compliant = algorithmValid && keyLengthValid && hashValid;

  let reason: string | undefined;
  if (!algorithmValid) {
    reason = `Algorithm '${algorithm}' is not FIPS 140-2 approved`;
  } else if (!keyLengthValid) {
    reason = `Key length ${keyLength} bits is below FIPS minimum for ${algorithm}`;
  } else if (!hashValid) {
    reason = `Hash function '${hashFunction}' is not FIPS 140-2 approved`;
  }

  return {
    compliant,
    reason,
    algorithmValid,
    keyLengthValid,
    hashValid,
  };
}

/**
 * List all FIPS-approved algorithms
 *
 * @returns Object containing all approved algorithms by category
 */
export function listFIPSApprovedAlgorithms(): {
  symmetric: string[];
  hash: string[];
  hmac: string[];
  asymmetric: string[];
  curves: string[];
} {
  const {
    FIPS_SYMMETRIC_ALGORITHMS: sym,
    FIPS_HASH_ALGORITHMS: hash,
    FIPS_HMAC_ALGORITHMS: hmac,
    FIPS_ASYMMETRIC_ALGORITHMS: asym,
    FIPS_ECDSA_CURVES: curves,
  } = require('./fips-mode.js');

  return {
    symmetric: Object.values(sym) as string[],
    hash: Object.values(hash) as string[],
    hmac: Object.keys(hmac),
    asymmetric: Object.keys(asym),
    curves: Object.keys(curves),
  };
}

// =============================================================================
// Post-Quantum Cryptography Module
// =============================================================================

/**
 * Post-Quantum Cryptography exports
 *
 * Re-exported from @vorionsys/security to avoid code duplication.
 * Provides NIST-standardized post-quantum algorithms:
 * - CRYSTALS-Kyber (ML-KEM) for key encapsulation
 * - CRYSTALS-Dilithium (ML-DSA) for digital signatures
 * - Hybrid modes combining classical and PQ algorithms
 * - Migration utilities for transitioning to PQ
 *
 * @example
 * ```typescript
 * import { postQuantum } from './security/crypto';
 *
 * const pq = await postQuantum.createPostQuantumProvider();
 * const keyPair = await pq.generateKEMKeyPair();
 * ```
 */
export { postQuantum } from '@vorion/security/crypto';

// =============================================================================
// Shamir Secret Sharing Module
// =============================================================================

/**
 * Verified Shamir Secret Sharing exports
 *
 * Provides formally verified Shamir Secret Sharing with:
 * - GF(2^8) arithmetic with proven correctness
 * - Polynomial evaluation with overflow protection
 * - Lagrange interpolation with numerical stability
 * - Constant-time operations to prevent timing attacks
 * - Comprehensive testing and security analysis
 * - Interoperability with HashiCorp Vault and secrets.js
 *
 * @example
 * ```typescript
 * import { shamir } from './security/crypto';
 *
 * // Split a secret into shares
 * const secret = new TextEncoder().encode('my-secret-key');
 * const { shares } = shamir.split(secret, {
 *   threshold: 3,
 *   totalShares: 5,
 *   secretLength: secret.length,
 * });
 *
 * // Reconstruct with any 3 shares
 * const { secret: recovered } = shamir.reconstruct(shares.slice(0, 3), 3);
 * ```
 */
export * as shamir from './shamir/index.js';
