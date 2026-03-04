/**
 * OIDC Provider Implementation for Vorion Platform
 *
 * Handles OIDC authentication flows using dynamic imports for ESM-only openid-client v6.
 * Supports PKCE-enhanced authorization code flow with token management.
 *
 * @module auth/sso/oidc-provider
 */

import { randomBytes, createHash } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
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
  type SSOErrorCode,
} from './types.js';

const logger = createLogger({ component: 'oidc-provider' });

// =============================================================================
// Dynamic Import Helper for ESM-only openid-client
// =============================================================================

/**
 * Type for dynamically imported openid-client module
 * Using explicit interface to avoid ESM/CJS type resolution issues
 */
interface OIDCClientModule {
  discovery: (
    issuer: URL,
    clientId: string,
    clientMetadata?: unknown,
    clientAuth?: unknown
  ) => Promise<OIDCConfiguration>;
  ClientSecretPost: (secret: string) => unknown;
  None: () => unknown;
  buildAuthorizationUrl: (config: OIDCConfiguration, params: Record<string, string>) => URL;
  authorizationCodeGrant: (
    config: OIDCConfiguration,
    callbackUrl: URL,
    checks: {
      expectedState?: string;
      expectedNonce?: string;
      pkceCodeVerifier?: string;
    }
  ) => Promise<TokenResponse>;
  refreshTokenGrant: (config: OIDCConfiguration, refreshToken: string) => Promise<TokenResponse>;
  tokenRevocation: (config: OIDCConfiguration, token: string, params?: Record<string, string>) => Promise<void>;
  fetchUserInfo: (config: OIDCConfiguration, accessToken: string, subject: string | symbol) => Promise<OIDCUserInfo>;
  skipSubjectCheck: symbol;
}

/**
 * Type for token response from openid-client
 */
interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
}

/**
 * Type for OIDC configuration (discovery result)
 */
interface OIDCConfiguration {
  serverMetadata: () => {
    authorization_endpoint?: string;
    token_endpoint?: string;
    revocation_endpoint?: string;
    userinfo_endpoint?: string;
    end_session_endpoint?: string;
    [key: string]: unknown;
  };
}

/**
 * Cached openid-client module
 */
let oidcClientModule: OIDCClientModule | null = null;

/**
 * Dynamically imports openid-client (ESM-only module).
 * This allows our CommonJS codebase to use openid-client v6.
 */
async function getOIDCClient(): Promise<OIDCClientModule> {
  if (oidcClientModule) {
    return oidcClientModule;
  }

  logger.debug('Loading openid-client module via dynamic import');
  oidcClientModule = await import('openid-client') as unknown as OIDCClientModule;
  return oidcClientModule;
}

// OIDCConfiguration type defined above in the OIDCClientModule interface section

// =============================================================================
// OIDC Provider Error
// =============================================================================

/**
 * OIDC-specific error class
 */
export class OIDCError extends Error {
  code: SSOErrorCode;
  providerId?: string;
  originalError?: Error;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: SSOErrorCode,
    options?: {
      providerId?: string;
      originalError?: Error;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'OIDCError';
    this.code = code;
    this.providerId = options?.providerId;
    this.originalError = options?.originalError;
    this.details = options?.details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// =============================================================================
// Discovery Cache
// =============================================================================

interface DiscoveredConfig {
  config: OIDCConfiguration;
  cachedAt: number;
}

/**
 * Cache for OIDC discovery results
 */
const discoveryCache = new Map<string, DiscoveredConfig>();

// =============================================================================
// OIDC Provider Class
// =============================================================================

/**
 * OIDC Provider - handles authentication flows for a single provider
 *
 * Uses dynamic imports to work with ESM-only openid-client v6 in a CommonJS environment.
 *
 * @example
 * ```typescript
 * const provider = new OIDCProvider(config);
 * await provider.initialize();
 *
 * // Generate authorization URL
 * const { url, state } = await provider.generateAuthorizationUrl({
 *   returnUrl: '/dashboard'
 * });
 *
 * // After callback, exchange code for tokens
 * const result = await provider.exchangeCode({
 *   code: callbackCode,
 *   state: callbackState,
 *   storedState: savedState
 * });
 * ```
 */
export class OIDCProvider {
  private readonly config: OIDCProviderConfig;
  private discoveredConfig: DiscoveredConfig | null = null;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(config: OIDCProviderConfig) {
    this.config = config;
    logger.debug('OIDCProvider created', {
      providerId: config.id,
      type: config.type,
      issuer: config.issuer,
    });
  }

  /**
   * Get the provider configuration
   */
  getConfig(): Readonly<OIDCProviderConfig> {
    return { ...this.config };
  }

  /**
   * Get the provider ID
   */
  get id(): string {
    return this.config.id;
  }

  /**
   * Check if the provider is enabled
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Initialize the provider by performing OIDC discovery
   */
  async initialize(cacheTtlSeconds = 3600): Promise<void> {
    // Check if already initialized and cache is valid
    if (this.initialized && this.discoveredConfig) {
      const cacheAge = (Date.now() - this.discoveredConfig.cachedAt) / 1000;
      if (cacheAge < cacheTtlSeconds) {
        return;
      }
    }

    // Deduplicate concurrent initialization calls
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.performDiscovery(cacheTtlSeconds);

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  /**
   * Perform OIDC discovery
   */
  private async performDiscovery(cacheTtlSeconds: number): Promise<void> {
    const cacheKey = `${this.config.issuer}:${this.config.clientId}`;

    // Check global cache first
    const cached = discoveryCache.get(cacheKey);
    if (cached) {
      const cacheAge = (Date.now() - cached.cachedAt) / 1000;
      if (cacheAge < cacheTtlSeconds) {
        this.discoveredConfig = cached;
        this.initialized = true;
        logger.debug('Using cached OIDC discovery', {
          providerId: this.config.id,
          issuer: this.config.issuer,
        });
        return;
      }
    }

    logger.info('Performing OIDC discovery', {
      providerId: this.config.id,
      issuer: this.config.issuer,
    });

    try {
      const client = await getOIDCClient();

      // Construct issuer URL
      const issuerUrl = new URL(this.config.issuer);

      // Choose client authentication method based on whether we have a secret
      let clientAuth: ReturnType<typeof client.ClientSecretPost> | ReturnType<typeof client.None>;
      if (this.config.clientSecret) {
        clientAuth = client.ClientSecretPost(this.config.clientSecret);
      } else {
        clientAuth = client.None();
      }

      // Perform discovery
      const config = await client.discovery(
        issuerUrl,
        this.config.clientId,
        undefined, // client metadata
        clientAuth
      );

      this.discoveredConfig = {
        config,
        cachedAt: Date.now(),
      };

      // Update global cache
      discoveryCache.set(cacheKey, this.discoveredConfig);
      this.initialized = true;

      logger.info('OIDC discovery completed', {
        providerId: this.config.id,
        issuer: this.config.issuer,
        authorizationEndpoint: config.serverMetadata().authorization_endpoint,
        tokenEndpoint: config.serverMetadata().token_endpoint,
      });
    } catch (error) {
      logger.error('OIDC discovery failed', {
        providerId: this.config.id,
        issuer: this.config.issuer,
        error,
      });

      throw new OIDCError(
        `Failed to discover OIDC configuration for ${this.config.issuer}`,
        'SSO_DISCOVERY_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
          details: { issuer: this.config.issuer },
        }
      );
    }
  }

  /**
   * Ensure provider is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.discoveredConfig) {
      throw new OIDCError(
        'Provider not initialized. Call initialize() first.',
        'SSO_CONFIGURATION_ERROR',
        { providerId: this.config.id }
      );
    }
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    // Generate a random 32-byte code verifier (43 characters in base64url)
    const codeVerifier = randomBytes(32)
      .toString('base64url')
      .replace(/[^a-zA-Z0-9\-_]/g, '')
      .slice(0, 43);

    // Generate SHA-256 hash for code challenge
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate a random state parameter
   */
  private generateState(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate a random nonce
   */
  private generateNonce(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate authorization URL for initiating login
   */
  async generateAuthorizationUrl(options?: {
    returnUrl?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
    stateExpirationSeconds?: number;
  }): Promise<AuthorizationUrlResult> {
    this.ensureInitialized();

    const client = await getOIDCClient();
    const config = this.discoveredConfig!.config;

    const state = this.generateState();
    const nonce = this.generateNonce();

    // Build authorization parameters
    const params: Record<string, string> = {
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      response_type: this.config.responseType || 'code',
      state,
      nonce,
    };

    // Add PKCE if enabled
    let codeVerifier: string | undefined;
    if (this.config.pkceEnabled) {
      const pkce = this.generatePKCE();
      codeVerifier = pkce.codeVerifier;
      params.code_challenge = pkce.codeChallenge;
      params.code_challenge_method = 'S256';
    }

    // Add offline_access scope if refresh tokens are requested
    if (this.config.requestRefreshToken && !params.scope.includes('offline_access')) {
      params.scope = `${params.scope} offline_access`;
    }

    // Add additional auth params from config
    if (this.config.additionalAuthParams) {
      Object.assign(params, this.config.additionalAuthParams);
    }

    // Build authorization URL using openid-client v6 API
    const url = client.buildAuthorizationUrl(config, params);

    // Create authorization state for storage
    const expirationSeconds = options?.stateExpirationSeconds ?? 600;
    const now = new Date();
    const authState: AuthorizationState = {
      state,
      nonce,
      codeVerifier,
      providerId: this.config.id,
      returnUrl: options?.returnUrl,
      tenantId: options?.tenantId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + expirationSeconds * 1000),
      metadata: options?.metadata,
    };

    logger.debug('Generated authorization URL', {
      providerId: this.config.id,
      pkceEnabled: this.config.pkceEnabled,
      scopes: params.scope,
    });

    return {
      url: url.toString(),
      state: authState,
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(request: TokenExchangeRequest): Promise<TokenExchangeResult> {
    this.ensureInitialized();

    const { code, state, storedState } = request;

    // Validate state
    if (state !== storedState.state) {
      throw new OIDCError(
        'State parameter mismatch',
        'SSO_STATE_INVALID',
        {
          providerId: this.config.id,
          details: { expected: storedState.state.substring(0, 8), received: state.substring(0, 8) },
        }
      );
    }

    // Check state expiration
    if (new Date() > storedState.expiresAt) {
      throw new OIDCError(
        'Authorization state has expired',
        'SSO_STATE_EXPIRED',
        {
          providerId: this.config.id,
          details: { expiresAt: storedState.expiresAt.toISOString() },
        }
      );
    }

    const client = await getOIDCClient();
    const config = this.discoveredConfig!.config;

    try {
      logger.debug('Exchanging authorization code', {
        providerId: this.config.id,
        hasPKCE: !!storedState.codeVerifier,
      });

      // Build the callback URL with the authorization response
      const callbackUrl = new URL(this.config.redirectUri);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);

      // Prepare checks for token validation
      const checks: Parameters<typeof client.authorizationCodeGrant>[2] = {
        expectedState: state,
        expectedNonce: storedState.nonce,
        pkceCodeVerifier: storedState.codeVerifier,
      };

      // Perform token exchange using openid-client v6 API
      const tokenResponse = await client.authorizationCodeGrant(
        config,
        callbackUrl,
        checks
      );

      // Extract tokens
      const tokens = this.extractTokenSet(tokenResponse);

      // Parse ID token claims
      const claims = this.parseIdToken(tokens.idToken);

      logger.info('Token exchange successful', {
        providerId: this.config.id,
        sub: claims.sub,
        hasRefreshToken: !!tokens.refreshToken,
      });

      return {
        tokens,
        claims,
        tenantId: storedState.tenantId,
      };
    } catch (error) {
      logger.error('Token exchange failed', {
        providerId: this.config.id,
        error,
      });

      if (error instanceof OIDCError) {
        throw error;
      }

      throw new OIDCError(
        'Failed to exchange authorization code for tokens',
        'SSO_TOKEN_EXCHANGE_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(refreshToken: string): Promise<TokenRefreshResult> {
    this.ensureInitialized();

    const client = await getOIDCClient();
    const config = this.discoveredConfig!.config;

    try {
      logger.debug('Refreshing tokens', { providerId: this.config.id });

      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);

      const tokens = this.extractTokenSet(tokenResponse);

      // Parse new ID token if present
      let claims: IDTokenClaims | undefined;
      if (tokens.idToken) {
        claims = this.parseIdToken(tokens.idToken);
      }

      logger.info('Token refresh successful', {
        providerId: this.config.id,
        hasNewIdToken: !!tokens.idToken,
      });

      return { tokens, claims };
    } catch (error) {
      logger.error('Token refresh failed', {
        providerId: this.config.id,
        error,
      });

      throw new OIDCError(
        'Failed to refresh tokens',
        'SSO_TOKEN_REFRESH_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Revoke a token (access or refresh)
   */
  async revokeToken(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
    this.ensureInitialized();

    const config = this.discoveredConfig!.config;
    const revocationEndpoint = config.serverMetadata().revocation_endpoint;

    if (!revocationEndpoint) {
      logger.warn('Token revocation not supported by provider', {
        providerId: this.config.id,
      });
      return;
    }

    try {
      const client = await getOIDCClient();

      logger.debug('Revoking token', {
        providerId: this.config.id,
        tokenTypeHint,
      });

      const params: Record<string, string> = {};
      if (tokenTypeHint) {
        params.token_type_hint = tokenTypeHint;
      }

      await client.tokenRevocation(config, token, params);

      logger.info('Token revoked successfully', {
        providerId: this.config.id,
        tokenTypeHint,
      });
    } catch (error) {
      logger.error('Token revocation failed', {
        providerId: this.config.id,
        error,
      });

      throw new OIDCError(
        'Failed to revoke token',
        'SSO_TOKEN_REVOCATION_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Fetch user info from the userinfo endpoint
   */
  async fetchUserInfo(accessToken: string, expectedSubject?: string): Promise<OIDCUserInfo> {
    this.ensureInitialized();

    const config = this.discoveredConfig!.config;
    const userinfoEndpoint = config.serverMetadata().userinfo_endpoint;

    if (!userinfoEndpoint) {
      throw new OIDCError(
        'UserInfo endpoint not available',
        'SSO_CONFIGURATION_ERROR',
        { providerId: this.config.id }
      );
    }

    try {
      const client = await getOIDCClient();

      logger.debug('Fetching user info', { providerId: this.config.id });

      // Use skipSubjectCheck if no expected subject is provided
      const subjectCheck = expectedSubject ?? client.skipSubjectCheck;
      const userInfo = await client.fetchUserInfo(config, accessToken, subjectCheck);

      logger.debug('User info fetched', {
        providerId: this.config.id,
        sub: userInfo.sub,
      });

      return userInfo as OIDCUserInfo;
    } catch (error) {
      logger.error('Failed to fetch user info', {
        providerId: this.config.id,
        error,
      });

      throw new OIDCError(
        'Failed to fetch user info',
        'SSO_USERINFO_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Generate logout URL for RP-initiated logout
   */
  generateLogoutUrl(options?: {
    idToken?: string;
    postLogoutRedirectUri?: string;
    state?: string;
  }): string | null {
    this.ensureInitialized();

    // Use custom logout URL if configured
    if (this.config.logoutUrl) {
      return this.config.logoutUrl;
    }

    const config = this.discoveredConfig!.config;
    const endSessionEndpoint = config.serverMetadata().end_session_endpoint;

    if (!endSessionEndpoint) {
      logger.debug('End session endpoint not available', {
        providerId: this.config.id,
      });
      return null;
    }

    // Build logout URL parameters
    const params: Record<string, string> = {};

    if (options?.idToken) {
      params.id_token_hint = options.idToken;
    }

    if (options?.postLogoutRedirectUri) {
      params.post_logout_redirect_uri = options.postLogoutRedirectUri;
    }

    if (options?.state) {
      params.state = options.state;
    }

    // Build URL using the end_session_endpoint
    const url = new URL(endSessionEndpoint);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  /**
   * Extract token set from openid-client response
   */
  private extractTokenSet(tokenResponse: TokenResponse): OIDCTokenSet {
    const accessToken = tokenResponse.access_token;
    if (!accessToken) {
      throw new OIDCError(
        'No access token in response',
        'SSO_TOKEN_EXCHANGE_FAILED',
        { providerId: this.config.id }
      );
    }

    let expiresAt: Date | undefined;
    if (tokenResponse.expires_in) {
      expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
    }

    return {
      accessToken,
      tokenType: tokenResponse.token_type || 'Bearer',
      expiresAt,
      idToken: tokenResponse.id_token,
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
    };
  }

  /**
   * Parse ID token claims (basic decode without cryptographic verification)
   * Note: openid-client v6 validates the ID token during authorizationCodeGrant
   */
  private parseIdToken(idToken?: string): IDTokenClaims {
    if (!idToken) {
      throw new OIDCError(
        'No ID token in response',
        'SSO_TOKEN_VALIDATION_FAILED',
        { providerId: this.config.id }
      );
    }

    try {
      // ID token is already validated by openid-client during token exchange
      // We just need to decode the payload
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payloadB64 = parts[1];
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8')
      );

      // Validate required claims
      if (!payload.sub) {
        throw new OIDCError(
          'ID token missing required "sub" claim',
          'SSO_TOKEN_VALIDATION_FAILED',
          { providerId: this.config.id }
        );
      }

      return payload as IDTokenClaims;
    } catch (error) {
      if (error instanceof OIDCError) {
        throw error;
      }

      throw new OIDCError(
        'Failed to parse ID token',
        'SSO_TOKEN_VALIDATION_FAILED',
        {
          providerId: this.config.id,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Clear discovery cache for this provider
   */
  clearCache(): void {
    const cacheKey = `${this.config.issuer}:${this.config.clientId}`;
    discoveryCache.delete(cacheKey);
    this.discoveredConfig = null;
    this.initialized = false;
    logger.debug('Cleared OIDC discovery cache', {
      providerId: this.config.id,
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create and initialize an OIDC provider
 */
export async function createOIDCProvider(
  config: OIDCProviderConfig,
  options?: { cacheTtlSeconds?: number }
): Promise<OIDCProvider> {
  const provider = new OIDCProvider(config);
  await provider.initialize(options?.cacheTtlSeconds);
  return provider;
}

/**
 * Clear all discovery caches
 */
export function clearAllDiscoveryCaches(): void {
  discoveryCache.clear();
  logger.info('Cleared all OIDC discovery caches');
}
