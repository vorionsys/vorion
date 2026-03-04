/**
 * Field-Level Encryption Types
 *
 * Type definitions for transparent field-level encryption of sensitive data.
 * Provides interfaces for encrypting individual fields stored in the database
 * with support for:
 * - Multiple encryption algorithms (AES-256-GCM, AES-256-CBC, ChaCha20-Poly1305)
 * - Key versioning for rotation support
 * - Data classification levels
 * - Field-specific encryption policies
 * - Deterministic encryption for searchable fields
 *
 * @packageDocumentation
 * @module security/encryption/types
 */

import { z } from 'zod';

// =============================================================================
// Encryption Algorithm Types
// =============================================================================

/**
 * Supported encryption algorithms for field-level encryption
 *
 * - AES_256_GCM: Authenticated encryption with associated data (AEAD), recommended default
 * - AES_256_CBC: Block cipher mode, requires separate HMAC for authentication
 * - CHACHA20_POLY1305: Modern stream cipher with authentication, good performance
 */
export const EncryptionAlgorithm = {
  /** AES-256-GCM - Recommended default with built-in authentication */
  AES_256_GCM: 'aes-256-gcm',
  /** AES-256-CBC - Legacy mode, requires separate HMAC */
  AES_256_CBC: 'aes-256-cbc',
  /** ChaCha20-Poly1305 - Modern authenticated encryption */
  CHACHA20_POLY1305: 'chacha20-poly1305',
} as const;

export type EncryptionAlgorithm = (typeof EncryptionAlgorithm)[keyof typeof EncryptionAlgorithm];

export const encryptionAlgorithmSchema = z.nativeEnum(EncryptionAlgorithm);

// =============================================================================
// Data Classification Types
// =============================================================================

/**
 * Data classification levels for determining encryption requirements
 *
 * Classification hierarchy (lowest to highest sensitivity):
 * - PUBLIC: No encryption required, publicly available data
 * - INTERNAL: Internal use only, encryption optional
 * - CONFIDENTIAL: Business-sensitive data, encryption required
 * - RESTRICTED: Highly sensitive data (PII, PHI, PCI), strongest encryption
 */
export const DataClassification = {
  /** Public data - no encryption required */
  PUBLIC: 'public',
  /** Internal data - encryption optional */
  INTERNAL: 'internal',
  /** Confidential business data - encryption required */
  CONFIDENTIAL: 'confidential',
  /** Restricted/regulated data (PII, PHI, PCI) - strongest encryption */
  RESTRICTED: 'restricted',
} as const;

export type DataClassification = (typeof DataClassification)[keyof typeof DataClassification];

export const dataClassificationSchema = z.nativeEnum(DataClassification);

/**
 * Classification level ordering for comparison
 */
export const CLASSIFICATION_LEVELS: Record<DataClassification, number> = {
  [DataClassification.PUBLIC]: 0,
  [DataClassification.INTERNAL]: 1,
  [DataClassification.CONFIDENTIAL]: 2,
  [DataClassification.RESTRICTED]: 3,
};

// =============================================================================
// Encrypted Field Types
// =============================================================================

/**
 * Encrypted field structure containing all components needed for decryption
 *
 * This structure is stored in the database in place of the plaintext value.
 * It contains all cryptographic material needed to decrypt the field,
 * except for the actual encryption key which is managed separately.
 */
export interface EncryptedField {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector (unique per encryption) */
  iv: string;
  /** Base64-encoded authentication tag (for AEAD algorithms) */
  authTag: string;
  /** Algorithm used for encryption */
  algorithm: EncryptionAlgorithm;
  /** Version of the key used for encryption (for rotation support) */
  keyVersion: number;
  /** Optional field name for AAD binding verification */
  fieldName?: string;
  /** Optional timestamp of when the field was encrypted */
  encryptedAt?: string;
  /** Whether this is deterministic encryption (for searchable fields) */
  deterministic?: boolean;
}

export const encryptedFieldSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  algorithm: encryptionAlgorithmSchema,
  keyVersion: z.number().int().positive(),
  fieldName: z.string().optional(),
  encryptedAt: z.string().datetime().optional(),
  deterministic: z.boolean().optional(),
});

/**
 * Marker interface to identify encrypted fields in JSON
 */
export interface EncryptedFieldMarker {
  __encrypted: true;
  __version: 2;
  field: EncryptedField;
}

export const encryptedFieldMarkerSchema = z.object({
  __encrypted: z.literal(true),
  __version: z.literal(2),
  field: encryptedFieldSchema,
});

/**
 * Check if a value is an encrypted field marker
 */
export function isEncryptedFieldMarker(value: unknown): value is EncryptedFieldMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__encrypted' in value &&
    (value as EncryptedFieldMarker).__encrypted === true &&
    '__version' in value &&
    (value as EncryptedFieldMarker).__version === 2 &&
    'field' in value
  );
}

// =============================================================================
// Key Version Types
// =============================================================================

/**
 * Key version metadata
 */
export interface KeyVersion {
  /** Version number (monotonically increasing) */
  version: number;
  /** When this key version was created */
  createdAt: Date;
  /** When this key version was activated for encryption */
  activatedAt?: Date;
  /** When this key version was deprecated (no longer used for new encryption) */
  deprecatedAt?: Date;
  /** When this key version expires (can no longer be used for decryption) */
  expiresAt?: Date;
  /** Status of this key version */
  status: 'pending' | 'active' | 'deprecated' | 'expired';
}

export const keyVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
  activatedAt: z.coerce.date().optional(),
  deprecatedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  status: z.enum(['pending', 'active', 'deprecated', 'expired']),
});

// =============================================================================
// Encryption Configuration Types
// =============================================================================

/**
 * Configuration for the encryption service
 */
export interface EncryptionConfig {
  /** Default algorithm to use for encryption */
  defaultAlgorithm: EncryptionAlgorithm;
  /** Whether to enable encryption (can be disabled for testing) */
  enabled: boolean;
  /** Key derivation info string prefix */
  keyDerivationInfo: string;
  /** HKDF hash algorithm */
  hkdfHash: 'sha256' | 'sha384' | 'sha512';
  /** Length of derived keys in bytes */
  keyLength: number;
  /** IV length in bytes */
  ivLength: number;
  /** Auth tag length in bytes (for AEAD algorithms) */
  authTagLength: number;
  /** Whether to include field name in AAD */
  includeFieldNameInAAD: boolean;
  /** Whether to include timestamp in encrypted field */
  includeTimestamp: boolean;
  /** Redis key prefix for key storage */
  redisKeyPrefix?: string;
  /** Enable audit logging for encryption operations */
  auditLogging: boolean;
  /** Minimum classification level that requires encryption */
  minimumEncryptionLevel: DataClassification;
}

export const encryptionConfigSchema = z.object({
  defaultAlgorithm: encryptionAlgorithmSchema.default(EncryptionAlgorithm.AES_256_GCM),
  enabled: z.boolean().default(true),
  keyDerivationInfo: z.string().default('vorion-field-encryption-v1'),
  hkdfHash: z.enum(['sha256', 'sha384', 'sha512']).default('sha256'),
  keyLength: z.number().int().positive().default(32),
  ivLength: z.number().int().positive().default(16),
  authTagLength: z.number().int().positive().default(16),
  includeFieldNameInAAD: z.boolean().default(true),
  includeTimestamp: z.boolean().default(true),
  redisKeyPrefix: z.string().default('vorion:encryption:'),
  auditLogging: z.boolean().default(true),
  minimumEncryptionLevel: dataClassificationSchema.default(DataClassification.CONFIDENTIAL),
});

/**
 * Default encryption configuration
 */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  defaultAlgorithm: EncryptionAlgorithm.AES_256_GCM,
  enabled: true,
  keyDerivationInfo: 'vorion-field-encryption-v1',
  hkdfHash: 'sha256',
  keyLength: 32,
  ivLength: 16,
  authTagLength: 16,
  includeFieldNameInAAD: true,
  includeTimestamp: true,
  redisKeyPrefix: 'vorion:encryption:',
  auditLogging: true,
  minimumEncryptionLevel: DataClassification.CONFIDENTIAL,
};

// =============================================================================
// Field Encryption Policy Types
// =============================================================================

/**
 * Policy for a single field
 */
export interface FieldPolicy {
  /** Field name or path (supports dot notation for nested fields) */
  fieldName: string;
  /** Data classification for this field */
  classification: DataClassification;
  /** Whether encryption is required for this field */
  encrypted: boolean;
  /** Algorithm to use (overrides default) */
  algorithm?: EncryptionAlgorithm;
  /** Whether to use deterministic encryption (for searchable fields) */
  deterministic?: boolean;
  /** Custom key derivation info suffix */
  keyDerivationSuffix?: string;
}

export const fieldPolicySchema = z.object({
  fieldName: z.string().min(1),
  classification: dataClassificationSchema,
  encrypted: z.boolean(),
  algorithm: encryptionAlgorithmSchema.optional(),
  deterministic: z.boolean().optional(),
  keyDerivationSuffix: z.string().optional(),
});

/**
 * Encryption policy for a table or entity
 */
export interface FieldEncryptionPolicy {
  /** Name of the table or entity */
  entityName: string;
  /** Description of the policy */
  description?: string;
  /** Field-specific policies */
  fields: FieldPolicy[];
  /** Default classification for unlisted fields */
  defaultClassification?: DataClassification;
  /** Whether to fail on unlisted fields */
  strictMode?: boolean;
}

export const fieldEncryptionPolicySchema = z.object({
  entityName: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(fieldPolicySchema),
  defaultClassification: dataClassificationSchema.optional(),
  strictMode: z.boolean().optional(),
});

// =============================================================================
// Encryption Operation Types
// =============================================================================

/**
 * Options for encryption operation
 */
export interface EncryptOptions {
  /** Field name for AAD binding */
  fieldName?: string;
  /** Data classification (determines if encryption is needed) */
  classification?: DataClassification;
  /** Algorithm to use (overrides default) */
  algorithm?: EncryptionAlgorithm;
  /** Key version to use (defaults to current active version) */
  keyVersion?: number;
  /** Use deterministic encryption (for searchable fields) */
  deterministic?: boolean;
  /** Additional authenticated data */
  additionalData?: string;
  /** Tenant ID for multi-tenant key derivation */
  tenantId?: string;
}

export const encryptOptionsSchema = z.object({
  fieldName: z.string().optional(),
  classification: dataClassificationSchema.optional(),
  algorithm: encryptionAlgorithmSchema.optional(),
  keyVersion: z.number().int().positive().optional(),
  deterministic: z.boolean().optional(),
  additionalData: z.string().optional(),
  tenantId: z.string().optional(),
});

/**
 * Options for decryption operation
 */
export interface DecryptOptions {
  /** Field name for AAD verification */
  fieldName?: string;
  /** Additional authenticated data for verification */
  additionalData?: string;
  /** Tenant ID for multi-tenant key derivation */
  tenantId?: string;
}

export const decryptOptionsSchema = z.object({
  fieldName: z.string().optional(),
  additionalData: z.string().optional(),
  tenantId: z.string().optional(),
});

/**
 * Options for re-encryption operation
 */
export interface ReencryptOptions {
  /** New key version to encrypt with */
  newKeyVersion: number;
  /** New algorithm to use (optional) */
  newAlgorithm?: EncryptionAlgorithm;
  /** Field name for AAD binding */
  fieldName?: string;
  /** Tenant ID for multi-tenant key derivation */
  tenantId?: string;
}

export const reencryptOptionsSchema = z.object({
  newKeyVersion: z.number().int().positive(),
  newAlgorithm: encryptionAlgorithmSchema.optional(),
  fieldName: z.string().optional(),
  tenantId: z.string().optional(),
});

// =============================================================================
// Audit Types
// =============================================================================

/**
 * Encryption operation types for audit logging
 */
export const EncryptionOperation = {
  ENCRYPT: 'encrypt',
  DECRYPT: 'decrypt',
  REENCRYPT: 'reencrypt',
  KEY_ROTATE: 'key_rotate',
  KEY_DERIVE: 'key_derive',
} as const;

export type EncryptionOperation = (typeof EncryptionOperation)[keyof typeof EncryptionOperation];

/**
 * Audit log entry for encryption operations
 */
export interface EncryptionAuditEntry {
  /** Unique audit entry ID */
  id: string;
  /** Timestamp of the operation */
  timestamp: Date;
  /** Type of operation */
  operation: EncryptionOperation;
  /** Field name if applicable */
  fieldName?: string;
  /** Entity/table name if applicable */
  entityName?: string;
  /** Key version used */
  keyVersion: number;
  /** Algorithm used */
  algorithm: EncryptionAlgorithm;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** User ID if available */
  userId?: string;
  /** Tenant ID if available */
  tenantId?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export const encryptionAuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  operation: z.nativeEnum(EncryptionOperation),
  fieldName: z.string().optional(),
  entityName: z.string().optional(),
  keyVersion: z.number().int().positive(),
  algorithm: encryptionAlgorithmSchema,
  success: z.boolean(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  requestId: z.string().optional(),
});

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Callback for audit logging
 */
export type AuditCallback = (entry: EncryptionAuditEntry) => void | Promise<void>;

/**
 * Callback for key rotation events
 */
export type KeyRotationCallback = (
  oldVersion: number,
  newVersion: number,
  fieldCount: number
) => void | Promise<void>;

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for encryption operations
 */
export const EncryptionErrorCode = {
  /** Invalid algorithm specified */
  INVALID_ALGORITHM: 'INVALID_ALGORITHM',
  /** Key version not found */
  KEY_VERSION_NOT_FOUND: 'KEY_VERSION_NOT_FOUND',
  /** Key derivation failed */
  KEY_DERIVATION_FAILED: 'KEY_DERIVATION_FAILED',
  /** Encryption failed */
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  /** Decryption failed */
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  /** Authentication tag verification failed */
  AUTH_TAG_MISMATCH: 'AUTH_TAG_MISMATCH',
  /** Field name mismatch in AAD */
  FIELD_NAME_MISMATCH: 'FIELD_NAME_MISMATCH',
  /** Invalid encrypted field format */
  INVALID_FORMAT: 'INVALID_FORMAT',
  /** Key provider not initialized */
  KEY_PROVIDER_NOT_INITIALIZED: 'KEY_PROVIDER_NOT_INITIALIZED',
  /** Re-encryption failed */
  REENCRYPT_FAILED: 'REENCRYPT_FAILED',
  /** Policy violation */
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  /** Configuration error */
  CONFIG_ERROR: 'CONFIG_ERROR',
} as const;

export type EncryptionErrorCode = (typeof EncryptionErrorCode)[keyof typeof EncryptionErrorCode];
