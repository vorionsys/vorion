/**
 * Operations Module - Backup and Restore System
 *
 * Provides automated backup and restore functionality for Vorion:
 * - BackupManager: Create, list, verify, and manage backups
 * - RestoreManager: Restore from backups with verification and rollback
 * - Support for S3-compatible storage (AWS S3, MinIO, Backblaze B2, Cloudflare R2)
 * - Local filesystem storage
 * - AES-256-GCM encryption
 * - Retention policy management
 *
 * @example
 * ```typescript
 * import { createBackupManager, createRestoreManager } from './ops';
 *
 * // Create backup manager with S3 storage
 * const backupManager = createBackupManager({
 *   enabled: true,
 *   storage: {
 *     type: 's3',
 *     bucket: 'my-backups',
 *     region: 'us-east-1',
 *     endpoint: 'https://s3.amazonaws.com', // or MinIO/R2 endpoint
 *   },
 *   encryption: {
 *     enabled: true,
 *     algorithm: 'aes-256-gcm',
 *     key: process.env.BACKUP_ENCRYPTION_KEY,
 *   },
 *   retention: {
 *     daily: 7,
 *     weekly: 4,
 *     monthly: 12,
 *   },
 *   components: {
 *     database: true,
 *     configurations: true,
 *     proofChain: true,
 *   },
 * });
 *
 * // Create a backup
 * const manifest = await backupManager.createBackup();
 *
 * // Create restore manager
 * const restoreManager = createRestoreManager(backupManager);
 *
 * // Test restore first
 * const testResult = await restoreManager.testRestore(manifest.id);
 *
 * // Perform actual restore
 * if (testResult.success) {
 *   const result = await restoreManager.restore(manifest.id, {
 *     verifyFirst: true,
 *     backupBeforeRestore: true,
 *   });
 * }
 * ```
 *
 * @packageDocumentation
 */

// Types - only export pure interface/type definitions (not const objects with same name)
export type {
  // Configuration types
  StorageConfig,
  EncryptionConfig,
  RetentionConfig,
  ComponentsConfig,
  BackupConfig,

  // Backup types
  ComponentBackupInfo,
  BackupManifest,
  BackupFilter,

  // Verification types
  ComponentVerificationResult,
  VerificationResult,

  // Restore types
  RestoreOptions,
  ComponentRestoreResult,
  RestoreResult,
  TestRestoreResult,

  // Cleanup types
  CleanupResult,

  // Interfaces
  IBackupManager,
  IRestoreManager,
  IStorageProvider,
} from './types.js';

// Enums/Constants (these are both const objects AND types via typeof)
// Export values - types will be automatically available via typeof
export {
  StorageType,
  EncryptionAlgorithm,
  BackupType,
  BackupStatus,
  VerificationStatus,
  RestoreStatus,
} from './types.js';

// Schemas (for validation)
export {
  storageTypeSchema,
  encryptionAlgorithmSchema,
  storageConfigSchema,
  encryptionConfigSchema,
  retentionConfigSchema,
  componentsConfigSchema,
  backupConfigSchema,
  backupTypeSchema,
  backupStatusSchema,
  componentBackupInfoSchema,
  backupManifestSchema,
  backupFilterSchema,
  verificationStatusSchema,
  componentVerificationResultSchema,
  verificationResultSchema,
  restoreOptionsSchema,
  restoreStatusSchema,
  componentRestoreResultSchema,
  restoreResultSchema,
  testRestoreResultSchema,
  cleanupResultSchema,
} from './types.js';

// Backup Manager
export {
  BackupManager,
  BackupError,
  S3StorageProvider,
  LocalStorageProvider,
  createBackupManager,
} from './backup.js';

// Restore Manager
export {
  RestoreManager,
  RestoreError,
  createRestoreManager,
} from './restore.js';

// Operational Alerts
export {
  // Alert definitions
  DatabasePoolHighUtilization,
  DatabasePoolCritical,
  DatabaseConnectionsWaiting,
  RedisConnectionFailures,
  RedisUnhealthy,
  CircuitBreakerOpen,
  CircuitBreakerStuckOpen,
  HighRequestLatencyP99,
  CriticalRequestLatencyP99,
  HighErrorRate,
  CriticalErrorRate,
  IntentProcessingSlow,
  HighMemoryUsage,
  CriticalMemoryUsage,
  IntentApprovalRateDrop,
  EscalationBacklog,
  EscalationSLABreachRisk,
  LowTrustCalculations,
  // Registry and utilities
  ALL_ALERTS,
  getAlertsBySeverity,
  getAlertsByCategory,
  getAlertByName,
  evaluateAllAlerts,
  generatePrometheusRules,
  // Types
  type AlertSeverity,
  type AlertCategory,
  type AlertState,
  type AlertDefinition,
  type AlertEvaluationResult,
  type AlertInstance,
} from './alerts.js';
