/**
 * Backup and Restore Type Definitions
 *
 * Types for automated backup and restore operations supporting
 * S3-compatible storage (AWS S3, MinIO, Backblaze B2, Cloudflare R2)
 * and local filesystem storage.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// BACKUP CONFIGURATION
// =============================================================================

/**
 * Storage type for backups
 */
export const StorageType = {
  S3: 's3',
  LOCAL: 'local',
} as const;

export type StorageType = (typeof StorageType)[keyof typeof StorageType];

export const storageTypeSchema = z.nativeEnum(StorageType);

/**
 * Encryption algorithm for backup encryption
 */
export const EncryptionAlgorithm = {
  AES_256_GCM: 'aes-256-gcm',
} as const;

export type EncryptionAlgorithm = (typeof EncryptionAlgorithm)[keyof typeof EncryptionAlgorithm];

export const encryptionAlgorithmSchema = z.nativeEnum(EncryptionAlgorithm);

/**
 * Storage configuration for backups
 */
export interface StorageConfig {
  /** Storage type */
  type: StorageType;
  /** S3 bucket name (required for s3 type) */
  bucket?: string;
  /** AWS region (required for s3 type) */
  region?: string;
  /** Custom endpoint for S3-compatible storage (MinIO, R2, B2) */
  endpoint?: string;
  /** AWS access key ID */
  accessKeyId?: string;
  /** AWS secret access key */
  secretAccessKey?: string;
  /** Local filesystem path (required for local type) */
  localPath?: string;
}

export const storageConfigSchema = z.object({
  type: storageTypeSchema,
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  localPath: z.string().optional(),
}).refine(
  (data) => {
    if (data.type === StorageType.S3) {
      return !!data.bucket && !!data.region;
    }
    if (data.type === StorageType.LOCAL) {
      return !!data.localPath;
    }
    return true;
  },
  {
    message: 'S3 storage requires bucket and region; local storage requires localPath',
  }
);

/**
 * Encryption configuration for backups
 */
export interface EncryptionConfig {
  /** Whether encryption is enabled */
  enabled: boolean;
  /** Encryption algorithm */
  algorithm: EncryptionAlgorithm;
  /** Encryption key (32 bytes for AES-256, base64 encoded) */
  key?: string;
}

export const encryptionConfigSchema = z.object({
  enabled: z.boolean(),
  algorithm: encryptionAlgorithmSchema,
  key: z.string().optional(),
}).refine(
  (data) => !data.enabled || !!data.key,
  { message: 'Encryption key is required when encryption is enabled' }
);

/**
 * Retention policy for backups
 */
export interface RetentionConfig {
  /** Days to keep daily backups */
  daily: number;
  /** Weeks to keep weekly backups */
  weekly: number;
  /** Months to keep monthly backups */
  monthly: number;
}

export const retentionConfigSchema = z.object({
  daily: z.number().int().min(0).default(7),
  weekly: z.number().int().min(0).default(4),
  monthly: z.number().int().min(0).default(12),
});

/**
 * Components that can be backed up
 */
export interface ComponentsConfig {
  /** Include database backup */
  database: boolean;
  /** Include configuration files */
  configurations: boolean;
  /** Include proof chain data */
  proofChain: boolean;
}

export const componentsConfigSchema = z.object({
  database: z.boolean().default(true),
  configurations: z.boolean().default(true),
  proofChain: z.boolean().default(true),
});

/**
 * Complete backup configuration
 */
export interface BackupConfig {
  /** Whether backups are enabled */
  enabled: boolean;
  /** Storage configuration */
  storage: StorageConfig;
  /** Encryption configuration */
  encryption: EncryptionConfig;
  /** Retention policy */
  retention: RetentionConfig;
  /** Components to backup */
  components: ComponentsConfig;
}

export const backupConfigSchema = z.object({
  enabled: z.boolean(),
  storage: storageConfigSchema,
  encryption: encryptionConfigSchema,
  retention: retentionConfigSchema,
  components: componentsConfigSchema,
});

// =============================================================================
// BACKUP MANIFEST
// =============================================================================

/**
 * Backup type classification
 */
export const BackupType = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  MANUAL: 'manual',
} as const;

export type BackupType = (typeof BackupType)[keyof typeof BackupType];

export const backupTypeSchema = z.nativeEnum(BackupType);

/**
 * Backup status
 */
export const BackupStatus = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CORRUPTED: 'corrupted',
} as const;

export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

export const backupStatusSchema = z.nativeEnum(BackupStatus);

/**
 * Component backup details
 */
export interface ComponentBackupInfo {
  /** Component name */
  name: string;
  /** Component size in bytes */
  size: number;
  /** Number of records/files */
  recordCount: number;
  /** Component-specific checksum */
  checksum: string;
  /** Backup duration in milliseconds */
  durationMs: number;
}

export const componentBackupInfoSchema = z.object({
  name: z.string(),
  size: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  checksum: z.string(),
  durationMs: z.number().int().nonnegative(),
});

/**
 * Backup manifest containing metadata about a backup
 */
export interface BackupManifest {
  /** Unique backup identifier */
  id: string;
  /** Backup creation timestamp */
  timestamp: Date;
  /** Application version at backup time */
  version: string;
  /** Backup type */
  type: BackupType;
  /** Backup status */
  status: BackupStatus;
  /** List of backed up components */
  components: string[];
  /** Detailed component information */
  componentDetails: ComponentBackupInfo[];
  /** Total backup size in bytes */
  size: number;
  /** SHA-256 checksum of the backup */
  checksum: string;
  /** Whether backup is encrypted */
  encrypted: boolean;
  /** Encryption algorithm if encrypted */
  encryptionAlgorithm?: EncryptionAlgorithm;
  /** Storage location path/key */
  storagePath: string;
  /** Backup duration in milliseconds */
  durationMs: number;
  /** Error message if backup failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const backupManifestSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  version: z.string(),
  type: backupTypeSchema,
  status: backupStatusSchema,
  components: z.array(z.string()),
  componentDetails: z.array(componentBackupInfoSchema),
  size: z.number().int().nonnegative(),
  checksum: z.string(),
  encrypted: z.boolean(),
  encryptionAlgorithm: encryptionAlgorithmSchema.optional(),
  storagePath: z.string(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// BACKUP FILTER
// =============================================================================

/**
 * Filter options for listing backups
 */
export interface BackupFilter {
  /** Filter by backup type */
  type?: BackupType;
  /** Filter by status */
  status?: BackupStatus;
  /** Filter by component */
  component?: string;
  /** Filter by start date */
  startDate?: Date;
  /** Filter by end date */
  endDate?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export const backupFilterSchema = z.object({
  type: backupTypeSchema.optional(),
  status: backupStatusSchema.optional(),
  component: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// =============================================================================
// VERIFICATION
// =============================================================================

/**
 * Verification status
 */
export const VerificationStatus = {
  VALID: 'valid',
  INVALID: 'invalid',
  CORRUPTED: 'corrupted',
  MISSING: 'missing',
} as const;

export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const verificationStatusSchema = z.nativeEnum(VerificationStatus);

/**
 * Component verification result
 */
export interface ComponentVerificationResult {
  /** Component name */
  component: string;
  /** Verification status */
  status: VerificationStatus;
  /** Expected checksum */
  expectedChecksum: string;
  /** Actual checksum */
  actualChecksum?: string;
  /** Error message if verification failed */
  error?: string;
}

export const componentVerificationResultSchema = z.object({
  component: z.string(),
  status: verificationStatusSchema,
  expectedChecksum: z.string(),
  actualChecksum: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Complete backup verification result
 */
export interface VerificationResult {
  /** Backup ID */
  backupId: string;
  /** Overall verification status */
  status: VerificationStatus;
  /** Whether backup is valid */
  valid: boolean;
  /** Verification timestamp */
  verifiedAt: Date;
  /** Per-component verification results */
  components: ComponentVerificationResult[];
  /** Overall error message if verification failed */
  error?: string;
  /** Verification duration in milliseconds */
  durationMs: number;
}

export const verificationResultSchema = z.object({
  backupId: z.string().uuid(),
  status: verificationStatusSchema,
  valid: z.boolean(),
  verifiedAt: z.coerce.date(),
  components: z.array(componentVerificationResultSchema),
  error: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
});

// =============================================================================
// RESTORE OPTIONS
// =============================================================================

/**
 * Restore target options
 */
export interface RestoreOptions {
  /** Specific components to restore (all if not specified) */
  components?: string[];
  /** Target database connection string (uses current if not specified) */
  targetDatabase?: string;
  /** Target configuration directory */
  targetConfigPath?: string;
  /** Whether to verify backup before restore */
  verifyFirst?: boolean;
  /** Whether to create backup of current state before restore */
  backupBeforeRestore?: boolean;
  /** Whether to force restore even if verification warns */
  force?: boolean;
  /** Point-in-time restore target (for database) */
  pointInTime?: Date;
}

export const restoreOptionsSchema = z.object({
  components: z.array(z.string()).optional(),
  targetDatabase: z.string().optional(),
  targetConfigPath: z.string().optional(),
  verifyFirst: z.boolean().default(true),
  backupBeforeRestore: z.boolean().default(true),
  force: z.boolean().default(false),
  pointInTime: z.coerce.date().optional(),
});

// =============================================================================
// RESTORE RESULTS
// =============================================================================

/**
 * Restore status
 */
export const RestoreStatus = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
} as const;

export type RestoreStatus = (typeof RestoreStatus)[keyof typeof RestoreStatus];

export const restoreStatusSchema = z.nativeEnum(RestoreStatus);

/**
 * Component restore result
 */
export interface ComponentRestoreResult {
  /** Component name */
  component: string;
  /** Restore status */
  status: RestoreStatus;
  /** Records restored */
  recordsRestored: number;
  /** Restore duration in milliseconds */
  durationMs: number;
  /** Error message if restore failed */
  error?: string;
}

export const componentRestoreResultSchema = z.object({
  component: z.string(),
  status: restoreStatusSchema,
  recordsRestored: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

/**
 * Complete restore result
 */
export interface RestoreResult {
  /** Backup ID that was restored */
  backupId: string;
  /** Overall restore status */
  status: RestoreStatus;
  /** Restore start timestamp */
  startedAt: Date;
  /** Restore completion timestamp */
  completedAt: Date;
  /** Per-component restore results */
  components: ComponentRestoreResult[];
  /** ID of pre-restore backup (if created) */
  preRestoreBackupId?: string;
  /** Total records restored */
  totalRecordsRestored: number;
  /** Total restore duration in milliseconds */
  durationMs: number;
  /** Error message if restore failed */
  error?: string;
  /** Warnings generated during restore */
  warnings: string[];
}

export const restoreResultSchema = z.object({
  backupId: z.string().uuid(),
  status: restoreStatusSchema,
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  components: z.array(componentRestoreResultSchema),
  preRestoreBackupId: z.string().uuid().optional(),
  totalRecordsRestored: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  warnings: z.array(z.string()),
});

// =============================================================================
// TEST RESTORE
// =============================================================================

/**
 * Test restore result
 */
export interface TestRestoreResult {
  /** Backup ID tested */
  backupId: string;
  /** Whether test restore succeeded */
  success: boolean;
  /** Test timestamp */
  testedAt: Date;
  /** Verification result */
  verification: VerificationResult;
  /** Simulated restore results */
  simulatedRestore: {
    /** Would restore succeed */
    wouldSucceed: boolean;
    /** Estimated duration in milliseconds */
    estimatedDurationMs: number;
    /** Potential issues */
    potentialIssues: string[];
  };
  /** Test duration in milliseconds */
  durationMs: number;
  /** Error message if test failed */
  error?: string;
}

export const testRestoreResultSchema = z.object({
  backupId: z.string().uuid(),
  success: z.boolean(),
  testedAt: z.coerce.date(),
  verification: verificationResultSchema,
  simulatedRestore: z.object({
    wouldSucceed: z.boolean(),
    estimatedDurationMs: z.number().int().nonnegative(),
    potentialIssues: z.array(z.string()),
  }),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

// =============================================================================
// CLEANUP RESULTS
// =============================================================================

/**
 * Backup cleanup result
 */
export interface CleanupResult {
  /** Number of backups deleted */
  deletedCount: number;
  /** Total size freed in bytes */
  freedBytes: number;
  /** Deleted backup IDs */
  deletedBackups: string[];
  /** Cleanup duration in milliseconds */
  durationMs: number;
  /** Errors encountered during cleanup */
  errors: string[];
}

export const cleanupResultSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  freedBytes: z.number().int().nonnegative(),
  deletedBackups: z.array(z.string()),
  durationMs: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

// =============================================================================
// BACKUP MANAGER INTERFACE
// =============================================================================

/**
 * Backup manager interface
 */
export interface IBackupManager {
  /**
   * Create a new backup
   * @param options - Optional backup configuration overrides
   * @returns Backup manifest
   */
  createBackup(options?: Partial<BackupConfig>): Promise<BackupManifest>;

  /**
   * List available backups
   * @param filter - Optional filter criteria
   * @returns List of backup manifests
   */
  listBackups(filter?: BackupFilter): Promise<BackupManifest[]>;

  /**
   * Delete a backup
   * @param backupId - ID of backup to delete
   */
  deleteBackup(backupId: string): Promise<void>;

  /**
   * Verify a backup's integrity
   * @param backupId - ID of backup to verify
   * @returns Verification result
   */
  verifyBackup(backupId: string): Promise<VerificationResult>;

  /**
   * Apply retention policy and cleanup old backups
   * @returns Cleanup result
   */
  applyRetentionPolicy(): Promise<CleanupResult>;
}

// =============================================================================
// RESTORE MANAGER INTERFACE
// =============================================================================

/**
 * Restore manager interface
 */
export interface IRestoreManager {
  /**
   * Restore from a backup
   * @param backupId - ID of backup to restore
   * @param options - Restore options
   * @returns Restore result
   */
  restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult>;

  /**
   * Test a restore without applying changes
   * @param backupId - ID of backup to test
   * @returns Test restore result
   */
  testRestore(backupId: string): Promise<TestRestoreResult>;
}

// =============================================================================
// STORAGE PROVIDER INTERFACE
// =============================================================================

/**
 * Storage provider interface for backup storage abstraction
 */
export interface IStorageProvider {
  /**
   * Upload backup data
   * @param key - Storage key/path
   * @param data - Data to upload
   * @returns Upload result with path
   */
  upload(key: string, data: Buffer): Promise<{ path: string; size: number }>;

  /**
   * Download backup data
   * @param key - Storage key/path
   * @returns Downloaded data
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete backup data
   * @param key - Storage key/path
   */
  delete(key: string): Promise<void>;

  /**
   * Check if backup exists
   * @param key - Storage key/path
   * @returns Whether backup exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * List all backups
   * @param prefix - Optional prefix filter
   * @returns List of storage keys
   */
  list(prefix?: string): Promise<string[]>;
}
