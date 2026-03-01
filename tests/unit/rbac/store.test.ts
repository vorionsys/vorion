/**
 * RBAC Store Unit Tests
 *
 * Tests for database operations in the RBAC store.
 * Uses mocked database for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a mock that supports method chaining and is also a thenable
function createChainableMock(defaultValue: any = []): any {
  const mock: any = vi.fn();

  // Make it thenable (Promise-like)
  mock.then = vi.fn((resolve: any) => Promise.resolve(defaultValue).then(resolve));

  // All chainable methods return the mock itself
  const methods = [
    'select', 'from', 'where', 'limit', 'orderBy', 'innerJoin',
    'insert', 'values', 'onConflictDoNothing', 'update', 'set',
    'delete', 'returning'
  ];

  methods.forEach(method => {
    mock[method] = vi.fn(() => mock);
  });

  return mock;
}

// Create the mock db instance
const mockDb = createChainableMock();

// Mock the database module - must be before imports that use it
vi.mock('../../../src/common/db.js', () => ({
  getDatabase: () => mockDb,
}));

// Now import after mocks are set up
import { RBACStore, createRBACStore } from '../../../src/rbac/store.js';
import { SYSTEM_ROLES } from '../../../src/rbac/types.js';

// Helper to reset mockDb for each test and configure return values
function resetMockDb() {
  // Reset all method mocks
  Object.keys(mockDb).forEach(key => {
    if (typeof mockDb[key]?.mockClear === 'function') {
      mockDb[key].mockClear();
    }
  });

  // Re-establish the chain
  const methods = [
    'select', 'from', 'where', 'limit', 'orderBy', 'innerJoin',
    'insert', 'values', 'onConflictDoNothing', 'update', 'set', 'delete'
  ];

  methods.forEach(method => {
    mockDb[method] = vi.fn(() => mockDb);
  });

  // By default, resolve to empty array (for destructuring like [role])
  mockDb.returning = vi.fn().mockResolvedValue([]);
  mockDb.then = vi.fn((resolve: any) => Promise.resolve([]).then(resolve));
}

// Mock tenant context
const mockTenantContext = {
  tenantId: 'test-tenant-123',
  userId: 'test-user-456',
  roles: ['user'],
  permissions: [],
  createdAt: Date.now(),
} as any;

describe('RBACStore', () => {
  let store: RBACStore;

  beforeEach(() => {
    resetMockDb();
    store = createRBACStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createRBACStore', () => {
    it('should create a new store instance', () => {
      const newStore = createRBACStore();
      expect(newStore).toBeInstanceOf(RBACStore);
    });
  });

  describe('Role Operations', () => {
    describe('createRole', () => {
      it('should create a role with required fields', async () => {
        const mockRole = {
          id: 'role-123',
          name: 'test-role',
          tenantId: 'test-tenant-123',
          isSystem: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockDb.returning.mockResolvedValueOnce([mockRole]);

        const result = await store.createRole(mockTenantContext, {
          name: 'test-role',
          description: 'Test role description',
        });

        expect(mockDb.insert).toHaveBeenCalled();
        expect(mockDb.values).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'test-role',
            description: 'Test role description',
            tenantId: 'test-tenant-123',
            isSystem: false,
            isActive: true,
          })
        );
        expect(result).toEqual(mockRole);
      });

      it('should allow creating role with parent role', async () => {
        const mockRole = {
          id: 'role-456',
          name: 'child-role',
          parentRoleId: 'parent-role-123',
          tenantId: 'test-tenant-123',
          isSystem: false,
          isActive: true,
        };

        mockDb.returning.mockResolvedValueOnce([mockRole]);

        await store.createRole(mockTenantContext, {
          name: 'child-role',
          parentRoleId: 'parent-role-123',
        });

        expect(mockDb.values).toHaveBeenCalledWith(
          expect.objectContaining({
            parentRoleId: 'parent-role-123',
          })
        );
      });
    });

    describe('getRoleById', () => {
      it('should return role when found', async () => {
        const mockRole = {
          id: 'role-123',
          name: 'test-role',
          tenantId: 'test-tenant-123',
        };

        mockDb.limit.mockResolvedValueOnce([mockRole]);

        const result = await store.getRoleById('role-123');

        expect(mockDb.select).toHaveBeenCalled();
        expect(result).toEqual(mockRole);
      });

      it('should return null when role not found', async () => {
        mockDb.limit.mockResolvedValueOnce([]);

        const result = await store.getRoleById('nonexistent-role');

        expect(result).toBeNull();
      });
    });

    describe('getRoleByName', () => {
      it('should find role by name and tenant', async () => {
        const mockRole = {
          id: 'role-123',
          name: 'admin',
          tenantId: 'test-tenant-123',
        };

        mockDb.limit.mockResolvedValueOnce([mockRole]);

        const result = await store.getRoleByName('admin', 'test-tenant-123');

        expect(mockDb.where).toHaveBeenCalled();
        expect(result).toEqual(mockRole);
      });

      it('should find global role when tenantId is null', async () => {
        const mockRole = {
          id: 'role-system',
          name: SYSTEM_ROLES.SUPER_ADMIN,
          tenantId: null,
          isSystem: true,
        };

        mockDb.limit.mockResolvedValueOnce([mockRole]);

        const result = await store.getRoleByName(SYSTEM_ROLES.SUPER_ADMIN, null);

        expect(result).toEqual(mockRole);
      });
    });

    describe('updateRole', () => {
      it('should update role fields', async () => {
        const updatedRole = {
          id: 'role-123',
          name: 'updated-role',
          description: 'Updated description',
        };

        mockDb.returning.mockResolvedValueOnce([updatedRole]);

        const result = await store.updateRole('role-123', {
          name: 'updated-role',
          description: 'Updated description',
        });

        expect(mockDb.update).toHaveBeenCalled();
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'updated-role',
            description: 'Updated description',
          })
        );
        expect(result).toEqual(updatedRole);
      });

      it('should return null when role not found', async () => {
        mockDb.returning.mockResolvedValueOnce([]);

        const result = await store.updateRole('nonexistent', { name: 'new-name' });

        expect(result).toBeNull();
      });
    });

    describe('deleteRole', () => {
      it('should soft delete role by setting isActive to false', async () => {
        mockDb.returning.mockResolvedValueOnce([{ id: 'role-123', isActive: false }]);

        const result = await store.deleteRole('role-123');

        expect(mockDb.update).toHaveBeenCalled();
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            isActive: false,
          })
        );
        expect(result).toBe(true);
      });

      it('should return false when role not found', async () => {
        mockDb.returning.mockResolvedValueOnce([]);

        const result = await store.deleteRole('nonexistent');

        expect(result).toBe(false);
      });
    });
  });

  describe('Role Permission Operations', () => {
    describe('addRolePermission', () => {
      it('should add permission to role', async () => {
        const mockPermission = {
          id: 'perm-123',
          roleId: 'role-123',
          action: 'read',
          resource: 'intents',
        };

        mockDb.returning.mockResolvedValueOnce([mockPermission]);

        const result = await store.addRolePermission('role-123', {
          action: 'read',
          resource: 'intents',
        });

        expect(mockDb.insert).toHaveBeenCalled();
        expect(result).toEqual(mockPermission);
      });

      it('should handle permission with conditions', async () => {
        const mockPermission = {
          id: 'perm-456',
          roleId: 'role-123',
          action: 'read',
          resource: 'intents',
          conditions: [{ type: 'owned' }],
        };

        mockDb.returning.mockResolvedValueOnce([mockPermission]);

        await store.addRolePermission('role-123', {
          action: 'read',
          resource: 'intents',
          conditions: [{ type: 'owned' }],
        });

        expect(mockDb.values).toHaveBeenCalledWith(
          expect.objectContaining({
            conditions: [{ type: 'owned' }],
          })
        );
      });
    });

    describe('getRolePermissions', () => {
      it('should return all permissions for a role', async () => {
        const mockPermissions = [
          { id: 'perm-1', roleId: 'role-123', action: 'read', resource: 'intents' },
          { id: 'perm-2', roleId: 'role-123', action: 'create', resource: 'intents' },
        ];

        mockDb.where.mockResolvedValueOnce(mockPermissions);

        const result = await store.getRolePermissions('role-123');

        expect(result).toHaveLength(2);
        expect(result).toEqual(mockPermissions);
      });
    });

    describe('removeRolePermission', () => {
      it('should remove specific permission from role', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: 1 }),
        });

        const result = await store.removeRolePermission('role-123', 'read' as any, 'intents' as any);

        expect(result).toBe(true);
      });

      it('should return false when permission not found', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: 0 }),
        });

        const result = await store.removeRolePermission('role-123', 'delete' as any, 'intents' as any);

        expect(result).toBe(false);
      });

      it('should handle undefined rowCount gracefully', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: undefined }),
        });

        const result = await store.removeRolePermission('role-123', 'read' as any, 'intents' as any);

        expect(result).toBe(false);
      });
    });
  });

  describe('User Role Operations', () => {
    describe('assignRoleToUser', () => {
      it('should assign role to user', async () => {
        const mockAssignment = {
          id: 'assignment-123',
          userId: 'user-456',
          roleId: 'role-789',
          tenantId: 'test-tenant-123',
          grantedAt: new Date(),
        };

        mockDb.returning.mockResolvedValueOnce([mockAssignment]);

        const result = await store.assignRoleToUser(mockTenantContext, {
          userId: 'user-456',
          roleId: 'role-789',
        });

        expect(mockDb.insert).toHaveBeenCalled();
        expect(result).toEqual(mockAssignment);
      });

      it('should support expiring role assignments', async () => {
        const expiresAt = new Date(Date.now() + 86400000); // 24 hours
        const mockAssignment = {
          id: 'assignment-456',
          userId: 'user-456',
          roleId: 'role-789',
          tenantId: 'test-tenant-123',
          expiresAt,
        };

        mockDb.returning.mockResolvedValueOnce([mockAssignment]);

        await store.assignRoleToUser(mockTenantContext, {
          userId: 'user-456',
          roleId: 'role-789',
          expiresAt,
        });

        expect(mockDb.values).toHaveBeenCalledWith(
          expect.objectContaining({
            expiresAt,
          })
        );
      });
    });

    describe('getUserRoles', () => {
      it('should return user role assignments', async () => {
        const mockAssignments = [
          { id: 'a1', userId: 'user-456', roleId: 'role-1', tenantId: 'test-tenant-123' },
          { id: 'a2', userId: 'user-456', roleId: 'role-2', tenantId: 'test-tenant-123' },
        ];

        mockDb.where.mockResolvedValueOnce(mockAssignments);

        const result = await store.getUserRoles('user-456', 'test-tenant-123');

        expect(result).toHaveLength(2);
      });
    });

    describe('getUserRoleNames', () => {
      it('should return role names for user', async () => {
        const mockResults = [
          { roleName: 'admin' },
          { roleName: 'user' },
        ];

        mockDb.where.mockResolvedValueOnce(mockResults);

        const result = await store.getUserRoleNames('user-456', 'test-tenant-123');

        expect(result).toEqual(['admin', 'user']);
      });
    });

    describe('revokeRoleFromUser', () => {
      it('should revoke role from user', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: 1 }),
        });

        const result = await store.revokeRoleFromUser('user-456', 'role-789', 'test-tenant-123');

        expect(result).toBe(true);
      });

      it('should return false when assignment not found', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: 0 }),
        });

        const result = await store.revokeRoleFromUser('user-456', 'nonexistent', 'test-tenant-123');

        expect(result).toBe(false);
      });

      it('should handle undefined rowCount gracefully', async () => {
        mockDb.delete.mockReturnValue({
          where: vi.fn().mockResolvedValueOnce({ rowCount: undefined }),
        });

        const result = await store.revokeRoleFromUser('user-456', 'role-789', 'test-tenant-123');

        expect(result).toBe(false);
      });
    });

    describe('userHasRole', () => {
      it('should return true when user has role', async () => {
        mockDb.where.mockResolvedValueOnce([{ count: 1 }]);

        const result = await store.userHasRole('user-456', 'role-789', 'test-tenant-123');

        expect(result).toBe(true);
      });

      it('should return false when user does not have role', async () => {
        mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

        const result = await store.userHasRole('user-456', 'role-789', 'test-tenant-123');

        expect(result).toBe(false);
      });
    });
  });

  describe('System Role Operations', () => {
    describe('initializeSystemRoles', () => {
      it('should create all system roles', async () => {
        // Mock getRoleByName to return null (role doesn't exist)
        mockDb.limit.mockResolvedValue([]);
        mockDb.returning.mockResolvedValue([{ id: 'new-role' }]);

        await store.initializeSystemRoles();

        // Should attempt to create each system role
        const systemRoleCount = Object.values(SYSTEM_ROLES).length;
        expect(mockDb.insert).toHaveBeenCalledTimes(systemRoleCount);
      });
    });
  });

  describe('Cleanup Operations', () => {
    describe('cleanupExpiredRoleAssignments', () => {
      it('should remove expired user role assignments', async () => {
        // Create mock for sequential delete calls
        const mockWhereResults = [
          { rowCount: 5 },  // First delete (user roles)
          { rowCount: 2 },  // Second delete (service account roles)
        ];
        let callIndex = 0;

        mockDb.delete.mockImplementation(() => ({
          where: vi.fn().mockImplementation(() =>
            Promise.resolve(mockWhereResults[callIndex++] || { rowCount: 0 })
          ),
        }));

        const result = await store.cleanupExpiredRoleAssignments();

        expect(result).toEqual({
          users: 5,
          serviceAccounts: 2,
        });
      });

      it('should handle undefined rowCount gracefully', async () => {
        // Create mock for sequential delete calls with undefined rowCount
        const mockWhereResults = [
          { rowCount: undefined },  // First delete (user roles)
          { rowCount: undefined },  // Second delete (service account roles)
        ];
        let callIndex = 0;

        mockDb.delete.mockImplementation(() => ({
          where: vi.fn().mockImplementation(() =>
            Promise.resolve(mockWhereResults[callIndex++] || { rowCount: 0 })
          ),
        }));

        const result = await store.cleanupExpiredRoleAssignments();

        expect(result).toEqual({
          users: 0,
          serviceAccounts: 0,
        });
      });

      it('should return zero counts when no expired assignments exist', async () => {
        const mockWhereResults = [
          { rowCount: 0 },  // First delete (user roles)
          { rowCount: 0 },  // Second delete (service account roles)
        ];
        let callIndex = 0;

        mockDb.delete.mockImplementation(() => ({
          where: vi.fn().mockImplementation(() =>
            Promise.resolve(mockWhereResults[callIndex++] || { rowCount: 0 })
          ),
        }));

        const result = await store.cleanupExpiredRoleAssignments();

        expect(result).toEqual({
          users: 0,
          serviceAccounts: 0,
        });
      });
    });
  });
});
