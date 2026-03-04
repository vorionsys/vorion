/**
 * Secrets Rotation Service
 *
 * Manages automatic rotation of sensitive secrets like JWT signing keys,
 * encryption keys, and API credentials. Provides graceful rotation with
 * overlapping validity periods, audit logging, and event emission.
 *
 * Security Features:
 * - Never logs secret values
 * - Secure memory handling via SecureString/SecureBuffer
 * - Multiple active versions during rotation grace period
 * - Comprehensive audit trail for all operations
 * - Event emission for integration with monitoring systems
 *
 * @packageDocumentation
 * @module security/secrets-rotation
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';
import { encrypt, decrypt, type EncryptedEnvelope } from '../common/encryption.js';
import { SecureString, SecureBuffer } from './secure-memory.js';
import { getRedis } from '../common/redis.js';
import type { Redis } from 'ioredis';

const logger = createLogger({ component: 'secrets-rotation' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for secrets storage */
const SECRETS_PREFIX = 'vorion:secrets:';

/** Redis key prefix for secrets index */
const SECRETS_INDEX_PREFIX = 'vorion:secrets:index:';

/** Redis key prefix for rotation policies */
const POLICY_PREFIX = 'vorion:secrets:policy:';

/** Default check interval for rotation scheduler (1 hour) */
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** JWT secret entropy in bytes (256 bits) */
const JWT_SECRET_BYTES = 32;

/** AES-256 key length in bytes */
const AES_KEY_BYTES = 32;

/** API secret length in bytes */
const API_SECRET_BYTES = 32;

// =============================================================================
// Enums
// =============================================================================

/**
 * Types of secrets that can be managed by the rotation service
 */
export enum SecretType {
  JWT_SIGNING_KEY = 'jwt_signing_key',
  ENCRYPTION_KEY = 'encryption_key',
  API_SECRET = 'api_secret',
  SESSION_SECRET = 'session_secret',
  WEBHOOK_SECRET = 'webhook_secret',
}

// =============================================================================
// Zod Schemas
// =============================================================================

export const secretTypeSchema = z.nativeEnum(SecretType);

export const secretStatusSchema = z.enum(['active', 'rotating', 'deprecated', 'revoked']);
export type SecretStatus = z.infer<typeof secretStatusSchema>;

export const secretMetadataSchema = z.record(z.string(), z.unknown());

export const secretSchema = z.object({
  id: z.string().uuid(),
  type: secretTypeSchema,
  version: z.number().int().positive(),
  value: z.object({
    ciphertext: z.string(),
    iv: z.string(),
    authTag: z.string(),
    version: z.literal(1),
    kdfVersion: z.number().optional(),
  }),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  rotatedAt: z.coerce.date().optional(),
  status: secretStatusSchema,
  metadata: secretMetadataSchema.optional(),
});

export const rotationPolicySchema = z.object({
  secretType: secretTypeSchema,
  rotationIntervalDays: z.number().int().positive(),
  gracePeriodHours: z.number().int().nonnegative(),
  notifyBeforeDays: z.number().int().nonnegative(),
  autoRotate: z.boolean(),
  validationFn: z.function().args(z.string()).returns(z.boolean()).optional(),
});

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a managed secret with encrypted value
 */
export interface Secret {
  /** Unique identifier for the secret */
  id: string;
  /** Type of secret */
  type: SecretType;
  /** Version number (monotonically increasing) */
  version: number;
  /** Encrypted secret value */
  value: EncryptedEnvelope;
  /** When the secret was created */
  createdAt: Date;
  /** When the secret expires */
  expiresAt?: Date;
  /** When the secret was rotated (marked for retirement) */
  rotatedAt?: Date;
  /** Current status of the secret */
  status: SecretStatus;
  /** Custom metadata attributes */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for automatic secret rotation
 */
export interface RotationPolicy {
  /** Type of secret this policy applies to */
  secretType: SecretType;
  /** Days between rotations */
  rotationIntervalDays: number;
  /** Hours to keep old secret valid after rotation */
  gracePeriodHours: number;
  /** Days before expiration to send notification */
  notifyBeforeDays: number;
  /** Whether to automatically rotate secrets */
  autoRotate: boolean;
  /** Optional custom validation function for generated secrets */
  validationFn?: (value: string) => boolean;
}

/**
 * Events emitted by the secrets rotation service
 */
export interface SecretRotationEvents {
  'secret:registered': { secret: Omit<Secret, 'value'>; type: SecretType };
  'secret:rotated': { oldVersion: number; newVersion: number; type: SecretType };
  'secret:deprecated': { secretId: string; version: number; type: SecretType };
  'secret:revoked': { secretId: string; version: number; type: SecretType; reason: string };
  'secret:expiring': { secretId: string; version: number; type: SecretType; daysUntilExpiry: number };
  'rotation:scheduled': { type: SecretType; nextRotation: Date };
  'rotation:due': { type: SecretType; secretId: string };
  'rotation:error': { type: SecretType; error: Error };
}

/**
 * Input for registering a new secret
 */
export interface RegisterSecretInput {
  type: SecretType;
  value: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Result of checking which secrets need rotation
 */
export interface RotationDueResult {
  type: SecretType;
  secretId: string;
  version: number;
  daysUntilExpiry: number;
  needsRotation: boolean;
  needsNotification: boolean;
}

/**
 * Audit log entry for secret operations
 */
export interface SecretAuditEntry {
  timestamp: Date;
  operation: string;
  secretType: SecretType;
  secretId?: string;
  version?: number;
  actorId?: string;
  reason?: string;
  success: boolean;
  errorMessage?: string;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown for secrets rotation operations
 */
export class SecretsRotationError extends VorionError {
  override code = 'SECRETS_ROTATION_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'SecretsRotationError';
  }
}

/**
 * Error thrown when a secret is not found
 */
export class SecretNotFoundError extends VorionError {
  override code = 'SECRET_NOT_FOUND';
  override statusCode = 404;

  constructor(secretId: string, details?: Record<string, unknown>) {
    super(`Secret not found: ${secretId}`, { secretId, ...details });
    this.name = 'SecretNotFoundError';
  }
}

/**
 * Error thrown when secret validation fails
 */
export class SecretValidationError extends VorionError {
  override code = 'SECRET_VALIDATION_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'SecretValidationError';
  }
}

// =============================================================================
// Key Generation Utilities
// =============================================================================

/**
 * Generate a JWT signing secret with 256-bit entropy
 *
 * Uses cryptographically secure random bytes encoded as base64url
 * for safe use in JWT headers.
 *
 * @returns Base64url-encoded JWT secret
 */
export function generateJWTSecret(): string {
  const bytes = crypto.randomBytes(JWT_SECRET_BYTES);
  // Use base64url encoding for safe JWT usage
  return bytes.toString('base64url');
}

/**
 * Generate an AES-256 encryption key
 *
 * @returns Hex-encoded 256-bit key
 */
export function generateEncryptionKey(): string {
  const bytes = crypto.randomBytes(AES_KEY_BYTES);
  return bytes.toString('hex');
}

/**
 * Generate a URL-safe random API secret
 *
 * Uses base64url encoding for safe use in URLs and headers.
 *
 * @param length - Number of random bytes (default: 32)
 * @returns URL-safe base64-encoded secret
 */
export function generateAPISecret(length: number = API_SECRET_BYTES): string {
  const bytes = crypto.randomBytes(length);
  return bytes.toString('base64url');
}

/**
 * Generate a secret based on its type
 */
export function generateSecretByType(type: SecretType): string {
  switch (type) {
    case SecretType.JWT_SIGNING_KEY:
      return generateJWTSecret();
    case SecretType.ENCRYPTION_KEY:
      return generateEncryptionKey();
    case SecretType.API_SECRET:
    case SecretType.SESSION_SECRET:
    case SecretType.WEBHOOK_SECRET:
      return generateAPISecret();
    default:
      throw new SecretsRotationError(`Unknown secret type: ${type}`);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((date2.getTime() - date1.getTime()) / msPerDay);
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add hours to a date
 */
function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setTime(result.getTime() + hours * 60 * 60 * 1000);
  return result;
}

/**
 * Serialize a secret for Redis storage (without exposing the value)
 */
function serializeSecret(secret: Secret): string {
  return JSON.stringify({
    ...secret,
    createdAt: secret.createdAt.toISOString(),
    expiresAt: secret.expiresAt?.toISOString(),
    rotatedAt: secret.rotatedAt?.toISOString(),
  });
}

/**
 * Deserialize a secret from Redis storage
 */
function deserializeSecret(data: string): Secret {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    rotatedAt: parsed.rotatedAt ? new Date(parsed.rotatedAt) : undefined,
  };
}

/**
 * Create a safe version of a secret for logging (no value)
 */
function safeSecretForLogging(secret: Secret): Omit<Secret, 'value'> {
  const { value: _value, ...safe } = secret;
  return safe;
}

// =============================================================================
// Default Policies
// =============================================================================

/**
 * Default rotation policies for each secret type
 */
export const DEFAULT_ROTATION_POLICIES: Record<SecretType, RotationPolicy> = {
  [SecretType.JWT_SIGNING_KEY]: {
    secretType: SecretType.JWT_SIGNING_KEY,
    rotationIntervalDays: 30,
    gracePeriodHours: 24,
    notifyBeforeDays: 7,
    autoRotate: false,
  },
  [SecretType.ENCRYPTION_KEY]: {
    secretType: SecretType.ENCRYPTION_KEY,
    rotationIntervalDays: 90,
    gracePeriodHours: 168, // 7 days for encryption keys
    notifyBeforeDays: 14,
    autoRotate: false,
  },
  [SecretType.API_SECRET]: {
    secretType: SecretType.API_SECRET,
    rotationIntervalDays: 90,
    gracePeriodHours: 48,
    notifyBeforeDays: 7,
    autoRotate: false,
  },
  [SecretType.SESSION_SECRET]: {
    secretType: SecretType.SESSION_SECRET,
    rotationIntervalDays: 30,
    gracePeriodHours: 24,
    notifyBeforeDays: 7,
    autoRotate: false,
  },
  [SecretType.WEBHOOK_SECRET]: {
    secretType: SecretType.WEBHOOK_SECRET,
    rotationIntervalDays: 90,
    gracePeriodHours: 48,
    notifyBeforeDays: 7,
    autoRotate: false,
  },
};

// =============================================================================
// SecretsRotationService Class
// =============================================================================

/**
 * Service for managing automatic rotation of sensitive secrets
 *
 * Provides comprehensive secret lifecycle management including:
 * - Registration of secrets with automatic encryption
 * - Graceful rotation with overlapping validity periods
 * - Version tracking for rollback support
 * - Automatic scheduling and notification
 * - Full audit trail of all operations
 *
 * @example
 * ```typescript
 * const service = getSecretsRotationService();
 * await service.initialize();
 *
 * // Register a new JWT secret
 * const secret = await service.registerSecret({
 *   type: SecretType.JWT_SIGNING_KEY,
 *   value: generateJWTSecret(),
 * });
 *
 * // Get the active secret for signing
 * const activeSecret = await service.getActiveSecret(SecretType.JWT_SIGNING_KEY);
 * activeSecret.use((value) => {
 *   // Use the secret value
 * });
 *
 * // Rotate the secret
 * await service.rotateSecret(SecretType.JWT_SIGNING_KEY);
 * ```
 */
export class SecretsRotationService extends EventEmitter {
  private initialized = false;
  private redis: Redis | null = null;
  private policies: Map<SecretType, RotationPolicy> = new Map();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private auditLog: SecretAuditEntry[] = [];
  private checkIntervalMs: number = DEFAULT_CHECK_INTERVAL_MS;

  /**
   * Initialize the secrets rotation service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('SecretsRotationService already initialized');
      return;
    }

    logger.info('Initializing SecretsRotationService');

    this.redis = getRedis();
    this.initialized = true;

    // Load default policies
    for (const [type, policy] of Object.entries(DEFAULT_ROTATION_POLICIES)) {
      this.policies.set(type as SecretType, policy);
    }

    // Load custom policies from Redis
    await this.loadPoliciesFromStorage();

    logger.info('SecretsRotationService initialized successfully');
  }

  /**
   * Ensure the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.redis) {
      throw new SecretsRotationError(
        'SecretsRotationService not initialized. Call initialize() first.'
      );
    }
  }

  /**
   * Get the Redis client
   */
  private getRedis(): Redis {
    this.ensureInitialized();
    return this.redis!;
  }

  /**
   * Load custom policies from Redis storage
   */
  private async loadPoliciesFromStorage(): Promise<void> {
    const redis = this.getRedis();

    for (const type of Object.values(SecretType)) {
      const data = await redis.get(`${POLICY_PREFIX}${type}`);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const validated = rotationPolicySchema.safeParse(parsed);

          if (!validated.success) {
            logger.warn(
              {
                type,
                errors: validated.error.errors,
                operation: 'loadPoliciesFromStorage',
              },
              'Rotation policy validation failed, using default'
            );
            continue;
          }

          this.policies.set(type, validated.data as RotationPolicy);
          logger.debug({ type }, 'Loaded rotation policy from storage');
        } catch (error) {
          logger.warn(
            {
              type,
              error: error instanceof Error ? error.message : String(error),
              operation: 'loadPoliciesFromStorage',
            },
            'Failed to parse rotation policy from storage'
          );
        }
      }
    }
  }

  /**
   * Record an audit entry
   */
  private recordAudit(entry: Omit<SecretAuditEntry, 'timestamp'>): void {
    const fullEntry: SecretAuditEntry = {
      ...entry,
      timestamp: new Date(),
    };

    this.auditLog.push(fullEntry);

    // Keep audit log bounded (last 10000 entries)
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }

    // Log audit entry (never log secret values)
    const logLevel = entry.success ? 'info' : 'warn';
    logger[logLevel](
      {
        operation: entry.operation,
        secretType: entry.secretType,
        secretId: entry.secretId,
        version: entry.version,
        actorId: entry.actorId,
        success: entry.success,
      },
      `Secret operation: ${entry.operation}`
    );
  }

  /**
   * Get the next version number for a secret type
   */
  private async getNextVersion(type: SecretType): Promise<number> {
    const redis = this.getRedis();
    const indexKey = `${SECRETS_INDEX_PREFIX}${type}`;
    const secretIds = await redis.smembers(indexKey);

    if (secretIds.length === 0) {
      return 1;
    }

    let maxVersion = 0;
    for (const secretId of secretIds) {
      const data = await redis.get(`${SECRETS_PREFIX}${secretId}`);
      if (data) {
        const secret = deserializeSecret(data);
        if (secret.version > maxVersion) {
          maxVersion = secret.version;
        }
      }
    }

    return maxVersion + 1;
  }

  /**
   * Register a new secret for rotation management
   *
   * @param input - Secret registration input
   * @returns The registered secret (without value)
   */
  async registerSecret(input: RegisterSecretInput): Promise<Omit<Secret, 'value'>> {
    this.ensureInitialized();

    const { type, value, expiresAt, metadata } = input;
    const redis = this.getRedis();
    const policy = this.policies.get(type) ?? DEFAULT_ROTATION_POLICIES[type];

    // Validate the secret value if a validation function is provided
    if (policy.validationFn && !policy.validationFn(value)) {
      this.recordAudit({
        operation: 'register',
        secretType: type,
        success: false,
        errorMessage: 'Secret validation failed',
      });
      throw new SecretValidationError('Secret validation failed', { type });
    }

    const version = await this.getNextVersion(type);
    const id = crypto.randomUUID();
    const now = new Date();

    // Use SecureString for the value during encryption
    const secureValue = new SecureString(value);
    let encryptedValue: EncryptedEnvelope;

    try {
      encryptedValue = secureValue.use((v) => encrypt(v));
    } finally {
      secureValue.clear();
    }

    // Check if we should auto-activate (no active secret exists)
    const existingActive = await this.getActiveSecretInternal(type);
    const shouldActivate = !existingActive;

    const calculatedExpiresAt = expiresAt ?? addDays(now, policy.rotationIntervalDays);

    const secret: Secret = {
      id,
      type,
      version,
      value: encryptedValue,
      createdAt: now,
      expiresAt: calculatedExpiresAt,
      status: shouldActivate ? 'active' : 'deprecated',
      metadata,
    };

    // Store in Redis
    await redis.set(`${SECRETS_PREFIX}${id}`, serializeSecret(secret));
    await redis.sadd(`${SECRETS_INDEX_PREFIX}${type}`, id);

    // Set TTL (keep for 1 year after expiration for auditing)
    const ttlSeconds = (policy.rotationIntervalDays + 365) * 24 * 60 * 60;
    await redis.expire(`${SECRETS_PREFIX}${id}`, ttlSeconds);

    this.recordAudit({
      operation: 'register',
      secretType: type,
      secretId: id,
      version,
      success: true,
    });

    // Emit event
    const safeSecret = safeSecretForLogging(secret);
    this.emit('secret:registered', { secret: safeSecret, type });

    logger.info(
      { secretId: id, type, version, status: secret.status },
      'Secret registered successfully'
    );

    return safeSecret;
  }

  /**
   * Get a secret by ID (internal use only)
   */
  private async getSecretById(secretId: string): Promise<Secret | null> {
    const redis = this.getRedis();
    const data = await redis.get(`${SECRETS_PREFIX}${secretId}`);
    return data ? deserializeSecret(data) : null;
  }

  /**
   * Get the active secret internal (without SecureString wrapping)
   */
  private async getActiveSecretInternal(type: SecretType): Promise<Secret | null> {
    const redis = this.getRedis();
    const indexKey = `${SECRETS_INDEX_PREFIX}${type}`;
    const secretIds = await redis.smembers(indexKey);

    let activeSecret: Secret | null = null;
    let highestVersion = 0;

    for (const secretId of secretIds) {
      const data = await redis.get(`${SECRETS_PREFIX}${secretId}`);
      if (data) {
        const secret = deserializeSecret(data);
        if (secret.status === 'active' && secret.version > highestVersion) {
          activeSecret = secret;
          highestVersion = secret.version;
        }
      }
    }

    return activeSecret;
  }

  /**
   * Get the current active secret for a type
   *
   * Returns a SecureString containing the decrypted value for safe usage.
   *
   * @param type - Type of secret to retrieve
   * @returns SecureString containing the secret value, or null if not found
   */
  async getActiveSecret(type: SecretType): Promise<SecureString | null> {
    this.ensureInitialized();

    const secret = await this.getActiveSecretInternal(type);

    if (!secret) {
      logger.debug({ type }, 'No active secret found');
      return null;
    }

    // Decrypt and wrap in SecureString
    const decrypted = decrypt(secret.value);
    return new SecureString(decrypted);
  }

  /**
   * Get all secrets that are currently valid (active or rotating)
   *
   * This is useful during rotation when both old and new secrets need to be valid.
   *
   * @param type - Type of secrets to retrieve
   * @returns Array of valid secrets with SecureString values
   */
  async getValidSecrets(
    type: SecretType
  ): Promise<Array<{ metadata: Omit<Secret, 'value'>; value: SecureString }>> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const indexKey = `${SECRETS_INDEX_PREFIX}${type}`;
    const secretIds = await redis.smembers(indexKey);
    const validSecrets: Array<{ metadata: Omit<Secret, 'value'>; value: SecureString }> = [];

    for (const secretId of secretIds) {
      const data = await redis.get(`${SECRETS_PREFIX}${secretId}`);
      if (data) {
        const secret = deserializeSecret(data);
        if (secret.status === 'active' || secret.status === 'rotating') {
          const decrypted = decrypt(secret.value);
          validSecrets.push({
            metadata: safeSecretForLogging(secret),
            value: new SecureString(decrypted),
          });
        }
      }
    }

    // Sort by version descending (newest first)
    return validSecrets.sort((a, b) => b.metadata.version - a.metadata.version);
  }

  /**
   * Get all versions of a secret type for rollback support
   *
   * @param type - Type of secrets to retrieve
   * @returns Array of secret metadata (without values)
   */
  async getSecretVersions(type: SecretType): Promise<Array<Omit<Secret, 'value'>>> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const indexKey = `${SECRETS_INDEX_PREFIX}${type}`;
    const secretIds = await redis.smembers(indexKey);
    const secrets: Array<Omit<Secret, 'value'>> = [];

    for (const secretId of secretIds) {
      const data = await redis.get(`${SECRETS_PREFIX}${secretId}`);
      if (data) {
        const secret = deserializeSecret(data);
        secrets.push(safeSecretForLogging(secret));
      }
    }

    // Sort by version descending
    return secrets.sort((a, b) => b.version - a.version);
  }

  /**
   * Perform secret rotation
   *
   * Generates a new secret, marks the old one as rotating, and keeps both
   * valid during the grace period.
   *
   * @param type - Type of secret to rotate
   * @param customValue - Optional custom value for the new secret
   * @returns The new secret metadata
   */
  async rotateSecret(
    type: SecretType,
    customValue?: string
  ): Promise<Omit<Secret, 'value'>> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const policy = this.policies.get(type) ?? DEFAULT_ROTATION_POLICIES[type];

    logger.info({ type }, 'Starting secret rotation');

    // Get current active secret
    const currentActive = await this.getActiveSecretInternal(type);
    const now = new Date();

    // Mark current active as rotating
    if (currentActive) {
      currentActive.status = 'rotating';
      currentActive.rotatedAt = now;
      await redis.set(`${SECRETS_PREFIX}${currentActive.id}`, serializeSecret(currentActive));

      logger.info(
        { secretId: currentActive.id, version: currentActive.version },
        'Marked current secret as rotating'
      );

      // Schedule deprecation after grace period
      const graceMs = policy.gracePeriodHours * 60 * 60 * 1000;
      setTimeout(async () => {
        try {
          await this.deprecateVersion(currentActive.id, 'Grace period expired after rotation');
        } catch (error) {
          logger.error(
            { error, secretId: currentActive.id },
            'Failed to deprecate secret after grace period'
          );
        }
      }, graceMs);
    }

    // Generate or use provided value
    const newValue = customValue ?? generateSecretByType(type);

    // Register the new secret
    const newSecret = await this.registerSecret({
      type,
      value: newValue,
      metadata: { rotatedFrom: currentActive?.id },
    });

    // Ensure new secret is active
    const fullNewSecret = await this.getSecretById(newSecret.id);
    if (fullNewSecret && fullNewSecret.status !== 'active') {
      fullNewSecret.status = 'active';
      await redis.set(`${SECRETS_PREFIX}${fullNewSecret.id}`, serializeSecret(fullNewSecret));
    }

    this.recordAudit({
      operation: 'rotate',
      secretType: type,
      secretId: newSecret.id,
      version: newSecret.version,
      success: true,
      reason: currentActive ? `Rotated from version ${currentActive.version}` : 'Initial rotation',
    });

    // Emit event
    this.emit('secret:rotated', {
      oldVersion: currentActive?.version ?? 0,
      newVersion: newSecret.version,
      type,
    });

    logger.info(
      {
        type,
        oldVersion: currentActive?.version,
        newVersion: newSecret.version,
      },
      'Secret rotation completed'
    );

    return newSecret;
  }

  /**
   * Mark a secret version as deprecated
   *
   * Deprecated secrets can no longer be used for new operations but may still
   * be used for verification during a transition period.
   *
   * @param secretId - ID of the secret to deprecate
   * @param reason - Reason for deprecation
   */
  async deprecateVersion(secretId: string, reason?: string): Promise<void> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const secret = await this.getSecretById(secretId);

    if (!secret) {
      throw new SecretNotFoundError(secretId);
    }

    if (secret.status === 'deprecated' || secret.status === 'revoked') {
      logger.debug({ secretId }, 'Secret already deprecated or revoked');
      return;
    }

    secret.status = 'deprecated';
    await redis.set(`${SECRETS_PREFIX}${secretId}`, serializeSecret(secret));

    this.recordAudit({
      operation: 'deprecate',
      secretType: secret.type,
      secretId,
      version: secret.version,
      success: true,
      reason,
    });

    // Emit event
    this.emit('secret:deprecated', {
      secretId,
      version: secret.version,
      type: secret.type,
    });

    logger.info({ secretId, type: secret.type, version: secret.version, reason }, 'Secret deprecated');
  }

  /**
   * Immediately revoke a secret version
   *
   * Revoked secrets are immediately invalid and cannot be used for any operations.
   * Use this for emergency key compromise situations.
   *
   * @param secretId - ID of the secret to revoke
   * @param reason - Reason for revocation
   */
  async revokeVersion(secretId: string, reason: string): Promise<void> {
    this.ensureInitialized();

    const redis = this.getRedis();
    const secret = await this.getSecretById(secretId);

    if (!secret) {
      throw new SecretNotFoundError(secretId);
    }

    if (secret.status === 'revoked') {
      logger.debug({ secretId }, 'Secret already revoked');
      return;
    }

    secret.status = 'revoked';
    await redis.set(`${SECRETS_PREFIX}${secretId}`, serializeSecret(secret));

    this.recordAudit({
      operation: 'revoke',
      secretType: secret.type,
      secretId,
      version: secret.version,
      success: true,
      reason,
    });

    // Emit event
    this.emit('secret:revoked', {
      secretId,
      version: secret.version,
      type: secret.type,
      reason,
    });

    logger.warn(
      { secretId, type: secret.type, version: secret.version, reason },
      'SECURITY: Secret revoked - immediate invalidation'
    );
  }

  /**
   * Set or update a rotation policy for a secret type
   *
   * @param policy - The rotation policy to set
   */
  async setRotationPolicy(policy: RotationPolicy): Promise<void> {
    this.ensureInitialized();

    const redis = this.getRedis();

    // Validate policy
    rotationPolicySchema.parse(policy);

    this.policies.set(policy.secretType, policy);
    await redis.set(`${POLICY_PREFIX}${policy.secretType}`, JSON.stringify(policy));

    this.recordAudit({
      operation: 'set_policy',
      secretType: policy.secretType,
      success: true,
    });

    logger.info({ type: policy.secretType, policy: { ...policy, validationFn: undefined } }, 'Rotation policy updated');
  }

  /**
   * Get the rotation policy for a secret type
   *
   * @param type - Type of secret
   * @returns The rotation policy
   */
  getRotationPolicy(type: SecretType): RotationPolicy {
    return this.policies.get(type) ?? DEFAULT_ROTATION_POLICIES[type];
  }

  /**
   * Check which secrets need rotation or notification
   *
   * @returns Array of rotation due results
   */
  async checkRotationDue(): Promise<RotationDueResult[]> {
    this.ensureInitialized();

    const results: RotationDueResult[] = [];
    const now = new Date();

    for (const type of Object.values(SecretType)) {
      const policy = this.policies.get(type) ?? DEFAULT_ROTATION_POLICIES[type];
      const activeSecret = await this.getActiveSecretInternal(type);

      if (!activeSecret) {
        // No active secret - needs rotation to create one
        results.push({
          type,
          secretId: '',
          version: 0,
          daysUntilExpiry: 0,
          needsRotation: true,
          needsNotification: false,
        });

        this.emit('rotation:due', { type, secretId: '' });
        continue;
      }

      const expiresAt = activeSecret.expiresAt;
      if (!expiresAt) {
        continue;
      }

      const daysUntilExpiry = daysBetween(now, expiresAt);
      const needsRotation = daysUntilExpiry <= 0;
      const needsNotification = daysUntilExpiry <= policy.notifyBeforeDays && daysUntilExpiry > 0;

      results.push({
        type,
        secretId: activeSecret.id,
        version: activeSecret.version,
        daysUntilExpiry,
        needsRotation,
        needsNotification,
      });

      if (needsNotification) {
        this.emit('secret:expiring', {
          secretId: activeSecret.id,
          version: activeSecret.version,
          type,
          daysUntilExpiry,
        });
      }

      if (needsRotation) {
        this.emit('rotation:due', { type, secretId: activeSecret.id });
      }
    }

    return results;
  }

  /**
   * Schedule automatic rotation checks
   *
   * @param options - Scheduler options
   */
  scheduleRotation(options?: { checkIntervalMs?: number }): void {
    this.ensureInitialized();

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }

    this.checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

    logger.info({ checkIntervalMs: this.checkIntervalMs }, 'Scheduling automatic rotation checks');

    this.schedulerTimer = setInterval(async () => {
      try {
        await this.runScheduledRotationCheck();
      } catch (error) {
        logger.error({ error }, 'Scheduled rotation check failed');
      }
    }, this.checkIntervalMs);

    // Run an immediate check
    this.runScheduledRotationCheck().catch((error) => {
      logger.error({ error }, 'Initial rotation check failed');
    });
  }

  /**
   * Run a scheduled rotation check
   */
  private async runScheduledRotationCheck(): Promise<void> {
    const dueResults = await this.checkRotationDue();

    for (const result of dueResults) {
      const policy = this.policies.get(result.type) ?? DEFAULT_ROTATION_POLICIES[result.type];

      if (result.needsRotation && policy.autoRotate) {
        try {
          logger.info({ type: result.type }, 'Auto-rotating secret');
          await this.rotateSecret(result.type);
        } catch (error) {
          this.emit('rotation:error', { type: result.type, error: error as Error });
          logger.error({ error, type: result.type }, 'Auto-rotation failed');
        }
      }
    }
  }

  /**
   * Stop the rotation scheduler
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      logger.info('Rotation scheduler stopped');
    }
  }

  /**
   * Get the audit log
   *
   * @param filters - Optional filters
   * @returns Filtered audit entries
   */
  getAuditLog(filters?: {
    secretType?: SecretType;
    operation?: string;
    since?: Date;
    limit?: number;
  }): SecretAuditEntry[] {
    let entries = [...this.auditLog];

    if (filters?.secretType) {
      entries = entries.filter((e) => e.secretType === filters.secretType);
    }

    if (filters?.operation) {
      entries = entries.filter((e) => e.operation === filters.operation);
    }

    if (filters?.since) {
      entries = entries.filter((e) => e.timestamp >= filters.since!);
    }

    if (filters?.limit) {
      entries = entries.slice(-filters.limit);
    }

    return entries;
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    logger.info('Shutting down SecretsRotationService');
    this.stopScheduler();
    this.removeAllListeners();
    this.initialized = false;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: SecretsRotationService | null = null;

/**
 * Get the singleton instance of the SecretsRotationService
 */
export function getSecretsRotationService(): SecretsRotationService {
  if (!instance) {
    instance = new SecretsRotationService();
  }
  return instance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export function resetSecretsRotationService(): void {
  if (instance) {
    instance.shutdown();
  }
  instance = null;
}

// =============================================================================
// Typed Event Emitter Helper
// =============================================================================

/**
 * Type-safe event listener registration
 */
export type SecretRotationEventHandler<K extends keyof SecretRotationEvents> = (
  payload: SecretRotationEvents[K]
) => void;

/**
 * Helper type for adding typed event listeners to the service
 */
export interface TypedSecretsRotationService {
  on<K extends keyof SecretRotationEvents>(
    event: K,
    listener: SecretRotationEventHandler<K>
  ): SecretsRotationService;
  once<K extends keyof SecretRotationEvents>(
    event: K,
    listener: SecretRotationEventHandler<K>
  ): SecretsRotationService;
  emit<K extends keyof SecretRotationEvents>(
    event: K,
    payload: SecretRotationEvents[K]
  ): boolean;
}
