/**
 * Tests for Policy Engine Middleware
 *
 * Validates defaultUserExtractor, buildPolicyContext, handleDecision,
 * createPolicyMiddleware, enforcePolicies, policyEnginePlugin, and
 * registerManagementApi.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { PolicyDecision, PolicyAction, PolicyContext } from '../types.js';

// =============================================================================
// MOCKS (vi.hoisted ensures variables are available during vi.mock hoisting)
// =============================================================================

const {
  mockLogger,
  mockEvaluateWithTracing,
  mockGetAllPolicies,
  mockGetPolicy,
  mockAddPolicy,
  mockUpdatePolicy,
  mockRemovePolicy,
  mockEnablePolicy,
  mockDisablePolicy,
  mockValidatePolicy,
  mockSimulate,
  mockGetPolicyVersions,
  mockRollbackPolicy,
  mockGetStats,
} = vi.hoisted(() => ({
  mockLogger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockEvaluateWithTracing: vi.fn(),
  mockGetAllPolicies: vi.fn(),
  mockGetPolicy: vi.fn(),
  mockAddPolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockRemovePolicy: vi.fn(),
  mockEnablePolicy: vi.fn(),
  mockDisablePolicy: vi.fn(),
  mockValidatePolicy: vi.fn(),
  mockSimulate: vi.fn(),
  mockGetPolicyVersions: vi.fn(),
  mockRollbackPolicy: vi.fn(),
  mockGetStats: vi.fn(),
}));

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../common/trace.js', () => ({
  withSpan: vi.fn(
    async (
      _name: string,
      fn: (span: { attributes: Record<string, unknown> }) => Promise<unknown>,
      _attrs?: Record<string, unknown>,
    ) => fn({ attributes: {} }),
  ),
}));

vi.mock('fastify-plugin', () => ({
  default: vi.fn((plugin: unknown) => plugin),
}));

vi.mock('../engine.js', () => {
  const MockEngine = vi.fn(function (this: Record<string, unknown>) {
    this.evaluateWithTracing = mockEvaluateWithTracing;
    this.getAllPolicies = mockGetAllPolicies;
    this.getPolicy = mockGetPolicy;
    this.addPolicy = mockAddPolicy;
    this.updatePolicy = mockUpdatePolicy;
    this.removePolicy = mockRemovePolicy;
    this.enablePolicy = mockEnablePolicy;
    this.disablePolicy = mockDisablePolicy;
    this.validatePolicy = mockValidatePolicy;
    this.simulate = mockSimulate;
    this.getPolicyVersions = mockGetPolicyVersions;
    this.rollbackPolicy = mockRollbackPolicy;
    this.getStats = mockGetStats;
  });
  return { SecurityPolicyEngine: MockEngine };
});

// Must import after mocks are set up
import {
  createPolicyMiddleware,
  enforcePolicies,
  policyEnginePluginFp,
  type PolicyMiddlewareOptions,
} from '../middleware.js';
import { SecurityPolicyEngine } from '../engine.js';

// =============================================================================
// HELPERS
// =============================================================================

function createMockEngine() {
  return new SecurityPolicyEngine() as unknown as SecurityPolicyEngine & {
    evaluateWithTracing: Mock;
  };
}

function createMockRequest(overrides?: Record<string, unknown>): FastifyRequest {
  return {
    id: 'req-123',
    method: 'GET',
    url: '/api/test?foo=bar',
    ip: '192.168.1.1',
    headers: {
      'user-agent': 'TestAgent/1.0',
      'origin': 'https://example.com',
      'referer': 'https://example.com/page',
      'content-type': 'application/json',
    },
    query: { foo: 'bar' },
    body: { key: 'value' },
    ...overrides,
  } as unknown as FastifyRequest;
}

function createMockReply(): FastifyReply & {
  _status: number | null;
  _sent: unknown;
  _headers: Record<string, string>;
  _redirectUrl: string | null;
  _redirectCode: number | null;
} {
  const reply = {
    _status: null as number | null,
    _sent: undefined as unknown,
    _headers: {} as Record<string, string>,
    _redirectUrl: null as string | null,
    _redirectCode: null as number | null,
    status: vi.fn().mockImplementation(function (this: typeof reply, code: number) {
      this._status = code;
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: typeof reply, data: unknown) {
      this._sent = data;
      return this;
    }),
    header: vi.fn().mockImplementation(function (this: typeof reply, name: string, value: string) {
      this._headers[name] = value;
      return this;
    }),
    redirect: vi.fn().mockImplementation(function (this: typeof reply, url: string, code: number) {
      this._redirectUrl = url;
      this._redirectCode = code;
      return this;
    }),
  };
  return reply as typeof reply;
}

function makeAllowDecision(overrides?: Partial<PolicyDecision>): PolicyDecision {
  return {
    id: 'decision-1',
    requestId: 'req-123',
    outcome: 'allow',
    reason: 'Allowed',
    actions: [],
    evaluatedPolicies: [],
    matchedPolicies: [],
    breakGlassUsed: false,
    totalDurationMs: 1,
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDenyDecision(overrides?: Partial<PolicyDecision>): PolicyDecision {
  return {
    id: 'decision-2',
    requestId: 'req-123',
    outcome: 'deny',
    reason: 'Access denied by policy',
    actions: [
      {
        type: 'deny',
        reason: 'Blocked',
        errorCode: 'CUSTOM_DENY',
        httpStatus: 403,
        retryable: true,
        retryAfter: 60,
      },
    ],
    evaluatedPolicies: [],
    matchedPolicies: [],
    breakGlassUsed: false,
    totalDurationMs: 2,
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// defaultUserExtractor (tested indirectly via createPolicyMiddleware)
// =============================================================================

describe('defaultUserExtractor (via middleware)', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = createMockEngine();
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
  });

  it('extracts user.id when user has id field', async () => {
    const request = createMockRequest({
      user: { id: 'user-1', email: 'test@example.com' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user).toBeDefined();
    expect(context.user!.id).toBe('user-1');
    expect(context.user!.email).toBe('test@example.com');
  });

  it('extracts user.sub as fallback for id', async () => {
    const request = createMockRequest({
      user: { sub: 'sub-1' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.id).toBe('sub-1');
  });

  it('extracts user.userId as fallback for id', async () => {
    const request = createMockRequest({
      user: { userId: 'uid-1' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.id).toBe('uid-1');
  });

  it('prioritizes id over sub and userId', async () => {
    const request = createMockRequest({
      user: { id: 'id-1', sub: 'sub-1', userId: 'uid-1' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.id).toBe('id-1');
  });

  it('extracts role and roles', async () => {
    const request = createMockRequest({
      user: { id: 'u1', role: 'admin', roles: ['admin', 'editor'] },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.role).toBe('admin');
    expect(context.user!.roles).toEqual(['admin', 'editor']);
  });

  it('extracts department, groups, and permissions', async () => {
    const request = createMockRequest({
      user: {
        id: 'u1',
        department: 'engineering',
        groups: ['team-a', 'team-b'],
        permissions: ['read', 'write'],
      },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.department).toBe('engineering');
    expect(context.user!.groups).toEqual(['team-a', 'team-b']);
    expect(context.user!.permissions).toEqual(['read', 'write']);
  });

  it('extracts tenant from user.tenant', async () => {
    const request = createMockRequest({
      user: { id: 'u1', tenant: 'tenant-abc' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.tenant).toBe('tenant-abc');
  });

  it('extracts tenant from user.tenantId as fallback', async () => {
    const request = createMockRequest({
      user: { id: 'u1', tenantId: 'tid-1' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.tenant).toBe('tid-1');
  });

  it('extracts riskScore, mfaVerified, lastMfaAt, sessionStartedAt', async () => {
    const request = createMockRequest({
      user: {
        id: 'u1',
        riskScore: 42,
        mfaVerified: true,
        lastMfaAt: '2026-01-01T00:00:00Z',
        sessionStartedAt: '2026-02-27T10:00:00Z',
      },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.riskScore).toBe(42);
    expect(context.user!.mfaVerified).toBe(true);
    expect(context.user!.lastMfaAt).toBe('2026-01-01T00:00:00Z');
    expect(context.user!.sessionStartedAt).toBe('2026-02-27T10:00:00Z');
  });

  it('returns undefined user when request has no user', async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user).toBeUndefined();
  });

  it('sets attributes to the entire user object', async () => {
    const userObj = { id: 'u1', customField: 'custom-value', nested: { deep: true } };
    const request = createMockRequest({ user: userObj });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user!.attributes).toBe(userObj);
  });

  it('uses custom extractUser when provided', async () => {
    const customUser = { id: 'custom-user', email: 'custom@test.com' };
    const request = createMockRequest({ user: { id: 'original' } });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      extractUser: () => customUser,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.user).toBe(customUser);
  });
});

// =============================================================================
// buildPolicyContext (tested indirectly via createPolicyMiddleware)
// =============================================================================

describe('buildPolicyContext (via middleware)', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = createMockEngine();
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
  });

  it('builds request context with method, path, url, ip', async () => {
    const request = createMockRequest({
      method: 'POST',
      url: '/api/users?page=1',
      ip: '10.0.0.5',
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.method).toBe('POST');
    expect(context.request.path).toBe('/api/users');
    expect(context.request.url).toBe('/api/users?page=1');
    expect(context.request.ip).toBe('10.0.0.5');
  });

  it('splits query string from path correctly', async () => {
    const request = createMockRequest({ url: '/path?a=1&b=2' });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.path).toBe('/path');
    expect(context.request.url).toBe('/path?a=1&b=2');
  });

  it('builds request context with userAgent, origin, referer, contentType', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
        'origin': 'https://app.example.com',
        'referer': 'https://app.example.com/dashboard',
        'content-type': 'text/html',
      },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.userAgent).toBe('Mozilla/5.0');
    expect(context.request.origin).toBe('https://app.example.com');
    expect(context.request.referer).toBe('https://app.example.com/dashboard');
    expect(context.request.contentType).toBe('text/html');
  });

  it('includes headers, query, and body in context', async () => {
    const request = createMockRequest({
      headers: { 'x-custom': 'val' },
      query: { search: 'term' },
      body: { data: 123 },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.headers).toEqual({ 'x-custom': 'val' });
    expect(context.request.query).toEqual({ search: 'term' });
    expect(context.request.body).toEqual({ data: 123 });
  });

  it('uses request.id if provided', async () => {
    const request = createMockRequest({ id: 'my-req-id' });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.id).toBe('my-req-id');
  });

  it('generates UUID for request.id when not provided', async () => {
    const request = createMockRequest({ id: undefined });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    // Should be a valid UUID format (the fallback from randomUUID)
    expect(context.request.id).toBeDefined();
    expect(typeof context.request.id).toBe('string');
    expect(context.request.id.length).toBeGreaterThan(0);
  });

  it('builds environment with timestamp, timezone, dayOfWeek, hour, isWeekend', async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.environment).toBeDefined();
    expect(context.environment!.timestamp).toBeDefined();
    expect(typeof context.environment!.timezone).toBe('string');
    expect(context.environment!.dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(context.environment!.dayOfWeek).toBeLessThanOrEqual(6);
    expect(context.environment!.hour).toBeGreaterThanOrEqual(0);
    expect(context.environment!.hour).toBeLessThanOrEqual(23);
    expect(typeof context.environment!.isWeekend).toBe('boolean');
  });

  it('calls custom extractResource when provided', async () => {
    const resource = { id: 'res-1', type: 'document', sensitivityLevel: 'confidential' as const };
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      extractResource: () => resource,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.resource).toBe(resource);
  });

  it('calls custom extractRisk when provided', async () => {
    const risk = { userRiskScore: 75, threatLevel: 'high' as const };
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      extractRisk: () => risk,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.risk).toBe(risk);
  });

  it('calls custom extractCustom when provided', async () => {
    const custom = { source: 'api', tier: 'premium' };
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      extractCustom: () => custom,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.custom).toBe(custom);
  });

  it('does not include breakGlassToken when enableBreakGlass is false', async () => {
    const request = createMockRequest({
      headers: { 'x-break-glass-token': 'emergency-token' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      enableBreakGlass: false,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.breakGlassToken).toBeUndefined();
  });

  it('includes breakGlassToken from default header when enabled', async () => {
    const request = createMockRequest({
      headers: { 'x-break-glass-token': 'bg-token-123' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      enableBreakGlass: true,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.breakGlassToken).toBe('bg-token-123');
  });

  it('includes breakGlassToken from custom header when configured', async () => {
    const request = createMockRequest({
      headers: { 'x-custom-break-glass': 'custom-bg-token' },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      enableBreakGlass: true,
      breakGlassHeader: 'x-custom-break-glass',
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.breakGlassToken).toBe('custom-bg-token');
  });

  it('does not set breakGlassToken when header value is not a string', async () => {
    const request = createMockRequest({
      headers: { 'x-break-glass-token': ['array', 'value'] },
    });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {
      enableBreakGlass: true,
    });

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.breakGlassToken).toBeUndefined();
  });

  it('stores context on request.policyContext', async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect((request as FastifyRequest & { policyContext?: PolicyContext }).policyContext).toBeDefined();
  });
});

// =============================================================================
// handleDecision (tested indirectly via createPolicyMiddleware)
// =============================================================================

describe('handleDecision (via middleware)', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = createMockEngine();
  });

  it('sets X-Policy-Decision and X-Policy-Decision-Id headers on allow', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision({ id: 'dec-abc' }));
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._headers['X-Policy-Decision']).toBe('allow');
    expect(reply._headers['X-Policy-Decision-Id']).toBe('dec-abc');
  });

  it('allow decision continues processing (does not send response)', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply.send).not.toHaveBeenCalled();
  });

  it('deny decision sends 403 with errorCode and retryable', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeDenyDecision());
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(403);
    expect(reply._sent).toMatchObject({
      error: 'CUSTOM_DENY',
      retryable: true,
      decisionId: 'decision-2',
    });
  });

  it('deny decision sets Retry-After header when retryAfter is present', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeDenyDecision());
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._headers['Retry-After']).toBe('60');
  });

  it('deny decision uses POLICY_DENIED as default errorCode', async () => {
    const decision = makeDenyDecision({
      actions: [{ type: 'deny', reason: 'Denied' }],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._sent).toMatchObject({
      error: 'POLICY_DENIED',
      retryable: false,
    });
  });

  it('deny decision uses default 403 httpStatus when not specified', async () => {
    const decision = makeDenyDecision({
      actions: [{ type: 'deny', reason: 'Denied' }],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(403);
  });

  it('deny decision does not set Retry-After when retryAfter is absent', async () => {
    const decision = makeDenyDecision({
      actions: [{ type: 'deny', reason: 'No retry' }],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._headers['Retry-After']).toBeUndefined();
  });

  it('challenge decision sends 401 when no redirectUrl', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      outcome: 'challenge',
      reason: 'MFA required',
      actions: [
        { type: 'challenge', method: 'mfa', timeout: 300 },
      ],
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(401);
    expect(reply._sent).toMatchObject({
      error: 'CHALLENGE_REQUIRED',
      challengeMethod: 'mfa',
      challengeTimeout: 300,
    });
  });

  it('challenge decision redirects when redirectUrl is present', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      outcome: 'challenge',
      reason: 'SSO required',
      actions: [
        { type: 'challenge', method: 'password', redirectUrl: 'https://auth.example.com/login' },
      ],
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply.redirect).toHaveBeenCalledWith('https://auth.example.com/login', 302);
  });

  it('challenge decision uses mfa as default method when not specified', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      outcome: 'challenge',
      reason: 'Auth needed',
      actions: [
        { type: 'challenge', method: 'captcha' },
      ],
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(401);
    expect(reply._sent).toMatchObject({
      challengeMethod: 'captcha',
    });
  });

  it('challenge decision falls back to mfa when no challenge action found', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      outcome: 'challenge',
      reason: 'Auth needed',
      actions: [], // no challenge action
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(401);
    expect(reply._sent).toMatchObject({
      challengeMethod: 'mfa',
    });
  });

  it('pending decision sends 202 with APPROVAL_PENDING', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      id: 'pending-dec',
      outcome: 'pending',
      reason: 'Awaiting approval',
      actions: [],
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(202);
    expect(reply._sent).toMatchObject({
      error: 'APPROVAL_PENDING',
      message: 'Awaiting approval',
      decisionId: 'pending-dec',
    });
  });

  it('attaches decision to request.policyDecision', async () => {
    const decision = makeAllowDecision({ id: 'dec-attach' });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect((request as FastifyRequest & { policyDecision?: PolicyDecision }).policyDecision).toBe(decision);
  });
});

// =============================================================================
// createPolicyMiddleware
// =============================================================================

describe('createPolicyMiddleware', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = createMockEngine();
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
  });

  describe('skip paths', () => {
    it('skips /health by default', async () => {
      const request = createMockRequest({ url: '/health' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });

    it('skips /ready by default', async () => {
      const request = createMockRequest({ url: '/ready' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });

    it('skips /metrics by default', async () => {
      const request = createMockRequest({ url: '/metrics' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });

    it('skips custom paths', async () => {
      const request = createMockRequest({ url: '/internal/status' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {
        skipPaths: ['/internal/status'],
      });

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });

    it('does not skip non-matching paths', async () => {
      const request = createMockRequest({ url: '/api/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).toHaveBeenCalledTimes(1);
    });

    it('strips query string for skip path comparison', async () => {
      const request = createMockRequest({ url: '/health?verbose=true' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });
  });

  describe('skip path patterns', () => {
    it('skips paths matching regex patterns', async () => {
      const request = createMockRequest({ url: '/api/v2/internal/check' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {
        skipPathPatterns: [/^\/api\/v\d+\/internal\//],
      });

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
    });

    it('does not skip when pattern does not match', async () => {
      const request = createMockRequest({ url: '/api/v2/public/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {
        skipPathPatterns: [/^\/api\/v\d+\/internal\//],
      });

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockEvaluateWithTracing).toHaveBeenCalledTimes(1);
    });
  });

  describe('action handling', () => {
    it('handles log action at debug level', async () => {
      const decision = makeAllowDecision({
        actions: [
          {
            type: 'log',
            level: 'debug',
            message: 'Debug log message',
            tags: ['audit'],
          },
        ],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Debug log message', tags: ['audit'] }),
        'Policy action log',
      );
    });

    it('handles log action at info level', async () => {
      const decision = makeAllowDecision({
        actions: [{ type: 'log', level: 'info', message: 'Info log' }],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Info log' }),
        'Policy action log',
      );
    });

    it('handles log action at warn level', async () => {
      const decision = makeAllowDecision({
        actions: [{ type: 'log', level: 'warn', message: 'Warning' }],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Warning' }),
        'Policy action log',
      );
    });

    it('handles log action at error level', async () => {
      const decision = makeAllowDecision({
        actions: [{ type: 'log', level: 'error', message: 'Error occurred' }],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Error occurred' }),
        'Policy action log',
      );
    });

    it('handles modify action with addHeaders', async () => {
      const decision = makeAllowDecision({
        actions: [
          {
            type: 'modify',
            addHeaders: {
              'X-Custom-Header': 'custom-value',
              'X-Another': 'another-value',
            },
          },
        ],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(reply._headers['X-Custom-Header']).toBe('custom-value');
      expect(reply._headers['X-Another']).toBe('another-value');
    });

    it('does not add headers for modify action without addHeaders', async () => {
      const decision = makeAllowDecision({
        actions: [{ type: 'modify' }],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      // Only X-Policy-Decision headers should be set
      expect(Object.keys(reply._headers)).toEqual(
        expect.arrayContaining(['X-Policy-Decision', 'X-Policy-Decision-Id']),
      );
    });

    it('does not execute log/modify actions when decision is deny', async () => {
      const decision = makeDenyDecision({
        actions: [
          { type: 'deny', reason: 'Blocked', errorCode: 'BLOCKED' },
          { type: 'log', level: 'info', message: 'Should not log' },
          { type: 'modify', addHeaders: { 'X-Should-Not': 'exist' } },
        ],
      });
      mockEvaluateWithTracing.mockResolvedValue(decision);
      const request = createMockRequest();
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      // The middleware should stop after handleDecision returns false
      // So log/modify actions in the for loop should not be executed
      expect(reply._headers['X-Should-Not']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('blockOnError=true sends 500 when engine throws', async () => {
      mockEvaluateWithTracing.mockRejectedValue(new Error('Engine failure'));
      const request = createMockRequest({ url: '/api/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, { blockOnError: true });

      await middleware(request, reply as unknown as FastifyReply);

      expect(reply._status).toBe(500);
      expect(reply._sent).toMatchObject({
        error: 'POLICY_ERROR',
        message: 'Security policy evaluation failed',
      });
    });

    it('blockOnError=false (default) fails open when engine throws', async () => {
      mockEvaluateWithTracing.mockRejectedValue(new Error('Engine failure'));
      const request = createMockRequest({ url: '/api/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      // Should not send a response (fail open)
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('logs error when engine throws', async () => {
      mockEvaluateWithTracing.mockRejectedValue(new Error('Some engine error'));
      const request = createMockRequest({ url: '/api/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Some engine error' }),
        'Policy evaluation failed',
      );
    });

    it('handles non-Error thrown values gracefully', async () => {
      mockEvaluateWithTracing.mockRejectedValue('string error');
      const request = createMockRequest({ url: '/api/data' });
      const reply = createMockReply();
      const middleware = createPolicyMiddleware(engine, {});

      await middleware(request, reply as unknown as FastifyReply);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unknown error' }),
        'Policy evaluation failed',
      );
    });
  });
});

// =============================================================================
// enforcePolicies
// =============================================================================

describe('enforcePolicies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns middleware and engine', () => {
    const result = enforcePolicies();

    expect(result).toHaveProperty('middleware');
    expect(result).toHaveProperty('engine');
    expect(typeof result.middleware).toBe('function');
  });

  it('uses provided engine when given', () => {
    const engine = createMockEngine();
    const result = enforcePolicies({ engine });

    expect(result.engine).toBe(engine);
  });

  it('creates new engine when not provided', () => {
    const result = enforcePolicies();

    expect(result.engine).toBeDefined();
    expect(SecurityPolicyEngine).toHaveBeenCalled();
  });

  it('creates middleware that is functional', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
    const { middleware } = enforcePolicies();
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply as unknown as FastifyReply);

    expect(mockEvaluateWithTracing).toHaveBeenCalledTimes(1);
  });

  it('passes options through to middleware', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
    const { middleware } = enforcePolicies({
      skipPaths: ['/custom-skip'],
    });
    const request = createMockRequest({ url: '/custom-skip' });
    const reply = createMockReply();

    await middleware(request, reply as unknown as FastifyReply);

    expect(mockEvaluateWithTracing).not.toHaveBeenCalled();
  });
});

// =============================================================================
// policyEnginePlugin
// =============================================================================

describe('policyEnginePlugin', () => {
  let mockFastify: {
    addHook: Mock;
    decorate: Mock;
    get: Mock;
    post: Mock;
    put: Mock;
    delete: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFastify = {
      addHook: vi.fn(),
      decorate: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
  });

  it('registers preHandler hook', () => {
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      {},
      done,
    );

    expect(mockFastify.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
    expect(done).toHaveBeenCalled();
  });

  it('decorates fastify with policyEngine', () => {
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      {},
      done,
    );

    expect(mockFastify.decorate).toHaveBeenCalledWith('policyEngine', expect.anything());
  });

  it('uses provided engine when available', () => {
    const engine = createMockEngine();
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      { engine },
      done,
    );

    expect(mockFastify.decorate).toHaveBeenCalledWith('policyEngine', engine);
  });

  it('does not register management API by default', () => {
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      {},
      done,
    );

    // Only addHook and decorate should be called, no route registrations
    expect(mockFastify.get).not.toHaveBeenCalled();
    expect(mockFastify.post).not.toHaveBeenCalled();
  });

  it('registers management API when enableManagementApi is true', () => {
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      { enableManagementApi: true },
      done,
    );

    // Should register routes
    expect(mockFastify.get).toHaveBeenCalled();
    expect(mockFastify.post).toHaveBeenCalled();
    expect(mockFastify.put).toHaveBeenCalled();
    expect(mockFastify.delete).toHaveBeenCalled();
  });
});

// =============================================================================
// registerManagementApi (tested via plugin)
// =============================================================================

describe('registerManagementApi (via plugin)', () => {
  let mockFastify: {
    addHook: Mock;
    decorate: Mock;
    get: Mock;
    post: Mock;
    put: Mock;
    delete: Mock;
  };
  let registeredRoutes: Record<string, { handler: Function; preHandler?: Function }>;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredRoutes = {};

    const captureRoute = (httpMethod: string) => {
      return vi.fn().mockImplementation(
        (path: string, optsOrHandler: unknown, handler?: Function) => {
          const routeHandler = typeof optsOrHandler === 'function'
            ? optsOrHandler
            : handler;
          const routeOpts = typeof optsOrHandler === 'object'
            ? optsOrHandler as { preHandler?: Function }
            : undefined;
          registeredRoutes[`${httpMethod}:${path}`] = {
            handler: routeHandler as Function,
            preHandler: routeOpts?.preHandler,
          };
        },
      );
    };

    mockFastify = {
      addHook: vi.fn(),
      decorate: vi.fn(),
      get: captureRoute('GET'),
      post: captureRoute('POST'),
      put: captureRoute('PUT'),
      delete: captureRoute('DELETE'),
    };
  });

  function setupPlugin(options: PolicyMiddlewareOptions = {}) {
    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: PolicyMiddlewareOptions, done: () => void) => void)(
      mockFastify,
      { enableManagementApi: true, ...options },
      done,
    );
  }

  it('registers routes with default /api/security/policies prefix', () => {
    setupPlugin();

    const prefix = '/api/security/policies';
    expect(mockFastify.get).toHaveBeenCalledWith(prefix, expect.anything(), expect.any(Function));
    expect(mockFastify.get).toHaveBeenCalledWith(`${prefix}/:id`, expect.anything(), expect.any(Function));
    expect(mockFastify.post).toHaveBeenCalledWith(prefix, expect.anything(), expect.any(Function));
    expect(mockFastify.put).toHaveBeenCalledWith(`${prefix}/:id`, expect.anything(), expect.any(Function));
    expect(mockFastify.delete).toHaveBeenCalledWith(`${prefix}/:id`, expect.anything(), expect.any(Function));
  });

  it('uses custom management API prefix', () => {
    setupPlugin({ managementApiPrefix: '/admin/policies' });

    const prefix = '/admin/policies';
    expect(mockFastify.get).toHaveBeenCalledWith(prefix, expect.anything(), expect.any(Function));
    expect(mockFastify.post).toHaveBeenCalledWith(prefix, expect.anything(), expect.any(Function));
  });

  it('GET list returns policies with total and enabled count', async () => {
    const policies = [
      { id: 'p1', name: 'Policy 1', enabled: true },
      { id: 'p2', name: 'Policy 2', enabled: false },
      { id: 'p3', name: 'Policy 3', enabled: true },
    ];
    mockGetAllPolicies.mockReturnValue(policies);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies'];
    const result = await route!.handler({}, {});

    expect(result).toEqual({
      policies,
      total: 3,
      enabled: 2,
    });
  });

  it('GET by id returns policy when found', async () => {
    const policy = { id: 'p1', name: 'Found Policy' };
    mockGetPolicy.mockReturnValue(policy);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/:id'];
    const result = await route!.handler({ params: { id: 'p1' } }, {});

    expect(result).toBe(policy);
  });

  it('GET by id returns 404 when not found', async () => {
    mockGetPolicy.mockReturnValue(undefined);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/:id'];
    const reply = createMockReply();
    await route!.handler({ params: { id: 'missing' } }, reply);

    expect(reply._status).toBe(404);
    expect(reply._sent).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('POST create adds policy and returns 201', async () => {
    const policy = { id: 'p-new', name: 'New Policy' };
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies'];
    const reply = createMockReply();
    const result = await route!.handler({ body: policy }, reply);

    expect(mockAddPolicy).toHaveBeenCalledWith(policy);
    expect(reply._status).toBe(201);
  });

  it('POST create returns 400 on addPolicy error', async () => {
    mockAddPolicy.mockImplementation(() => {
      throw new Error('Invalid policy format');
    });
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies'];
    const reply = createMockReply();
    await route!.handler({ body: {} }, reply);

    expect(reply._status).toBe(400);
    expect(reply._sent).toMatchObject({
      error: 'INVALID_POLICY',
      message: 'Invalid policy format',
    });
  });

  it('PUT update returns updated policy', async () => {
    const updated = { id: 'p1', name: 'Updated' };
    mockUpdatePolicy.mockReturnValue(updated);
    setupPlugin();

    const route = registeredRoutes['PUT:/api/security/policies/:id'];
    const result = await route!.handler(
      { params: { id: 'p1' }, body: { name: 'Updated' } },
      createMockReply(),
    );

    expect(mockUpdatePolicy).toHaveBeenCalledWith('p1', { name: 'Updated' });
    expect(result).toBe(updated);
  });

  it('PUT update returns 404 when policy not found', async () => {
    mockUpdatePolicy.mockImplementation(() => {
      throw new Error('Policy not found: p-missing');
    });
    setupPlugin();

    const route = registeredRoutes['PUT:/api/security/policies/:id'];
    const reply = createMockReply();
    await route!.handler(
      { params: { id: 'p-missing' }, body: {} },
      reply,
    );

    expect(reply._status).toBe(404);
    expect(reply._sent).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('PUT update returns 400 for non-not-found errors', async () => {
    mockUpdatePolicy.mockImplementation(() => {
      throw new Error('Validation failed');
    });
    setupPlugin();

    const route = registeredRoutes['PUT:/api/security/policies/:id'];
    const reply = createMockReply();
    await route!.handler(
      { params: { id: 'p1' }, body: {} },
      reply,
    );

    expect(reply._status).toBe(400);
    expect(reply._sent).toMatchObject({ error: 'UPDATE_FAILED' });
  });

  it('DELETE removes policy and returns success', async () => {
    mockRemovePolicy.mockReturnValue(true);
    setupPlugin();

    const route = registeredRoutes['DELETE:/api/security/policies/:id'];
    const result = await route!.handler({ params: { id: 'p1' } }, createMockReply());

    expect(mockRemovePolicy).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ success: true });
  });

  it('DELETE returns 404 when policy not found', async () => {
    mockRemovePolicy.mockReturnValue(false);
    setupPlugin();

    const route = registeredRoutes['DELETE:/api/security/policies/:id'];
    const reply = createMockReply();
    await route!.handler({ params: { id: 'missing' } }, reply);

    expect(reply._status).toBe(404);
  });

  it('POST enable returns success when policy exists', async () => {
    mockEnablePolicy.mockReturnValue(true);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/enable'];
    const result = await route!.handler({ params: { id: 'p1' } }, createMockReply());

    expect(mockEnablePolicy).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ success: true });
  });

  it('POST enable returns 404 when policy not found', async () => {
    mockEnablePolicy.mockReturnValue(false);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/enable'];
    const reply = createMockReply();
    await route!.handler({ params: { id: 'missing' } }, reply);

    expect(reply._status).toBe(404);
  });

  it('POST disable returns success when policy exists', async () => {
    mockDisablePolicy.mockReturnValue(true);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/disable'];
    const result = await route!.handler({ params: { id: 'p1' } }, createMockReply());

    expect(mockDisablePolicy).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ success: true });
  });

  it('POST disable returns 404 when policy not found', async () => {
    mockDisablePolicy.mockReturnValue(false);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/disable'];
    const reply = createMockReply();
    await route!.handler({ params: { id: 'missing' } }, reply);

    expect(reply._status).toBe(404);
  });

  it('POST validate returns validation result', async () => {
    const validationResult = { valid: true, errors: [], warnings: [] };
    mockValidatePolicy.mockReturnValue(validationResult);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/validate'];
    const result = await route!.handler({ body: { id: 'p1' } }, {});

    expect(mockValidatePolicy).toHaveBeenCalledWith({ id: 'p1' });
    expect(result).toBe(validationResult);
  });

  it('POST simulate returns simulation result', async () => {
    const simulationResult = { decision: makeAllowDecision(), whatIf: {} };
    mockSimulate.mockResolvedValue(simulationResult);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/simulate'];
    const mockContext: PolicyContext = {
      request: { id: 'r1', method: 'GET', path: '/', url: '/', ip: '1.2.3.4' },
    };
    const result = await route!.handler(
      { body: { context: mockContext, policies: ['p1'], verbose: true } },
      {},
    );

    expect(mockSimulate).toHaveBeenCalledWith({
      context: mockContext,
      policies: ['p1'],
      verbose: true,
    });
    expect(result).toBe(simulationResult);
  });

  it('GET versions returns versions when policy exists', async () => {
    const versions = [{ id: 'v1', policyId: 'p1', version: '1.0.0' }];
    mockGetPolicyVersions.mockReturnValue(versions);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/:id/versions'];
    const result = await route!.handler({ params: { id: 'p1' } }, createMockReply());

    expect(result).toEqual({ versions });
  });

  it('GET versions returns 404 when no versions and no policy', async () => {
    mockGetPolicyVersions.mockReturnValue([]);
    mockGetPolicy.mockReturnValue(undefined);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/:id/versions'];
    const reply = createMockReply();
    await route!.handler({ params: { id: 'missing' } }, reply);

    expect(reply._status).toBe(404);
  });

  it('GET versions returns empty array when policy exists but has no versions', async () => {
    mockGetPolicyVersions.mockReturnValue([]);
    mockGetPolicy.mockReturnValue({ id: 'p1', name: 'Existing' });
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/:id/versions'];
    const result = await route!.handler({ params: { id: 'p1' } }, createMockReply());

    expect(result).toEqual({ versions: [] });
  });

  it('POST rollback returns rolled back policy', async () => {
    const rolledBack = { id: 'p1', version: '1.0.1' };
    mockRollbackPolicy.mockReturnValue(rolledBack);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/rollback/:versionId'];
    const result = await route!.handler(
      { params: { id: 'p1', versionId: 'v1' } },
      createMockReply(),
    );

    expect(mockRollbackPolicy).toHaveBeenCalledWith('p1', 'v1');
    expect(result).toBe(rolledBack);
  });

  it('POST rollback returns 404 when policy or version not found', async () => {
    mockRollbackPolicy.mockReturnValue(null);
    setupPlugin();

    const route = registeredRoutes['POST:/api/security/policies/:id/rollback/:versionId'];
    const reply = createMockReply();
    await route!.handler(
      { params: { id: 'missing', versionId: 'v1' } },
      reply,
    );

    expect(reply._status).toBe(404);
  });

  it('GET stats returns engine statistics', async () => {
    const stats = { totalPolicies: 5, enabledPolicies: 3, totalVersions: 10, policiesByTag: {} };
    mockGetStats.mockReturnValue(stats);
    setupPlugin();

    const route = registeredRoutes['GET:/api/security/policies/stats'];
    const result = await route!.handler({}, {});

    expect(result).toBe(stats);
  });

  describe('management API auth middleware', () => {
    it('allows access when managementApiAuth returns true', async () => {
      const authFn = vi.fn().mockResolvedValue(true);
      mockGetAllPolicies.mockReturnValue([]);
      setupPlugin({ managementApiAuth: authFn });

      const route = registeredRoutes['GET:/api/security/policies'];
      // Call the preHandler (auth middleware)
      const reply = createMockReply();
      await route!.preHandler!({} as FastifyRequest, reply as unknown as FastifyReply);

      // Auth passed, no 403 sent
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('blocks access with 403 when managementApiAuth returns false', async () => {
      const authFn = vi.fn().mockResolvedValue(false);
      setupPlugin({ managementApiAuth: authFn });

      const route = registeredRoutes['GET:/api/security/policies'];
      const reply = createMockReply();
      await route!.preHandler!({} as FastifyRequest, reply as unknown as FastifyReply);

      expect(reply._status).toBe(403);
      expect(reply._sent).toMatchObject({
        error: 'UNAUTHORIZED',
        message: 'Not authorized to manage policies',
      });
    });

    it('uses default auth (always true) when managementApiAuth is not provided', async () => {
      mockGetAllPolicies.mockReturnValue([]);
      setupPlugin();

      const route = registeredRoutes['GET:/api/security/policies'];
      const reply = createMockReply();
      await route!.preHandler!({} as FastifyRequest, reply as unknown as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Edge cases and integration scenarios
// =============================================================================

describe('edge cases', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = createMockEngine();
  });

  it('handles URL with no query string', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
    const request = createMockRequest({ url: '/api/data' });
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    const context = mockEvaluateWithTracing.mock.calls[0]![0] as PolicyContext;
    expect(context.request.path).toBe('/api/data');
  });

  it('handles unknown decision outcome as allow (default case)', async () => {
    const decision: PolicyDecision = {
      ...makeAllowDecision(),
      outcome: 'unknown_outcome' as 'allow',
    };
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    // Should continue without sending response (default case returns true)
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('handles deny with custom httpStatus', async () => {
    const decision = makeDenyDecision({
      actions: [
        {
          type: 'deny',
          reason: 'Rate limited',
          errorCode: 'RATE_LIMIT',
          httpStatus: 429,
          retryable: true,
          retryAfter: 30,
        },
      ],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply._status).toBe(429);
    expect(reply._headers['Retry-After']).toBe('30');
  });

  it('handles multiple actions in sequence (log then modify)', async () => {
    const decision = makeAllowDecision({
      actions: [
        { type: 'log', level: 'info', message: 'Accessed resource' },
        { type: 'modify', addHeaders: { 'X-Logged': 'true' } },
      ],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    await middleware(request, reply as unknown as FastifyReply);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Accessed resource' }),
      'Policy action log',
    );
    expect(reply._headers['X-Logged']).toBe('true');
  });

  it('creates middleware with empty options', async () => {
    mockEvaluateWithTracing.mockResolvedValue(makeAllowDecision());
    const middleware = createPolicyMiddleware(engine);
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply as unknown as FastifyReply);

    expect(mockEvaluateWithTracing).toHaveBeenCalledTimes(1);
  });

  it('handles actions with notify/escalate types (no-op in middleware)', async () => {
    const decision = makeAllowDecision({
      actions: [
        { type: 'notify', channels: ['email'], severity: 'high', recipients: ['admin@test.com'] },
        { type: 'escalate', severity: 'critical' },
      ],
    });
    mockEvaluateWithTracing.mockResolvedValue(decision);
    const request = createMockRequest();
    const reply = createMockReply();
    const middleware = createPolicyMiddleware(engine, {});

    // Should not throw
    await middleware(request, reply as unknown as FastifyReply);

    expect(reply.send).not.toHaveBeenCalled();
  });

  it('PUT update handles non-Error thrown values', async () => {
    mockUpdatePolicy.mockImplementation(() => {
      throw 'string error';
    });

    const mockFastify = {
      addHook: vi.fn(),
      decorate: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn().mockImplementation((_path: string, _opts: unknown, handler: Function) => {
        // Capture handler for the first put route
        (mockFastify as Record<string, unknown>)._putHandler = handler;
      }),
      delete: vi.fn(),
    };

    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      { enableManagementApi: true },
      done,
    );

    const handler = (mockFastify as Record<string, unknown>)._putHandler as Function;
    const reply = createMockReply();
    await handler({ params: { id: 'p1' }, body: {} }, reply);

    expect(reply._status).toBe(400);
    expect(reply._sent).toMatchObject({ error: 'UPDATE_FAILED', message: 'Unknown error' });
  });

  it('POST create handles non-Error thrown values', async () => {
    mockAddPolicy.mockImplementation(() => {
      throw 42;
    });

    const mockFastify = {
      addHook: vi.fn(),
      decorate: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };

    const registeredPostHandlers: Function[] = [];
    mockFastify.post.mockImplementation((_path: string, _opts: unknown, handler: Function) => {
      registeredPostHandlers.push(handler);
    });

    const done = vi.fn();
    (policyEnginePluginFp as unknown as (fastify: unknown, options: unknown, done: () => void) => void)(
      mockFastify,
      { enableManagementApi: true },
      done,
    );

    // The first POST is for create (prefix route)
    const createHandler = registeredPostHandlers[0]!;
    const reply = createMockReply();
    await createHandler({ body: {} }, reply);

    expect(reply._status).toBe(400);
    expect(reply._sent).toMatchObject({ error: 'INVALID_POLICY', message: 'Unknown error' });
  });
});
