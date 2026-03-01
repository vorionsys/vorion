/**
 * RBAC Service Unit Tests
 *
 * Tests for permission evaluation and caching in the RBAC service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define mocks BEFORE vi.mock calls since they get hoisted
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockResolvedValue([]),
};

const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  where: vi.fn(() => mockDb),
  limit: vi.fn(() => []),
};

// Mock Redis
vi.mock('../../../src/common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

// Mock database
vi.mock('../../../src/common/db.js', () => ({
  getDatabase: () => mockDb,
}));

// Now import after mocks are set up
import { RBACService, createRBACService } from '../../../src/rbac/service.js';
import { ACTIONS, RESOURCES, SYSTEM_ROLES } from '../../../src/rbac/types.js';

describe('RBACService', () => {
  let service: RBACService;

  beforeEach(() => {
    service = createRBACService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createRBACService', () => {
    it('should create a new service instance', () => {
      const newService = createRBACService();
      expect(newService).toBeInstanceOf(RBACService);
    });
  });

  describe('Permission Evaluation', () => {
    describe('evaluate', () => {
      it('should allow access when user has matching permission', async () => {
        // Mock getEffectivePermissions to return matching permission
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
          'read:intents',
        ]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce(['user']);

        const result = await service.evaluate({
          subjectId: 'user-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.READ,
          resource: RESOURCES.INTENTS,
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('Matched permission');
        expect(result.effectiveRoles).toContain('user');
      });

      it('should deny access when no matching permission', async () => {
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
          'read:policies',
        ]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce(['user']);

        const result = await service.evaluate({
          subjectId: 'user-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.DELETE,
          resource: RESOURCES.INTENTS,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('No matching permission');
      });

      it('should allow access with wildcard action', async () => {
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
          '*:intents',
        ]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce(['admin']);

        const result = await service.evaluate({
          subjectId: 'user-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.DELETE,
          resource: RESOURCES.INTENTS,
        });

        expect(result.allowed).toBe(true);
      });

      it('should allow access with wildcard resource', async () => {
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
          'read:*',
        ]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce(['auditor']);

        const result = await service.evaluate({
          subjectId: 'user-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.READ,
          resource: RESOURCES.POLICIES,
        });

        expect(result.allowed).toBe(true);
      });

      it('should allow access with super admin wildcard', async () => {
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
          '*:*',
        ]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce([SYSTEM_ROLES.SUPER_ADMIN]);

        const result = await service.evaluate({
          subjectId: 'admin-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.MANAGE,
          resource: RESOURCES.SETTINGS,
        });

        expect(result.allowed).toBe(true);
      });

      it('should include evaluation time in result', async () => {
        vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([]);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce([]);

        const result = await service.evaluate({
          subjectId: 'user-123',
          subjectType: 'user',
          tenantId: 'tenant-456',
          action: ACTIONS.READ,
          resource: RESOURCES.INTENTS,
        });

        expect(result.evaluationTimeMs).toBeDefined();
        expect(typeof result.evaluationTimeMs).toBe('number');
        expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('hasPermission', () => {
      it('should return true when permission exists', async () => {
        vi.spyOn(service, 'evaluate').mockResolvedValueOnce({
          allowed: true,
          reason: 'Matched',
          evaluatedPermissions: [],
          effectiveRoles: ['user'],
          evaluationTimeMs: 1,
        });

        const result = await service.hasPermission(
          'user-123',
          'user',
          'tenant-456',
          ACTIONS.READ,
          RESOURCES.INTENTS
        );

        expect(result).toBe(true);
      });

      it('should return false when permission does not exist', async () => {
        vi.spyOn(service, 'evaluate').mockResolvedValueOnce({
          allowed: false,
          reason: 'No match',
          evaluatedPermissions: [],
          effectiveRoles: ['user'],
          evaluationTimeMs: 1,
        });

        const result = await service.hasPermission(
          'user-123',
          'user',
          'tenant-456',
          ACTIONS.DELETE,
          RESOURCES.INTENTS
        );

        expect(result).toBe(false);
      });
    });

    describe('hasAnyPermission', () => {
      it('should return true if any permission matches', async () => {
        vi.spyOn(service, 'hasPermission')
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        const result = await service.hasAnyPermission(
          'user-123',
          'user',
          'tenant-456',
          [
            { action: ACTIONS.DELETE, resource: RESOURCES.INTENTS },
            { action: ACTIONS.READ, resource: RESOURCES.INTENTS },
          ]
        );

        expect(result).toBe(true);
      });

      it('should return false if no permissions match', async () => {
        vi.spyOn(service, 'hasPermission')
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false);

        const result = await service.hasAnyPermission(
          'user-123',
          'user',
          'tenant-456',
          [
            { action: ACTIONS.DELETE, resource: RESOURCES.INTENTS },
            { action: ACTIONS.MANAGE, resource: RESOURCES.SETTINGS },
          ]
        );

        expect(result).toBe(false);
      });
    });

    describe('hasAllPermissions', () => {
      it('should return true only if all permissions match', async () => {
        vi.spyOn(service, 'hasPermission')
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true);

        const result = await service.hasAllPermissions(
          'user-123',
          'user',
          'tenant-456',
          [
            { action: ACTIONS.READ, resource: RESOURCES.INTENTS },
            { action: ACTIONS.READ, resource: RESOURCES.POLICIES },
          ]
        );

        expect(result).toBe(true);
      });

      it('should return false if any permission is missing', async () => {
        vi.spyOn(service, 'hasPermission')
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);

        const result = await service.hasAllPermissions(
          'user-123',
          'user',
          'tenant-456',
          [
            { action: ACTIONS.READ, resource: RESOURCES.INTENTS },
            { action: ACTIONS.DELETE, resource: RESOURCES.INTENTS },
          ]
        );

        expect(result).toBe(false);
      });
    });
  });

  describe('Caching', () => {
    describe('getEffectivePermissions', () => {
      it('should return cached permissions when available', async () => {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify(['read:intents', 'create:intents']));

        const result = await service.getEffectivePermissions('user-123', 'user', 'tenant-456');

        expect(result).toEqual(['read:intents', 'create:intents']);
        expect(mockRedis.get).toHaveBeenCalled();
      });

      it('should compute and cache permissions on cache miss', async () => {
        mockRedis.get.mockResolvedValueOnce(null);
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce([SYSTEM_ROLES.USER]);

        await service.getEffectivePermissions('user-123', 'user', 'tenant-456');

        expect(mockRedis.set).toHaveBeenCalled();
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failed'));
        vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce([SYSTEM_ROLES.USER]);

        // Should not throw, should compute permissions instead
        const result = await service.getEffectivePermissions('user-123', 'user', 'tenant-456');

        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('invalidateUserPermissionCache', () => {
      it('should delete cache from local and Redis', async () => {
        await service.invalidateUserPermissionCache('user-123', 'tenant-456');

        expect(mockRedis.del).toHaveBeenCalled();
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));

        // Should not throw
        await expect(
          service.invalidateUserPermissionCache('user-123', 'tenant-456')
        ).resolves.not.toThrow();
      });
    });

    describe('clearAllCaches', () => {
      it('should clear local cache and Redis RBAC keys', async () => {
        mockRedis.keys.mockResolvedValueOnce(['rbac:perms:t1:u1', 'rbac:role:r1']);
        mockRedis.del.mockResolvedValueOnce(2);

        await service.clearAllCaches();

        expect(mockRedis.keys).toHaveBeenCalledWith('rbac:*');
        expect(mockRedis.del).toHaveBeenCalled();
      });

      it('should not call del when no keys found', async () => {
        mockRedis.keys.mockResolvedValueOnce([]);

        await service.clearAllCaches();

        expect(mockRedis.del).not.toHaveBeenCalled();
      });
    });
  });

  describe('Role Management', () => {
    describe('getRolePermissions', () => {
      it('should return default permissions for system roles', async () => {
        const permissions = await service.getRolePermissions(SYSTEM_ROLES.SUPER_ADMIN, '');

        expect(permissions).toBeDefined();
        expect(Array.isArray(permissions)).toBe(true);
        // Super admin should have at least the wildcard permission
        expect(permissions.some(p => p.action === '*' && p.resource === '*')).toBe(true);
      });

      it('should return empty array for unknown custom role', async () => {
        const permissions = await service.getRolePermissions('unknown-custom-role', 'tenant-123');

        expect(permissions).toEqual([]);
      });
    });

    describe('getEffectiveRoles', () => {
      it('should return default role for regular users', async () => {
        const roles = await service.getEffectiveRoles('user-123', 'user', 'tenant-456');

        expect(roles).toContain(SYSTEM_ROLES.USER);
      });

      it('should return service role for service accounts', async () => {
        const roles = await service.getEffectiveRoles('sa-123', 'service_account', 'tenant-456');

        expect(roles).toContain(SYSTEM_ROLES.SERVICE);
      });
    });
  });
});

describe('Permission String Parsing', () => {
  let service: RBACService;

  beforeEach(() => {
    service = createRBACService();
  });

  it('should correctly parse action:resource format', async () => {
    vi.spyOn(service, 'getEffectivePermissions').mockResolvedValueOnce([
      'read:intents',
      'create:policies',
      '*:*',
    ]);
    vi.spyOn(service, 'getEffectiveRoles').mockResolvedValueOnce(['admin']);

    const result = await service.evaluate({
      subjectId: 'user-123',
      subjectType: 'user',
      tenantId: 'tenant-456',
      action: ACTIONS.READ,
      resource: RESOURCES.INTENTS,
    });

    expect(result.evaluatedPermissions).toBeDefined();
    expect(result.evaluatedPermissions.length).toBeGreaterThan(0);
  });
});
