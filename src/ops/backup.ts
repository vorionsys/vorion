/**
 * Backup Manager Implementation
 *
 * Provides automated backup functionality supporting:
 * - S3-compatible storage (AWS S3, MinIO, Backblaze B2, Cloudflare R2)
 * - Local filesystem storage
 * - AES-256-GCM encryption
 * - Retention policy management
 * - Component-based backups (database, configurations, proof chain)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';

import type {
  BackupConfig,
  BackupManifest,
  BackupFilter,
  BackupType,
  BackupStatus,
  VerificationResult,
  VerificationStatus,
  ComponentBackupInfo,
  ComponentVerificationResult,
  CleanupResult,
  IBackupManager,
  IStorageProvider,
  StorageConfig,
  EncryptionConfig,
} from './types.js';

import {
  StorageType,
  EncryptionAlgorithm,
} from './types.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const logger = createLogger({ component: 'backup' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Backup-specific error class
 */
export class BackupError extends VorionError {
  override code = 'BACKUP_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly operation: string,
    public readonly backupId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, { operation, backupId, ...details });
    this.name = 'BackupError';
  }
}

// =============================================================================
// S3 STORAGE PROVIDER
// =============================================================================

/**
 * S3-compatible storage provider
 * Works with AWS S3, MinIO, Backblaze B2, Cloudflare R2
 */
export class S3StorageProvider implements IStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    if (!config.bucket || !config.region) {
      throw new BackupError(
        'S3 storage requires bucket and region',
        'initialize'
      );
    }

    this.bucket = config.bucket;

    const clientConfig: {
      region: string;
      endpoint?: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
      forcePathStyle?: boolean;
    } = {
      region: config.region,
    };

    // Custom endpoint for S3-compatible services
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true; // Required for MinIO and some S3-compatible services
    }

    // Explicit credentials (for non-AWS environments)
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  async upload(key: string, data: Buffer): Promise<{ path: string; size: number }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: 'application/octet-stream',
    });

    await this.client.send(command);

    return {
      path: `s3://${this.bucket}/${key}`,
      size: data.length,
    };
  }

  async download(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new BackupError('Empty response body from S3', 'download');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }
}

// =============================================================================
// LOCAL STORAGE PROVIDER
// =============================================================================

/**
 * Local filesystem storage provider
 */
export class LocalStorageProvider implements IStorageProvider {
  private readonly basePath: string;

  constructor(config: StorageConfig) {
    if (!config.localPath) {
      throw new BackupError(
        'Local storage requires localPath',
        'initialize'
      );
    }

    this.basePath = config.localPath;
  }

  private getFullPath(key: string): string {
    return path.join(this.basePath, key);
  }

  async upload(key: string, data: Buffer): Promise<{ path: string; size: number }> {
    const fullPath = this.getFullPath(key);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, data);

    return {
      path: fullPath,
      size: data.length,
    };
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);
    return fs.readFile(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await fs.unlink(fullPath);
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    try {
      await fs.access(fullPath);
      return true;
    } catch (error) {
      // ENOENT (file not found) is expected, other errors should be logged
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          {
            key,
            fullPath,
            error: error instanceof Error ? error.message : String(error),
            errorCode: (error as NodeJS.ErrnoException).code,
            operation: 'exists',
          },
          'Unexpected error checking file existence'
        );
      }
      return false;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    const searchPath = prefix
      ? path.join(this.basePath, prefix)
      : this.basePath;

    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true, recursive: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const fullPath = path.join(entry.parentPath || entry.path, entry.name);
          const relativePath = path.relative(this.basePath, fullPath);
          keys.push(relativePath);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return keys;
  }
}

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================

/**
 * Encrypt data using AES-256-GCM
 */
function encryptData(data: Buffer, key: string): Buffer {
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new BackupError(
      'Encryption key must be 32 bytes (256 bits)',
      'encrypt'
    );
  }

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (12 bytes) + Auth Tag (16 bytes) + Encrypted Data
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt data using AES-256-GCM
 */
function decryptData(encryptedData: Buffer, key: string): Buffer {
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new BackupError(
      'Encryption key must be 32 bytes (256 bits)',
      'decrypt'
    );
  }

  // Extract IV, auth tag, and encrypted data
  const iv = encryptedData.subarray(0, 12);
  const authTag = encryptedData.subarray(12, 28);
  const encrypted = encryptedData.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Calculate SHA-256 checksum
 */
function calculateChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// =============================================================================
// BACKUP MANAGER
// =============================================================================

/**
 * Default backup configuration
 */
const DEFAULT_CONFIG: BackupConfig = {
  enabled: true,
  storage: {
    type: StorageType.LOCAL,
    localPath: './backups',
  },
  encryption: {
    enabled: false,
    algorithm: EncryptionAlgorithm.AES_256_GCM,
  },
  retention: {
    daily: 7,
    weekly: 4,
    monthly: 12,
  },
  components: {
    database: true,
    configurations: true,
    proofChain: true,
  },
};

/**
 * Component backup handler type
 */
type ComponentBackupHandler = () => Promise<{
  data: Buffer;
  recordCount: number;
}>;

/**
 * Backup Manager implementation
 */
export class BackupManager implements IBackupManager {
  private readonly config: BackupConfig;
  private readonly storage: IStorageProvider;
  private readonly componentHandlers: Map<string, ComponentBackupHandler>;
  private readonly manifestPrefix = 'manifests/';
  private readonly dataPrefix = 'data/';

  constructor(config?: Partial<BackupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize storage provider
    this.storage = this.createStorageProvider(this.config.storage);

    // Initialize component handlers
    this.componentHandlers = new Map();
    this.registerDefaultHandlers();

    logger.info('BackupManager initialized', {
      storageType: this.config.storage.type,
      encryptionEnabled: this.config.encryption.enabled,
      components: Object.keys(this.config.components).filter(
        (k) => this.config.components[k as keyof typeof this.config.components]
      ),
    });
  }

  /**
   * Create storage provider based on configuration
   */
  private createStorageProvider(config: StorageConfig): IStorageProvider {
    switch (config.type) {
      case StorageType.S3:
        return new S3StorageProvider(config);
      case StorageType.LOCAL:
        return new LocalStorageProvider(config);
      default:
        throw new BackupError(
          `Unknown storage type: ${config.type}`,
          'initialize'
        );
    }
  }

  /**
   * Register default component backup handlers
   */
  private registerDefaultHandlers(): void {
    // Database backup handler
    this.componentHandlers.set('database', async () => {
      // In production, this would use pg_dump or similar
      // For now, return placeholder data
      logger.debug('Backing up database component');
      const data = Buffer.from(JSON.stringify({
        type: 'database_backup',
        timestamp: new Date().toISOString(),
        tables: ['intents', 'policies', 'escalations', 'proofs', 'trust'],
      }));
      return { data, recordCount: 0 };
    });

    // Configurations backup handler
    this.componentHandlers.set('configurations', async () => {
      logger.debug('Backing up configurations component');
      const data = Buffer.from(JSON.stringify({
        type: 'configurations_backup',
        timestamp: new Date().toISOString(),
        files: ['policies/', 'schemas/', 'rules/'],
      }));
      return { data, recordCount: 0 };
    });

    // Proof chain backup handler
    this.componentHandlers.set('proofChain', async () => {
      logger.debug('Backing up proof chain component');
      const data = Buffer.from(JSON.stringify({
        type: 'proof_chain_backup',
        timestamp: new Date().toISOString(),
        chainLength: 0,
      }));
      return { data, recordCount: 0 };
    });
  }

  /**
   * Register a custom component backup handler
   */
  registerComponentHandler(name: string, handler: ComponentBackupHandler): void {
    this.componentHandlers.set(name, handler);
    logger.info('Registered custom backup handler', { component: name });
  }

  /**
   * Determine backup type based on date
   */
  private determineBackupType(date: Date = new Date()): BackupType {
    const dayOfMonth = date.getDate();
    const dayOfWeek = date.getDay();

    // First day of month = monthly backup
    if (dayOfMonth === 1) {
      return 'monthly';
    }

    // Sunday = weekly backup
    if (dayOfWeek === 0) {
      return 'weekly';
    }

    return 'daily';
  }

  /**
   * Create a new backup
   */
  async createBackup(options?: Partial<BackupConfig>): Promise<BackupManifest> {
    const startTime = Date.now();
    const backupId = randomUUID();
    const timestamp = new Date();
    const config = { ...this.config, ...options };

    logger.info('Starting backup', { backupId, timestamp: timestamp.toISOString() });

    const componentsToBackup = Object.entries(config.components)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);

    const componentDetails: ComponentBackupInfo[] = [];
    const backupData: Record<string, Buffer> = {};
    let totalSize = 0;

    try {
      // Backup each component
      for (const componentName of componentsToBackup) {
        const handler = this.componentHandlers.get(componentName);
        if (!handler) {
          logger.warn('No handler for component', { component: componentName });
          continue;
        }

        const componentStart = Date.now();

        try {
          const { data, recordCount } = await handler();
          const checksum = calculateChecksum(data);

          componentDetails.push({
            name: componentName,
            size: data.length,
            recordCount,
            checksum,
            durationMs: Date.now() - componentStart,
          });

          backupData[componentName] = data;
          totalSize += data.length;

          logger.debug('Component backup completed', {
            component: componentName,
            size: data.length,
            recordCount,
          });
        } catch (error) {
          logger.error('Component backup failed', {
            component: componentName,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new BackupError(
            `Failed to backup component: ${componentName}`,
            'createBackup',
            backupId,
            { component: componentName, originalError: String(error) }
          );
        }
      }

      // Create combined backup archive
      const archive = Buffer.from(JSON.stringify({
        metadata: {
          id: backupId,
          timestamp: timestamp.toISOString(),
          version: process.env['npm_package_version'] || '1.0.0',
        },
        components: Object.fromEntries(
          Object.entries(backupData).map(([name, data]) => [
            name,
            data.toString('base64'),
          ])
        ),
      }));

      // Compress the archive
      const compressed = await gzip(archive) as Buffer;

      // Encrypt if enabled
      let finalData: Buffer = compressed;
      if (config.encryption.enabled && config.encryption.key) {
        finalData = encryptData(compressed, config.encryption.key);
      }

      // Calculate final checksum
      const checksum = calculateChecksum(finalData);

      // Upload to storage
      const storagePath = `${this.dataPrefix}${timestamp.getFullYear()}/${String(timestamp.getMonth() + 1).padStart(2, '0')}/${backupId}.backup`;
      await this.storage.upload(storagePath, finalData);

      // Create manifest
      const manifest: BackupManifest = {
        id: backupId,
        timestamp,
        version: process.env['npm_package_version'] || '1.0.0',
        type: this.determineBackupType(timestamp),
        status: 'completed',
        components: componentsToBackup,
        componentDetails,
        size: finalData.length,
        checksum,
        encrypted: config.encryption.enabled,
        encryptionAlgorithm: config.encryption.enabled
          ? config.encryption.algorithm
          : undefined,
        storagePath,
        durationMs: Date.now() - startTime,
      };

      // Save manifest
      await this.saveManifest(manifest);

      logger.info('Backup completed', {
        backupId,
        size: finalData.length,
        components: componentsToBackup.length,
        durationMs: manifest.durationMs,
      });

      return manifest;
    } catch (error) {
      const failedManifest: BackupManifest = {
        id: backupId,
        timestamp,
        version: process.env['npm_package_version'] || '1.0.0',
        type: this.determineBackupType(timestamp),
        status: 'failed',
        components: componentsToBackup,
        componentDetails,
        size: totalSize,
        checksum: '',
        encrypted: config.encryption.enabled,
        storagePath: '',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };

      await this.saveManifest(failedManifest);

      logger.error('Backup failed', {
        backupId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: failedManifest.durationMs,
      });

      throw error;
    }
  }

  /**
   * Save backup manifest
   */
  private async saveManifest(manifest: BackupManifest): Promise<void> {
    const manifestPath = `${this.manifestPrefix}${manifest.id}.json`;
    const data = Buffer.from(JSON.stringify(manifest, null, 2));
    await this.storage.upload(manifestPath, data);
  }

  /**
   * Load backup manifest
   */
  private async loadManifest(backupId: string): Promise<BackupManifest> {
    const manifestPath = `${this.manifestPrefix}${backupId}.json`;

    try {
      const data = await this.storage.download(manifestPath);
      return JSON.parse(data.toString()) as BackupManifest;
    } catch (error) {
      throw new BackupError(
        `Backup manifest not found: ${backupId}`,
        'loadManifest',
        backupId
      );
    }
  }

  /**
   * List available backups
   */
  async listBackups(filter?: BackupFilter): Promise<BackupManifest[]> {
    logger.debug('Listing backups', { filter });

    const manifestKeys = await this.storage.list(this.manifestPrefix);
    const manifests: BackupManifest[] = [];

    for (const key of manifestKeys) {
      if (!key.endsWith('.json')) continue;

      try {
        const data = await this.storage.download(key);
        const manifest = JSON.parse(data.toString()) as BackupManifest;

        // Apply filters
        if (filter) {
          if (filter.type && manifest.type !== filter.type) continue;
          if (filter.status && manifest.status !== filter.status) continue;
          if (filter.component && !manifest.components.includes(filter.component)) continue;
          if (filter.startDate && new Date(manifest.timestamp) < filter.startDate) continue;
          if (filter.endDate && new Date(manifest.timestamp) > filter.endDate) continue;
        }

        manifests.push(manifest);
      } catch (error) {
        logger.warn('Failed to load manifest', { key, error: String(error) });
      }
    }

    // Sort by timestamp descending
    manifests.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply pagination
    if (filter?.offset || filter?.limit) {
      const offset = filter.offset || 0;
      const limit = filter.limit || manifests.length;
      return manifests.slice(offset, offset + limit);
    }

    return manifests;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    logger.info('Deleting backup', { backupId });

    const manifest = await this.loadManifest(backupId);

    // Delete backup data
    if (manifest.storagePath) {
      try {
        await this.storage.delete(manifest.storagePath);
      } catch (error) {
        logger.warn('Failed to delete backup data', {
          backupId,
          path: manifest.storagePath,
          error: String(error),
        });
      }
    }

    // Delete manifest
    const manifestPath = `${this.manifestPrefix}${backupId}.json`;
    await this.storage.delete(manifestPath);

    logger.info('Backup deleted', { backupId });
  }

  /**
   * Verify a backup's integrity
   */
  async verifyBackup(backupId: string): Promise<VerificationResult> {
    const startTime = Date.now();

    logger.info('Verifying backup', { backupId });

    try {
      const manifest = await this.loadManifest(backupId);

      // Check if backup data exists
      const exists = await this.storage.exists(manifest.storagePath);
      if (!exists) {
        return {
          backupId,
          status: 'missing',
          valid: false,
          verifiedAt: new Date(),
          components: [],
          error: 'Backup data file not found',
          durationMs: Date.now() - startTime,
        };
      }

      // Download and verify checksum
      const data = await this.storage.download(manifest.storagePath);
      const actualChecksum = calculateChecksum(data);

      if (actualChecksum !== manifest.checksum) {
        return {
          backupId,
          status: 'corrupted',
          valid: false,
          verifiedAt: new Date(),
          components: [{
            component: 'archive',
            status: 'corrupted',
            expectedChecksum: manifest.checksum,
            actualChecksum,
            error: 'Checksum mismatch',
          }],
          error: 'Backup data corrupted: checksum mismatch',
          durationMs: Date.now() - startTime,
        };
      }

      // Decrypt if needed
      let decrypted = data;
      if (manifest.encrypted) {
        if (!this.config.encryption.key) {
          return {
            backupId,
            status: 'invalid',
            valid: false,
            verifiedAt: new Date(),
            components: [],
            error: 'Encryption key required to verify encrypted backup',
            durationMs: Date.now() - startTime,
          };
        }

        try {
          decrypted = decryptData(data, this.config.encryption.key);
        } catch (error) {
          return {
            backupId,
            status: 'corrupted',
            valid: false,
            verifiedAt: new Date(),
            components: [],
            error: 'Decryption failed: invalid key or corrupted data',
            durationMs: Date.now() - startTime,
          };
        }
      }

      // Decompress and parse
      const decompressed = await gunzip(decrypted);
      const archive = JSON.parse(decompressed.toString());

      // Verify each component
      const componentResults: ComponentVerificationResult[] = [];

      for (const detail of manifest.componentDetails) {
        const componentData = archive.components[detail.name];

        if (!componentData) {
          componentResults.push({
            component: detail.name,
            status: 'missing',
            expectedChecksum: detail.checksum,
            error: 'Component data not found in archive',
          });
          continue;
        }

        const componentBuffer = Buffer.from(componentData, 'base64');
        const componentChecksum = calculateChecksum(componentBuffer);

        if (componentChecksum !== detail.checksum) {
          componentResults.push({
            component: detail.name,
            status: 'corrupted',
            expectedChecksum: detail.checksum,
            actualChecksum: componentChecksum,
            error: 'Component checksum mismatch',
          });
        } else {
          componentResults.push({
            component: detail.name,
            status: 'valid',
            expectedChecksum: detail.checksum,
            actualChecksum: componentChecksum,
          });
        }
      }

      const allValid = componentResults.every((r) => r.status === 'valid');

      logger.info('Backup verification completed', {
        backupId,
        valid: allValid,
        components: componentResults.length,
      });

      return {
        backupId,
        status: allValid ? 'valid' : 'corrupted',
        valid: allValid,
        verifiedAt: new Date(),
        components: componentResults,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Backup verification failed', {
        backupId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        backupId,
        status: 'invalid',
        valid: false,
        verifiedAt: new Date(),
        components: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Apply retention policy and cleanup old backups
   */
  async applyRetentionPolicy(): Promise<CleanupResult> {
    const startTime = Date.now();
    const deletedBackups: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    logger.info('Applying retention policy', { retention: this.config.retention });

    const now = new Date();
    const manifests = await this.listBackups();

    // Group backups by type
    const daily = manifests.filter((m) => m.type === 'daily');
    const weekly = manifests.filter((m) => m.type === 'weekly');
    const monthly = manifests.filter((m) => m.type === 'monthly');
    const manual = manifests.filter((m) => m.type === 'manual');

    // Calculate cutoff dates
    const dailyCutoff = new Date(now);
    dailyCutoff.setDate(dailyCutoff.getDate() - this.config.retention.daily);

    const weeklyCutoff = new Date(now);
    weeklyCutoff.setDate(weeklyCutoff.getDate() - this.config.retention.weekly * 7);

    const monthlyCutoff = new Date(now);
    monthlyCutoff.setMonth(monthlyCutoff.getMonth() - this.config.retention.monthly);

    // Identify backups to delete
    const toDelete: BackupManifest[] = [
      ...daily.filter((m) => new Date(m.timestamp) < dailyCutoff),
      ...weekly.filter((m) => new Date(m.timestamp) < weeklyCutoff),
      ...monthly.filter((m) => new Date(m.timestamp) < monthlyCutoff),
      // Never automatically delete manual backups
    ];

    // Delete old backups
    for (const manifest of toDelete) {
      try {
        await this.deleteBackup(manifest.id);
        deletedBackups.push(manifest.id);
        freedBytes += manifest.size;
      } catch (error) {
        errors.push(`Failed to delete ${manifest.id}: ${String(error)}`);
      }
    }

    const result: CleanupResult = {
      deletedCount: deletedBackups.length,
      freedBytes,
      deletedBackups,
      durationMs: Date.now() - startTime,
      errors,
    };

    logger.info('Retention policy applied', {
      deleted: deletedBackups.length,
      freedBytes,
      errors: errors.length,
    });

    return result;
  }

  /**
   * Get encryption configuration
   */
  getEncryptionConfig(): EncryptionConfig {
    return { ...this.config.encryption };
  }

  /**
   * Download and decrypt a backup for restore operations
   */
  async downloadBackup(backupId: string): Promise<Buffer> {
    const manifest = await this.loadManifest(backupId);

    const data = await this.storage.download(manifest.storagePath);

    // Decrypt if needed
    let decrypted = data;
    if (manifest.encrypted) {
      if (!this.config.encryption.key) {
        throw new BackupError(
          'Encryption key required to download encrypted backup',
          'downloadBackup',
          backupId
        );
      }
      decrypted = decryptData(data, this.config.encryption.key);
    }

    // Decompress
    return gunzip(decrypted);
  }

  /**
   * Get backup manifest by ID
   */
  async getManifest(backupId: string): Promise<BackupManifest> {
    return this.loadManifest(backupId);
  }
}

/**
 * Create a BackupManager instance
 */
export function createBackupManager(config?: Partial<BackupConfig>): BackupManager {
  return new BackupManager(config);
}
