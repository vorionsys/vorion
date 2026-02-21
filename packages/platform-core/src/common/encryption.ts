/**
 * Encryption utilities for sensitive data at rest
 *
 * Uses AES-256-GCM for authenticated encryption with PBKDF2 key derivation.
 *
 * Security notes:
 * - Key derivation uses PBKDF2-SHA512 with 100,000+ iterations (OWASP recommended)
 * - NEVER falls back to JWT secret (would cause data loss on rotation)
 * - Supports versioned key derivation for future algorithm changes
 * - KDF v1 (SHA-256) is DEPRECATED - migrate all data to v2 before deprecation date
 *
 * KDF v1 DEPRECATION TIMELINE:
 * - Warning phase: Now until 2025-06-01
 * - Error phase: After 2025-06-01, v1 decryption throws an error
 * - Run `vorion migrate encryption` to migrate all v1 data to v2
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, pbkdf2Sync } from 'node:crypto';
import { z } from 'zod';
import { getConfig } from './config.js';
import { EncryptionError, ConfigurationError } from './errors.js';
import { createLogger } from './logger.js';
import { getSecurityMode } from './security-mode.js';
import { validateEntropy } from './crypto-utils.js';
import { safeJsonParse, createSafeParser, sanitizeObject as sanitizeJsonObject } from './safe-json.js';

const logger = createLogger({ component: 'encryption' });

/**
 * Track whether we've already logged the SHA-256 deprecation warning
 * to avoid spamming logs on every decrypt operation
 */
let sha256DeprecationWarningLogged = false;

/**
 * Count of v1 decryption attempts for monitoring
 */
let v1DecryptionCount = 0;

/**
 * KDF v1 deprecation date - after this date, v1 decryption will throw an error
 * Format: YYYY-MM-DD
 */
const KDF_V1_DEPRECATION_DATE = '2025-06-01';

/**
 * Check if v1 KDF is past deprecation date
 */
function isV1Deprecated(): boolean {
  const deprecationDate = new Date(KDF_V1_DEPRECATION_DATE);
  return new Date() > deprecationDate;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * SECURITY: No hardcoded fallback credentials
 *
 * Encryption keys MUST be explicitly configured via environment variables:
 * - VORION_ENCRYPTION_KEY: At least 32 characters, cryptographically random
 * - VORION_ENCRYPTION_SALT: At least 16 characters, cryptographically random
 *
 * Generate secure keys using: vorion secrets generate --type encryption
 *
 * This applies to ALL environments including development.
 * See docs/security/ENCRYPTION_SETUP.md for configuration instructions.
 */

/**
 * Key derivation function versions:
 * - v1: SHA-256 (legacy, insecure - for migration only)
 * - v2: PBKDF2-SHA512 (current, secure)
 */
export type KdfVersion = 1 | 2;

/**
 * Encrypted data envelope containing all components needed for decryption
 */
export interface EncryptedEnvelope {
  /** Encrypted data as base64 */
  ciphertext: string;
  /** Initialization vector as base64 */
  iv: string;
  /** Authentication tag as base64 */
  authTag: string;
  /** Envelope version for future algorithm changes */
  version: 1;
  /**
   * Key derivation version used to encrypt this data
   * - kdfVersion 1: SHA-256 (legacy)
   * - kdfVersion 2: PBKDF2-SHA512 (current)
   * If absent, assumes v1 for backward compatibility
   */
  kdfVersion?: KdfVersion;
}

/**
 * Marker interface to identify encrypted fields in JSON
 */
export interface EncryptedField {
  __encrypted: true;
  envelope: EncryptedEnvelope;
}

/**
 * Error message template for missing encryption configuration
 */
function getEncryptionConfigError(missingKey: string): string {
  const securityMode = getSecurityMode();
  return `CRITICAL: ${missingKey} is not configured.

Encryption keys are REQUIRED in ALL environments (including ${securityMode}).

To configure encryption:

1. Generate secure keys:
   $ vorion secrets generate --type encryption

2. Set environment variables:
   export VORION_ENCRYPTION_KEY="<generated-key>"
   export VORION_ENCRYPTION_SALT="<generated-salt>"

3. Or add to your .env file:
   VORION_ENCRYPTION_KEY=<generated-key>
   VORION_ENCRYPTION_SALT=<generated-salt>

For development setup, see: docs/security/ENCRYPTION_SETUP.md
For key rotation procedures, see: docs/security/KEY_ROTATION.md`;
}

/**
 * Validate encryption key strength using advanced entropy validation
 *
 * Performs comprehensive validation including:
 * - Minimum length check
 * - Shannon entropy calculation
 * - Pattern detection (repeated sequences, keyboard patterns)
 * - Unique character ratio analysis
 *
 * @param key - The encryption key to validate
 * @param keyName - Name of the key for error messages
 * @throws ConfigurationError if key is too weak
 */
function validateKeyStrength(key: string, keyName: string): void {
  const MIN_KEY_LENGTH = 32;
  const MIN_ENTROPY_BITS = 128;

  if (key.length < MIN_KEY_LENGTH) {
    throw new ConfigurationError(
      `${keyName} is too short (${key.length} chars). ` +
      `Minimum length is ${MIN_KEY_LENGTH} characters. ` +
      `Generate a secure key with: vorion secrets generate --type encryption`,
      { keyName, actualLength: key.length, requiredLength: MIN_KEY_LENGTH }
    );
  }

  // Use advanced entropy validation from crypto-utils
  const entropyResult = validateEntropy(key, MIN_ENTROPY_BITS);

  if (!entropyResult.valid) {
    throw new ConfigurationError(
      `${keyName} failed entropy validation: ${entropyResult.reason}. ` +
      `Use a cryptographically random key: vorion secrets generate --type encryption`,
      {
        keyName,
        entropyBits: Math.floor(entropyResult.entropyBits),
        requiredEntropy: MIN_ENTROPY_BITS,
        reason: entropyResult.reason,
      }
    );
  }

  // Log warnings about detected patterns
  if (entropyResult.warnings.length > 0) {
    logger.warn(
      {
        keyName,
        warnings: entropyResult.warnings,
        entropyBits: Math.floor(entropyResult.entropyBits),
      },
      `${keyName} passed validation but has potential weaknesses`
    );
  }
}

/**
 * Derive a 256-bit key using the specified KDF version
 *
 * @param kdfVersion - Which key derivation function to use (1=SHA-256 legacy, 2=PBKDF2)
 * @returns Derived 32-byte key suitable for AES-256
 * @throws ConfigurationError if encryption key is not configured
 */
function deriveKey(kdfVersion: KdfVersion = 2): Buffer {
  const config = getConfig();

  // Get encryption key - REQUIRED, no fallbacks
  const encryptionKey = config.encryption?.key;
  if (!encryptionKey) {
    throw new ConfigurationError(
      getEncryptionConfigError('VORION_ENCRYPTION_KEY'),
      { missingKey: 'VORION_ENCRYPTION_KEY', securityMode: getSecurityMode() }
    );
  }

  // Validate key strength
  validateKeyStrength(encryptionKey, 'VORION_ENCRYPTION_KEY');

  if (kdfVersion === 1) {
    // Check if v1 is past deprecation date
    if (isV1Deprecated()) {
      throw new EncryptionError(
        `KDF v1 (SHA-256) is no longer supported after ${KDF_V1_DEPRECATION_DATE}. ` +
        `All encrypted data must be migrated to KDF v2 using 'vorion migrate encryption'.`,
        {
          kdfVersion: 1,
          deprecationDate: KDF_V1_DEPRECATION_DATE,
          migrationCommand: 'vorion migrate encryption',
        }
      );
    }

    // Increment v1 decryption counter for monitoring
    v1DecryptionCount++;

    // Log security warning for every v1 decryption attempt
    logger.warn(
      {
        kdfVersion: 1,
        v1DecryptionCount,
        deprecationDate: KDF_V1_DEPRECATION_DATE,
        recommendation: 'Run: vorion migrate encryption',
      },
      'SECURITY WARNING: Decrypting data with legacy KDF v1 (SHA-256). ' +
      `This KDF will be disabled after ${KDF_V1_DEPRECATION_DATE}. ` +
      'Please migrate all encrypted data to KDF v2 (PBKDF2-SHA512).'
    );

    // Also log the deprecation warning once
    if (!sha256DeprecationWarningLogged) {
      sha256DeprecationWarningLogged = true;
      logger.warn(
        {
          kdfVersion: 1,
          migrationGuide: 'Use migrateEnvelope() or migrateEncryptedField() to upgrade encrypted data',
          cliCommand: 'vorion migrate encryption',
        },
        'SECURITY DEPRECATION: Legacy SHA-256 key derivation (KDF v1) is deprecated. ' +
        'This method is cryptographically weak and should only be used for decrypting legacy data. ' +
        'Run "vorion migrate encryption" to migrate all data to KDF v2.'
      );
    }

    return createHash('sha256').update(encryptionKey).digest();
  }

  // Version 2: PBKDF2-SHA512 (secure, current)
  const salt = config.encryption?.salt;
  if (!salt) {
    throw new ConfigurationError(
      getEncryptionConfigError('VORION_ENCRYPTION_SALT'),
      { missingKey: 'VORION_ENCRYPTION_SALT', securityMode: getSecurityMode() }
    );
  }

  // Validate salt (less stringent than key, but still required)
  if (salt.length < 16) {
    throw new ConfigurationError(
      `VORION_ENCRYPTION_SALT is too short (${salt.length} chars). ` +
      `Minimum length is 16 characters. ` +
      `Generate a secure salt with: vorion secrets generate --type encryption`,
      { actualLength: salt.length, requiredLength: 16 }
    );
  }

  const iterations = config.encryption?.pbkdf2Iterations ?? 100000;

  return pbkdf2Sync(
    encryptionKey,
    salt,
    iterations,
    KEY_LENGTH,
    'sha512'
  );
}

/**
 * Get the current KDF version from config
 */
function getCurrentKdfVersion(): KdfVersion {
  const config = getConfig();
  return (config.encryption?.kdfVersion ?? 2) as KdfVersion;
}

/**
 * Encrypt a value using AES-256-GCM with PBKDF2-derived key
 */
export function encrypt(plaintext: string): EncryptedEnvelope {
  const kdfVersion = getCurrentKdfVersion();
  const key = deriveKey(kdfVersion);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    version: 1,
    kdfVersion,
  };
}

/**
 * Decrypt a value using AES-256-GCM
 *
 * Automatically detects and uses the correct KDF version from the envelope.
 * This ensures backward compatibility with data encrypted using the legacy SHA-256 method.
 */
export function decrypt(envelope: EncryptedEnvelope): string {
  if (envelope.version !== 1) {
    throw new EncryptionError(`Unsupported encryption version: ${envelope.version}`, { version: envelope.version });
  }

  // Use the KDF version from the envelope, defaulting to v1 for backward compatibility
  // with data encrypted before kdfVersion was added to envelopes
  const kdfVersion: KdfVersion = envelope.kdfVersion ?? 1;
  const key = deriveKey(kdfVersion);
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt a JSON object, returning an encrypted field marker
 */
export function encryptObject(data: Record<string, unknown>): EncryptedField {
  const plaintext = JSON.stringify(data);
  return {
    __encrypted: true,
    envelope: encrypt(plaintext),
  };
}

/**
 * Zod schema for decrypted object data.
 * Allows any valid JSON object structure but ensures it's not a primitive.
 */
const DecryptedObjectSchema = z.record(z.unknown());

/**
 * Safe parser for decrypted JSON objects.
 * Validates the structure and protects against prototype pollution.
 */
const parseDecryptedObject = createSafeParser(DecryptedObjectSchema, {
  maxDepth: 50,
  maxSize: 10 * 1024 * 1024, // 10MB max for decrypted data
  stripPrototype: true,
});

/**
 * Decrypt an encrypted field marker back to a JSON object.
 *
 * Uses safe JSON parsing with prototype pollution protection
 * and schema validation to ensure security.
 */
export function decryptObject(field: EncryptedField): Record<string, unknown> {
  if (!field.__encrypted || !field.envelope) {
    throw new EncryptionError('Invalid encrypted field format', { hasEncryptedFlag: !!field.__encrypted, hasEnvelope: !!field.envelope });
  }
  const plaintext = decrypt(field.envelope);

  try {
    // Use safe JSON parser with schema validation and prototype pollution protection
    return parseDecryptedObject(plaintext);
  } catch (error) {
    // Re-throw as EncryptionError to maintain consistent error handling
    throw new EncryptionError(
      `Failed to parse decrypted JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        originalError: error instanceof Error ? error.message : String(error),
        plaintextLength: plaintext.length,
      }
    );
  }
}

/**
 * Check if a value is an encrypted field
 */
export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__encrypted' in value &&
    (value as EncryptedField).__encrypted === true &&
    'envelope' in value
  );
}

/**
 * Compute SHA-256 hash for tamper detection
 */
export function computeHash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute chained hash (includes previous hash for chain integrity)
 */
export function computeChainedHash(data: string, previousHash: string): string {
  return createHash('sha256')
    .update(previousHash)
    .update(data)
    .digest('hex');
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Check if an envelope needs migration to the current KDF version
 *
 * @param envelope - The encrypted envelope to check
 * @returns true if the envelope uses an older KDF version than current config
 */
export function needsMigration(envelope: EncryptedEnvelope): boolean {
  const currentVersion = getCurrentKdfVersion();
  const envelopeVersion = envelope.kdfVersion ?? 1;
  return envelopeVersion < currentVersion;
}

/**
 * Migrate an encrypted envelope to the current KDF version
 *
 * This decrypts the data using its original KDF and re-encrypts with the current KDF.
 * Use this during a migration window to upgrade legacy encrypted data.
 *
 * @param envelope - The encrypted envelope to migrate
 * @returns New envelope encrypted with current KDF version
 * @throws EncryptionError if decryption or re-encryption fails
 */
export function migrateEnvelope(envelope: EncryptedEnvelope): EncryptedEnvelope {
  if (!needsMigration(envelope)) {
    return envelope; // Already at current version
  }

  // Decrypt with original KDF version (handled automatically by decrypt)
  const plaintext = decrypt(envelope);

  // Re-encrypt with current KDF version
  return encrypt(plaintext);
}

/**
 * Migrate an encrypted field to the current KDF version
 *
 * @param field - The encrypted field to migrate
 * @returns New field with envelope encrypted using current KDF version
 */
export function migrateEncryptedField(field: EncryptedField): EncryptedField {
  if (!needsMigration(field.envelope)) {
    return field;
  }

  return {
    __encrypted: true,
    envelope: migrateEnvelope(field.envelope),
  };
}

/**
 * Get the KDF version used in an envelope
 *
 * @param envelope - The envelope to check
 * @returns The KDF version (1 for legacy, 2 for PBKDF2)
 */
export function getEnvelopeKdfVersion(envelope: EncryptedEnvelope): KdfVersion {
  return envelope.kdfVersion ?? 1;
}

/**
 * Migration result for a single item
 */
export interface MigrationResult {
  success: boolean;
  migrated: boolean;
  originalKdfVersion: KdfVersion;
  newKdfVersion: KdfVersion;
  error?: string;
}

/**
 * Batch migration result
 */
export interface BatchMigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

/**
 * Migrate encrypted data to the latest KDF version
 *
 * This is the main migration function that handles any encrypted data format.
 * It automatically detects the format (envelope or field) and migrates accordingly.
 *
 * @param encryptedData - Encrypted envelope or field to migrate
 * @returns Migrated data in the same format as input
 * @throws EncryptionError if migration fails
 *
 * @example
 * ```typescript
 * // Migrate an envelope
 * const migratedEnvelope = migrateToLatestKdf(legacyEnvelope);
 *
 * // Migrate an encrypted field
 * const migratedField = migrateToLatestKdf(legacyField);
 * ```
 */
export function migrateToLatestKdf(
  encryptedData: EncryptedEnvelope | EncryptedField
): EncryptedEnvelope | EncryptedField {
  // Check if it's an encrypted field
  if ('__encrypted' in encryptedData && encryptedData.__encrypted === true) {
    return migrateEncryptedField(encryptedData as EncryptedField);
  }

  // It's an envelope
  return migrateEnvelope(encryptedData as EncryptedEnvelope);
}

/**
 * Get the v1 KDF deprecation status and information
 *
 * Use this to check deprecation status and show appropriate warnings to users.
 *
 * @returns Deprecation status information
 */
export function getKdfDeprecationStatus(): {
  isDeprecated: boolean;
  deprecationDate: string;
  daysUntilDeprecation: number;
  v1DecryptionCount: number;
} {
  const deprecationDate = new Date(KDF_V1_DEPRECATION_DATE);
  const now = new Date();
  const diffMs = deprecationDate.getTime() - now.getTime();
  const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    isDeprecated: isV1Deprecated(),
    deprecationDate: KDF_V1_DEPRECATION_DATE,
    daysUntilDeprecation: Math.max(0, daysUntil),
    v1DecryptionCount,
  };
}

/**
 * Check startup for v1 encrypted data and log warnings
 *
 * Call this during application startup to warn about legacy encrypted data
 * that needs migration.
 *
 * @param envelopes - Array of encrypted envelopes to check
 * @returns Object with counts of v1 and v2 envelopes
 */
export function checkStartupEncryption(
  envelopes: EncryptedEnvelope[]
): { v1Count: number; v2Count: number; needsMigration: boolean } {
  let v1Count = 0;
  let v2Count = 0;

  for (const envelope of envelopes) {
    const version = getEnvelopeKdfVersion(envelope);
    if (version === 1) {
      v1Count++;
    } else {
      v2Count++;
    }
  }

  const needsMigration = v1Count > 0;

  if (needsMigration) {
    const deprecationStatus = getKdfDeprecationStatus();

    if (deprecationStatus.isDeprecated) {
      logger.error(
        {
          v1Count,
          v2Count,
          deprecationDate: deprecationStatus.deprecationDate,
        },
        'CRITICAL: Found v1 encrypted data after deprecation date. ' +
        'Decryption of this data will fail. Run "vorion migrate encryption" immediately.'
      );
    } else {
      logger.warn(
        {
          v1Count,
          v2Count,
          deprecationDate: deprecationStatus.deprecationDate,
          daysRemaining: deprecationStatus.daysUntilDeprecation,
        },
        `STARTUP WARNING: Found ${v1Count} envelope(s) using deprecated KDF v1. ` +
        `These must be migrated before ${deprecationStatus.deprecationDate} ` +
        `(${deprecationStatus.daysUntilDeprecation} days remaining). ` +
        'Run "vorion migrate encryption" to migrate.'
      );
    }
  }

  return { v1Count, v2Count, needsMigration };
}

/**
 * Migrate a batch of envelopes with progress tracking
 *
 * @param envelopes - Array of envelopes to migrate
 * @param onProgress - Optional callback for progress updates
 * @returns Batch migration result with statistics
 */
export function migrateEnvelopeBatch(
  envelopes: EncryptedEnvelope[],
  onProgress?: (current: number, total: number) => void
): { results: EncryptedEnvelope[]; stats: BatchMigrationResult } {
  const results: EncryptedEnvelope[] = [];
  const stats: BatchMigrationResult = {
    total: envelopes.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i];

    try {
      if (needsMigration(envelope)) {
        results.push(migrateEnvelope(envelope));
        stats.migrated++;
      } else {
        results.push(envelope);
        stats.skipped++;
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push({
        index: i,
        error: error instanceof Error ? error.message : String(error),
      });
      // Keep the original envelope on failure
      results.push(envelope);
    }

    if (onProgress) {
      onProgress(i + 1, envelopes.length);
    }
  }

  return { results, stats };
}

// ============================================================================
// Dependency Injection Utilities
// ============================================================================

import type { Config } from './config.js';

/**
 * Create an encryptIfEnabled function with injected configuration.
 *
 * This factory function removes the service locator anti-pattern by
 * accepting configuration via parameter rather than calling getConfig().
 *
 * NOTE: This version does not include tracing to avoid circular dependencies.
 * Use the traceEncryptSync wrapper from intent/tracing.js when tracing is needed.
 *
 * @param config - Application configuration (for encryption settings)
 * @returns Function that encrypts data if encryption is enabled in config
 *
 * @example
 * // With dependency injection
 * const encryptIfEnabled = createEncryptIfEnabled(config);
 * const encrypted = encryptIfEnabled(sensitiveData);
 *
 * @example
 * // For testing
 * const mockConfig = { intent: { encryptContext: false } } as Config;
 * const encryptIfEnabled = createEncryptIfEnabled(mockConfig);
 */
export function createEncryptIfEnabled(
  config: Config
): (data: Record<string, unknown>) => unknown {
  return (data: Record<string, unknown>): unknown => {
    if (config.intent.encryptContext) {
      return encryptObject(data);
    }
    return data;
  };
}
