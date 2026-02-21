/**
 * Unified Token Lifecycle Management Service
 *
 * Provides comprehensive token revocation across all token types:
 * - JWT access tokens
 * - Refresh tokens (via token families)
 * - API keys
 * - Sessions
 *
 * Supports cascade revocation triggers for security events:
 * - User role changes
 * - User account disabled
 * - Tenant suspension
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';
import { VorionError } from '../common/errors.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';
import { createTokenRevocationService, type TokenRevocationService } from '../common/token-revocation.js';
import { getRefreshTokenService, type RefreshTokenService } from './refresh-token.js';
import { getSessionStore, type SessionStore } from './session-store.js';
import { getApiKeyService, type ApiKeyService } from './api-keys/service.js';
import { getApiKeyMetadataCache } from './api-keys/cache.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../audit/security-logger.js';
import type { SecurityActor } from '../audit/security-events.js';
import type { Redis } from 'ioredis';

const logger = createLogger({ component: 'token-lifecycle' });

// =============================================================================
// Metrics
// =============================================================================

const bulkRevocationsTotal = new Counter({
  name: 'vorion_token_lifecycle_bulk_revocations_total',
  help: 'Total bulk token revocation operations',
  labelNames: ['trigger', 'outcome'] as const,
  registers: [vorionRegistry],
});

const tokensRevokedByType = new Counter({
  name: 'vorion_token_lifecycle_tokens_revoked_by_type_total',
  help: 'Total tokens revoked by type',
  labelNames: ['type'] as const, // jwt, refresh, api_key, session
  registers: [vorionRegistry],
});

const revocationDuration = new Histogram({
  name: 'vorion_token_lifecycle_revocation_duration_seconds',
  help: 'Duration of bulk revocation operations',
  labelNames: ['operation'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [vorionRegistry],
});

const activeRevocationCount = new Gauge({
  name: 'vorion_token_lifecycle_active_revocations',
  help: 'Number of active revocation operations in progress',
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Revocation reason types
 */
export type RevocationReason =
  | 'logout'
  | 'logout_all'
  | 'password_change'
  | 'password_reset'
  | 'role_change'
  | 'user_disabled'
  | 'user_deleted'
  | 'tenant_suspended'
  | 'security_incident'
  | 'session_hijack_detected'
  | 'manual_revocation'
  | 'device_removed';

/**
 * Revocation trigger events for cascade operations
 */
export type RevocationTrigger =
  | 'user.role_changed'
  | 'user.disabled'
  | 'user.deleted'
  | 'user.password_changed'
  | 'tenant.suspended'
  | 'security.incident';

/**
 * Result of a bulk revocation operation
 */
export interface BulkRevocationResult {
  /** Total tokens revoked across all types */
  totalRevoked: number;
  /** JWT tokens revoked */
  jwtTokensRevoked: number;
  /** Refresh token families revoked */
  refreshTokenFamiliesRevoked: number;
  /** API keys revoked */
  apiKeysRevoked: number;
  /** Sessions revoked */
  sessionsRevoked: number;
  /** Duration of the operation in milliseconds */
  durationMs: number;
  /** Any errors that occurred during revocation */
  errors: Array<{ type: string; error: string }>;
  /** Whether the operation was fully successful */
  success: boolean;
}

/**
 * Options for revocation operations
 */
export interface RevocationOptions {
  /** Reason for revocation */
  reason: RevocationReason;
  /** Actor performing the revocation */
  revokedBy: string;
  /** Specific token types to revoke (default: all) */
  tokenTypes?: Array<'jwt' | 'refresh' | 'api_key' | 'session'>;
  /** Session ID to exclude from revocation (for current session) */
  excludeSessionId?: string;
  /** Device ID to target (for device-specific revocation) */
  deviceId?: string;
  /** Additional metadata for audit logging */
  metadata?: Record<string, unknown>;
}

/**
 * Token lifecycle service configuration
 */
export interface TokenLifecycleConfig {
  /** Whether to use Redis pub/sub for cross-instance notification */
  enablePubSub?: boolean;
  /** Redis channel for revocation events */
  revocationChannel?: string;
  /** Default JWT token TTL for revocation tracking */
  defaultJwtTTLSeconds?: number;
}

const DEFAULT_CONFIG: Required<TokenLifecycleConfig> = {
  enablePubSub: true,
  revocationChannel: 'vorion:token:revocation',
  defaultJwtTTLSeconds: 3600, // 1 hour default
};

/**
 * Revocation event published via Redis pub/sub
 */
export interface RevocationEvent {
  type: 'user_all' | 'session' | 'device' | 'tenant';
  userId?: string;
  tenantId: string;
  sessionId?: string;
  deviceId?: string;
  reason: RevocationReason;
  revokedBy: string;
  timestamp: number;
  sourceInstance: string;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Token lifecycle operation error
 */
export class TokenLifecycleError extends VorionError {
  override code = 'TOKEN_LIFECYCLE_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'TokenLifecycleError';
  }
}

// =============================================================================
// Token Lifecycle Service
// =============================================================================

/**
 * Unified Token Lifecycle Management Service
 *
 * Provides comprehensive token revocation across all token types with
 * cascade revocation support for security events.
 *
 * @example
 * ```typescript
 * const lifecycle = getTokenLifecycleService();
 *
 * // Revoke all tokens for a user (e.g., on logout all)
 * const result = await lifecycle.revokeAllUserTokens(
 *   'user-123',
 *   'tenant-456',
 *   { reason: 'logout_all', revokedBy: 'user-123' }
 * );
 *
 * // Revoke tokens for a specific session
 * await lifecycle.revokeBySession('session-789');
 *
 * // Revoke tokens for a specific device
 * await lifecycle.revokeByDevice('user-123', 'device-abc');
 *
 * // Handle cascade revocation trigger
 * await lifecycle.handleCascadeRevocation('user.role_changed', {
 *   userId: 'user-123',
 *   tenantId: 'tenant-456',
 * });
 * ```
 */
export class TokenLifecycleService {
  private config: Required<TokenLifecycleConfig>;
  private redis: Redis | null = null;
  private subscriber: Redis | null = null;
  private isSubscribed: boolean = false;
  private readonly instanceId: string;

  private tokenRevocationService: TokenRevocationService;
  private refreshTokenService: RefreshTokenService;
  private sessionStore: SessionStore;
  private apiKeyService: ApiKeyService;
  private securityLogger: SecurityAuditLogger;

  constructor(
    config: TokenLifecycleConfig = {},
    deps?: {
      tokenRevocationService?: TokenRevocationService;
      refreshTokenService?: RefreshTokenService;
      sessionStore?: SessionStore;
      apiKeyService?: ApiKeyService;
      securityLogger?: SecurityAuditLogger;
    }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = crypto.randomUUID();

    // Initialize services
    this.tokenRevocationService = deps?.tokenRevocationService ?? createTokenRevocationService();
    this.refreshTokenService = deps?.refreshTokenService ?? getRefreshTokenService();
    this.sessionStore = deps?.sessionStore ?? getSessionStore();
    this.apiKeyService = deps?.apiKeyService ?? getApiKeyService();
    this.securityLogger = deps?.securityLogger ?? getSecurityAuditLogger();

    logger.info({ instanceId: this.instanceId }, 'Token lifecycle service initialized');
  }

  // ===========================================================================
  // Core Revocation Methods
  // ===========================================================================

  /**
   * Revoke all tokens for a user across all token types
   *
   * This is the primary method for comprehensive user token revocation.
   * Use cases:
   * - Logout from all devices
   * - Password change/reset
   * - Security incident response
   * - User account suspension
   *
   * @param userId - User ID to revoke tokens for
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @param options - Revocation options
   * @returns Bulk revocation result with counts per token type
   */
  async revokeAllUserTokens(
    userId: string,
    tenantId: string,
    options: RevocationOptions
  ): Promise<BulkRevocationResult> {
    const startTime = Date.now();
    activeRevocationCount.inc();

    const result: BulkRevocationResult = {
      totalRevoked: 0,
      jwtTokensRevoked: 0,
      refreshTokenFamiliesRevoked: 0,
      apiKeysRevoked: 0,
      sessionsRevoked: 0,
      durationMs: 0,
      errors: [],
      success: true,
    };

    const tokenTypes = options.tokenTypes ?? ['jwt', 'refresh', 'api_key', 'session'];

    logger.info(
      { userId, tenantId, reason: options.reason, tokenTypes },
      'Starting bulk token revocation for user'
    );

    try {
      // 1. Revoke JWT tokens (by setting user revocation timestamp)
      if (tokenTypes.includes('jwt')) {
        try {
          await this.tokenRevocationService.revokeAllForUser(userId, new Date());
          result.jwtTokensRevoked = 1; // We mark 1 since we set a revocation timestamp
          tokensRevokedByType.inc({ type: 'jwt' });
          logger.debug({ userId }, 'JWT tokens revoked via user timestamp');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({ type: 'jwt', error: errorMsg });
          logger.error({ error, userId }, 'Failed to revoke JWT tokens');
        }
      }

      // 2. Revoke refresh token families
      if (tokenTypes.includes('refresh')) {
        try {
          const count = await this.refreshTokenService.revokeAllForUser(
            userId,
            tenantId,
            `Bulk revocation: ${options.reason}`,
            options.revokedBy
          );
          result.refreshTokenFamiliesRevoked = count;
          result.totalRevoked += count;
          tokensRevokedByType.inc({ type: 'refresh' }, count);
          logger.debug({ userId, count }, 'Refresh token families revoked');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({ type: 'refresh', error: errorMsg });
          logger.error({ error, userId }, 'Failed to revoke refresh tokens');
        }
      }

      // 3. Revoke sessions
      if (tokenTypes.includes('session')) {
        try {
          const count = await this.sessionStore.revokeAllForUser(
            userId,
            `Bulk revocation: ${options.reason}`,
            options.revokedBy,
            options.excludeSessionId
          );
          result.sessionsRevoked = count;
          result.totalRevoked += count;
          tokensRevokedByType.inc({ type: 'session' }, count);
          logger.debug({ userId, count }, 'Sessions revoked');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({ type: 'session', error: errorMsg });
          logger.error({ error, userId }, 'Failed to revoke sessions');
        }
      }

      // 4. Revoke API keys (only for severe actions like user deletion/suspension)
      if (tokenTypes.includes('api_key') && this.shouldRevokeApiKeys(options.reason)) {
        try {
          const { keys } = await this.apiKeyService.list({ tenantId, createdBy: userId });
          for (const key of keys) {
            try {
              await this.apiKeyService.revoke(
                key.id,
                tenantId,
                options.revokedBy,
                `Bulk revocation: ${options.reason}`
              );
              result.apiKeysRevoked++;
              tokensRevokedByType.inc({ type: 'api_key' });
            } catch (keyError) {
              logger.warn({ error: keyError, keyId: key.id }, 'Failed to revoke individual API key');
            }
          }
          result.totalRevoked += result.apiKeysRevoked;
          logger.debug({ userId, count: result.apiKeysRevoked }, 'API keys revoked');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({ type: 'api_key', error: errorMsg });
          logger.error({ error, userId }, 'Failed to revoke API keys');
        }
      }

      result.durationMs = Date.now() - startTime;
      result.success = result.errors.length === 0;

      // Publish revocation event for cross-instance notification
      if (this.config.enablePubSub) {
        await this.publishRevocationEvent({
          type: 'user_all',
          userId,
          tenantId,
          reason: options.reason,
          revokedBy: options.revokedBy,
          timestamp: Date.now(),
          sourceInstance: this.instanceId,
        });
      }

      // Audit log
      const actor = this.buildActor(options.revokedBy, tenantId);
      await this.securityLogger.logSessionsBulkRevoked(
        actor,
        userId,
        result.totalRevoked,
        `Bulk revocation: ${options.reason}`
      );

      // Metrics
      bulkRevocationsTotal.inc({
        trigger: options.reason,
        outcome: result.success ? 'success' : 'partial',
      });
      revocationDuration.observe({ operation: 'revoke_all_user' }, result.durationMs / 1000);

      logger.info(
        {
          userId,
          tenantId,
          result: {
            totalRevoked: result.totalRevoked,
            jwtTokensRevoked: result.jwtTokensRevoked,
            refreshTokenFamiliesRevoked: result.refreshTokenFamiliesRevoked,
            sessionsRevoked: result.sessionsRevoked,
            apiKeysRevoked: result.apiKeysRevoked,
            durationMs: result.durationMs,
            errors: result.errors.length,
          },
        },
        'Bulk token revocation completed for user'
      );

      return result;
    } finally {
      activeRevocationCount.dec();
    }
  }

  /**
   * Revoke all tokens associated with a specific session
   *
   * @param sessionId - Session ID to revoke tokens for
   * @returns Whether the revocation was successful
   */
  async revokeBySession(sessionId: string): Promise<boolean> {
    const startTime = Date.now();

    logger.info({ sessionId }, 'Revoking tokens for session');

    try {
      // Get session details first
      const session = await this.sessionStore.get(sessionId);
      if (!session) {
        logger.warn({ sessionId }, 'Session not found for revocation');
        return false;
      }

      // Revoke the session
      const revoked = await this.sessionStore.revoke(sessionId, 'Session-specific revocation', 'system');

      if (revoked) {
        tokensRevokedByType.inc({ type: 'session' });

        // Publish revocation event
        if (this.config.enablePubSub) {
          await this.publishRevocationEvent({
            type: 'session',
            userId: session.userId,
            tenantId: session.tenantId,
            sessionId,
            reason: 'manual_revocation',
            revokedBy: 'system',
            timestamp: Date.now(),
            sourceInstance: this.instanceId,
          });
        }

        revocationDuration.observe(
          { operation: 'revoke_by_session' },
          (Date.now() - startTime) / 1000
        );

        logger.info({ sessionId, userId: session.userId }, 'Session revoked successfully');
      }

      return revoked;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to revoke session');
      return false;
    }
  }

  /**
   * Revoke all tokens for a specific device
   *
   * @param userId - User ID
   * @param deviceId - Device ID/fingerprint to revoke tokens for
   * @returns Bulk revocation result
   */
  async revokeByDevice(userId: string, deviceId: string): Promise<BulkRevocationResult> {
    const startTime = Date.now();
    activeRevocationCount.inc();

    const result: BulkRevocationResult = {
      totalRevoked: 0,
      jwtTokensRevoked: 0,
      refreshTokenFamiliesRevoked: 0,
      apiKeysRevoked: 0,
      sessionsRevoked: 0,
      durationMs: 0,
      errors: [],
      success: true,
    };

    logger.info({ userId, deviceId }, 'Revoking tokens for device');

    try {
      // 1. Revoke refresh token families for this device
      try {
        const families = await this.refreshTokenService.getFamiliesForUser(userId);
        for (const family of families) {
          if (family.deviceFingerprint === deviceId) {
            const revoked = await this.refreshTokenService.revokeFamily(
              family.familyId,
              'Device revocation',
              'system'
            );
            if (revoked) {
              result.refreshTokenFamiliesRevoked++;
              tokensRevokedByType.inc({ type: 'refresh' });
            }
          }
        }
        result.totalRevoked += result.refreshTokenFamiliesRevoked;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({ type: 'refresh', error: errorMsg });
        logger.error({ error, userId, deviceId }, 'Failed to revoke refresh tokens for device');
      }

      // 2. Revoke sessions for this device
      try {
        const sessions = await this.sessionStore.getSessionsForUser(userId);
        for (const session of sessions) {
          if (session.deviceFingerprint === deviceId) {
            const revoked = await this.sessionStore.revoke(
              session.id,
              'Device revocation',
              'system'
            );
            if (revoked) {
              result.sessionsRevoked++;
              tokensRevokedByType.inc({ type: 'session' });
            }
          }
        }
        result.totalRevoked += result.sessionsRevoked;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({ type: 'session', error: errorMsg });
        logger.error({ error, userId, deviceId }, 'Failed to revoke sessions for device');
      }

      result.durationMs = Date.now() - startTime;
      result.success = result.errors.length === 0;

      // Publish revocation event
      if (this.config.enablePubSub) {
        await this.publishRevocationEvent({
          type: 'device',
          userId,
          tenantId: '', // Will be filled by individual revocations
          deviceId,
          reason: 'device_removed',
          revokedBy: 'system',
          timestamp: Date.now(),
          sourceInstance: this.instanceId,
        });
      }

      revocationDuration.observe({ operation: 'revoke_by_device' }, result.durationMs / 1000);

      logger.info(
        {
          userId,
          deviceId,
          result: {
            totalRevoked: result.totalRevoked,
            refreshTokenFamiliesRevoked: result.refreshTokenFamiliesRevoked,
            sessionsRevoked: result.sessionsRevoked,
          },
        },
        'Device token revocation completed'
      );

      return result;
    } finally {
      activeRevocationCount.dec();
    }
  }

  // ===========================================================================
  // Cascade Revocation Triggers
  // ===========================================================================

  /**
   * Handle cascade revocation trigger events
   *
   * Called when security-relevant events occur that require token revocation:
   * - User role changes
   * - User account disabled
   * - Tenant suspended
   *
   * @param trigger - Type of trigger event
   * @param context - Event context with relevant IDs
   */
  async handleCascadeRevocation(
    trigger: RevocationTrigger,
    context: {
      userId?: string;
      tenantId: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<BulkRevocationResult | null> {
    logger.info({ trigger, context }, 'Handling cascade revocation trigger');

    switch (trigger) {
      case 'user.role_changed':
        if (!context.userId) {
          logger.warn({ trigger }, 'User ID required for role change trigger');
          return null;
        }
        // Revoke JWT tokens to force re-authentication with new role
        return this.revokeAllUserTokens(context.userId, context.tenantId, {
          reason: 'role_change',
          revokedBy: 'system',
          tokenTypes: ['jwt', 'refresh'], // Keep sessions but invalidate tokens
          metadata: context.metadata,
        });

      case 'user.disabled':
        if (!context.userId) {
          logger.warn({ trigger }, 'User ID required for user disabled trigger');
          return null;
        }
        // Revoke all tokens when user is disabled
        return this.revokeAllUserTokens(context.userId, context.tenantId, {
          reason: 'user_disabled',
          revokedBy: 'system',
          tokenTypes: ['jwt', 'refresh', 'api_key', 'session'],
          metadata: context.metadata,
        });

      case 'user.deleted':
        if (!context.userId) {
          logger.warn({ trigger }, 'User ID required for user deleted trigger');
          return null;
        }
        // Revoke all tokens when user is deleted
        return this.revokeAllUserTokens(context.userId, context.tenantId, {
          reason: 'user_deleted',
          revokedBy: 'system',
          tokenTypes: ['jwt', 'refresh', 'api_key', 'session'],
          metadata: context.metadata,
        });

      case 'user.password_changed':
        if (!context.userId) {
          logger.warn({ trigger }, 'User ID required for password change trigger');
          return null;
        }
        // Revoke refresh tokens and sessions on password change
        return this.revokeAllUserTokens(context.userId, context.tenantId, {
          reason: 'password_change',
          revokedBy: 'system',
          tokenTypes: ['jwt', 'refresh', 'session'],
          metadata: context.metadata,
        });

      case 'tenant.suspended':
        // Revoke all tokens for all users in the tenant
        return this.revokeAllTenantTokens(context.tenantId, 'tenant_suspended', 'system');

      case 'security.incident':
        if (!context.userId) {
          // Tenant-wide incident
          return this.revokeAllTenantTokens(context.tenantId, 'security_incident', 'system');
        }
        // User-specific incident
        return this.revokeAllUserTokens(context.userId, context.tenantId, {
          reason: 'security_incident',
          revokedBy: 'system',
          tokenTypes: ['jwt', 'refresh', 'api_key', 'session'],
          metadata: context.metadata,
        });

      default:
        logger.warn({ trigger }, 'Unknown cascade revocation trigger');
        return null;
    }
  }

  /**
   * Revoke all tokens for an entire tenant
   *
   * Use with caution - this affects all users in the tenant.
   *
   * @param tenantId - Tenant ID
   * @param reason - Revocation reason
   * @param revokedBy - Actor performing revocation
   */
  async revokeAllTenantTokens(
    tenantId: string,
    reason: RevocationReason,
    revokedBy: string
  ): Promise<BulkRevocationResult> {
    const startTime = Date.now();
    activeRevocationCount.inc();

    const result: BulkRevocationResult = {
      totalRevoked: 0,
      jwtTokensRevoked: 0,
      refreshTokenFamiliesRevoked: 0,
      apiKeysRevoked: 0,
      sessionsRevoked: 0,
      durationMs: 0,
      errors: [],
      success: true,
    };

    logger.warn({ tenantId, reason }, 'Starting tenant-wide token revocation');

    try {
      // Invalidate all API key cache entries for the tenant
      try {
        const cache = getApiKeyMetadataCache();
        const invalidatedCount = await cache.invalidateTenant(
          tenantId,
          `Tenant revocation: ${reason}`
        );
        result.apiKeysRevoked = invalidatedCount;
        result.totalRevoked += invalidatedCount;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({ type: 'api_key_cache', error: errorMsg });
        logger.error({ error, tenantId }, 'Failed to invalidate API key cache for tenant');
      }

      // Set tenant-wide revocation marker in Redis
      try {
        const redis = await this.getRedis();
        const key = `vorion:tenant:revoked:${tenantId}`;
        // Store with a long TTL to cover token lifetimes
        await redis.setex(key, 86400 * 7, Date.now().toString()); // 7 days
        logger.info({ tenantId }, 'Tenant revocation marker set');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({ type: 'tenant_marker', error: errorMsg });
        logger.error({ error, tenantId }, 'Failed to set tenant revocation marker');
      }

      // Publish tenant revocation event
      if (this.config.enablePubSub) {
        await this.publishRevocationEvent({
          type: 'tenant',
          tenantId,
          reason,
          revokedBy,
          timestamp: Date.now(),
          sourceInstance: this.instanceId,
        });
      }

      result.durationMs = Date.now() - startTime;
      result.success = result.errors.length === 0;

      bulkRevocationsTotal.inc({
        trigger: reason,
        outcome: result.success ? 'success' : 'partial',
      });
      revocationDuration.observe({ operation: 'revoke_tenant' }, result.durationMs / 1000);

      logger.warn(
        { tenantId, durationMs: result.durationMs, errors: result.errors.length },
        'Tenant-wide token revocation completed'
      );

      return result;
    } finally {
      activeRevocationCount.dec();
    }
  }

  // ===========================================================================
  // Revocation Status Checking
  // ===========================================================================

  /**
   * Check if a tenant has been revoked
   *
   * @param tenantId - Tenant ID to check
   * @returns Whether the tenant is revoked
   */
  async isTenantRevoked(tenantId: string): Promise<boolean> {
    try {
      const redis = await this.getRedis();
      const key = `vorion:tenant:revoked:${tenantId}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to check tenant revocation status');
      return false; // Fail open to avoid blocking legitimate requests
    }
  }

  /**
   * Check if a user's tokens were revoked after a specific time
   *
   * @param userId - User ID to check
   * @param issuedAt - Token issue time
   * @returns Whether the token should be considered revoked
   */
  async isUserTokenRevoked(userId: string, issuedAt: Date): Promise<boolean> {
    return this.tokenRevocationService.isUserTokenRevoked(userId, issuedAt);
  }

  // ===========================================================================
  // Redis Pub/Sub
  // ===========================================================================

  /**
   * Get Redis client
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();
      if (this.config.enablePubSub) {
        await this.subscribeToRevocations();
      }
    }
    return this.redis;
  }

  /**
   * Subscribe to revocation events from other instances
   */
  private async subscribeToRevocations(): Promise<void> {
    if (this.isSubscribed || this.subscriber) {
      return;
    }

    try {
      this.subscriber = getRedis().duplicate();
      await this.subscriber.subscribe(this.config.revocationChannel);

      this.subscriber.on('message', (channel, message) => {
        if (channel === this.config.revocationChannel) {
          this.handleRevocationEvent(message);
        }
      });

      this.isSubscribed = true;
      logger.info('Subscribed to token revocation events');
    } catch (error) {
      logger.warn({ error }, 'Failed to subscribe to revocation events');
    }
  }

  /**
   * Handle incoming revocation event from another instance
   */
  private handleRevocationEvent(message: string): void {
    try {
      const event = JSON.parse(message) as RevocationEvent;

      // Don't process our own events
      if (event.sourceInstance === this.instanceId) {
        return;
      }

      logger.debug(
        { type: event.type, userId: event.userId, tenantId: event.tenantId },
        'Received revocation event from another instance'
      );

      // The actual revocation has already been performed - this is just for
      // local cache invalidation if needed
    } catch (error) {
      logger.error({ error, message: message.substring(0, 200) }, 'Failed to parse revocation event');
    }
  }

  /**
   * Publish revocation event to other instances
   */
  private async publishRevocationEvent(event: RevocationEvent): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.publish(this.config.revocationChannel, JSON.stringify(event));
    } catch (error) {
      logger.warn({ error, event }, 'Failed to publish revocation event');
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Determine if API keys should be revoked based on reason
   */
  private shouldRevokeApiKeys(reason: RevocationReason): boolean {
    const severeReasons: RevocationReason[] = [
      'user_disabled',
      'user_deleted',
      'tenant_suspended',
      'security_incident',
    ];
    return severeReasons.includes(reason);
  }

  /**
   * Build security actor for audit logging
   */
  private buildActor(actorId: string, tenantId: string): SecurityActor {
    return {
      type: actorId === 'system' ? 'system' : 'user',
      id: actorId,
      tenantId,
    };
  }

  /**
   * Stop the service and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.config.revocationChannel);
      await this.subscriber.quit();
      this.subscriber = null;
      this.isSubscribed = false;
    }

    logger.info('Token lifecycle service stopped');
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let tokenLifecycleService: TokenLifecycleService | null = null;

/**
 * Get the token lifecycle service singleton
 */
export function getTokenLifecycleService(config?: TokenLifecycleConfig): TokenLifecycleService {
  if (!tokenLifecycleService) {
    tokenLifecycleService = new TokenLifecycleService(config);
    logger.info('Token lifecycle service singleton initialized');
  }
  return tokenLifecycleService;
}

/**
 * Create a new token lifecycle service instance (for testing)
 */
export function createTokenLifecycleService(
  config?: TokenLifecycleConfig,
  deps?: {
    tokenRevocationService?: TokenRevocationService;
    refreshTokenService?: RefreshTokenService;
    sessionStore?: SessionStore;
    apiKeyService?: ApiKeyService;
    securityLogger?: SecurityAuditLogger;
  }
): TokenLifecycleService {
  return new TokenLifecycleService(config, deps);
}

/**
 * Reset the token lifecycle service singleton (for testing)
 */
export async function resetTokenLifecycleService(): Promise<void> {
  if (tokenLifecycleService) {
    await tokenLifecycleService.stop();
    tokenLifecycleService = null;
  }
  logger.info('Token lifecycle service singleton reset');
}
