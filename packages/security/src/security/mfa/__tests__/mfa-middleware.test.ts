/**
 * MFA Middleware Tests
 *
 * Tests for requireMfa, mfaContextMiddleware, requireMfaEnabled,
 * and helper extract functions.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetMfaStatus = vi.fn();
const mockRequiresMfa = vi.fn();

vi.mock('../mfa-service.js', () => ({
  getMfaService: vi.fn(() => ({
    getMfaStatus: mockGetMfaStatus,
    requiresMfa: mockRequiresMfa,
  })),
  MfaService: vi.fn(),
}));

import {
  requireMfa,
  mfaContextMiddleware,
  requireMfaEnabled,
} from '../mfa-middleware.js';
import { UnauthorizedError } from '../../../common/errors.js';

// =============================================================================
// Helpers
// =============================================================================

function createMockRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    url: '/api/v1/resource',
    routeOptions: { url: '/api/v1/resource' },
    id: 'req-123',
    headers: {},
    user: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      jti: 'session-1',
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

function createMockReply(): FastifyReply {
  const reply: Record<string, unknown> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply as unknown as FastifyReply;
}

// =============================================================================
// Tests
// =============================================================================

describe('mfa-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // requireMfa
  // ===========================================================================
  describe('requireMfa', () => {
    it('should skip configured paths matching routeOptions.url', async () => {
      const middleware = requireMfa({ skipPaths: ['/health'] });
      const request = createMockRequest({
        url: '/health',
        routeOptions: { url: '/health' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should skip configured paths matching request.url', async () => {
      const middleware = requireMfa({ skipPaths: ['/health'] });
      const request = createMockRequest({
        url: '/health',
        routeOptions: { url: '/different' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should skip when userId is missing', async () => {
      const middleware = requireMfa();
      const request = createMockRequest({ user: {} });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should skip when tenantId is missing', async () => {
      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should skip when sessionId is missing (no user, no header, no request.id)', async () => {
      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-1' },
        id: undefined,
        headers: {},
      });
      const reply = createMockReply();

      // sessionId falls back to request.id; if id is undefined, sessionId is undefined
      await middleware(request, reply, vi.fn());

      // Even though user has sub/tenantId, sessionId may be falsy
      // Actually request.id will be undefined, which is falsy
      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should proceed when MFA is not enabled', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: false,
        inGracePeriod: false,
      });

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).not.toHaveBeenCalled();
      expect((request as any).mfaContext).toEqual({
        mfaRequired: false,
        mfaVerified: false,
        inGracePeriod: false,
      });
    });

    it('should proceed when in grace period and allowGracePeriod is true (default)', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: true,
      });

      const middleware = requireMfa(); // allowGracePeriod defaults to true
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).not.toHaveBeenCalled();
      expect((request as any).mfaContext.inGracePeriod).toBe(true);
    });

    it('should block when in grace period and allowGracePeriod is false', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: true,
      });
      mockRequiresMfa.mockResolvedValue(true);

      const middleware = requireMfa({ allowGracePeriod: false });
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).toHaveBeenCalledWith(403);
      expect((reply.send as Mock)).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'MFA_REQUIRED',
          }),
        })
      );
    });

    it('should proceed when session is already verified (requiresMfa returns false)', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).not.toHaveBeenCalled();
      expect((request as any).mfaContext.mfaVerified).toBe(true);
    });

    it('should return 403 MFA_REQUIRED when MFA is needed and not verified', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(true);

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).toHaveBeenCalledWith(403);
      expect((reply.send as Mock)).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'MFA_REQUIRED',
            message: 'Multi-factor authentication is required',
            details: expect.objectContaining({
              mfaEnabled: true,
              mfaVerified: false,
              challengeEndpoint: '/api/v1/mfa/challenge',
            }),
          }),
          meta: expect.objectContaining({
            requestId: 'req-123',
          }),
        })
      );
    });

    it('should re-throw errors from getMfaStatus', async () => {
      const serviceError = new Error('Database connection failed');
      mockGetMfaStatus.mockRejectedValue(serviceError);

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await expect(middleware(request, reply, vi.fn())).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should set mfaContext.mfaRequired=true when MFA is enabled', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(true);

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((request as any).mfaContext.mfaRequired).toBe(true);
    });

    it('should include timestamp in meta of 403 response', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(true);

      const middleware = requireMfa();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      const sendCall = (reply.send as Mock).mock.calls[0][0];
      expect(sendCall.meta.timestamp).toBeDefined();
      expect(typeof sendCall.meta.timestamp).toBe('string');
    });

    it('should use routeOptions.url for path matching over request.url', async () => {
      const middleware = requireMfa({ skipPaths: ['/api/skip'] });
      const request = createMockRequest({
        url: '/api/not-skip',
        routeOptions: { url: '/api/skip' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should fall back to request.url when routeOptions.url is null', async () => {
      const middleware = requireMfa({ skipPaths: ['/api/v1/resource'] });
      const request = createMockRequest({
        routeOptions: { url: null },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should handle multiple skipPaths', async () => {
      const middleware = requireMfa({
        skipPaths: ['/health', '/ready', '/api/v1/mfa/challenge'],
      });
      const request = createMockRequest({
        url: '/ready',
        routeOptions: { url: '/ready' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // mfaContextMiddleware
  // ===========================================================================
  describe('mfaContextMiddleware', () => {
    it('should set default context (all false) when no user info', async () => {
      const middleware = mfaContextMiddleware();
      const request = createMockRequest({ user: undefined });

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: false,
        mfaVerified: false,
        inGracePeriod: false,
      });
    });

    it('should skip configured paths', async () => {
      const middleware = mfaContextMiddleware({ skipPaths: ['/health'] });
      const request = createMockRequest({
        url: '/health',
        routeOptions: { url: '/health' },
      });

      await middleware(request, createMockReply(), vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should set correct context for enabled MFA with verified session', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = mfaContextMiddleware();
      const request = createMockRequest();

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: true,
        mfaVerified: true,
        inGracePeriod: false,
      });
    });

    it('should set mfaVerified=false when MFA enabled but not verified', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: false,
      });
      mockRequiresMfa.mockResolvedValue(true);

      const middleware = mfaContextMiddleware();
      const request = createMockRequest();

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: true,
        mfaVerified: false,
        inGracePeriod: false,
      });
    });

    it('should set mfaVerified=true when MFA is not enabled', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: false,
        inGracePeriod: false,
      });

      const middleware = mfaContextMiddleware();
      const request = createMockRequest();

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: false,
        mfaVerified: true,
        inGracePeriod: false,
      });
    });

    it('should handle errors silently and keep defaults', async () => {
      mockGetMfaStatus.mockRejectedValue(new Error('DB failure'));

      const middleware = mfaContextMiddleware();
      const request = createMockRequest();

      // Should NOT throw
      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: false,
        mfaVerified: false,
        inGracePeriod: false,
      });
    });

    it('should set inGracePeriod=true when status indicates grace period', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
        inGracePeriod: true,
      });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = mfaContextMiddleware();
      const request = createMockRequest();

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext.inGracePeriod).toBe(true);
    });

    it('should set default context when userId missing', async () => {
      const middleware = mfaContextMiddleware();
      const request = createMockRequest({ user: {} });

      await middleware(request, createMockReply(), vi.fn());

      expect((request as any).mfaContext).toEqual({
        mfaRequired: false,
        mfaVerified: false,
        inGracePeriod: false,
      });
      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });

    it('should skip path matching using request.url as fallback', async () => {
      const middleware = mfaContextMiddleware({ skipPaths: ['/api/skip'] });
      const request = createMockRequest({
        url: '/api/skip',
        routeOptions: { url: '/other' },
      });

      await middleware(request, createMockReply(), vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // requireMfaEnabled
  // ===========================================================================
  describe('requireMfaEnabled', () => {
    it('should throw UnauthorizedError when no userId', async () => {
      const middleware = requireMfaEnabled();
      const request = createMockRequest({ user: {} });
      const reply = createMockReply();

      await expect(middleware(request, reply, vi.fn())).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('should throw UnauthorizedError when no tenantId', async () => {
      const middleware = requireMfaEnabled();
      const request = createMockRequest({
        user: { sub: 'user-1' },
      });
      const reply = createMockReply();

      await expect(middleware(request, reply, vi.fn())).rejects.toThrow(
        'Authentication required'
      );
    });

    it('should return 403 MFA_NOT_ENABLED when MFA is disabled', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: false,
      });

      const middleware = requireMfaEnabled();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).toHaveBeenCalledWith(403);
      expect((reply.send as Mock)).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'MFA_NOT_ENABLED',
            message: 'Multi-factor authentication must be enabled to access this resource',
            details: expect.objectContaining({
              enrollmentEndpoint: '/api/v1/mfa/enroll',
            }),
          }),
        })
      );
    });

    it('should proceed (no reply) when MFA is enabled', async () => {
      mockGetMfaStatus.mockResolvedValue({
        enabled: true,
      });

      const middleware = requireMfaEnabled();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect((reply.status as Mock)).not.toHaveBeenCalled();
    });

    it('should skip configured paths', async () => {
      const middleware = requireMfaEnabled({ skipPaths: ['/health'] });
      const request = createMockRequest({
        url: '/health',
        routeOptions: { url: '/health' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).not.toHaveBeenCalled();
      expect((reply.status as Mock)).not.toHaveBeenCalled();
    });

    it('should include requestId and timestamp in 403 response meta', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false });

      const middleware = requireMfaEnabled();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      const sendCall = (reply.send as Mock).mock.calls[0][0];
      expect(sendCall.meta.requestId).toBe('req-123');
      expect(sendCall.meta.timestamp).toBeDefined();
    });

    it('should throw UnauthorizedError when both userId and tenantId missing', async () => {
      const middleware = requireMfaEnabled();
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      await expect(middleware(request, reply, vi.fn())).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  // ===========================================================================
  // extractUserId
  // ===========================================================================
  describe('extractUserId', () => {
    it('should use custom extractor when provided', async () => {
      const customExtractor = vi.fn().mockReturnValue('custom-user-id');
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa({
        extractUserId: customExtractor,
      });
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-1', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(customExtractor).toHaveBeenCalledWith(request);
      expect(mockGetMfaStatus).toHaveBeenCalledWith('custom-user-id', 'tenant-1');
    });

    it('should fall back to request.user.sub', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-from-sub', tenantId: 'tenant-1', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-from-sub', 'tenant-1');
    });

    it('should fall back to request.user.userId when sub is absent', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { userId: 'user-from-userId', tenantId: 'tenant-1', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-from-userId', 'tenant-1');
    });

    it('should fall back to request.user.id when sub and userId are absent', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { id: 'user-from-id', tenantId: 'tenant-1', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-from-id', 'tenant-1');
    });
  });

  // ===========================================================================
  // extractTenantId
  // ===========================================================================
  describe('extractTenantId', () => {
    it('should use custom extractor when provided', async () => {
      const customExtractor = vi.fn().mockReturnValue('custom-tenant');
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa({
        extractTenantId: customExtractor,
      });
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'original-tenant', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(customExtractor).toHaveBeenCalledWith(request);
      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-1', 'custom-tenant');
    });

    it('should fall back to request.user.tenantId', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-from-tenantId', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-1', 'tenant-from-tenantId');
    });

    it('should fall back to request.user.tenant_id when tenantId is absent', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: false, inGracePeriod: false });

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenant_id: 'tenant-from-tenant_id', jti: 'session-1' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockGetMfaStatus).toHaveBeenCalledWith('user-1', 'tenant-from-tenant_id');
    });
  });

  // ===========================================================================
  // extractSessionId
  // ===========================================================================
  describe('extractSessionId', () => {
    it('should use custom extractor when provided', async () => {
      const customExtractor = vi.fn().mockReturnValue('custom-session');
      mockGetMfaStatus.mockResolvedValue({ enabled: true, inGracePeriod: false });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = requireMfa({
        extractSessionId: customExtractor,
      });
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(customExtractor).toHaveBeenCalledWith(request);
      expect(mockRequiresMfa).toHaveBeenCalledWith('user-1', 'tenant-1', 'custom-session');
    });

    it('should try user.jti first', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: true, inGracePeriod: false });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-1', jti: 'jwt-session-id' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockRequiresMfa).toHaveBeenCalledWith('user-1', 'tenant-1', 'jwt-session-id');
    });

    it('should try x-session-id header when jti is absent', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: true, inGracePeriod: false });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-1' },
        headers: { 'x-session-id': 'header-session-id' },
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockRequiresMfa).toHaveBeenCalledWith('user-1', 'tenant-1', 'header-session-id');
    });

    it('should fall back to request.id when jti and x-session-id are absent', async () => {
      mockGetMfaStatus.mockResolvedValue({ enabled: true, inGracePeriod: false });
      mockRequiresMfa.mockResolvedValue(false);

      const middleware = requireMfa();
      const request = createMockRequest({
        user: { sub: 'user-1', tenantId: 'tenant-1' },
        headers: {},
        id: 'fallback-req-id',
      });
      const reply = createMockReply();

      await middleware(request, reply, vi.fn());

      expect(mockRequiresMfa).toHaveBeenCalledWith('user-1', 'tenant-1', 'fallback-req-id');
    });
  });
});
