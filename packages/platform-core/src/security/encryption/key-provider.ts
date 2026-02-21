/**
 * Key Provider for Field-Level Encryption
 *
 * Manages encryption keys for field-level encryption with support for:
 * - Key versioning for rotation
 * - HKDF key derivation for field-specific keys
 * - Environment-based key storage
 * - KMS integration (AWS KMS, HashiCorp Vault)
 * - Envelope encryption pattern
 * - Secure memory caching with TTL
 *
 * Security considerations:
 * - Master keys are never exposed outside this module
 * - Field-specific keys are derived using HKDF
 * - Key versions enable zero-downtime rotation
 * - All key material is wiped after use when possible
 * - KMS integration provides hardware-backed key protection
 *
 * @packageDocumentation
 * @module security/encryption/key-provider
 */

import * as crypto from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { devOnlyDefault, isProductionGrade } from '../../common/security-mode.js';
import { SecureBuffer } from '../secure-memory.js';
import type { KeyVersion, EncryptionConfig } from './types.js';
import { DEFAULT_ENCRYPTION_CONFIG } from './types.js';
import type { KMSProvider, DataKey, KMSConfig } from '../kms/types.js';
import {
  getKMSProvider,
  getInitializedKMSProvider,
  isKMSConfigured,
  createKMSProvider,
} from '../kms/index.js';

const logger = createLogger({ component: 'key-provider' });

// =============================================================================
// Constants
// =============================================================================

/** Default master key for development only */
const DEV_MASTER_KEY = 'vorion-dev-master-key-32-bytes!!';

/** Environment variable prefix for master keys */
const KEY_ENV_PREFIX = 'VORION_ENCRYPTION_KEY';

/** Minimum master key length in bytes */
const MIN_KEY_LENGTH = 32;

/** Default cache TTL for derived keys in milliseconds */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum cache size for derived keys */
const DEFAULT_MAX_CACHE_SIZE = 1000;

// =============================================================================
// Secure Key Cache
// =============================================================================

/**
 * Cache entry for derived keys with secure memory handling
 */
interface CachedKey {
  /** Secure buffer containing the key */
  key: SecureBuffer;
  /** Cache entry creation time */
  cachedAt: number;
  /** Cache entry expiration time */
  expiresAt: number;
  /** Number of times this key has been used */
  usageCount: number;
}

/**
 * Secure cache for derived keys with TTL and automatic cleanup
 */
class SecureKeyCache {
  private readonly cache: Map<string, CachedKey> = new Map();
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlMs: number = DEFAULT_CACHE_TTL_MS, maxSize: number = DEFAULT_MAX_CACHE_SIZE) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
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
   * Get a cached key
   */
  get(cacheKey: string): Buffer | null {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(cacheKey);
      return null;
    }

    // Check if cleared
    if (entry.key.isCleared()) {
      this.cache.delete(cacheKey);
      return null;
    }

    // Increment usage count
    entry.usageCount++;

    // Return a copy of the key
    return entry.key.use((k) => Buffer.from(k));
  }

  /**
   * Set a cached key
   */
  set(cacheKey: string, key: Buffer): void {
    // Enforce max size by removing oldest entries
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }

    const now = Date.now();
    const entry: CachedKey = {
      key: new SecureBuffer(key),
      cachedAt: now,
      expiresAt: now + this.ttlMs,
      usageCount: 0,
    };

    this.cache.set(cacheKey, entry);
  }

  /**
   * Delete a cached entry and clear sensitive data
   */
  delete(cacheKey: string): void {
    const entry = this.cache.get(cacheKey);
    if (entry) {
      entry.key.clear();
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
      if (now > entry.expiresAt || entry.key.isCleared()) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.debug({ expiredCount: expiredKeys.length }, 'Cleaned up expired key cache entries');
    }
  }

  /**
   * Find the oldest cache entry
   */
  private findOldestEntry(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldest = key;
        oldestTime = entry.cachedAt;
      }
    }

    return oldest;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; ttlMs: number; maxSize: number } {
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs,
      maxSize: this.maxSize,
    };
  }
}

// =============================================================================
// Key Provider Interface
// =============================================================================

/**
 * Interface for key providers
 *
 * Key providers are responsible for managing master encryption keys
 * and deriving field-specific keys using HKDF.
 */
export interface KeyProvider {
  /**
   * Get the current active key version number
   */
  getCurrentVersion(): Promise<number>;

  /**
   * Get a specific key version's metadata
   */
  getKeyVersion(version: number): Promise<KeyVersion | null>;

  /**
   * Get all available key versions
   */
  getAllVersions(): Promise<KeyVersion[]>;

  /**
   * Derive a field-specific encryption key
   *
   * @param version - Key version to use
   * @param fieldName - Name of the field (used in key derivation)
   * @param tenantId - Optional tenant ID for multi-tenant isolation
   * @returns Derived key buffer
   */
  deriveFieldKey(version: number, fieldName: string, tenantId?: string): Promise<Buffer>;

  /**
   * Derive a deterministic key for searchable encryption
   *
   * This uses a fixed "IV" derived from the plaintext to enable searching
   * while still providing encryption. Less secure than random IV encryption.
   *
   * @param version - Key version to use
   * @param fieldName - Name of the field
   * @param tenantId - Optional tenant ID
   * @returns Derived key buffer
   */
  deriveDeterministicKey(version: number, fieldName: string, tenantId?: string): Promise<Buffer>;

  /**
   * Rotate to a new key version
   *
   * @returns The new key version number
   */
  rotateKey(): Promise<number>;

  /**
   * Initialize the key provider
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the key provider and clear sensitive data
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Environment Key Provider
// =============================================================================

/**
 * Key provider that reads master keys from environment variables
 *
 * Key format:
 * - VORION_ENCRYPTION_KEY: Current master key (base64 encoded, 32+ bytes)
 * - VORION_ENCRYPTION_KEY_V{N}: Version-specific keys for rotation
 *
 * @example
 * ```typescript
 * const provider = new EnvKeyProvider({
 *   keyDerivationInfo: 'my-app-encryption-v1',
 * });
 * await provider.initialize();
 *
 * // Derive a field-specific key
 * const key = await provider.deriveFieldKey(1, 'ssn');
 * ```
 */
export class EnvKeyProvider implements KeyProvider {
  private readonly config: EncryptionConfig;
  private readonly masterKeys: Map<number, Buffer> = new Map();
  private readonly keyVersions: Map<number, KeyVersion> = new Map();
  private currentVersion: number = 0;
  private initialized = false;

  constructor(config: Partial<EncryptionConfig> = {}) {
    this.config = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
  }

  /**
   * Initialize the key provider by loading keys from environment
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('KeyProvider already initialized');
      return;
    }

    logger.info('Initializing EnvKeyProvider');

    // Load versioned keys first
    await this.loadVersionedKeys();

    // Load current key if no versioned keys found
    if (this.masterKeys.size === 0) {
      await this.loadCurrentKey();
    }

    if (this.masterKeys.size === 0) {
      throw new Error('No encryption keys found. Set VORION_ENCRYPTION_KEY environment variable.');
    }

    // Find the highest version number
    this.currentVersion = Math.max(...Array.from(this.masterKeys.keys()));

    this.initialized = true;
    logger.info(
      { keyVersions: this.masterKeys.size, currentVersion: this.currentVersion },
      'EnvKeyProvider initialized'
    );
  }

  /**
   * Load versioned keys from environment (VORION_ENCRYPTION_KEY_V1, V2, etc.)
   */
  private async loadVersionedKeys(): Promise<void> {
    for (let version = 1; version <= 100; version++) {
      const envVar = `${KEY_ENV_PREFIX}_V${version}`;
      const keyValue = process.env[envVar];

      if (!keyValue) {
        // No more versioned keys
        if (version > 1 && !process.env[`${KEY_ENV_PREFIX}_V${version}`]) {
          break;
        }
        continue;
      }

      const keyBuffer = this.decodeKey(keyValue);
      this.validateKeyLength(keyBuffer, version);

      this.masterKeys.set(version, keyBuffer);
      this.keyVersions.set(version, {
        version,
        createdAt: new Date(),
        activatedAt: new Date(),
        status: 'active',
      });

      logger.debug({ version }, 'Loaded key version from environment');
    }
  }

  /**
   * Load the current key from environment (VORION_ENCRYPTION_KEY)
   */
  private async loadCurrentKey(): Promise<void> {
    let keyValue = process.env[KEY_ENV_PREFIX];

    if (!keyValue) {
      // Use dev-only fallback in non-production
      keyValue = devOnlyDefault(KEY_ENV_PREFIX, DEV_MASTER_KEY);
    }

    const keyBuffer = this.decodeKey(keyValue);
    this.validateKeyLength(keyBuffer, 1);

    this.masterKeys.set(1, keyBuffer);
    this.keyVersions.set(1, {
      version: 1,
      createdAt: new Date(),
      activatedAt: new Date(),
      status: 'active',
    });

    logger.debug('Loaded current key from environment');
  }

  /**
   * Decode a key from environment variable (supports base64 or raw)
   */
  private decodeKey(value: string): Buffer {
    // Try base64 first
    try {
      const decoded = Buffer.from(value, 'base64');
      // Check if it looks like valid base64 (decoded length should be reasonable)
      if (decoded.length >= MIN_KEY_LENGTH) {
        return decoded;
      }
    } catch {
      // Not base64, use as raw string
    }

    // Use as raw string (UTF-8)
    return Buffer.from(value, 'utf-8');
  }

  /**
   * Validate key length meets minimum requirements
   */
  private validateKeyLength(key: Buffer, version: number): void {
    if (key.length < MIN_KEY_LENGTH) {
      throw new Error(
        `Encryption key version ${version} is too short. ` +
        `Minimum length is ${MIN_KEY_LENGTH} bytes, got ${key.length} bytes.`
      );
    }
  }

  /**
   * Ensure the provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KeyProvider not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the current active key version
   */
  async getCurrentVersion(): Promise<number> {
    this.ensureInitialized();
    return this.currentVersion;
  }

  /**
   * Get metadata for a specific key version
   */
  async getKeyVersion(version: number): Promise<KeyVersion | null> {
    this.ensureInitialized();
    return this.keyVersions.get(version) ?? null;
  }

  /**
   * Get all available key versions
   */
  async getAllVersions(): Promise<KeyVersion[]> {
    this.ensureInitialized();
    return Array.from(this.keyVersions.values()).sort((a, b) => b.version - a.version);
  }

  /**
   * Derive a field-specific encryption key using HKDF
   *
   * Key derivation:
   * - Input Key Material (IKM): Master key for the version
   * - Salt: SHA-256 hash of tenant ID (or empty for single-tenant)
   * - Info: Concatenation of config info prefix + field name
   */
  async deriveFieldKey(version: number, fieldName: string, tenantId?: string): Promise<Buffer> {
    this.ensureInitialized();

    const masterKey = this.masterKeys.get(version);
    if (!masterKey) {
      throw new Error(`Key version ${version} not found`);
    }

    // Create salt from tenant ID for multi-tenant isolation
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);

    // Create info string for key derivation
    const info = Buffer.from(`${this.config.keyDerivationInfo}:field:${fieldName}`, 'utf-8');

    // Derive key using HKDF
    const derivedKey = crypto.hkdfSync(
      this.config.hkdfHash,
      masterKey,
      salt,
      info,
      this.config.keyLength
    );

    return Buffer.from(derivedKey);
  }

  /**
   * Derive a deterministic key for searchable encryption
   *
   * Uses a different info string to ensure deterministic keys are
   * cryptographically separate from random IV keys.
   */
  async deriveDeterministicKey(
    version: number,
    fieldName: string,
    tenantId?: string
  ): Promise<Buffer> {
    this.ensureInitialized();

    const masterKey = this.masterKeys.get(version);
    if (!masterKey) {
      throw new Error(`Key version ${version} not found`);
    }

    // Create salt from tenant ID
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);

    // Different info string for deterministic keys
    const info = Buffer.from(
      `${this.config.keyDerivationInfo}:deterministic:${fieldName}`,
      'utf-8'
    );

    const derivedKey = crypto.hkdfSync(
      this.config.hkdfHash,
      masterKey,
      salt,
      info,
      this.config.keyLength
    );

    return Buffer.from(derivedKey);
  }

  /**
   * Rotate to a new key version
   *
   * Note: In a production environment, this would integrate with a secrets
   * management service. For the EnvKeyProvider, new keys must be added
   * to environment variables before rotation.
   */
  async rotateKey(): Promise<number> {
    this.ensureInitialized();

    const newVersion = this.currentVersion + 1;
    const envVar = `${KEY_ENV_PREFIX}_V${newVersion}`;
    const keyValue = process.env[envVar];

    if (!keyValue) {
      throw new Error(
        `Cannot rotate: New key version ${newVersion} not found. ` +
        `Set ${envVar} environment variable before rotating.`
      );
    }

    const keyBuffer = this.decodeKey(keyValue);
    this.validateKeyLength(keyBuffer, newVersion);

    // Mark current version as deprecated
    const currentKeyVersion = this.keyVersions.get(this.currentVersion);
    if (currentKeyVersion) {
      currentKeyVersion.status = 'deprecated';
      currentKeyVersion.deprecatedAt = new Date();
    }

    // Add new version
    this.masterKeys.set(newVersion, keyBuffer);
    this.keyVersions.set(newVersion, {
      version: newVersion,
      createdAt: new Date(),
      activatedAt: new Date(),
      status: 'active',
    });

    this.currentVersion = newVersion;

    logger.info(
      { oldVersion: newVersion - 1, newVersion },
      'Key rotation completed'
    );

    return newVersion;
  }

  /**
   * Shutdown and clear sensitive key material
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down EnvKeyProvider');

    // Overwrite key material with zeros before clearing
    Array.from(this.masterKeys.values()).forEach((key) => {
      key.fill(0);
    });

    this.masterKeys.clear();
    this.keyVersions.clear();
    this.currentVersion = 0;
    this.initialized = false;

    logger.info('EnvKeyProvider shutdown complete');
  }
}

// =============================================================================
// KMS Key Provider (Envelope Encryption)
// =============================================================================

/**
 * Configuration for KMS-backed key provider
 */
export interface KMSKeyProviderConfig {
  /** Encryption configuration */
  encryptionConfig?: Partial<EncryptionConfig>;
  /** KMS configuration (if not using default provider) */
  kmsConfig?: KMSConfig;
  /** Cache TTL for derived keys in milliseconds */
  cacheTtlMs?: number;
  /** Maximum cache size */
  maxCacheSize?: number;
  /** Enable key caching */
  enableCaching?: boolean;
  /** Encryption context to include with data keys */
  encryptionContext?: Record<string, string>;
}

/**
 * Key provider that uses KMS for envelope encryption
 *
 * This provider uses a KMS (AWS KMS, HashiCorp Vault, or local) to
 * generate and protect data encryption keys. The pattern used is
 * envelope encryption:
 *
 * 1. KMS generates a data key (plaintext + encrypted)
 * 2. The plaintext data key is used to derive field-specific keys via HKDF
 * 3. The encrypted data key is stored for later decryption
 * 4. Plaintext keys are cached securely in memory with TTL
 *
 * Security benefits:
 * - Master key never leaves KMS
 * - Data keys are protected by KMS encryption
 * - Key rotation is handled by KMS
 * - Audit logging of all key operations
 *
 * @example
 * ```typescript
 * const provider = new KMSKeyProvider({
 *   kmsConfig: {
 *     provider: 'aws',
 *     keyArn: 'arn:aws:kms:us-west-2:123456789:key/abc-123',
 *   },
 * });
 * await provider.initialize();
 *
 * // Derive a field-specific key
 * const key = await provider.deriveFieldKey(1, 'ssn');
 * ```
 */
export class KMSKeyProvider implements KeyProvider {
  private readonly encryptionConfig: EncryptionConfig;
  private readonly kmsConfig?: KMSConfig;
  private readonly cacheTtlMs: number;
  private readonly maxCacheSize: number;
  private readonly enableCaching: boolean;
  private readonly encryptionContext?: Record<string, string>;

  private kmsProvider: KMSProvider | null = null;
  private derivedKeyCache: SecureKeyCache | null = null;
  private dataKeyVersions: Map<number, { plaintext: Buffer; ciphertext: Buffer }> = new Map();
  private keyVersionMetadata: Map<number, KeyVersion> = new Map();
  private currentVersion: number = 0;
  private initialized = false;

  constructor(config: KMSKeyProviderConfig = {}) {
    this.encryptionConfig = { ...DEFAULT_ENCRYPTION_CONFIG, ...config.encryptionConfig };
    this.kmsConfig = config.kmsConfig;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheSize = config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
    this.enableCaching = config.enableCaching ?? true;
    this.encryptionContext = config.encryptionContext;
  }

  /**
   * Initialize the KMS key provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('KMSKeyProvider already initialized');
      return;
    }

    logger.info('Initializing KMSKeyProvider');

    // Get or create KMS provider
    if (this.kmsConfig) {
      this.kmsProvider = createKMSProvider(this.kmsConfig);
      await this.kmsProvider.initialize();
    } else {
      this.kmsProvider = await getInitializedKMSProvider();
    }

    // Initialize cache
    if (this.enableCaching) {
      this.derivedKeyCache = new SecureKeyCache(this.cacheTtlMs, this.maxCacheSize);
      this.derivedKeyCache.start();
    }

    // Generate initial data key
    await this.generateDataKeyVersion();

    this.initialized = true;
    logger.info(
      {
        kmsProvider: this.kmsProvider.name,
        currentVersion: this.currentVersion,
        cachingEnabled: this.enableCaching,
      },
      'KMSKeyProvider initialized'
    );
  }

  /**
   * Generate a new data key version from KMS
   */
  private async generateDataKeyVersion(): Promise<number> {
    if (!this.kmsProvider) {
      throw new Error('KMS provider not initialized');
    }

    const newVersion = this.currentVersion + 1;

    // Generate data key from KMS
    const dataKey = await this.kmsProvider.generateDataKey({
      keyLength: MIN_KEY_LENGTH,
      encryptionContext: {
        ...this.encryptionContext,
        version: String(newVersion),
        purpose: 'field-encryption',
      },
    });

    // Store the data key
    this.dataKeyVersions.set(newVersion, {
      plaintext: Buffer.from(dataKey.plaintext),
      ciphertext: Buffer.from(dataKey.ciphertext),
    });

    // Store metadata
    this.keyVersionMetadata.set(newVersion, {
      version: newVersion,
      createdAt: dataKey.generatedAt,
      activatedAt: dataKey.generatedAt,
      status: 'active',
    });

    // Mark previous version as deprecated
    if (this.currentVersion > 0) {
      const prevMetadata = this.keyVersionMetadata.get(this.currentVersion);
      if (prevMetadata) {
        prevMetadata.status = 'deprecated';
        prevMetadata.deprecatedAt = new Date();
      }
    }

    this.currentVersion = newVersion;

    logger.info({ version: newVersion }, 'Generated new data key version from KMS');

    return newVersion;
  }

  /**
   * Get the data key for a specific version
   */
  private async getDataKey(version: number): Promise<Buffer> {
    const dataKey = this.dataKeyVersions.get(version);

    if (dataKey) {
      return dataKey.plaintext;
    }

    // Key not in memory, need to decrypt from stored ciphertext
    // In a full implementation, encrypted data keys would be persisted
    throw new Error(`Data key version ${version} not found. Key may have been rotated out.`);
  }

  /**
   * Ensure the provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KMSKeyProvider not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the current active key version
   */
  async getCurrentVersion(): Promise<number> {
    this.ensureInitialized();
    return this.currentVersion;
  }

  /**
   * Get metadata for a specific key version
   */
  async getKeyVersion(version: number): Promise<KeyVersion | null> {
    this.ensureInitialized();
    return this.keyVersionMetadata.get(version) ?? null;
  }

  /**
   * Get all available key versions
   */
  async getAllVersions(): Promise<KeyVersion[]> {
    this.ensureInitialized();
    return Array.from(this.keyVersionMetadata.values()).sort((a, b) => b.version - a.version);
  }

  /**
   * Derive a field-specific encryption key using HKDF
   */
  async deriveFieldKey(version: number, fieldName: string, tenantId?: string): Promise<Buffer> {
    this.ensureInitialized();

    // Build cache key
    const cacheKey = `field:${version}:${fieldName}:${tenantId ?? ''}`;

    // Check cache
    if (this.derivedKeyCache) {
      const cached = this.derivedKeyCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Get the data key for this version
    const dataKey = await this.getDataKey(version);

    // Create salt from tenant ID for multi-tenant isolation
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);

    // Create info string for key derivation
    const info = Buffer.from(
      `${this.encryptionConfig.keyDerivationInfo}:field:${fieldName}`,
      'utf-8'
    );

    // Derive key using HKDF
    const derivedKey = crypto.hkdfSync(
      this.encryptionConfig.hkdfHash,
      dataKey,
      salt,
      info,
      this.encryptionConfig.keyLength
    );

    const result = Buffer.from(derivedKey);

    // Cache the derived key
    if (this.derivedKeyCache) {
      this.derivedKeyCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Derive a deterministic key for searchable encryption
   */
  async deriveDeterministicKey(
    version: number,
    fieldName: string,
    tenantId?: string
  ): Promise<Buffer> {
    this.ensureInitialized();

    // Build cache key
    const cacheKey = `det:${version}:${fieldName}:${tenantId ?? ''}`;

    // Check cache
    if (this.derivedKeyCache) {
      const cached = this.derivedKeyCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Get the data key for this version
    const dataKey = await this.getDataKey(version);

    // Create salt from tenant ID
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);

    // Different info string for deterministic keys
    const info = Buffer.from(
      `${this.encryptionConfig.keyDerivationInfo}:deterministic:${fieldName}`,
      'utf-8'
    );

    const derivedKey = crypto.hkdfSync(
      this.encryptionConfig.hkdfHash,
      dataKey,
      salt,
      info,
      this.encryptionConfig.keyLength
    );

    const result = Buffer.from(derivedKey);

    // Cache the derived key
    if (this.derivedKeyCache) {
      this.derivedKeyCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Rotate to a new key version
   */
  async rotateKey(): Promise<number> {
    this.ensureInitialized();

    // Clear derived key cache since we're rotating
    if (this.derivedKeyCache) {
      this.derivedKeyCache.clear();
    }

    // Generate new data key from KMS
    const newVersion = await this.generateDataKeyVersion();

    // Optionally rotate the KMS key itself
    if (this.kmsProvider) {
      try {
        const kmsKey = await this.kmsProvider.getKey(
          this.kmsConfig?.defaultKeyId ?? 'default'
        );
        if (kmsKey) {
          await this.kmsProvider.rotateKey(kmsKey.id);
          logger.info({ kmsKeyId: kmsKey.id }, 'KMS key rotation triggered');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to rotate KMS key (data key rotation succeeded)');
      }
    }

    logger.info(
      { oldVersion: newVersion - 1, newVersion },
      'Key rotation completed'
    );

    return newVersion;
  }

  /**
   * Shutdown and clear sensitive key material
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down KMSKeyProvider');

    // Stop and clear cache
    if (this.derivedKeyCache) {
      this.derivedKeyCache.stop();
      this.derivedKeyCache.clear();
      this.derivedKeyCache = null;
    }

    // Clear data keys from memory
    for (const [, dataKey] of this.dataKeyVersions) {
      dataKey.plaintext.fill(0);
      dataKey.ciphertext.fill(0);
    }
    this.dataKeyVersions.clear();
    this.keyVersionMetadata.clear();

    // Shutdown KMS provider if we own it
    if (this.kmsConfig && this.kmsProvider) {
      await this.kmsProvider.shutdown();
      this.kmsProvider = null;
    }

    this.currentVersion = 0;
    this.initialized = false;

    logger.info('KMSKeyProvider shutdown complete');
  }

  /**
   * Get the encrypted data keys for persistence
   *
   * This method returns the encrypted data keys that should be stored
   * securely (e.g., in a database) to allow key recovery after restart.
   */
  getEncryptedDataKeys(): Map<number, Buffer> {
    this.ensureInitialized();

    const result = new Map<number, Buffer>();
    for (const [version, dataKey] of this.dataKeyVersions) {
      result.set(version, Buffer.from(dataKey.ciphertext));
    }
    return result;
  }

  /**
   * Load encrypted data keys from storage
   *
   * This method loads previously stored encrypted data keys and decrypts
   * them using KMS.
   */
  async loadEncryptedDataKeys(
    encryptedKeys: Map<number, Buffer>,
    metadata: Map<number, KeyVersion>
  ): Promise<void> {
    this.ensureInitialized();

    if (!this.kmsProvider) {
      throw new Error('KMS provider not available');
    }

    for (const [version, ciphertext] of encryptedKeys) {
      // Decrypt the data key using KMS
      const plaintext = await this.kmsProvider.decryptDataKey(ciphertext, {
        encryptionContext: {
          ...this.encryptionContext,
          version: String(version),
          purpose: 'field-encryption',
        },
      });

      this.dataKeyVersions.set(version, {
        plaintext,
        ciphertext: Buffer.from(ciphertext),
      });

      // Load metadata
      const keyMeta = metadata.get(version);
      if (keyMeta) {
        this.keyVersionMetadata.set(version, keyMeta);
      }

      // Update current version if higher
      if (version > this.currentVersion) {
        this.currentVersion = version;
      }
    }

    logger.info(
      { loadedVersions: encryptedKeys.size, currentVersion: this.currentVersion },
      'Loaded encrypted data keys'
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number; maxSize: number } | null {
    return this.derivedKeyCache?.stats() ?? null;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an EnvKeyProvider instance
 */
export function createEnvKeyProvider(config?: Partial<EncryptionConfig>): EnvKeyProvider {
  return new EnvKeyProvider(config);
}

/**
 * Create a KMSKeyProvider instance
 */
export function createKMSKeyProvider(config?: KMSKeyProviderConfig): KMSKeyProvider {
  return new KMSKeyProvider(config);
}

// =============================================================================
// Singleton Management
// =============================================================================

let defaultProvider: KeyProvider | null = null;

/**
 * Get the default key provider instance
 *
 * Returns a KMSKeyProvider if KMS is configured, otherwise falls back to EnvKeyProvider.
 * The provider is NOT initialized - call initialize() before use.
 */
export function getKeyProvider(): KeyProvider {
  if (!defaultProvider) {
    // Check if KMS is configured
    if (isKMSConfigured()) {
      logger.info('Creating KMSKeyProvider based on environment configuration');
      defaultProvider = createKMSKeyProvider();
    } else if (isProductionGrade()) {
      // In production, require KMS
      logger.warn(
        'No KMS configured in production mode. ' +
        'Set VORION_KMS_PROVIDER and associated variables for secure key management.'
      );
      // Fall back to EnvKeyProvider but log warning
      defaultProvider = createEnvKeyProvider();
    } else {
      // In development, use EnvKeyProvider
      defaultProvider = createEnvKeyProvider();
    }
  }
  return defaultProvider;
}

/**
 * Get an initialized key provider
 *
 * Creates and initializes the appropriate key provider based on configuration.
 */
export async function getInitializedKeyProvider(): Promise<KeyProvider> {
  const provider = getKeyProvider();
  await provider.initialize();
  return provider;
}

/**
 * Set a custom key provider as the default
 */
export function setKeyProvider(provider: KeyProvider): void {
  defaultProvider = provider;
}

/**
 * Reset the default key provider (for testing)
 */
export async function resetKeyProvider(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.shutdown();
    defaultProvider = null;
  }
}

/**
 * Create the appropriate key provider based on environment
 *
 * @param useKMS - Force KMS usage even if not detected in environment
 * @returns A key provider (not initialized)
 */
export function createKeyProvider(useKMS?: boolean): KeyProvider {
  if (useKMS || isKMSConfigured()) {
    return createKMSKeyProvider();
  }
  return createEnvKeyProvider();
}
