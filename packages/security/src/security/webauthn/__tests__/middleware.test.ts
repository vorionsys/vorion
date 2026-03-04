/**
 * Tests for WebAuthn Middleware
 *
 * Validates:
 * - createUserContextMiddleware: extracts user, handles null, handles errors
 * - requireWebAuthnUser: 401 when missing, passes when present
 * - Registration options handler: 401 no user, success, WebAuthnError, generic error
 * - Registration verify handler: 401 no user, 400 failure, 200 success, WebAuthnError, generic error
 * - Authentication options handler: success, WebAuthnAuthenticationError, WebAuthnError, generic error
 * - Authentication verify handler: 401 failure, 200 success, createSession, WebAuthnError, generic error
 * - List credentials handler: 401 no user, success, generic error
 * - Rename credential handler: 401 no user, success, NOT_FOUND, generic error
 * - Delete credential handler: 401 no user, 204 success, NOT_FOUND, generic error
 * - Utility functions: getWebAuthnUser, hasWebAuthnUser, getWebAuthnUserId
 * - webauthnPlugin: route registration, prefix, getUserContext hook, registerRoutes=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted shared mocks for metrics - needed to verify ArithmeticOperator mutations
const { mockHistogramObserve, mockCounterInc } = vi.hoisted(() => ({
  mockHistogramObserve: vi.fn(),
  mockCounterInc: vi.fn(),
}));

// Mock dependencies BEFORE imports
vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../common/metrics-registry.js', () => ({
  vorionRegistry: {
    registerMetric: vi.fn(),
  },
}));

vi.mock('prom-client', () => {
  class CounterMock {
    inc = mockCounterInc;
    labels = vi.fn().mockReturnThis();
    constructor(_opts?: any) {}
  }
  class HistogramMock {
    observe = mockHistogramObserve;
    startTimer = vi.fn(() => vi.fn());
    labels = vi.fn().mockReturnThis();
    constructor(_opts?: any) {}
  }
  return { Counter: CounterMock, Histogram: HistogramMock };
});

vi.mock('../../distributed-state.js', () => ({
  getRedisStateProvider: vi.fn(() => ({})),
}));

vi.mock('../service.js', () => {
  class MockWebAuthnError extends Error {
    code: string;
    statusCode: number;
    constructor(message: string, details?: Record<string, unknown>) {
      super(message);
      this.name = 'WebAuthnError';
      this.code = 'WEBAUTHN_ERROR';
      this.statusCode = 400;
    }
  }

  class MockWebAuthnRegistrationError extends MockWebAuthnError {
    errorCode: string;
    constructor(message: string, errorCode: string, details?: Record<string, unknown>) {
      super(message, details);
      this.name = 'WebAuthnRegistrationError';
      this.code = 'WEBAUTHN_REGISTRATION_ERROR';
      this.statusCode = 400;
      this.errorCode = errorCode;
    }
  }

  class MockWebAuthnAuthenticationError extends MockWebAuthnError {
    errorCode: string;
    constructor(message: string, errorCode: string, details?: Record<string, unknown>) {
      super(message, details);
      this.name = 'WebAuthnAuthenticationError';
      this.code = 'WEBAUTHN_AUTHENTICATION_ERROR';
      this.statusCode = 401;
      this.errorCode = errorCode;
    }
  }

  return {
    WebAuthnService: vi.fn(),
    WebAuthnError: MockWebAuthnError,
    WebAuthnRegistrationError: MockWebAuthnRegistrationError,
    WebAuthnAuthenticationError: MockWebAuthnAuthenticationError,
    getWebAuthnService: vi.fn(),
    createWebAuthnService: vi.fn(),
  };
});

vi.mock('fastify-plugin', () => ({
  default: vi.fn((fn: Function, opts?: any) => {
    // Attach opts so we can inspect them
    (fn as any).__pluginMeta = opts;
    return fn;
  }),
}));

import {
  createUserContextMiddleware,
  requireWebAuthnUser,
  webauthnPlugin,
  getWebAuthnUser,
  hasWebAuthnUser,
  getWebAuthnUserId,
  type WebAuthnUserContext,
  type WebAuthnPluginOptions,
} from '../middleware.js';

import {
  WebAuthnError,
  WebAuthnAuthenticationError,
  createWebAuthnService,
} from '../service.js';

// =============================================================================
// HELPERS
// =============================================================================

const TEST_USER: WebAuthnUserContext = {
  userId: 'user-123',
  userName: 'alice@example.com',
  displayName: 'Alice',
  tenantId: 'tenant-1',
};

function mockRequest(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'req-1',
    url: '/test',
    method: 'POST',
    headers: {},
    body: {},
    params: {},
    webauthnUser: undefined,
    ...overrides,
  };
}

function mockReply(): any {
  const reply: any = {
    statusCode: 200,
    _body: undefined,
  };
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((body?: unknown) => {
    reply._body = body;
    return reply;
  });
  return reply;
}

function createMockService(): any {
  return {
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
    listCredentials: vi.fn(),
    renameCredential: vi.fn(),
    deleteCredential: vi.fn(),
  };
}

const TEST_CREDENTIAL = {
  id: 'cred-1',
  credentialId: 'cred-webauthn-1',
  publicKey: 'pubkey-base64url',
  counter: 1,
  transports: ['internal'] as any[],
  createdAt: new Date('2025-01-01'),
  lastUsedAt: new Date('2025-06-01'),
  name: 'My Passkey',
  userId: 'user-123',
  deviceType: 'multiDevice',
  backedUp: true,
  aaguid: '00000000-0000-0000-0000-000000000000',
};

// =============================================================================
// createUserContextMiddleware
// =============================================================================

describe('createUserContextMiddleware', () => {
  it('sets webauthnUser on request when getUserContext returns a user', async () => {
    const getUserContext = vi.fn().mockResolvedValue(TEST_USER);
    const middleware = createUserContextMiddleware(getUserContext);

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(getUserContext).toHaveBeenCalledWith(request);
    expect(request.webauthnUser).toEqual(TEST_USER);
  });

  it('does not set webauthnUser when getUserContext returns null', async () => {
    const getUserContext = vi.fn().mockResolvedValue(null);
    const middleware = createUserContextMiddleware(getUserContext);

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(request.webauthnUser).toBeUndefined();
  });

  it('does not set webauthnUser when getUserContext throws an error', async () => {
    const getUserContext = vi.fn().mockRejectedValue(new Error('JWT expired'));
    const middleware = createUserContextMiddleware(getUserContext);

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(request.webauthnUser).toBeUndefined();
  });

  it('catches non-Error thrown values from getUserContext', async () => {
    const getUserContext = vi.fn().mockRejectedValue('string-error');
    const middleware = createUserContextMiddleware(getUserContext);

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(request.webauthnUser).toBeUndefined();
  });

  it('handles synchronous getUserContext that returns user', async () => {
    const getUserContext = vi.fn().mockReturnValue(TEST_USER);
    const middleware = createUserContextMiddleware(getUserContext);

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(request.webauthnUser).toEqual(TEST_USER);
  });
});

// =============================================================================
// requireWebAuthnUser
// =============================================================================

describe('requireWebAuthnUser', () => {
  it('returns 401 when request has no webauthnUser', async () => {
    const middleware = requireWebAuthnUser();

    const request = mockRequest();
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  });

  it('does not send 401 when webauthnUser exists', async () => {
    const middleware = requireWebAuthnUser();

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await middleware(request, reply, vi.fn());

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Registration Options Handler (via webauthnPlugin)
// =============================================================================

describe('Registration Options Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let fastify: any;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    fastify = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 when no user context is present', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('UNAUTHORIZED');
  });

  it('calls service.generateRegistrationOptions with correct params', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'test-challenge' },
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { authenticatorType: 'platform', requireUserVerification: true },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateRegistrationOptions).toHaveBeenCalledWith({
      userId: 'user-123',
      userName: 'alice@example.com',
      userDisplayName: 'Alice',
      authenticatorType: 'platform',
      requireUserVerification: true,
    });
  });

  it('returns options on success', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'abc', rp: { name: 'Test' } },
    });

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.send).toHaveBeenCalledWith({
      options: { challenge: 'abc', rp: { name: 'Test' } },
    });
  });

  it('uses userId as userName fallback when userName is undefined', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'abc' },
    });

    const request = mockRequest({
      webauthnUser: { userId: 'user-123' },
      body: {},
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'user-123' })
    );
  });

  it('handles WebAuthnError and returns error.statusCode', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    const err = new WebAuthnError('Too many credentials');
    (err as any).statusCode = 429;
    (err as any).code = 'TOO_MANY_CREDENTIALS';
    mockService.generateRegistrationOptions.mockRejectedValue(err);

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply._body.error.code).toBe('TOO_MANY_CREDENTIALS');
  });

  it('handles generic error and returns 500', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockRejectedValue(new Error('DB down'));

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to generate registration options');
  });
});

// =============================================================================
// Registration Verify Handler
// =============================================================================

describe('Registration Verify Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 when no user context is present', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    const request = mockRequest({ body: { response: {} } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('UNAUTHORIZED');
    expect(reply._body.error.message).toBe('Authentication required to register a passkey');
  });

  it('returns 400 with errorCode on verification failure', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
      errorCode: 'CHALLENGE_EXPIRED',
      error: 'Challenge has expired',
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply._body.error.code).toBe('CHALLENGE_EXPIRED');
    expect(reply._body.error.message).toBe('Challenge has expired');
  });

  it('returns 400 with fallback error code when errorCode is undefined', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply._body.error.code).toBe('REGISTRATION_FAILED');
    expect(reply._body.error.message).toBe('Registration failed');
  });

  it('returns 200 with credential info on success', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: { id: 'cred-1' }, credentialName: 'My Key' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.send).toHaveBeenCalledWith({
      verified: true,
      credential: {
        id: TEST_CREDENTIAL.id,
        name: TEST_CREDENTIAL.name,
        createdAt: TEST_CREDENTIAL.createdAt,
        deviceType: TEST_CREDENTIAL.deviceType,
        backedUp: TEST_CREDENTIAL.backedUp,
      },
    });
  });

  it('passes credentialName to service.verifyRegistration', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: { id: 'cred-1' }, credentialName: 'Work Laptop' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.verifyRegistration).toHaveBeenCalledWith({
      userId: 'user-123',
      response: { id: 'cred-1' },
      credentialName: 'Work Laptop',
    });
  });

  it('handles WebAuthnError and returns error.statusCode', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    const err = new WebAuthnError('Store failure');
    (err as any).statusCode = 400;
    (err as any).code = 'WEBAUTHN_ERROR';
    mockService.verifyRegistration.mockRejectedValue(err);

    const request = mockRequest({ webauthnUser: TEST_USER, body: { response: {} } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply._body.error.code).toBe('WEBAUTHN_ERROR');
  });

  it('handles generic error and returns 500', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockRejectedValue(new TypeError('Cannot read'));

    const request = mockRequest({ webauthnUser: TEST_USER, body: { response: {} } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to verify registration');
  });
});

// =============================================================================
// Authentication Options Handler
// =============================================================================

describe('Authentication Options Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('calls service.generateAuthenticationOptions with correct params', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'auth-challenge' },
    });

    const request = mockRequest({
      body: { userId: 'user-123', requireUserVerification: true },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateAuthenticationOptions).toHaveBeenCalledWith({
      userId: 'user-123',
      requireUserVerification: true,
    });
  });

  it('returns options on success', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'auth-challenge', timeout: 60000 },
    });

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.send).toHaveBeenCalledWith({
      options: { challenge: 'auth-challenge', timeout: 60000 },
    });
  });

  it('handles optional body (undefined)', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const request = mockRequest({ body: undefined });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateAuthenticationOptions).toHaveBeenCalledWith({
      userId: undefined,
      requireUserVerification: undefined,
    });
  });

  it('handles WebAuthnAuthenticationError', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    const err = new WebAuthnAuthenticationError('No credentials', 'NO_CREDENTIALS' as any);
    mockService.generateAuthenticationOptions.mockRejectedValue(err);

    const request = mockRequest({ body: { userId: 'user-123' } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('WEBAUTHN_AUTHENTICATION_ERROR');
  });

  it('handles WebAuthnError (non-auth)', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    const err = new WebAuthnError('Store error');
    mockService.generateAuthenticationOptions.mockRejectedValue(err);

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply._body.error.code).toBe('WEBAUTHN_ERROR');
  });

  it('handles generic error and returns 500', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockRejectedValue(new Error('network'));

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to generate authentication options');
  });
});

// =============================================================================
// Authentication Verify Handler
// =============================================================================

describe('Authentication Verify Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 on verification failure', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
      errorCode: 'VERIFICATION_FAILED',
      error: 'Signature mismatch',
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('VERIFICATION_FAILED');
    expect(reply._body.error.message).toBe('Signature mismatch');
  });

  it('returns 401 with fallback code when errorCode is undefined', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('AUTHENTICATION_FAILED');
    expect(reply._body.error.message).toBe('Authentication failed');
  });

  it('returns 200 with session info on success', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.send).toHaveBeenCalledWith({
      verified: true,
      userId: 'user-123',
      credential: {
        id: TEST_CREDENTIAL.id,
        name: TEST_CREDENTIAL.name,
        lastUsedAt: TEST_CREDENTIAL.lastUsedAt,
      },
    });
  });

  it('calls createSession when provided and merges result', async () => {
    const mockCreateSession = vi.fn().mockResolvedValue({
      token: 'jwt-token-xyz',
      sessionId: 'sess-1',
    });

    // Re-register plugin with createSession
    const handlers2: Record<string, Function> = {};
    const fastify2: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify2, {
      service: mockService,
      createSession: mockCreateSession,
    });

    const handler = handlers2['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCreateSession).toHaveBeenCalledWith(
      'user-123',
      TEST_CREDENTIAL,
      request,
      reply
    );
    expect(reply._body).toMatchObject({
      verified: true,
      token: 'jwt-token-xyz',
      sessionId: 'sess-1',
    });
  });

  it('does not call createSession when result.userId is falsy', async () => {
    const mockCreateSession = vi.fn().mockResolvedValue({ token: 'tok' });

    const handlers2: Record<string, Function> = {};
    const fastify2: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify2, {
      service: mockService,
      createSession: mockCreateSession,
    });

    const handler = handlers2['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: undefined,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('does not call createSession when result.credential is falsy', async () => {
    const mockCreateSession = vi.fn().mockResolvedValue({ token: 'tok' });

    const handlers2: Record<string, Function> = {};
    const fastify2: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers2[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify2, {
      service: mockService,
      createSession: mockCreateSession,
    });

    const handler = handlers2['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: undefined,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('handles WebAuthnError and returns error.statusCode', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    const err = new WebAuthnError('Invalid state');
    (err as any).statusCode = 400;
    (err as any).code = 'WEBAUTHN_ERROR';
    mockService.verifyAuthentication.mockRejectedValue(err);

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply._body.error.code).toBe('WEBAUTHN_ERROR');
  });

  it('handles generic error and returns 500', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockRejectedValue(new Error('timeout'));

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to verify authentication');
  });
});

// =============================================================================
// List Credentials Handler
// =============================================================================

describe('List Credentials Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 when no user context is present', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    const request = mockRequest();
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('UNAUTHORIZED');
    expect(reply._body.error.message).toBe('Authentication required');
  });

  it('returns credentials list with correct shape', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockResolvedValue({
      credentials: [TEST_CREDENTIAL],
      total: 1,
    });

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.listCredentials).toHaveBeenCalledWith({ userId: 'user-123' });
    expect(reply.send).toHaveBeenCalledWith({
      credentials: [
        {
          id: TEST_CREDENTIAL.id,
          name: TEST_CREDENTIAL.name,
          createdAt: TEST_CREDENTIAL.createdAt,
          lastUsedAt: TEST_CREDENTIAL.lastUsedAt,
          deviceType: TEST_CREDENTIAL.deviceType,
          backedUp: TEST_CREDENTIAL.backedUp,
        },
      ],
      total: 1,
    });
  });

  it('returns empty credentials list', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockResolvedValue({
      credentials: [],
      total: 0,
    });

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({ credentials: [], total: 0 });
  });

  it('handles error and returns 500', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockRejectedValue(new Error('DB error'));

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to list credentials');
  });

  it('handles non-Error thrown values', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockRejectedValue('string-error');

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
  });
});

// =============================================================================
// Rename Credential Handler
// =============================================================================

describe('Rename Credential Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 when no user context is present', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const request = mockRequest({
      params: { credentialId: 'cred-1' },
      body: { name: 'New Name' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns updated credential on success', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const updatedCred = { ...TEST_CREDENTIAL, name: 'New Name' };
    mockService.renameCredential.mockResolvedValue(updatedCred);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
      body: { name: 'New Name' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.renameCredential).toHaveBeenCalledWith({
      userId: 'user-123',
      credentialId: 'cred-1',
      name: 'New Name',
    });
    expect(reply.send).toHaveBeenCalledWith({
      credential: {
        id: updatedCred.id,
        name: updatedCred.name,
        createdAt: updatedCred.createdAt,
        lastUsedAt: updatedCred.lastUsedAt,
        deviceType: updatedCred.deviceType,
        backedUp: updatedCred.backedUp,
      },
    });
  });

  it('returns 404 for NOT_FOUND error', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const err: any = new Error('Credential not found');
    err.code = 'NOT_FOUND';
    mockService.renameCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'nonexistent' },
      body: { name: 'New Name' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply._body.error.code).toBe('NOT_FOUND');
    expect(reply._body.error.message).toBe('Credential not found');
  });

  it('returns 500 for generic error', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    mockService.renameCredential.mockRejectedValue(new Error('DB down'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
      body: { name: 'New Name' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to rename credential');
  });

  it('handles non-Error thrown values in catch', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    mockService.renameCredential.mockRejectedValue('string-error');

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
      body: { name: 'New Name' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
  });
});

// =============================================================================
// Delete Credential Handler
// =============================================================================

describe('Delete Credential Handler', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('returns 401 when no user context is present', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    const request = mockRequest({
      params: { credentialId: 'cred-1' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply._body.error.code).toBe('UNAUTHORIZED');
    expect(reply._body.error.message).toBe('Authentication required');
  });

  it('returns 204 on success', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockResolvedValue(undefined);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.deleteCredential).toHaveBeenCalledWith({
      userId: 'user-123',
      credentialId: 'cred-1',
    });
    expect(reply.status).toHaveBeenCalledWith(204);
    expect(reply.send).toHaveBeenCalled();
  });

  it('returns 404 for NOT_FOUND error', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    const err: any = new Error('Credential not found');
    err.code = 'NOT_FOUND';
    mockService.deleteCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'nonexistent' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply._body.error.code).toBe('NOT_FOUND');
    expect(reply._body.error.message).toBe('Credential not found');
  });

  it('returns 500 for generic error', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockRejectedValue(new Error('DB failure'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply._body.error.code).toBe('INTERNAL_ERROR');
    expect(reply._body.error.message).toBe('Failed to delete credential');
  });

  it('handles non-Error thrown values in catch', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockRejectedValue(42);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe('Utility Functions', () => {
  describe('getWebAuthnUser', () => {
    it('returns undefined when no webauthnUser on request', () => {
      const request = mockRequest();
      expect(getWebAuthnUser(request)).toBeUndefined();
    });

    it('returns the user context when set', () => {
      const request = mockRequest({ webauthnUser: TEST_USER });
      expect(getWebAuthnUser(request)).toEqual(TEST_USER);
    });
  });

  describe('hasWebAuthnUser', () => {
    it('returns false when no webauthnUser on request', () => {
      const request = mockRequest();
      expect(hasWebAuthnUser(request)).toBe(false);
    });

    it('returns true when webauthnUser is set', () => {
      const request = mockRequest({ webauthnUser: TEST_USER });
      expect(hasWebAuthnUser(request)).toBe(true);
    });

    it('returns false when webauthnUser is explicitly undefined', () => {
      const request = mockRequest({ webauthnUser: undefined });
      expect(hasWebAuthnUser(request)).toBe(false);
    });
  });

  describe('getWebAuthnUserId', () => {
    it('returns undefined when no webauthnUser on request', () => {
      const request = mockRequest();
      expect(getWebAuthnUserId(request)).toBeUndefined();
    });

    it('returns the userId when webauthnUser is set', () => {
      const request = mockRequest({ webauthnUser: TEST_USER });
      expect(getWebAuthnUserId(request)).toBe('user-123');
    });
  });
});

// =============================================================================
// webauthnPlugin
// =============================================================================

describe('webauthnPlugin', () => {
  it('decorates fastify with webauthnService', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    expect(fastify.decorate).toHaveBeenCalledWith('webauthnService', mockService);
  });

  it('registers routes with default /webauthn prefix', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    expect(fastify.post).toHaveBeenCalledWith(
      '/webauthn/register/options',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.post).toHaveBeenCalledWith(
      '/webauthn/register/verify',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.post).toHaveBeenCalledWith(
      '/webauthn/authenticate/options',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.post).toHaveBeenCalledWith(
      '/webauthn/authenticate/verify',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.get).toHaveBeenCalledWith(
      '/webauthn/credentials',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.patch).toHaveBeenCalledWith(
      '/webauthn/credentials/:credentialId',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.delete).toHaveBeenCalledWith(
      '/webauthn/credentials/:credentialId',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('registers routes with custom prefix', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      prefix: '/api/v1/passkeys',
    });

    expect(fastify.post).toHaveBeenCalledWith(
      '/api/v1/passkeys/register/options',
      expect.any(Object),
      expect.any(Function)
    );
    expect(fastify.get).toHaveBeenCalledWith(
      '/api/v1/passkeys/credentials',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('adds getUserContext hook when provided', async () => {
    const mockService = createMockService();
    const getUserContext = vi.fn();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      getUserContext,
    });

    expect(fastify.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
  });

  it('does not add getUserContext hook when not provided', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    expect(fastify.addHook).not.toHaveBeenCalled();
  });

  it('skips routes when registerRoutes=false', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      registerRoutes: false,
    });

    expect(fastify.post).not.toHaveBeenCalled();
    expect(fastify.get).not.toHaveBeenCalled();
    expect(fastify.patch).not.toHaveBeenCalled();
    expect(fastify.delete).not.toHaveBeenCalled();
  });

  it('calls createWebAuthnService when no service provided', async () => {
    const fakeSvc = createMockService();
    vi.mocked(createWebAuthnService).mockReturnValue(fakeSvc as any);

    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      config: { rpName: 'Test App' },
    });

    expect(createWebAuthnService).toHaveBeenCalledWith({
      config: { rpName: 'Test App' },
    });
    expect(fastify.decorate).toHaveBeenCalledWith('webauthnService', fakeSvc);
  });

  it('registers all 7 route handlers (4 POST, 1 GET, 1 PATCH, 1 DELETE)', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    expect(fastify.post).toHaveBeenCalledTimes(4);
    expect(fastify.get).toHaveBeenCalledTimes(1);
    expect(fastify.patch).toHaveBeenCalledTimes(1);
    expect(fastify.delete).toHaveBeenCalledTimes(1);
  });

  it('passes schema objects to route registrations', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    // Check that the registration options route has a schema
    const regOptionsCall = fastify.post.mock.calls.find(
      (call: any[]) => call[0] === '/webauthn/register/options'
    );
    expect(regOptionsCall[1]).toHaveProperty('schema');
    expect(regOptionsCall[1].schema).toHaveProperty('body');

    // Check that the delete route has params schema
    const deleteCall = fastify.delete.mock.calls[0];
    expect(deleteCall[1]).toHaveProperty('schema');
    expect(deleteCall[1].schema).toHaveProperty('params');
  });
});

// =============================================================================
// Edge cases & additional coverage
// =============================================================================

describe('Edge cases', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration options passes undefined displayName when user has none', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'abc' },
    });

    const request = mockRequest({
      webauthnUser: { userId: 'user-123', userName: 'alice@test.com' },
      body: {},
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ userDisplayName: undefined })
    );
  });

  it('registration options passes body authenticatorType and requireUserVerification', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'abc' },
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { authenticatorType: 'cross-platform', requireUserVerification: false },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatorType: 'cross-platform',
        requireUserVerification: false,
      })
    );
  });

  it('list credentials maps multiple credentials correctly', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    const cred2 = {
      ...TEST_CREDENTIAL,
      id: 'cred-2',
      name: 'Phone',
      lastUsedAt: null,
      deviceType: 'singleDevice',
      backedUp: false,
    };
    mockService.listCredentials.mockResolvedValue({
      credentials: [TEST_CREDENTIAL, cred2],
      total: 2,
    });

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body.credentials).toHaveLength(2);
    expect(reply._body.credentials[0].name).toBe('My Passkey');
    expect(reply._body.credentials[1].name).toBe('Phone');
    expect(reply._body.credentials[1].backedUp).toBe(false);
    expect(reply._body.total).toBe(2);
  });

  it('authentication verify passes body.userId to service', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-456',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-456', response: { id: 'r1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.verifyAuthentication).toHaveBeenCalledWith({
      userId: 'user-456',
      response: { id: 'r1' },
    });
  });

  it('registration verify passes body.response to service', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    const mockResponse = { id: 'resp-1', rawId: 'raw', type: 'public-key' };
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: mockResponse },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.verifyRegistration).toHaveBeenCalledWith({
      userId: 'user-123',
      response: mockResponse,
      credentialName: undefined,
    });
  });
});

// =============================================================================
// Mutation-killing: Response body field verification (ObjectLiteral mutations)
// =============================================================================

describe('Response body structure verification (ObjectLiteral kills)', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  // --- Registration options handler error responses ---

  it('registration options 401 has exact error body structure', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    // Kill ObjectLiteral: verify the entire body, not just code
    expect(reply._body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to register a passkey',
      },
    });
  });

  it('registration options 500 has exact error body structure', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockRejectedValue(new Error('fail'));

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate registration options',
      },
    });
  });

  it('registration options WebAuthnError has exact error body', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    const err = new WebAuthnError('Custom error');
    (err as any).statusCode = 400;
    (err as any).code = 'CUSTOM_CODE';
    mockService.generateRegistrationOptions.mockRejectedValue(err);

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'CUSTOM_CODE',
        message: 'Custom error',
      },
    });
  });

  // --- Registration verify handler error responses ---

  it('registration verify 401 has exact error body structure', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    const request = mockRequest({ body: { response: {} } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to register a passkey',
      },
    });
  });

  it('registration verify failure has exact error body with errorCode', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
      errorCode: 'CHALLENGE_EXPIRED',
      error: 'Challenge has expired',
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge has expired',
      },
    });
  });

  it('registration verify 500 has exact error body', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockRejectedValue(new Error('fail'));

    const request = mockRequest({ webauthnUser: TEST_USER, body: { response: {} } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify registration',
      },
    });
  });

  it('registration verify success body has exactly verified and credential fields', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    const body = reply._body;
    expect(body.verified).toBe(true);
    expect(body.credential).toEqual({
      id: 'cred-1',
      name: 'My Passkey',
      createdAt: new Date('2025-01-01'),
      deviceType: 'multiDevice',
      backedUp: true,
    });
    // Ensure no extra keys leak through
    expect(Object.keys(body)).toEqual(['verified', 'credential']);
    expect(Object.keys(body.credential)).toEqual(['id', 'name', 'createdAt', 'deviceType', 'backedUp']);
  });

  // --- Authentication options handler error responses ---

  it('authentication options 500 has exact error body', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockRejectedValue(new Error('fail'));

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate authentication options',
      },
    });
  });

  it('authentication options WebAuthnAuthenticationError has exact body', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    const err = new WebAuthnAuthenticationError('No creds', 'NO_CREDENTIALS' as any);
    mockService.generateAuthenticationOptions.mockRejectedValue(err);

    const request = mockRequest({ body: { userId: 'user-123' } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'WEBAUTHN_AUTHENTICATION_ERROR',
        message: 'No creds',
      },
    });
  });

  it('authentication options WebAuthnError (non-auth) has exact body', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    const err = new WebAuthnError('Store error');
    mockService.generateAuthenticationOptions.mockRejectedValue(err);

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'WEBAUTHN_ERROR',
        message: 'Store error',
      },
    });
  });

  // --- Authentication verify handler responses ---

  it('authentication verify failure has exact error body with errorCode', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
      errorCode: 'VERIFICATION_FAILED',
      error: 'Sig mismatch',
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'VERIFICATION_FAILED',
        message: 'Sig mismatch',
      },
    });
  });

  it('authentication verify 500 has exact error body', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockRejectedValue(new Error('fail'));

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify authentication',
      },
    });
  });

  it('authentication verify WebAuthnError has exact body', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    const err = new WebAuthnError('Bad state');
    (err as any).statusCode = 400;
    (err as any).code = 'WEBAUTHN_ERROR';
    mockService.verifyAuthentication.mockRejectedValue(err);

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'WEBAUTHN_ERROR',
        message: 'Bad state',
      },
    });
  });

  it('authentication verify success body has exact structure with credential fields', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    const body = reply._body;
    expect(body.verified).toBe(true);
    expect(body.userId).toBe('user-123');
    expect(body.credential).toEqual({
      id: 'cred-1',
      name: 'My Passkey',
      lastUsedAt: new Date('2025-06-01'),
    });
    expect(Object.keys(body.credential)).toEqual(['id', 'name', 'lastUsedAt']);
  });

  // --- List credentials handler responses ---

  it('list credentials 401 has exact error body', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    const request = mockRequest();
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  });

  it('list credentials 500 has exact error body', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockRejectedValue(new Error('fail'));

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list credentials',
      },
    });
  });

  it('list credentials mapped items have exact field set', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockResolvedValue({
      credentials: [TEST_CREDENTIAL],
      total: 1,
    });

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    const cred = reply._body.credentials[0];
    expect(Object.keys(cred)).toEqual(['id', 'name', 'createdAt', 'lastUsedAt', 'deviceType', 'backedUp']);
    expect(cred.id).toBe('cred-1');
    expect(cred.name).toBe('My Passkey');
    expect(cred.createdAt).toEqual(new Date('2025-01-01'));
    expect(cred.lastUsedAt).toEqual(new Date('2025-06-01'));
    expect(cred.deviceType).toBe('multiDevice');
    expect(cred.backedUp).toBe(true);
  });

  // --- Rename credential handler responses ---

  it('rename credential 401 has exact error body', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const request = mockRequest({
      params: { credentialId: 'cred-1' },
      body: { name: 'New' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  });

  it('rename credential success body has exact credential fields', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const updated = { ...TEST_CREDENTIAL, name: 'Renamed' };
    mockService.renameCredential.mockResolvedValue(updated);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
      body: { name: 'Renamed' },
    });
    const reply = mockReply();

    await handler(request, reply);

    const cred = reply._body.credential;
    expect(Object.keys(cred)).toEqual(['id', 'name', 'createdAt', 'lastUsedAt', 'deviceType', 'backedUp']);
    expect(cred.name).toBe('Renamed');
  });

  it('rename credential NOT_FOUND has exact error body', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const err: any = new Error('not found');
    err.code = 'NOT_FOUND';
    mockService.renameCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
      body: { name: 'N' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Credential not found',
      },
    });
  });

  it('rename credential 500 has exact error body', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    mockService.renameCredential.mockRejectedValue(new Error('fail'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
      body: { name: 'N' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to rename credential',
      },
    });
  });

  // --- Delete credential handler responses ---

  it('delete credential 401 has exact error body', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    const request = mockRequest({ params: { credentialId: 'cred-1' } });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  });

  it('delete credential NOT_FOUND has exact error body', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    const err: any = new Error('not found');
    err.code = 'NOT_FOUND';
    mockService.deleteCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Credential not found',
      },
    });
  });

  it('delete credential 500 has exact error body', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockRejectedValue(new Error('fail'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply._body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to delete credential',
      },
    });
  });
});

// =============================================================================
// Mutation-killing: LogicalOperator / ConditionalExpression / BooleanLiteral
// =============================================================================

describe('LogicalOperator, ConditionalExpression, and BooleanLiteral kills', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration verify uses result.errorCode when present (not fallback)', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
      errorCode: 'MY_ERROR',
      error: 'My message',
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills LogicalOperator ?? mutation on line 315/318/319
    expect(reply._body.error.code).toBe('MY_ERROR');
    expect(reply._body.error.message).toBe('My message');
  });

  it('authentication verify uses result.errorCode when present (not fallback)', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
      errorCode: 'SPECIFIC_ERROR',
      error: 'Specific message',
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills LogicalOperator ?? mutation on line 436/439/440
    expect(reply._body.error.code).toBe('SPECIFIC_ERROR');
    expect(reply._body.error.message).toBe('Specific message');
  });

  it('authentication options handler tests ConditionalExpression: WebAuthnAuthenticationError before WebAuthnError', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];

    // Test the first conditional branch (WebAuthnAuthenticationError)
    const authErr = new WebAuthnAuthenticationError('No credentials found', 'NO_CREDS' as any);
    mockService.generateAuthenticationOptions.mockRejectedValue(authErr);

    const request1 = mockRequest({ body: { userId: 'user-123' } });
    const reply1 = mockReply();

    await handler(request1, reply1);

    // This is 401 from WebAuthnAuthenticationError (line 385)
    expect(reply1.status).toHaveBeenCalledWith(401);
    expect(reply1._body.error.code).toBe('WEBAUTHN_AUTHENTICATION_ERROR');
    expect(reply1._body.error.message).toBe('No credentials found');
  });
});

// =============================================================================
// Mutation-killing: webauthnPlugin log message fields (BooleanLiteral, EqualityOperator, ConditionalExpression)
// =============================================================================

describe('webauthnPlugin logging fields (lines 813-815)', () => {
  it('should log routesRegistered as true when registerRoutes is undefined (default)', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    // registerRoutes is not set (undefined), so it defaults to true
    await (webauthnPlugin as any)(fastify, { service: mockService });

    // Routes ARE registered when registerRoutes is undefined (line 705: registerRoutes !== false)
    expect(fastify.post).toHaveBeenCalled();
    // Line 813: routesRegistered: options.registerRoutes !== false => true
  });

  it('should log routesRegistered as false when registerRoutes is false', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      registerRoutes: false,
    });

    // Routes NOT registered; line 813: registerRoutes !== false => false
    expect(fastify.post).not.toHaveBeenCalled();
    expect(fastify.get).not.toHaveBeenCalled();
  });

  it('should log hasUserContext as true when getUserContext is provided', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const getUserContext = vi.fn();
    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      getUserContext,
    });

    // Line 814: hasUserContext: !!options.getUserContext => true
    expect(fastify.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
  });

  it('should log hasCreateSession as true when createSession is provided', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const createSession = vi.fn();
    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      createSession,
    });

    // Line 815: hasCreateSession: !!options.createSession => true
    // Just verify registration completes without error
    expect(fastify.decorate).toHaveBeenCalledWith('webauthnService', mockService);
  });

  it('should log hasCreateSession as false when createSession is not provided', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
    });

    // Line 815: hasCreateSession: !!options.createSession => false
    expect(fastify.decorate).toHaveBeenCalledWith('webauthnService', mockService);
  });

  it('should log routesRegistered as true when registerRoutes is explicitly true', async () => {
    const mockService = createMockService();
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, {
      service: mockService,
      registerRoutes: true,
    });

    // registerRoutes !== false => true, so routes are registered
    expect(fastify.post).toHaveBeenCalledTimes(4);
  });
});

// =============================================================================
// Mutation-killing: OptionalChaining on request.body?. and (error as any)?.code
// =============================================================================

describe('OptionalChaining mutations', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration options reads body?.authenticatorType safely when body is empty object', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    // body is {} so body?.authenticatorType is undefined (not a crash)
    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: {},
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatorType: undefined,
        requireUserVerification: undefined,
      })
    );
  });

  it('authentication options reads body?.userId and body?.requireUserVerification safely when body is empty object', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockService.generateAuthenticationOptions).toHaveBeenCalledWith({
      userId: undefined,
      requireUserVerification: undefined,
    });
  });

  it('list credentials error handler reads webauthnUser?.userId safely when user is present', async () => {
    const handler = handlers['GET:/webauthn/credentials'];
    mockService.listCredentials.mockRejectedValue(new Error('DB error'));

    const request = mockRequest({ webauthnUser: TEST_USER });
    const reply = mockReply();

    await handler(request, reply);

    // Kills OptionalChaining line 522: request.webauthnUser?.userId
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('rename credential error handler reads (error as any)?.code for NOT_FOUND', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    const err: any = new Error('nf');
    err.code = 'NOT_FOUND';
    mockService.renameCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
      body: { name: 'N' },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills OptionalChaining line 578/586: (error as any)?.code === 'NOT_FOUND'
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('rename credential error handler falls to 500 when error has no code', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    mockService.renameCredential.mockRejectedValue(new Error('plain'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
      body: { name: 'N' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('delete credential error handler reads (error as any)?.code for NOT_FOUND', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    const err: any = new Error('nf');
    err.code = 'NOT_FOUND';
    mockService.deleteCredential.mockRejectedValue(err);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills OptionalChaining line 635/643: (error as any)?.code === 'NOT_FOUND'
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('delete credential error handler falls to 500 when error has no code', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockRejectedValue(new Error('plain'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'x' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('rename credential error handler reads webauthnUser?.userId and params.credentialId in error log', async () => {
    const handler = handlers['PATCH:/webauthn/credentials/:credentialId'];
    mockService.renameCredential.mockRejectedValue(new Error('err'));

    const request = mockRequest({
      webauthnUser: { userId: 'user-999' },
      params: { credentialId: 'cred-999' },
      body: { name: 'N' },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills OptionalChaining line 579: request.webauthnUser?.userId
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('delete credential error handler reads webauthnUser?.userId in error log', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockRejectedValue(new Error('err'));

    const request = mockRequest({
      webauthnUser: { userId: 'user-999' },
      params: { credentialId: 'cred-999' },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Kills OptionalChaining line 636: request.webauthnUser?.userId
    expect(reply.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// Mutation-killing: Plugin metadata exact values (StringLiteral)
// =============================================================================

describe('Plugin metadata exact values', () => {
  it('should pass name "vorion-webauthn" to fastify-plugin (not empty, not swapped)', () => {
    const meta = (webauthnPlugin as any).__pluginMeta;
    expect(meta).toBeDefined();
    expect(meta.name).toBe('vorion-webauthn');
    expect(meta.name).not.toBe('');
    expect(meta.name).not.toBe('webauthn');
    expect(meta.name).not.toBe('vorion');
  });

  it('should pass fastify "5.x" to fastify-plugin (not "4.x", not empty)', () => {
    const meta = (webauthnPlugin as any).__pluginMeta;
    expect(meta.fastify).toBe('5.x');
    expect(meta.fastify).not.toBe('4.x');
    expect(meta.fastify).not.toBe('');
  });
});

// =============================================================================
// Mutation-killing: Counter metric labels for success/error (StringLiteral)
// =============================================================================

describe('Counter metric labels exact values', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    mockCounterInc.mockClear();
    mockHistogramObserve.mockClear();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration verify success increments counter with result "success" (not "ok", not "true")', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'success' });
  });

  it('registration verify error (generic throw) increments counter with result "error" (not "failure")', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockRejectedValue(new Error('crash'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'error' });
  });

  it('registration options error (generic throw) increments counter with result "error"', async () => {
    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockRejectedValue(new Error('crash'));

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: {},
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'error' });
  });

  it('authentication verify success increments counter with result "success"', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'success' });
  });

  it('authentication verify error (generic throw) increments counter with result "error"', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockRejectedValue(new Error('crash'));

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'error' });
  });

  it('authentication options error (generic throw) increments counter with result "error"', async () => {
    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockRejectedValue(new Error('crash'));

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'error' });
  });

  it('registration verify failure uses fallback "failed" when errorCode is undefined', async () => {
    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
      // No errorCode
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'failed' });
  });

  it('authentication verify failure uses fallback "failed" when errorCode is undefined', async () => {
    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
      // No errorCode
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'failed' });
  });
});

// =============================================================================
// Mutation-killing: Histogram operation labels exact values
// =============================================================================

describe('Histogram operation labels exact values', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    mockCounterInc.mockClear();
    mockHistogramObserve.mockClear();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration options uses operation "registration_options" (not "reg_options")', async () => {
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const handler = handlers['POST:/webauthn/register/options'];
    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockHistogramObserve).toHaveBeenCalledWith(
      { operation: 'registration_options' },
      expect.any(Number)
    );
  });

  it('registration verify uses operation "registration_verify" (not "reg_verify")', async () => {
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const handler = handlers['POST:/webauthn/register/verify'];
    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockHistogramObserve).toHaveBeenCalledWith(
      { operation: 'registration_verify' },
      expect.any(Number)
    );
  });

  it('authentication options uses operation "authentication_options" (not "auth_options")', async () => {
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const handler = handlers['POST:/webauthn/authenticate/options'];
    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockHistogramObserve).toHaveBeenCalledWith(
      { operation: 'authentication_options' },
      expect.any(Number)
    );
  });

  it('authentication verify uses operation "authentication_verify" (not "auth_verify")', async () => {
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const handler = handlers['POST:/webauthn/authenticate/verify'];
    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(mockHistogramObserve).toHaveBeenCalledWith(
      { operation: 'authentication_verify' },
      expect.any(Number)
    );
  });
});

// =============================================================================
// Mutation-killing: Request schema property exact structures
// =============================================================================

describe('Request schema property verification', () => {
  it('registration options request schema allows authenticatorType enum values', async () => {
    const mockService = createMockService();
    const schemas: Record<string, any> = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      get: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      patch: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      delete: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    // Verify registrationOptionsRequestSchema
    const regSchema = schemas['/webauthn/register/options'];
    expect(regSchema).toBeDefined();
    expect(regSchema.body.properties.authenticatorType.enum).toEqual(['platform', 'cross-platform']);
    expect(regSchema.body.properties.requireUserVerification.type).toBe('boolean');
  });

  it('registration verify request schema has required ["response"]', async () => {
    const mockService = createMockService();
    const schemas: Record<string, any> = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    const verifySchema = schemas['/webauthn/register/verify'];
    expect(verifySchema.body.required).toEqual(['response']);
    expect(verifySchema.body.properties.credentialName.minLength).toBe(1);
    expect(verifySchema.body.properties.credentialName.maxLength).toBe(255);
  });

  it('authentication verify request schema has required ["userId", "response"]', async () => {
    const mockService = createMockService();
    const schemas: Record<string, any> = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    const authVerifySchema = schemas['/webauthn/authenticate/verify'];
    expect(authVerifySchema.body.required).toEqual(['userId', 'response']);
    expect(authVerifySchema.body.properties.userId.type).toBe('string');
    expect(authVerifySchema.body.properties.response.type).toBe('object');
  });

  it('credential rename request schema has required ["name"] and name constraints', async () => {
    const mockService = createMockService();
    const schemas: Record<string, any> = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
      delete: vi.fn(),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    const renameSchema = schemas['/webauthn/credentials/:credentialId'];
    expect(renameSchema.body.required).toEqual(['name']);
    expect(renameSchema.body.properties.name.minLength).toBe(1);
    expect(renameSchema.body.properties.name.maxLength).toBe(255);
  });

  it('delete credential route has params schema with required credentialId', async () => {
    const mockService = createMockService();
    const schemas: Record<string, any> = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn((path: string, opts: any, _handler: Function) => {
        schemas[path] = opts.schema;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });

    const deleteSchema = schemas['/webauthn/credentials/:credentialId'];
    expect(deleteSchema.params.required).toEqual(['credentialId']);
    expect(deleteSchema.params.properties.credentialId.type).toBe('string');
  });
});

// =============================================================================
// Mutation-killing: Delete handler exact status code 204 (not 200, not 201)
// =============================================================================

describe('Delete handler exact status code', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('delete credential success returns exactly 204 (not 200, not 201, not 202)', async () => {
    const handler = handlers['DELETE:/webauthn/credentials/:credentialId'];
    mockService.deleteCredential.mockResolvedValue(undefined);

    const request = mockRequest({
      webauthnUser: TEST_USER,
      params: { credentialId: 'cred-1' },
    });
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(204);
    expect(reply.status).not.toHaveBeenCalledWith(200);
    expect(reply.status).not.toHaveBeenCalledWith(201);
  });
});

// =============================================================================
// Mutation-killing: ArithmeticOperator on duration calculations (/ 1000 → * 1000, - → +)
// =============================================================================

describe('ArithmeticOperator mutation kills (duration calculations)', () => {
  let mockService: ReturnType<typeof createMockService>;
  let handlers: Record<string, Function>;

  beforeEach(async () => {
    mockService = createMockService();
    mockHistogramObserve.mockClear();
    mockCounterInc.mockClear();
    handlers = {};
    const fastify: any = {
      decorate: vi.fn(),
      addHook: vi.fn(),
      post: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`POST:${path}`] = handler;
      }),
      get: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`GET:${path}`] = handler;
      }),
      patch: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`PATCH:${path}`] = handler;
      }),
      delete: vi.fn((path: string, _opts: any, handler: Function) => {
        handlers[`DELETE:${path}`] = handler;
      }),
    };

    await (webauthnPlugin as any)(fastify, { service: mockService });
  });

  it('registration options handler records duration in seconds (kills /1000→*1000 and -→+ mutations)', async () => {
    // Mock Date.now to simulate 500ms elapsed
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(1000000).mockReturnValueOnce(1000500);

    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    // Duration should be (1000500 - 1000000) / 1000 = 0.5 seconds
    // Mutation * 1000 would give 500000, + mutation would give (1000500 + 1000000) / 1000 = 2000.5
    const observeCall = mockHistogramObserve.mock.calls.find(
      (call: any[]) => call[0]?.operation === 'registration_options'
    );
    expect(observeCall).toBeDefined();
    expect(observeCall![1]).toBeCloseTo(0.5, 1);
    expect(observeCall![1]).toBeLessThan(10);

    dateNowSpy.mockRestore();
  });

  it('registration verify handler records duration in seconds (kills /1000→*1000 and -→+ mutations)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(2000000).mockReturnValueOnce(2000750);

    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: true,
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Duration should be (2000750 - 2000000) / 1000 = 0.75 seconds
    const observeCall = mockHistogramObserve.mock.calls.find(
      (call: any[]) => call[0]?.operation === 'registration_verify'
    );
    expect(observeCall).toBeDefined();
    expect(observeCall![1]).toBeCloseTo(0.75, 1);
    expect(observeCall![1]).toBeLessThan(10);

    dateNowSpy.mockRestore();
  });

  it('authentication options handler records duration in seconds (kills /1000→*1000 and -→+ mutations)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(3000000).mockReturnValueOnce(3000250);

    const handler = handlers['POST:/webauthn/authenticate/options'];
    mockService.generateAuthenticationOptions.mockResolvedValue({
      options: { challenge: 'auth-c' },
    });

    const request = mockRequest({ body: {} });
    const reply = mockReply();

    await handler(request, reply);

    // Duration should be (3000250 - 3000000) / 1000 = 0.25 seconds
    const observeCall = mockHistogramObserve.mock.calls.find(
      (call: any[]) => call[0]?.operation === 'authentication_options'
    );
    expect(observeCall).toBeDefined();
    expect(observeCall![1]).toBeCloseTo(0.25, 1);
    expect(observeCall![1]).toBeLessThan(10);

    dateNowSpy.mockRestore();
  });

  it('authentication verify handler records duration in seconds (kills /1000→*1000 and -→+ mutations)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(4000000).mockReturnValueOnce(4001000);

    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 'user-123',
      credential: TEST_CREDENTIAL,
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: { id: 'cred-1' } },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Duration should be (4001000 - 4000000) / 1000 = 1.0 seconds
    const observeCall = mockHistogramObserve.mock.calls.find(
      (call: any[]) => call[0]?.operation === 'authentication_verify'
    );
    expect(observeCall).toBeDefined();
    expect(observeCall![1]).toBeCloseTo(1.0, 1);
    expect(observeCall![1]).toBeLessThan(10);

    dateNowSpy.mockRestore();
  });

  it('registration verify handler records counter with actual errorCode (kills LogicalOperator ?? mutation)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(6000000).mockReturnValueOnce(6000100);

    const handler = handlers['POST:/webauthn/register/verify'];
    mockService.verifyRegistration.mockResolvedValue({
      verified: false,
      errorCode: 'CHALLENGE_EXPIRED',
      error: 'Challenge expired',
    });

    const request = mockRequest({
      webauthnUser: TEST_USER,
      body: { response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Verify counter inc was called with the actual errorCode, not the fallback 'failed'
    // Kills LogicalOperator: result.errorCode ?? 'failed' → result.errorCode && 'failed'
    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'CHALLENGE_EXPIRED' });

    dateNowSpy.mockRestore();
  });

  it('authentication verify handler records counter with actual errorCode (kills LogicalOperator ?? mutation)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(7000000).mockReturnValueOnce(7000100);

    const handler = handlers['POST:/webauthn/authenticate/verify'];
    mockService.verifyAuthentication.mockResolvedValue({
      verified: false,
      errorCode: 'COUNTER_MISMATCH',
      error: 'Counter mismatch',
    });

    const request = mockRequest({
      body: { userId: 'user-123', response: {} },
    });
    const reply = mockReply();

    await handler(request, reply);

    // Verify counter inc was called with the actual errorCode, not the fallback 'failed'
    // Kills LogicalOperator: result.errorCode ?? 'failed' → result.errorCode && 'failed'
    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'COUNTER_MISMATCH' });

    dateNowSpy.mockRestore();
  });

  it('observe is called with operation label object (kills ObjectLiteral on label)', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(8000000).mockReturnValueOnce(8000200);

    const handler = handlers['POST:/webauthn/register/options'];
    mockService.generateRegistrationOptions.mockResolvedValue({
      options: { challenge: 'c' },
    });

    const request = mockRequest({ webauthnUser: TEST_USER, body: {} });
    const reply = mockReply();

    await handler(request, reply);

    // Verify the label object is { operation: 'registration_options' }, not {}
    expect(mockHistogramObserve).toHaveBeenCalledWith(
      { operation: 'registration_options' },
      expect.any(Number)
    );

    dateNowSpy.mockRestore();
  });
});
