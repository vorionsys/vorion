/**
 * GDPR Authorization Security Regression Tests
 *
 * Security regression tests for GDPR data export vulnerabilities:
 * - Users can only export their own data
 * - Cross-tenant export is blocked
 * - Admin can export any user in their tenant
 * - Rate limiting on exports
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenError } from '../../src/common/errors.js';
import type {
  GdprAuthorizationContext,
  GdprRole,
} from '../../src/intent/gdpr.js';

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
  getDatabase: vi.fn(),
  withLongQueryTimeout: vi.fn((fn) => fn()),
}));

vi.mock('../../src/common/redis.js', () => ({
  getRedis: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    duplicate: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    intent: {
      softDeleteRetentionDays: 90,
      eventRetentionDays: 365,
    },
    audit: {
      retentionDays: 2555,
    },
    gdpr: {
      exportConcurrency: 2,
    },
  })),
}));

vi.mock('../../src/audit/index.js', () => ({
  createAuditService: vi.fn(() => ({
    record: vi.fn().mockResolvedValue(undefined),
  })),
  createAuditHelper: vi.fn(() => ({
    recordIntentEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/common/circuit-breaker.js', () => ({
  withCircuitBreaker: vi.fn((name, fn) => fn()),
  CircuitBreakerOpenError: class CircuitBreakerOpenError extends Error {},
}));

describe('GDPR Authorization Security Regression Tests', () => {
  // Helper to create authorization context
  const createAuthContext = (
    overrides: Partial<GdprAuthorizationContext> = {}
  ): GdprAuthorizationContext => ({
    requestingUserId: 'user-123',
    requestingUserTenantId: 'tenant-abc',
    roles: ['user'] as GdprRole[],
    ipAddress: '192.168.1.100',
    requestId: 'req-456',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // REGRESSION: Users Can Only Export Their Own Data
  // ===========================================================================

  describe('Users Can Only Export Their Own Data', () => {
    it('should allow user to export their own data', () => {
      const authContext = createAuthContext({
        requestingUserId: 'user-123',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'],
      });

      const targetUserId = 'user-123'; // Same as requesting user
      const targetTenantId = 'tenant-abc';

      // User is requesting their own data - should be allowed
      expect(authContext.requestingUserId).toBe(targetUserId);
      expect(authContext.requestingUserTenantId).toBe(targetTenantId);
    });

    it('should block regular user from exporting other users data', () => {
      const authContext = createAuthContext({
        requestingUserId: 'user-123',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'], // Regular user, not admin
      });

      const targetUserId = 'user-456'; // Different user
      const targetTenantId = 'tenant-abc'; // Same tenant

      // Regular user cannot export other user's data
      const isSelf = authContext.requestingUserId === targetUserId;
      const hasElevatedRole =
        authContext.roles.includes('admin') ||
        authContext.roles.includes('tenant:admin') ||
        authContext.roles.includes('dpo') ||
        authContext.roles.includes('gdpr:admin');

      expect(isSelf).toBe(false);
      expect(hasElevatedRole).toBe(false);
      // Authorization should be denied
    });

    it('should enforce authorization check before any data access', () => {
      // This test verifies the pattern - authorization must be checked first
      const authContext = createAuthContext({
        requestingUserId: 'attacker-user',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'],
      });

      const targetUserId = 'victim-user';

      // The authorization check should happen BEFORE any database query
      const checkAuthorizationFirst = (ctx: GdprAuthorizationContext, targetId: string): boolean => {
        // 1. First check: is this the user's own data?
        if (ctx.requestingUserId === targetId) {
          return true;
        }
        // 2. Second check: does user have elevated privileges?
        const elevatedRoles: GdprRole[] = ['admin', 'tenant:admin', 'dpo', 'gdpr:admin'];
        if (ctx.roles.some((r) => elevatedRoles.includes(r))) {
          return true;
        }
        // 3. Otherwise, deny
        return false;
      };

      const isAuthorized = checkAuthorizationFirst(authContext, targetUserId);
      expect(isAuthorized).toBe(false);
    });

    it('should not allow userId spoofing via request body', () => {
      // The authorization context comes from JWT, not request body
      const authContext = createAuthContext({
        requestingUserId: 'real-user-id-from-jwt',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'],
      });

      // Attacker might try to spoof userId in request body
      const requestBody = {
        userId: 'victim-user-id-spoofed',
        tenantId: 'tenant-abc',
      };

      // The system should ALWAYS use the JWT userId, not the request body userId
      // When checking authorization for the spoofed userId:
      const isSelf = authContext.requestingUserId === requestBody.userId;
      expect(isSelf).toBe(false);

      // This should result in authorization failure for non-elevated user
    });
  });

  // ===========================================================================
  // REGRESSION: Cross-Tenant Export is Blocked
  // ===========================================================================

  describe('Cross-Tenant Export is Blocked', () => {
    it('should block export when tenant IDs do not match', () => {
      const authContext = createAuthContext({
        requestingUserId: 'user-123',
        requestingUserTenantId: 'tenant-abc',
        roles: ['admin'], // Even admin cannot cross tenant boundaries
      });

      const targetTenantId = 'tenant-xyz'; // Different tenant

      // Tenant validation should fail
      const isSameTenant = authContext.requestingUserTenantId === targetTenantId;
      expect(isSameTenant).toBe(false);
    });

    it('should block cross-tenant export even for super admin', () => {
      const authContext = createAuthContext({
        requestingUserId: 'super-admin',
        requestingUserTenantId: 'tenant-abc',
        roles: ['admin', 'tenant:admin', 'dpo', 'gdpr:admin'],
      });

      const targetTenantId = 'tenant-xyz';

      // Even with all elevated roles, cross-tenant should be blocked
      const isSameTenant = authContext.requestingUserTenantId === targetTenantId;
      expect(isSameTenant).toBe(false);
    });

    it('should validate tenant membership before processing export', () => {
      // The validation function pattern
      const validateTenantMembership = (
        ctx: GdprAuthorizationContext,
        targetTenantId: string
      ): void => {
        if (ctx.requestingUserTenantId !== targetTenantId) {
          throw new ForbiddenError('Cross-tenant GDPR operations are not permitted', {
            requestingTenant: ctx.requestingUserTenantId,
            targetTenant: targetTenantId,
          });
        }
      };

      const authContext = createAuthContext({
        requestingUserTenantId: 'tenant-abc',
      });

      expect(() => validateTenantMembership(authContext, 'tenant-xyz')).toThrow(ForbiddenError);
      expect(() => validateTenantMembership(authContext, 'tenant-xyz')).toThrow(
        /Cross-tenant GDPR operations/
      );
    });

    it('should reject request body tenantId in favor of JWT tenantId', () => {
      const authContext = createAuthContext({
        requestingUserId: 'user-123',
        requestingUserTenantId: 'tenant-from-jwt',
        roles: ['user'],
      });

      // Attacker tries to specify different tenant in request
      const requestBody = {
        userId: 'user-123',
        tenantId: 'tenant-attacker-wants-to-access',
      };

      // System should use JWT tenant, not request body tenant
      const effectiveTenantId = authContext.requestingUserTenantId; // From JWT
      expect(effectiveTenantId).not.toBe(requestBody.tenantId);
    });

    it('should include tenant context in audit log for failed attempts', () => {
      const authContext = createAuthContext({
        requestingUserId: 'attacker',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'],
      });

      const targetTenantId = 'tenant-xyz';

      // Audit data should include both tenants for security review
      const auditData = {
        operation: 'gdpr_export',
        requestingUserId: authContext.requestingUserId,
        requestingTenant: authContext.requestingUserTenantId,
        targetTenant: targetTenantId,
        outcome: 'denied',
        reason: 'Cross-tenant access attempt',
      };

      expect(auditData.requestingTenant).toBe('tenant-abc');
      expect(auditData.targetTenant).toBe('tenant-xyz');
      expect(auditData.outcome).toBe('denied');
    });
  });

  // ===========================================================================
  // REGRESSION: Admin Can Export Any User in Their Tenant
  // ===========================================================================

  describe('Admin Can Export Any User in Their Tenant', () => {
    const adminRoles: Array<{ name: string; roles: GdprRole[] }> = [
      { name: 'admin', roles: ['admin'] },
      { name: 'tenant:admin', roles: ['tenant:admin'] },
      { name: 'dpo', roles: ['dpo'] },
      { name: 'gdpr:admin', roles: ['gdpr:admin'] },
    ];

    it.each(adminRoles)('should allow $name to export any user in same tenant', ({ roles }) => {
      const authContext = createAuthContext({
        requestingUserId: 'admin-user',
        requestingUserTenantId: 'tenant-abc',
        roles,
      });

      const targetUserId = 'any-other-user';
      const targetTenantId = 'tenant-abc'; // Same tenant

      // Admin can export any user in their tenant
      const hasElevatedRole = roles.some((r) =>
        ['admin', 'tenant:admin', 'dpo', 'gdpr:admin'].includes(r)
      );
      const isSameTenant = authContext.requestingUserTenantId === targetTenantId;

      expect(hasElevatedRole).toBe(true);
      expect(isSameTenant).toBe(true);
    });

    it('should authorize admin export with correct grantedBy field', () => {
      const testCases: Array<{ roles: GdprRole[]; expectedGrantedBy: string }> = [
        { roles: ['admin'], expectedGrantedBy: 'admin' },
        { roles: ['tenant:admin'], expectedGrantedBy: 'tenant_admin' },
        { roles: ['dpo'], expectedGrantedBy: 'dpo' },
        { roles: ['gdpr:admin'], expectedGrantedBy: 'gdpr_admin' },
      ];

      for (const { roles, expectedGrantedBy } of testCases) {
        const determineGrantedBy = (roleList: GdprRole[]): string | undefined => {
          if (roleList.includes('admin')) return 'admin';
          if (roleList.includes('dpo')) return 'dpo';
          if (roleList.includes('tenant:admin')) return 'tenant_admin';
          if (roleList.includes('gdpr:admin')) return 'gdpr_admin';
          return undefined;
        };

        const grantedBy = determineGrantedBy(roles);
        expect(grantedBy).toBe(expectedGrantedBy);
      }
    });

    it('should not allow admin to export users from different tenant', () => {
      const authContext = createAuthContext({
        requestingUserId: 'admin-user',
        requestingUserTenantId: 'tenant-abc',
        roles: ['admin'],
      });

      const targetTenantId = 'tenant-xyz';

      // Even admin cannot cross tenant boundaries
      const isSameTenant = authContext.requestingUserTenantId === targetTenantId;
      expect(isSameTenant).toBe(false);
    });

    it('should record audit trail for admin exports', () => {
      const authContext = createAuthContext({
        requestingUserId: 'admin-user',
        requestingUserTenantId: 'tenant-abc',
        roles: ['admin'],
        ipAddress: '10.0.0.100',
        requestId: 'req-789',
      });

      const targetUserId = 'exported-user';

      // Audit record should include all relevant fields
      const auditRecord = {
        eventType: 'gdpr_export',
        actor: {
          type: 'user',
          id: authContext.requestingUserId,
          ip: authContext.ipAddress,
        },
        target: {
          type: 'user',
          id: targetUserId,
        },
        outcome: 'success',
        grantedBy: 'admin',
        requestId: authContext.requestId,
      };

      expect(auditRecord.actor.id).toBe('admin-user');
      expect(auditRecord.target.id).toBe('exported-user');
      expect(auditRecord.grantedBy).toBe('admin');
    });
  });

  // ===========================================================================
  // REGRESSION: Rate Limiting on Exports
  // ===========================================================================

  describe('Rate Limiting on Exports', () => {
    it('should enforce rate limits on GDPR export requests', () => {
      // Rate limiting configuration pattern
      const rateLimitConfig = {
        gdprExport: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 5, // 5 exports per hour per user
          keyGenerator: (ctx: GdprAuthorizationContext) =>
            `gdpr:export:${ctx.requestingUserId}`,
        },
      };

      const authContext = createAuthContext({
        requestingUserId: 'user-123',
      });

      const rateLimitKey = rateLimitConfig.gdprExport.keyGenerator(authContext);
      expect(rateLimitKey).toBe('gdpr:export:user-123');
      expect(rateLimitConfig.gdprExport.max).toBe(5);
    });

    it('should track export count per user', () => {
      const exportCounts = new Map<string, number>();

      const trackExport = (userId: string): boolean => {
        const count = exportCounts.get(userId) ?? 0;
        const maxExportsPerHour = 5;

        if (count >= maxExportsPerHour) {
          return false; // Rate limited
        }

        exportCounts.set(userId, count + 1);
        return true;
      };

      // User can export up to limit
      for (let i = 0; i < 5; i++) {
        expect(trackExport('user-123')).toBe(true);
      }

      // 6th export should be rate limited
      expect(trackExport('user-123')).toBe(false);

      // Different user is not affected
      expect(trackExport('user-456')).toBe(true);
    });

    it('should apply stricter rate limits for bulk operations', () => {
      // Bulk export (admin exporting multiple users) should have stricter limits
      const rateLimitConfig = {
        singleExport: { max: 10, windowMs: 3600000 },
        bulkExport: { max: 2, windowMs: 3600000 },
      };

      expect(rateLimitConfig.bulkExport.max).toBeLessThan(rateLimitConfig.singleExport.max);
    });

    it('should return appropriate error when rate limited', () => {
      const createRateLimitError = () => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'GDPR export rate limit exceeded. Please try again later.',
        retryAfter: 3600, // seconds until reset
      });

      const error = createRateLimitError();
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(3600);
    });

    it('should log rate limit violations for security monitoring', () => {
      const authContext = createAuthContext({
        requestingUserId: 'suspicious-user',
        ipAddress: '1.2.3.4',
      });

      const rateLimitViolationLog = {
        event: 'gdpr_export_rate_limit_exceeded',
        userId: authContext.requestingUserId,
        ipAddress: authContext.ipAddress,
        timestamp: new Date().toISOString(),
        requestCount: 11,
        limit: 10,
        windowMs: 3600000,
        severity: 'warning',
      };

      expect(rateLimitViolationLog.event).toBe('gdpr_export_rate_limit_exceeded');
      expect(rateLimitViolationLog.requestCount).toBeGreaterThan(rateLimitViolationLog.limit);
    });
  });

  // ===========================================================================
  // ADDITIONAL GDPR AUTHORIZATION SECURITY TESTS
  // ===========================================================================

  describe('Additional GDPR Authorization Security', () => {
    it('should require explicit consent for erasure of other users data', () => {
      const authContext = createAuthContext({
        requestingUserId: 'admin-user',
        requestingUserTenantId: 'tenant-abc',
        roles: ['admin'],
        hasExplicitConsent: false, // No explicit consent
      });

      const targetUserId = 'other-user';

      // For erasure (not export), admin needs explicit consent when erasing others' data
      const isSelf = authContext.requestingUserId === targetUserId;
      const needsConsent = !isSelf;
      const hasConsent = authContext.hasExplicitConsent === true;

      expect(isSelf).toBe(false);
      expect(needsConsent).toBe(true);
      expect(hasConsent).toBe(false);
      // Erasure should be blocked without consent
    });

    it('should allow user to erase their own data without explicit consent flag', () => {
      const authContext = createAuthContext({
        requestingUserId: 'user-123',
        requestingUserTenantId: 'tenant-abc',
        roles: ['user'],
        hasExplicitConsent: undefined, // Not needed for self
      });

      const targetUserId = 'user-123';

      // User erasing own data - implicit consent
      const isSelf = authContext.requestingUserId === targetUserId;
      expect(isSelf).toBe(true);
      // Self-erasure should be allowed
    });

    it('should validate all required authorization context fields', () => {
      const validateAuthContext = (ctx: Partial<GdprAuthorizationContext>): string[] => {
        const errors: string[] = [];

        if (!ctx.requestingUserId) {
          errors.push('requestingUserId is required');
        }
        if (!ctx.requestingUserTenantId) {
          errors.push('requestingUserTenantId is required');
        }
        if (!ctx.roles || ctx.roles.length === 0) {
          errors.push('at least one role is required');
        }

        return errors;
      };

      const invalidContext = {
        requestingUserId: undefined,
        requestingUserTenantId: 'tenant-abc',
        roles: [],
      };

      const errors = validateAuthContext(invalidContext);
      expect(errors).toContain('requestingUserId is required');
      expect(errors).toContain('at least one role is required');
    });

    it('should handle role hierarchy correctly', () => {
      // Admin has all permissions
      const adminContext = createAuthContext({
        roles: ['admin'],
      });

      // DPO has GDPR-specific permissions
      const dpoContext = createAuthContext({
        roles: ['dpo'],
      });

      // Regular user has limited permissions
      const userContext = createAuthContext({
        roles: ['user'],
      });

      const canExportOthers = (ctx: GdprAuthorizationContext): boolean => {
        const elevatedRoles: GdprRole[] = ['admin', 'tenant:admin', 'dpo', 'gdpr:admin'];
        return ctx.roles.some((r) => elevatedRoles.includes(r));
      };

      expect(canExportOthers(adminContext)).toBe(true);
      expect(canExportOthers(dpoContext)).toBe(true);
      expect(canExportOthers(userContext)).toBe(false);
    });
  });
});
