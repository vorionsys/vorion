/**
 * Field-Level Encryption Module
 *
 * Provides transparent encryption for sensitive data fields stored in the database.
 * This module implements secure field-level encryption with the following features:
 *
 * - **Multiple Algorithms**: AES-256-GCM (default), AES-256-CBC, ChaCha20-Poly1305
 * - **Key Management**: Version-based key rotation with HKDF field-specific derivation
 * - **Data Classification**: PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED levels
 * - **Decorator Support**: @Encrypted() and @SearchableEncrypted() for marking fields
 * - **Database Middleware**: Transparent encryption/decryption with Drizzle ORM hooks
 * - **Security Controls**: AAD binding, unique IVs, audit logging
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   FieldEncryptionService,
 *   Encrypted,
 *   SearchableEncrypted,
 *   DataClassification,
 *   createEncryptionMiddleware,
 * } from './security/encryption';
 *
 * // 1. Define entity with encrypted fields
 * class User {
 *   @Encrypted(DataClassification.RESTRICTED)
 *   ssn: string;
 *
 *   @SearchableEncrypted()
 *   email: string;
 * }
 *
 * // 2. Initialize service
 * const service = getFieldEncryptionService();
 * await service.initialize();
 *
 * // 3. Encrypt/decrypt fields
 * const encrypted = await service.encrypt('123-45-6789', {
 *   fieldName: 'ssn',
 *   classification: DataClassification.RESTRICTED,
 * });
 *
 * const plaintext = await service.decrypt(encrypted, { fieldName: 'ssn' });
 * ```
 *
 * ## Database Integration
 *
 * ```typescript
 * import { createMiddlewareFromClasses } from './security/encryption';
 *
 * const middleware = createMiddlewareFromClasses({
 *   users: User,
 *   patients: Patient,
 * });
 *
 * await middleware.initialize();
 *
 * // Use with database operations
 * const result = await middleware.beforeInsert(userData, {
 *   tableName: 'users',
 *   operation: 'insert',
 * });
 * ```
 *
 * ## Security Considerations
 *
 * - Master keys must be stored securely (environment variables, secrets manager)
 * - Key rotation is supported via versioning
 * - AAD binding prevents field swapping attacks
 * - Deterministic encryption is less secure but enables searching
 * - All operations are audit logged when enabled
 *
 * @packageDocumentation
 * @module security/encryption
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Enums
  EncryptionAlgorithm,
  DataClassification,
  EncryptionOperation,
  EncryptionErrorCode,
  CLASSIFICATION_LEVELS,

  // Encrypted Field Types
  type EncryptedField,
  type EncryptedFieldMarker,
  isEncryptedFieldMarker,
  encryptedFieldSchema,
  encryptedFieldMarkerSchema,

  // Key Version Types
  type KeyVersion,
  keyVersionSchema,

  // Configuration Types
  type EncryptionConfig,
  encryptionConfigSchema,
  DEFAULT_ENCRYPTION_CONFIG,

  // Policy Types
  type FieldPolicy,
  type FieldEncryptionPolicy,
  fieldPolicySchema,
  fieldEncryptionPolicySchema,

  // Operation Types
  type EncryptOptions,
  type DecryptOptions,
  type ReencryptOptions,
  encryptOptionsSchema,
  decryptOptionsSchema,
  reencryptOptionsSchema,

  // Audit Types
  type EncryptionAuditEntry,
  type AuditCallback,
  type KeyRotationCallback,
  encryptionAuditEntrySchema,

  // Zod Schemas
  encryptionAlgorithmSchema,
  dataClassificationSchema,
} from './types.js';

// =============================================================================
// Key Provider
// =============================================================================

export {
  // Interface
  type KeyProvider,

  // Environment-based Implementation
  EnvKeyProvider,
  createEnvKeyProvider,

  // KMS-based Implementation (Envelope Encryption)
  KMSKeyProvider,
  createKMSKeyProvider,
  type KMSKeyProviderConfig,

  // Singleton
  getKeyProvider,
  getInitializedKeyProvider,
  setKeyProvider,
  resetKeyProvider,
  createKeyProvider,
} from './key-provider.js';

// =============================================================================
// KMS Integration
// =============================================================================

// Re-export KMS module for convenient access
export {
  // Types
  type KMSProvider,
  type KMSConfig,
  type AWSKMSConfig,
  type VaultKMSConfig,
  type LocalKMSConfig,
  type KeyMetadata as KMSKeyMetadata,
  type DataKey,
  KMSProviderType,
  KMSErrorCode,
  KMSOperation,

  // Providers
  AWSKMSProvider,
  HashiCorpVaultProvider,
  LocalKMSProvider,

  // Factory
  createKMSProvider,
  createKMSProviderFromEnv,

  // Singleton
  getKMSProvider,
  getInitializedKMSProvider,
  setKMSProvider,
  resetKMSProvider,

  // Health
  checkKMSHealth,
  type KMSHealthStatus,

  // Utilities
  isKMSConfigured,
  detectKMSProviderType,
} from '../kms/index.js';

// =============================================================================
// Encryption Service
// =============================================================================

export {
  // Error
  FieldEncryptionError,

  // Service
  FieldEncryptionService,
  createFieldEncryptionService,

  // Singleton
  getFieldEncryptionService,
  setFieldEncryptionService,
  resetFieldEncryptionService,
} from './service.js';

// =============================================================================
// Decorators
// =============================================================================

export {
  // Decorators
  Encrypted,
  SearchableEncrypted,
  NotEncrypted,

  // Metadata Access
  getEncryptedFields,
  hasEncryptedFields,
  getFieldMetadata,
  isFieldEncrypted,
  isFieldSearchable,

  // Policy Generation
  generatePolicy,
  generatePolicies,

  // Types
  type EncryptedFieldMetadata,
  type EncryptedOptions,
  type SearchableEncryptedOptions,
  type EncryptedFieldNames,
  type WithEncryptedFields,
} from './decorators.js';

// =============================================================================
// Middleware
// =============================================================================

export {
  // Middleware
  EncryptionMiddleware,
  createEncryptionMiddleware,
  createMiddlewareFromClasses,

  // Singleton
  getEncryptionMiddleware,
  setEncryptionMiddleware,
  resetEncryptionMiddleware,

  // Policy Builder
  PolicyBuilder,
  policyBuilder,

  // Types
  type TablePolicy,
  type EncryptionMiddlewareConfig,
  type OperationContext,
  type HookResult,
  type DrizzleEncryptionConfig,
} from './middleware.js';
