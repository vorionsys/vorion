/**
 * Field-Level Encryption Service
 *
 * Core encryption service providing transparent field-level encryption
 * for sensitive data stored in the database.
 *
 * Features:
 * - AES-256-GCM authenticated encryption (default)
 * - ChaCha20-Poly1305 support
 * - Unique IV per encryption operation
 * - AAD (Additional Authenticated Data) for field binding
 * - Key versioning for rotation support
 * - Deterministic encryption for searchable fields
 * - Object-level encryption with policy support
 * - Audit logging for all operations
 *
 * Security guarantees:
 * - Confidentiality: Data is encrypted with strong algorithms
 * - Integrity: AEAD provides authentication
 * - Field binding: AAD prevents field swapping attacks
 * - Key isolation: Field-specific keys via HKDF
 *
 * @packageDocumentation
 * @module security/encryption/service
 */

import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import type { KeyProvider } from './key-provider.js';
import { getKeyProvider } from './key-provider.js';
import type {
  EncryptedField,
  EncryptedFieldMarker,
  EncryptionConfig,
  EncryptOptions,
  DecryptOptions,
  ReencryptOptions,
  FieldEncryptionPolicy,
  FieldPolicy,
  EncryptionAuditEntry,
  AuditCallback,
  EncryptionAlgorithm,
  DataClassification,
} from './types.js';
import {
  DEFAULT_ENCRYPTION_CONFIG,
  EncryptionAlgorithm as Algorithm,
  DataClassification as Classification,
  EncryptionOperation,
  CLASSIFICATION_LEVELS,
  isEncryptedFieldMarker,
  EncryptionErrorCode,
} from './types.js';

const logger = createLogger({ component: 'field-encryption-service' });

// =============================================================================
// Encryption Error
// =============================================================================

/**
 * Custom error class for encryption operations
 */
export class FieldEncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FieldEncryptionError';
  }
}

// =============================================================================
// Algorithm Helpers
// =============================================================================

/**
 * Get Node.js cipher algorithm name
 */
function getCipherAlgorithm(algorithm: EncryptionAlgorithm): string {
  switch (algorithm) {
    case Algorithm.AES_256_GCM:
      return 'aes-256-gcm';
    case Algorithm.AES_256_CBC:
      return 'aes-256-cbc';
    case Algorithm.CHACHA20_POLY1305:
      return 'chacha20-poly1305';
    default:
      throw new FieldEncryptionError(
        `Unsupported algorithm: ${algorithm}`,
        EncryptionErrorCode.INVALID_ALGORITHM
      );
  }
}

/**
 * Check if algorithm supports AEAD (authenticated encryption)
 */
function isAEAD(algorithm: EncryptionAlgorithm): boolean {
  return algorithm === Algorithm.AES_256_GCM || algorithm === Algorithm.CHACHA20_POLY1305;
}

/**
 * Get IV length for algorithm
 */
function getIVLength(algorithm: EncryptionAlgorithm): number {
  switch (algorithm) {
    case Algorithm.AES_256_GCM:
      return 12; // GCM recommends 12 bytes
    case Algorithm.AES_256_CBC:
      return 16;
    case Algorithm.CHACHA20_POLY1305:
      return 12;
    default:
      return 16;
  }
}

// =============================================================================
// Field Encryption Service
// =============================================================================

/**
 * Field-level encryption service
 *
 * Provides methods for encrypting and decrypting individual fields
 * with support for key versioning, AAD binding, and audit logging.
 *
 * @example
 * ```typescript
 * const service = createFieldEncryptionService();
 * await service.initialize();
 *
 * // Encrypt a sensitive field
 * const encrypted = await service.encrypt('123-45-6789', {
 *   fieldName: 'ssn',
 *   classification: DataClassification.RESTRICTED,
 * });
 *
 * // Decrypt the field
 * const plaintext = await service.decrypt(encrypted, {
 *   fieldName: 'ssn',
 * });
 * ```
 */
export class FieldEncryptionService {
  private readonly config: EncryptionConfig;
  private readonly keyProvider: KeyProvider;
  private readonly auditCallbacks: AuditCallback[] = [];
  private initialized = false;

  constructor(
    config: Partial<EncryptionConfig> = {},
    keyProvider?: KeyProvider
  ) {
    this.config = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
    this.keyProvider = keyProvider ?? getKeyProvider();
  }

  /**
   * Initialize the encryption service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('FieldEncryptionService already initialized');
      return;
    }

    logger.info('Initializing FieldEncryptionService');

    // Initialize key provider
    await this.keyProvider.initialize();

    this.initialized = true;
    logger.info('FieldEncryptionService initialized');
  }

  /**
   * Ensure the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new FieldEncryptionError(
        'FieldEncryptionService not initialized. Call initialize() first.',
        EncryptionErrorCode.KEY_PROVIDER_NOT_INITIALIZED
      );
    }
  }

  /**
   * Register an audit callback
   */
  onAudit(callback: AuditCallback): void {
    this.auditCallbacks.push(callback);
  }

  /**
   * Emit audit event
   */
  private async emitAudit(entry: EncryptionAuditEntry): Promise<void> {
    if (!this.config.auditLogging) return;

    for (const callback of this.auditCallbacks) {
      try {
        await callback(entry);
      } catch (error) {
        logger.error({ error, entryId: entry.id }, 'Audit callback failed');
      }
    }
  }

  /**
   * Check if encryption is required for the given classification
   */
  private requiresEncryption(classification?: DataClassification): boolean {
    if (!classification) return true; // Encrypt by default
    if (!this.config.enabled) return false;

    const classificationLevel = CLASSIFICATION_LEVELS[classification];
    const minimumLevel = CLASSIFICATION_LEVELS[this.config.minimumEncryptionLevel];

    return classificationLevel >= minimumLevel;
  }

  /**
   * Build Additional Authenticated Data (AAD)
   */
  private buildAAD(fieldName?: string, additionalData?: string): Buffer {
    const parts: string[] = [];

    if (this.config.includeFieldNameInAAD && fieldName) {
      parts.push(`field:${fieldName}`);
    }

    if (additionalData) {
      parts.push(`extra:${additionalData}`);
    }

    return Buffer.from(parts.join('|'), 'utf-8');
  }

  /**
   * Encrypt a plaintext value
   *
   * @param plaintext - The value to encrypt
   * @param options - Encryption options
   * @returns Encrypted field marker ready for storage
   */
  async encrypt(
    plaintext: string,
    options: EncryptOptions = {}
  ): Promise<EncryptedFieldMarker> {
    this.ensureInitialized();
    const startTime = performance.now();

    const {
      fieldName,
      classification,
      algorithm = this.config.defaultAlgorithm,
      keyVersion,
      deterministic = false,
      additionalData,
      tenantId,
    } = options;

    // Check if encryption is required
    if (!this.requiresEncryption(classification)) {
      // Return unencrypted marker for tracking
      const encryptedField: EncryptedField = {
        ciphertext: Buffer.from(plaintext, 'utf-8').toString('base64'),
        iv: '',
        authTag: '',
        algorithm,
        keyVersion: 0,
        fieldName,
        encryptedAt: this.config.includeTimestamp ? new Date().toISOString() : undefined,
        deterministic: false,
      };

      return {
        __encrypted: true,
        __version: 2,
        field: encryptedField,
      };
    }

    try {
      // Get key version
      const version = keyVersion ?? await this.keyProvider.getCurrentVersion();

      // Derive field-specific key
      const key = deterministic
        ? await this.keyProvider.deriveDeterministicKey(version, fieldName ?? 'default', tenantId)
        : await this.keyProvider.deriveFieldKey(version, fieldName ?? 'default', tenantId);

      // Generate IV
      const ivLength = getIVLength(algorithm);
      let iv: Buffer;

      if (deterministic) {
        // For deterministic encryption, derive IV from plaintext
        // This allows same plaintext to produce same ciphertext for searching
        const ivHash = crypto.createHmac('sha256', key)
          .update(plaintext)
          .digest();
        iv = ivHash.subarray(0, ivLength);
      } else {
        // Random IV for non-deterministic encryption
        iv = crypto.randomBytes(ivLength);
      }

      // Build AAD
      const aad = this.buildAAD(fieldName, additionalData);

      // Get cipher algorithm
      const cipherAlgorithm = getCipherAlgorithm(algorithm);

      // Encrypt
      let ciphertext: Buffer;
      let authTag: Buffer;

      if (isAEAD(algorithm)) {
        // Use explicit type for GCM cipher
        const cipherOptions: crypto.CipherGCMOptions = {
          authTagLength: this.config.authTagLength,
        };
        const cipher = crypto.createCipheriv(
          cipherAlgorithm as crypto.CipherGCMTypes,
          key,
          iv,
          cipherOptions
        );

        cipher.setAAD(aad);

        ciphertext = Buffer.concat([
          cipher.update(plaintext, 'utf-8'),
          cipher.final(),
        ]);

        authTag = cipher.getAuthTag();
      } else {
        // CBC mode - compute HMAC separately
        const cipher = crypto.createCipheriv(cipherAlgorithm, key, iv);
        ciphertext = Buffer.concat([
          cipher.update(plaintext, 'utf-8'),
          cipher.final(),
        ]);

        // HMAC for authentication
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(iv);
        hmac.update(ciphertext);
        hmac.update(aad);
        authTag = hmac.digest();
      }

      // Clear sensitive key material
      key.fill(0);

      const encryptedField: EncryptedField = {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        algorithm,
        keyVersion: version,
        fieldName,
        encryptedAt: this.config.includeTimestamp ? new Date().toISOString() : undefined,
        deterministic,
      };

      const durationMs = performance.now() - startTime;

      // Emit audit event
      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.ENCRYPT,
        fieldName,
        keyVersion: version,
        algorithm,
        success: true,
        durationMs,
        tenantId,
      });

      return {
        __encrypted: true,
        __version: 2,
        field: encryptedField,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Emit failed audit event
      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.ENCRYPT,
        fieldName,
        keyVersion: keyVersion ?? 0,
        algorithm,
        success: false,
        error: errorMessage,
        durationMs,
        tenantId,
      });

      throw new FieldEncryptionError(
        `Encryption failed: ${errorMessage}`,
        EncryptionErrorCode.ENCRYPTION_FAILED,
        { fieldName, algorithm }
      );
    }
  }

  /**
   * Decrypt an encrypted field
   *
   * @param encryptedMarker - The encrypted field marker
   * @param options - Decryption options
   * @returns Decrypted plaintext
   */
  async decrypt(
    encryptedMarker: EncryptedFieldMarker,
    options: DecryptOptions = {}
  ): Promise<string> {
    this.ensureInitialized();
    const startTime = performance.now();

    if (!isEncryptedFieldMarker(encryptedMarker)) {
      throw new FieldEncryptionError(
        'Invalid encrypted field format',
        EncryptionErrorCode.INVALID_FORMAT
      );
    }

    const { field } = encryptedMarker;
    const { fieldName, additionalData, tenantId } = options;

    // Check for unencrypted marker (keyVersion 0)
    if (field.keyVersion === 0) {
      return Buffer.from(field.ciphertext, 'base64').toString('utf-8');
    }

    // Verify field name if AAD binding is enabled
    if (this.config.includeFieldNameInAAD && fieldName && field.fieldName) {
      if (fieldName !== field.fieldName) {
        throw new FieldEncryptionError(
          `Field name mismatch: expected ${fieldName}, got ${field.fieldName}`,
          EncryptionErrorCode.FIELD_NAME_MISMATCH,
          { expected: fieldName, actual: field.fieldName }
        );
      }
    }

    try {
      // Derive field-specific key
      const effectiveFieldName = fieldName ?? field.fieldName ?? 'default';
      const key = field.deterministic
        ? await this.keyProvider.deriveDeterministicKey(field.keyVersion, effectiveFieldName, tenantId)
        : await this.keyProvider.deriveFieldKey(field.keyVersion, effectiveFieldName, tenantId);

      // Decode encrypted components
      const ciphertext = Buffer.from(field.ciphertext, 'base64');
      const iv = Buffer.from(field.iv, 'base64');
      const authTag = Buffer.from(field.authTag, 'base64');

      // Build AAD
      const aad = this.buildAAD(effectiveFieldName, additionalData);

      // Get cipher algorithm
      const cipherAlgorithm = getCipherAlgorithm(field.algorithm);

      // Decrypt
      let plaintext: string;

      if (isAEAD(field.algorithm)) {
        // Use explicit type for GCM decipher
        const decipherOptions: crypto.CipherGCMOptions = {
          authTagLength: this.config.authTagLength,
        };
        const decipher = crypto.createDecipheriv(
          cipherAlgorithm as crypto.CipherGCMTypes,
          key,
          iv,
          decipherOptions
        );

        decipher.setAAD(aad);
        decipher.setAuthTag(authTag);

        plaintext = decipher.update(ciphertext).toString('utf-8') + decipher.final('utf-8');
      } else {
        // CBC mode - verify HMAC first
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(iv);
        hmac.update(ciphertext);
        hmac.update(aad);
        const expectedTag = hmac.digest();

        if (!crypto.timingSafeEqual(authTag, expectedTag)) {
          throw new FieldEncryptionError(
            'Authentication tag verification failed',
            EncryptionErrorCode.AUTH_TAG_MISMATCH
          );
        }

        const decipher = crypto.createDecipheriv(cipherAlgorithm, key, iv);
        plaintext = decipher.update(ciphertext).toString('utf-8') + decipher.final('utf-8');
      }

      // Clear sensitive key material
      key.fill(0);

      const durationMs = performance.now() - startTime;

      // Emit audit event
      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.DECRYPT,
        fieldName: effectiveFieldName,
        keyVersion: field.keyVersion,
        algorithm: field.algorithm,
        success: true,
        durationMs,
        tenantId,
      });

      return plaintext;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Emit failed audit event
      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.DECRYPT,
        fieldName: fieldName ?? field.fieldName,
        keyVersion: field.keyVersion,
        algorithm: field.algorithm,
        success: false,
        error: errorMessage,
        durationMs,
        tenantId,
      });

      if (error instanceof FieldEncryptionError) {
        throw error;
      }

      throw new FieldEncryptionError(
        `Decryption failed: ${errorMessage}`,
        EncryptionErrorCode.DECRYPTION_FAILED,
        { fieldName: field.fieldName, algorithm: field.algorithm }
      );
    }
  }

  /**
   * Encrypt multiple fields in an object according to a policy
   *
   * @param obj - The object containing fields to encrypt
   * @param policy - The encryption policy defining which fields to encrypt
   * @param tenantId - Optional tenant ID for multi-tenant isolation
   * @returns Object with encrypted fields
   */
  async encryptObject<T extends Record<string, unknown>>(
    obj: T,
    policy: FieldEncryptionPolicy,
    tenantId?: string
  ): Promise<T> {
    this.ensureInitialized();

    const result = { ...obj };

    for (const fieldPolicy of policy.fields) {
      if (!fieldPolicy.encrypted) continue;

      const value = this.getNestedValue(obj, fieldPolicy.fieldName);
      if (value === undefined || value === null) continue;

      const encrypted = await this.encrypt(String(value), {
        fieldName: fieldPolicy.fieldName,
        classification: fieldPolicy.classification,
        algorithm: fieldPolicy.algorithm,
        deterministic: fieldPolicy.deterministic,
        tenantId,
      });

      this.setNestedValue(result, fieldPolicy.fieldName, encrypted);
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object according to a policy
   *
   * @param obj - The object containing encrypted fields
   * @param policy - The encryption policy defining which fields to decrypt
   * @param tenantId - Optional tenant ID for multi-tenant isolation
   * @returns Object with decrypted fields
   */
  async decryptObject<T extends Record<string, unknown>>(
    obj: T,
    policy: FieldEncryptionPolicy,
    tenantId?: string
  ): Promise<T> {
    this.ensureInitialized();

    const result = { ...obj };

    for (const fieldPolicy of policy.fields) {
      if (!fieldPolicy.encrypted) continue;

      const value = this.getNestedValue(obj, fieldPolicy.fieldName);
      if (!isEncryptedFieldMarker(value)) continue;

      const decrypted = await this.decrypt(value, {
        fieldName: fieldPolicy.fieldName,
        tenantId,
      });

      this.setNestedValue(result, fieldPolicy.fieldName, decrypted);
    }

    return result;
  }

  /**
   * Re-encrypt a field with a new key version
   *
   * @param encryptedMarker - The currently encrypted field
   * @param options - Re-encryption options including new key version
   * @returns Newly encrypted field marker
   */
  async reencrypt(
    encryptedMarker: EncryptedFieldMarker,
    options: ReencryptOptions
  ): Promise<EncryptedFieldMarker> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      // First decrypt with current key
      const plaintext = await this.decrypt(encryptedMarker, {
        fieldName: options.fieldName ?? encryptedMarker.field.fieldName,
        tenantId: options.tenantId,
      });

      // Re-encrypt with new key version
      const result = await this.encrypt(plaintext, {
        fieldName: options.fieldName ?? encryptedMarker.field.fieldName,
        algorithm: options.newAlgorithm ?? encryptedMarker.field.algorithm,
        keyVersion: options.newKeyVersion,
        deterministic: encryptedMarker.field.deterministic,
        tenantId: options.tenantId,
      });

      const durationMs = performance.now() - startTime;

      // Emit audit event
      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.REENCRYPT,
        fieldName: options.fieldName ?? encryptedMarker.field.fieldName,
        keyVersion: options.newKeyVersion,
        algorithm: options.newAlgorithm ?? encryptedMarker.field.algorithm,
        success: true,
        durationMs,
        tenantId: options.tenantId,
      });

      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitAudit({
        id: randomUUID(),
        timestamp: new Date(),
        operation: EncryptionOperation.REENCRYPT,
        fieldName: options.fieldName,
        keyVersion: options.newKeyVersion,
        algorithm: options.newAlgorithm ?? encryptedMarker.field.algorithm,
        success: false,
        error: errorMessage,
        durationMs,
        tenantId: options.tenantId,
      });

      throw new FieldEncryptionError(
        `Re-encryption failed: ${errorMessage}`,
        EncryptionErrorCode.REENCRYPT_FAILED,
        { fieldName: options.fieldName }
      );
    }
  }

  /**
   * Get the current key version
   */
  async getCurrentKeyVersion(): Promise<number> {
    this.ensureInitialized();
    return this.keyProvider.getCurrentVersion();
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set nested value in object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down FieldEncryptionService');
    await this.keyProvider.shutdown();
    this.initialized = false;
    logger.info('FieldEncryptionService shutdown complete');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new FieldEncryptionService instance
 */
export function createFieldEncryptionService(
  config?: Partial<EncryptionConfig>,
  keyProvider?: KeyProvider
): FieldEncryptionService {
  return new FieldEncryptionService(config, keyProvider);
}

// =============================================================================
// Singleton Management
// =============================================================================

let defaultService: FieldEncryptionService | null = null;

/**
 * Get the default field encryption service instance
 */
export function getFieldEncryptionService(): FieldEncryptionService {
  if (!defaultService) {
    defaultService = createFieldEncryptionService();
  }
  return defaultService;
}

/**
 * Set a custom field encryption service as the default
 */
export function setFieldEncryptionService(service: FieldEncryptionService): void {
  defaultService = service;
}

/**
 * Reset the default field encryption service (for testing)
 */
export async function resetFieldEncryptionService(): Promise<void> {
  if (defaultService) {
    await defaultService.shutdown();
    defaultService = null;
  }
}
