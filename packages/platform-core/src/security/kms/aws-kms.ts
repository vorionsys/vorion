/**
 * AWS KMS Provider
 *
 * Implementation of KMSProvider interface for AWS Key Management Service.
 * Supports:
 * - Envelope encryption with data keys
 * - Automatic key rotation
 * - Caching of decrypted data keys with TTL
 * - Audit logging of all operations
 *
 * @packageDocumentation
 * @module security/kms/aws-kms
 */

import {
  KMSClient,
  EncryptCommand,
  DecryptCommand,
  GenerateDataKeyCommand,
  DescribeKeyCommand,
  ListKeysCommand,
  EnableKeyRotationCommand,
  DisableKeyRotationCommand,
  GetKeyRotationStatusCommand,
  KMSServiceException,
  type KeyMetadata as AWSKeyMetadata,
} from '@aws-sdk/client-kms';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import type {
  KMSProvider,
  KeyMetadata,
  DataKey,
  CachedDataKey,
  KMSEncryptOptions,
  KMSDecryptOptions,
  GenerateDataKeyOptions,
  EncryptResult,
  DecryptResult,
  KeyRotationResult,
  KeyRotationSchedule,
  ListKeysOptions,
  AWSKMSConfig,
  KMSAuditEntry,
  KMSAuditCallback,
} from './types.js';
import { KeyStatus, KMSOperation, KMSErrorCode } from './types.js';

const logger = createLogger({ component: 'aws-kms-provider' });

// =============================================================================
// Errors
// =============================================================================

/**
 * AWS KMS specific error
 */
export class AWSKMSError extends VorionError {
  declare code: string;
  override statusCode = 500;

  constructor(
    message: string,
    code: string = KMSErrorCode.ENCRYPTION_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.name = 'AWSKMSError';
    this.code = code;
  }
}

// =============================================================================
// Data Key Cache
// =============================================================================

/**
 * Cache for decrypted data keys with TTL and usage limits
 */
class DataKeyCache {
  private readonly cache: Map<string, CachedDataKey> = new Map();
  private readonly ttlMs: number;
  private readonly maxUsages: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlSeconds: number = 300, maxUsages: number = 1000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxUsages = maxUsages;
  }

  /**
   * Start the cache cleanup interval
   */
  start(): void {
    if (this.cleanupInterval) return;

    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60_000);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cache cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get a cached data key
   */
  get(cacheKey: string): DataKey | null {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt.getTime()) {
      this.delete(cacheKey);
      return null;
    }

    // Check usage limit
    if (entry.maxUsages && entry.usageCount >= entry.maxUsages) {
      this.delete(cacheKey);
      return null;
    }

    // Increment usage count
    entry.usageCount++;

    return entry.dataKey;
  }

  /**
   * Set a cached data key
   */
  set(cacheKey: string, dataKey: DataKey): void {
    const now = new Date();
    const entry: CachedDataKey = {
      dataKey,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      usageCount: 0,
      maxUsages: this.maxUsages,
    };

    this.cache.set(cacheKey, entry);
  }

  /**
   * Delete a cached entry and clear sensitive data
   */
  delete(cacheKey: string): void {
    const entry = this.cache.get(cacheKey);
    if (entry) {
      // Clear plaintext key from memory
      entry.dataKey.plaintext.fill(0);
      this.cache.delete(cacheKey);
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    for (const [key] of this.cache) {
      this.delete(key);
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt.getTime()) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.debug({ expiredCount: expiredKeys.length }, 'Cleaned up expired data key cache entries');
    }
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; ttlMs: number; maxUsages: number } {
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs,
      maxUsages: this.maxUsages,
    };
  }
}

// =============================================================================
// AWS KMS Provider
// =============================================================================

/**
 * AWS KMS Provider implementation
 *
 * @example
 * ```typescript
 * const provider = new AWSKMSProvider({
 *   provider: 'aws',
 *   region: 'us-west-2',
 *   keyArn: 'arn:aws:kms:us-west-2:123456789:key/abc-123',
 *   enableCaching: true,
 *   cacheTtlSeconds: 300,
 * });
 *
 * await provider.initialize();
 *
 * // Generate data key for envelope encryption
 * const dataKey = await provider.generateDataKey();
 *
 * // Use plaintext to encrypt data locally
 * const encrypted = localEncrypt(data, dataKey.plaintext);
 *
 * // Store encrypted data key with the encrypted data
 * store(encrypted, dataKey.ciphertext);
 *
 * // Clear plaintext from memory
 * dataKey.plaintext.fill(0);
 * ```
 */
export class AWSKMSProvider implements KMSProvider {
  readonly name = 'aws';

  private readonly config: AWSKMSConfig;
  private client: KMSClient | null = null;
  private dataKeyCache: DataKeyCache | null = null;
  private readonly auditCallbacks: KMSAuditCallback[] = [];
  private initialized = false;

  constructor(config: AWSKMSConfig) {
    this.config = {
      enableCaching: true,
      cacheTtlSeconds: 300,
      maxCacheUsages: 1000,
      enableAuditLogging: true,
      ...config,
    };
  }

  /**
   * Initialize the AWS KMS provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('AWSKMSProvider already initialized');
      return;
    }

    logger.info({ region: this.config.region, keyArn: this.config.keyArn }, 'Initializing AWS KMS provider');

    // Create KMS client
    const clientConfig: ConstructorParameters<typeof KMSClient>[0] = {};

    if (this.config.region) {
      clientConfig.region = this.config.region;
    }

    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
    }

    if (this.config.accessKeyId && this.config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      };
    }

    this.client = new KMSClient(clientConfig);

    // Initialize cache if enabled
    if (this.config.enableCaching) {
      this.dataKeyCache = new DataKeyCache(
        this.config.cacheTtlSeconds,
        this.config.maxCacheUsages
      );
      this.dataKeyCache.start();
    }

    // Verify connectivity by describing the key
    try {
      const keyMetadata = await this.getKey(this.config.keyArn);
      if (!keyMetadata) {
        throw new AWSKMSError(
          `Key not found: ${this.config.keyArn}`,
          KMSErrorCode.KEY_NOT_FOUND
        );
      }

      if (keyMetadata.status !== KeyStatus.ENABLED) {
        throw new AWSKMSError(
          `Key is not enabled: ${this.config.keyArn} (status: ${keyMetadata.status})`,
          KMSErrorCode.KEY_DISABLED
        );
      }

      logger.info(
        { keyId: keyMetadata.id, status: keyMetadata.status },
        'AWS KMS provider initialized successfully'
      );
    } catch (error) {
      if (error instanceof AWSKMSError) {
        throw error;
      }
      throw new AWSKMSError(
        `Failed to initialize AWS KMS provider: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.CONNECTION_FAILED,
        { keyArn: this.config.keyArn }
      );
    }

    this.initialized = true;
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down AWS KMS provider');

    if (this.dataKeyCache) {
      this.dataKeyCache.stop();
      this.dataKeyCache.clear();
      this.dataKeyCache = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.initialized = false;
    logger.info('AWS KMS provider shutdown complete');
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
      provider: 'aws',
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
    if (!this.initialized || !this.client) {
      return false;
    }

    try {
      await this.client.send(
        new DescribeKeyCommand({ KeyId: this.config.keyArn })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.client) {
      throw new AWSKMSError(
        'AWS KMS provider not initialized. Call initialize() first.',
        KMSErrorCode.NOT_INITIALIZED
      );
    }
  }

  /**
   * Get key metadata
   */
  async getKey(keyId: string): Promise<KeyMetadata | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const response = await this.client!.send(
        new DescribeKeyCommand({ KeyId: keyId })
      );

      if (!response.KeyMetadata) {
        return null;
      }

      const metadata = this.mapAWSKeyMetadata(response.KeyMetadata);

      await this.emitAudit({
        operation: KMSOperation.GET_KEY,
        keyId: metadata.id,
        keyVersion: metadata.version,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return metadata;
    } catch (error) {
      const durationMs = performance.now() - startTime;

      if (error instanceof KMSServiceException && error.name === 'NotFoundException') {
        await this.emitAudit({
          operation: KMSOperation.GET_KEY,
          keyId,
          success: false,
          error: 'Key not found',
          durationMs,
        });
        return null;
      }

      await this.emitAudit({
        operation: KMSOperation.GET_KEY,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      });

      throw this.wrapError(error, 'Failed to get key metadata');
    }
  }

  /**
   * List all keys
   */
  async listKeys(options?: ListKeysOptions): Promise<KeyMetadata[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const response = await this.client!.send(
        new ListKeysCommand({
          Limit: options?.limit,
          Marker: options?.nextToken,
        })
      );

      const keys: KeyMetadata[] = [];

      for (const key of response.Keys ?? []) {
        if (key.KeyId) {
          const metadata = await this.getKey(key.KeyId);
          if (metadata) {
            if (!options?.status || metadata.status === options.status) {
              keys.push(metadata);
            }
          }
        }
      }

      await this.emitAudit({
        operation: KMSOperation.LIST_KEYS,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return keys;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.LIST_KEYS,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Failed to list keys');
    }
  }

  /**
   * Encrypt data
   */
  async encrypt(plaintext: Buffer, options?: KMSEncryptOptions): Promise<EncryptResult> {
    this.ensureInitialized();
    const startTime = performance.now();
    const keyId = options?.keyId ?? this.config.keyArn;

    try {
      const response = await this.client!.send(
        new EncryptCommand({
          KeyId: keyId,
          Plaintext: plaintext,
          EncryptionContext: options?.encryptionContext,
          EncryptionAlgorithm: options?.algorithm as 'SYMMETRIC_DEFAULT' | 'RSAES_OAEP_SHA_1' | 'RSAES_OAEP_SHA_256' | 'SM2PKE' | undefined,
        })
      );

      if (!response.CiphertextBlob) {
        throw new AWSKMSError('No ciphertext returned from KMS', KMSErrorCode.ENCRYPTION_FAILED);
      }

      const result: EncryptResult = {
        ciphertext: Buffer.from(response.CiphertextBlob),
        keyId: response.KeyId ?? keyId,
        keyVersion: 0, // AWS doesn't return version in encrypt response
        algorithm: response.EncryptionAlgorithm ?? 'SYMMETRIC_DEFAULT',
      };

      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId: result.keyId,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Encryption failed');
    }
  }

  /**
   * Decrypt data
   */
  async decrypt(ciphertext: Buffer, options?: KMSDecryptOptions): Promise<DecryptResult> {
    this.ensureInitialized();
    const startTime = performance.now();
    const keyId = options?.keyId ?? this.config.keyArn;

    try {
      const response = await this.client!.send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: ciphertext,
          EncryptionContext: options?.encryptionContext,
          EncryptionAlgorithm: options?.algorithm as 'SYMMETRIC_DEFAULT' | 'RSAES_OAEP_SHA_1' | 'RSAES_OAEP_SHA_256' | 'SM2PKE' | undefined,
        })
      );

      if (!response.Plaintext) {
        throw new AWSKMSError('No plaintext returned from KMS', KMSErrorCode.DECRYPTION_FAILED);
      }

      const result: DecryptResult = {
        plaintext: Buffer.from(response.Plaintext),
        keyId: response.KeyId ?? keyId,
        keyVersion: 0, // AWS doesn't expose version directly
      };

      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId: result.keyId,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Decryption failed');
    }
  }

  /**
   * Generate a data key for envelope encryption
   */
  async generateDataKey(options?: GenerateDataKeyOptions): Promise<DataKey> {
    this.ensureInitialized();
    const startTime = performance.now();
    const keyId = options?.keyId ?? this.config.keyArn;
    const keyLength = options?.keyLength ?? 32;

    // Build cache key
    const cacheKey = this.buildCacheKey(keyId, options?.encryptionContext);

    // Check cache first
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug({ keyId }, 'Using cached data key');

        await this.emitAudit({
          operation: KMSOperation.GENERATE_DATA_KEY,
          keyId,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });

        return cached;
      }
    }

    try {
      const response = await this.client!.send(
        new GenerateDataKeyCommand({
          KeyId: keyId,
          NumberOfBytes: keyLength,
          EncryptionContext: options?.encryptionContext,
        })
      );

      if (!response.Plaintext || !response.CiphertextBlob) {
        throw new AWSKMSError(
          'Invalid response from GenerateDataKey',
          KMSErrorCode.ENCRYPTION_FAILED
        );
      }

      const dataKey: DataKey = {
        plaintext: Buffer.from(response.Plaintext),
        ciphertext: Buffer.from(response.CiphertextBlob),
        keyId: response.KeyId ?? keyId,
        keyVersion: 0,
        algorithm: 'AES_256',
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
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return dataKey;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.GENERATE_DATA_KEY,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Failed to generate data key');
    }
  }

  /**
   * Decrypt a data key
   */
  async decryptDataKey(encryptedDataKey: Buffer, options?: KMSDecryptOptions): Promise<Buffer> {
    this.ensureInitialized();
    const startTime = performance.now();
    const keyId = options?.keyId ?? this.config.keyArn;

    // Build cache key for decrypted data keys
    const cacheKey = `decrypt:${encryptedDataKey.toString('base64')}:${JSON.stringify(options?.encryptionContext ?? {})}`;

    // Check cache
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug({ keyId }, 'Using cached decrypted data key');

        await this.emitAudit({
          operation: KMSOperation.DECRYPT_DATA_KEY,
          keyId,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });

        // Return a copy to prevent external modification
        return Buffer.from(cached.plaintext);
      }
    }

    try {
      const response = await this.client!.send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: encryptedDataKey,
          EncryptionContext: options?.encryptionContext,
        })
      );

      if (!response.Plaintext) {
        throw new AWSKMSError('No plaintext returned from KMS', KMSErrorCode.DECRYPTION_FAILED);
      }

      const plaintext = Buffer.from(response.Plaintext);

      // Cache the decrypted data key
      if (this.dataKeyCache) {
        const dataKey: DataKey = {
          plaintext: Buffer.from(plaintext), // Copy for cache
          ciphertext: encryptedDataKey,
          keyId: response.KeyId ?? keyId,
          keyVersion: 0,
          algorithm: 'AES_256',
          generatedAt: new Date(),
        };
        this.dataKeyCache.set(cacheKey, dataKey);
      }

      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId: response.KeyId ?? keyId,
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return plaintext;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Failed to decrypt data key');
    }
  }

  /**
   * Rotate a key
   *
   * Note: AWS KMS automatically manages key rotation. This method
   * enables automatic rotation on the key.
   */
  async rotateKey(keyId: string): Promise<KeyRotationResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      // Get current key info
      const keyMetadata = await this.getKey(keyId);
      if (!keyMetadata) {
        throw new AWSKMSError(`Key not found: ${keyId}`, KMSErrorCode.KEY_NOT_FOUND);
      }

      // Enable rotation (AWS handles actual rotation)
      await this.client!.send(
        new EnableKeyRotationCommand({ KeyId: keyId })
      );

      const result: KeyRotationResult = {
        keyId: keyMetadata.id,
        previousVersion: keyMetadata.version,
        newVersion: keyMetadata.version + 1,
        rotatedAt: new Date(),
      };

      // Clear cached data keys since we're rotating
      if (this.dataKeyCache) {
        this.dataKeyCache.clear();
      }

      await this.emitAudit({
        operation: KMSOperation.ROTATE_KEY,
        keyId,
        keyVersion: result.newVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      logger.info(
        { keyId, previousVersion: result.previousVersion, newVersion: result.newVersion },
        'Key rotation enabled'
      );

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.ROTATE_KEY,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Failed to rotate key');
    }
  }

  /**
   * Get rotation schedule for a key
   */
  async getRotationSchedule(keyId: string): Promise<KeyRotationSchedule> {
    this.ensureInitialized();

    try {
      const response = await this.client!.send(
        new GetKeyRotationStatusCommand({ KeyId: keyId })
      );

      return {
        enabled: response.KeyRotationEnabled ?? false,
        rotationPeriodDays: response.RotationPeriodInDays,
        nextRotationTime: response.NextRotationDate,
        lastRotationTime: undefined, // AWS doesn't provide this directly
      };
    } catch (error) {
      throw this.wrapError(error, 'Failed to get rotation schedule');
    }
  }

  /**
   * Enable automatic key rotation
   */
  async enableAutoRotation(keyId: string, rotationPeriodDays?: number): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.send(
        new EnableKeyRotationCommand({
          KeyId: keyId,
          RotationPeriodInDays: rotationPeriodDays,
        })
      );

      logger.info({ keyId, rotationPeriodDays }, 'Auto rotation enabled');
    } catch (error) {
      throw this.wrapError(error, 'Failed to enable auto rotation');
    }
  }

  /**
   * Disable automatic key rotation
   */
  async disableAutoRotation(keyId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.send(
        new DisableKeyRotationCommand({ KeyId: keyId })
      );

      logger.info({ keyId }, 'Auto rotation disabled');
    } catch (error) {
      throw this.wrapError(error, 'Failed to disable auto rotation');
    }
  }

  /**
   * Build a cache key from key ID and encryption context
   */
  private buildCacheKey(keyId: string, encryptionContext?: Record<string, string>): string {
    const contextHash = encryptionContext
      ? Buffer.from(JSON.stringify(encryptionContext)).toString('base64')
      : '';
    return `${keyId}:${contextHash}`;
  }

  /**
   * Map AWS key metadata to our KeyMetadata type
   */
  private mapAWSKeyMetadata(awsMetadata: AWSKeyMetadata): KeyMetadata {
    return {
      id: awsMetadata.KeyId ?? '',
      arn: awsMetadata.Arn ?? '',
      version: 0, // AWS doesn't expose version number directly
      createdAt: awsMetadata.CreationDate ?? new Date(),
      rotatedAt: undefined,
      status: this.mapAWSKeyState(awsMetadata.KeyState),
      description: awsMetadata.Description,
      alias: undefined, // Would need separate API call to get aliases
      keyType: awsMetadata.KeySpec,
      keyUsage: awsMetadata.KeyUsage,
      providerMetadata: {
        enabled: awsMetadata.Enabled,
        keyManager: awsMetadata.KeyManager,
        origin: awsMetadata.Origin,
        multiRegion: awsMetadata.MultiRegion,
      },
    };
  }

  /**
   * Map AWS key state to our KeyStatus type
   */
  private mapAWSKeyState(state?: string): KeyStatus {
    switch (state) {
      case 'Enabled':
        return KeyStatus.ENABLED;
      case 'Disabled':
        return KeyStatus.DISABLED;
      case 'PendingDeletion':
        return KeyStatus.PENDING_DELETION;
      case 'PendingImport':
        return KeyStatus.PENDING_IMPORT;
      case 'Unavailable':
        return KeyStatus.UNAVAILABLE;
      default:
        return KeyStatus.UNAVAILABLE;
    }
  }

  /**
   * Wrap errors in AWSKMSError
   */
  private wrapError(error: unknown, message: string): AWSKMSError {
    if (error instanceof AWSKMSError) {
      return error;
    }

    if (error instanceof KMSServiceException) {
      let code: string = KMSErrorCode.ENCRYPTION_FAILED;

      switch (error.name) {
        case 'NotFoundException':
          code = KMSErrorCode.KEY_NOT_FOUND;
          break;
        case 'DisabledException':
          code = KMSErrorCode.KEY_DISABLED;
          break;
        case 'InvalidCiphertextException':
          code = KMSErrorCode.INVALID_CIPHERTEXT;
          break;
        case 'AccessDeniedException':
        case 'KMSAccessDeniedException':
          code = KMSErrorCode.AUTH_FAILED;
          break;
        case 'LimitExceededException':
          code = KMSErrorCode.RATE_LIMITED;
          break;
      }

      return new AWSKMSError(`${message}: ${error.message}`, code, {
        awsErrorName: error.name,
        awsRequestId: error.$metadata?.requestId,
      });
    }

    if (error instanceof Error) {
      return new AWSKMSError(`${message}: ${error.message}`, KMSErrorCode.CONNECTION_FAILED);
    }

    return new AWSKMSError(message, KMSErrorCode.ENCRYPTION_FAILED);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number; maxUsages: number } | null {
    return this.dataKeyCache?.stats() ?? null;
  }
}
