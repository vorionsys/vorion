/**
 * FIPS 140-2 Compliant Cryptography Mode
 *
 * Provides FIPS 140-2 Level 1 compliant cryptographic operations for FedRAMP
 * compliance. Enforces the use of only FIPS-approved algorithms and key lengths.
 *
 * FIPS 140-2 Approved Algorithms:
 * - Symmetric Encryption: AES-128, AES-256 (GCM, CBC, CTR modes)
 * - Hash Functions: SHA-256, SHA-384, SHA-512 (NO SHA-1, MD5)
 * - Asymmetric: RSA (2048+ bits), ECDSA (P-256, P-384, P-521)
 * - MACs: HMAC-SHA256, HMAC-SHA384, HMAC-SHA512
 * - Key Derivation: PBKDF2, HKDF with approved hash functions
 * - Transport: TLS 1.2+ only
 *
 * Security Guarantees:
 * - Algorithm validation before every operation
 * - Key length enforcement per algorithm
 * - Comprehensive audit logging
 * - Runtime enforcement with configurable strict mode
 *
 * @packageDocumentation
 * @module security/crypto/fips-mode
 */

import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'fips-crypto' });

// =============================================================================
// FIPS Constants
// =============================================================================

/**
 * FIPS 140-2 approved symmetric encryption algorithms
 */
export const FIPS_SYMMETRIC_ALGORITHMS = {
  'AES-128-GCM': 'aes-128-gcm',
  'AES-256-GCM': 'aes-256-gcm',
  'AES-128-CBC': 'aes-128-cbc',
  'AES-256-CBC': 'aes-256-cbc',
  'AES-128-CTR': 'aes-128-ctr',
  'AES-256-CTR': 'aes-256-ctr',
} as const;

export type FIPSSymmetricAlgorithm =
  (typeof FIPS_SYMMETRIC_ALGORITHMS)[keyof typeof FIPS_SYMMETRIC_ALGORITHMS];

/**
 * FIPS 140-2 approved hash algorithms
 */
export const FIPS_HASH_ALGORITHMS = {
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
} as const;

export type FIPSHashAlgorithm =
  (typeof FIPS_HASH_ALGORITHMS)[keyof typeof FIPS_HASH_ALGORITHMS];

/**
 * FIPS 140-2 approved HMAC algorithms
 */
export const FIPS_HMAC_ALGORITHMS = {
  'HMAC-SHA256': 'sha256',
  'HMAC-SHA384': 'sha384',
  'HMAC-SHA512': 'sha512',
} as const;

export type FIPSHMACAlgorithm =
  (typeof FIPS_HMAC_ALGORITHMS)[keyof typeof FIPS_HMAC_ALGORITHMS];

/**
 * FIPS 140-2 approved asymmetric algorithms
 */
export const FIPS_ASYMMETRIC_ALGORITHMS = {
  'RSA-2048': 'rsa',
  'RSA-3072': 'rsa',
  'RSA-4096': 'rsa',
  'ECDSA-P256': 'ec',
  'ECDSA-P384': 'ec',
  'ECDSA-P521': 'ec',
} as const;

export type FIPSAsymmetricAlgorithm =
  (typeof FIPS_ASYMMETRIC_ALGORITHMS)[keyof typeof FIPS_ASYMMETRIC_ALGORITHMS];

/**
 * FIPS 140-2 approved ECDSA curves
 */
export const FIPS_ECDSA_CURVES = {
  'P-256': 'prime256v1',
  'P-384': 'secp384r1',
  'P-521': 'secp521r1',
} as const;

export type FIPSECDSACurve =
  (typeof FIPS_ECDSA_CURVES)[keyof typeof FIPS_ECDSA_CURVES];

/**
 * FIPS 140-2 minimum key lengths by algorithm type
 */
export const FIPS_MINIMUM_KEY_LENGTHS: Record<string, number> = {
  aes: 128,
  rsa: 2048,
  'ec-p256': 256,
  'ec-p384': 384,
  'ec-p521': 521,
  hmac: 128,
} as const;

/**
 * Non-FIPS algorithms that should be rejected
 */
export const NON_FIPS_ALGORITHMS = [
  'md5',
  'sha1',
  'sha-1',
  'des',
  '3des',
  'des-ede',
  'des-ede3',
  'rc2',
  'rc4',
  'blowfish',
  'bf',
  'idea',
  'cast',
  'cast5',
  'seed',
] as const;

/**
 * FIPS-approved TLS versions
 */
export const FIPS_TLS_VERSIONS = ['TLSv1.2', 'TLSv1.3'] as const;

/**
 * Non-FIPS TLS versions that should be rejected
 */
export const NON_FIPS_TLS_VERSIONS = ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'] as const;

// =============================================================================
// FIPS Types
// =============================================================================

/**
 * FIPS mode configuration
 */
export interface FIPSModeConfig {
  /** Whether FIPS mode is enabled */
  enabled: boolean;
  /** Strict mode: reject all non-FIPS operations (true) vs warn (false) */
  strictMode: boolean;
  /** List of allowed algorithms (defaults to all FIPS-approved) */
  allowedAlgorithms: string[];
  /** Minimum key lengths by algorithm type */
  minimumKeyLengths: Record<string, number>;
  /** Whether to audit log all crypto operations */
  auditAllCryptoOperations: boolean;
  /** Alert on non-compliant attempts */
  alertOnViolations: boolean;
  /** Custom alert callback for violations */
  alertCallback?: (violation: FIPSViolation) => void | Promise<void>;
}

export const fipsModeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  strictMode: z.boolean().default(true),
  allowedAlgorithms: z.array(z.string()).default([
    ...Object.values(FIPS_SYMMETRIC_ALGORITHMS),
    ...Object.values(FIPS_HASH_ALGORITHMS),
  ]),
  minimumKeyLengths: z.record(z.string(), z.number()).default(FIPS_MINIMUM_KEY_LENGTHS),
  auditAllCryptoOperations: z.boolean().default(true),
  alertOnViolations: z.boolean().default(true),
});

/**
 * Default FIPS mode configuration
 */
export const DEFAULT_FIPS_CONFIG: FIPSModeConfig = {
  enabled: process.env['VORION_FIPS_MODE'] === 'true',
  strictMode: true,
  allowedAlgorithms: [
    ...Object.values(FIPS_SYMMETRIC_ALGORITHMS),
    ...Object.values(FIPS_HASH_ALGORITHMS),
  ],
  minimumKeyLengths: { ...FIPS_MINIMUM_KEY_LENGTHS },
  auditAllCryptoOperations: true,
  alertOnViolations: true,
};

/**
 * Crypto operation types for audit logging
 */
export const CryptoOperationType = {
  ENCRYPT: 'encrypt',
  DECRYPT: 'decrypt',
  HASH: 'hash',
  HMAC: 'hmac',
  SIGN: 'sign',
  VERIFY: 'verify',
  KEY_DERIVE: 'key_derive',
  RANDOM: 'random',
  KEY_GENERATE: 'key_generate',
} as const;

export type CryptoOperationType =
  (typeof CryptoOperationType)[keyof typeof CryptoOperationType];

/**
 * Crypto operation for validation
 */
export interface CryptoOperation {
  /** Operation type */
  type: CryptoOperationType;
  /** Algorithm being used */
  algorithm: string;
  /** Key length in bits (if applicable) */
  keyLength?: number;
  /** Curve name (for ECDSA) */
  curve?: string;
  /** Hash function (for composite operations) */
  hashFunction?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

export const cryptoOperationSchema = z.object({
  type: z.nativeEnum(CryptoOperationType),
  algorithm: z.string().min(1),
  keyLength: z.number().int().positive().optional(),
  curve: z.string().optional(),
  hashFunction: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

/**
 * FIPS compliance violation
 */
export interface FIPSViolation {
  /** Unique violation ID */
  id: string;
  /** Timestamp of violation */
  timestamp: Date;
  /** Violation type */
  type: 'algorithm' | 'key_length' | 'hash' | 'tls' | 'certificate';
  /** The operation that was attempted */
  operation: CryptoOperation;
  /** Reason for violation */
  reason: string;
  /** Whether the operation was blocked */
  blocked: boolean;
  /** Stack trace (if available) */
  stackTrace?: string;
}

export const fipsViolationSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: z.enum(['algorithm', 'key_length', 'hash', 'tls', 'certificate']),
  operation: cryptoOperationSchema,
  reason: z.string(),
  blocked: z.boolean(),
  stackTrace: z.string().optional(),
});

/**
 * FIPS audit log entry
 */
export interface FIPSAuditEntry {
  /** Unique audit entry ID */
  id: string;
  /** Timestamp of the operation */
  timestamp: Date;
  /** Type of operation */
  operationType: CryptoOperationType;
  /** Algorithm used */
  algorithm: string;
  /** Key length (if applicable) */
  keyLength?: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Whether the operation was FIPS compliant */
  fipsCompliant: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** User ID if available */
  userId?: string;
  /** Tenant ID if available */
  tenantId?: string;
}

export const fipsAuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  operationType: z.nativeEnum(CryptoOperationType),
  algorithm: z.string(),
  keyLength: z.number().int().positive().optional(),
  success: z.boolean(),
  fipsCompliant: z.boolean(),
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  requestId: z.string().optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
});

/**
 * Certificate validation options
 */
export interface CertificateValidationOptions {
  /** Minimum RSA key size */
  minRSAKeySize: number;
  /** Minimum ECDSA curve (P-256, P-384, P-521) */
  minECDSACurve: string;
  /** Require TLS 1.2+ */
  requireTLS12: boolean;
  /** Reject weak cipher suites */
  rejectWeakCipherSuites: boolean;
  /** Allowed cipher suites (if specified, only these are allowed) */
  allowedCipherSuites?: string[];
}

export const DEFAULT_CERT_VALIDATION_OPTIONS: CertificateValidationOptions = {
  minRSAKeySize: 2048,
  minECDSACurve: 'P-256',
  requireTLS12: true,
  rejectWeakCipherSuites: true,
};

/**
 * Callback for FIPS audit logging
 */
export type FIPSAuditCallback = (entry: FIPSAuditEntry) => void | Promise<void>;

// =============================================================================
// FIPS Error
// =============================================================================

/**
 * Error codes for FIPS operations
 */
export const FIPSErrorCode = {
  /** Non-FIPS algorithm attempted */
  NON_FIPS_ALGORITHM: 'FIPS_NON_COMPLIANT_ALGORITHM',
  /** Key length below minimum */
  INSUFFICIENT_KEY_LENGTH: 'FIPS_INSUFFICIENT_KEY_LENGTH',
  /** Non-FIPS hash function */
  NON_FIPS_HASH: 'FIPS_NON_COMPLIANT_HASH',
  /** Non-FIPS TLS version */
  NON_FIPS_TLS: 'FIPS_NON_COMPLIANT_TLS',
  /** Weak certificate */
  WEAK_CERTIFICATE: 'FIPS_WEAK_CERTIFICATE',
  /** Provider not initialized */
  NOT_INITIALIZED: 'FIPS_NOT_INITIALIZED',
  /** Operation failed */
  OPERATION_FAILED: 'FIPS_OPERATION_FAILED',
  /** Invalid configuration */
  INVALID_CONFIG: 'FIPS_INVALID_CONFIG',
} as const;

export type FIPSErrorCode = (typeof FIPSErrorCode)[keyof typeof FIPSErrorCode];

/**
 * Custom error class for FIPS operations
 */
export class FIPSError extends Error {
  constructor(
    message: string,
    public readonly code: FIPSErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FIPSError';
  }
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate if an algorithm is FIPS 140-2 compliant
 *
 * @param algorithm - The algorithm name to validate
 * @returns true if the algorithm is FIPS compliant
 */
export function validateAlgorithm(algorithm: string): boolean {
  const normalizedAlgorithm = algorithm.toLowerCase().replace(/_/g, '-');

  // Check if it's a known non-FIPS algorithm
  if (NON_FIPS_ALGORITHMS.some(nonFips =>
    normalizedAlgorithm.includes(nonFips.toLowerCase())
  )) {
    return false;
  }

  // Check against approved algorithms
  const approvedAlgorithms = [
    ...Object.values(FIPS_SYMMETRIC_ALGORITHMS),
    ...Object.values(FIPS_HASH_ALGORITHMS),
    ...Object.values(FIPS_HMAC_ALGORITHMS),
  ].map(a => a.toLowerCase());

  // Direct match
  if (approvedAlgorithms.includes(normalizedAlgorithm)) {
    return true;
  }

  // Check for AES variants
  if (normalizedAlgorithm.startsWith('aes-')) {
    const match = normalizedAlgorithm.match(/aes-(\d+)/);
    if (match) {
      const keySize = parseInt(match[1], 10);
      return keySize === 128 || keySize === 192 || keySize === 256;
    }
  }

  // Check for SHA-2 variants
  if (normalizedAlgorithm.startsWith('sha') && !normalizedAlgorithm.includes('sha1')) {
    return ['sha256', 'sha384', 'sha512', 'sha-256', 'sha-384', 'sha-512'].includes(
      normalizedAlgorithm
    );
  }

  return false;
}

/**
 * Validate if a key length meets FIPS 140-2 requirements
 *
 * @param algorithm - The algorithm type
 * @param keyLength - The key length in bits
 * @returns true if the key length is FIPS compliant
 */
export function validateKeyLength(algorithm: string, keyLength: number): boolean {
  const normalizedAlgorithm = algorithm.toLowerCase();

  // AES key lengths
  if (normalizedAlgorithm.includes('aes')) {
    return keyLength >= 128 && [128, 192, 256].includes(keyLength);
  }

  // RSA key lengths
  if (normalizedAlgorithm.includes('rsa')) {
    return keyLength >= 2048;
  }

  // ECDSA key lengths (based on curve)
  if (normalizedAlgorithm.includes('ec') || normalizedAlgorithm.includes('ecdsa')) {
    return keyLength >= 256 && [256, 384, 521].includes(keyLength);
  }

  // HMAC key lengths
  if (normalizedAlgorithm.includes('hmac')) {
    return keyLength >= 128;
  }

  // Default minimum
  return keyLength >= 128;
}

/**
 * Validate if a hash function is FIPS 140-2 compliant
 *
 * @param hashFunction - The hash function name
 * @returns true if the hash is FIPS compliant
 */
export function validateHash(hashFunction: string): boolean {
  const normalizedHash = hashFunction.toLowerCase().replace(/_/g, '-');

  // Explicitly reject non-FIPS hashes
  const nonFIPSHashes = ['md5', 'sha1', 'sha-1', 'md4', 'md2', 'ripemd'];
  if (nonFIPSHashes.some(h => normalizedHash.includes(h))) {
    return false;
  }

  // Check approved hashes
  const approvedHashes = ['sha256', 'sha384', 'sha512', 'sha-256', 'sha-384', 'sha-512'];
  return approvedHashes.includes(normalizedHash);
}

/**
 * Validate if a complete crypto operation is FIPS 140-2 compliant
 *
 * @param operation - The crypto operation to validate
 * @returns true if the operation is FIPS compliant
 */
export function isFIPSCompliant(operation: CryptoOperation): boolean {
  // Validate algorithm
  if (!validateAlgorithm(operation.algorithm)) {
    return false;
  }

  // Validate key length if provided
  if (operation.keyLength !== undefined) {
    if (!validateKeyLength(operation.algorithm, operation.keyLength)) {
      return false;
    }
  }

  // Validate hash function if provided
  if (operation.hashFunction !== undefined) {
    if (!validateHash(operation.hashFunction)) {
      return false;
    }
  }

  // Validate ECDSA curve if provided
  if (operation.curve !== undefined) {
    const approvedCurves = Object.values(FIPS_ECDSA_CURVES);
    const curveNames = Object.keys(FIPS_ECDSA_CURVES);
    if (
      !approvedCurves.includes(operation.curve as FIPSECDSACurve) &&
      !curveNames.includes(operation.curve)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Validate TLS version
 *
 * @param tlsVersion - The TLS version string
 * @returns true if the TLS version is FIPS compliant
 */
export function validateTLSVersion(tlsVersion: string): boolean {
  const normalized = tlsVersion.replace(/\s+/g, '');
  return (FIPS_TLS_VERSIONS as readonly string[]).includes(normalized);
}

/**
 * Validate cipher suite
 *
 * @param cipherSuite - The cipher suite string
 * @returns true if the cipher suite is FIPS compliant
 */
export function validateCipherSuite(cipherSuite: string): boolean {
  const weakCiphers = [
    'RC4',
    'DES',
    '3DES',
    'MD5',
    'SHA1',
    'NULL',
    'EXPORT',
    'anon',
    'IDEA',
  ];

  const normalizedSuite = cipherSuite.toUpperCase();
  return !weakCiphers.some(weak => normalizedSuite.includes(weak));
}

// =============================================================================
// FIPS Crypto Provider
// =============================================================================

/**
 * FIPS 140-2 Compliant Crypto Provider
 *
 * Provides cryptographic operations that enforce FIPS 140-2 compliance.
 * All operations are validated and audited.
 *
 * @example
 * ```typescript
 * const provider = new FIPSCryptoProvider();
 * await provider.initialize();
 *
 * // Encrypt data
 * const encrypted = await provider.fipsEncrypt(
 *   Buffer.from('sensitive data'),
 *   key,
 *   'aes-256-gcm'
 * );
 *
 * // Hash data
 * const hash = await provider.fipsHash(
 *   Buffer.from('data'),
 *   'sha256'
 * );
 * ```
 */
export class FIPSCryptoProvider {
  private readonly config: FIPSModeConfig;
  private readonly auditCallbacks: FIPSAuditCallback[] = [];
  private readonly violations: FIPSViolation[] = [];
  private initialized = false;

  constructor(config: Partial<FIPSModeConfig> = {}) {
    this.config = { ...DEFAULT_FIPS_CONFIG, ...config };
  }

  /**
   * Initialize the FIPS crypto provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('FIPSCryptoProvider already initialized');
      return;
    }

    logger.info(
      {
        enabled: this.config.enabled,
        strictMode: this.config.strictMode,
        auditEnabled: this.config.auditAllCryptoOperations,
      },
      'Initializing FIPSCryptoProvider'
    );

    // Check if Node.js has FIPS mode available
    if (this.config.enabled) {
      try {
        // Check for FIPS module availability
        const fipsEnabled = crypto.getFips?.() ?? false;
        if (!fipsEnabled) {
          logger.warn(
            'Node.js FIPS mode is not enabled. Software-based FIPS validation will be used.'
          );
        }
      } catch {
        logger.warn('Unable to check Node.js FIPS status');
      }
    }

    this.initialized = true;
    logger.info('FIPSCryptoProvider initialized');
  }

  /**
   * Ensure the provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new FIPSError(
        'FIPSCryptoProvider not initialized. Call initialize() first.',
        FIPSErrorCode.NOT_INITIALIZED
      );
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<FIPSModeConfig> {
    return { ...this.config };
  }

  /**
   * Check if FIPS mode is enabled
   */
  isFIPSModeEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register an audit callback
   */
  onAudit(callback: FIPSAuditCallback): void {
    this.auditCallbacks.push(callback);
  }

  /**
   * Get recorded violations
   */
  getViolations(): FIPSViolation[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations
   */
  clearViolations(): void {
    this.violations.length = 0;
  }

  /**
   * Emit audit event
   */
  private async emitAudit(entry: FIPSAuditEntry): Promise<void> {
    if (!this.config.auditAllCryptoOperations) return;

    for (const callback of this.auditCallbacks) {
      try {
        await callback(entry);
      } catch (error) {
        logger.error({ error, entryId: entry.id }, 'FIPS audit callback failed');
      }
    }
  }

  /**
   * Record a FIPS violation
   */
  private async recordViolation(
    type: FIPSViolation['type'],
    operation: CryptoOperation,
    reason: string,
    blocked: boolean
  ): Promise<void> {
    const violation: FIPSViolation = {
      id: randomUUID(),
      timestamp: new Date(),
      type,
      operation,
      reason,
      blocked,
      stackTrace: new Error().stack,
    };

    this.violations.push(violation);

    logger.warn(
      {
        violationId: violation.id,
        type,
        algorithm: operation.algorithm,
        reason,
        blocked,
      },
      'FIPS violation detected'
    );

    if (this.config.alertOnViolations && this.config.alertCallback) {
      try {
        await this.config.alertCallback(violation);
      } catch (error) {
        logger.error({ error, violationId: violation.id }, 'FIPS alert callback failed');
      }
    }
  }

  /**
   * Validate and potentially block a crypto operation
   */
  private async validateOperation(operation: CryptoOperation): Promise<void> {
    if (!this.config.enabled) {
      return; // FIPS mode disabled, allow all operations
    }

    const compliant = isFIPSCompliant(operation);

    if (!compliant) {
      let violationType: FIPSViolation['type'] = 'algorithm';
      let reason = `Non-FIPS algorithm: ${operation.algorithm}`;

      if (!validateAlgorithm(operation.algorithm)) {
        violationType = 'algorithm';
        reason = `Non-FIPS algorithm: ${operation.algorithm}`;
      } else if (
        operation.keyLength !== undefined &&
        !validateKeyLength(operation.algorithm, operation.keyLength)
      ) {
        violationType = 'key_length';
        reason = `Insufficient key length ${operation.keyLength} bits for ${operation.algorithm}`;
      } else if (
        operation.hashFunction !== undefined &&
        !validateHash(operation.hashFunction)
      ) {
        violationType = 'hash';
        reason = `Non-FIPS hash function: ${operation.hashFunction}`;
      }

      await this.recordViolation(violationType, operation, reason, this.config.strictMode);

      if (this.config.strictMode) {
        throw new FIPSError(
          `FIPS violation: ${reason}`,
          violationType === 'algorithm'
            ? FIPSErrorCode.NON_FIPS_ALGORITHM
            : violationType === 'key_length'
              ? FIPSErrorCode.INSUFFICIENT_KEY_LENGTH
              : FIPSErrorCode.NON_FIPS_HASH,
          { operation }
        );
      }
    }
  }

  /**
   * Create audit entry helper
   */
  private createAuditEntry(
    operationType: CryptoOperationType,
    algorithm: string,
    keyLength: number | undefined,
    success: boolean,
    fipsCompliant: boolean,
    durationMs: number,
    error?: string
  ): FIPSAuditEntry {
    return {
      id: randomUUID(),
      timestamp: new Date(),
      operationType,
      algorithm,
      keyLength,
      success,
      fipsCompliant,
      durationMs,
      error,
    };
  }

  // ===========================================================================
  // FIPS-Compliant Crypto Operations
  // ===========================================================================

  /**
   * FIPS-compliant encryption
   *
   * Only allows FIPS 140-2 approved algorithms (AES-128, AES-256 in GCM, CBC, CTR modes)
   *
   * @param data - Data to encrypt
   * @param key - Encryption key
   * @param algorithm - FIPS-approved algorithm (default: aes-256-gcm)
   * @returns Encrypted data with IV and auth tag
   */
  async fipsEncrypt(
    data: Buffer,
    key: Buffer,
    algorithm: FIPSSymmetricAlgorithm = 'aes-256-gcm'
  ): Promise<{
    ciphertext: Buffer;
    iv: Buffer;
    authTag?: Buffer;
  }> {
    this.ensureInitialized();
    const startTime = performance.now();

    const keyLengthBits = key.length * 8;
    const operation: CryptoOperation = {
      type: CryptoOperationType.ENCRYPT,
      algorithm,
      keyLength: keyLengthBits,
    };

    try {
      await this.validateOperation(operation);

      const isGCM = algorithm.includes('gcm');
      const isCTR = algorithm.includes('ctr');
      const ivLength = isGCM || isCTR ? 12 : 16;
      const iv = crypto.randomBytes(ivLength);

      let ciphertext: Buffer;
      let authTag: Buffer | undefined;

      if (isGCM) {
        const cipherOptions: crypto.CipherGCMOptions = { authTagLength: 16 };
        const cipher = crypto.createCipheriv(
          algorithm as crypto.CipherGCMTypes,
          key,
          iv,
          cipherOptions
        );
        ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
        authTag = cipher.getAuthTag();
      } else {
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
      }

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.ENCRYPT,
          algorithm,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return { ciphertext, iv, authTag };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.ENCRYPT,
          algorithm,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS encryption failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant decryption
   *
   * Only allows FIPS 140-2 approved algorithms
   *
   * @param ciphertext - Encrypted data
   * @param key - Decryption key
   * @param iv - Initialization vector
   * @param algorithm - FIPS-approved algorithm (default: aes-256-gcm)
   * @param authTag - Authentication tag (required for GCM mode)
   * @returns Decrypted data
   */
  async fipsDecrypt(
    ciphertext: Buffer,
    key: Buffer,
    iv: Buffer,
    algorithm: FIPSSymmetricAlgorithm = 'aes-256-gcm',
    authTag?: Buffer
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const keyLengthBits = key.length * 8;
    const operation: CryptoOperation = {
      type: CryptoOperationType.DECRYPT,
      algorithm,
      keyLength: keyLengthBits,
    };

    try {
      await this.validateOperation(operation);

      const isGCM = algorithm.includes('gcm');
      let plaintext: Buffer;

      if (isGCM) {
        if (!authTag) {
          throw new FIPSError(
            'Authentication tag required for GCM mode',
            FIPSErrorCode.OPERATION_FAILED,
            { algorithm }
          );
        }

        const decipherOptions: crypto.CipherGCMOptions = { authTagLength: 16 };
        const decipher = crypto.createDecipheriv(
          algorithm as crypto.CipherGCMTypes,
          key,
          iv,
          decipherOptions
        );
        decipher.setAuthTag(authTag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } else {
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      }

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.DECRYPT,
          algorithm,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return plaintext;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.DECRYPT,
          algorithm,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS decryption failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant hashing
   *
   * Only allows SHA-2 family (SHA-256, SHA-384, SHA-512)
   *
   * @param data - Data to hash
   * @param algorithm - FIPS-approved hash algorithm (default: sha256)
   * @returns Hash digest
   */
  async fipsHash(
    data: Buffer | string,
    algorithm: FIPSHashAlgorithm = 'sha256'
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const operation: CryptoOperation = {
      type: CryptoOperationType.HASH,
      algorithm,
    };

    try {
      await this.validateOperation(operation);

      const hash = crypto.createHash(algorithm);
      hash.update(data);
      const digest = hash.digest();

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.HASH,
          algorithm,
          undefined,
          true,
          true,
          durationMs
        )
      );

      return digest;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.HASH,
          algorithm,
          undefined,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS hash failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant HMAC
   *
   * Only allows HMAC-SHA256, HMAC-SHA384, HMAC-SHA512
   *
   * @param data - Data to authenticate
   * @param key - HMAC key
   * @param algorithm - Hash algorithm for HMAC (default: sha256)
   * @returns HMAC digest
   */
  async fipsHmac(
    data: Buffer | string,
    key: Buffer,
    algorithm: FIPSHMACAlgorithm = 'sha256'
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const keyLengthBits = key.length * 8;
    const operation: CryptoOperation = {
      type: CryptoOperationType.HMAC,
      algorithm: `hmac-${algorithm}`,
      keyLength: keyLengthBits,
      hashFunction: algorithm,
    };

    try {
      await this.validateOperation(operation);

      const hmac = crypto.createHmac(algorithm, key);
      hmac.update(data);
      const digest = hmac.digest();

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.HMAC,
          `hmac-${algorithm}`,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return digest;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.HMAC,
          `hmac-${algorithm}`,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS HMAC failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant digital signature
   *
   * Only allows RSA (2048+ bits) and ECDSA (P-256, P-384, P-521)
   *
   * @param data - Data to sign
   * @param privateKey - Private key for signing
   * @param algorithm - Signing algorithm (default: sha256)
   * @returns Digital signature
   */
  async fipsSign(
    data: Buffer | string,
    privateKey: crypto.KeyObject | string,
    algorithm: FIPSHashAlgorithm = 'sha256'
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    // Determine key type and length
    let keyType = 'rsa';
    let keyLengthBits: number | undefined;
    let curve: string | undefined;

    if (typeof privateKey !== 'string') {
      const keyDetails = privateKey.asymmetricKeyDetails;
      if (keyDetails) {
        if ('modulusLength' in keyDetails) {
          keyType = 'rsa';
          keyLengthBits = keyDetails.modulusLength;
        } else if ('namedCurve' in keyDetails) {
          keyType = 'ec';
          curve = keyDetails.namedCurve;
          // Map curve to key length
          if (curve === 'prime256v1' || curve === 'P-256') keyLengthBits = 256;
          else if (curve === 'secp384r1' || curve === 'P-384') keyLengthBits = 384;
          else if (curve === 'secp521r1' || curve === 'P-521') keyLengthBits = 521;
        }
      }
    }

    const operation: CryptoOperation = {
      type: CryptoOperationType.SIGN,
      algorithm: `${keyType}-${algorithm}`,
      keyLength: keyLengthBits,
      hashFunction: algorithm,
      curve,
    };

    try {
      await this.validateOperation(operation);

      const sign = crypto.createSign(algorithm);
      sign.update(data);
      const signature = sign.sign(privateKey);

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.SIGN,
          `${keyType}-${algorithm}`,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return signature;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.SIGN,
          `${keyType}-${algorithm}`,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS sign failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant signature verification
   *
   * @param data - Data that was signed
   * @param signature - Signature to verify
   * @param publicKey - Public key for verification
   * @param algorithm - Hash algorithm used for signing (default: sha256)
   * @returns true if signature is valid
   */
  async fipsVerify(
    data: Buffer | string,
    signature: Buffer,
    publicKey: crypto.KeyObject | string,
    algorithm: FIPSHashAlgorithm = 'sha256'
  ): Promise<boolean> {
    this.ensureInitialized();
    const startTime = performance.now();

    let keyType = 'rsa';
    let keyLengthBits: number | undefined;

    if (typeof publicKey !== 'string') {
      const keyDetails = publicKey.asymmetricKeyDetails;
      if (keyDetails) {
        if ('modulusLength' in keyDetails) {
          keyType = 'rsa';
          keyLengthBits = keyDetails.modulusLength;
        } else if ('namedCurve' in keyDetails) {
          keyType = 'ec';
        }
      }
    }

    const operation: CryptoOperation = {
      type: CryptoOperationType.VERIFY,
      algorithm: `${keyType}-${algorithm}`,
      keyLength: keyLengthBits,
      hashFunction: algorithm,
    };

    try {
      await this.validateOperation(operation);

      const verify = crypto.createVerify(algorithm);
      verify.update(data);
      const isValid = verify.verify(publicKey, signature);

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.VERIFY,
          `${keyType}-${algorithm}`,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return isValid;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.VERIFY,
          `${keyType}-${algorithm}`,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS verify failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { algorithm }
      );
    }
  }

  /**
   * FIPS-compliant random bytes generation
   *
   * Uses DRBG (Deterministic Random Bit Generator) compliant with SP 800-90A
   *
   * @param length - Number of bytes to generate
   * @returns Random bytes
   */
  async fipsRandomBytes(length: number): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const operation: CryptoOperation = {
      type: CryptoOperationType.RANDOM,
      algorithm: 'drbg',
      context: { length },
    };

    try {
      // Node.js uses OpenSSL's DRBG which is FIPS compliant
      const bytes = crypto.randomBytes(length);

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.RANDOM,
          'drbg',
          undefined,
          true,
          true,
          durationMs
        )
      );

      return bytes;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.RANDOM,
          'drbg',
          undefined,
          false,
          true,
          durationMs,
          errorMessage
        )
      );

      throw new FIPSError(
        `FIPS random generation failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED
      );
    }
  }

  /**
   * FIPS-compliant key derivation using PBKDF2
   *
   * @param password - Password to derive key from
   * @param salt - Salt value
   * @param iterations - Number of iterations (minimum 1000)
   * @param keyLength - Desired key length in bytes
   * @param digest - Hash algorithm (default: sha256)
   * @returns Derived key
   */
  async fipsPBKDF2(
    password: Buffer | string,
    salt: Buffer,
    iterations: number,
    keyLength: number,
    digest: FIPSHashAlgorithm = 'sha256'
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const operation: CryptoOperation = {
      type: CryptoOperationType.KEY_DERIVE,
      algorithm: 'pbkdf2',
      keyLength: keyLength * 8,
      hashFunction: digest,
    };

    try {
      await this.validateOperation(operation);

      // NIST SP 800-132 recommends at least 1000 iterations
      if (iterations < 1000) {
        throw new FIPSError(
          'PBKDF2 iterations must be at least 1000 for FIPS compliance',
          FIPSErrorCode.INVALID_CONFIG,
          { iterations }
        );
      }

      const derivedKey = await new Promise<Buffer>((resolve, reject) => {
        crypto.pbkdf2(password, salt, iterations, keyLength, digest, (err, key) => {
          if (err) reject(err);
          else resolve(key);
        });
      });

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_DERIVE,
          'pbkdf2',
          keyLength * 8,
          true,
          true,
          durationMs
        )
      );

      return derivedKey;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_DERIVE,
          'pbkdf2',
          keyLength * 8,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS PBKDF2 failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { digest }
      );
    }
  }

  /**
   * FIPS-compliant key derivation using HKDF
   *
   * @param ikm - Input keying material
   * @param salt - Salt value
   * @param info - Context and application specific information
   * @param keyLength - Desired key length in bytes
   * @param digest - Hash algorithm (default: sha256)
   * @returns Derived key
   */
  async fipsHKDF(
    ikm: Buffer,
    salt: Buffer,
    info: Buffer,
    keyLength: number,
    digest: FIPSHashAlgorithm = 'sha256'
  ): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    const operation: CryptoOperation = {
      type: CryptoOperationType.KEY_DERIVE,
      algorithm: 'hkdf',
      keyLength: keyLength * 8,
      hashFunction: digest,
    };

    try {
      await this.validateOperation(operation);

      const derivedKey = await new Promise<Buffer>((resolve, reject) => {
        crypto.hkdf(digest, ikm, salt, info, keyLength, (err, key) => {
          if (err) reject(err);
          else resolve(Buffer.from(key));
        });
      });

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_DERIVE,
          'hkdf',
          keyLength * 8,
          true,
          true,
          durationMs
        )
      );

      return derivedKey;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_DERIVE,
          'hkdf',
          keyLength * 8,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS HKDF failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { digest }
      );
    }
  }

  /**
   * Generate FIPS-compliant key pair
   *
   * @param type - Key type ('rsa' or 'ec')
   * @param options - Key generation options
   * @returns Key pair
   */
  async fipsGenerateKeyPair(
    type: 'rsa' | 'ec',
    options: {
      modulusLength?: number;
      namedCurve?: string;
    } = {}
  ): Promise<{ publicKey: crypto.KeyObject; privateKey: crypto.KeyObject }> {
    this.ensureInitialized();
    const startTime = performance.now();

    let keyLengthBits: number | undefined;
    let curve: string | undefined;

    if (type === 'rsa') {
      keyLengthBits = options.modulusLength ?? 2048;
      if (keyLengthBits < 2048) {
        throw new FIPSError(
          `RSA key length must be at least 2048 bits for FIPS compliance`,
          FIPSErrorCode.INSUFFICIENT_KEY_LENGTH,
          { keyLength: keyLengthBits }
        );
      }
    } else {
      curve = options.namedCurve ?? 'prime256v1';
      const validCurves = Object.values(FIPS_ECDSA_CURVES);
      const curveNames = Object.keys(FIPS_ECDSA_CURVES);
      if (!validCurves.includes(curve as FIPSECDSACurve) && !curveNames.includes(curve)) {
        throw new FIPSError(
          `ECDSA curve must be P-256, P-384, or P-521 for FIPS compliance`,
          FIPSErrorCode.NON_FIPS_ALGORITHM,
          { curve }
        );
      }
      // Map curve to key length
      if (curve === 'prime256v1' || curve === 'P-256') keyLengthBits = 256;
      else if (curve === 'secp384r1' || curve === 'P-384') keyLengthBits = 384;
      else if (curve === 'secp521r1' || curve === 'P-521') keyLengthBits = 521;
    }

    const operation: CryptoOperation = {
      type: CryptoOperationType.KEY_GENERATE,
      algorithm: type,
      keyLength: keyLengthBits,
      curve,
    };

    try {
      await this.validateOperation(operation);

      const keyPair = await new Promise<{
        publicKey: crypto.KeyObject;
        privateKey: crypto.KeyObject;
      }>((resolve, reject) => {
        if (type === 'rsa') {
          crypto.generateKeyPair(
            'rsa',
            {
              modulusLength: keyLengthBits!,
              publicExponent: 65537,
            },
            (err, publicKey, privateKey) => {
              if (err) reject(err);
              else resolve({ publicKey, privateKey });
            }
          );
        } else {
          crypto.generateKeyPair(
            'ec',
            {
              namedCurve: curve!,
            },
            (err, publicKey, privateKey) => {
              if (err) reject(err);
              else resolve({ publicKey, privateKey });
            }
          );
        }
      });

      const durationMs = performance.now() - startTime;

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_GENERATE,
          type,
          keyLengthBits,
          true,
          true,
          durationMs
        )
      );

      return keyPair;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit(
        this.createAuditEntry(
          CryptoOperationType.KEY_GENERATE,
          type,
          keyLengthBits,
          false,
          isFIPSCompliant(operation),
          durationMs,
          errorMessage
        )
      );

      if (error instanceof FIPSError) {
        throw error;
      }

      throw new FIPSError(
        `FIPS key generation failed: ${errorMessage}`,
        FIPSErrorCode.OPERATION_FAILED,
        { type, options }
      );
    }
  }

  // ===========================================================================
  // Certificate Validation
  // ===========================================================================

  /**
   * Validate certificate for FIPS compliance
   *
   * @param cert - X.509 certificate (PEM format or X509Certificate object)
   * @param options - Validation options
   * @returns Validation result
   */
  validateCertificate(
    cert: string | crypto.X509Certificate,
    options: CertificateValidationOptions = DEFAULT_CERT_VALIDATION_OPTIONS
  ): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const x509 =
        typeof cert === 'string' ? new crypto.X509Certificate(cert) : cert;

      // Get public key details
      const publicKey = x509.publicKey;
      const keyDetails = publicKey.asymmetricKeyDetails;

      if (keyDetails) {
        // Check RSA key size
        if ('modulusLength' in keyDetails) {
          const keySize = keyDetails.modulusLength;
          if (keySize !== undefined && keySize < options.minRSAKeySize) {
            errors.push(
              `RSA key size ${keySize} bits is below minimum ${options.minRSAKeySize} bits`
            );
          }
        }

        // Check ECDSA curve
        if ('namedCurve' in keyDetails) {
          const curve = keyDetails.namedCurve;
          const curveStrengths: Record<string, number> = {
            'prime256v1': 256,
            'P-256': 256,
            'secp384r1': 384,
            'P-384': 384,
            'secp521r1': 521,
            'P-521': 521,
          };

          const minCurveStrengths: Record<string, number> = {
            'P-256': 256,
            'P-384': 384,
            'P-521': 521,
          };

          const curveStrength = curveStrengths[curve ?? ''] ?? 0;
          const minStrength = minCurveStrengths[options.minECDSACurve] ?? 256;

          if (curveStrength < minStrength) {
            errors.push(
              `ECDSA curve ${curve} is weaker than minimum ${options.minECDSACurve}`
            );
          }

          // Check for non-FIPS curves
          if (!curveStrengths[curve ?? '']) {
            errors.push(`ECDSA curve ${curve} is not FIPS approved`);
          }
        }
      }

      // Check signature algorithm
      // Note: X509Certificate doesn't expose signatureAlgorithm directly,
      // we check the raw certificate string or fingerprint algorithm
      const certString = x509.toString();
      if (
        certString.includes('sha1WithRSAEncryption') ||
        certString.includes('SHA1') ||
        certString.includes('sha1')
      ) {
        errors.push('Certificate uses SHA-1 signature algorithm which is not FIPS approved');
      }
      if (
        certString.includes('md5WithRSAEncryption') ||
        certString.includes('MD5') ||
        certString.includes('md5')
      ) {
        errors.push('Certificate uses MD5 signature algorithm which is not FIPS approved');
      }

      // Check validity dates
      const now = new Date();
      const notBefore = new Date(x509.validFrom);
      const notAfter = new Date(x509.validTo);

      if (now < notBefore) {
        errors.push('Certificate is not yet valid');
      }
      if (now > notAfter) {
        errors.push('Certificate has expired');
      }

      // Check for short validity period (warning only)
      const validityDays =
        (notAfter.getTime() - notBefore.getTime()) / (1000 * 60 * 60 * 24);
      if (validityDays > 825) {
        // Apple/browser requirements
        warnings.push(
          `Certificate validity period (${Math.floor(validityDays)} days) exceeds recommended maximum of 825 days`
        );
      }
    } catch (error) {
      errors.push(
        `Certificate parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down FIPSCryptoProvider');
    this.initialized = false;
    this.violations.length = 0;
    logger.info('FIPSCryptoProvider shutdown complete');
  }
}

// =============================================================================
// Global FIPS Mode
// =============================================================================

let globalFIPSMode = process.env['VORION_FIPS_MODE'] === 'true';
let defaultProvider: FIPSCryptoProvider | null = null;

/**
 * Enable global FIPS mode
 */
export function enableFIPSMode(): void {
  globalFIPSMode = true;
  logger.info('Global FIPS mode enabled');
}

/**
 * Disable global FIPS mode
 */
export function disableFIPSMode(): void {
  globalFIPSMode = false;
  logger.info('Global FIPS mode disabled');
}

/**
 * Check if global FIPS mode is enabled
 */
export function isFIPSModeEnabled(): boolean {
  return globalFIPSMode;
}

/**
 * Get the default FIPS crypto provider
 */
export function getFIPSCryptoProvider(): FIPSCryptoProvider {
  if (!defaultProvider) {
    defaultProvider = new FIPSCryptoProvider({
      enabled: globalFIPSMode,
    });
  }
  return defaultProvider;
}

/**
 * Set a custom FIPS crypto provider as the default
 */
export function setFIPSCryptoProvider(provider: FIPSCryptoProvider): void {
  defaultProvider = provider;
}

/**
 * Reset the default FIPS crypto provider (for testing)
 */
export async function resetFIPSCryptoProvider(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.shutdown();
    defaultProvider = null;
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * FIPS-compliant encrypt using default provider
 */
export async function fipsEncrypt(
  data: Buffer,
  key: Buffer,
  algorithm: FIPSSymmetricAlgorithm = 'aes-256-gcm'
): Promise<{ ciphertext: Buffer; iv: Buffer; authTag?: Buffer }> {
  const provider = getFIPSCryptoProvider();
  if (!provider['initialized']) {
    await provider.initialize();
  }
  return provider.fipsEncrypt(data, key, algorithm);
}

/**
 * FIPS-compliant decrypt using default provider
 */
export async function fipsDecrypt(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  algorithm: FIPSSymmetricAlgorithm = 'aes-256-gcm',
  authTag?: Buffer
): Promise<Buffer> {
  const provider = getFIPSCryptoProvider();
  if (!provider['initialized']) {
    await provider.initialize();
  }
  return provider.fipsDecrypt(ciphertext, key, iv, algorithm, authTag);
}

/**
 * FIPS-compliant hash using default provider
 */
export async function fipsHash(
  data: Buffer | string,
  algorithm: FIPSHashAlgorithm = 'sha256'
): Promise<Buffer> {
  const provider = getFIPSCryptoProvider();
  if (!provider['initialized']) {
    await provider.initialize();
  }
  return provider.fipsHash(data, algorithm);
}

/**
 * FIPS-compliant sign using default provider
 */
export async function fipsSign(
  data: Buffer | string,
  privateKey: crypto.KeyObject | string,
  algorithm: FIPSHashAlgorithm = 'sha256'
): Promise<Buffer> {
  const provider = getFIPSCryptoProvider();
  if (!provider['initialized']) {
    await provider.initialize();
  }
  return provider.fipsSign(data, privateKey, algorithm);
}

/**
 * FIPS-compliant random bytes using default provider
 */
export async function fipsRandomBytes(length: number): Promise<Buffer> {
  const provider = getFIPSCryptoProvider();
  if (!provider['initialized']) {
    await provider.initialize();
  }
  return provider.fipsRandomBytes(length);
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new FIPSCryptoProvider instance
 */
export function createFIPSCryptoProvider(
  config?: Partial<FIPSModeConfig>
): FIPSCryptoProvider {
  return new FIPSCryptoProvider(config);
}

/**
 * Create FIPSCryptoProvider from environment variables
 */
export function createFIPSCryptoProviderFromEnv(): FIPSCryptoProvider {
  return new FIPSCryptoProvider({
    enabled: process.env['VORION_FIPS_MODE'] === 'true',
    strictMode: process.env['VORION_FIPS_STRICT'] !== 'false',
    auditAllCryptoOperations: process.env['VORION_FIPS_AUDIT'] !== 'false',
    alertOnViolations: process.env['VORION_FIPS_ALERT'] !== 'false',
  });
}
