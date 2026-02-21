/**
 * @fileoverview Software-based key rotation system for the Vorion platform.
 *
 * This module provides comprehensive key lifecycle management including:
 * - Key generation for signing purposes
 * - Automatic and manual key rotation with configurable intervals
 * - Key versioning and history tracking
 * - Redis-backed key metadata storage
 * - Graceful key retirement with overlap periods
 * - Emergency key compromise handling
 *
 * The implementation uses the existing crypto module for key generation
 * and Redis for metadata storage. Key material is stored encrypted
 * using the platform's encryption utilities.
 *
 * @module security/key-rotation
 */

import * as crypto from 'node:crypto';
import { createLogger } from '../common/logger.js';
import {
  generateKeyPair,
  exportKeyPair,
  importKeyPair,
  sign as cryptoSign,
  verify as cryptoVerify,
  type ExportedKeyPair,
  type SignatureResult,
  type VerifyResult,
} from '../common/crypto.js';
import { encrypt, decrypt, type EncryptedEnvelope } from '../common/encryption.js';
import { getRedis } from '../common/redis.js';
import type { Redis } from 'ioredis';

const logger = createLogger({ component: 'key-rotation' });

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Supported key types in the rotation system.
 */
export type KeyType = 'signing' | 'encryption' | 'jwt';

/**
 * Key lifecycle status values.
 */
export type KeyStatus = 'pending' | 'active' | 'rotating' | 'retired' | 'compromised';

/**
 * Metadata describing a cryptographic key's properties and lifecycle state.
 */
export interface KeyMetadata {
  /** Unique identifier for the key (UUID v4) */
  id: string;
  /** The purpose/type of this key */
  type: KeyType;
  /** Cryptographic algorithm used */
  algorithm: string;
  /** Timestamp when the key was generated */
  createdAt: Date;
  /** Timestamp when the key became active for signing/encryption */
  activatedAt?: Date;
  /** Timestamp when the key should be rotated */
  expiresAt?: Date;
  /** Timestamp when rotation was initiated */
  rotatedAt?: Date;
  /** Timestamp when the key was retired from use */
  retiredAt?: Date;
  /** Current lifecycle status of the key */
  status: KeyStatus;
  /** Monotonically increasing version number for this key type */
  version: number;
  /** SHA-256 hash of the public key for identification */
  fingerprint: string;
}

/**
 * Configuration options for automatic key rotation.
 */
export interface KeyRotationConfig {
  /** Days before signing keys should be rotated (default: 90) */
  signingKeyRotationDays: number;
  /** Days before encryption keys should be rotated (default: 365) */
  encryptionKeyRotationDays: number;
  /** Days before JWT keys should be rotated (default: 30) */
  jwtKeyRotationDays: number;
  /** Days to keep old keys valid after rotation for verification (default: 7) */
  keyOverlapDays: number;
  /** Enable automatic rotation scheduling (default: false) */
  autoRotate: boolean;
  /** Days before expiration to send rotation notifications (default: 14) */
  notifyBeforeDays: number;
}

/**
 * Complete stored key including encrypted key material.
 */
export interface StoredKey {
  /** Key metadata and lifecycle information */
  metadata: KeyMetadata;
  /** Encrypted private key (JSON envelope) */
  encryptedPrivateKey?: EncryptedEnvelope;
  /** Public key in base64 format */
  publicKey?: string;
}

/**
 * Status information for a key type's rotation state.
 */
export interface RotationStatus {
  /** The key type this status applies to */
  type: KeyType;
  /** Current active key metadata */
  activeKey: KeyMetadata | null;
  /** Number of keys in the overlap/grace period */
  keysInGracePeriod: number;
  /** Days until the active key expires */
  daysUntilExpiration: number | null;
  /** Whether rotation is needed based on configuration */
  rotationNeeded: boolean;
  /** Whether rotation is currently in progress */
  rotationInProgress: boolean;
  /** Timestamp of last successful rotation */
  lastRotation: Date | null;
  /** Timestamp of next scheduled rotation */
  nextScheduledRotation: Date | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Redis key prefix for key storage */
const KEY_PREFIX = 'vorion:keys:';

/** Redis key prefix for key type indexes */
const INDEX_PREFIX = 'vorion:keys:index:';

/** Default rotation configuration */
const DEFAULT_CONFIG: KeyRotationConfig = {
  signingKeyRotationDays: 90,
  encryptionKeyRotationDays: 365,
  jwtKeyRotationDays: 30,
  keyOverlapDays: 7,
  autoRotate: false,
  notifyBeforeDays: 14,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a cryptographic fingerprint (SHA-256 hash) of a public key.
 */
function generateFingerprint(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex');
}

/**
 * Calculates the number of days between two dates.
 */
function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((date2.getTime() - date1.getTime()) / msPerDay);
}

/**
 * Adds days to a date.
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Serialize a stored key for Redis storage.
 */
function serializeStoredKey(key: StoredKey): string {
  return JSON.stringify({
    metadata: {
      ...key.metadata,
      createdAt: key.metadata.createdAt.toISOString(),
      activatedAt: key.metadata.activatedAt?.toISOString(),
      expiresAt: key.metadata.expiresAt?.toISOString(),
      rotatedAt: key.metadata.rotatedAt?.toISOString(),
      retiredAt: key.metadata.retiredAt?.toISOString(),
    },
    encryptedPrivateKey: key.encryptedPrivateKey,
    publicKey: key.publicKey,
  });
}

/**
 * Deserialize a stored key from Redis storage.
 */
function deserializeStoredKey(data: string): StoredKey {
  const parsed = JSON.parse(data);
  return {
    metadata: {
      ...parsed.metadata,
      createdAt: new Date(parsed.metadata.createdAt),
      activatedAt: parsed.metadata.activatedAt ? new Date(parsed.metadata.activatedAt) : undefined,
      expiresAt: parsed.metadata.expiresAt ? new Date(parsed.metadata.expiresAt) : undefined,
      rotatedAt: parsed.metadata.rotatedAt ? new Date(parsed.metadata.rotatedAt) : undefined,
      retiredAt: parsed.metadata.retiredAt ? new Date(parsed.metadata.retiredAt) : undefined,
    },
    encryptedPrivateKey: parsed.encryptedPrivateKey,
    publicKey: parsed.publicKey,
  };
}

// ============================================================================
// KeyRotationManager Class
// ============================================================================

/**
 * Manages the complete lifecycle of cryptographic keys for the Vorion platform.
 *
 * This class provides comprehensive key management capabilities including:
 * - Generation of signing keys (Ed25519/ECDSA)
 * - Automatic and manual key rotation with configurable intervals
 * - Key versioning to support signature verification during rotation
 * - Redis-backed metadata storage with encrypted key material
 * - Emergency key compromise procedures
 *
 * @example
 * ```typescript
 * const manager = getKeyRotationManager();
 * await manager.initialize();
 *
 * // Generate initial keys
 * await manager.generateKey('signing');
 *
 * // Get active key for signing
 * const activeKey = await manager.getActiveKey('signing');
 *
 * // Check rotation status
 * const statuses = await manager.getRotationStatus();
 * ```
 */
export class KeyRotationManager {
  private config: KeyRotationConfig = { ...DEFAULT_CONFIG };
  private initialized = false;
  private rotationTimers: Map<KeyType, NodeJS.Timeout> = new Map();
  private redis: Redis | null = null;

  /**
   * Initializes the key rotation manager.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('KeyRotationManager already initialized');
      return;
    }

    logger.info('Initializing KeyRotationManager');

    this.redis = getRedis();
    this.initialized = true;

    logger.info('KeyRotationManager initialized successfully');
  }

  /**
   * Validates that the manager has been initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.redis) {
      throw new Error('KeyRotationManager not initialized. Call initialize() first.');
    }
  }

  /**
   * Gets the Redis client.
   */
  private getRedis(): Redis {
    this.ensureInitialized();
    return this.redis!;
  }

  /**
   * Gets the next version number for a key type.
   */
  private async getNextVersion(type: KeyType): Promise<number> {
    const redis = this.getRedis();
    const indexKey = `${INDEX_PREFIX}${type}`;
    const keys = await redis.smembers(indexKey);

    if (keys.length === 0) {
      return 1;
    }

    let maxVersion = 0;
    for (const keyId of keys) {
      const data = await redis.get(`${KEY_PREFIX}${keyId}`);
      if (data) {
        const key = deserializeStoredKey(data);
        if (key.metadata.version > maxVersion) {
          maxVersion = key.metadata.version;
        }
      }
    }

    return maxVersion + 1;
  }

  /**
   * Gets the rotation days for a specific key type.
   */
  private getRotationDays(type: KeyType): number {
    switch (type) {
      case 'signing':
        return this.config.signingKeyRotationDays;
      case 'encryption':
        return this.config.encryptionKeyRotationDays;
      case 'jwt':
        return this.config.jwtKeyRotationDays;
    }
  }

  /**
   * Generates a new cryptographic key of the specified type.
   */
  async generateKey(type: KeyType): Promise<KeyMetadata> {
    this.ensureInitialized();
    logger.info({ type }, 'Generating new key');

    const redis = this.getRedis();
    const version = await this.getNextVersion(type);
    const id = crypto.randomUUID();
    const now = new Date();

    // Generate key pair using existing crypto module
    const keyPair = await generateKeyPair();
    const exportedKeyPair = await exportKeyPair(keyPair);

    // Encrypt the private key using existing encryption
    const encryptedPrivateKey = encrypt(exportedKeyPair.privateKey);
    const fingerprint = generateFingerprint(exportedKeyPair.publicKey);

    // Check if we need to auto-activate (no active key exists)
    const existingActive = await this.getActiveKey(type);
    const shouldActivate = !existingActive;

    const rotationDays = this.getRotationDays(type);
    const expiresAt = addDays(now, rotationDays);

    const metadata: KeyMetadata = {
      id,
      type,
      algorithm: 'Ed25519/ECDSA-P256',
      createdAt: now,
      activatedAt: shouldActivate ? now : undefined,
      expiresAt,
      status: shouldActivate ? 'active' : 'pending',
      version,
      fingerprint,
    };

    const storedKey: StoredKey = {
      metadata,
      encryptedPrivateKey,
      publicKey: exportedKeyPair.publicKey,
    };

    // Store in Redis
    await redis.set(`${KEY_PREFIX}${id}`, serializeStoredKey(storedKey));
    await redis.sadd(`${INDEX_PREFIX}${type}`, id);

    // Set TTL based on expected lifecycle (keep for 1 year after expiration for auditing)
    const ttlSeconds = (rotationDays + 365) * 24 * 60 * 60;
    await redis.expire(`${KEY_PREFIX}${id}`, ttlSeconds);

    logger.info({ keyId: id, type, version, status: metadata.status }, 'Key generated successfully');
    return metadata;
  }

  /**
   * Rotates the active key for a specific type.
   */
  async rotateKey(type: KeyType): Promise<KeyMetadata> {
    this.ensureInitialized();
    logger.info({ type }, 'Starting key rotation');

    const redis = this.getRedis();
    const currentActive = await this.getActiveKey(type);
    const now = new Date();

    // Mark current active key as rotating
    if (currentActive) {
      currentActive.metadata.status = 'rotating';
      currentActive.metadata.rotatedAt = now;
      await redis.set(`${KEY_PREFIX}${currentActive.metadata.id}`, serializeStoredKey(currentActive));
      logger.info({ keyId: currentActive.metadata.id }, 'Current key marked as rotating');

      // Schedule retirement after overlap period
      setTimeout(async () => {
        try {
          await this.retireKey(currentActive.metadata.id, 'Scheduled retirement after rotation');
        } catch (error) {
          logger.error({ error, keyId: currentActive.metadata.id }, 'Failed to retire key');
        }
      }, this.config.keyOverlapDays * 24 * 60 * 60 * 1000);
    }

    // Generate and activate new key
    const newMetadata = await this.generateKey(type);

    // If the new key wasn't auto-activated, activate it now
    if (newMetadata.status !== 'active') {
      const newKey = await this.getKeyById(newMetadata.id);
      if (newKey) {
        newKey.metadata.status = 'active';
        newKey.metadata.activatedAt = now;
        await redis.set(`${KEY_PREFIX}${newMetadata.id}`, serializeStoredKey(newKey));
        newMetadata.status = 'active';
        newMetadata.activatedAt = now;
      }
    }

    logger.info({ keyId: newMetadata.id, type, version: newMetadata.version }, 'Key rotation completed');
    return newMetadata;
  }

  /**
   * Retrieves a key by its ID.
   */
  private async getKeyById(keyId: string): Promise<StoredKey | null> {
    const redis = this.getRedis();
    const data = await redis.get(`${KEY_PREFIX}${keyId}`);
    return data ? deserializeStoredKey(data) : null;
  }

  /**
   * Retrieves the currently active key for a specific type.
   */
  async getActiveKey(type: KeyType): Promise<StoredKey | null> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const indexKey = `${INDEX_PREFIX}${type}`;
    const keyIds = await redis.smembers(indexKey);

    let activeKey: StoredKey | null = null;
    let highestVersion = 0;

    for (const keyId of keyIds) {
      const data = await redis.get(`${KEY_PREFIX}${keyId}`);
      if (data) {
        const key = deserializeStoredKey(data);
        if (key.metadata.status === 'active' && key.metadata.version > highestVersion) {
          activeKey = key;
          highestVersion = key.metadata.version;
        }
      }
    }

    return activeKey;
  }

  /**
   * Retrieves all keys that are currently valid for verification.
   */
  async getActiveKeys(type: KeyType): Promise<StoredKey[]> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const indexKey = `${INDEX_PREFIX}${type}`;
    const keyIds = await redis.smembers(indexKey);
    const keys: StoredKey[] = [];

    for (const keyId of keyIds) {
      const data = await redis.get(`${KEY_PREFIX}${keyId}`);
      if (data) {
        const key = deserializeStoredKey(data);
        if (key.metadata.status === 'active' || key.metadata.status === 'rotating') {
          keys.push(key);
        }
      }
    }

    return keys.sort((a, b) => b.metadata.version - a.metadata.version);
  }

  /**
   * Retrieves metadata for all key versions of a specific type.
   */
  async getAllKeyVersions(type: KeyType): Promise<KeyMetadata[]> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const indexKey = `${INDEX_PREFIX}${type}`;
    const keyIds = await redis.smembers(indexKey);
    const metadata: KeyMetadata[] = [];

    for (const keyId of keyIds) {
      const data = await redis.get(`${KEY_PREFIX}${keyId}`);
      if (data) {
        const key = deserializeStoredKey(data);
        metadata.push(key.metadata);
      }
    }

    return metadata.sort((a, b) => b.version - a.version);
  }

  /**
   * Retires a key, making it unavailable for new operations.
   */
  async retireKey(keyId: string, reason: string): Promise<void> {
    this.ensureInitialized();
    logger.info({ keyId, reason }, 'Retiring key');

    const redis = this.getRedis();
    const key = await this.getKeyById(keyId);

    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    if (key.metadata.status === 'retired') {
      throw new Error(`Key ${keyId} is already retired`);
    }

    key.metadata.status = 'retired';
    key.metadata.retiredAt = new Date();

    await redis.set(`${KEY_PREFIX}${keyId}`, serializeStoredKey(key));

    logger.info({ keyId, reason }, 'Key retired successfully');
  }

  /**
   * Marks a key as compromised, immediately revoking it.
   */
  async compromiseKey(keyId: string, reason: string): Promise<void> {
    this.ensureInitialized();
    logger.warn({ keyId, reason }, 'SECURITY: Marking key as compromised');

    const redis = this.getRedis();
    const key = await this.getKeyById(keyId);

    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    key.metadata.status = 'compromised';
    key.metadata.retiredAt = new Date();

    await redis.set(`${KEY_PREFIX}${keyId}`, serializeStoredKey(key));

    logger.warn({ keyId, reason }, 'SECURITY: Key marked as compromised - immediate revocation');
  }

  /**
   * Configures and starts automatic key rotation scheduling.
   */
  scheduleRotation(config: KeyRotationConfig): void {
    this.ensureInitialized();
    this.config = { ...this.config, ...config };

    logger.info({ config: this.config }, 'Configuring rotation schedule');

    // Clear existing timers
    for (const timer of this.rotationTimers.values()) {
      clearInterval(timer);
    }
    this.rotationTimers.clear();

    if (!this.config.autoRotate) {
      logger.info('Auto-rotation disabled');
      return;
    }

    // Set up rotation checks for each key type
    const keyTypes: KeyType[] = ['signing', 'encryption', 'jwt'];

    for (const type of keyTypes) {
      const checkInterval = 24 * 60 * 60 * 1000; // Daily check

      const timer = setInterval(async () => {
        try {
          await this.checkAndRotate(type);
        } catch (error) {
          logger.error({ error, type }, 'Auto-rotation check failed');
        }
      }, checkInterval);

      this.rotationTimers.set(type, timer);

      // Also run an immediate check
      this.checkAndRotate(type).catch((error) => {
        logger.error({ error, type }, 'Initial rotation check failed');
      });
    }

    logger.info('Auto-rotation scheduled for all key types');
  }

  /**
   * Checks if a key type needs rotation and performs it if necessary.
   */
  private async checkAndRotate(type: KeyType): Promise<void> {
    const activeKey = await this.getActiveKey(type);

    if (!activeKey) {
      logger.info({ type }, 'No active key found, generating initial key');
      await this.generateKey(type);
      return;
    }

    const now = new Date();
    const expiresAt = activeKey.metadata.expiresAt;

    if (!expiresAt) {
      logger.warn({ type, keyId: activeKey.metadata.id }, 'Active key has no expiration date');
      return;
    }

    const daysUntilExpiration = daysBetween(now, expiresAt);

    // Check if we need to notify
    if (daysUntilExpiration <= this.config.notifyBeforeDays && daysUntilExpiration > 0) {
      logger.warn(
        { type, keyId: activeKey.metadata.id, daysUntilExpiration },
        'Key approaching expiration - notification would be sent'
      );
    }

    // Check if rotation is needed
    if (daysUntilExpiration <= 0) {
      logger.info({ type, keyId: activeKey.metadata.id }, 'Key expired, initiating rotation');
      await this.rotateKey(type);
    }
  }

  /**
   * Gets the current rotation status for all key types.
   */
  async getRotationStatus(): Promise<RotationStatus[]> {
    this.ensureInitialized();

    const keyTypes: KeyType[] = ['signing', 'encryption', 'jwt'];
    const statuses: RotationStatus[] = [];

    for (const type of keyTypes) {
      const activeKey = await this.getActiveKey(type);
      const activeKeys = await this.getActiveKeys(type);
      const rotatingKeys = activeKeys.filter((k) => k.metadata.status === 'rotating');

      const now = new Date();
      let daysUntilExpiration: number | null = null;
      let rotationNeeded = false;
      let nextScheduledRotation: Date | null = null;
      let lastRotation: Date | null = null;

      if (activeKey?.metadata.expiresAt) {
        daysUntilExpiration = daysBetween(now, activeKey.metadata.expiresAt);
        rotationNeeded = daysUntilExpiration <= 0;
        nextScheduledRotation = activeKey.metadata.expiresAt;
      }

      // Find last rotation from key history
      const allVersions = await this.getAllKeyVersions(type);
      const rotatedKeys = allVersions.filter((k) => k.rotatedAt);
      if (rotatedKeys.length > 0) {
        lastRotation = rotatedKeys.reduce((latest, key) => {
          if (!key.rotatedAt) return latest;
          return !latest || key.rotatedAt > latest ? key.rotatedAt : latest;
        }, null as Date | null);
      }

      statuses.push({
        type,
        activeKey: activeKey?.metadata ?? null,
        keysInGracePeriod: rotatingKeys.length,
        daysUntilExpiration,
        rotationNeeded,
        rotationInProgress: rotatingKeys.length > 0,
        lastRotation,
        nextScheduledRotation,
      });
    }

    return statuses;
  }

  /**
   * Stops all scheduled rotation timers.
   */
  shutdown(): void {
    logger.info('Shutting down KeyRotationManager');
    for (const timer of this.rotationTimers.values()) {
      clearInterval(timer);
    }
    this.rotationTimers.clear();
    this.initialized = false;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: KeyRotationManager | null = null;

/**
 * Gets the singleton instance of the KeyRotationManager.
 */
export function getKeyRotationManager(): KeyRotationManager {
  if (!instance) {
    instance = new KeyRotationManager();
  }
  return instance;
}

/**
 * Resets the singleton instance (primarily for testing).
 */
export function resetKeyRotationManager(): void {
  if (instance) {
    instance.shutdown();
  }
  instance = null;
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_CONFIG as defaultKeyRotationConfig };
