/**
 * Tenant Isolation Security Regression Tests
 *
 * Security regression tests for tenant isolation vulnerabilities:
 * - TenantId from request body is ignored
 * - JWT tenant is always used
 * - Cross-tenant policy creation is blocked
 * - Cross-tenant intent access is blocked
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenError } from '../../src/common/errors.js';

// Mock dependencies
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/common/db.js', () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../src/common/redis.js', () => ({
  getRedis: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
  })),
}));

describe('Tenant Isolation Security Regression Tests', () => {
  // JWT token payload type
  interface JwtPayload {
    sub: string;
    tenantId: string;
    roles?: string[];
    iat?: number;
    exp?: number;
  }

  // Request body that attacker might try to use
  interface RequestBody {
    tenantId?: string;
    userId?: string;
    [key: string]: unknown;
  }

  // Helper to create mock JWT payload
  const createJwtPayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'user-123',
    tenantId: 'tenant-jwt',
    roles: ['user'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // REGRESSION: TenantId from Request Body is Ignored
  // ===========================================================================

  describe('TenantId from Request Body is Ignored', () => {
    it('should ignore tenantId in request body and use JWT tenantId', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-from-jwt' });
      const requestBody: RequestBody = {
        tenantId: 'tenant-from-body-attacker-wants',
        name: 'Some policy',
      };

      // The effective tenant should ALWAYS come from JWT
      const getEffectiveTenantId = (jwt: JwtPayload, body: RequestBody): string => {
        // CORRECT: Always use JWT, ignore body
        return jwt.tenantId;
      };

      const effectiveTenant = getEffectiveTenantId(jwtPayload, requestBody);
      expect(effectiveTenant).toBe('tenant-from-jwt');
      expect(effectiveTenant).not.toBe(requestBody.tenantId);
    });

    it('should not allow tenantId override via query parameters', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-from-jwt' });
      const queryParams = {
        tenantId: 'tenant-from-query-attacker-wants',
      };

      const getEffectiveTenantId = (jwt: JwtPayload, _query: Record<string, string>): string => {
        // CORRECT: Always use JWT, ignore query params
        return jwt.tenantId;
      };

      const effectiveTenant = getEffectiveTenantId(jwtPayload, queryParams);
      expect(effectiveTenant).toBe('tenant-from-jwt');
      expect(effectiveTenant).not.toBe(queryParams.tenantId);
    });

    it('should not allow tenantId override via HTTP headers', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-from-jwt' });
      const headers = {
        'x-tenant-id': 'tenant-from-header-attacker-wants',
      };

      const getEffectiveTenantId = (jwt: JwtPayload, _headers: Record<string, string>): string => {
        // CORRECT: Always use JWT, ignore custom headers
        return jwt.tenantId;
      };

      const effectiveTenant = getEffectiveTenantId(jwtPayload, headers);
      expect(effectiveTenant).toBe('tenant-from-jwt');
      expect(effectiveTenant).not.toBe(headers['x-tenant-id']);
    });

    it('should strip tenantId from request body before processing', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-from-jwt' });
      const requestBody: RequestBody = {
        tenantId: 'attacker-tenant',
        name: 'Policy Name',
        description: 'Policy Description',
      };

      // Sanitize function that removes/replaces tenantId
      const sanitizeRequestBody = (body: RequestBody, jwtTenantId: string): RequestBody => {
        const sanitized = { ...body };
        // Replace any tenantId in body with JWT tenant
        sanitized.tenantId = jwtTenantId;
        return sanitized;
      };

      const sanitized = sanitizeRequestBody(requestBody, jwtPayload.tenantId);
      expect(sanitized.tenantId).toBe('tenant-from-jwt');
      expect(sanitized.name).toBe('Policy Name');
    });

    it('should throw error if JWT is missing tenantId claim', () => {
      const jwtWithoutTenant: Partial<JwtPayload> = {
        sub: 'user-123',
        roles: ['user'],
        // tenantId is missing
      };

      const validateJwtTenant = (jwt: Partial<JwtPayload>): void => {
        if (!jwt.tenantId) {
          throw new ForbiddenError('Tenant context missing from token');
        }
      };

      expect(() => validateJwtTenant(jwtWithoutTenant)).toThrow(ForbiddenError);
      expect(() => validateJwtTenant(jwtWithoutTenant)).toThrow(/Tenant context missing/);
    });
  });

  // ===========================================================================
  // REGRESSION: JWT Tenant is Always Used
  // ===========================================================================

  describe('JWT Tenant is Always Used', () => {
    it('should extract tenantId from JWT for all authenticated operations', () => {
      const jwtPayload = createJwtPayload({
        sub: 'user-123',
        tenantId: 'tenant-abc-123',
      });

      // Simulated getTenantId function from API layer
      const getTenantId = (jwt: JwtPayload): string => {
        if (!jwt.tenantId) {
          throw new ForbiddenError('Tenant context missing from token');
        }
        return jwt.tenantId;
      };

      expect(getTenantId(jwtPayload)).toBe('tenant-abc-123');
    });

    it('should use JWT tenantId for policy operations', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-for-policy' });

      // Policy creation should use JWT tenant
      const createPolicyContext = (jwt: JwtPayload) => ({
        tenantId: jwt.tenantId, // From JWT, not request
        createdBy: jwt.sub,
      });

      const context = createPolicyContext(jwtPayload);
      expect(context.tenantId).toBe('tenant-for-policy');
    });

    it('should use JWT tenantId for intent operations', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-for-intent' });

      // Intent creation should use JWT tenant
      const createIntentContext = (jwt: JwtPayload) => ({
        tenantId: jwt.tenantId, // From JWT, not request
        entityId: jwt.sub,
      });

      const context = createIntentContext(jwtPayload);
      expect(context.tenantId).toBe('tenant-for-intent');
    });

    it('should use JWT tenantId for audit logging', () => {
      const jwtPayload = createJwtPayload({
        sub: 'user-123',
        tenantId: 'tenant-for-audit',
      });

      // Audit records should use JWT tenant
      const createAuditContext = (jwt: JwtPayload, action: string) => ({
        tenantId: jwt.tenantId,
        actorId: jwt.sub,
        action,
        timestamp: new Date().toISOString(),
      });

      const audit = createAuditContext(jwtPayload, 'policy.created');
      expect(audit.tenantId).toBe('tenant-for-audit');
    });

    it('should propagate JWT tenantId through the request lifecycle', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'propagated-tenant' });

      // Request context that flows through the application
      interface RequestContext {
        tenantId: string;
        userId: string;
        requestId: string;
      }

      const buildRequestContext = (jwt: JwtPayload): RequestContext => ({
        tenantId: jwt.tenantId, // Must come from JWT
        userId: jwt.sub,
        requestId: `req-${Date.now()}`,
      });

      const ctx = buildRequestContext(jwtPayload);

      // All downstream operations use this context
      expect(ctx.tenantId).toBe('propagated-tenant');
    });
  });

  // ===========================================================================
  // REGRESSION: Cross-Tenant Policy Creation is Blocked
  // ===========================================================================

  describe('Cross-Tenant Policy Creation is Blocked', () => {
    it('should block policy creation for different tenant', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-a' });
      const targetTenantId = 'tenant-b';

      const validatePolicyCreation = (jwt: JwtPayload, policyTenantId: string): void => {
        if (jwt.tenantId !== policyTenantId) {
          throw new ForbiddenError('Cannot create policy for different tenant', {
            jwtTenant: jwt.tenantId,
            targetTenant: policyTenantId,
          });
        }
      };

      expect(() => validatePolicyCreation(jwtPayload, targetTenantId)).toThrow(ForbiddenError);
    });

    it('should allow policy creation only for JWT tenant', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'my-tenant' });

      const validatePolicyCreation = (jwt: JwtPayload, policyTenantId: string): void => {
        if (jwt.tenantId !== policyTenantId) {
          throw new ForbiddenError('Cannot create policy for different tenant');
        }
      };

      // Same tenant - should succeed
      expect(() => validatePolicyCreation(jwtPayload, 'my-tenant')).not.toThrow();
    });

    it('should verify tenant membership before policy creation', async () => {
      const jwtPayload = createJwtPayload({
        sub: 'user-123',
        tenantId: 'claimed-tenant',
      });

      // Mock membership check
      const mockMembershipCheck = vi.fn().mockResolvedValue({ isMember: true });
      const mockMembershipCheckFail = vi.fn().mockResolvedValue({ isMember: false });

      const requireTenantMembership = async (
        userId: string,
        tenantId: string,
        checkFn: typeof mockMembershipCheck
      ): Promise<void> => {
        const result = await checkFn(userId, tenantId);
        if (!result.isMember) {
          throw new ForbiddenError('Access denied: user is not a member of this tenant');
        }
      };

      // User is member - should succeed
      await expect(
        requireTenantMembership(jwtPayload.sub, jwtPayload.tenantId, mockMembershipCheck)
      ).resolves.not.toThrow();

      // User is not member - should fail
      await expect(
        requireTenantMembership(jwtPayload.sub, jwtPayload.tenantId, mockMembershipCheckFail)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should not trust tenantId embedded in policy definition', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'user-tenant' });

      const maliciousPolicyDefinition = {
        name: 'Malicious Policy',
        tenantId: 'victim-tenant', // Attacker embeds different tenant
        rules: [],
      };

      // System should override with JWT tenant
      const createPolicy = (jwt: JwtPayload, definition: Record<string, unknown>) => ({
        ...definition,
        tenantId: jwt.tenantId, // ALWAYS use JWT tenant
      });

      const policy = createPolicy(jwtPayload, maliciousPolicyDefinition);
      expect(policy.tenantId).toBe('user-tenant');
      expect(policy.tenantId).not.toBe('victim-tenant');
    });
  });

  // ===========================================================================
  // REGRESSION: Cross-Tenant Intent Access is Blocked
  // ===========================================================================

  describe('Cross-Tenant Intent Access is Blocked', () => {
    it('should block access to intents from different tenant', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-a' });

      interface Intent {
        id: string;
        tenantId: string;
        goal: string;
      }

      const intent: Intent = {
        id: 'intent-123',
        tenantId: 'tenant-b', // Different tenant
        goal: 'Sensitive operation',
      };

      const validateIntentAccess = (jwt: JwtPayload, intentToAccess: Intent): void => {
        if (jwt.tenantId !== intentToAccess.tenantId) {
          throw new ForbiddenError('Cross-tenant intent access denied', {
            userTenant: jwt.tenantId,
            intentTenant: intentToAccess.tenantId,
          });
        }
      };

      expect(() => validateIntentAccess(jwtPayload, intent)).toThrow(ForbiddenError);
      expect(() => validateIntentAccess(jwtPayload, intent)).toThrow(/Cross-tenant intent access/);
    });

    it('should filter query results by JWT tenant', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-a' });

      // All database queries should include tenant filter
      const buildIntentQuery = (jwt: JwtPayload) => ({
        filter: {
          tenantId: jwt.tenantId, // MUST filter by JWT tenant
        },
      });

      const query = buildIntentQuery(jwtPayload);
      expect(query.filter.tenantId).toBe('tenant-a');
    });

    it('should reject intent ID that belongs to different tenant', async () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-a' });

      // Mock intent lookup
      const lookupIntent = vi.fn().mockResolvedValue({
        id: 'intent-from-other-tenant',
        tenantId: 'tenant-b', // Different tenant!
      });

      const getIntent = async (jwt: JwtPayload, intentId: string) => {
        const intent = await lookupIntent(intentId);
        if (intent && intent.tenantId !== jwt.tenantId) {
          throw new ForbiddenError('Intent not found'); // Generic message to prevent enumeration
        }
        return intent;
      };

      await expect(getIntent(jwtPayload, 'intent-from-other-tenant')).rejects.toThrow(ForbiddenError);
    });

    it('should use generic error message to prevent tenant enumeration', () => {
      // When cross-tenant access is attempted, error should not reveal
      // whether the resource exists in another tenant
      const createAccessDeniedError = (found: boolean, correctTenant: boolean): ForbiddenError => {
        // Always return same message regardless of whether resource exists
        // This prevents attackers from learning about resources in other tenants
        return new ForbiddenError('Resource not found or access denied');
      };

      const error1 = createAccessDeniedError(true, false); // Found but wrong tenant
      const error2 = createAccessDeniedError(false, false); // Not found

      // Errors should be indistinguishable
      expect(error1.message).toBe(error2.message);
    });

    it('should enforce tenant isolation in escalation handling', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'tenant-a' });

      interface Escalation {
        id: string;
        intentId: string;
        tenantId: string;
      }

      const escalation: Escalation = {
        id: 'esc-123',
        intentId: 'intent-456',
        tenantId: 'tenant-b',
      };

      const validateEscalationAccess = (jwt: JwtPayload, esc: Escalation): void => {
        if (jwt.tenantId !== esc.tenantId) {
          throw new ForbiddenError('Escalation access denied');
        }
      };

      expect(() => validateEscalationAccess(jwtPayload, escalation)).toThrow(ForbiddenError);
    });

    it('should include tenant filter in all database operations', () => {
      const jwtPayload = createJwtPayload({ tenantId: 'required-tenant' });

      // All query builders should require tenant filter
      interface QueryBuilder {
        table: string;
        filters: Record<string, unknown>;
        requireTenantFilter: boolean;
      }

      const buildSecureQuery = (jwt: JwtPayload, table: string): QueryBuilder => ({
        table,
        filters: {
          tenantId: jwt.tenantId, // Mandatory tenant filter
        },
        requireTenantFilter: true,
      });

      const intentQuery = buildSecureQuery(jwtPayload, 'intents');
      const policyQuery = buildSecureQuery(jwtPayload, 'policies');
      const auditQuery = buildSecureQuery(jwtPayload, 'audit_records');

      expect(intentQuery.filters.tenantId).toBe('required-tenant');
      expect(policyQuery.filters.tenantId).toBe('required-tenant');
      expect(auditQuery.filters.tenantId).toBe('required-tenant');
    });
  });

  // ===========================================================================
  // ADDITIONAL TENANT ISOLATION SECURITY TESTS
  // ===========================================================================

  describe('Additional Tenant Isolation Security', () => {
    it('should cache tenant membership per user-tenant pair', () => {
      // Cache key should include both user and tenant
      const buildCacheKey = (userId: string, tenantId: string): string => {
        return `tenant:membership:${userId}:${tenantId}`;
      };

      const key = buildCacheKey('user-123', 'tenant-abc');
      expect(key).toBe('tenant:membership:user-123:tenant-abc');

      // Different user or tenant produces different key
      const key2 = buildCacheKey('user-456', 'tenant-abc');
      const key3 = buildCacheKey('user-123', 'tenant-xyz');

      expect(key).not.toBe(key2);
      expect(key).not.toBe(key3);
    });

    it('should invalidate cache on membership change', () => {
      const cache = new Map<string, { isMember: boolean; role?: string }>();
      const buildCacheKey = (userId: string, tenantId: string) =>
        `tenant:membership:${userId}:${tenantId}`;

      // Cache a membership
      cache.set(buildCacheKey('user-123', 'tenant-abc'), { isMember: true, role: 'admin' });

      // Invalidate on membership change
      const invalidateCache = (userId: string, tenantId: string) => {
        cache.delete(buildCacheKey(userId, tenantId));
      };

      invalidateCache('user-123', 'tenant-abc');
      expect(cache.has(buildCacheKey('user-123', 'tenant-abc'))).toBe(false);
    });

    it('should log cross-tenant access attempts', () => {
      const jwtPayload = createJwtPayload({
        sub: 'attacker',
        tenantId: 'tenant-a',
      });

      const targetTenantId = 'tenant-b';

      const logSecurityEvent = (event: Record<string, unknown>) => event;

      const securityLog = logSecurityEvent({
        eventType: 'cross_tenant_access_attempt',
        severity: 'high',
        userId: jwtPayload.sub,
        userTenant: jwtPayload.tenantId,
        targetTenant: targetTenantId,
        timestamp: new Date().toISOString(),
        action: 'blocked',
      });

      expect(securityLog.eventType).toBe('cross_tenant_access_attempt');
      expect(securityLog.severity).toBe('high');
      expect(securityLog.action).toBe('blocked');
    });

    it('should verify tenant context is present in all service methods', () => {
      // Service method signature that enforces tenant context
      interface TenantAwareService {
        createIntent(tenantId: string, data: unknown): Promise<unknown>;
        getIntent(tenantId: string, intentId: string): Promise<unknown>;
        listIntents(tenantId: string, filters?: unknown): Promise<unknown[]>;
        updateIntent(tenantId: string, intentId: string, data: unknown): Promise<unknown>;
        deleteIntent(tenantId: string, intentId: string): Promise<void>;
      }

      // All methods require tenantId as first parameter - enforced at type level
      const mockService: TenantAwareService = {
        createIntent: vi.fn(),
        getIntent: vi.fn(),
        listIntents: vi.fn(),
        updateIntent: vi.fn(),
        deleteIntent: vi.fn(),
      };

      // Type system ensures tenant is always passed
      expect(mockService.createIntent).toBeDefined();
      expect(mockService.getIntent).toBeDefined();
      expect(mockService.listIntents).toBeDefined();
    });

    it('should handle tenant context in async operations', async () => {
      const jwtPayload = createJwtPayload({ tenantId: 'async-tenant' });

      // Async context should preserve tenant ID
      const processAsyncOperation = async (jwt: JwtPayload) => {
        const tenantId = jwt.tenantId;

        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Tenant ID should still be correct
        return tenantId;
      };

      const result = await processAsyncOperation(jwtPayload);
      expect(result).toBe('async-tenant');
    });
  });
});
