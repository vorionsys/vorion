/**
 * Direct unit tests for OIDCProvider class
 *
 * Tests the provider implementation with mocked openid-client dependency.
 * Unlike oidc-provider.test.ts (which tests SSOManager with OIDCProvider fully mocked),
 * this file exercises OIDCProvider methods directly: initialize, generateAuthorizationUrl,
 * exchangeCode, generateLogoutUrl, clearCache, and the factory/utility exports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OIDCProviderConfig, TokenExchangeRequest, AuthorizationState } from '../types.js';

// =============================================================================
// MOCKS
// =============================================================================

const mockDiscovery = vi.fn();
const mockBuildAuthorizationUrl = vi.fn();
const mockAuthorizationCodeGrant = vi.fn();
const mockRefreshTokenGrant = vi.fn();
const mockTokenRevocation = vi.fn();
const mockFetchUserInfo = vi.fn();
const mockClientSecretPost = vi.fn();
const mockNone = vi.fn();

vi.mock('openid-client', () => ({
  discovery: mockDiscovery,
  buildAuthorizationUrl: mockBuildAuthorizationUrl,
  authorizationCodeGrant: mockAuthorizationCodeGrant,
  refreshTokenGrant: mockRefreshTokenGrant,
  tokenRevocation: mockTokenRevocation,
  fetchUserInfo: mockFetchUserInfo,
  ClientSecretPost: mockClientSecretPost,
  None: mockNone,
  skipSubjectCheck: Symbol('skipSubjectCheck'),
}));

vi.mock('../../../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import AFTER mocks are set up
import { OIDCProvider, OIDCError, createOIDCProvider, clearAllDiscoveryCaches } from '../oidc-provider.js';

// =============================================================================
// HELPERS
// =============================================================================

function createConfig(overrides: Partial<OIDCProviderConfig> = {}): OIDCProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'okta',
    enabled: true,
    issuer: 'https://test.okta.com',
    clientId: 'client-123',
    clientSecret: 'secret-456',
    redirectUri: 'https://app.example.com/callback',
    scopes: ['openid', 'profile', 'email'],
    responseType: 'code',
    pkceEnabled: true,
    requestRefreshToken: true,
    tenantMapping: 'static',
    staticTenantId: 'tenant-1',
    jitProvisioningEnabled: false,
    ...overrides,
  };
}

const mockServerMetadata = vi.fn().mockReturnValue({
  authorization_endpoint: 'https://test.okta.com/authorize',
  token_endpoint: 'https://test.okta.com/token',
  revocation_endpoint: 'https://test.okta.com/revoke',
  userinfo_endpoint: 'https://test.okta.com/userinfo',
  end_session_endpoint: 'https://test.okta.com/logout',
});

/**
 * Build a fake JWT with the given payload claims.
 * The header and signature are stubs -- the provider decodes the payload
 * without cryptographic verification (openid-client validates during exchange).
 */
function createMockJWT(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.mock-signature`;
}

/**
 * Set up the default discovery mock so that initialize() succeeds.
 */
function setupDiscoveryMock(): void {
  mockDiscovery.mockResolvedValue({ serverMetadata: mockServerMetadata });
  mockClientSecretPost.mockReturnValue('client-secret-post-auth');
  mockNone.mockReturnValue('none-auth');
}

/**
 * Create an initialized OIDCProvider ready for method-level tests.
 */
async function createInitializedProvider(
  overrides: Partial<OIDCProviderConfig> = {}
): Promise<OIDCProvider> {
  setupDiscoveryMock();
  const provider = new OIDCProvider(createConfig(overrides));
  await provider.initialize();
  return provider;
}

/**
 * Create an AuthorizationState suitable for exchangeCode tests.
 */
function createStoredState(overrides: Partial<AuthorizationState> = {}): AuthorizationState {
  return {
    state: 'stored-state-value',
    nonce: 'stored-nonce',
    codeVerifier: 'stored-code-verifier',
    providerId: 'test-provider',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('OIDCProvider (direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the module-level discovery cache between tests so each test is isolated.
    clearAllDiscoveryCaches();
    setupDiscoveryMock();
    mockBuildAuthorizationUrl.mockReturnValue(new URL('https://test.okta.com/authorize?state=abc'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor & Getters
  // ===========================================================================

  describe('Constructor & Getters', () => {
    it('should return config.id via the id getter', () => {
      const provider = new OIDCProvider(createConfig({ id: 'my-custom-id' }));
      expect(provider.id).toBe('my-custom-id');
    });

    it('should return config.enabled via the enabled getter', () => {
      const enabledProvider = new OIDCProvider(createConfig({ enabled: true }));
      expect(enabledProvider.enabled).toBe(true);

      const disabledProvider = new OIDCProvider(createConfig({ enabled: false }));
      expect(disabledProvider.enabled).toBe(false);
    });

    it('should return a copy of config via getConfig() (not the same reference)', () => {
      const originalConfig = createConfig();
      const provider = new OIDCProvider(originalConfig);
      const returned = provider.getConfig();

      expect(returned).toEqual(originalConfig);
      expect(returned).not.toBe(originalConfig);
    });
  });

  // ===========================================================================
  // ensureInitialized guard
  // ===========================================================================

  describe('ensureInitialized guard', () => {
    it('should throw OIDCError with SSO_CONFIGURATION_ERROR from generateAuthorizationUrl before init', async () => {
      const provider = new OIDCProvider(createConfig());

      await expect(provider.generateAuthorizationUrl()).rejects.toThrow(OIDCError);

      try {
        await provider.generateAuthorizationUrl();
      } catch (err) {
        expect(err).toBeInstanceOf(OIDCError);
        expect((err as OIDCError).code).toBe('SSO_CONFIGURATION_ERROR');
        expect((err as OIDCError).message).toContain('not initialized');
      }
    });

    it('should throw OIDCError with SSO_CONFIGURATION_ERROR from exchangeCode before init', async () => {
      const provider = new OIDCProvider(createConfig());
      const request: TokenExchangeRequest = {
        code: 'auth-code',
        state: 'some-state',
        storedState: createStoredState(),
      };

      await expect(provider.exchangeCode(request)).rejects.toThrow(OIDCError);

      try {
        await provider.exchangeCode(request);
      } catch (err) {
        expect(err).toBeInstanceOf(OIDCError);
        expect((err as OIDCError).code).toBe('SSO_CONFIGURATION_ERROR');
      }
    });
  });

  // ===========================================================================
  // initialize() / Discovery
  // ===========================================================================

  describe('initialize() / Discovery', () => {
    it('should call openid-client discovery with correct issuer URL and clientId', async () => {
      const provider = new OIDCProvider(createConfig({
        issuer: 'https://my-issuer.example.com',
        clientId: 'my-client-id',
        clientSecret: 'my-secret',
      }));

      await provider.initialize();

      expect(mockDiscovery).toHaveBeenCalledTimes(1);
      const [issuerUrl, clientId] = mockDiscovery.mock.calls[0];
      expect(issuerUrl).toBeInstanceOf(URL);
      expect(issuerUrl.toString()).toBe('https://my-issuer.example.com/');
      expect(clientId).toBe('my-client-id');
    });

    it('should use ClientSecretPost when clientSecret is provided', async () => {
      const provider = new OIDCProvider(createConfig({ clientSecret: 'secret-xyz' }));

      await provider.initialize();

      expect(mockClientSecretPost).toHaveBeenCalledWith('secret-xyz');
      expect(mockNone).not.toHaveBeenCalled();
      // The 4th argument to discovery is the clientAuth
      const clientAuth = mockDiscovery.mock.calls[0][3];
      expect(clientAuth).toBe('client-secret-post-auth');
    });

    it('should use None when clientSecret is not provided', async () => {
      const provider = new OIDCProvider(createConfig({ clientSecret: undefined }));

      await provider.initialize();

      expect(mockNone).toHaveBeenCalled();
      expect(mockClientSecretPost).not.toHaveBeenCalled();
      const clientAuth = mockDiscovery.mock.calls[0][3];
      expect(clientAuth).toBe('none-auth');
    });

    it('should wrap discovery errors in OIDCError with code SSO_DISCOVERY_FAILED', async () => {
      const networkError = new Error('Network timeout');
      mockDiscovery.mockRejectedValueOnce(networkError);

      const provider = new OIDCProvider(createConfig());

      await expect(provider.initialize()).rejects.toThrow(OIDCError);

      try {
        // Need a fresh provider since the first one's initializePromise was cleared
        const provider2 = new OIDCProvider(createConfig({ id: 'provider-2' }));
        mockDiscovery.mockRejectedValueOnce(networkError);
        await provider2.initialize();
      } catch (err) {
        expect(err).toBeInstanceOf(OIDCError);
        expect((err as OIDCError).code).toBe('SSO_DISCOVERY_FAILED');
        expect((err as OIDCError).originalError).toBe(networkError);
        expect((err as OIDCError).message).toContain('Failed to discover OIDC configuration');
      }
    });
  });

  // ===========================================================================
  // generateAuthorizationUrl()
  // ===========================================================================

  describe('generateAuthorizationUrl()', () => {
    it('should return a URL and AuthorizationState with state, nonce, and codeVerifier', async () => {
      const provider = await createInitializedProvider();

      const result = await provider.generateAuthorizationUrl();

      expect(result.url).toBeDefined();
      expect(typeof result.url).toBe('string');
      expect(result.state).toBeDefined();
      expect(result.state.state).toBeDefined();
      expect(result.state.state.length).toBeGreaterThan(0);
      expect(result.state.nonce).toBeDefined();
      expect(result.state.nonce.length).toBeGreaterThan(0);
      // PKCE is enabled by default in createConfig
      expect(result.state.codeVerifier).toBeDefined();
      expect(result.state.codeVerifier!.length).toBeGreaterThan(0);
      expect(result.state.providerId).toBe('test-provider');
    });

    it('should include code_challenge and code_challenge_method when pkceEnabled', async () => {
      const provider = await createInitializedProvider({ pkceEnabled: true });

      await provider.generateAuthorizationUrl();

      expect(mockBuildAuthorizationUrl).toHaveBeenCalledTimes(1);
      const params = mockBuildAuthorizationUrl.mock.calls[0][1];
      expect(params.code_challenge).toBeDefined();
      expect(params.code_challenge.length).toBeGreaterThan(0);
      expect(params.code_challenge_method).toBe('S256');
    });

    it('should add offline_access scope when requestRefreshToken is true', async () => {
      const provider = await createInitializedProvider({
        requestRefreshToken: true,
        scopes: ['openid', 'profile'],
      });

      await provider.generateAuthorizationUrl();

      const params = mockBuildAuthorizationUrl.mock.calls[0][1];
      expect(params.scope).toContain('offline_access');
    });

    it('should set expiresAt based on stateExpirationSeconds option', async () => {
      const provider = await createInitializedProvider();

      const before = Date.now();
      const result = await provider.generateAuthorizationUrl({
        stateExpirationSeconds: 120,
      });
      const after = Date.now();

      const expiresAt = result.state.expiresAt.getTime();
      // expiresAt should be ~120 seconds from now
      expect(expiresAt).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 120 * 1000);
    });
  });

  // ===========================================================================
  // exchangeCode()
  // ===========================================================================

  describe('exchangeCode()', () => {
    it('should throw OIDCError with SSO_STATE_INVALID when state does not match', async () => {
      const provider = await createInitializedProvider();

      const request: TokenExchangeRequest = {
        code: 'auth-code-123',
        state: 'callback-state-WRONG',
        storedState: createStoredState({ state: 'stored-state-value' }),
      };

      await expect(provider.exchangeCode(request)).rejects.toThrow(OIDCError);

      try {
        await provider.exchangeCode(request);
      } catch (err) {
        expect((err as OIDCError).code).toBe('SSO_STATE_INVALID');
        expect((err as OIDCError).message).toContain('State parameter mismatch');
      }
    });

    it('should throw OIDCError with SSO_STATE_EXPIRED when state has expired', async () => {
      const provider = await createInitializedProvider();

      const request: TokenExchangeRequest = {
        code: 'auth-code-123',
        state: 'matching-state',
        storedState: createStoredState({
          state: 'matching-state',
          expiresAt: new Date(Date.now() - 10_000), // 10 seconds ago
        }),
      };

      await expect(provider.exchangeCode(request)).rejects.toThrow(OIDCError);

      try {
        await provider.exchangeCode(request);
      } catch (err) {
        expect((err as OIDCError).code).toBe('SSO_STATE_EXPIRED');
        expect((err as OIDCError).message).toContain('expired');
      }
    });

    it('should return tokens and parsed claims on successful exchange', async () => {
      const provider = await createInitializedProvider();

      const idTokenClaims = {
        iss: 'https://test.okta.com',
        sub: 'user-sub-001',
        aud: 'client-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: 'user@example.com',
        name: 'Test User',
      };
      const mockIdToken = createMockJWT(idTokenClaims);

      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: 'access-token-abc',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: mockIdToken,
        refresh_token: 'refresh-token-def',
        scope: 'openid profile email',
      });

      const storedState = createStoredState({ state: 'valid-state' });
      const request: TokenExchangeRequest = {
        code: 'auth-code-xyz',
        state: 'valid-state',
        storedState,
      };

      const result = await provider.exchangeCode(request);

      expect(result.tokens.accessToken).toBe('access-token-abc');
      expect(result.tokens.tokenType).toBe('Bearer');
      expect(result.tokens.refreshToken).toBe('refresh-token-def');
      expect(result.tokens.idToken).toBe(mockIdToken);
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
      expect(result.claims.sub).toBe('user-sub-001');
      expect(result.claims.email).toBe('user@example.com');

      // Verify authorizationCodeGrant was called with correct checks
      expect(mockAuthorizationCodeGrant).toHaveBeenCalledTimes(1);
      const [, , checks] = mockAuthorizationCodeGrant.mock.calls[0];
      expect(checks.expectedState).toBe('valid-state');
      expect(checks.expectedNonce).toBe(storedState.nonce);
      expect(checks.pkceCodeVerifier).toBe(storedState.codeVerifier);
    });
  });

  // ===========================================================================
  // parseIdToken — tested via exchangeCode
  // ===========================================================================

  describe('parseIdToken (via exchangeCode)', () => {
    it('should throw OIDCError with SSO_TOKEN_VALIDATION_FAILED when id_token is missing', async () => {
      const provider = await createInitializedProvider();

      // Token response with NO id_token
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: 'access-token-abc',
        token_type: 'Bearer',
        expires_in: 3600,
        // id_token intentionally omitted
      });

      const storedState = createStoredState({ state: 'valid-state' });
      const request: TokenExchangeRequest = {
        code: 'auth-code',
        state: 'valid-state',
        storedState,
      };

      await expect(provider.exchangeCode(request)).rejects.toThrow(OIDCError);

      try {
        await provider.exchangeCode(request);
      } catch (err) {
        expect((err as OIDCError).code).toBe('SSO_TOKEN_VALIDATION_FAILED');
        expect((err as OIDCError).message).toContain('No ID token');
      }
    });

    it('should throw OIDCError with SSO_TOKEN_VALIDATION_FAILED when JWT is malformed (not 3 parts)', async () => {
      const provider = await createInitializedProvider();

      // Token response with a malformed id_token (only 2 segments)
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: 'access-token-abc',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'only-two.parts',
      });

      const storedState = createStoredState({ state: 'valid-state' });
      const request: TokenExchangeRequest = {
        code: 'auth-code',
        state: 'valid-state',
        storedState,
      };

      await expect(provider.exchangeCode(request)).rejects.toThrow(OIDCError);

      try {
        await provider.exchangeCode(request);
      } catch (err) {
        expect((err as OIDCError).code).toBe('SSO_TOKEN_VALIDATION_FAILED');
        expect((err as OIDCError).message).toContain('Failed to parse ID token');
      }
    });
  });

  // ===========================================================================
  // generateLogoutUrl()
  // ===========================================================================

  describe('generateLogoutUrl()', () => {
    it('should return custom logoutUrl from config when set', async () => {
      const provider = await createInitializedProvider({
        logoutUrl: 'https://custom-logout.example.com/signout',
      });

      const url = provider.generateLogoutUrl();
      expect(url).toBe('https://custom-logout.example.com/signout');
    });

    it('should return null when end_session_endpoint is not available', async () => {
      mockServerMetadata.mockReturnValueOnce({
        authorization_endpoint: 'https://test.okta.com/authorize',
        token_endpoint: 'https://test.okta.com/token',
        // end_session_endpoint intentionally omitted
      });

      // We need a fresh provider that discovers the metadata without end_session_endpoint.
      // Since discovery is cached, clear first and reinitialize.
      clearAllDiscoveryCaches();
      const noEndSessionMetadata = vi.fn().mockReturnValue({
        authorization_endpoint: 'https://test.okta.com/authorize',
        token_endpoint: 'https://test.okta.com/token',
        // no end_session_endpoint
      });
      mockDiscovery.mockResolvedValueOnce({ serverMetadata: noEndSessionMetadata });

      const provider = new OIDCProvider(createConfig({ id: 'no-endsession-provider' }));
      await provider.initialize();

      const url = provider.generateLogoutUrl();
      expect(url).toBeNull();
    });
  });

  // ===========================================================================
  // clearCache()
  // ===========================================================================

  describe('clearCache()', () => {
    it('should reset initialization so ensureInitialized throws again', async () => {
      const provider = await createInitializedProvider();

      // Before clearCache, generateAuthorizationUrl should work
      const result = await provider.generateAuthorizationUrl();
      expect(result.url).toBeDefined();

      // After clearCache, the provider should not be initialized
      provider.clearCache();

      await expect(provider.generateAuthorizationUrl()).rejects.toThrow(OIDCError);

      try {
        await provider.generateAuthorizationUrl();
      } catch (err) {
        expect((err as OIDCError).code).toBe('SSO_CONFIGURATION_ERROR');
      }
    });
  });

  // ===========================================================================
  // clearAllDiscoveryCaches
  // ===========================================================================

  describe('clearAllDiscoveryCaches()', () => {
    it('should not throw when called', () => {
      expect(() => clearAllDiscoveryCaches()).not.toThrow();
    });
  });

  // ===========================================================================
  // createOIDCProvider factory
  // ===========================================================================

  describe('createOIDCProvider()', () => {
    it('should return an initialized OIDCProvider', async () => {
      const provider = await createOIDCProvider(createConfig());

      expect(provider).toBeInstanceOf(OIDCProvider);
      expect(provider.id).toBe('test-provider');

      // Should be initialized -- generateAuthorizationUrl should not throw SSO_CONFIGURATION_ERROR
      const result = await provider.generateAuthorizationUrl();
      expect(result.url).toBeDefined();
    });
  });

  // ===========================================================================
  // OIDCError class
  // ===========================================================================

  describe('OIDCError', () => {
    it('should capture code, providerId, originalError, and details', () => {
      const original = new Error('underlying issue');
      const err = new OIDCError('Test failure', 'SSO_DISCOVERY_FAILED', {
        providerId: 'prov-1',
        originalError: original,
        details: { issuer: 'https://example.com' },
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(OIDCError);
      expect(err.name).toBe('OIDCError');
      expect(err.message).toBe('Test failure');
      expect(err.code).toBe('SSO_DISCOVERY_FAILED');
      expect(err.providerId).toBe('prov-1');
      expect(err.originalError).toBe(original);
      expect(err.details).toEqual({ issuer: 'https://example.com' });
    });
  });
});
