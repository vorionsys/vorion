/**
 * Security Middleware Tests
 *
 * Tests for Fastify security middleware including:
 * - Trust tier enforcement
 * - Authentication flow
 * - Authorization checks
 * - DPoP middleware
 * - Introspection middleware
 * - Revocation middleware
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  dpopMiddleware,
  introspectionMiddleware,
  revocationMiddleware,
  securityContextMiddleware,
  markHighValueOperation,
  requireTier,
} from '../../../src/security/middleware.js';
import { createDPoPService, DPoPService } from '../../../src/security/dpop.js';
import { createTokenIntrospectionService, TokenIntrospectionService } from '../../../src/security/introspection.js';
import { createRevocationService, RevocationService } from '../../../src/security/revocation.js';
import { createSecurityService, SecurityService } from '../../../src/security/security-service.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { TEST_TENANT_ID, TEST_USER_ID, createMockUser } from '../../helpers/tenant-context.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../src/intent/metrics.js', () => ({
  intentRegistry: {
    registerMetric: vi.fn(),
  },
}));

// Mock security audit logger to avoid tenant ID requirement in tests
vi.mock('../../../src/audit/security-logger.js', () => ({
  getSecurityAuditLogger: vi.fn(() => ({
    log: vi.fn().mockResolvedValue({}),
    logAccessGranted: vi.fn().mockResolvedValue({}),
    logAccessDenied: vi.fn().mockResolvedValue({}),
    logDpopVerification: vi.fn().mockResolvedValue({}),
    logAuthAttempt: vi.fn().mockResolvedValue({}),
    setRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
  })),
  SecurityAuditLogger: vi.fn().mockImplementation(() => ({
    log: vi.fn().mockResolvedValue({}),
    logAccessGranted: vi.fn().mockResolvedValue({}),
    logAccessDenied: vi.fn().mockResolvedValue({}),
    logDpopVerification: vi.fn().mockResolvedValue({}),
    logAuthAttempt: vi.fn().mockResolvedValue({}),
    setRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
  })),
}));

describe('Security Middleware', () => {
  // Mock request and reply with tenant context support
  const createMockRequest = (overrides: Partial<FastifyRequest> & { user?: Record<string, unknown> } = {}): FastifyRequest => {
    const { user, ...rest } = overrides;
    return {
      url: '/api/v1/resource',
      method: 'GET',
      protocol: 'https',
      hostname: 'api.example.com',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'TestAgent/1.0',
      },
      routeOptions: { url: '/api/v1/resource' },
      securityContext: undefined,
      // Include user with tenant context by default for security audit logging
      user: user ?? createMockUser(),
      ...rest,
    } as unknown as FastifyRequest;
  };

  const createMockReply = (): FastifyReply & { statusValue?: number; sentValue?: unknown } => {
    const reply = {
      statusValue: undefined as number | undefined,
      sentValue: undefined as unknown,
      status: vi.fn().mockImplementation(function(code: number) {
        (this as typeof reply).statusValue = code;
        return this;
      }),
      send: vi.fn().mockImplementation(function(body: unknown) {
        (this as typeof reply).sentValue = body;
        return this;
      }),
    };
    return reply as unknown as FastifyReply & { statusValue?: number; sentValue?: unknown };
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Trust Tier Enforcement', () => {
    it('should allow request when trust tier meets requirement', async () => {
      const middleware = requireTier(2);
      const request = createMockRequest();
      request.securityContext = {
        trustTier: 3,
        requirements: { tier: 3 },
      } as FastifyRequest['securityContext'];

      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject request when trust tier is insufficient', async () => {
      const middleware = requireTier(4);
      const request = createMockRequest();
      request.securityContext = {
        trustTier: 2,
        requirements: { tier: 2 },
      } as FastifyRequest['securityContext'];

      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.sentValue).toMatchObject({
        error: {
          code: 'INSUFFICIENT_TRUST_TIER',
          requiredTier: 4,
          currentTier: 2,
        },
      });
    });

    it('should default to tier 0 when no security context', async () => {
      const middleware = requireTier(1);
      const request = createMockRequest();

      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Authentication Flow', () => {
    let securityService: SecurityService;

    beforeEach(() => {
      securityService = createSecurityService({});
    });

    it('should initialize security context', async () => {
      const middleware = securityContextMiddleware(securityService, {});
      const request = createMockRequest();
      (request as { user?: { trustTier: number; did: string } }).user = {
        trustTier: 3,
        did: 'did:car:agent-123',
      };

      await middleware(request, createMockReply());

      expect(request.securityContext).toBeDefined();
      expect(request.securityContext!.trustTier).toBe(3);
      expect(request.securityContext!.agentDid).toBe('did:car:agent-123');
    });

    it('should skip paths in skipPaths list', async () => {
      const middleware = securityContextMiddleware(securityService, {
        skipPaths: ['/health', '/metrics'],
      });

      const request = createMockRequest({ url: '/health' });
      request.routeOptions = { url: '/health' } as FastifyRequest['routeOptions'];

      await middleware(request, createMockReply());

      expect(request.securityContext).toBeUndefined();
    });

    it('should mark high-value operations', async () => {
      const middleware = securityContextMiddleware(securityService, {
        highValuePaths: ['/api/v1/financial'],
      });

      const request = createMockRequest({ url: '/api/v1/financial' });
      request.routeOptions = { url: '/api/v1/financial' } as FastifyRequest['routeOptions'];
      (request as { user?: { trustTier: number } }).user = { trustTier: 2 };

      await middleware(request, createMockReply());

      expect(request.securityContext!.isHighValueOperation).toBe(true);
    });

    it('should use custom tier extractor', async () => {
      const middleware = securityContextMiddleware(securityService, {
        extractTier: () => 4,
      });

      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext!.trustTier).toBe(4);
    });

    it('should use custom agent DID extractor', async () => {
      const middleware = securityContextMiddleware(securityService, {
        extractAgentDid: () => 'did:custom:agent-456',
      });

      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext!.agentDid).toBe('did:custom:agent-456');
    });
  });

  describe('Authorization Checks', () => {
    describe('DPoP Middleware', () => {
      let dpopService: DPoPService;

      beforeEach(() => {
        dpopService = createDPoPService({
          requiredForTiers: [2, 3, 4, 5],
        });
      });

      it('should skip DPoP for tiers that do not require it', async () => {
        const middleware = dpopMiddleware(dpopService, {});
        const request = createMockRequest();
        request.securityContext = {
          trustTier: 1,
          requirements: { tier: 1, dpopRequired: false },
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });

      it('should require DPoP header for T2+ tiers', async () => {
        const middleware = dpopMiddleware(dpopService, {});
        const request = createMockRequest();
        request.securityContext = {
          trustTier: 2,
          requirements: { tier: 2, dpopRequired: true },
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.sentValue).toMatchObject({
          error: {
            code: 'DPOP_REQUIRED',
          },
        });
      });

      it('should skip paths in skipPaths list', async () => {
        const middleware = dpopMiddleware(dpopService, {
          skipPaths: ['/health'],
        });

        const request = createMockRequest({ url: '/health' });
        request.routeOptions = { url: '/health' } as FastifyRequest['routeOptions'];
        request.securityContext = {
          trustTier: 4,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });
    });

    describe('Introspection Middleware', () => {
      let introspectionService: TokenIntrospectionService;

      beforeEach(() => {
        introspectionService = createTokenIntrospectionService(
          'https://auth.example.com/introspect'
        );
      });

      it('should skip introspection for low tiers', async () => {
        const middleware = introspectionMiddleware(introspectionService, {});
        const request = createMockRequest();
        request.securityContext = {
          trustTier: 1,
          isHighValueOperation: false,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });

      it('should require Bearer token for T4+ tiers', async () => {
        const middleware = introspectionMiddleware(introspectionService, {});
        const request = createMockRequest({
          headers: {},
        });
        request.securityContext = {
          trustTier: 4,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.sentValue).toMatchObject({
          error: {
            code: 'MISSING_TOKEN',
          },
        });
      });

      it('should require introspection for high-value T2+ operations', async () => {
        const middleware = introspectionMiddleware(introspectionService, {});
        const request = createMockRequest({
          headers: {},
        });
        request.securityContext = {
          trustTier: 2,
          isHighValueOperation: true,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
      });

      it('should skip paths in skipPaths list', async () => {
        const middleware = introspectionMiddleware(introspectionService, {
          skipPaths: ['/metrics'],
        });

        const request = createMockRequest({ url: '/metrics' });
        request.routeOptions = { url: '/metrics' } as FastifyRequest['routeOptions'];
        request.securityContext = {
          trustTier: 5,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });
    });

    describe('Revocation Middleware', () => {
      let revocationService: RevocationService;

      beforeEach(() => {
        revocationService = createRevocationService();
      });

      it('should skip if no agent DID in context', async () => {
        const middleware = revocationMiddleware(revocationService, {});
        const request = createMockRequest();
        request.securityContext = {
          trustTier: 4,
          agentDid: undefined,
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });

      it('should skip paths in skipPaths list', async () => {
        const middleware = revocationMiddleware(revocationService, {
          skipPaths: ['/health'],
        });

        const request = createMockRequest({ url: '/health' });
        request.routeOptions = { url: '/health' } as FastifyRequest['routeOptions'];
        request.securityContext = {
          trustTier: 4,
          agentDid: 'did:car:agent-123',
        } as FastifyRequest['securityContext'];

        const reply = createMockReply();

        await middleware(request, reply);

        expect(reply.status).not.toHaveBeenCalled();
      });
    });
  });

  describe('High-Value Operation Marker', () => {
    it('should mark operation as high-value', async () => {
      const middleware = markHighValueOperation();
      const request = createMockRequest();
      request.securityContext = {
        trustTier: 2,
        isHighValueOperation: false,
      } as FastifyRequest['securityContext'];

      await middleware(request, createMockReply());

      expect(request.securityContext!.isHighValueOperation).toBe(true);
    });

    it('should do nothing if no security context', async () => {
      const middleware = markHighValueOperation();
      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle DPoP errors gracefully', async () => {
      const dpopService = createDPoPService({});
      const middleware = dpopMiddleware(dpopService, {});

      const request = createMockRequest({
        headers: { dpop: 'invalid-token' },
      });
      request.securityContext = {
        trustTier: 3,
      } as FastifyRequest['securityContext'];

      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Security Requirements', () => {
    let securityService: SecurityService;

    beforeEach(() => {
      securityService = createSecurityService({});
    });

    it('should set correct requirements for T2', async () => {
      const middleware = securityContextMiddleware(securityService, {
        extractTier: () => 2,
      });

      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext!.requirements.dpopRequired).toBe(true);
      expect(request.securityContext!.requirements.teeRequired).toBe(false);
      expect(request.securityContext!.requirements.pairwiseRequired).toBe(false);
    });

    it('should set correct requirements for T3', async () => {
      const middleware = securityContextMiddleware(securityService, {
        extractTier: () => 3,
      });

      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext!.requirements.dpopRequired).toBe(true);
      expect(request.securityContext!.requirements.teeRequired).toBe(false);
      expect(request.securityContext!.requirements.pairwiseRequired).toBe(true);
    });

    it('should set correct requirements for T4', async () => {
      const middleware = securityContextMiddleware(securityService, {
        extractTier: () => 4,
      });

      const request = createMockRequest();

      await middleware(request, createMockReply());

      expect(request.securityContext!.requirements.dpopRequired).toBe(true);
      expect(request.securityContext!.requirements.teeRequired).toBe(true);
      expect(request.securityContext!.requirements.pairwiseRequired).toBe(true);
      expect(request.securityContext!.requirements.syncRevocationRequired).toBe(true);
    });
  });
});
