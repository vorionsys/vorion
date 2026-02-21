/**
 * HashiCorp Vault KMS Provider
 *
 * Implementation of KMSProvider interface for HashiCorp Vault's Transit
 * secrets engine. Supports:
 * - Transit secrets engine encryption/decryption
 * - Key versioning and rotation
 * - Token renewal handling
 * - TLS configuration
 *
 * @packageDocumentation
 * @module security/kms/vault
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
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
  VaultKMSConfig,
  KMSAuditEntry,
  KMSAuditCallback,
  CachedDataKey,
} from './types.js';
import { KeyStatus, KMSOperation, KMSErrorCode } from './types.js';

const logger = createLogger({ component: 'vault-kms-provider' });

// =============================================================================
// Errors
// =============================================================================

/**
 * Vault KMS specific error
 */
export class VaultKMSError extends VorionError {
  declare code: string;
  override statusCode = 500;

  constructor(
    message: string,
    code: string = KMSErrorCode.ENCRYPTION_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.name = 'VaultKMSError';
    this.code = code;
  }
}

// =============================================================================
// Vault API Types
// =============================================================================

interface VaultResponse<T> {
  request_id: string;
  lease_id: string;
  renewable: boolean;
  lease_duration: number;
  data: T;
  wrap_info: null;
  warnings: string[] | null;
  auth: VaultAuth | null;
}

interface VaultAuth {
  client_token: string;
  accessor: string;
  policies: string[];
  token_policies: string[];
  metadata: Record<string, string>;
  lease_duration: number;
  renewable: boolean;
  entity_id: string;
}

interface VaultKeyInfo {
  name: string;
  type: string;
  deletion_allowed: boolean;
  derived: boolean;
  exportable: boolean;
  allow_plaintext_backup: boolean;
  keys: Record<string, number>;
  min_decryption_version: number;
  min_encryption_version: number;
  supports_encryption: boolean;
  supports_decryption: boolean;
  supports_derivation: boolean;
  supports_signing: boolean;
  auto_rotate_period?: number;
  latest_version: number;
}

interface VaultEncryptResponse {
  ciphertext: string;
  key_version: number;
}

interface VaultDecryptResponse {
  plaintext: string;
  key_version?: number;
}

interface VaultDataKeyResponse {
  ciphertext: string;
  plaintext: string;
  key_version: number;
}

// =============================================================================
// Data Key Cache
// =============================================================================

class VaultDataKeyCache {
  private readonly cache: Map<string, CachedDataKey> = new Map();
  private readonly ttlMs: number;
  private readonly maxUsages: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlSeconds: number = 300, maxUsages: number = 1000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxUsages = maxUsages;
  }

  start(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
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
  }

  stats(): { size: number; ttlMs: number; maxUsages: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs, maxUsages: this.maxUsages };
  }
}

// =============================================================================
// HashiCorp Vault KMS Provider
// =============================================================================

/**
 * HashiCorp Vault KMS Provider implementation
 *
 * Uses Vault's Transit secrets engine for encryption operations.
 *
 * @example
 * ```typescript
 * const provider = new HashiCorpVaultProvider({
 *   provider: 'vault',
 *   address: 'https://vault.example.com:8200',
 *   token: process.env.VAULT_TOKEN,
 *   transitMount: 'transit',
 *   keyName: 'my-encryption-key',
 * });
 *
 * await provider.initialize();
 *
 * // Generate data key for envelope encryption
 * const dataKey = await provider.generateDataKey();
 * ```
 */
export class HashiCorpVaultProvider implements KMSProvider {
  readonly name = 'vault';

  private readonly config: VaultKMSConfig;
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private renewalInterval: NodeJS.Timeout | null = null;
  private dataKeyCache: VaultDataKeyCache | null = null;
  private readonly auditCallbacks: KMSAuditCallback[] = [];
  private initialized = false;
  private httpsAgent: https.Agent | null = null;

  constructor(config: VaultKMSConfig) {
    this.config = {
      transitMount: 'transit',
      enableTokenRenewal: true,
      tokenRenewalIntervalSeconds: 3600,
      enableCaching: true,
      cacheTtlSeconds: 300,
      maxCacheUsages: 1000,
      enableAuditLogging: true,
      ...config,
    };
  }

  /**
   * Initialize the Vault provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('HashiCorpVaultProvider already initialized');
      return;
    }

    logger.info(
      { address: this.config.address, keyName: this.config.keyName },
      'Initializing HashiCorp Vault KMS provider'
    );

    // Load token
    await this.loadToken();

    // Configure TLS
    this.configureTLS();

    // Initialize cache
    if (this.config.enableCaching) {
      this.dataKeyCache = new VaultDataKeyCache(
        this.config.cacheTtlSeconds,
        this.config.maxCacheUsages
      );
      this.dataKeyCache.start();
    }

    // Verify connectivity and key exists
    try {
      const keyMetadata = await this.getKey(this.config.keyName);
      if (!keyMetadata) {
        throw new VaultKMSError(
          `Key not found: ${this.config.keyName}`,
          KMSErrorCode.KEY_NOT_FOUND
        );
      }

      logger.info(
        { keyId: keyMetadata.id, version: keyMetadata.version },
        'HashiCorp Vault KMS provider initialized successfully'
      );
    } catch (error) {
      if (error instanceof VaultKMSError) throw error;
      throw new VaultKMSError(
        `Failed to initialize Vault provider: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.CONNECTION_FAILED
      );
    }

    // Start token renewal
    if (this.config.enableTokenRenewal) {
      this.startTokenRenewal();
    }

    this.initialized = true;
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down HashiCorp Vault KMS provider');

    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
      this.renewalInterval = null;
    }

    if (this.dataKeyCache) {
      this.dataKeyCache.stop();
      this.dataKeyCache.clear();
      this.dataKeyCache = null;
    }

    if (this.httpsAgent) {
      this.httpsAgent.destroy();
      this.httpsAgent = null;
    }

    this.token = null;
    this.initialized = false;

    logger.info('HashiCorp Vault KMS provider shutdown complete');
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
      provider: 'vault',
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
    if (!this.initialized || !this.token) {
      return false;
    }

    try {
      await this.vaultRequest('GET', '/v1/sys/health');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.token) {
      throw new VaultKMSError(
        'Vault KMS provider not initialized. Call initialize() first.',
        KMSErrorCode.NOT_INITIALIZED
      );
    }
  }

  /**
   * Load token from config, file, or environment
   */
  private async loadToken(): Promise<void> {
    // Try direct token first
    if (this.config.token) {
      this.token = this.config.token;
      return;
    }

    // Try token file
    if (this.config.tokenFile) {
      try {
        this.token = fs.readFileSync(this.config.tokenFile, 'utf-8').trim();
        return;
      } catch (error) {
        throw new VaultKMSError(
          `Failed to read token file: ${this.config.tokenFile}`,
          KMSErrorCode.AUTH_FAILED
        );
      }
    }

    // Try environment variable
    const envToken = process.env['VAULT_TOKEN'];
    if (envToken) {
      this.token = envToken;
      return;
    }

    throw new VaultKMSError(
      'No Vault token provided. Set token, tokenFile, or VAULT_TOKEN environment variable.',
      KMSErrorCode.AUTH_FAILED
    );
  }

  /**
   * Configure TLS options
   */
  private configureTLS(): void {
    const tlsConfig = this.config.tls;

    if (!tlsConfig) {
      return;
    }

    const agentOptions: https.AgentOptions = {
      rejectUnauthorized: !tlsConfig.skipVerify,
    };

    if (tlsConfig.caCert) {
      agentOptions.ca = fs.readFileSync(tlsConfig.caCert);
    }

    if (tlsConfig.clientCert) {
      agentOptions.cert = fs.readFileSync(tlsConfig.clientCert);
    }

    if (tlsConfig.clientKey) {
      agentOptions.key = fs.readFileSync(tlsConfig.clientKey);
    }

    this.httpsAgent = new https.Agent(agentOptions);
  }

  /**
   * Start token renewal interval
   */
  private startTokenRenewal(): void {
    const intervalMs = (this.config.tokenRenewalIntervalSeconds ?? 3600) * 1000;

    this.renewalInterval = setInterval(async () => {
      try {
        await this.renewToken();
      } catch (error) {
        logger.error({ error }, 'Token renewal failed');
      }
    }, intervalMs);

    this.renewalInterval.unref();
  }

  /**
   * Renew the Vault token
   */
  private async renewToken(): Promise<void> {
    try {
      const response = await this.vaultRequest<VaultResponse<VaultAuth>>(
        'POST',
        '/v1/auth/token/renew-self'
      );

      if (response.auth?.lease_duration) {
        this.tokenExpiresAt = new Date(Date.now() + response.auth.lease_duration * 1000);
        logger.debug({ expiresAt: this.tokenExpiresAt }, 'Token renewed');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to renew Vault token');
      throw new VaultKMSError('Token renewal failed', KMSErrorCode.TOKEN_EXPIRED);
    }
  }

  /**
   * Make a request to Vault
   */
  private async vaultRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'LIST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = new URL(path, this.config.address);

    const headers: Record<string, string> = {
      'X-Vault-Token': this.token ?? '',
      'Content-Type': 'application/json',
    };

    if (this.config.namespace) {
      headers['X-Vault-Namespace'] = this.config.namespace;
    }

    // Handle LIST method
    const actualMethod = method === 'LIST' ? 'GET' : method;
    if (method === 'LIST') {
      url.searchParams.set('list', 'true');
    }

    const options: RequestInit = {
      method: actualMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url.toString(), options);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new VaultKMSError(
          `Vault request failed: ${response.status} ${response.statusText} - ${errorBody}`,
          response.status === 403 ? KMSErrorCode.AUTH_FAILED : KMSErrorCode.CONNECTION_FAILED
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof VaultKMSError) throw error;
      throw new VaultKMSError(
        `Vault request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        KMSErrorCode.CONNECTION_FAILED
      );
    }
  }

  /**
   * Get the transit engine path
   */
  private transitPath(suffix: string): string {
    return `/v1/${this.config.transitMount}/${suffix}`;
  }

  /**
   * Get key metadata
   */
  async getKey(keyId: string): Promise<KeyMetadata | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const response = await this.vaultRequest<VaultResponse<VaultKeyInfo>>(
        'GET',
        this.transitPath(`keys/${keyId}`)
      );

      const metadata = this.mapVaultKeyInfo(keyId, response.data);

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

      if (error instanceof VaultKMSError && error.message.includes('404')) {
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
  async listKeys(_options?: ListKeysOptions): Promise<KeyMetadata[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const response = await this.vaultRequest<VaultResponse<{ keys: string[] }>>(
        'LIST',
        this.transitPath('keys')
      );

      const keys: KeyMetadata[] = [];
      for (const keyName of response.data.keys ?? []) {
        const metadata = await this.getKey(keyName);
        if (metadata) {
          keys.push(metadata);
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
    const keyName = options?.keyId ?? this.config.keyName;

    try {
      const response = await this.vaultRequest<VaultResponse<VaultEncryptResponse>>(
        'POST',
        this.transitPath(`encrypt/${keyName}`),
        {
          plaintext: plaintext.toString('base64'),
          context: options?.encryptionContext
            ? Buffer.from(JSON.stringify(options.encryptionContext)).toString('base64')
            : undefined,
        }
      );

      const result: EncryptResult = {
        ciphertext: Buffer.from(response.data.ciphertext),
        keyId: keyName,
        keyVersion: response.data.key_version,
        algorithm: 'aes256-gcm96', // Vault default
      };

      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId: keyName,
        keyVersion: result.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.ENCRYPT,
        keyId: keyName,
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
    const keyName = options?.keyId ?? this.config.keyName;

    try {
      const response = await this.vaultRequest<VaultResponse<VaultDecryptResponse>>(
        'POST',
        this.transitPath(`decrypt/${keyName}`),
        {
          ciphertext: ciphertext.toString(),
          context: options?.encryptionContext
            ? Buffer.from(JSON.stringify(options.encryptionContext)).toString('base64')
            : undefined,
        }
      );

      const result: DecryptResult = {
        plaintext: Buffer.from(response.data.plaintext, 'base64'),
        keyId: keyName,
        keyVersion: response.data.key_version ?? 0,
      };

      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId: keyName,
        keyVersion: result.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT,
        keyId: keyName,
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
    const keyName = options?.keyId ?? this.config.keyName;
    const keyLength = options?.keyLength ?? 32;

    // Build cache key
    const cacheKey = this.buildCacheKey(keyName, options?.encryptionContext);

    // Check cache
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug({ keyName }, 'Using cached data key');
        await this.emitAudit({
          operation: KMSOperation.GENERATE_DATA_KEY,
          keyId: keyName,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });
        return cached;
      }
    }

    try {
      const response = await this.vaultRequest<VaultResponse<VaultDataKeyResponse>>(
        'POST',
        this.transitPath(`datakey/plaintext/${keyName}`),
        {
          bits: keyLength * 8,
          context: options?.encryptionContext
            ? Buffer.from(JSON.stringify(options.encryptionContext)).toString('base64')
            : undefined,
        }
      );

      const dataKey: DataKey = {
        plaintext: Buffer.from(response.data.plaintext, 'base64'),
        ciphertext: Buffer.from(response.data.ciphertext),
        keyId: keyName,
        keyVersion: response.data.key_version,
        algorithm: 'aes256-gcm96',
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
        keyId: keyName,
        keyVersion: dataKey.keyVersion,
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return dataKey;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.GENERATE_DATA_KEY,
        keyId: keyName,
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
    const keyName = options?.keyId ?? this.config.keyName;

    // Check cache
    const cacheKey = `decrypt:${encryptedDataKey.toString('base64')}`;
    if (this.dataKeyCache) {
      const cached = this.dataKeyCache.get(cacheKey);
      if (cached) {
        logger.debug({ keyName }, 'Using cached decrypted data key');
        await this.emitAudit({
          operation: KMSOperation.DECRYPT_DATA_KEY,
          keyId: keyName,
          success: true,
          durationMs: performance.now() - startTime,
          fromCache: true,
        });
        return Buffer.from(cached.plaintext);
      }
    }

    try {
      const response = await this.vaultRequest<VaultResponse<VaultDecryptResponse>>(
        'POST',
        this.transitPath(`decrypt/${keyName}`),
        {
          ciphertext: encryptedDataKey.toString(),
          context: options?.encryptionContext
            ? Buffer.from(JSON.stringify(options.encryptionContext)).toString('base64')
            : undefined,
        }
      );

      const plaintext = Buffer.from(response.data.plaintext, 'base64');

      // Cache the decrypted data key
      if (this.dataKeyCache) {
        const dataKey: DataKey = {
          plaintext: Buffer.from(plaintext),
          ciphertext: encryptedDataKey,
          keyId: keyName,
          keyVersion: response.data.key_version ?? 0,
          algorithm: 'aes256-gcm96',
          generatedAt: new Date(),
        };
        this.dataKeyCache.set(cacheKey, dataKey);
      }

      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId: keyName,
        success: true,
        durationMs: performance.now() - startTime,
        fromCache: false,
      });

      return plaintext;
    } catch (error) {
      await this.emitAudit({
        operation: KMSOperation.DECRYPT_DATA_KEY,
        keyId: keyName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: performance.now() - startTime,
      });

      throw this.wrapError(error, 'Failed to decrypt data key');
    }
  }

  /**
   * Rotate a key
   */
  async rotateKey(keyId: string): Promise<KeyRotationResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      // Get current key info
      const keyMetadata = await this.getKey(keyId);
      if (!keyMetadata) {
        throw new VaultKMSError(`Key not found: ${keyId}`, KMSErrorCode.KEY_NOT_FOUND);
      }

      const previousVersion = keyMetadata.version;

      // Rotate the key
      await this.vaultRequest('POST', this.transitPath(`keys/${keyId}/rotate`));

      // Get new version
      const newMetadata = await this.getKey(keyId);
      const newVersion = newMetadata?.version ?? previousVersion + 1;

      // Clear cache
      if (this.dataKeyCache) {
        this.dataKeyCache.clear();
      }

      const result: KeyRotationResult = {
        keyId,
        previousVersion,
        newVersion,
        rotatedAt: new Date(),
      };

      await this.emitAudit({
        operation: KMSOperation.ROTATE_KEY,
        keyId,
        keyVersion: newVersion,
        success: true,
        durationMs: performance.now() - startTime,
      });

      logger.info({ keyId, previousVersion, newVersion }, 'Key rotated');

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
      const response = await this.vaultRequest<VaultResponse<VaultKeyInfo>>(
        'GET',
        this.transitPath(`keys/${keyId}`)
      );

      const autoRotatePeriod = response.data.auto_rotate_period;

      return {
        enabled: !!autoRotatePeriod && autoRotatePeriod > 0,
        rotationPeriodDays: autoRotatePeriod ? Math.floor(autoRotatePeriod / 86400) : undefined,
        nextRotationTime: undefined, // Vault doesn't expose this directly
        lastRotationTime: undefined,
      };
    } catch (error) {
      throw this.wrapError(error, 'Failed to get rotation schedule');
    }
  }

  /**
   * Enable automatic key rotation
   */
  async enableAutoRotation(keyId: string, rotationPeriodDays: number = 30): Promise<void> {
    this.ensureInitialized();

    try {
      await this.vaultRequest('POST', this.transitPath(`keys/${keyId}/config`), {
        auto_rotate_period: `${rotationPeriodDays * 24}h`,
      });

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
      await this.vaultRequest('POST', this.transitPath(`keys/${keyId}/config`), {
        auto_rotate_period: '0',
      });

      logger.info({ keyId }, 'Auto rotation disabled');
    } catch (error) {
      throw this.wrapError(error, 'Failed to disable auto rotation');
    }
  }

  /**
   * Build a cache key
   */
  private buildCacheKey(keyId: string, encryptionContext?: Record<string, string>): string {
    const contextHash = encryptionContext
      ? Buffer.from(JSON.stringify(encryptionContext)).toString('base64')
      : '';
    return `${keyId}:${contextHash}`;
  }

  /**
   * Map Vault key info to KeyMetadata
   */
  private mapVaultKeyInfo(keyName: string, info: VaultKeyInfo): KeyMetadata {
    return {
      id: keyName,
      arn: `vault://${this.config.transitMount}/keys/${keyName}`,
      version: info.latest_version,
      createdAt: new Date(), // Vault doesn't provide creation date in key info
      rotatedAt: undefined,
      status: KeyStatus.ENABLED,
      description: undefined,
      alias: keyName,
      keyType: info.type,
      keyUsage: info.supports_encryption ? 'encrypt_decrypt' : 'sign_verify',
      providerMetadata: {
        minDecryptionVersion: info.min_decryption_version,
        minEncryptionVersion: info.min_encryption_version,
        derived: info.derived,
        exportable: info.exportable,
        autoRotatePeriod: info.auto_rotate_period,
      },
    };
  }

  /**
   * Wrap errors
   */
  private wrapError(error: unknown, message: string): VaultKMSError {
    if (error instanceof VaultKMSError) return error;

    if (error instanceof Error) {
      return new VaultKMSError(`${message}: ${error.message}`, KMSErrorCode.CONNECTION_FAILED);
    }

    return new VaultKMSError(message, KMSErrorCode.ENCRYPTION_FAILED);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number; maxUsages: number } | null {
    return this.dataKeyCache?.stats() ?? null;
  }
}
