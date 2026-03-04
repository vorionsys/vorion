/**
 * API Key Management Service
 *
 * Core service for API key lifecycle management including:
 * - Cryptographically secure key generation
 * - Secure key storage (hashed only)
 * - Key validation with timing-safe comparison
 * - Scope checking
 * - Rate limit tracking per key
 * - Key rotation
 * - Expiration checking
 * - Audit logging integration
 *
 * Security Design:
 * - Raw API keys are NEVER stored or logged
 * - Keys are hashed using SHA-256 before storage
 * - Validation uses timing-safe comparison
 * - Key format: vak_${prefix}_${secret}
 *
 * @packageDocumentation
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { createLogger } from '../../common/logger.js';
import { secureRandomString } from '../../common/random.js';
import { VorionError, NotFoundError, UnauthorizedError, ForbiddenError } from '../../common/errors.js';
import {
  type ApiKey,
  type ApiKeyScope,
  type ApiKeyRateLimit,
  type CreateApiKeyInput,
  type UpdateApiKeyInput,
  type ApiKeyValidationResult,
  type ApiKeyCreationResult,
  type ApiKeyListFilters,
  type ApiKeyRateLimitState,
  type ApiKeyRateLimitResult,
  ApiKeyValidationErrorCode,
  ApiKeyStatus,
  ApiKeyAuditEventType,
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_PATTERN,
  DEFAULT_API_KEY_RATE_LIMIT,
  createApiKeyInputSchema,
  updateApiKeyInputSchema,
} from './types.js';
import { type IApiKeyStore, getApiKeyStore } from './store.js';
import {
  type ApiKeyMetadataCache,
  type CachedApiKeyMetadata,
  getApiKeyMetadataCache,
} from './cache.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
  type SecurityRequestContext,
} from '../../audit/security-logger.js';
import type { SecurityActor, SecurityResource } from '../../audit/security-events.js';

const logger = createLogger({ component: 'api-key-service' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Base error class for API key operations
 */
export class ApiKeyError extends VorionError {
  override code = 'API_KEY_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ApiKeyError';
  }
}

/**
 * Error thrown when API key validation fails
 */
export class ApiKeyValidationError extends ApiKeyError {
  override code = 'API_KEY_VALIDATION_ERROR';
  override statusCode = 401;

  constructor(
    message: string,
    public readonly errorCode: ApiKeyValidationErrorCode,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, errorCode });
    this.name = 'ApiKeyValidationError';
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class ApiKeyRateLimitError extends ApiKeyError {
  override code = 'API_KEY_RATE_LIMITED';
  override statusCode = 429;

  constructor(
    message: string,
    public readonly retryAfter: number,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, retryAfter });
    this.name = 'ApiKeyRateLimitError';
  }
}

// =============================================================================
// AUDIT INTERFACE
// =============================================================================

/**
 * Audit logging interface (legacy - use SecurityAuditLogger for new code)
 */
export interface IAuditLogger {
  record(input: {
    tenantId: string;
    eventType: string;
    actor: { type: 'user' | 'agent' | 'service' | 'system'; id: string; name?: string };
    target: { type: string; id: string; name?: string };
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Build security actor from available context
 */
function buildSecurityActor(
  actorId: string,
  tenantId: string,
  actorType: 'user' | 'agent' | 'service' | 'system' = 'user',
  context?: SecurityRequestContext
): SecurityActor {
  return {
    type: actorType,
    id: actorId,
    tenantId,
    ip: context?.ip,
    userAgent: context?.userAgent,
    sessionId: context?.sessionId,
  };
}

// =============================================================================
// SERVICE
// =============================================================================

/**
 * API Key Service Dependencies
 */
export interface ApiKeyServiceDependencies {
  /** API key store */
  store?: IApiKeyStore;
  /** Audit logger (legacy) */
  auditLogger?: IAuditLogger;
  /** Security audit logger (preferred) */
  securityLogger?: SecurityAuditLogger;
  /** API key metadata cache */
  cache?: ApiKeyMetadataCache;
}

/**
 * API Key Management Service
 */
export class ApiKeyService {
  private store: IApiKeyStore;
  private auditLogger?: IAuditLogger;
  private securityLogger: SecurityAuditLogger;
  private cache: ApiKeyMetadataCache;

  constructor(deps: ApiKeyServiceDependencies = {}) {
    this.store = deps.store ?? getApiKeyStore();
    this.auditLogger = deps.auditLogger;
    this.securityLogger = deps.securityLogger ?? getSecurityAuditLogger();
    this.cache = deps.cache ?? getApiKeyMetadataCache();
  }

  // ===========================================================================
  // KEY GENERATION
  // ===========================================================================

  /**
   * Generate a cryptographically secure API key
   *
   * Key format: vak_${prefix}_${secret}
   * - vak: Vorion API Key identifier
   * - prefix: 8 character alphanumeric identifier (for lookup)
   * - secret: 43 character base64url encoded random bytes (32 bytes)
   *
   * @returns Object with full key and its components
   */
  private generateApiKey(): { fullKey: string; prefix: string; hash: string } {
    // Generate 8 char prefix for lookup (alphanumeric only)
    const prefix = secureRandomString(API_KEY_PREFIX_LENGTH);

    // Generate 32 bytes of cryptographically secure random data
    const secretBytes = randomBytes(32);
    const secret = secretBytes.toString('base64url');

    // Construct full key
    const fullKey = `${API_KEY_PREFIX}_${prefix}_${secret}`;

    // Hash the full key for storage
    const hash = this.hashKey(fullKey);

    return { fullKey, prefix, hash };
  }

  /**
   * Hash an API key using SHA-256
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  /**
   * Parse an API key into its components
   */
  private parseKey(key: string): { prefix: string; secret: string } | null {
    if (!API_KEY_PATTERN.test(key)) {
      return null;
    }

    const parts = key.split('_');
    if (parts.length !== 3) {
      return null;
    }

    return {
      prefix: parts[1]!,
      secret: parts[2]!,
    };
  }

  // ===========================================================================
  // CRUD OPERATIONS
  // ===========================================================================

  /**
   * Create a new API key
   *
   * @param input - Key creation parameters
   * @returns The created key record and raw key (shown only once)
   */
  async create(input: CreateApiKeyInput): Promise<ApiKeyCreationResult> {
    // Validate input
    const validated = createApiKeyInputSchema.parse(input);

    // Generate key
    const { fullKey, prefix, hash } = this.generateApiKey();

    // Calculate expiration
    let expiresAt: Date | null = null;
    if (validated.expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + validated.expiresInDays);
    }

    // Build rate limit config
    const rateLimit: ApiKeyRateLimit = {
      ...DEFAULT_API_KEY_RATE_LIMIT,
      ...validated.rateLimit,
    };

    // Create key record
    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      name: validated.name,
      hashedKey: hash,
      prefix,
      tenantId: validated.tenantId,
      scopes: validated.scopes,
      rateLimit,
      status: ApiKeyStatus.ACTIVE,
      expiresAt,
      createdAt: new Date(),
      lastUsedAt: null,
      metadata: validated.metadata ?? {},
      createdBy: validated.createdBy,
      description: validated.description,
      allowedIps: validated.allowedIps,
    };

    // Store key
    await this.store.create(apiKey);

    // Security audit log (never log the raw key)
    const actor = buildSecurityActor(validated.createdBy, apiKey.tenantId);
    await this.securityLogger.logApiKeyCreated(
      actor,
      apiKey.id,
      apiKey.name,
      apiKey.scopes,
      {
        prefix: apiKey.prefix,
        expiresAt: apiKey.expiresAt?.toISOString(),
      }
    );

    // Legacy audit log for backward compatibility
    await this.audit({
      tenantId: apiKey.tenantId,
      eventType: ApiKeyAuditEventType.CREATED,
      actorId: validated.createdBy,
      targetId: apiKey.id,
      targetName: apiKey.name,
      action: 'create',
      outcome: 'success',
      metadata: {
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt?.toISOString(),
      },
    });

    logger.info(
      {
        keyId: apiKey.id,
        prefix: apiKey.prefix,
        tenantId: apiKey.tenantId,
        scopes: apiKey.scopes,
      },
      'API key created'
    );

    return { apiKey, rawKey: fullKey };
  }

  /**
   * Get an API key by ID
   */
  async getById(id: string, tenantId: string): Promise<ApiKey | null> {
    const apiKey = await this.store.getById(id);

    if (!apiKey || apiKey.tenantId !== tenantId) {
      return null;
    }

    return apiKey;
  }

  /**
   * Update an API key
   */
  async update(
    id: string,
    tenantId: string,
    input: UpdateApiKeyInput,
    updatedBy: string
  ): Promise<ApiKey> {
    // Validate input
    const validated = updateApiKeyInputSchema.parse(input);

    // Get existing key
    const existing = await this.store.getById(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    // Build updates
    const updates: Partial<ApiKey> = {};

    if (validated.name !== undefined) {
      updates.name = validated.name;
    }

    if (validated.scopes !== undefined) {
      updates.scopes = validated.scopes;
    }

    if (validated.rateLimit !== undefined) {
      updates.rateLimit = {
        ...existing.rateLimit,
        ...validated.rateLimit,
      };
    }

    if (validated.metadata !== undefined) {
      updates.metadata = {
        ...existing.metadata,
        ...validated.metadata,
      };
    }

    if (validated.description !== undefined) {
      updates.description = validated.description;
    }

    if (validated.allowedIps !== undefined) {
      updates.allowedIps = validated.allowedIps;
    }

    if (validated.status !== undefined) {
      updates.status = validated.status;
    }

    // Update in store
    const updated = await this.store.update(id, updates);
    if (!updated) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    // Invalidate cache to ensure fresh data is fetched
    await this.cache.invalidate(
      existing.prefix,
      id,
      tenantId,
      'update',
      `Key updated: ${Object.keys(validated).join(', ')}`
    );

    // Audit log
    await this.audit({
      tenantId,
      eventType: ApiKeyAuditEventType.UPDATED,
      actorId: updatedBy,
      targetId: id,
      targetName: updated.name,
      action: 'update',
      outcome: 'success',
      metadata: {
        updates: Object.keys(validated),
      },
    });

    logger.info({ keyId: id, updates: Object.keys(validated) }, 'API key updated');

    return updated;
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string, tenantId: string, revokedBy: string, reason?: string): Promise<ApiKey> {
    const apiKey = await this.store.getById(id);
    if (!apiKey || apiKey.tenantId !== tenantId) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    const updated = await this.store.update(id, {
      status: ApiKeyStatus.REVOKED,
      metadata: {
        ...apiKey.metadata,
        revokedBy,
        revokedAt: new Date().toISOString(),
        revocationReason: reason,
      },
    });

    if (!updated) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    // Invalidate cache immediately to prevent revoked key from being used
    await this.cache.invalidate(
      apiKey.prefix,
      id,
      tenantId,
      'revoke',
      reason ?? 'Manual revocation'
    );

    // Security audit log
    const actor = buildSecurityActor(revokedBy, tenantId);
    await this.securityLogger.logApiKeyRevoked(actor, id, apiKey.name, reason ?? 'Manual revocation');

    // Legacy audit log for backward compatibility
    await this.audit({
      tenantId,
      eventType: ApiKeyAuditEventType.REVOKED,
      actorId: revokedBy,
      targetId: id,
      targetName: apiKey.name,
      action: 'revoke',
      outcome: 'success',
      reason,
      metadata: { prefix: apiKey.prefix },
    });

    logger.info({ keyId: id, prefix: apiKey.prefix, revokedBy }, 'API key revoked');

    return updated;
  }

  /**
   * Delete an API key permanently
   */
  async delete(id: string, tenantId: string, deletedBy: string): Promise<void> {
    const apiKey = await this.store.getById(id);
    if (!apiKey || apiKey.tenantId !== tenantId) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    const deleted = await this.store.delete(id);
    if (!deleted) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    // Invalidate cache
    await this.cache.invalidate(
      apiKey.prefix,
      id,
      tenantId,
      'delete',
      'Key deleted'
    );

    // Audit log
    await this.audit({
      tenantId,
      eventType: ApiKeyAuditEventType.DELETED,
      actorId: deletedBy,
      targetId: id,
      targetName: apiKey.name,
      action: 'delete',
      outcome: 'success',
      metadata: { prefix: apiKey.prefix },
    });

    logger.info({ keyId: id, prefix: apiKey.prefix, deletedBy }, 'API key deleted');
  }

  /**
   * List API keys with filters
   */
  async list(filters: ApiKeyListFilters): Promise<{ keys: ApiKey[]; total: number }> {
    return this.store.list(filters);
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  /**
   * Validate an API key
   *
   * Uses a two-tier caching strategy for performance:
   * 1. Check in-memory LRU cache (< 0.1ms)
   * 2. Check Redis cache (< 1-2ms)
   * 3. Fall back to database lookup (10-30ms)
   *
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * @param rawKey - The raw API key to validate
   * @param clientIp - Optional client IP for whitelist validation
   * @returns Validation result
   */
  async validate(rawKey: string, clientIp?: string): Promise<ApiKeyValidationResult> {
    // Parse key format
    const parsed = this.parseKey(rawKey);
    if (!parsed) {
      return {
        valid: false,
        error: 'Invalid API key format',
        errorCode: ApiKeyValidationErrorCode.INVALID_FORMAT,
      };
    }

    // Try to get from cache first (hot path: < 1-2ms)
    const cached = await this.cache.get(parsed.prefix);
    if (cached) {
      return this.validateFromCache(cached, rawKey, clientIp);
    }

    // Cache miss - fall back to database lookup
    const apiKey = await this.store.getByPrefix(parsed.prefix);
    if (!apiKey) {
      return {
        valid: false,
        error: 'API key not found',
        errorCode: ApiKeyValidationErrorCode.NOT_FOUND,
      };
    }

    // Populate cache for subsequent requests
    await this.cache.set(apiKey);

    // Perform full validation
    return this.validateApiKey(apiKey, rawKey, clientIp);
  }

  /**
   * Validate API key from cached metadata
   *
   * Performs timing-safe hash comparison and status checks
   * using cached metadata.
   */
  private async validateFromCache(
    cached: CachedApiKeyMetadata,
    rawKey: string,
    clientIp?: string
  ): Promise<ApiKeyValidationResult> {
    // Timing-safe hash comparison
    const providedHash = this.hashKey(rawKey);
    const storedHashBuffer = Buffer.from(cached.keyHash, 'hex');
    const providedHashBuffer = Buffer.from(providedHash, 'hex');

    if (
      storedHashBuffer.length !== providedHashBuffer.length ||
      !timingSafeEqual(storedHashBuffer, providedHashBuffer)
    ) {
      // Security audit log validation failure (never log the provided key)
      const actor = buildSecurityActor('system', cached.tenantId, 'system', { ip: clientIp, tenantId: cached.tenantId });
      await this.securityLogger.logApiKeyValidation(
        actor,
        cached.id,
        cached.prefix, // Use prefix as name for cached validation
        false,
        'Hash mismatch',
        { prefix: cached.prefix, clientIp }
      );

      // Legacy audit log
      await this.audit({
        tenantId: cached.tenantId,
        eventType: ApiKeyAuditEventType.VALIDATION_FAILED,
        actorId: 'system',
        targetId: cached.id,
        targetName: cached.prefix,
        action: 'validate',
        outcome: 'failure',
        reason: 'Hash mismatch',
        metadata: { prefix: cached.prefix, clientIp },
      });

      return {
        valid: false,
        error: 'Invalid API key',
        errorCode: ApiKeyValidationErrorCode.HASH_MISMATCH,
      };
    }

    // Check status
    if (cached.status === ApiKeyStatus.REVOKED) {
      return {
        valid: false,
        error: 'API key has been revoked',
        errorCode: ApiKeyValidationErrorCode.REVOKED,
      };
    }

    // Check expiration
    if (cached.expiresAt && cached.expiresAt < Date.now()) {
      // Update status to expired and invalidate cache
      await this.store.update(cached.id, { status: ApiKeyStatus.EXPIRED });
      await this.cache.invalidate(
        cached.prefix,
        cached.id,
        cached.tenantId,
        'expire',
        'Key expired'
      );

      return {
        valid: false,
        error: 'API key has expired',
        errorCode: ApiKeyValidationErrorCode.EXPIRED,
      };
    }

    // Check IP whitelist
    if (cached.allowedIps && cached.allowedIps.length > 0 && clientIp) {
      if (!cached.allowedIps.includes(clientIp)) {
        // Security audit log
        const actor = buildSecurityActor('system', cached.tenantId, 'system', { ip: clientIp, tenantId: cached.tenantId });
        await this.securityLogger.logApiKeyValidation(
          actor,
          cached.id,
          cached.prefix,
          false,
          'IP not allowed',
          { prefix: cached.prefix, clientIp, allowedIps: cached.allowedIps }
        );

        // Legacy audit log
        await this.audit({
          tenantId: cached.tenantId,
          eventType: ApiKeyAuditEventType.VALIDATION_FAILED,
          actorId: 'system',
          targetId: cached.id,
          targetName: cached.prefix,
          action: 'validate',
          outcome: 'failure',
          reason: 'IP not allowed',
          metadata: { prefix: cached.prefix, clientIp },
        });

        return {
          valid: false,
          error: 'Client IP not allowed',
          errorCode: ApiKeyValidationErrorCode.IP_NOT_ALLOWED,
        };
      }
    }

    // Update last used timestamp asynchronously (don't block validation)
    this.store.updateLastUsed(cached.id).catch((error) => {
      logger.warn({ error, keyId: cached.id }, 'Failed to update last used timestamp');
    });

    // Reconstruct ApiKey from cached metadata for the result
    // Note: Some fields like name, createdAt, etc. are not cached
    // Callers needing full ApiKey should fetch from store if needed
    const apiKey: ApiKey = {
      id: cached.id,
      name: '', // Not cached - use prefix as fallback
      hashedKey: cached.keyHash,
      prefix: cached.prefix,
      tenantId: cached.tenantId,
      scopes: cached.scopes,
      rateLimit: cached.rateLimit,
      status: cached.status,
      expiresAt: cached.expiresAt ? new Date(cached.expiresAt) : null,
      createdAt: new Date(0), // Not cached
      lastUsedAt: null, // Not cached
      metadata: {},
      createdBy: '', // Not cached
      allowedIps: cached.allowedIps,
    };

    return {
      valid: true,
      apiKey,
    };
  }

  /**
   * Validate API key from full database record
   *
   * Used on cache miss after fetching from database.
   */
  private async validateApiKey(
    apiKey: ApiKey,
    rawKey: string,
    clientIp?: string
  ): Promise<ApiKeyValidationResult> {
    // Timing-safe hash comparison
    const providedHash = this.hashKey(rawKey);
    const storedHashBuffer = Buffer.from(apiKey.hashedKey, 'hex');
    const providedHashBuffer = Buffer.from(providedHash, 'hex');

    if (
      storedHashBuffer.length !== providedHashBuffer.length ||
      !timingSafeEqual(storedHashBuffer, providedHashBuffer)
    ) {
      // Security audit log validation failure (never log the provided key)
      const actor = buildSecurityActor('system', apiKey.tenantId, 'system', { ip: clientIp, tenantId: apiKey.tenantId });
      await this.securityLogger.logApiKeyValidation(
        actor,
        apiKey.id,
        apiKey.name,
        false,
        'Hash mismatch',
        { prefix: apiKey.prefix, clientIp }
      );

      // Legacy audit log
      await this.audit({
        tenantId: apiKey.tenantId,
        eventType: ApiKeyAuditEventType.VALIDATION_FAILED,
        actorId: 'system',
        targetId: apiKey.id,
        targetName: apiKey.name,
        action: 'validate',
        outcome: 'failure',
        reason: 'Hash mismatch',
        metadata: { prefix: apiKey.prefix, clientIp },
      });

      return {
        valid: false,
        error: 'Invalid API key',
        errorCode: ApiKeyValidationErrorCode.HASH_MISMATCH,
      };
    }

    // Check status
    if (apiKey.status === ApiKeyStatus.REVOKED) {
      return {
        valid: false,
        error: 'API key has been revoked',
        errorCode: ApiKeyValidationErrorCode.REVOKED,
      };
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      // Update status to expired
      await this.store.update(apiKey.id, { status: ApiKeyStatus.EXPIRED });

      return {
        valid: false,
        error: 'API key has expired',
        errorCode: ApiKeyValidationErrorCode.EXPIRED,
      };
    }

    // Check IP whitelist
    if (apiKey.allowedIps && apiKey.allowedIps.length > 0 && clientIp) {
      if (!apiKey.allowedIps.includes(clientIp)) {
        // Security audit log
        const actor = buildSecurityActor('system', apiKey.tenantId, 'system', { ip: clientIp, tenantId: apiKey.tenantId });
        await this.securityLogger.logApiKeyValidation(
          actor,
          apiKey.id,
          apiKey.name,
          false,
          'IP not allowed',
          { prefix: apiKey.prefix, clientIp, allowedIps: apiKey.allowedIps }
        );

        // Legacy audit log
        await this.audit({
          tenantId: apiKey.tenantId,
          eventType: ApiKeyAuditEventType.VALIDATION_FAILED,
          actorId: 'system',
          targetId: apiKey.id,
          targetName: apiKey.name,
          action: 'validate',
          outcome: 'failure',
          reason: 'IP not allowed',
          metadata: { prefix: apiKey.prefix, clientIp },
        });

        return {
          valid: false,
          error: 'Client IP not allowed',
          errorCode: ApiKeyValidationErrorCode.IP_NOT_ALLOWED,
        };
      }
    }

    // Update last used timestamp
    await this.store.updateLastUsed(apiKey.id);

    return {
      valid: true,
      apiKey,
    };
  }

  /**
   * Check if an API key has a required scope
   */
  hasScope(apiKey: ApiKey, requiredScope: ApiKeyScope): boolean {
    return apiKey.scopes.includes(requiredScope);
  }

  /**
   * Check if an API key has all required scopes
   */
  hasAllScopes(apiKey: ApiKey, requiredScopes: ApiKeyScope[]): boolean {
    return requiredScopes.every((scope) => apiKey.scopes.includes(scope));
  }

  /**
   * Check if an API key has any of the required scopes
   */
  hasAnyScope(apiKey: ApiKey, requiredScopes: ApiKeyScope[]): boolean {
    return requiredScopes.some((scope) => apiKey.scopes.includes(scope));
  }

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  /**
   * Check and consume rate limit for an API key
   */
  async checkRateLimit(apiKey: ApiKey): Promise<ApiKeyRateLimitResult> {
    const now = Date.now();
    const limits = apiKey.rateLimit;

    // Get or create rate limit state
    let state = await this.store.getRateLimitState(apiKey.id);
    if (!state) {
      state = this.createInitialRateLimitState(apiKey.id, now);
    }

    // Reset expired windows
    this.resetExpiredWindows(state, now);

    // Check limits
    const secondRemaining = limits.burstLimit - state.second.count;
    const minuteRemaining = limits.requestsPerMinute - state.minute.count;
    const hourRemaining = limits.requestsPerHour - state.hour.count;

    const allowed = secondRemaining > 0 && minuteRemaining > 0 && hourRemaining > 0;

    if (allowed) {
      // Consume one request
      state.second.count++;
      state.minute.count++;
      state.hour.count++;
    }

    // Save state
    await this.store.setRateLimitState(state);

    const result: ApiKeyRateLimitResult = {
      allowed,
      remaining: {
        minute: Math.max(0, minuteRemaining - (allowed ? 1 : 0)),
        hour: Math.max(0, hourRemaining - (allowed ? 1 : 0)),
        burst: Math.max(0, secondRemaining - (allowed ? 1 : 0)),
      },
      resetAt: {
        minute: state.minute.resetAt,
        hour: state.hour.resetAt,
        burst: state.second.resetAt,
      },
    };

    if (!allowed) {
      // Calculate retry-after based on which limit was hit
      if (secondRemaining <= 0) {
        result.retryAfter = Math.ceil((state.second.resetAt - now) / 1000);
      } else if (minuteRemaining <= 0) {
        result.retryAfter = Math.ceil((state.minute.resetAt - now) / 1000);
      } else {
        result.retryAfter = Math.ceil((state.hour.resetAt - now) / 1000);
      }

      // Security audit log rate limit
      const actor = buildSecurityActor('system', apiKey.tenantId, 'system', { tenantId: apiKey.tenantId });
      await this.securityLogger.logApiKeyRateLimited(
        actor,
        apiKey.id,
        apiKey.name,
        result.retryAfter ?? 60
      );

      // Legacy audit log
      await this.audit({
        tenantId: apiKey.tenantId,
        eventType: ApiKeyAuditEventType.RATE_LIMITED,
        actorId: 'system',
        targetId: apiKey.id,
        targetName: apiKey.name,
        action: 'rate_limit',
        outcome: 'failure',
        reason: 'Rate limit exceeded',
        metadata: {
          prefix: apiKey.prefix,
          remaining: result.remaining,
          retryAfter: result.retryAfter,
        },
      });

      logger.warn(
        {
          keyId: apiKey.id,
          prefix: apiKey.prefix,
          remaining: result.remaining,
          retryAfter: result.retryAfter,
        },
        'API key rate limit exceeded'
      );
    }

    return result;
  }

  /**
   * Create initial rate limit state
   */
  private createInitialRateLimitState(keyId: string, now: number): ApiKeyRateLimitState {
    return {
      keyId,
      minute: { count: 0, resetAt: now + 60000 },
      hour: { count: 0, resetAt: now + 3600000 },
      second: { count: 0, resetAt: now + 1000 },
    };
  }

  /**
   * Reset expired windows
   */
  private resetExpiredWindows(state: ApiKeyRateLimitState, now: number): void {
    if (now >= state.second.resetAt) {
      state.second = { count: 0, resetAt: now + 1000 };
    }
    if (now >= state.minute.resetAt) {
      state.minute = { count: 0, resetAt: now + 60000 };
    }
    if (now >= state.hour.resetAt) {
      state.hour = { count: 0, resetAt: now + 3600000 };
    }
  }

  // ===========================================================================
  // KEY ROTATION
  // ===========================================================================

  /**
   * Rotate an API key (create new key, optionally keep old valid for grace period)
   *
   * @param id - ID of the key to rotate
   * @param tenantId - Tenant ID
   * @param rotatedBy - User performing the rotation
   * @param gracePeriodMinutes - Optional grace period to keep old key valid
   * @returns New key creation result
   */
  async rotate(
    id: string,
    tenantId: string,
    rotatedBy: string,
    gracePeriodMinutes?: number
  ): Promise<ApiKeyCreationResult> {
    // Get existing key
    const existing = await this.store.getById(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError(`API key not found: ${id}`);
    }

    // Create new key with same config
    const newKeyResult = await this.create({
      name: `${existing.name} (rotated)`,
      tenantId: existing.tenantId,
      scopes: existing.scopes,
      rateLimit: existing.rateLimit,
      expiresInDays: existing.expiresAt
        ? Math.ceil((existing.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : undefined,
      metadata: {
        ...existing.metadata,
        rotatedFrom: existing.id,
        rotatedAt: new Date().toISOString(),
      },
      createdBy: rotatedBy,
      description: existing.description,
      allowedIps: existing.allowedIps,
    });

    // Handle old key based on grace period
    if (gracePeriodMinutes && gracePeriodMinutes > 0) {
      // Set expiration on old key for grace period
      const graceExpiration = new Date();
      graceExpiration.setMinutes(graceExpiration.getMinutes() + gracePeriodMinutes);

      await this.store.update(existing.id, {
        expiresAt: graceExpiration,
        name: `${existing.name} (deprecated)`,
        metadata: {
          ...existing.metadata,
          rotatedTo: newKeyResult.apiKey.id,
          rotatedAt: new Date().toISOString(),
          gracePeriodEnds: graceExpiration.toISOString(),
        },
      });

      logger.info(
        {
          oldKeyId: existing.id,
          newKeyId: newKeyResult.apiKey.id,
          gracePeriodMinutes,
        },
        'API key rotated with grace period'
      );
    } else {
      // Revoke old key immediately
      await this.revoke(existing.id, tenantId, rotatedBy, 'Key rotation');
    }

    // Security audit log
    const actor = buildSecurityActor(rotatedBy, tenantId);
    await this.securityLogger.logApiKeyRotated(
      actor,
      existing.id,
      newKeyResult.apiKey.id,
      existing.name,
      gracePeriodMinutes
    );

    // Legacy audit log
    await this.audit({
      tenantId,
      eventType: ApiKeyAuditEventType.ROTATED,
      actorId: rotatedBy,
      targetId: existing.id,
      targetName: existing.name,
      action: 'rotate',
      outcome: 'success',
      metadata: {
        oldKeyId: existing.id,
        newKeyId: newKeyResult.apiKey.id,
        gracePeriodMinutes,
      },
    });

    return newKeyResult;
  }

  // ===========================================================================
  // AUDIT HELPER
  // ===========================================================================

  /**
   * Record an audit event
   */
  private async audit(params: {
    tenantId: string;
    eventType: string;
    actorId: string;
    targetId: string;
    targetName: string;
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogger) {
      return;
    }

    try {
      await this.auditLogger.record({
        tenantId: params.tenantId,
        eventType: params.eventType,
        actor: { type: 'user', id: params.actorId },
        target: { type: 'api_key', id: params.targetId, name: params.targetName },
        action: params.action,
        outcome: params.outcome,
        reason: params.reason,
        metadata: params.metadata,
      });
    } catch (error) {
      // Don't fail the operation if audit logging fails
      logger.error({ error, params }, 'Failed to record audit event');
    }
  }
}

// =============================================================================
// FACTORY & SINGLETON
// =============================================================================

let service: ApiKeyService | null = null;

/**
 * Get the API key service singleton
 */
export function getApiKeyService(): ApiKeyService {
  if (!service) {
    service = new ApiKeyService();
    logger.info('API key service initialized');
  }
  return service;
}

/**
 * Create a new API key service instance
 */
export function createApiKeyService(deps?: ApiKeyServiceDependencies): ApiKeyService {
  return new ApiKeyService(deps);
}

/**
 * Reset the API key service singleton (for testing)
 */
export function resetApiKeyService(): void {
  service = null;
  logger.info('API key service singleton reset');
}
