/**
 * SSO/OIDC Module for Vorion Platform
 *
 * Provides enterprise SSO capabilities with support for multiple OIDC providers
 * including Okta, Azure AD, Google, and generic OIDC implementations.
 *
 * Uses dynamic imports to work with ESM-only openid-client v6.
 *
 * @module auth/sso
 */

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
export class SSOManager {
  private readonly config: SSOManagerConfig;
  private readonly providers = new Map<string, OIDCProvider>();
  private readonly providerConfigs = new Map<string, OIDCProviderConfig>();
  private readonly sessions = new Map<string, SSOSession>();
  private readonly stateStore = new Map<string, AuthorizationState>();

  constructor(config: Partial<SSOManagerConfig> = {}) {
    this.config = { ...DEFAULT_SSO_MANAGER_CONFIG, ...config };
    logger.info('SSOManager initialized', {
      fetchUserInfo: this.config.fetchUserInfo,
      validateClaims: this.config.validateClaims,
      stateExpirationSeconds: this.config.stateExpirationSeconds,
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

    // Store state for later validation
    this.stateStore.set(result.state.state, result.state);

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

      // Clean up state
      this.stateStore.delete(storedState.state);

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
   * Validate and retrieve stored state
   */
  getStoredState(stateParam: string): AuthorizationState | undefined {
    const state = this.stateStore.get(stateParam);

    if (!state) {
      return undefined;
    }

    // Check expiration
    if (new Date() > state.expiresAt) {
      this.stateStore.delete(stateParam);
      return undefined;
    }

    return state;
  }

  /**
   * Clean up expired states
   */
  cleanupExpiredStates(): number {
    const now = new Date();
    let cleaned = 0;

    // Use Array.from to avoid downlevelIteration requirements
    const entries = Array.from(this.stateStore.entries());
    for (const [key, state] of entries) {
      if (now > state.expiresAt) {
        this.stateStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired states', { count: cleaned });
    }

    return cleaned;
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
  // Session Management
  // ===========================================================================

  /**
   * Create an SSO session
   */
  createSession(
    userId: string,
    providerId: string,
    externalSubjectId: string,
    tenantId: string,
    tokens: OIDCTokenSet,
    claims: IDTokenClaims,
    metadata?: Record<string, unknown>
  ): SSOSession {
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

    this.sessions.set(sessionId, session);

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
   */
  getSession(sessionId: string): SSOSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session tokens (after refresh)
   */
  updateSessionTokens(
    sessionId: string,
    tokens: OIDCTokenSet,
    claims?: IDTokenClaims
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.tokens = tokens;
    if (claims) {
      session.claims = claims;
    }
    session.lastRefreshedAt = new Date();

    return true;
  }

  /**
   * Terminate an SSO session
   */
  async terminateSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
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

    this.sessions.delete(sessionId);

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

    return true;
  }

  /**
   * Get sessions for a user
   */
  getSessionsForUser(userId: string): SSOSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.userId === userId
    );
  }

  /**
   * Terminate all sessions for a user
   */
  async terminateSessionsForUser(userId: string): Promise<number> {
    const userSessions = this.getSessionsForUser(userId);
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
    const session = this.sessions.get(sessionId);
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
  clearAllCaches(): void {
    clearAllDiscoveryCaches();
    this.stateStore.clear();
    logger.info('Cleared all SSO caches');
  }

  /**
   * Get manager statistics
   */
  getStats(): {
    providers: number;
    enabledProviders: number;
    activeSessions: number;
    pendingStates: number;
  } {
    return {
      providers: this.providerConfigs.size,
      enabledProviders: this.providers.size,
      activeSessions: this.sessions.size,
      pendingStates: this.stateStore.size,
    };
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
export function getSSOManager(config?: Partial<SSOManagerConfig>): SSOManager {
  if (!ssoManagerInstance) {
    ssoManagerInstance = new SSOManager(config);
  }
  return ssoManagerInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export function resetSSOManager(): void {
  if (ssoManagerInstance) {
    ssoManagerInstance.clearAllCaches();
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
