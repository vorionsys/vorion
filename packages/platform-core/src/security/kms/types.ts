/**
 * Key Management Service (KMS) Types
 *
 * Type definitions for KMS provider implementations supporting:
 * - AWS KMS
 * - HashiCorp Vault
 * - Local development provider
 *
 * Implements envelope encryption pattern where data keys are
 * encrypted by master keys stored in the KMS.
 *
 * @packageDocumentation
 * @module security/kms/types
 */

import { z } from 'zod';

// =============================================================================
// Key Status Types
// =============================================================================

/**
 * Status of a KMS key
 */
export const KeyStatus = {
  /** Key is enabled and can be used for encryption/decryption */
  ENABLED: 'enabled',
  /** Key is disabled and cannot be used */
  DISABLED: 'disabled',
  /** Key is pending deletion */
  PENDING_DELETION: 'pending_deletion',
  /** Key is pending import (for imported keys) */
  PENDING_IMPORT: 'pending_import',
  /** Key is unavailable (service issue) */
  UNAVAILABLE: 'unavailable',
} as const;

export type KeyStatus = (typeof KeyStatus)[keyof typeof KeyStatus];

export const keyStatusSchema = z.nativeEnum(KeyStatus);

// =============================================================================
// Key Metadata Types
// =============================================================================

/**
 * Metadata for a KMS key
 */
export interface KeyMetadata {
  /** Unique key identifier */
  id: string;
  /** ARN or URI for the key (provider-specific) */
  arn: string;
  /** Key version number (for rotation tracking) */
  version: number;
  /** When the key was created */
  createdAt: Date;
  /** When the key was last rotated */
  rotatedAt?: Date;
  /** Current key status */
  status: KeyStatus;
  /** Key description */
  description?: string;
  /** Key alias or name */
  alias?: string;
  /** Key type (e.g., 'symmetric', 'asymmetric') */
  keyType?: string;
  /** Key usage (e.g., 'encrypt_decrypt', 'sign_verify') */
  keyUsage?: string;
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
}

export const keyMetadataSchema = z.object({
  id: z.string().min(1),
  arn: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  rotatedAt: z.coerce.date().optional(),
  status: keyStatusSchema,
  description: z.string().optional(),
  alias: z.string().optional(),
  keyType: z.string().optional(),
  keyUsage: z.string().optional(),
  providerMetadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// Data Key Types (Envelope Encryption)
// =============================================================================

/**
 * Data key for envelope encryption
 *
 * Contains both the plaintext key (for immediate use) and
 * encrypted key (for storage). The plaintext should be cleared
 * from memory after use.
 */
export interface DataKey {
  /** Plaintext data key (clear after use!) */
  plaintext: Buffer;
  /** Encrypted data key (safe to store) */
  ciphertext: Buffer;
  /** Key ID that encrypted this data key */
  keyId: string;
  /** Key version used for encryption */
  keyVersion: number;
  /** Algorithm used for the data key */
  algorithm: string;
  /** When this data key was generated */
  generatedAt: Date;
  /** When this data key expires (for cache TTL) */
  expiresAt?: Date;
}

/**
 * Cached data key with TTL
 */
export interface CachedDataKey {
  /** The data key */
  dataKey: DataKey;
  /** Cache entry creation time */
  cachedAt: Date;
  /** Cache entry expiration time */
  expiresAt: Date;
  /** Number of times this key has been used */
  usageCount: number;
  /** Maximum allowed usages before requiring refresh */
  maxUsages?: number;
}

// =============================================================================
// Encryption/Decryption Types
// =============================================================================

/**
 * Options for encrypt operation
 */
export interface KMSEncryptOptions {
  /** Key ID to use for encryption */
  keyId?: string;
  /** Encryption context (AAD) */
  encryptionContext?: Record<string, string>;
  /** Algorithm to use */
  algorithm?: string;
}

/**
 * Options for decrypt operation
 */
export interface KMSDecryptOptions {
  /** Key ID to use for decryption (may be auto-detected) */
  keyId?: string;
  /** Encryption context (AAD) - must match encryption */
  encryptionContext?: Record<string, string>;
  /** Algorithm to use */
  algorithm?: string;
}

/**
 * Options for data key generation
 */
export interface GenerateDataKeyOptions {
  /** Key ID to use for encrypting the data key */
  keyId?: string;
  /** Length of the data key in bytes */
  keyLength?: number;
  /** Encryption context (AAD) */
  encryptionContext?: Record<string, string>;
}

/**
 * Result of encryption operation
 */
export interface EncryptResult {
  /** Encrypted ciphertext */
  ciphertext: Buffer;
  /** Key ID used for encryption */
  keyId: string;
  /** Key version used */
  keyVersion: number;
  /** Algorithm used */
  algorithm: string;
}

/**
 * Result of decryption operation
 */
export interface DecryptResult {
  /** Decrypted plaintext */
  plaintext: Buffer;
  /** Key ID used for decryption */
  keyId: string;
  /** Key version used */
  keyVersion: number;
}

// =============================================================================
// Key Rotation Types
// =============================================================================

/**
 * Key rotation result
 */
export interface KeyRotationResult {
  /** Key ID that was rotated */
  keyId: string;
  /** Previous key version */
  previousVersion: number;
  /** New key version */
  newVersion: number;
  /** When rotation occurred */
  rotatedAt: Date;
}

/**
 * Key rotation schedule
 */
export interface KeyRotationSchedule {
  /** Whether automatic rotation is enabled */
  enabled: boolean;
  /** Rotation period in days */
  rotationPeriodDays?: number;
  /** Next scheduled rotation */
  nextRotationTime?: Date;
  /** Last rotation time */
  lastRotationTime?: Date;
}

// =============================================================================
// KMS Provider Interface
// =============================================================================

/**
 * Interface for KMS providers
 *
 * Implementations must provide methods for:
 * - Getting key metadata
 * - Encrypting/decrypting data
 * - Generating data keys (envelope encryption)
 * - Key rotation
 * - Listing keys
 *
 * @example
 * ```typescript
 * const provider = new AWSKMSProvider(config);
 * await provider.initialize();
 *
 * // Generate a data key for envelope encryption
 * const dataKey = await provider.generateDataKey({
 *   keyId: 'alias/my-key',
 *   keyLength: 32,
 * });
 *
 * // Use plaintext for encryption, store ciphertext
 * const encrypted = encrypt(data, dataKey.plaintext);
 * store(encrypted, dataKey.ciphertext);
 *
 * // Clear plaintext from memory
 * dataKey.plaintext.fill(0);
 * ```
 */
export interface KMSProvider {
  /** Provider name (e.g., 'aws', 'vault', 'local') */
  readonly name: string;

  /**
   * Initialize the provider
   *
   * Must be called before any other operations.
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the provider and cleanup resources
   */
  shutdown(): Promise<void>;

  /**
   * Check if the provider is healthy and connected
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get metadata for a specific key
   *
   * @param keyId - Key ID or alias
   * @returns Key metadata or null if not found
   */
  getKey(keyId: string): Promise<KeyMetadata | null>;

  /**
   * List all available keys
   *
   * @param options - List options
   * @returns Array of key metadata
   */
  listKeys(options?: ListKeysOptions): Promise<KeyMetadata[]>;

  /**
   * Encrypt data using a KMS key
   *
   * @param plaintext - Data to encrypt
   * @param options - Encryption options
   * @returns Encrypted result
   */
  encrypt(plaintext: Buffer, options?: KMSEncryptOptions): Promise<EncryptResult>;

  /**
   * Decrypt data using a KMS key
   *
   * @param ciphertext - Data to decrypt
   * @param options - Decryption options
   * @returns Decrypted result
   */
  decrypt(ciphertext: Buffer, options?: KMSDecryptOptions): Promise<DecryptResult>;

  /**
   * Generate a data key for envelope encryption
   *
   * Returns both plaintext (for immediate use) and encrypted
   * (for storage) versions of the data key.
   *
   * @param options - Data key generation options
   * @returns Data key with plaintext and ciphertext
   */
  generateDataKey(options?: GenerateDataKeyOptions): Promise<DataKey>;

  /**
   * Decrypt a previously generated data key
   *
   * @param encryptedDataKey - The encrypted data key
   * @param options - Decryption options
   * @returns Plaintext data key
   */
  decryptDataKey(encryptedDataKey: Buffer, options?: KMSDecryptOptions): Promise<Buffer>;

  /**
   * Rotate a key to a new version
   *
   * @param keyId - Key ID to rotate
   * @returns Rotation result
   */
  rotateKey(keyId: string): Promise<KeyRotationResult>;

  /**
   * Get the rotation schedule for a key
   *
   * @param keyId - Key ID
   * @returns Rotation schedule
   */
  getRotationSchedule?(keyId: string): Promise<KeyRotationSchedule>;

  /**
   * Enable automatic key rotation
   *
   * @param keyId - Key ID
   * @param rotationPeriodDays - Rotation period in days
   */
  enableAutoRotation?(keyId: string, rotationPeriodDays?: number): Promise<void>;

  /**
   * Disable automatic key rotation
   *
   * @param keyId - Key ID
   */
  disableAutoRotation?(keyId: string): Promise<void>;
}

/**
 * Options for listing keys
 */
export interface ListKeysOptions {
  /** Maximum number of keys to return */
  limit?: number;
  /** Pagination token */
  nextToken?: string;
  /** Filter by key status */
  status?: KeyStatus;
}

// =============================================================================
// KMS Configuration Types
// =============================================================================

/**
 * KMS provider types
 */
export const KMSProviderType = {
  /** AWS Key Management Service */
  AWS: 'aws',
  /** HashiCorp Vault */
  VAULT: 'vault',
  /** Local development provider */
  LOCAL: 'local',
} as const;

export type KMSProviderType = (typeof KMSProviderType)[keyof typeof KMSProviderType];

export const kmsProviderTypeSchema = z.nativeEnum(KMSProviderType);

/**
 * Base KMS configuration
 */
export interface KMSConfigBase {
  /** Provider type */
  provider: KMSProviderType;
  /** Default key ID to use */
  defaultKeyId?: string;
  /** Enable caching of data keys */
  enableCaching?: boolean;
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number;
  /** Maximum cached data key usages */
  maxCacheUsages?: number;
  /** Enable audit logging */
  enableAuditLogging?: boolean;
  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts */
    maxAttempts?: number;
    /** Initial retry delay in ms */
    initialDelayMs?: number;
    /** Maximum retry delay in ms */
    maxDelayMs?: number;
  };
}

/**
 * AWS KMS specific configuration
 */
export interface AWSKMSConfig extends KMSConfigBase {
  provider: 'aws';
  /** AWS region */
  region?: string;
  /** KMS key ARN or alias */
  keyArn: string;
  /** AWS access key ID (optional, uses default credential chain) */
  accessKeyId?: string;
  /** AWS secret access key (optional, uses default credential chain) */
  secretAccessKey?: string;
  /** AWS endpoint (for LocalStack, etc.) */
  endpoint?: string;
}

/**
 * HashiCorp Vault specific configuration
 */
export interface VaultKMSConfig extends KMSConfigBase {
  provider: 'vault';
  /** Vault server address */
  address: string;
  /** Vault token */
  token?: string;
  /** Path to token file */
  tokenFile?: string;
  /** Transit secrets engine mount path */
  transitMount?: string;
  /** Key name in transit engine */
  keyName: string;
  /** Enable token renewal */
  enableTokenRenewal?: boolean;
  /** Token renewal interval in seconds */
  tokenRenewalIntervalSeconds?: number;
  /** Vault namespace (enterprise feature) */
  namespace?: string;
  /** TLS configuration */
  tls?: {
    /** CA certificate path */
    caCert?: string;
    /** Client certificate path */
    clientCert?: string;
    /** Client key path */
    clientKey?: string;
    /** Skip TLS verification (NOT for production) */
    skipVerify?: boolean;
  };
}

/**
 * Local KMS specific configuration (development only)
 */
export interface LocalKMSConfig extends KMSConfigBase {
  provider: 'local';
  /** Master key (base64 encoded) - NOT for production */
  masterKey?: string;
  /** Path to key file */
  keyFile?: string;
  /** Environment variable containing the key */
  keyEnvVar?: string;
  /** Suppress production warnings (for testing) */
  suppressWarnings?: boolean;
}

/**
 * Union of all KMS configurations
 */
export type KMSConfig = AWSKMSConfig | VaultKMSConfig | LocalKMSConfig;

// =============================================================================
// Configuration Schemas
// =============================================================================

const retryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
  initialDelayMs: z.number().int().positive().default(100),
  maxDelayMs: z.number().int().positive().default(5000),
}).optional();

const baseConfigSchema = z.object({
  defaultKeyId: z.string().optional(),
  enableCaching: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().positive().default(300),
  maxCacheUsages: z.number().int().positive().default(1000),
  enableAuditLogging: z.boolean().default(true),
  retry: retryConfigSchema,
});

export const awsKmsConfigSchema = baseConfigSchema.extend({
  provider: z.literal('aws'),
  region: z.string().optional(),
  keyArn: z.string().min(1),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  endpoint: z.string().url().optional(),
});

export const vaultKmsConfigSchema = baseConfigSchema.extend({
  provider: z.literal('vault'),
  address: z.string().url(),
  token: z.string().optional(),
  tokenFile: z.string().optional(),
  transitMount: z.string().default('transit'),
  keyName: z.string().min(1),
  enableTokenRenewal: z.boolean().default(true),
  tokenRenewalIntervalSeconds: z.number().int().positive().default(3600),
  namespace: z.string().optional(),
  tls: z.object({
    caCert: z.string().optional(),
    clientCert: z.string().optional(),
    clientKey: z.string().optional(),
    skipVerify: z.boolean().default(false),
  }).optional(),
});

export const localKmsConfigSchema = baseConfigSchema.extend({
  provider: z.literal('local'),
  masterKey: z.string().optional(),
  keyFile: z.string().optional(),
  keyEnvVar: z.string().default('VORION_LOCAL_KMS_KEY'),
  suppressWarnings: z.boolean().default(false),
});

export const kmsConfigSchema = z.discriminatedUnion('provider', [
  awsKmsConfigSchema,
  vaultKmsConfigSchema,
  localKmsConfigSchema,
]);

// =============================================================================
// Audit Types
// =============================================================================

/**
 * KMS operation types for audit logging
 */
export const KMSOperation = {
  ENCRYPT: 'kms_encrypt',
  DECRYPT: 'kms_decrypt',
  GENERATE_DATA_KEY: 'kms_generate_data_key',
  DECRYPT_DATA_KEY: 'kms_decrypt_data_key',
  ROTATE_KEY: 'kms_rotate_key',
  GET_KEY: 'kms_get_key',
  LIST_KEYS: 'kms_list_keys',
} as const;

export type KMSOperation = (typeof KMSOperation)[keyof typeof KMSOperation];

/**
 * Audit log entry for KMS operations
 */
export interface KMSAuditEntry {
  /** Unique audit entry ID */
  id: string;
  /** Timestamp of the operation */
  timestamp: Date;
  /** Type of operation */
  operation: KMSOperation;
  /** KMS provider used */
  provider: KMSProviderType;
  /** Key ID used */
  keyId?: string;
  /** Key version used */
  keyVersion?: number;
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
  /** Whether result came from cache */
  fromCache?: boolean;
}

/**
 * Callback for KMS audit logging
 */
export type KMSAuditCallback = (entry: KMSAuditEntry) => void | Promise<void>;

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for KMS operations
 */
export const KMSErrorCode = {
  /** Provider not initialized */
  NOT_INITIALIZED: 'KMS_NOT_INITIALIZED',
  /** Key not found */
  KEY_NOT_FOUND: 'KMS_KEY_NOT_FOUND',
  /** Key is disabled */
  KEY_DISABLED: 'KMS_KEY_DISABLED',
  /** Encryption failed */
  ENCRYPTION_FAILED: 'KMS_ENCRYPTION_FAILED',
  /** Decryption failed */
  DECRYPTION_FAILED: 'KMS_DECRYPTION_FAILED',
  /** Invalid ciphertext */
  INVALID_CIPHERTEXT: 'KMS_INVALID_CIPHERTEXT',
  /** Key rotation failed */
  ROTATION_FAILED: 'KMS_ROTATION_FAILED',
  /** Authentication failed */
  AUTH_FAILED: 'KMS_AUTH_FAILED',
  /** Connection failed */
  CONNECTION_FAILED: 'KMS_CONNECTION_FAILED',
  /** Rate limit exceeded */
  RATE_LIMITED: 'KMS_RATE_LIMITED',
  /** Invalid configuration */
  INVALID_CONFIG: 'KMS_INVALID_CONFIG',
  /** Cache error */
  CACHE_ERROR: 'KMS_CACHE_ERROR',
  /** Token expired */
  TOKEN_EXPIRED: 'KMS_TOKEN_EXPIRED',
  /** Provider not supported */
  UNSUPPORTED_PROVIDER: 'KMS_UNSUPPORTED_PROVIDER',
} as const;

export type KMSErrorCode = (typeof KMSErrorCode)[keyof typeof KMSErrorCode];
