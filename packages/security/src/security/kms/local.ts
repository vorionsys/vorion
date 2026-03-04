/**
 * Local KMS Provider (Development Only)
 *
 * Implementation of KMSProvider interface for local development and testing.
 * Uses local file or environment variables for key storage.
 *
 * WARNING: This provider is NOT suitable for production use!
 * It provides minimal security and is intended only for development
 * and testing environments.
 *
 * @packageDocumentation
 * @module security/kms/local
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import { getSecurityMode, isProductionGrade } from '../../common/security-mode.js';
import type {
  KMSProvider,
  KeyMetadata,
  DataKey,
  KMSEncryptOptions,
  KMSDecryptOptions,
  GenerateDataKeyOptions,
  EncryptResult,
  DecryptResult,
  KeyRotationResult,
  KeyRotationSchedule,
  ListKeysOptions,
  LocalKMSConfig,
  KMSAuditEntry,
  KMSAuditCallback,
  CachedDataKey,
} from './types.js';
import { KeyStatus, KMSOperation, KMSErrorCode } from './types.js';

const logger = createLogger({ component: 'local-kms-provider' });

// =============================================================================
// Constants
// =============================================================================

/** Default key length in bytes */
const DEFAULT_KEY_LENGTH = 32;

/** Algorithm for local encryption */
const LOCAL_ALGORITHM = 'aes-256-gcm';

/** IV length for AES-GCM */
const IV_LENGTH = 12;

/** Auth tag length */
const AUTH_TAG_LENGTH = 16;

/** Warning message for production use */
const PRODUCTION_WARNING = `
================================================================================
WARNING: Local KMS Provider is NOT suitable for production use!

This provider stores encryption keys locally and provides minimal security.
For production deployments, use AWS KMS or HashiCorp Vault.

Current environment: ${getSecurityMode()}
================================================================================
`;

// =============================================================================
// Errors
// =============================================================================

/**
 * Local KMS specific error
 */
export class LocalKMSError extends VorionError {
  declare code: string;
  override statusCode = 500;

  constructor(
    message: string,
    code: string = KMSErrorCode.ENCRYPTION_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.name = 'LocalKMSError';
    this.code = code;
  }
}

// =============================================================================
// Key Version Management
// =============================================================================

interface LocalKeyVersion {
  version: number;
  key: Buffer;
  createdAt: Date;
  status: KeyStatus;
}

interface LocalKeyStore {
  keyId: string;
  versions: LocalKeyVersion[];
  currentVersion: number;
  createdAt: Date;
  rotatedAt?: Date;
}

// =============================================================================
// Data Key Cache
// =============================================================================

class LocalDataKeyCache {
  private readonly cache: Map<string, CachedDataKey> = new Map();
  private readonly ttlMs: number;
  private readonly maxUsages: number;

  constructor(ttlSeconds: number = 300, maxUsages: number = 1000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxUsages = maxUsages;
  }

  get(cacheKey: string): DataKey | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt.getTime()) {
      this.delete(cacheKey);
      return null;
    }

    if (entry.maxUsages && entry.usageCount >= entry.maxUsages) {
      this.delete(cacheKey);
      return null;
    }

    entry.usageCount++;
    return entry.dataKey;
  }

  set(cacheKey: string, dataKey: DataKey): void {
    const now = new Date();
    this.cache.set(cacheKey, {
      dataKey,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      usageCount: 0,
      maxUsages: this.maxUsages,
    });
  }

  delete(cacheKey: string): void {
    const entry = this.cache.get(cacheKey);
    if (entry) {
      entry.dataKey.plaintext.fill(0);
      this.cache.delete(cacheKey);
    }
  }

  clear(): void {
    for (const [key] of this.cache) {
      this.delete(key);
    }
  }

  stats(): { size: number; ttlMs: number; maxUsages: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs, maxUsages: this.maxUsages };
  }
}

// =============================================================================
// Local KMS Provider
// =============================================================================

/**
 * Local KMS Provider for development and testing
 *
 * WARNING: This provider is NOT suitable for production use!
 *
 * @example
 * ```typescript
 * const provider = new LocalKMSProvider({
 *   provider: 'local',
 *   keyEnvVar: 'VORION_LOCAL_KMS_KEY',
 * });
 *
 * await provider.initialize();
 *
 * // Generate data key for envelope encryption
 * const dataKey = await provider.generateDataKey();
 * ```
 */
export class LocalKMSProvider implements KMSProvider {
  readonly name = 'local';

  private readonly config: LocalKMSConfig;
  private keyStore: LocalKeyStore | null = null;
  private dataKeyCache: LocalDataKeyCache | null = null;
  private readonly auditCallbacks: KMSAuditCallback[] = [];
  private initialized = false;

  constructor(config: LocalKMSConfig) {
    this.config = {
      keyEnvVar: 'VORION_LOCAL_KMS_KEY',
      enableCaching: true,
      cacheTtlSeconds: 300,
      maxCacheUsages: 1000,
      enableAuditLogging: true,
      suppressWarnings: false,
      ...config,
    };
  }

  /**
   * Initialize the local KMS provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('LocalKMSProvider already initialized');
      return;
    }

    // Check for production use
    if (isProductionGrade() && !this.config.suppressWarnings) {
      logger.error(PRODUCTION_WARNING);
      throw new LocalKMSError(
        'Local KMS provider cannot be used in production. Use AWS KMS or HashiCorp Vault.',
        KMSErrorCode.INVALID_CONFIG
      );
    }

    // Log warning in non-production
    if (!this.config.suppressWarnings) {
      logger.warn(PRODUCTION_WARNING);
    }

    logger.info('Initializing Local KMS provider (development only)');

    // Load or generate master key
    await this.loadOrGenerateMasterKey();

    // Initialize cache
    if (this.config.enableCaching) {
      this.dataKeyCache = new LocalDataKeyCache(
        this.config.cacheTtlSeconds,
        this.config.maxCacheUsages
      );
    }

    this.initialized = true;
    logger.info('Local KMS provider initialized (development only)');
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Local KMS provider');

    if (this.dataKeyCache) {
      this.dataKeyCache.clear();
      this.dataKeyCache = null;
    }

    // Clear key material
    if (this.keyStore) {
      for (const version of this.keyStore.versions) {
        version.key.fill(0);
      }
      this.keyStore = null;
    }

    this.initialized = false;
    logger.info('Local KMS provider shutdown complete');
  }

  /**
   * Register an audit callback
   */
  onAudit(callback: KMSAuditCallback): void {
    this.auditCallbacks.push(callback);
  }

  /**
   * Emit audit event
   */
  private async emitAudit(entry: Omit<KMSAuditEntry, 'id' | 'timestamp' | 'provider'>): Promise<void> {
    if (!this.config.enableAuditLogging) return;

    const fullEntry: KMSAuditEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      provider: 'local',
      ...entry,
    };

    for (const callback of this.auditCallbacks) {
      try {
        await callback(fullEntry);
      } catch (error) {
        logger.error({ error, entryId: fullEntry.id }, 'KMS audit callback failed');
      }
    }
  }

  /**
   * Check provider health
   */
  async healthCheck(): Promise<boolean> {
    return this.initialized && this.keyStore !== null;
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.keyStore) {
      throw new LocalKMSError(
        'Local KMS provider not initialized. Call initialize() first.',
        KMSErrorCode.NOT_INITIALIZED
      );
    }
  }

  /**
   * Load or generate the master key
   */
  private async loadOrGenerateMasterKey(): Promise<void> {
    let masterKey: Buffer | null = null;

    // Try to load from config
    if (this.config.masterKey) {
      masterKey = Buffer.from(this.config.masterKey, 'base64');
    }

    // Try to load from file
    if (!masterKey && this.config.keyFile) {
      try {
        if (fs.existsSync(this.config.keyFile)) {
          const fileContent = fs.readFileSync(this.config.keyFile, 'utf-8').trim();
          masterKey = Buffer.from(fileContent, 'base64');
          logger.info({ keyFile: this.config.keyFile }, 'Loaded master key from file');
        }
      } catch (error) {
        logger.warn({ error, keyFile: this.config.keyFile }, 'Failed to load key from file');
      }
    }

    // Try to load from environment variable
    if (!masterKey && this.config.keyEnvVar) {
      const envValue = process.env[this.config.keyEnvVar];
      if (envValue) {
        masterKey = Buffer.from(envValue, 'base64');
        logger.info({ keyEnvVar: this.config.keyEnvVar }, 'Loaded master key from environment');
      }
    }

    // Generate new key if not found
    if (!masterKey) {
      masterKey = crypto.randomBytes(DEFAULT_KEY_LENGTH);
      logger.warn('Generated ephemeral master key. Key will be lost on restart!');

      // Save to file if configured
      if (this.config.keyFile) {
        try {
          const dir = path.dirname(this.config.keyFile);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(this.config.keyFile, masterKey.toString('base64'), {
            mode: 0o600, // Owner read/write only
          });
          logger.info({ keyFile: this.config.keyFile }, 'Saved generated master key to file');
        } catch (error) {
          logger.warn({ error, keyFile: this.config.keyFile }, 'Failed to save key to file');
        }
      }
    }

    // Validate key length
    if (masterKey.length < DEFAULT_KEY_LENGTH) {
      throw new LocalKMSError(
        `Master key too short: ${masterKey.length} bytes (minimum: ${DEFAULT_KEY_LENGTH})`,
        KMSErrorCode.INVALID_CONFIG
      );
    }

    // Initialize key store
    this.keyStore = {
      keyId: 'local-master-key',
      versions: [
        {
          version: 1,
          key: masterKey,
          createdAt: new Date(),
          status: KeyStatus.ENABLED,
        },
      ],
      currentVersion: 1,
      createdAt: new Date(),
    };
  }

  /**
   * Get the current master key
   */
  private getCurrentKey(): Buffer {
    if (!this.keyStore) {
      throw new LocalKMSError('Key store not initialized', KMSErrorCode.NOT_INITIALIZED);
    }

    const currentKeyVersion = this.keyStore.versions.find(
      (v) => v.version === this.keyStore!.currentVersion
    );

    if (!currentKeyVersion) {
      throw new LocalKMSError('Current key version not found', KMSErrorCode.KEY_NOT_FOUND);
    }

    return currentKeyVersion.key;
  }

  /**
   * Get a specific key version
   */
  private getKeyVersion(version: number): Buffer {
    if (!this.keyStore) {
      throw new LocalKMSError('Key store not initialized', KMSErrorCode.NOT_INITIALIZED);
    }

    const keyVersion = this.keyStore.versions.find((v) => v.version === version);

    if (!keyVersion) {
      throw new LocalKMSError(`Key version ${version} not found`, KMSErrorCode.KEY_NOT_FOUND);
    }

    return keyVersion.key;
  }

  /**
   * Get key metadata
   */
  async getKey(keyId: string): Promise<KeyMetadata | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    if (keyId !== this.keyStore!.keyId && keyId !== 'default') {
      await this.emitAudit({
        operation: KMSOperation.GET_KEY,
        keyId,
        success: false,
        error: 'Key not found',
        durationMs: performance.now() - startTime,
      });
      return null;
    }

    const metadata: KeyMetadata = {
      id: this.keyStore!.keyId,
      arn: `local://${this.keyStore!.keyId}`,
      version: this.keyStore!.currentVersion,
      createdAt: this.keyStore!.createdAt,
      rotatedAt: this.keyStore!.rotatedAt,
      status: KeyStatus.ENABLED,
      description: 'Local development key (NOT for production)',
      alias: 'local-master-key',
      keyType: 'symmetric',
      keyUsage: 'encrypt_decrypt',
      providerMetadata: {
        isLocal: true,
        versionCount: this.keyStore!.versions.length,
      },
    };

    await this.emitAudit({
      operation: KMSOperation.GET_KEY,
      keyId: metadata.id,
      keyVersion: metadata.version,
      success: true,
      durationMs: performance.now() - startTime,
    });

    return metadata;
  }

  /**
   * List all keys
   */
  async listKeys(_options?: ListKeysOptions): Promise<KeyMetadata[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    const metadata = await this.getKey(this.keyStore!.keyId);

    await this.emitAudit({
      operation: KMSOperation.LIST_KEYS,
      success: true,
      durationMs: performance.now() - startTime,
    });

    return metadata ? [metadata] : [];
  }

  /**
   * Encrypt data
   */
  async encrypt(plaintext: Buffer, options?: KMSEncryptOptions): Promise<EncryptResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const key = this.getCurrentKey();
      const iv = crypto.randomBytes(IV_LENGTH);

      // Build AAD from encryption context
      const aad = options?.encryptionContext
        ? Buffer.from(JSON.stringify(options.encryptionContext))
        : Buffer.alloc(0);

      const cipher = crypto.createCipheriv(LOCAL_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      cipher.setAAD(aad);

      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: version (4 bytes) + iv (12 bytes) + authTag (16 bytes) + ciphertext
      const versionBuffer = Buffer.alloc(4);
      versionBuffer.writeUInt32BE(this.keyStore!.currentVersion);

      const ciphertext = Buffer.concat([versionBuffer, iv, authTag, encrypted]);

      const result: EncryptResult = {
        ciphertext,
        keyId: this.keyStore!.keyId,
        keyVersion: this.keyStore!.currentVersion,
        algorithm: LOCAL_ALGORITHM,
      };

      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId: result.keyId,
        keyVersion: result.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId: this.keyStore?.keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw new LocalKMSError(
        `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.ENCRYPTION_FAILED
      );
    }
  }

  /**
   * Decrypt data
   */
  async decrypt(ciphertext: Buffer, options?: KMSDecryptOptions): Promise<DecryptResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      // Parse ciphertext: version (4 bytes) + iv (12 bytes) + authTag (16 bytes) + encrypted
      if (ciphertext.length < 4 + IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new LocalKMSError('Invalid ciphertext format', KMSErrorCode.INVALID_CIPHERTEXT);
      }

      const version = ciphertext.readUInt32BE(0);
      const iv = ciphertext.subarray(4, 4 + IV_LENGTH);
      const authTag = ciphertext.subarray(4 + IV_LENGTH, 4 + IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = ciphertext.subarray(4 + IV_LENGTH + AUTH_TAG_LENGTH);

      const key = this.getKeyVersion(version);

      // Build AAD from encryption context
      const aad = options?.encryptionContext
        ? Buffer.from(JSON.stringify(options.encryptionContext))
        : Buffer.alloc(0);

      const decipher = crypto.createDecipheriv(LOCAL_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      const result: DecryptResult = {
        plaintext,
        keyId: this.keyStore!.keyId,
        keyVersion: version,
      };

      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId: result.keyId,
        keyVersion: result.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId: this.keyStore?.keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      if (error instanceof LocalKMSError) throw error;

      throw new LocalKMSError(
        `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.DECRYPTION_FAILED
      );
    }
  }

  /**
   * Generate a data key for envelope encryption
   */
  async generateDataKey(options?: GenerateDataKeyOptions): Promise<DataKey> {
    this.ensureInitialized();
    const startTime = performance.now();
    const keyLength = options?.keyLength ?? DEFAULT_KEY_LENGTH;

    // Build cache key
    const cacheKey = `datakey:${keyLength}:${JSON.stringify(options?.encryptionContext ?? {})}`;

    // Check cache
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug('Using cached data key');
        await this.emitAudit({
          operation: KMSOperation.GENERATE_DATA_KEY,
          keyId: this.keyStore?.keyId,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });
        return cached;
      }
    }

    try {
      // Generate random data key
      const plaintext = crypto.randomBytes(keyLength);

      // Encrypt the data key with the master key
      const encryptResult = await this.encrypt(plaintext, {
        encryptionContext: options?.encryptionContext,
      });

      const dataKey: DataKey = {
        plaintext,
        ciphertext: encryptResult.ciphertext,
        keyId: this.keyStore!.keyId,
        keyVersion: this.keyStore!.currentVersion,
        algorithm: LOCAL_ALGORITHM,
        generatedAt: new Date(),
        expiresAt: this.config.cacheTtlSeconds
          ? new Date(Date.now() + this.config.cacheTtlSeconds * 1000)
          : undefined,
      };

      // Cache the data key
      if (this.dataKeyCache) {
        this.dataKeyCache.set(cacheKey, dataKey);
      }

      await this.emitAudit({
        operation: KMSOperation.GENERATE_DATA_KEY,
        keyId: dataKey.keyId,
        keyVersion: dataKey.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return dataKey;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.GENERATE_DATA_KEY,
        keyId: this.keyStore?.keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw new LocalKMSError(
        `Failed to generate data key: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.ENCRYPTION_FAILED
      );
    }
  }

  /**
   * Decrypt a data key
   */
  async decryptDataKey(encryptedDataKey: Buffer, options?: KMSDecryptOptions): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();

    // Check cache
    const cacheKey = `decrypt:${encryptedDataKey.toString('base64')}`;
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug('Using cached decrypted data key');
        await this.emitAudit({
          operation: KMSOperation.DECRYPT_DATA_KEY,
          keyId: this.keyStore?.keyId,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });
        return Buffer.from(cached.plaintext);
      }
    }

    try {
      const result = await this.decrypt(encryptedDataKey, options);

      // Cache the decrypted data key
      if (this.dataKeyCache) {
        const dataKey: DataKey = {
          plaintext: Buffer.from(result.plaintext),
          ciphertext: encryptedDataKey,
          keyId: result.keyId,
          keyVersion: result.keyVersion,
          algorithm: LOCAL_ALGORITHM,
          generatedAt: new Date(),
        };
        this.dataKeyCache.set(cacheKey, dataKey);
      }

      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId: result.keyId,
        keyVersion: result.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return result.plaintext;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId: this.keyStore?.keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw error;
    }
  }

  /**
   * Rotate the key
   */
  async rotateKey(_keyId: string): Promise<KeyRotationResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const previousVersion = this.keyStore!.currentVersion;

      // Generate new key version
      const newKey = crypto.randomBytes(DEFAULT_KEY_LENGTH);
      const newVersion = previousVersion + 1;

      this.keyStore!.versions.push({
        version: newVersion,
        key: newKey,
        createdAt: new Date(),
        status: KeyStatus.ENABLED,
      });

      this.keyStore!.currentVersion = newVersion;
      this.keyStore!.rotatedAt = new Date();

      // Clear cache
      if (this.dataKeyCache) {
        this.dataKeyCache.clear();
      }

      const result: KeyRotationResult = {
        keyId: this.keyStore!.keyId,
        previousVersion,
        newVersion,
        rotatedAt: new Date(),
      };

      await this.emitAudit({
        operation: KMSOperation.ROTATE_KEY,
        keyId: result.keyId,
        keyVersion: newVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      logger.info({ previousVersion, newVersion }, 'Local key rotated');

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.ROTATE_KEY,
        keyId: this.keyStore?.keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw new LocalKMSError(
        `Key rotation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.ROTATION_FAILED
      );
    }
  }

  /**
   * Get rotation schedule (not supported for local provider)
   */
  async getRotationSchedule(_keyId: string): Promise<KeyRotationSchedule> {
    return {
      enabled: false,
      rotationPeriodDays: undefined,
      nextRotationTime: undefined,
      lastRotationTime: this.keyStore?.rotatedAt,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number; maxUsages: number } | null {
    return this.dataKeyCache?.stats() ?? null;
  }
}
