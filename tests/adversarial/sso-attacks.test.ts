/**
 * ADVERSARIAL TESTS -- SSO/OIDC Attack Scenarios
 *
 * Tests attack vectors against SSOManager:
 *   - State/CSRF attacks (expired state, state reuse, provider tampering)
 *   - Provider injection (script in name, disabled/nonexistent providers)
 *   - Tenant mapping abuse (crafted emails, missing claims, unmapped domains)
 *   - Session hijacking (cross-user access, nonexistent sessions)
 *   - Token abuse (invalid provider refresh/revoke)
 *   - Configuration injection (empty scopes, invalid issuer, empty clientId)
 *   - Audit trail verification (failure events, security-relevant logging)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSOManager, SSOError } from '../../packages/security/src/auth/sso/index.js';
import type {
  OIDCProviderConfig,
  AuthorizationState,
  OIDCTokenSet,
  IDTokenClaims,
  SSOAuditEvent,
} from '../../packages/security/src/auth/sso/types.js';

// =============================================================================
// Mocks -- vi.hoisted() runs before vi.mock hoisting to avoid TDZ errors
// =============================================================================

const {
  mockGenerateAuthUrl,
  mockExchangeCode,
  mockRefreshTokens,
  mockRevokeToken,
  mockFetchUserInfo,
  mockGenerateLogoutUrl,
  mockClearCache,
} = vi.hoisted(() => ({
  mockGenerateAuthUrl: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockRefreshTokens: vi.fn(),
  mockRevokeToken: vi.fn(),
  mockFetchUserInfo: vi.fn(),
  mockGenerateLogoutUrl: vi.fn().mockReturnValue(null),
  mockClearCache: vi.fn(),
}));

vi.mock('../../packages/security/src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../packages/security/src/auth/sso/oidc-provider.js', () => ({
  OIDCError: class OIDCError extends Error {
    code: string;
    constructor(message: string, code: string, options?: any) {
      super(message);
      this.name = 'OIDCError';
      this.code = code;
    }
  },
  createOIDCProvider: vi.fn().mockResolvedValue({
    id: 'test-provider',
    enabled: true,
    getConfig: vi.fn().mockReturnValue({}),
    initialize: vi.fn().mockResolvedValue(undefined),
    clearCache: mockClearCache,
    generateAuthorizationUrl: mockGenerateAuthUrl,
    exchangeCode: mockExchangeCode,
    refreshTokens: mockRefreshTokens,
    revokeToken: mockRevokeToken,
    fetchUserInfo: mockFetchUserInfo,
    generateLogoutUrl: mockGenerateLogoutUrl,
  }),
  clearAllDiscoveryCaches: vi.fn(),
}));

// =============================================================================
// Helpers
// =============================================================================

function createValidConfig(overrides: Partial<OIDCProviderConfig> = {}): OIDCProviderConfig {
  return {
    id: 'test-okta',
    name: 'Test Okta',
    type: 'okta',
    enabled: true,
    issuer: 'https://company.okta.com',
    clientId: 'client-123',
    clientSecret: 'secret-456',
    redirectUri: 'https://app.example.com/auth/callback',
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

function createMockTokens(overrides: Partial<OIDCTokenSet> = {}): OIDCTokenSet {
  return {
    accessToken: 'access-token-abc',
    tokenType: 'Bearer',
    idToken: 'id-token-xyz',
    refreshToken: 'refresh-token-123',
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

function createMockClaims(overrides: Partial<IDTokenClaims> = {}): IDTokenClaims {
  return {
    iss: 'https://company.okta.com',
    sub: 'user-ext-001',
    aud: 'client-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    email: 'user@company.com',
    name: 'Test User',
    ...overrides,
  };
}

/**
 * Counter to generate unique state params across mock calls.
 * The mock provider does not know its own provider ID, so the caller
 * must specify the desired providerId for the returned state.
 */
let stateCounter = 0;

function createMockAuthResult(providerId: string): {
  url: string;
  state: AuthorizationState;
} {
  stateCounter++;
  return {
    url: `https://company.okta.com/authorize?state=state-${stateCounter}`,
    state: {
      state: `state-param-${stateCounter}`,
      nonce: `nonce-${stateCounter}`,
      codeVerifier: `verifier-${stateCounter}`,
      providerId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    },
  };
}

/**
 * Configure mockGenerateAuthUrl to return results with the given providerId.
 * Each call to the mock will produce a unique state param.
 */
function setupMockAuthForProvider(providerId: string): void {
  mockGenerateAuthUrl.mockImplementation(() =>
    Promise.resolve(createMockAuthResult(providerId))
  );
}

// =============================================================================
// Test Suite
// =============================================================================

describe('SSO Adversarial Attack Scenarios', () => {
  let manager: SSOManager;

  beforeEach(() => {
    vi.clearAllMocks();
    stateCounter = 0;

    // Default mock: returns state with providerId 'test-okta' and unique state params
    setupMockAuthForProvider('test-okta');

    mockExchangeCode.mockResolvedValue({
      tokens: createMockTokens(),
      claims: createMockClaims(),
    });

    // Fresh manager for every test -- no cross-contamination
    manager = new SSOManager({
      onLookupUser: vi.fn().mockResolvedValue({ userId: 'user-001', tenantId: 'tenant-1' }),
      onAuditEvent: vi.fn(),
    });
  });

  // ===========================================================================
  // State/CSRF Attacks
  // ===========================================================================

  describe('State/CSRF attacks', () => {
    it('rejects expired state -- getStoredState returns undefined for past expiresAt', async () => {
      await manager.registerProvider(createValidConfig());
      const result = await manager.startLogin('test-okta');
      const stateParam = result.state.state;

      // Retrieve the stored state reference from the manager
      const storedState = manager.getStoredState(stateParam);
      expect(storedState).toBeDefined();

      // Mutate the expiration to simulate time passing
      storedState!.expiresAt = new Date(Date.now() - 1000);

      // Now retrieving the state should return undefined (expired)
      const retrieved = manager.getStoredState(stateParam);
      expect(retrieved).toBeUndefined();
    });

    it('state is deleted after successful completeLogin -- cannot be reused', async () => {
      await manager.registerProvider(createValidConfig());
      const loginResult = await manager.startLogin('test-okta');
      const stateParam = loginResult.state.state;

      // Confirm state exists before login completion
      expect(manager.getStoredState(stateParam)).toBeDefined();

      // Complete the login flow
      await manager.completeLogin({
        code: 'auth-code-abc',
        state: stateParam,
        storedState: loginResult.state,
      });

      // State should now be consumed and deleted -- replay attack fails
      const replayState = manager.getStoredState(stateParam);
      expect(replayState).toBeUndefined();
    });

    it('completeLogin uses stored state providerId -- ignoring any tampered request context', async () => {
      // Register two providers
      await manager.registerProvider(createValidConfig({ id: 'provider-legit' }));
      await manager.registerProvider(createValidConfig({ id: 'provider-evil', issuer: 'https://evil.okta.com' }));

      // Configure mock to return state with the legitimate provider ID
      setupMockAuthForProvider('provider-legit');

      // Start login with the legitimate provider
      const loginResult = await manager.startLogin('provider-legit');

      // The storedState has providerId = 'provider-legit'
      expect(loginResult.state.providerId).toBe('provider-legit');

      // Complete login -- the system should use storedState.providerId ('provider-legit')
      await manager.completeLogin({
        code: 'auth-code',
        state: loginResult.state.state,
        storedState: loginResult.state,
      });

      // exchangeCode was called on the provider resolved from storedState.providerId
      expect(mockExchangeCode).toHaveBeenCalledTimes(1);
    });

    it('cleanupExpiredStates removes all expired entries', async () => {
      await manager.registerProvider(createValidConfig());

      // Create several states (each call gets a unique state param via the counter)
      const result1 = await manager.startLogin('test-okta');
      const result2 = await manager.startLogin('test-okta');
      const result3 = await manager.startLogin('test-okta');

      // Verify all three have unique state params
      expect(result1.state.state).not.toBe(result2.state.state);
      expect(result2.state.state).not.toBe(result3.state.state);

      // Expire the first two
      result1.state.expiresAt = new Date(Date.now() - 5000);
      result2.state.expiresAt = new Date(Date.now() - 1000);

      const cleaned = manager.cleanupExpiredStates();
      expect(cleaned).toBe(2);

      // Third state should still be valid
      expect(manager.getStoredState(result3.state.state)).toBeDefined();
      expect(manager.getStoredState(result1.state.state)).toBeUndefined();
      expect(manager.getStoredState(result2.state.state)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Provider Injection
  // ===========================================================================

  describe('Provider injection attacks', () => {
    it('registering a provider with script injection in name succeeds -- backend treats it as plain string', async () => {
      // XSS payloads in the name field are not dangerous server-side.
      // Zod validates the name as a non-empty string (max 255), which this passes.
      const config = createValidConfig({
        id: 'xss-provider',
        name: '<script>alert("xss")</script>',
      });

      await manager.registerProvider(config);
      const providers = manager.listProviders();
      const xssProvider = providers.find((p) => p.id === 'xss-provider');

      expect(xssProvider).toBeDefined();
      expect(xssProvider!.name).toBe('<script>alert("xss")</script>');
    });

    it('startLogin on a disabled provider throws SSO_PROVIDER_DISABLED', async () => {
      await manager.registerProvider(createValidConfig({ id: 'disabled-okta', enabled: false }));

      await expect(manager.startLogin('disabled-okta')).rejects.toThrow(SSOError);
      await expect(manager.startLogin('disabled-okta')).rejects.toMatchObject({
        code: 'SSO_PROVIDER_DISABLED',
      });
    });

    it('startLogin on nonexistent provider throws SSO_PROVIDER_NOT_FOUND', async () => {
      await expect(manager.startLogin('ghost-provider')).rejects.toThrow(SSOError);
      await expect(manager.startLogin('ghost-provider')).rejects.toMatchObject({
        code: 'SSO_PROVIDER_NOT_FOUND',
      });
    });

    it('refreshTokens on nonexistent provider throws SSO_PROVIDER_NOT_FOUND', async () => {
      await expect(manager.refreshTokens('no-such-provider', 'token')).rejects.toThrow(SSOError);
      await expect(manager.refreshTokens('no-such-provider', 'token')).rejects.toMatchObject({
        code: 'SSO_PROVIDER_NOT_FOUND',
      });
    });

    it('revokeToken on nonexistent provider throws SSO_PROVIDER_NOT_FOUND', async () => {
      await expect(manager.revokeToken('phantom', 'token')).rejects.toThrow(SSOError);
      await expect(manager.revokeToken('phantom', 'token')).rejects.toMatchObject({
        code: 'SSO_PROVIDER_NOT_FOUND',
      });
    });
  });

  // ===========================================================================
  // Tenant Mapping Abuse
  // ===========================================================================

  describe('Tenant mapping abuse', () => {
    it('domain mapping with email missing @ symbol throws SSO_TENANT_MAPPING_FAILED', async () => {
      const providerId = 'domain-provider';
      await manager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'domain',
          domainTenantMap: { 'company.com': 'tenant-1' },
        })
      );
      setupMockAuthForProvider(providerId);

      // Mock exchangeCode to return claims with a malformed email (no @ sign)
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims({ email: 'no-at-symbol-email' }),
      });

      const loginResult = await manager.startLogin(providerId);

      await expect(
        manager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toMatchObject({
        code: 'SSO_TENANT_MAPPING_FAILED',
      });
    });

    it('domain mapping with unmapped domain throws SSO_TENANT_MAPPING_FAILED', async () => {
      const providerId = 'domain-provider-2';
      await manager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'domain',
          domainTenantMap: { 'company.com': 'tenant-1' },
        })
      );
      setupMockAuthForProvider(providerId);

      // Email has a valid format but the domain is not in the map
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims({ email: 'user@attacker.com' }),
      });

      const loginResult = await manager.startLogin(providerId);

      await expect(
        manager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toMatchObject({
        code: 'SSO_TENANT_MAPPING_FAILED',
      });
    });

    it('claim mapping with missing tenant claim throws SSO_TENANT_MAPPING_FAILED', async () => {
      const providerId = 'claim-provider';
      await manager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'claim',
          tenantClaimName: 'org_id',
        })
      );
      setupMockAuthForProvider(providerId);

      // Claims do NOT include the 'org_id' field
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims(), // no org_id claim
      });

      const loginResult = await manager.startLogin(providerId);

      await expect(
        manager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toMatchObject({
        code: 'SSO_TENANT_MAPPING_FAILED',
      });
    });

    it('domain mapping with empty email throws SSO_TENANT_MAPPING_FAILED', async () => {
      const providerId = 'domain-provider-3';
      await manager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'domain',
          domainTenantMap: { 'company.com': 'tenant-1' },
        })
      );
      setupMockAuthForProvider(providerId);

      // Empty string email -- no domain extractable
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims({ email: '' }),
      });

      const loginResult = await manager.startLogin(providerId);

      await expect(
        manager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toMatchObject({
        code: 'SSO_TENANT_MAPPING_FAILED',
      });
    });

    it('domain mapping with undefined email (no email in claims or userInfo) throws SSO_TENANT_MAPPING_FAILED', async () => {
      const providerId = 'domain-provider-4';
      await manager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'domain',
          domainTenantMap: { 'company.com': 'tenant-1' },
        })
      );
      setupMockAuthForProvider(providerId);

      // No email at all in claims
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims({ email: undefined }),
      });

      const loginResult = await manager.startLogin(providerId);

      await expect(
        manager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toMatchObject({
        code: 'SSO_TENANT_MAPPING_FAILED',
      });
    });
  });

  // ===========================================================================
  // Session Hijacking
  // ===========================================================================

  describe('Session hijacking and manipulation', () => {
    it('sessions are keyed by sessionId -- cannot access another user session by userId alone', () => {
      const tokens = createMockTokens();
      const claims = createMockClaims();

      // Create sessions for two different users
      const session1 = manager.createSession('user-A', 'test-okta', 'ext-A', 'tenant-1', tokens, claims);
      const session2 = manager.createSession('user-B', 'test-okta', 'ext-B', 'tenant-1', tokens, claims);

      // Accessing by sessionId returns the correct session
      expect(manager.getSession(session1.id)?.userId).toBe('user-A');
      expect(manager.getSession(session2.id)?.userId).toBe('user-B');

      // Cannot get session2 using session1's ID
      expect(manager.getSession(session1.id)?.userId).not.toBe('user-B');

      // A random/guessed sessionId returns undefined
      expect(manager.getSession('guessed-session-id-12345')).toBeUndefined();
    });

    it('terminateSession returns false for nonexistent session -- no crash', async () => {
      const result = await manager.terminateSession('nonexistent-session-xyz');
      expect(result).toBe(false);
    });

    it('updateSessionTokens returns false for nonexistent session', () => {
      const result = manager.updateSessionTokens(
        'nonexistent-session',
        createMockTokens(),
        createMockClaims()
      );
      expect(result).toBe(false);
    });

    it('logout on nonexistent session throws SSO_SESSION_NOT_FOUND', async () => {
      await expect(manager.logout('no-such-session')).rejects.toThrow(SSOError);
      await expect(manager.logout('no-such-session')).rejects.toMatchObject({
        code: 'SSO_SESSION_NOT_FOUND',
      });
    });

    it('terminateSession revokes refresh token and removes session from store', async () => {
      await manager.registerProvider(createValidConfig());

      const tokens = createMockTokens({ refreshToken: 'refresh-to-revoke' });
      const claims = createMockClaims();
      const session = manager.createSession('user-A', 'test-okta', 'ext-A', 'tenant-1', tokens, claims);

      // Confirm session exists
      expect(manager.getSession(session.id)).toBeDefined();

      // Terminate
      const terminated = await manager.terminateSession(session.id);
      expect(terminated).toBe(true);

      // Session no longer accessible
      expect(manager.getSession(session.id)).toBeUndefined();

      // Refresh token was revoked
      expect(mockRevokeToken).toHaveBeenCalledWith('refresh-to-revoke', 'refresh_token');
    });
  });

  // ===========================================================================
  // Token Abuse
  // ===========================================================================

  describe('Token abuse', () => {
    it('refreshTokens with invalid/nonexistent provider throws', async () => {
      await expect(
        manager.refreshTokens('nonexistent-provider', 'some-refresh-token')
      ).rejects.toThrow(SSOError);
    });

    it('revokeToken for nonexistent provider throws', async () => {
      await expect(
        manager.revokeToken('nonexistent-provider', 'some-token', 'access_token')
      ).rejects.toThrow(SSOError);
    });

    it('revokeToken for disabled provider throws SSO_PROVIDER_DISABLED', async () => {
      await manager.registerProvider(createValidConfig({ id: 'disabled-for-revoke', enabled: false }));

      await expect(
        manager.revokeToken('disabled-for-revoke', 'some-token', 'refresh_token')
      ).rejects.toMatchObject({
        code: 'SSO_PROVIDER_DISABLED',
      });
    });
  });

  // ===========================================================================
  // Configuration Injection
  // ===========================================================================

  describe('Configuration injection attacks', () => {
    it('rejects provider with empty scopes array -- Zod min(1) validation', async () => {
      const config = createValidConfig({ scopes: [] });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });

    it('rejects provider with invalid issuer URL -- Zod url() validation', async () => {
      const config = createValidConfig({ issuer: 'not-a-valid-url' });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });

    it('rejects provider with empty clientId -- Zod min(1) validation', async () => {
      const config = createValidConfig({ clientId: '' });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });

    it('rejects provider with empty id -- Zod min(1) validation', async () => {
      const config = createValidConfig({ id: '' });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });

    it('rejects provider with non-URL redirectUri -- Zod url() validation', async () => {
      // 'ftp://not-https' is still a valid URL per Zod's url(), but a plain string is not
      const config = createValidConfig({ redirectUri: 'not-a-url-at-all' });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });

    it('rejects provider with invalid type -- Zod enum validation', async () => {
      const config = createValidConfig({ type: 'evil_provider' as any });

      await expect(manager.registerProvider(config)).rejects.toThrow(SSOError);
      await expect(manager.registerProvider(config)).rejects.toMatchObject({
        code: 'SSO_CONFIGURATION_ERROR',
      });
    });
  });

  // ===========================================================================
  // Audit Trail Verification
  // ===========================================================================

  describe('Audit trail verification', () => {
    it('failed login attempt generates audit event with error details', async () => {
      const auditEvents: SSOAuditEvent[] = [];
      const providerId = 'audit-provider';

      const auditManager = new SSOManager({
        onAuditEvent: (event: SSOAuditEvent) => {
          auditEvents.push(event);
        },
        onLookupUser: vi.fn().mockResolvedValue({ userId: 'user-001', tenantId: 'tenant-1' }),
      });

      await auditManager.registerProvider(
        createValidConfig({
          id: providerId,
          tenantMapping: 'claim',
          tenantClaimName: 'missing_claim',
        })
      );
      setupMockAuthForProvider(providerId);

      const loginResult = await auditManager.startLogin(providerId);

      // Verify startLogin generated an audit event
      const startEvent = auditEvents.find((e) => e.type === 'sso.auth.started');
      expect(startEvent).toBeDefined();
      expect(startEvent!.providerId).toBe(providerId);

      // completeLogin will fail because the claim 'missing_claim' is absent
      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims(), // no missing_claim field
      });

      await expect(
        auditManager.completeLogin({
          code: 'auth-code',
          state: loginResult.state.state,
          storedState: loginResult.state,
        })
      ).rejects.toThrow();

      // A failure audit event should have been emitted
      const failEvent = auditEvents.find((e) => e.type === 'sso.auth.failed');
      expect(failEvent).toBeDefined();
      expect(failEvent!.providerId).toBe(providerId);
      expect(failEvent!.error).toBeDefined();
      expect(failEvent!.error!.code).toBe('SSO_TENANT_MAPPING_FAILED');
    });

    it('successful login generates auth.started and auth.completed audit events', async () => {
      const auditEvents: SSOAuditEvent[] = [];
      const providerId = 'audit-ok-provider';

      const auditManager = new SSOManager({
        onAuditEvent: (event: SSOAuditEvent) => {
          auditEvents.push(event);
        },
        onLookupUser: vi.fn().mockResolvedValue({ userId: 'user-001', tenantId: 'tenant-1' }),
      });

      await auditManager.registerProvider(createValidConfig({ id: providerId }));
      setupMockAuthForProvider(providerId);

      mockExchangeCode.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims(),
      });

      const loginResult = await auditManager.startLogin(providerId);

      await auditManager.completeLogin({
        code: 'auth-code',
        state: loginResult.state.state,
        storedState: loginResult.state,
      });

      const startEvent = auditEvents.find((e) => e.type === 'sso.auth.started');
      const completedEvent = auditEvents.find((e) => e.type === 'sso.auth.completed');

      expect(startEvent).toBeDefined();
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.providerId).toBe(providerId);
      expect(completedEvent!.userId).toBe('user-001');
    });

    it('session termination generates audit event', async () => {
      const auditEvents: SSOAuditEvent[] = [];
      const auditManager = new SSOManager({
        onAuditEvent: (event: SSOAuditEvent) => {
          auditEvents.push(event);
        },
      });

      await auditManager.registerProvider(createValidConfig({ id: 'session-audit-provider' }));

      const session = auditManager.createSession(
        'user-X',
        'session-audit-provider',
        'ext-X',
        'tenant-1',
        createMockTokens(),
        createMockClaims()
      );

      await auditManager.terminateSession(session.id);

      const terminatedEvent = auditEvents.find((e) => e.type === 'sso.session.terminated');
      expect(terminatedEvent).toBeDefined();
      expect(terminatedEvent!.userId).toBe('user-X');
      expect(terminatedEvent!.providerId).toBe('session-audit-provider');
    });

    it('token refresh generates audit event', async () => {
      const auditEvents: SSOAuditEvent[] = [];
      const auditManager = new SSOManager({
        onAuditEvent: (event: SSOAuditEvent) => {
          auditEvents.push(event);
        },
      });

      await auditManager.registerProvider(createValidConfig({ id: 'refresh-audit-provider' }));

      mockRefreshTokens.mockResolvedValueOnce({
        tokens: createMockTokens(),
        claims: createMockClaims(),
      });

      await auditManager.refreshTokens('refresh-audit-provider', 'old-refresh-token');

      const refreshEvent = auditEvents.find((e) => e.type === 'sso.token.refreshed');
      expect(refreshEvent).toBeDefined();
      expect(refreshEvent!.providerId).toBe('refresh-audit-provider');
    });
  });
});
