/**
 * SSO/OIDC Module for Vorion Platform
 *
 * Provides enterprise SSO capabilities with support for multiple OIDC providers
 * including Okta, Azure AD, Google, and generic OIDC implementations.
 *
 * Uses dynamic imports to work with ESM-only openid-client v6.
 *
 * SECURITY: Uses Redis-backed storage for SSO state and sessions to ensure
 * cluster-safe operation and prevent replay attacks.
 *
 * @module auth/sso
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import {
  type OIDCProvider,
  OIDCError,
  createOIDCProvider,
  clearAllDiscoveryCaches,
} from './oidc-provider.js';
import {
  type OIDCProviderConfig,
  type AuthorizationState,
  type AuthorizationUrlResult,
  type TokenExchangeRequest,
  type TokenExchangeResult,
  type TokenRefreshResult,
  type OIDCTokenSet,
  type IDTokenClaims,
  type OIDCUserInfo,
  type SSOSession,
  type JITProvisionedUser,
  type SSOAuditEvent,
  type SSOErrorCode,
  type SSOManagerConfig,
  OIDCProviderConfigSchema,
  DEFAULT_SSO_MANAGER_CONFIG,
} from './types.js';
import {
  RedisStateStore,
  createRedisStateStore,
  type RedisStateStoreConfig,
  type ConsumeStateResult,
} from './redis-state-store.js';
import {
  RedisSessionStore,
  createRedisSessionStore,
  type RedisSessionStoreConfig,
  type SessionValidationResult,
} from './redis-session-store.js';

const logger = createLogger({ component: 'sso' });

// =============================================================================
// SSO Error (extends OIDCError for consistency)
// =============================================================================

export { OIDCError } from './oidc-provider.js';

/**
 * SSO Manager Error
 */
export class SSOError extends OIDCError {
  constructor(
    message: string,
    code: SSOErrorCode,
    options?: {
      providerId?: string;
      originalError?: Error;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, code, options);
    this.name = 'SSOError';
  }
}

// =============================================================================
// SSO Manager
// =============================================================================

/**
 * SSOManager - Manages multiple OIDC providers and SSO flows
 *
 * Provides a unified interface for SSO authentication across multiple identity providers.
 * Supports PKCE-enhanced authorization code flow, token management, user provisioning,
 * and tenant mapping.
 *
 * @example
 * ```typescript
 * const manager = getSSOManager({
 *   onProvisionUser: async (user) => {
 *     const userId = await userService.createUser(user);
 *     return userId;
 *   },
 *   onLookupUser: async (providerId, externalId) => {
 *     return userService.findByExternalId(providerId, externalId);
 *   }
 * });
 *
 * // Register a provider
 * await manager.registerProvider({
 *   id: 'okta-prod',
 *   name: 'Okta Production',
 *   type: 'okta',
 *   enabled: true,
 *   issuer: 'https://company.okta.com',
 *   clientId: 'xxx',
 *   clientSecret: 'xxx',
 *   redirectUri: 'https://app.example.com/auth/callback',
 *   scopes: ['openid', 'profile', 'email'],
 *   pkceEnabled: true,
 *   tenantMapping: 'domain',
 *   domainTenantMap: { 'company.com': 'tenant-1' },
 *   jitProvisioningEnabled: true,
 *   requestRefreshToken: true,
 * });
 *
 * // Start login
 * const { url, state } = await manager.startLogin('okta-prod', {
 *   returnUrl: '/dashboard'
 * });
 *
 * // Complete login after callback
 * const result = await manager.completeLogin({
 *   code: callbackCode,
 *   state: callbackState,
 *   storedState: savedState
 * });
 * ```
 */
/**
 * Extended SSO Manager configuration with Redis support
 */
export interface SSOManagerConfigWithRedis extends SSOManagerConfig {
  /** Redis client for cluster-safe state and session storage */
  redis?: Redis | null;
  /** State TTL in seconds (default: 300 = 5 minutes) */
  stateTtlSeconds?: number;
  /** Session TTL in seconds (default: 86400 = 24 hours) */
  sessionTtlSeconds?: number;
  /** Enable fallback to in-memory storage when Redis unavailable (default: true) */
  enableMemoryFallback?: boolean;
  /** Extend session TTL on access (default: true) */
  extendSessionTtlOnAccess?: boolean;
}

export class SSOManager {
  private readonly config: SSOManagerConfigWithRedis;
  private readonly providers = new Map<string, OIDCProvider>();
  private readonly providerConfigs = new Map<string, OIDCProviderConfig>();

  /** Redis-backed state store (with in-memory fallback) */
  private readonly stateStore: RedisStateStore;

  /** Redis-backed session store (with in-memory fallback) */
  private readonly sessionStore: RedisSessionStore;

  constructor(config: Partial<SSOManagerConfigWithRedis> = {}) {
    this.config = {
      ...DEFAULT_SSO_MANAGER_CONFIG,
      ...config,
      stateTtlSeconds: config.stateTtlSeconds ?? 300, // 5 minutes
      sessionTtlSeconds: config.sessionTtlSeconds ?? 86400, // 24 hours
      enableMemoryFallback: config.enableMemoryFallback ?? true,
      extendSessionTtlOnAccess: config.extendSessionTtlOnAccess ?? true,
    };

    // Initialize Redis-backed state store
    this.stateStore = createRedisStateStore({
      redis: config.redis ?? null,
      keyPrefix: 'sso:state:',
      stateTtlSeconds: this.config.stateTtlSeconds,
      enableMemoryFallback: this.config.enableMemoryFallback,
    });

    // Initialize Redis-backed session store
    this.sessionStore = createRedisSessionStore({
      redis: config.redis ?? null,
      keyPrefix: 'sso:session:',
      userSessionsPrefix: 'sso:user-sessions:',
      sessionTtlSeconds: this.config.sessionTtlSeconds,
      enableMemoryFallback: this.config.enableMemoryFallback,
      extendTtlOnAccess: this.config.extendSessionTtlOnAccess,
    });

    logger.info('SSOManager initialized', {
      fetchUserInfo: this.config.fetchUserInfo,
      validateClaims: this.config.validateClaims,
      stateExpirationSeconds: this.config.stateExpirationSeconds,
      hasRedis: !!config.redis,
      stateTtlSeconds: this.config.stateTtlSeconds,
      sessionTtlSeconds: this.config.sessionTtlSeconds,
      enableMemoryFallback: this.config.enableMemoryFallback,
    });
  }

  // ===========================================================================
  // Provider Management
  // ===========================================================================

  /**
   * Register an OIDC provider
   */
  async registerProvider(config: OIDCProviderConfig): Promise<void> {
    // Validate configuration
    const validationResult = OIDCProviderConfigSchema.safeParse(config);
    if (!validationResult.success) {
      throw new SSOError(
        `Invalid provider configuration: ${validationResult.error.message}`,
        'SSO_CONFIGURATION_ERROR',
        {
          providerId: config.id,
          details: { validationErrors: validationResult.error.errors },
        }
      );
    }

    // Check for duplicate
    if (this.providers.has(config.id)) {
      logger.warn('Replacing existing provider', { providerId: config.id });
      this.providers.get(config.id)?.clearCache();
    }

    // Store configuration
    this.providerConfigs.set(config.id, config);

    // Create and initialize provider if enabled
    if (config.enabled) {
      const provider = await createOIDCProvider(config, {
        cacheTtlSeconds: this.config.discoveryCacheTtlSeconds,
      });
      this.providers.set(config.id, provider);

      logger.info('Provider registered and initialized', {
        providerId: config.id,
        type: config.type,
        issuer: config.issuer,
      });
    } else {
      logger.info('Provider registered (disabled)', {
        providerId: config.id,
        type: config.type,
      });
    }
  }

  /**
   * Unregister an OIDC provider
   */
  unregisterProvider(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.clearCache();
      this.providers.delete(providerId);
    }
    const removed = this.providerConfigs.delete(providerId);

    if (removed) {
      logger.info('Provider unregistered', { providerId });
    }

    return removed;
  }

  /**
   * Get a provider by ID
   */
  getProvider(providerId: string): OIDCProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get provider configuration by ID
   */
  getProviderConfig(providerId: string): OIDCProviderConfig | undefined {
    return this.providerConfigs.get(providerId);
  }

  /**
   * List all registered providers
   */
  listProviders(): Array<{ id: string; name: string; type: string; enabled: boolean }> {
    return Array.from(this.providerConfigs.values()).map((config) => ({
      id: config.id,
      name: config.name,
      type: config.type,
      enabled: config.enabled,
    }));
  }

  /**
   * List enabled providers only
   */
  listEnabledProviders(): Array<{ id: string; name: string; type: string }> {
    return Array.from(this.providerConfigs.values())
      .filter((config) => config.enabled)
      .map((config) => ({
        id: config.id,
        name: config.name,
        type: config.type,
      }));
  }

  /**
   * Enable a provider
   */
  async enableProvider(providerId: string): Promise<void> {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      throw new SSOError(
        `Provider not found: ${providerId}`,
        'SSO_PROVIDER_NOT_FOUND',
        { providerId }
      );
    }

    if (config.enabled && this.providers.has(providerId)) {
      return; // Already enabled
    }

    config.enabled = true;
    const provider = await createOIDCProvider(config, {
      cacheTtlSeconds: this.config.discoveryCacheTtlSeconds,
    });
    this.providers.set(providerId, provider);

    logger.info('Provider enabled', { providerId });
  }

  /**
   * Disable a provider
   */
  disableProvider(providerId: string): void {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      throw new SSOError(
        `Provider not found: ${providerId}`,
        'SSO_PROVIDER_NOT_FOUND',
        { providerId }
      );
    }

    config.enabled = false;
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.clearCache();
      this.providers.delete(providerId);
    }

    logger.info('Provider disabled', { providerId });
  }

  // ===========================================================================
  // Authentication Flow
  // ===========================================================================

  /**
   * Start login flow - generate authorization URL
   *
   * Uses atomic Redis operations to store state, preventing replay attacks
   * in clustered environments.
   */
  async startLogin(
    providerId: string,
    options?: {
      returnUrl?: string;
      tenantId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<AuthorizationUrlResult> {
    const provider = this.getInitializedProvider(providerId);

    const result = await provider.generateAuthorizationUrl({
      returnUrl: options?.returnUrl,
      tenantId: options?.tenantId,
      metadata: options?.metadata,
      stateExpirationSeconds: this.config.stateExpirationSeconds,
    });

    // Store state atomically in Redis (prevents replay attacks)
    const stored = await this.stateStore.set(result.state);
    if (!stored) {
      throw new SSOError(
        'Failed to store authorization state (possible replay attack)',
        'SSO_STATE_INVALID',
        { providerId, details: { state: result.state.state } }
      );
    }

    // Emit audit event
    await this.emitAuditEvent({
      type: 'sso.auth.started',
      timestamp: new Date(),
      providerId,
      tenantId: options?.tenantId,
      metadata: { returnUrl: options?.returnUrl },
    });

    logger.debug('Login started', {
      providerId,
      returnUrl: options?.returnUrl,
    });

    return result;
  }

  /**
   * Complete login flow - exchange code for tokens
   */
  async completeLogin(
    request: TokenExchangeRequest,
    options?: {
      fetchUserInfo?: boolean;
    }
  ): Promise<TokenExchangeResult> {
    const { storedState } = request;
    const providerId = storedState.providerId;

    const provider = this.getInitializedProvider(providerId);
    const config = this.providerConfigs.get(providerId)!;

    try {
      // Exchange code for tokens
      const result = await provider.exchangeCode(request);

      // Fetch user info if enabled
      const shouldFetchUserInfo =
        options?.fetchUserInfo ?? this.config.fetchUserInfo;
      if (shouldFetchUserInfo && result.tokens.accessToken) {
        try {
          result.userInfo = await provider.fetchUserInfo(result.tokens.accessToken);
        } catch (error) {
          logger.warn('Failed to fetch user info', { providerId, error });
        }
      }

      // Resolve tenant
      result.tenantId = this.resolveTenant(
        config,
        result.claims,
        result.userInfo,
        storedState.tenantId
      );

      // Look up or provision user
      const userResult = await this.resolveUser(
        providerId,
        result.claims,
        result.userInfo,
        result.tenantId,
        config
      );

      result.userId = userResult.userId;
      result.isNewUser = userResult.isNewUser;

      // Clean up state (already consumed atomically, but ensure cleanup)
      await this.stateStore.delete(storedState.state);

      // Emit audit event
      await this.emitAuditEvent({
        type: 'sso.auth.completed',
        timestamp: new Date(),
        providerId,
        userId: result.userId,
        tenantId: result.tenantId,
        externalSubjectId: result.claims.sub,
        metadata: {
          isNewUser: result.isNewUser,
          hasRefreshToken: !!result.tokens.refreshToken,
        },
      });

      logger.info('Login completed', {
        providerId,
        userId: result.userId,
        tenantId: result.tenantId,
        isNewUser: result.isNewUser,
      });

      return result;
    } catch (error) {
      // Emit failure event
      await this.emitAuditEvent({
        type: 'sso.auth.failed',
        timestamp: new Date(),
        providerId,
        tenantId: storedState.tenantId,
        error: {
          code: error instanceof OIDCError ? error.code : 'SSO_TOKEN_EXCHANGE_FAILED',
          originalError: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }

  /**
   * Validate and retrieve stored state (non-consuming)
   *
   * For cluster-safe operation, prefer using consumeStoredState() which
   * atomically retrieves and deletes the state.
   */
  async getStoredState(stateParam: string): Promise<AuthorizationState | undefined> {
    return this.stateStore.get(stateParam);
  }

  /**
   * Atomically consume stored state
   *
   * Gets and deletes the state in a single atomic operation to prevent
   * replay attacks. This is the recommended method for retrieving state
   * during the OAuth callback in clustered environments.
   *
   * @param stateParam - The state parameter from the callback
   * @returns Result indicating success/failure with the consumed state
   */
  async consumeStoredState(stateParam: string): Promise<ConsumeStateResult> {
    return this.stateStore.consume(stateParam);
  }

  /**
   * Clean up expired states
   *
   * Note: Redis TTL handles expiration automatically.
   * This method is mainly for the in-memory fallback.
   */
  async cleanupExpiredStates(): Promise<number> {
    return this.stateStore.cleanup();
  }

  // ===========================================================================
  // Token Management
  // ===========================================================================

  /**
   * Refresh tokens for a session
   */
  async refreshTokens(
    providerId: string,
    refreshToken: string
  ): Promise<TokenRefreshResult> {
    const provider = this.getInitializedProvider(providerId);

    const result = await provider.refreshTokens(refreshToken);

    // Emit audit event
    await this.emitAuditEvent({
      type: 'sso.token.refreshed',
      timestamp: new Date(),
      providerId,
      metadata: { hasNewIdToken: !!result.claims },
    });

    return result;
  }

  /**
   * Revoke a token
   */
  async revokeToken(
    providerId: string,
    token: string,
    tokenTypeHint?: 'access_token' | 'refresh_token'
  ): Promise<void> {
    const provider = this.getInitializedProvider(providerId);

    await provider.revokeToken(token, tokenTypeHint);

    // Emit audit event
    await this.emitAuditEvent({
      type: 'sso.token.revoked',
      timestamp: new Date(),
      providerId,
      metadata: { tokenTypeHint },
    });
  }

  /**
   * Fetch user info with access token
   */
  async fetchUserInfo(
    providerId: string,
    accessToken: string
  ): Promise<OIDCUserInfo> {
    const provider = this.getInitializedProvider(providerId);
    return provider.fetchUserInfo(accessToken);
  }

  // ===========================================================================
  // Session Management (Redis-backed, cluster-safe)
  // ===========================================================================

  /**
   * Create an SSO session
   *
   * Stores the session in Redis for cluster-safe access.
   */
  async createSession(
    userId: string,
    providerId: string,
    externalSubjectId: string,
    tenantId: string,
    tokens: OIDCTokenSet,
    claims: IDTokenClaims,
    metadata?: Record<string, unknown>
  ): Promise<SSOSession> {
    const sessionId = this.generateSessionId();
    const now = new Date();

    const session: SSOSession = {
      id: sessionId,
      userId,
      providerId,
      externalSubjectId,
      tenantId,
      tokens,
      claims,
      createdAt: now,
      lastRefreshedAt: now,
      metadata,
    };

    // Store in Redis-backed session store
    await this.sessionStore.create(session);

    // Emit audit event (fire and forget, errors are logged internally)
    void this.emitAuditEvent({
      type: 'sso.session.created',
      timestamp: now,
      providerId,
      userId,
      tenantId,
      externalSubjectId,
    });

    logger.debug('SSO session created', {
      sessionId,
      userId,
      providerId,
      tenantId,
    });

    return session;
  }

  /**
   * Get an SSO session
   *
   * Retrieves the session from Redis (cluster-safe).
   */
  async getSession(sessionId: string): Promise<SSOSession | undefined> {
    return this.sessionStore.get(sessionId);
  }

  /**
   * Validate an SSO session (cluster-aware)
   *
   * Checks if the session exists, is not expired, and has valid tokens.
   * This is the recommended method for session validation in a cluster.
   *
   * @param sessionId - The session ID to validate
   * @returns Validation result with session if valid
   */
  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    return this.sessionStore.validate(sessionId);
  }

  /**
   * Update session tokens (after refresh)
   *
   * Updates tokens in Redis for cluster-safe access.
   */
  async updateSessionTokens(
    sessionId: string,
    tokens: OIDCTokenSet,
    claims?: IDTokenClaims
  ): Promise<boolean> {
    return this.sessionStore.updateTokens(sessionId, tokens, claims);
  }

  /**
   * Terminate an SSO session
   *
   * Removes the session from Redis and revokes tokens.
   */
  async terminateSession(sessionId: string): Promise<boolean> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return false;
    }

    // Revoke refresh token if present
    if (session.tokens.refreshToken) {
      try {
        await this.revokeToken(
          session.providerId,
          session.tokens.refreshToken,
          'refresh_token'
        );
      } catch (error) {
        logger.warn('Failed to revoke refresh token during session termination', {
          sessionId,
          error,
        });
      }
    }

    // Delete from Redis-backed store
    const deleted = await this.sessionStore.delete(sessionId);

    if (deleted) {
      // Emit audit event
      await this.emitAuditEvent({
        type: 'sso.session.terminated',
        timestamp: new Date(),
        providerId: session.providerId,
        userId: session.userId,
        tenantId: session.tenantId,
        externalSubjectId: session.externalSubjectId,
      });

      logger.debug('SSO session terminated', {
        sessionId,
        userId: session.userId,
      });
    }

    return deleted;
  }

  /**
   * Get sessions for a user
   *
   * Retrieves all sessions for a user from Redis.
   */
  async getSessionsForUser(userId: string): Promise<SSOSession[]> {
    return this.sessionStore.getSessionsForUser(userId);
  }

  /**
   * Terminate all sessions for a user
   *
   * Removes all sessions for a user from Redis and revokes tokens.
   */
  async terminateSessionsForUser(userId: string): Promise<number> {
    const userSessions = await this.getSessionsForUser(userId);
    let terminated = 0;

    for (const session of userSessions) {
      if (await this.terminateSession(session.id)) {
        terminated++;
      }
    }

    return terminated;
  }

  // ===========================================================================
  // Logout
  // ===========================================================================

  /**
   * Generate logout URL for a provider
   */
  generateLogoutUrl(
    providerId: string,
    options?: {
      idToken?: string;
      postLogoutRedirectUri?: string;
      state?: string;
    }
  ): string | null {
    const provider = this.getInitializedProvider(providerId);
    return provider.generateLogoutUrl(options);
  }

  /**
   * Perform full logout (terminate session and generate logout URL)
   */
  async logout(
    sessionId: string,
    options?: {
      postLogoutRedirectUri?: string;
    }
  ): Promise<{ logoutUrl: string | null }> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new SSOError(
        'Session not found',
        'SSO_SESSION_NOT_FOUND',
        { details: { sessionId } }
      );
    }

    // Generate logout URL before terminating session
    const logoutUrl = this.generateLogoutUrl(session.providerId, {
      idToken: session.tokens.idToken,
      postLogoutRedirectUri: options?.postLogoutRedirectUri,
    });

    // Terminate session
    await this.terminateSession(sessionId);

    return { logoutUrl };
  }

  // ===========================================================================
  // Tenant Resolution
  // ===========================================================================

  /**
   * Resolve tenant ID from claims and configuration
   */
  private resolveTenant(
    config: OIDCProviderConfig,
    claims: IDTokenClaims,
    userInfo?: OIDCUserInfo,
    providedTenantId?: string
  ): string | undefined {
    // If tenant was provided, use it
    if (providedTenantId) {
      return providedTenantId;
    }

    const strategy = config.tenantMapping;

    switch (strategy) {
      case 'static':
        return config.staticTenantId;

      case 'claim': {
        const claimName = config.tenantClaimName || 'tenant_id';
        const tenantId = claims[claimName] as string | undefined;
        if (!tenantId) {
          throw new SSOError(
            `Tenant claim "${claimName}" not found in ID token`,
            'SSO_TENANT_MAPPING_FAILED',
            { providerId: config.id, details: { claimName } }
          );
        }
        return tenantId;
      }

      case 'domain': {
        const email = userInfo?.email || claims.email;
        if (!email) {
          throw new SSOError(
            'Email not found for domain-based tenant mapping',
            'SSO_TENANT_MAPPING_FAILED',
            { providerId: config.id }
          );
        }

        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain) {
          throw new SSOError(
            'Invalid email format for domain-based tenant mapping',
            'SSO_TENANT_MAPPING_FAILED',
            { providerId: config.id, details: { email } }
          );
        }

        const tenantId = config.domainTenantMap?.[domain];
        if (!tenantId) {
          throw new SSOError(
            `No tenant mapping for domain: ${domain}`,
            'SSO_TENANT_MAPPING_FAILED',
            { providerId: config.id, details: { domain } }
          );
        }

        return tenantId;
      }

      default:
        return undefined;
    }
  }

  // ===========================================================================
  // User Resolution and JIT Provisioning
  // ===========================================================================

  /**
   * Resolve user - look up existing or provision new user
   */
  private async resolveUser(
    providerId: string,
    claims: IDTokenClaims,
    userInfo: OIDCUserInfo | undefined,
    tenantId: string | undefined,
    config: OIDCProviderConfig
  ): Promise<{ userId: string; isNewUser: boolean }> {
    const externalSubjectId = claims.sub;

    // Try to look up existing user
    if (this.config.onLookupUser) {
      const existingUser = await this.config.onLookupUser(
        providerId,
        externalSubjectId
      );

      if (existingUser) {
        return { userId: existingUser.userId, isNewUser: false };
      }
    }

    // Check if JIT provisioning is enabled
    if (!config.jitProvisioningEnabled) {
      throw new SSOError(
        'User not found and JIT provisioning is disabled',
        'SSO_JIT_PROVISIONING_FAILED',
        {
          providerId,
          details: { externalSubjectId },
        }
      );
    }

    // Provision new user
    return this.provisionUser(providerId, claims, userInfo, tenantId, config);
  }

  /**
   * Provision a new user via JIT
   */
  private async provisionUser(
    providerId: string,
    claims: IDTokenClaims,
    userInfo: OIDCUserInfo | undefined,
    tenantId: string | undefined,
    config: OIDCProviderConfig
  ): Promise<{ userId: string; isNewUser: boolean }> {
    if (!this.config.onProvisionUser) {
      throw new SSOError(
        'No user provisioning callback configured',
        'SSO_JIT_PROVISIONING_FAILED',
        { providerId }
      );
    }

    if (!tenantId) {
      throw new SSOError(
        'Tenant ID required for user provisioning',
        'SSO_JIT_PROVISIONING_FAILED',
        { providerId }
      );
    }

    const mappings = config.jitClaimMappings || {};

    // Extract user attributes from claims
    const email =
      (mappings.email ? claims[mappings.email] : null) ||
      userInfo?.email ||
      claims.email;

    if (!email || typeof email !== 'string') {
      throw new SSOError(
        'Email required for user provisioning',
        'SSO_JIT_PROVISIONING_FAILED',
        { providerId }
      );
    }

    const firstName =
      (mappings.firstName ? claims[mappings.firstName] : null) ||
      userInfo?.given_name ||
      claims.given_name;

    const lastName =
      (mappings.lastName ? claims[mappings.lastName] : null) ||
      userInfo?.family_name ||
      claims.family_name;

    const displayName =
      (mappings.displayName ? claims[mappings.displayName] : null) ||
      userInfo?.name ||
      claims.name;

    // Extract custom attributes
    const attributes: Record<string, unknown> = {};
    if (mappings.custom) {
      for (const [attrName, claimName] of Object.entries(mappings.custom)) {
        if (claims[claimName] !== undefined) {
          attributes[attrName] = claims[claimName];
        }
      }
    }

    const provisionedUser: JITProvisionedUser = {
      externalSubjectId: claims.sub,
      providerId,
      email: email,
      firstName: firstName as string | undefined,
      lastName: lastName as string | undefined,
      displayName: displayName as string | undefined,
      roles: config.jitDefaultRoles || [],
      tenantId,
      attributes,
      provisionedAt: new Date(),
    };

    const userId = await this.config.onProvisionUser(provisionedUser);

    // Emit audit event
    await this.emitAuditEvent({
      type: 'sso.user.provisioned',
      timestamp: new Date(),
      providerId,
      userId,
      tenantId,
      externalSubjectId: claims.sub,
      metadata: {
        email,
        roles: provisionedUser.roles,
      },
    });

    logger.info('User provisioned via JIT', {
      providerId,
      userId,
      tenantId,
      email,
    });

    return { userId, isNewUser: true };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get an initialized provider or throw
   */
  private getInitializedProvider(providerId: string): OIDCProvider {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      throw new SSOError(
        `Provider not found: ${providerId}`,
        'SSO_PROVIDER_NOT_FOUND',
        { providerId }
      );
    }

    if (!config.enabled) {
      throw new SSOError(
        `Provider is disabled: ${providerId}`,
        'SSO_PROVIDER_DISABLED',
        { providerId }
      );
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new SSOError(
        `Provider not initialized: ${providerId}`,
        'SSO_CONFIGURATION_ERROR',
        { providerId }
      );
    }

    return provider;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Emit an audit event
   */
  private async emitAuditEvent(event: SSOAuditEvent): Promise<void> {
    if (this.config.onAuditEvent) {
      try {
        await this.config.onAuditEvent(event);
      } catch (error) {
        logger.error('Failed to emit audit event', { event, error });
      }
    }
  }

  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<void> {
    clearAllDiscoveryCaches();
    await this.stateStore.clear();
    await this.sessionStore.clear();
    logger.info('Cleared all SSO caches');
  }

  /**
   * Get manager statistics
   */
  async getStats(): Promise<{
    providers: number;
    enabledProviders: number;
    stateStore: {
      redisAvailable: boolean;
      memoryStoreSize: number;
      usingFallback: boolean;
    };
    sessionStore: {
      redisAvailable: boolean;
      memoryStoreSize: number;
      usingFallback: boolean;
    };
  }> {
    const [stateStoreStats, sessionStoreStats] = await Promise.all([
      this.stateStore.getStats(),
      this.sessionStore.getStats(),
    ]);

    return {
      providers: this.providerConfigs.size,
      enabledProviders: this.providers.size,
      stateStore: stateStoreStats,
      sessionStore: sessionStoreStats,
    };
  }

  /**
   * Get the Redis state store instance
   *
   * For advanced operations and direct access to the state store.
   */
  getStateStore(): RedisStateStore {
    return this.stateStore;
  }

  /**
   * Get the Redis session store instance
   *
   * For advanced operations and direct access to the session store.
   */
  getSessionStore(): RedisSessionStore {
    return this.sessionStore;
  }

  /**
   * Shutdown the SSO Manager
   *
   * Cleans up resources including Redis store cleanup intervals.
   */
  shutdown(): void {
    this.stateStore.shutdown();
    this.sessionStore.shutdown();
    clearAllDiscoveryCaches();
    logger.info('SSOManager shutdown complete');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let ssoManagerInstance: SSOManager | null = null;

/**
 * Get the singleton SSOManager instance
 *
 * @param config - Configuration (only used on first call)
 * @returns The SSOManager singleton
 */
export function getSSOManager(config?: Partial<SSOManagerConfigWithRedis>): SSOManager {
  if (!ssoManagerInstance) {
    ssoManagerInstance = new SSOManager(config);
  }
  return ssoManagerInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export async function resetSSOManager(): Promise<void> {
  if (ssoManagerInstance) {
    ssoManagerInstance.shutdown();
  }
  ssoManagerInstance = null;
  logger.debug('SSOManager singleton reset');
}

// =============================================================================
// Re-exports
// =============================================================================

// Re-export types from types.ts
export {
  type OIDCProviderConfig,
  type OIDCProviderType,
  type TenantMappingStrategy,
  type JITClaimMappings,
  type AuthorizationState,
  type AuthorizationUrlResult,
  type TokenExchangeRequest,
  type TokenExchangeResult,
  type TokenRefreshResult,
  type OIDCTokenSet,
  type IDTokenClaims,
  type OIDCUserInfo,
  type JITProvisionedUser,
  type SSOSession,
  type SSOAuditEvent,
  type SSOEventType,
  type SSOManagerConfig,
  type SSOErrorCode,
  type SSOErrorDetails,
  OIDCProviderConfigSchema,
  AuthorizationCallbackSchema,
  DEFAULT_SSO_MANAGER_CONFIG,
} from './types.js';

// Re-export provider utilities from oidc-provider.ts
export {
  OIDCProvider,
  createOIDCProvider,
  clearAllDiscoveryCaches,
} from './oidc-provider.js';

// Re-export Redis state store
export {
  RedisStateStore,
  createRedisStateStore,
  type RedisStateStoreConfig,
  type ConsumeStateResult,
} from './redis-state-store.js';

// Re-export Redis session store
export {
  RedisSessionStore,
  createRedisSessionStore,
  type RedisSessionStoreConfig,
  type SessionValidationResult,
} from './redis-session-store.js';
