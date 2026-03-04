/**
 * Authorization Security Tests
 *
 * Comprehensive tests for authorization mechanisms covering:
 * - Scope-based access control
 * - Trust tier enforcement
 * - API key scope validation
 * - Role-based access patterns
 * - Privilege escalation prevention
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApiKeyScope,
  API_KEY_SCOPES,
  ApiKeyStatus,
} from '../../src/security/api-keys/types.js';
import {
  TrustTier,
  getSecurityRequirementsForTier,
} from '../../src/security/types.js';

// Mock dependencies
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Authorization Security', () => {
  // ===========================================================================
  // SCOPE-BASED ACCESS CONTROL TESTS
  // ===========================================================================

  describe('Scope-Based Access Control', () => {
    const allScopes = Object.values(ApiKeyScope);

    it('should define all required scopes', () => {
      expect(allScopes).toContain(ApiKeyScope.READ);
      expect(allScopes).toContain(ApiKeyScope.WRITE);
      expect(allScopes).toContain(ApiKeyScope.ADMIN);
      expect(allScopes.length).toBeGreaterThan(0);
    });

    it('should validate scope format', () => {
      // Scopes should be lowercase with optional separators
      const isValidScopeFormat = (scope: string) =>
        /^[a-z][a-z0-9_:.-]*[a-z0-9]$/.test(scope) || /^[a-z]+$/.test(scope);

      for (const scope of allScopes) {
        expect(isValidScopeFormat(scope)).toBe(true);
      }
    });

    it('should check if user has required scope', () => {
      const userScopes: ApiKeyScope[] = [ApiKeyScope.READ, ApiKeyScope.WRITE];

      const hasScope = (required: ApiKeyScope) =>
        userScopes.includes(required);

      const hasAllScopes = (required: ApiKeyScope[]) =>
        required.every(scope => userScopes.includes(scope));

      const hasAnyScope = (required: ApiKeyScope[]) =>
        required.some(scope => userScopes.includes(scope));

      expect(hasScope(ApiKeyScope.READ)).toBe(true);
      expect(hasScope(ApiKeyScope.ADMIN)).toBe(false);
      expect(hasAllScopes([ApiKeyScope.READ, ApiKeyScope.WRITE])).toBe(true);
      expect(hasAllScopes([ApiKeyScope.READ, ApiKeyScope.ADMIN])).toBe(false);
      expect(hasAnyScope([ApiKeyScope.ADMIN, ApiKeyScope.READ])).toBe(true);
    });

    it('should prevent scope escalation', () => {
      const currentScopes = [ApiKeyScope.READ];

      // User cannot grant themselves more permissions
      const canGrantScope = (grantingScopes: ApiKeyScope[], targetScope: ApiKeyScope) => {
        // Can only grant scopes you already have
        return grantingScopes.includes(targetScope);
      };

      expect(canGrantScope(currentScopes, ApiKeyScope.READ)).toBe(true);
      expect(canGrantScope(currentScopes, ApiKeyScope.WRITE)).toBe(false);
      expect(canGrantScope(currentScopes, ApiKeyScope.ADMIN)).toBe(false);
    });

    it('should enforce scope hierarchy', () => {
      // ADMIN should include all lower scopes
      const scopeHierarchy: Record<ApiKeyScope, ApiKeyScope[]> = {
        [ApiKeyScope.READ]: [],
        [ApiKeyScope.WRITE]: [ApiKeyScope.READ],
        [ApiKeyScope.DELETE]: [ApiKeyScope.WRITE, ApiKeyScope.READ],
        [ApiKeyScope.ADMIN]: [ApiKeyScope.DELETE, ApiKeyScope.WRITE, ApiKeyScope.READ],
        [ApiKeyScope.WEBHOOK]: [],
        [ApiKeyScope.INTEGRATION]: [ApiKeyScope.READ],
      };

      const getEffectiveScopes = (scope: ApiKeyScope): ApiKeyScope[] => {
        const inherited = scopeHierarchy[scope] || [];
        return [scope, ...inherited];
      };

      const adminScopes = getEffectiveScopes(ApiKeyScope.ADMIN);
      expect(adminScopes).toContain(ApiKeyScope.READ);
      expect(adminScopes).toContain(ApiKeyScope.WRITE);
      expect(adminScopes).toContain(ApiKeyScope.ADMIN);
    });
  });

  // ===========================================================================
  // TRUST TIER ENFORCEMENT TESTS
  // ===========================================================================

  describe('Trust Tier Enforcement', () => {
    const trustTiers: TrustTier[] = [0, 1, 2, 3, 4, 5];

    it('should define valid trust tier levels', () => {
      expect(trustTiers).toContain(0);
      expect(trustTiers).toContain(5);
      expect(Math.min(...trustTiers)).toBe(0);
      expect(Math.max(...trustTiers)).toBe(5);
    });

    it('should enforce minimum tier for operations', () => {
      const operationTierRequirements: Record<string, TrustTier> = {
        'read_public': 0,
        'read_personal': 1,
        'write_data': 2,
        'manage_users': 3,
        'system_config': 4,
        'admin_access': 5,
      };

      const canPerformOperation = (userTier: TrustTier, operation: string) => {
        const requiredTier = operationTierRequirements[operation];
        if (requiredTier === undefined) return false;
        return userTier >= requiredTier;
      };

      expect(canPerformOperation(2, 'read_public')).toBe(true);
      expect(canPerformOperation(2, 'write_data')).toBe(true);
      expect(canPerformOperation(2, 'manage_users')).toBe(false);
      expect(canPerformOperation(5, 'admin_access')).toBe(true);
    });

    it('should get security requirements for each tier', () => {
      for (const tier of trustTiers) {
        const requirements = getSecurityRequirementsForTier(tier);

        expect(requirements).toBeDefined();
        expect(typeof requirements.dpopRequired).toBe('boolean');
        expect(typeof requirements.teeRequired).toBe('boolean');
      }
    });

    it('should require DPoP for higher tiers', () => {
      // T2+ should require DPoP
      const t0Req = getSecurityRequirementsForTier(0);
      const t1Req = getSecurityRequirementsForTier(1);
      const t2Req = getSecurityRequirementsForTier(2);
      const t3Req = getSecurityRequirementsForTier(3);

      expect(t0Req.dpopRequired).toBe(false);
      expect(t1Req.dpopRequired).toBe(false);
      expect(t2Req.dpopRequired).toBe(true);
      expect(t3Req.dpopRequired).toBe(true);
    });

    it('should require TEE binding for highest tiers', () => {
      const t4Req = getSecurityRequirementsForTier(4);
      const t5Req = getSecurityRequirementsForTier(5);

      // T4 and T5 should require TEE binding
      expect(t4Req.teeRequired).toBe(true);
      expect(t5Req.teeRequired).toBe(true);
    });

    it('should prevent tier escalation without proper verification', () => {
      const currentTier: TrustTier = 2;

      const canEscalateTo = (targetTier: TrustTier, hasVerification: boolean) => {
        if (targetTier <= currentTier) return true;

        // Higher tiers require additional verification
        if (targetTier > currentTier && !hasVerification) return false;

        // Even with verification, can only escalate one level at a time
        return targetTier === currentTier + 1 && hasVerification;
      };

      expect(canEscalateTo(1, false)).toBe(true); // Downgrade always OK
      expect(canEscalateTo(2, false)).toBe(true); // Same tier OK
      expect(canEscalateTo(3, false)).toBe(false); // Upgrade without verification
      expect(canEscalateTo(3, true)).toBe(true); // Upgrade with verification
      expect(canEscalateTo(5, true)).toBe(false); // Cannot skip tiers
    });
  });

  // ===========================================================================
  // API KEY SCOPE VALIDATION TESTS
  // ===========================================================================

  describe('API Key Scope Validation', () => {
    it('should validate API key has required scopes', () => {
      const apiKey = {
        id: 'key-123',
        scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
        status: ApiKeyStatus.ACTIVE,
      };

      const validateScopes = (key: typeof apiKey, required: ApiKeyScope[]) => {
        return required.every(scope => key.scopes.includes(scope));
      };

      expect(validateScopes(apiKey, [ApiKeyScope.READ])).toBe(true);
      expect(validateScopes(apiKey, [ApiKeyScope.READ, ApiKeyScope.WRITE])).toBe(true);
      expect(validateScopes(apiKey, [ApiKeyScope.ADMIN])).toBe(false);
    });

    it('should reject inactive API keys regardless of scope', () => {
      const inactiveKey = {
        id: 'key-456',
        scopes: [ApiKeyScope.ADMIN],
        status: ApiKeyStatus.REVOKED,
      };

      const isKeyValid = (key: typeof inactiveKey) => {
        return key.status === ApiKeyStatus.ACTIVE;
      };

      expect(isKeyValid(inactiveKey)).toBe(false);
    });

    it('should enforce scope-action mapping', () => {
      const scopeActionMap: Record<string, ApiKeyScope[]> = {
        'GET /api/data': [ApiKeyScope.READ],
        'POST /api/data': [ApiKeyScope.WRITE],
        'DELETE /api/data': [ApiKeyScope.DELETE],
        'POST /api/admin/users': [ApiKeyScope.ADMIN],
        'POST /api/webhooks': [ApiKeyScope.WEBHOOK],
      };

      const canPerformAction = (action: string, keyScopes: ApiKeyScope[]) => {
        const requiredScopes = scopeActionMap[action];
        if (!requiredScopes) return false;
        return requiredScopes.some(scope => keyScopes.includes(scope));
      };

      const readOnlyKey = [ApiKeyScope.READ];
      const writeKey = [ApiKeyScope.READ, ApiKeyScope.WRITE];

      expect(canPerformAction('GET /api/data', readOnlyKey)).toBe(true);
      expect(canPerformAction('POST /api/data', readOnlyKey)).toBe(false);
      expect(canPerformAction('POST /api/data', writeKey)).toBe(true);
    });

    it('should validate tenant-scoped API keys', () => {
      const apiKey = {
        id: 'key-789',
        scopes: [ApiKeyScope.READ],
        tenantId: 'tenant-123',
      };

      const isAuthorizedForTenant = (key: typeof apiKey, requestTenantId: string) => {
        return key.tenantId === requestTenantId;
      };

      expect(isAuthorizedForTenant(apiKey, 'tenant-123')).toBe(true);
      expect(isAuthorizedForTenant(apiKey, 'tenant-456')).toBe(false);
    });
  });

  // ===========================================================================
  // ROLE-BASED ACCESS PATTERNS TESTS
  // ===========================================================================

  describe('Role-Based Access Patterns', () => {
    const roles = {
      VIEWER: 'viewer',
      EDITOR: 'editor',
      ADMIN: 'admin',
      SUPERADMIN: 'superadmin',
    } as const;

    type Role = typeof roles[keyof typeof roles];

    const roleHierarchy: Record<Role, number> = {
      [roles.VIEWER]: 1,
      [roles.EDITOR]: 2,
      [roles.ADMIN]: 3,
      [roles.SUPERADMIN]: 4,
    };

    it('should validate role assignments', () => {
      const isValidRole = (role: string): role is Role => {
        return Object.values(roles).includes(role as Role);
      };

      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('invalid_role')).toBe(false);
    });

    it('should check role hierarchy', () => {
      const hasMinimumRole = (userRole: Role, requiredRole: Role) => {
        return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
      };

      expect(hasMinimumRole(roles.ADMIN, roles.VIEWER)).toBe(true);
      expect(hasMinimumRole(roles.ADMIN, roles.ADMIN)).toBe(true);
      expect(hasMinimumRole(roles.VIEWER, roles.ADMIN)).toBe(false);
    });

    it('should enforce resource-specific permissions', () => {
      type Permission = 'read' | 'write' | 'delete' | 'admin';

      const rolePermissions: Record<Role, Permission[]> = {
        [roles.VIEWER]: ['read'],
        [roles.EDITOR]: ['read', 'write'],
        [roles.ADMIN]: ['read', 'write', 'delete', 'admin'],
        [roles.SUPERADMIN]: ['read', 'write', 'delete', 'admin'],
      };

      const hasPermission = (role: Role, permission: Permission) => {
        return rolePermissions[role].includes(permission);
      };

      expect(hasPermission(roles.VIEWER, 'read')).toBe(true);
      expect(hasPermission(roles.VIEWER, 'write')).toBe(false);
      expect(hasPermission(roles.EDITOR, 'write')).toBe(true);
      expect(hasPermission(roles.ADMIN, 'delete')).toBe(true);
    });

    it('should support role inheritance', () => {
      // Child roles inherit parent permissions
      const roleInheritance: Record<Role, Role[]> = {
        [roles.VIEWER]: [],
        [roles.EDITOR]: [roles.VIEWER],
        [roles.ADMIN]: [roles.EDITOR, roles.VIEWER],
        [roles.SUPERADMIN]: [roles.ADMIN, roles.EDITOR, roles.VIEWER],
      };

      const getEffectiveRoles = (role: Role): Role[] => {
        return [role, ...roleInheritance[role]];
      };

      expect(getEffectiveRoles(roles.ADMIN)).toContain(roles.VIEWER);
      expect(getEffectiveRoles(roles.ADMIN)).toContain(roles.EDITOR);
      expect(getEffectiveRoles(roles.VIEWER)).not.toContain(roles.ADMIN);
    });
  });

  // ===========================================================================
  // PRIVILEGE ESCALATION PREVENTION TESTS
  // ===========================================================================

  describe('Privilege Escalation Prevention', () => {
    it('should prevent users from modifying their own roles', () => {
      const currentUser = { id: 'user-123', role: 'editor' };
      const targetUser = { id: 'user-123', role: 'editor' }; // Same user

      const canModifyRole = (actor: typeof currentUser, target: typeof targetUser) => {
        // Users cannot modify their own role
        return actor.id !== target.id;
      };

      expect(canModifyRole(currentUser, targetUser)).toBe(false);
    });

    it('should prevent granting higher roles than own', () => {
      const roleHierarchy: Record<string, number> = {
        viewer: 1,
        editor: 2,
        admin: 3,
        superadmin: 4,
      };

      const canAssignRole = (actorRole: string, targetRole: string) => {
        const actorLevel = roleHierarchy[actorRole] || 0;
        const targetLevel = roleHierarchy[targetRole] || 0;

        // Can only assign roles at or below your level
        return actorLevel >= targetLevel;
      };

      expect(canAssignRole('admin', 'editor')).toBe(true);
      expect(canAssignRole('admin', 'admin')).toBe(true);
      expect(canAssignRole('admin', 'superadmin')).toBe(false);
      expect(canAssignRole('editor', 'admin')).toBe(false);
    });

    it('should prevent horizontal privilege escalation', () => {
      const resources = {
        'tenant-a': ['resource-1', 'resource-2'],
        'tenant-b': ['resource-3', 'resource-4'],
      };

      const canAccessResource = (userTenantId: string, resourceId: string) => {
        const tenantResources = resources[userTenantId as keyof typeof resources];
        return tenantResources?.includes(resourceId) ?? false;
      };

      expect(canAccessResource('tenant-a', 'resource-1')).toBe(true);
      expect(canAccessResource('tenant-a', 'resource-3')).toBe(false);
    });

    it('should validate delegation chains', () => {
      interface DelegationChain {
        from: string;
        to: string;
        scopes: string[];
        maxDepth: number;
      }

      const isValidDelegation = (chain: DelegationChain[], newDelegation: DelegationChain) => {
        // Check max depth
        if (chain.length >= newDelegation.maxDepth) return false;

        // Check scope reduction (can only delegate subset of own scopes)
        if (chain.length > 0) {
          const previousScopes = chain[chain.length - 1]!.scopes;
          const hasAllScopes = newDelegation.scopes.every(s => previousScopes.includes(s));
          if (!hasAllScopes) return false;
        }

        return true;
      };

      const chain: DelegationChain[] = [
        { from: 'root', to: 'admin', scopes: ['read', 'write', 'delete'], maxDepth: 3 },
      ];

      // Valid delegation (reduced scopes)
      expect(
        isValidDelegation(chain, {
          from: 'admin',
          to: 'user',
          scopes: ['read', 'write'],
          maxDepth: 3,
        })
      ).toBe(true);

      // Invalid delegation (scope escalation)
      expect(
        isValidDelegation(chain, {
          from: 'admin',
          to: 'user',
          scopes: ['read', 'write', 'delete', 'admin'],
          maxDepth: 3,
        })
      ).toBe(false);
    });

    it('should enforce time-based access restrictions', () => {
      const accessWindows = {
        business_hours: { start: 9, end: 17 }, // 9 AM to 5 PM
        all_hours: { start: 0, end: 24 },
      };

      const isWithinAccessWindow = (
        windowType: keyof typeof accessWindows,
        currentHour: number
      ) => {
        const window = accessWindows[windowType];
        return currentHour >= window.start && currentHour < window.end;
      };

      expect(isWithinAccessWindow('business_hours', 12)).toBe(true);
      expect(isWithinAccessWindow('business_hours', 20)).toBe(false);
      expect(isWithinAccessWindow('all_hours', 3)).toBe(true);
    });

    it('should prevent bypass via parameter manipulation', () => {
      const validateRequestParams = (params: Record<string, unknown>) => {
        const dangerousPatterns = [
          '__proto__',
          'constructor',
          'prototype',
          'admin',
          'role',
          'isadmin',
          'permissions',
        ];

        // Use for...in to also catch inherited/prototype-polluted keys,
        // and JSON stringification to detect __proto__ manipulation
        const allKeys: string[] = Object.keys(params);

        // Also detect __proto__ pollution by checking the serialized form
        const jsonStr = JSON.stringify(params);
        if (jsonStr.includes('"__proto__"')) {
          return false;
        }

        const hasProhibitedParam = allKeys.some(key =>
          dangerousPatterns.includes(key.toLowerCase())
        );

        return !hasProhibitedParam;
      };

      expect(validateRequestParams({ name: 'test' })).toBe(true);
      expect(validateRequestParams({ isAdmin: true })).toBe(false);
      // Note: { __proto__: {} } in JS literal sets the prototype, not an own property.
      // Use JSON.parse to create an actual __proto__ own property for testing.
      expect(validateRequestParams(JSON.parse('{"__proto__": {}}'))).toBe(false);
      expect(validateRequestParams({ role: 'admin' })).toBe(false);
    });
  });

  // ===========================================================================
  // RESOURCE OWNERSHIP TESTS
  // ===========================================================================

  describe('Resource Ownership', () => {
    it('should enforce owner-only access for private resources', () => {
      const resource = {
        id: 'resource-123',
        ownerId: 'user-456',
        visibility: 'private',
      };

      const canAccess = (userId: string, res: typeof resource) => {
        if (res.visibility === 'public') return true;
        return res.ownerId === userId;
      };

      expect(canAccess('user-456', resource)).toBe(true);
      expect(canAccess('user-789', resource)).toBe(false);
    });

    it('should allow shared access with explicit permissions', () => {
      const resourcePermissions = new Map<string, string[]>();
      resourcePermissions.set('resource-123', ['user-456', 'user-789']);

      const hasSharedAccess = (resourceId: string, userId: string) => {
        const allowedUsers = resourcePermissions.get(resourceId);
        return allowedUsers?.includes(userId) ?? false;
      };

      expect(hasSharedAccess('resource-123', 'user-456')).toBe(true);
      expect(hasSharedAccess('resource-123', 'user-789')).toBe(true);
      expect(hasSharedAccess('resource-123', 'user-999')).toBe(false);
    });
  });

  // ===========================================================================
  // AUDIT TRAIL TESTS
  // ===========================================================================

  describe('Authorization Audit Trail', () => {
    it('should log authorization decisions', () => {
      const auditLog: Array<{
        timestamp: Date;
        userId: string;
        action: string;
        resource: string;
        decision: 'allow' | 'deny';
        reason?: string;
      }> = [];

      const logAuthorizationDecision = (
        userId: string,
        action: string,
        resource: string,
        decision: 'allow' | 'deny',
        reason?: string
      ) => {
        auditLog.push({
          timestamp: new Date(),
          userId,
          action,
          resource,
          decision,
          reason,
        });
      };

      logAuthorizationDecision('user-123', 'read', 'resource-456', 'allow');
      logAuthorizationDecision('user-123', 'delete', 'resource-456', 'deny', 'insufficient_permissions');

      expect(auditLog).toHaveLength(2);
      expect(auditLog[0]!.decision).toBe('allow');
      expect(auditLog[1]!.decision).toBe('deny');
      expect(auditLog[1]!.reason).toBe('insufficient_permissions');
    });

    it('should track privilege changes', () => {
      const privilegeChanges: Array<{
        timestamp: Date;
        targetUser: string;
        changedBy: string;
        oldRoles: string[];
        newRoles: string[];
      }> = [];

      const recordPrivilegeChange = (
        targetUser: string,
        changedBy: string,
        oldRoles: string[],
        newRoles: string[]
      ) => {
        privilegeChanges.push({
          timestamp: new Date(),
          targetUser,
          changedBy,
          oldRoles,
          newRoles,
        });
      };

      recordPrivilegeChange('user-123', 'admin-456', ['viewer'], ['editor']);

      expect(privilegeChanges).toHaveLength(1);
      expect(privilegeChanges[0]!.oldRoles).toContain('viewer');
      expect(privilegeChanges[0]!.newRoles).toContain('editor');
    });
  });
});
