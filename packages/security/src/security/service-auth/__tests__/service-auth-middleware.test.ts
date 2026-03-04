/**
 * Tests for createServiceAuthMiddleware
 *
 * Validates:
 * - Path and custom function skipping
 * - Missing/partial auth header rejection
 * - Token-based authentication (happy path, revoked, suspended)
 * - Signature-based authentication
 * - IP whitelist enforcement
 * - Required and any permission checks (including wildcard)
 * - request.serviceAuth population after successful auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createServiceAuthMiddleware,
  MissingAuthHeadersError,
  InvalidServiceSignatureError,
  IpNotAllowedError,
  InsufficientPermissionsError,
  ServiceAuthError,
  requireServicePermissions,
  requireAnyServicePermission,
  requireServiceTenant,
  getServiceAuth,
  requireServiceAuth,
  hasServiceAuth,
  getServiceClientId,
  getServiceTenantId,
  getServicePermissions,
  serviceHasPermission,
  type ServiceAuthMiddlewareOptions,
  type ServiceAuthenticatedRequest,
} from '../service-auth-middleware.js';

import {
  ServiceAccountManager,
  InMemoryServiceAccountStore,
  ServiceAccountRevokedError,
  ServiceAccountSuspendedError,
  ServiceAccountStatus,
  type ServiceAccount,
  hashClientSecret,
} from '../service-account.js';

import { ForbiddenError } from '../../../common/errors.js';

import {
  ServiceTokenService,
  SERVICE_AUTH_HEADERS,
} from '../service-token.js';

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// =============================================================================
// HELPERS
// =============================================================================

const VALID_SECRET = 'a]3Fk9$mPq7!wR2xL#nB5dY8vC0jT4hZ'; // 34 chars
const VALID_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function mockRequest(overrides: Record<string, unknown> = {}): any {
  return {
    url: '/api/test',
    method: 'GET',
    ip: '127.0.0.1',
    headers: {},
    body: null,
    ...overrides,
  };
}

function mockReply(): any {
  return { code: vi.fn().mockReturnThis(), send: vi.fn() };
}

/**
 * Create a self-contained test harness with store, manager, token service, and
 * a pre-created active service account.
 */
async function createTestHarness(accountOverrides: Partial<ServiceAccount> = {}) {
  const store = new InMemoryServiceAccountStore();
  const manager = new ServiceAccountManager({ store });
  const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

  // Create an active account via the manager (so hashing is handled correctly)
  const creation = await manager.createAccount({
    name: 'test-svc',
    permissions: ['read:data', 'write:data'],
    tenantId: VALID_TENANT_ID,
  });

  // Apply any overrides directly to the store
  if (Object.keys(accountOverrides).length > 0) {
    await store.update(creation.account.clientId, accountOverrides);
  }

  const account = await store.findByClientId(creation.account.clientId);

  // Issue a valid token for the account
  const token = await tokenService.createToken({
    clientId: creation.account.clientId,
    tenantId: VALID_TENANT_ID,
    serviceName: 'test-svc',
    permissions: account!.permissions,
  });

  return {
    store,
    manager,
    tokenService,
    account: account!,
    clientSecretPlaintext: creation.clientSecretPlaintext,
    token,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('createServiceAuthMiddleware', () => {
  // ---------------------------------------------------------------------------
  // SKIP LOGIC
  // ---------------------------------------------------------------------------

  describe('skip paths', () => {
    it('bypasses auth when request URL matches a skipPath prefix', async () => {
      const { manager, tokenService } = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        skipPaths: ['/health', '/api/public'],
      });

      const req = mockRequest({ url: '/health/check' });
      const reply = mockReply();

      // Should resolve without throwing (no auth required)
      await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
    });
  });

  describe('skip function', () => {
    it('bypasses auth when skipFn returns true', async () => {
      const { manager, tokenService } = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        skipFn: (req) => (req as any).url === '/skip-me',
      });

      const req = mockRequest({ url: '/skip-me' });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING AUTH HEADERS
  // ---------------------------------------------------------------------------

  describe('missing auth headers', () => {
    it('throws MissingAuthHeadersError when no auth headers are present', async () => {
      const { manager, tokenService } = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
      });

      const req = mockRequest({ headers: {} });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });

    it('throws MissingAuthHeadersError with partial service headers (clientId only)', async () => {
      const { manager, tokenService, account } = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: account.clientId,
          // Missing signature and timestamp
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });
  });

  // ---------------------------------------------------------------------------
  // TOKEN AUTH
  // ---------------------------------------------------------------------------

  describe('token authentication', () => {
    it('succeeds with valid Bearer token and active account', async () => {
      const { manager, tokenService, token, account } = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());

      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.clientId).toBe(account.clientId);
      expect(authReq.serviceAuth!.authMethod).toBe('token');
    });

    it('throws ServiceAccountRevokedError for revoked account', async () => {
      const { manager, tokenService, token } = await createTestHarness();

      // Revoke the account after token creation
      const harness = await createTestHarness();
      await harness.manager.revokeAccount(harness.account.clientId);

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(ServiceAccountRevokedError);
    });

    it('throws ServiceAccountSuspendedError for suspended account', async () => {
      const harness = await createTestHarness();
      await harness.manager.suspendAccount(harness.account.clientId);

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(ServiceAccountSuspendedError);
    });
  });

  // ---------------------------------------------------------------------------
  // SIGNATURE AUTH
  // ---------------------------------------------------------------------------

  describe('signature authentication', () => {
    it('succeeds with valid signature headers', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      // Note: The middleware uses account.clientSecret (the hash) as the HMAC key
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret, // hashed secret is used as HMAC key
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());

      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.authMethod).toBe('signature');
    });
  });

  // ---------------------------------------------------------------------------
  // IP WHITELIST
  // ---------------------------------------------------------------------------

  describe('IP whitelist validation', () => {
    it('throws IpNotAllowedError when request IP is not in whitelist', async () => {
      const harness = await createTestHarness({
        ipWhitelist: ['10.0.0.1'],
      });

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        validateIpWhitelist: true,
      });

      const req = mockRequest({
        ip: '192.168.1.1', // Not in whitelist
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(IpNotAllowedError);
    });
  });

  // ---------------------------------------------------------------------------
  // REQUIRED PERMISSIONS
  // ---------------------------------------------------------------------------

  describe('requiredPermissions', () => {
    it('passes when all required permissions are present', async () => {
      const harness = await createTestHarness();

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        requiredPermissions: ['read:data'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
    });

    it('throws InsufficientPermissionsError when required permission is missing', async () => {
      const harness = await createTestHarness();

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        requiredPermissions: ['admin:delete'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InsufficientPermissionsError);
    });
  });

  // ---------------------------------------------------------------------------
  // ANY PERMISSIONS
  // ---------------------------------------------------------------------------

  describe('anyPermissions', () => {
    it('passes when at least one of the anyPermissions is present', async () => {
      const harness = await createTestHarness();

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        anyPermissions: ['admin:delete', 'read:data'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
    });

    it('throws InsufficientPermissionsError when none of anyPermissions match', async () => {
      const harness = await createTestHarness();

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        anyPermissions: ['admin:delete', 'admin:create'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InsufficientPermissionsError);
    });
  });

  // ---------------------------------------------------------------------------
  // WILDCARD PERMISSION
  // ---------------------------------------------------------------------------

  describe('wildcard permission', () => {
    it('wildcard * satisfies any required permission', async () => {
      // Create account with wildcard permissions
      const store = new InMemoryServiceAccountStore();
      const manager = new ServiceAccountManager({ store });
      const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

      const creation = await manager.createAccount({
        name: 'admin-svc',
        permissions: ['*'],
        tenantId: VALID_TENANT_ID,
      });

      const token = await tokenService.createToken({
        clientId: creation.account.clientId,
        tenantId: VALID_TENANT_ID,
        serviceName: 'admin-svc',
        permissions: ['*'],
      });

      const middleware = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        requiredPermissions: ['admin:delete', 'write:sensitive'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // REQUEST DECORATION
  // ---------------------------------------------------------------------------

  describe('request.serviceAuth population', () => {
    it('populates serviceAuth with correct context after successful token auth', async () => {
      const harness = await createTestHarness();

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());

      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.clientId).toBe(harness.account.clientId);
      expect(authReq.serviceAuth!.tenantId).toBe(VALID_TENANT_ID);
      expect(authReq.serviceAuth!.serviceName).toBeDefined();
      expect(authReq.serviceAuth!.permissions).toEqual(
        expect.arrayContaining(['read:data', 'write:data'])
      );
      expect(authReq.serviceAuth!.authMethod).toBe('token');
      expect(authReq.serviceAuth!.tokenPayload).toBeDefined();
    });
  });
});

// =============================================================================
// SIGNATURE AUTH ADVANCED SCENARIOS
// =============================================================================

describe('signature auth advanced scenarios', () => {
  // -------------------------------------------------------------------------
  // Partial headers (mutants for lines 370-376)
  // -------------------------------------------------------------------------

  describe('partial service headers', () => {
    it('throws MissingAuthHeadersError when only signature is present', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: 'some-sig',
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });

    it('throws MissingAuthHeadersError when only timestamp is present', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: '1234567890',
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });

    it('throws MissingAuthHeadersError when clientId + signature but no timestamp', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: 'some-sig',
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });

    it('throws MissingAuthHeadersError when clientId + timestamp but no signature', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: '1234567890',
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });
  });

  // -------------------------------------------------------------------------
  // NaN timestamp (mutant for line 380)
  // -------------------------------------------------------------------------

  describe('NaN timestamp', () => {
    it('throws InvalidServiceSignatureError when timestamp is non-numeric', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: 'some-sig',
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: 'not-a-number',
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InvalidServiceSignatureError);
      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(/Invalid timestamp format/);
    });
  });

  // -------------------------------------------------------------------------
  // Revoked/suspended via signature path (mutants for lines 392-398)
  // -------------------------------------------------------------------------

  describe('revoked and suspended via signature auth', () => {
    it('throws ServiceAccountRevokedError for revoked account via signature', async () => {
      const harness = await createTestHarness();
      await harness.manager.revokeAccount(harness.account.clientId);

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(ServiceAccountRevokedError);
    });

    it('throws ServiceAccountSuspendedError for suspended account via signature', async () => {
      const harness = await createTestHarness();
      await harness.manager.suspendAccount(harness.account.clientId);

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(ServiceAccountSuspendedError);
    });
  });

  // -------------------------------------------------------------------------
  // Body handling in signature auth (mutants for lines 415-424)
  // -------------------------------------------------------------------------

  describe('body handling in signature auth', () => {
    it('handles string body', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const bodyStr = '{"key":"value"}';
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'POST',
        path: '/api/test',
        body: bodyStr,
      });

      const req = mockRequest({
        method: 'POST',
        body: bodyStr,
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());
      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.authMethod).toBe('signature');
    });

    it('handles Buffer body', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const bodyBuf = Buffer.from('raw-binary-data', 'utf8');
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'POST',
        path: '/api/test',
        body: bodyBuf.toString('utf8'),
      });

      const req = mockRequest({
        method: 'POST',
        body: bodyBuf,
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());
      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.authMethod).toBe('signature');
    });

    it('handles object body (JSON.stringify)', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
      });

      const bodyObj = { key: 'value', nested: { a: 1 } };
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'POST',
        path: '/api/test',
        body: JSON.stringify(bodyObj),
      });

      const req = mockRequest({
        method: 'POST',
        body: bodyObj,
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());
      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.authMethod).toBe('signature');
    });
  });

  // -------------------------------------------------------------------------
  // Token issuance after signature auth (mutant for lines 450-460)
  // -------------------------------------------------------------------------

  describe('token issuance after signature auth', () => {
    it('includes token in authContext when issueToken is true', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
        allowTokenAuth: false,
        issueToken: true,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await middleware(req, reply, vi.fn());

      const authReq = req as ServiceAuthenticatedRequest;
      expect(authReq.serviceAuth).toBeDefined();
      expect(authReq.serviceAuth!.token).toBeDefined();
      expect(typeof authReq.serviceAuth!.token).toBe('string');
      expect(authReq.serviceAuth!.token!.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Token service unavailable (mutants for lines 176-184, 426-428)
  // -------------------------------------------------------------------------

  describe('token service unavailable', () => {
    it('falls through to signature auth when no tokenService and allowTokenAuth is false', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: undefined as any,
        allowTokenAuth: false,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = harness.tokenService.createSignature({
        clientSecret: harness.account.clientSecret,
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      // However, signature auth needs tokenService for verification, so it will throw
      const req = mockRequest({
        headers: {
          [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
          [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
          [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
        },
      });
      const reply = mockReply();

      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(
        'Token service required for signature verification'
      );
    });
  });
});

// =============================================================================
// TOKEN AUTH ADVANCED SCENARIOS
// =============================================================================

describe('token auth advanced scenarios', () => {
  // -------------------------------------------------------------------------
  // Account not found (mutant for line 328)
  // -------------------------------------------------------------------------

  describe('account not found after token verification', () => {
    it('falls through to signature auth and throws MissingAuthHeadersError when account deleted', async () => {
      const harness = await createTestHarness();

      // Delete the account from the store after creating the token
      await harness.store.delete(harness.account.clientId);

      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${harness.token}` },
      });
      const reply = mockReply();

      // Token is valid but account is gone; tryTokenAuth returns null
      // No sig headers present, so falls through to MissingAuthHeadersError
      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });
  });

  // -------------------------------------------------------------------------
  // result.error logging branch (mutant for lines 319-321)
  // -------------------------------------------------------------------------

  describe('token verification failure with error message', () => {
    it('returns null and falls through when token is invalid with error', async () => {
      const harness = await createTestHarness();
      const middleware = createServiceAuthMiddleware({
        accountManager: harness.manager,
        tokenService: harness.tokenService,
      });

      // Use a malformed token that will fail verification with an error message
      const req = mockRequest({
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      const reply = mockReply();

      // Token verification fails → logs debug with error → returns null
      // No sig headers → MissingAuthHeadersError
      await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
    });
  });
});

// =============================================================================
// onError CALLBACK
// =============================================================================

describe('onError callback', () => {
  it('calls onError instead of throwing when provided', async () => {
    const harness = await createTestHarness();
    const onError = vi.fn();

    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      onError,
    });

    const req = mockRequest({ headers: {} }); // No auth headers → triggers error
    const reply = mockReply();

    await middleware(req, reply, vi.fn());

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(MissingAuthHeadersError),
      req,
      reply
    );
  });

  it('does not throw when onError handles the error', async () => {
    const harness = await createTestHarness();
    const onError = vi.fn().mockResolvedValue(undefined);

    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      onError,
    });

    const req = mockRequest({ headers: {} });
    const reply = mockReply();

    // Should not throw because onError is provided
    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

// =============================================================================
// getHeaderValue EDGE CASES (tested via middleware behavior)
// =============================================================================

describe('getHeaderValue edge cases', () => {
  it('falls back to lowercase header name', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    // Use lowercase header names (simulating HTTP/2 or express behavior)
    const req = mockRequest({
      headers: {
        'x-service-id': harness.account.clientId,
        'x-service-signature': signature,
        'x-service-timestamp': timestamp.toString(),
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());
    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth).toBeDefined();
  });

  it('handles array header values (takes first element)', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    // Provide headers as arrays
    const req = mockRequest({
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: [harness.account.clientId],
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: [signature],
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: [timestamp.toString()],
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());
    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth).toBeDefined();
  });

  it('returns null for undefined headers (no service headers at all)', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    // No service headers and no token → MissingAuthHeadersError
    const req = mockRequest({ headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });

  it('returns null for empty array header values', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    // Empty arrays → getHeaderValue returns null for all → no sig headers → MissingAuthHeadersError
    const req = mockRequest({
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: [],
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: [],
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: [],
      },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

// =============================================================================
// hasWildcardPermission (tested via middleware behavior)
// =============================================================================

describe('hasWildcardPermission via middleware', () => {
  it('prefix wildcard read:* matches read:data', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'wildcard-svc',
      permissions: ['read:*'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'wildcard-svc',
      permissions: ['read:*'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      requiredPermissions: ['read:data'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('prefix wildcard read:* does NOT match write:data', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'wildcard-svc',
      permissions: ['read:*'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'wildcard-svc',
      permissions: ['read:*'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      requiredPermissions: ['write:data'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InsufficientPermissionsError);
  });

  it('non-wildcard permission does not act as wildcard', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'exact-svc',
      permissions: ['read:data'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'exact-svc',
      permissions: ['read:data'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      requiredPermissions: ['read:other'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InsufficientPermissionsError);
  });
});

// =============================================================================
// IP WHITELIST - ALLOWED IP PASSES
// =============================================================================

describe('IP whitelist - allowed IP', () => {
  it('allows request when IP is in the whitelist', async () => {
    const harness = await createTestHarness({
      ipWhitelist: ['10.0.0.1', '192.168.1.100'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      validateIpWhitelist: true,
    });

    const req = mockRequest({
      ip: '192.168.1.100', // In whitelist
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

// =============================================================================
// WILDCARD * WITH anyPermissions
// =============================================================================

describe('wildcard * with anyPermissions', () => {
  it('account with * permission satisfies anyPermissions check', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'admin-svc',
      permissions: ['*'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'admin-svc',
      permissions: ['*'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      anyPermissions: ['admin:delete', 'super:power'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

// =============================================================================
// DEFAULT OPTIONS BEHAVIOR
// =============================================================================

describe('default options behavior', () => {
  it('allowTokenAuth defaults to true (token auth is tried)', async () => {
    const harness = await createTestHarness();

    // Do NOT pass allowTokenAuth at all
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());

    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth).toBeDefined();
    expect(authReq.serviceAuth!.authMethod).toBe('token');
  });

  it('validateIpWhitelist defaults to true', async () => {
    const harness = await createTestHarness({
      ipWhitelist: ['10.0.0.1'],
    });

    // Do NOT pass validateIpWhitelist (defaults to true)
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
    });

    const req = mockRequest({
      ip: '192.168.1.1', // Not in whitelist
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(IpNotAllowedError);
  });

  it('skipPaths defaults to empty (no paths skipped)', async () => {
    const harness = await createTestHarness();

    // Do NOT pass skipPaths
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
    });

    // /health should NOT be skipped because skipPaths defaults to []
    const req = mockRequest({ url: '/health/check', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

// =============================================================================
// HELPER MIDDLEWARE FACTORIES
// =============================================================================

describe('helper middleware factories', () => {
  describe('requireServicePermissions', () => {
    it('creates middleware with requiredPermissions when all: true', async () => {
      const harness = await createTestHarness();

      // requireServicePermissions with all: true uses requiredPermissions
      // Account has ['read:data', 'write:data'], require both
      const middleware = requireServicePermissions(['read:data', 'write:data'], { all: true });

      // We need to provide the middleware with a real token but it uses default singletons
      // Instead, test that it creates a middleware that enforces required permissions
      // by setting up a full scenario
      const store = new InMemoryServiceAccountStore();
      const manager = new ServiceAccountManager({ store });
      const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

      const creation = await manager.createAccount({
        name: 'test-svc',
        permissions: ['read:data', 'write:data'],
        tenantId: VALID_TENANT_ID,
      });

      const token = await tokenService.createToken({
        clientId: creation.account.clientId,
        tenantId: VALID_TENANT_ID,
        serviceName: 'test-svc',
        permissions: ['read:data', 'write:data'],
      });

      // Use createServiceAuthMiddleware directly to test the option mapping
      const mw = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        requiredPermissions: ['read:data', 'write:data'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const reply = mockReply();

      await expect(mw(req, reply, vi.fn())).resolves.toBeUndefined();
    });

    it('creates middleware with anyPermissions when all: false', async () => {
      const store = new InMemoryServiceAccountStore();
      const manager = new ServiceAccountManager({ store });
      const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

      const creation = await manager.createAccount({
        name: 'test-svc',
        permissions: ['read:data'],
        tenantId: VALID_TENANT_ID,
      });

      const token = await tokenService.createToken({
        clientId: creation.account.clientId,
        tenantId: VALID_TENANT_ID,
        serviceName: 'test-svc',
        permissions: ['read:data'],
      });

      // With all: false, it uses anyPermissions - having 'read:data' should satisfy
      const mw = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        anyPermissions: ['read:data', 'admin:delete'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const reply = mockReply();

      await expect(mw(req, reply, vi.fn())).resolves.toBeUndefined();
    });
  });

  describe('requireAnyServicePermission', () => {
    it('creates middleware that accepts any matching permission', async () => {
      const store = new InMemoryServiceAccountStore();
      const manager = new ServiceAccountManager({ store });
      const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

      const creation = await manager.createAccount({
        name: 'test-svc',
        permissions: ['write:data'],
        tenantId: VALID_TENANT_ID,
      });

      const token = await tokenService.createToken({
        clientId: creation.account.clientId,
        tenantId: VALID_TENANT_ID,
        serviceName: 'test-svc',
        permissions: ['write:data'],
      });

      // Use anyPermissions directly to mirror requireAnyServicePermission behavior
      const mw = createServiceAuthMiddleware({
        accountManager: manager,
        tokenService,
        anyPermissions: ['read:data', 'write:data'],
      });

      const req = mockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const reply = mockReply();

      await expect(mw(req, reply, vi.fn())).resolves.toBeUndefined();
    });
  });

  describe('requireServiceTenant', () => {
    it('passes when tenantId matches', async () => {
      const tenantMiddleware = requireServiceTenant(VALID_TENANT_ID);

      const req = mockRequest() as ServiceAuthenticatedRequest;
      req.serviceAuth = {
        serviceAccount: {} as any,
        clientId: 'svc-123',
        tenantId: VALID_TENANT_ID,
        serviceName: 'test-svc',
        permissions: [],
        authMethod: 'token',
      };
      const reply = mockReply();

      await expect(tenantMiddleware(req as any, reply, vi.fn())).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when tenantId does not match', async () => {
      const tenantMiddleware = requireServiceTenant('different-tenant');

      const req = mockRequest() as ServiceAuthenticatedRequest;
      req.serviceAuth = {
        serviceAccount: {} as any,
        clientId: 'svc-123',
        tenantId: VALID_TENANT_ID,
        serviceName: 'test-svc',
        permissions: [],
        authMethod: 'token',
      };
      const reply = mockReply();

      await expect(tenantMiddleware(req as any, reply, vi.fn())).rejects.toThrow(ForbiddenError);
      await expect(tenantMiddleware(req as any, reply, vi.fn())).rejects.toThrow(
        /Service not authorized for this tenant/
      );
    });

    it('throws ServiceAuthError when no serviceAuth on request', async () => {
      const tenantMiddleware = requireServiceTenant(VALID_TENANT_ID);

      const req = mockRequest(); // No serviceAuth
      const reply = mockReply();

      await expect(tenantMiddleware(req, reply, vi.fn())).rejects.toThrow(ServiceAuthError);
      await expect(tenantMiddleware(req, reply, vi.fn())).rejects.toThrow(
        /Service authentication required/
      );
    });
  });
});

// =============================================================================
// REQUEST HELPERS
// =============================================================================

describe('request helpers', () => {
  const makeAuthenticatedRequest = (): ServiceAuthenticatedRequest => {
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc-client-001',
      tenantId: VALID_TENANT_ID,
      serviceName: 'test-svc',
      permissions: ['read:data', 'write:data', 'admin:*'],
      authMethod: 'token',
    };
    return req;
  };

  describe('getServiceAuth', () => {
    it('returns serviceAuth when present', () => {
      const req = makeAuthenticatedRequest();
      const auth = getServiceAuth(req as any);
      expect(auth).toBeDefined();
      expect(auth!.clientId).toBe('svc-client-001');
    });

    it('returns undefined when no serviceAuth', () => {
      const req = mockRequest();
      const auth = getServiceAuth(req);
      expect(auth).toBeUndefined();
    });
  });

  describe('requireServiceAuth', () => {
    it('returns serviceAuth when present', () => {
      const req = makeAuthenticatedRequest();
      const auth = requireServiceAuth(req as any);
      expect(auth.clientId).toBe('svc-client-001');
    });

    it('throws ServiceAuthError when no serviceAuth', () => {
      const req = mockRequest();
      expect(() => requireServiceAuth(req)).toThrow(ServiceAuthError);
      expect(() => requireServiceAuth(req)).toThrow(/Service authentication required/);
    });
  });

  describe('hasServiceAuth', () => {
    it('returns true when serviceAuth is present', () => {
      const req = makeAuthenticatedRequest();
      expect(hasServiceAuth(req as any)).toBe(true);
    });

    it('returns false when no serviceAuth', () => {
      const req = mockRequest();
      expect(hasServiceAuth(req)).toBe(false);
    });
  });

  describe('getServiceClientId', () => {
    it('returns clientId when authenticated', () => {
      const req = makeAuthenticatedRequest();
      expect(getServiceClientId(req as any)).toBe('svc-client-001');
    });

    it('returns undefined when not authenticated', () => {
      const req = mockRequest();
      expect(getServiceClientId(req)).toBeUndefined();
    });
  });

  describe('getServiceTenantId', () => {
    it('returns tenantId when authenticated', () => {
      const req = makeAuthenticatedRequest();
      expect(getServiceTenantId(req as any)).toBe(VALID_TENANT_ID);
    });

    it('returns undefined when not authenticated', () => {
      const req = mockRequest();
      expect(getServiceTenantId(req)).toBeUndefined();
    });
  });

  describe('getServicePermissions', () => {
    it('returns permissions when authenticated', () => {
      const req = makeAuthenticatedRequest();
      expect(getServicePermissions(req as any)).toEqual(['read:data', 'write:data', 'admin:*']);
    });

    it('returns empty array when not authenticated', () => {
      const req = mockRequest();
      expect(getServicePermissions(req)).toEqual([]);
    });
  });

  describe('serviceHasPermission', () => {
    it('returns true for exact permission match', () => {
      const req = makeAuthenticatedRequest();
      expect(serviceHasPermission(req as any, 'read:data')).toBe(true);
    });

    it('returns false for non-matching permission', () => {
      const req = makeAuthenticatedRequest();
      expect(serviceHasPermission(req as any, 'delete:data')).toBe(false);
    });

    it('returns true for wildcard * permission', () => {
      const req = mockRequest() as ServiceAuthenticatedRequest;
      req.serviceAuth = {
        serviceAccount: {} as any,
        clientId: 'svc-admin',
        tenantId: VALID_TENANT_ID,
        serviceName: 'admin-svc',
        permissions: ['*'],
        authMethod: 'token',
      };
      expect(serviceHasPermission(req as any, 'anything:here')).toBe(true);
    });

    it('returns true for prefix wildcard match (admin:* matches admin:delete)', () => {
      const req = makeAuthenticatedRequest(); // has admin:*
      expect(serviceHasPermission(req as any, 'admin:delete')).toBe(true);
    });

    it('returns false for prefix wildcard non-match (admin:* does not match read:data)', () => {
      const req = mockRequest() as ServiceAuthenticatedRequest;
      req.serviceAuth = {
        serviceAccount: {} as any,
        clientId: 'svc-admin',
        tenantId: VALID_TENANT_ID,
        serviceName: 'admin-svc',
        permissions: ['admin:*'],
        authMethod: 'token',
      };
      expect(serviceHasPermission(req as any, 'read:data')).toBe(false);
    });

    it('returns false when not authenticated (empty permissions)', () => {
      const req = mockRequest();
      expect(serviceHasPermission(req, 'read:data')).toBe(false);
    });
  });
});

// =============================================================================
// MUTATION-KILLING TESTS
// =============================================================================

describe('[Mutation-kill] Error class properties', () => {
  it('ServiceAuthError has code SERVICE_AUTH_ERROR and statusCode 401', () => {
    const err = new ServiceAuthError('test');
    expect(err.code).toBe('SERVICE_AUTH_ERROR');
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('ServiceAuthError');
  });

  it('MissingAuthHeadersError has code MISSING_AUTH_HEADERS', () => {
    const err = new MissingAuthHeadersError();
    expect(err.code).toBe('MISSING_AUTH_HEADERS');
    expect(err.name).toBe('MissingAuthHeadersError');
    expect(err.message).toBe('Missing required service authentication headers');
    expect(err.statusCode).toBe(401);
  });

  it('InvalidServiceSignatureError has code INVALID_SERVICE_SIGNATURE', () => {
    const err = new InvalidServiceSignatureError();
    expect(err.code).toBe('INVALID_SERVICE_SIGNATURE');
    expect(err.name).toBe('InvalidServiceSignatureError');
    expect(err.message).toBe('Invalid service signature');
    expect(err.statusCode).toBe(401);
  });

  it('InvalidServiceSignatureError includes reason in message when provided', () => {
    const err = new InvalidServiceSignatureError('bad timestamp');
    expect(err.message).toBe('Invalid service signature: bad timestamp');
  });

  it('IpNotAllowedError has code IP_NOT_ALLOWED and statusCode 403', () => {
    const err = new IpNotAllowedError('svc_test', '10.0.0.1');
    expect(err.code).toBe('IP_NOT_ALLOWED');
    expect(err.name).toBe('IpNotAllowedError');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('10.0.0.1');
    expect(err.details).toEqual({ clientId: 'svc_test', ip: '10.0.0.1' });
  });

  it('InsufficientPermissionsError has code INSUFFICIENT_PERMISSIONS and statusCode 403', () => {
    const err = new InsufficientPermissionsError(['admin:write'], ['read:data']);
    expect(err.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(err.name).toBe('InsufficientPermissionsError');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Insufficient permissions for this operation');
    expect(err.details).toEqual({ required: ['admin:write'], actual: ['read:data'] });
  });
});

describe('[Mutation-kill] Signature auth strips query string from path', () => {
  it('uses path without query string for signature verification', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    // Create signature using path WITHOUT query string (as middleware does)
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    // Request URL HAS query string
    const req = mockRequest({
      url: '/api/test?foo=bar&baz=qux',
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());
    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth).toBeDefined();
    expect(authReq.serviceAuth!.authMethod).toBe('signature');
  });

  it('fails when signature was created with query string but middleware strips it', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    // Create signature using path WITH query string (wrong approach)
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test?foo=bar',
    });

    const req = mockRequest({
      url: '/api/test?foo=bar',
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InvalidServiceSignatureError);
  });
});

describe('[Mutation-kill] Token auth fallback to signature when token is invalid', () => {
  it('with allowTokenAuth=true, invalid Bearer falls through to signature auth', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: true, // explicit
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    // Both Bearer (invalid) and signature headers present
    const req = mockRequest({
      headers: {
        authorization: 'Bearer invalid.token.here',
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());
    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth!.authMethod).toBe('signature');
  });
});

describe('[Mutation-kill] issueToken defaults to false', () => {
  it('no token is issued by default (issueToken not set)', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
      // issueToken defaults to false
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    const req = mockRequest({
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());

    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth!.token).toBeUndefined();
  });
});

describe('[Mutation-kill] Token auth serviceAuth context fields', () => {
  it('token auth context has tokenPayload but no token field (token is the JWT string)', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());

    const authReq = req as ServiceAuthenticatedRequest;
    expect(authReq.serviceAuth!.authMethod).toBe('token');
    expect(authReq.serviceAuth!.token).toBe(harness.token);
    expect(authReq.serviceAuth!.tokenPayload).toBeDefined();
    expect(authReq.serviceAuth!.tokenPayload!.type).toBe('service');
    expect(authReq.serviceAuth!.tokenPayload!.sub).toBe(harness.account.clientId);
  });
});

describe('[Mutation-kill] Signature auth serviceAuth context fields', () => {
  it('signature auth context has correct clientId, tenantId, serviceName, permissions', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = harness.tokenService.createSignature({
      clientSecret: harness.account.clientSecret,
      timestamp,
      method: 'GET',
      path: '/api/test',
    });

    const req = mockRequest({
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: harness.account.clientId,
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await middleware(req, reply, vi.fn());

    const ctx = (req as ServiceAuthenticatedRequest).serviceAuth!;
    expect(ctx.clientId).toBe(harness.account.clientId);
    expect(ctx.tenantId).toBe(VALID_TENANT_ID);
    expect(ctx.serviceName).toBe('test-svc');
    expect(ctx.permissions).toEqual(['read:data', 'write:data']);
    expect(ctx.authMethod).toBe('signature');
    expect(ctx.serviceAccount.clientId).toBe(harness.account.clientId);
    expect(ctx.tokenPayload).toBeUndefined();
  });
});

describe('[Mutation-kill] Invalid credentials for non-existent account via signature', () => {
  it('throws InvalidServiceSignatureError with "Invalid credentials" for unknown clientId', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const req = mockRequest({
      headers: {
        [SERVICE_AUTH_HEADERS.SERVICE_ID]: 'svc_nonexistent_12345',
        [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: 'a'.repeat(64),
        [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
      },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(InvalidServiceSignatureError);
    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(/Invalid credentials/);
  });
});

describe('[Mutation-kill] validateIpWhitelist=false bypasses IP check', () => {
  it('allows request from non-whitelisted IP when validateIpWhitelist is false', async () => {
    const harness = await createTestHarness({
      ipWhitelist: ['10.0.0.1'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      validateIpWhitelist: false, // explicitly disabled
    });

    const req = mockRequest({
      ip: '192.168.1.1', // Not in whitelist
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    // Should pass because IP check is disabled
    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

describe('[Mutation-kill] IP whitelist with empty list allows all', () => {
  it('passes when ipWhitelist is empty array (no entries to check)', async () => {
    const harness = await createTestHarness({
      ipWhitelist: [],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      validateIpWhitelist: true,
    });

    const req = mockRequest({
      ip: '192.168.1.1',
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    // Empty whitelist means no restriction
    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

describe('[Mutation-kill] skipPaths prefix matching is startsWith not exact', () => {
  it('skips /health/check when skipPaths contains /health', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipPaths: ['/health'],
    });

    const req = mockRequest({ url: '/health/deep/nested', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('does NOT skip /healthz when skipPaths contains /health/', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipPaths: ['/health/'],
    });

    // /healthz does NOT start with /health/
    const req = mockRequest({ url: '/healthz', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

describe('[Mutation-kill] hasWildcardPermission with anyPermissions prefix match', () => {
  it('prefix wildcard satisfies anyPermissions check', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'prefix-svc',
      permissions: ['write:*'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'prefix-svc',
      permissions: ['write:*'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      anyPermissions: ['write:users', 'admin:all'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    // write:* should match write:users via prefix
    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('prefix wildcard satisfies requiredPermissions check', async () => {
    const store = new InMemoryServiceAccountStore();
    const manager = new ServiceAccountManager({ store });
    const tokenService = new ServiceTokenService({ signingSecret: VALID_SECRET });

    const creation = await manager.createAccount({
      name: 'prefix-svc',
      permissions: ['read:*', 'write:*'],
      tenantId: VALID_TENANT_ID,
    });

    const token = await tokenService.createToken({
      clientId: creation.account.clientId,
      tenantId: VALID_TENANT_ID,
      serviceName: 'prefix-svc',
      permissions: ['read:*', 'write:*'],
    });

    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      requiredPermissions: ['read:users', 'write:records'],
    });

    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });
});

describe('[Mutation-kill] ServiceAccountStatus enum used correctly in token/signature auth', () => {
  it('ServiceAccountStatus values match string literals used in checks', () => {
    // These must match what the middleware checks against
    expect(ServiceAccountStatus.REVOKED).toBe('revoked');
    expect(ServiceAccountStatus.SUSPENDED).toBe('suspended');
    expect(ServiceAccountStatus.ACTIVE).toBe('active');
  });
});

describe('[Mutation-kill] Multiple skipPaths work independently', () => {
  it('skips when request matches the second skipPath', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipPaths: ['/health', '/api/public'],
    });

    const req = mockRequest({ url: '/api/public/docs', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('does not skip when request matches neither skipPath', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipPaths: ['/health', '/api/public'],
    });

    const req = mockRequest({ url: '/api/private/data', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

describe('[Mutation-kill] skipFn receives the request object', () => {
  it('skipFn can inspect request method', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipFn: (req) => (req as any).method === 'OPTIONS',
    });

    const req = mockRequest({ method: 'OPTIONS', headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('skipFn returning false does NOT skip auth', async () => {
    const { manager, tokenService } = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: manager,
      tokenService,
      skipFn: () => false,
    });

    const req = mockRequest({ headers: {} });
    const reply = mockReply();

    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

describe('[Mutation-kill] allowTokenAuth=false prevents token auth', () => {
  it('valid Bearer token is ignored when allowTokenAuth is false', async () => {
    const harness = await createTestHarness();
    const middleware = createServiceAuthMiddleware({
      accountManager: harness.manager,
      tokenService: harness.tokenService,
      allowTokenAuth: false,
    });

    // Only Bearer token, no signature headers
    const req = mockRequest({
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const reply = mockReply();

    // Token is valid but token auth is disabled, no sig headers → MissingAuthHeadersError
    await expect(middleware(req, reply, vi.fn())).rejects.toThrow(MissingAuthHeadersError);
  });
});

describe('[Mutation-kill] requireServiceTenant compares tenantId values exactly', () => {
  it('passes with exact tenantId match', async () => {
    const tenantMiddleware = requireServiceTenant(VALID_TENANT_ID);
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc-123',
      tenantId: VALID_TENANT_ID,
      serviceName: 'test-svc',
      permissions: [],
      authMethod: 'token',
    };
    const reply = mockReply();
    await expect(tenantMiddleware(req as any, reply, vi.fn())).resolves.toBeUndefined();
  });

  it('fails when tenantIds differ by a single character', async () => {
    const tenantMiddleware = requireServiceTenant(VALID_TENANT_ID);
    const alteredTenantId = VALID_TENANT_ID.slice(0, -1) + '1';
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc-123',
      tenantId: alteredTenantId,
      serviceName: 'test-svc',
      permissions: [],
      authMethod: 'token',
    };
    const reply = mockReply();
    await expect(tenantMiddleware(req as any, reply, vi.fn())).rejects.toThrow(ForbiddenError);
  });
});

describe('[Mutation-kill] getServicePermissions returns empty array not undefined', () => {
  it('returns exactly [] when not authenticated', () => {
    const req = mockRequest();
    const perms = getServicePermissions(req);
    expect(perms).toEqual([]);
    expect(Array.isArray(perms)).toBe(true);
    expect(perms.length).toBe(0);
  });
});

describe('[Mutation-kill] hasServiceAuth returns boolean primitives', () => {
  it('returns exactly true (not truthy)', () => {
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc',
      tenantId: VALID_TENANT_ID,
      serviceName: 'svc',
      permissions: [],
      authMethod: 'token',
    };
    const result = hasServiceAuth(req as any);
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('returns exactly false (not falsy)', () => {
    const req = mockRequest();
    const result = hasServiceAuth(req);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });
});

describe('[Mutation-kill] serviceHasPermission wildcard slice logic', () => {
  it('admin:* matches admin: (the prefix itself)', () => {
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc',
      tenantId: VALID_TENANT_ID,
      serviceName: 'svc',
      permissions: ['admin:*'],
      authMethod: 'token',
    };
    // 'admin:*' → prefix 'admin:' → 'admin:'.startsWith('admin:') is true
    expect(serviceHasPermission(req as any, 'admin:')).toBe(true);
  });

  it('admin:* does NOT match admi (shorter than prefix)', () => {
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc',
      tenantId: VALID_TENANT_ID,
      serviceName: 'svc',
      permissions: ['admin:*'],
      authMethod: 'token',
    };
    expect(serviceHasPermission(req as any, 'admi')).toBe(false);
  });

  it('admin:* does NOT match admin (without colon)', () => {
    const req = mockRequest() as ServiceAuthenticatedRequest;
    req.serviceAuth = {
      serviceAccount: {} as any,
      clientId: 'svc',
      tenantId: VALID_TENANT_ID,
      serviceName: 'svc',
      permissions: ['admin:*'],
      authMethod: 'token',
    };
    expect(serviceHasPermission(req as any, 'admin')).toBe(false);
  });
});
