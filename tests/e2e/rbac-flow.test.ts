/**
 * RBAC E2E Tests
 *
 * Comprehensive end-to-end tests for Role-Based Access Control including:
 * - Create roles
 * - Assign permissions
 * - Assign roles to users
 * - Verify permission enforcement
 * - Role hierarchy
 *
 * Uses vitest with mocked external dependencies but tests full RBAC flows.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock stores
const mockRoleStore = new Map<string, Role>();
const mockPermissionStore = new Map<string, RolePermission[]>();
const mockUserRoleStore = new Map<string, UserRoleAssignment[]>();
const mockPermissionCacheStore = new Map<string, CachedPermissions>();

function resetStores(): void {
  mockRoleStore.clear();
  mockPermissionStore.clear();
  mockUserRoleStore.clear();
  mockPermissionCacheStore.clear();
}

// Mock configuration
vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: {
      secret: 'test-jwt-secret-minimum-32-characters-long',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1' },
    rbac: {
      cacheEnabled: true,
      cacheTTL: 300,
      maxRolesPerUser: 10,
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TYPES
// =============================================================================

const TEST_TENANT_ID = 'test-tenant-rbac-e2e';
const TEST_USER_ID = randomUUID();

type Action =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'execute'
  | 'approve'
  | 'reject'
  | 'escalate'
  | 'cancel'
  | 'manage'
  | 'assign'
  | 'revoke'
  | 'audit'
  | 'export'
  | '*';

type Resource =
  | 'intents'
  | 'policies'
  | 'escalations'
  | 'agents'
  | 'trust_scores'
  | 'trust_signals'
  | 'roles'
  | 'permissions'
  | 'users'
  | 'service_accounts'
  | 'audit_logs'
  | 'webhooks'
  | 'tenants'
  | 'settings'
  | '*';

interface Role {
  id: string;
  name: string;
  tenantId: string;
  parentRoleId?: string;
  isSystem: boolean;
  isActive: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface RolePermission {
  id: string;
  roleId: string;
  action: Action;
  resource: Resource;
  conditions?: PermissionCondition[];
  createdAt: Date;
}

interface PermissionCondition {
  type: 'owner' | 'group' | 'attribute' | 'time';
  field?: string;
  operator?: string;
  value?: unknown;
}

interface UserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  tenantId: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

interface CachedPermissions {
  userId: string;
  tenantId: string;
  permissions: Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }>;
  roles: string[];
  cachedAt: Date;
  expiresAt: Date;
}

interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  effectiveRoles: string[];
  matchedPermission?: { action: Action; resource: Resource };
  evaluationTimeMs: number;
}

// System roles definition
const SYSTEM_ROLES = {
  ADMIN: 'admin',
  TENANT_ADMIN: 'tenant:admin',
  POLICY_WRITER: 'policy_writer',
  POLICY_READER: 'policy_reader',
  INTENT_SUBMITTER: 'intent_submitter',
  ESCALATION_APPROVER: 'escalation_approver',
  AUDITOR: 'auditor',
  SERVICE_ACCOUNT: 'service_account',
} as const;

// System role permissions
const SYSTEM_ROLE_PERMISSIONS: Record<string, Array<{ action: Action; resource: Resource }>> = {
  [SYSTEM_ROLES.ADMIN]: [{ action: '*', resource: '*' }],
  [SYSTEM_ROLES.TENANT_ADMIN]: [
    { action: 'create', resource: 'intents' },
    { action: 'read', resource: 'intents' },
    { action: 'cancel', resource: 'intents' },
    { action: 'delete', resource: 'intents' },
    { action: 'create', resource: 'policies' },
    { action: 'read', resource: 'policies' },
    { action: 'update', resource: 'policies' },
    { action: 'delete', resource: 'policies' },
    { action: 'read', resource: 'escalations' },
    { action: 'approve', resource: 'escalations' },
    { action: 'reject', resource: 'escalations' },
    { action: 'create', resource: 'webhooks' },
    { action: 'read', resource: 'webhooks' },
    { action: 'update', resource: 'webhooks' },
    { action: 'delete', resource: 'webhooks' },
    { action: 'read', resource: 'audit_logs' },
    { action: 'manage', resource: 'users' },
    { action: 'assign', resource: 'roles' },
    { action: 'revoke', resource: 'roles' },
  ],
  [SYSTEM_ROLES.POLICY_WRITER]: [
    { action: 'create', resource: 'policies' },
    { action: 'read', resource: 'policies' },
    { action: 'update', resource: 'policies' },
    { action: 'read', resource: 'intents' },
  ],
  [SYSTEM_ROLES.POLICY_READER]: [
    { action: 'read', resource: 'policies' },
    { action: 'read', resource: 'intents' },
  ],
  [SYSTEM_ROLES.INTENT_SUBMITTER]: [
    { action: 'create', resource: 'intents' },
    { action: 'read', resource: 'intents' },
    { action: 'cancel', resource: 'intents' },
  ],
  [SYSTEM_ROLES.ESCALATION_APPROVER]: [
    { action: 'read', resource: 'intents' },
    { action: 'read', resource: 'escalations' },
    { action: 'approve', resource: 'escalations' },
    { action: 'reject', resource: 'escalations' },
  ],
  [SYSTEM_ROLES.AUDITOR]: [
    { action: 'read', resource: 'intents' },
    { action: 'read', resource: 'policies' },
    { action: 'read', resource: 'escalations' },
    { action: 'read', resource: 'audit_logs' },
    { action: 'export', resource: 'audit_logs' },
  ],
  [SYSTEM_ROLES.SERVICE_ACCOUNT]: [
    { action: 'create', resource: 'intents' },
    { action: 'read', resource: 'intents' },
  ],
};

// =============================================================================
// MOCK SERVICES
// =============================================================================

/**
 * Mock Role Service
 */
class MockRoleService {
  async createRole(data: {
    name: string;
    tenantId: string;
    parentRoleId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Role> {
    // Check for system role name conflict
    if (Object.values(SYSTEM_ROLES).includes(data.name as any)) {
      throw new Error('Cannot create role with system role name');
    }

    // Check for duplicate name
    for (const [, role] of mockRoleStore) {
      if (role.name === data.name && role.tenantId === data.tenantId) {
        throw new Error('Role name already exists');
      }
    }

    const role: Role = {
      id: randomUUID(),
      name: data.name,
      tenantId: data.tenantId,
      parentRoleId: data.parentRoleId,
      isSystem: false,
      isActive: true,
      metadata: data.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockRoleStore.set(role.id, role);
    mockPermissionStore.set(role.id, []);

    return role;
  }

  async getRole(roleId: string): Promise<Role | null> {
    return mockRoleStore.get(roleId) ?? null;
  }

  async getRoleByName(name: string, tenantId: string): Promise<Role | null> {
    for (const [, role] of mockRoleStore) {
      if (role.name === name && role.tenantId === tenantId) {
        return role;
      }
    }
    return null;
  }

  async getRolesForTenant(tenantId: string): Promise<Role[]> {
    const roles: Role[] = [];
    for (const [, role] of mockRoleStore) {
      if (role.tenantId === tenantId) {
        roles.push(role);
      }
    }
    return roles;
  }

  async updateRole(roleId: string, data: {
    name?: string;
    parentRoleId?: string | null;
    isActive?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<Role | null> {
    const role = mockRoleStore.get(roleId);
    if (!role) return null;

    if (role.isSystem) {
      throw new Error('Cannot modify system roles');
    }

    if (data.name !== undefined) role.name = data.name;
    if (data.parentRoleId !== undefined) role.parentRoleId = data.parentRoleId ?? undefined;
    if (data.isActive !== undefined) role.isActive = data.isActive;
    if (data.metadata !== undefined) role.metadata = data.metadata;
    role.updatedAt = new Date();

    mockRoleStore.set(roleId, role);
    return role;
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const role = mockRoleStore.get(roleId);
    if (!role) return false;

    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }

    mockRoleStore.delete(roleId);
    mockPermissionStore.delete(roleId);

    // Remove all user assignments
    for (const [userId, assignments] of mockUserRoleStore) {
      const filtered = assignments.filter(a => a.roleId !== roleId);
      mockUserRoleStore.set(userId, filtered);
    }

    return true;
  }

  async addPermission(roleId: string, permission: {
    action: Action;
    resource: Resource;
    conditions?: PermissionCondition[];
  }): Promise<RolePermission> {
    const role = mockRoleStore.get(roleId);
    if (!role) {
      throw new Error('Role not found');
    }

    if (role.isSystem) {
      throw new Error('Cannot modify system role permissions');
    }

    const rolePermissions = mockPermissionStore.get(roleId) ?? [];

    // Check for duplicate
    const exists = rolePermissions.some(
      p => p.action === permission.action && p.resource === permission.resource
    );
    if (exists) {
      throw new Error('Permission already exists');
    }

    const perm: RolePermission = {
      id: randomUUID(),
      roleId,
      action: permission.action,
      resource: permission.resource,
      conditions: permission.conditions,
      createdAt: new Date(),
    };

    rolePermissions.push(perm);
    mockPermissionStore.set(roleId, rolePermissions);

    // Invalidate cache for all users with this role
    await this.invalidateCacheForRole(roleId);

    return perm;
  }

  async removePermission(roleId: string, action: Action, resource: Resource): Promise<boolean> {
    const role = mockRoleStore.get(roleId);
    if (!role) return false;

    if (role.isSystem) {
      throw new Error('Cannot modify system role permissions');
    }

    const rolePermissions = mockPermissionStore.get(roleId) ?? [];
    const filtered = rolePermissions.filter(
      p => !(p.action === action && p.resource === resource)
    );

    mockPermissionStore.set(roleId, filtered);

    // Invalidate cache
    await this.invalidateCacheForRole(roleId);

    return rolePermissions.length !== filtered.length;
  }

  async getRolePermissions(roleId: string): Promise<RolePermission[]> {
    return mockPermissionStore.get(roleId) ?? [];
  }

  private async invalidateCacheForRole(roleId: string): Promise<void> {
    for (const [key, cache] of mockPermissionCacheStore) {
      if (cache.roles.includes(roleId)) {
        mockPermissionCacheStore.delete(key);
      }
    }
  }
}

/**
 * Mock User Role Service
 */
class MockUserRoleService {
  async assignRole(data: {
    userId: string;
    roleId: string;
    tenantId: string;
    grantedBy: string;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<UserRoleAssignment> {
    const role = mockRoleStore.get(data.roleId);
    if (!role) {
      throw new Error('Role not found');
    }

    const userRoles = mockUserRoleStore.get(`${data.userId}:${data.tenantId}`) ?? [];

    // Check for duplicate
    const exists = userRoles.some(a => a.roleId === data.roleId);
    if (exists) {
      throw new Error('User already has this role');
    }

    const assignment: UserRoleAssignment = {
      id: randomUUID(),
      userId: data.userId,
      roleId: data.roleId,
      tenantId: data.tenantId,
      grantedBy: data.grantedBy,
      grantedAt: new Date(),
      expiresAt: data.expiresAt,
      metadata: data.metadata,
    };

    userRoles.push(assignment);
    mockUserRoleStore.set(`${data.userId}:${data.tenantId}`, userRoles);

    // Invalidate permission cache
    mockPermissionCacheStore.delete(`${data.userId}:${data.tenantId}`);

    return assignment;
  }

  async revokeRole(userId: string, roleId: string, tenantId: string): Promise<boolean> {
    const key = `${userId}:${tenantId}`;
    const userRoles = mockUserRoleStore.get(key) ?? [];

    const filtered = userRoles.filter(a => a.roleId !== roleId);
    mockUserRoleStore.set(key, filtered);

    // Invalidate cache
    mockPermissionCacheStore.delete(key);

    return userRoles.length !== filtered.length;
  }

  async getUserRoles(userId: string, tenantId: string): Promise<UserRoleAssignment[]> {
    return mockUserRoleStore.get(`${userId}:${tenantId}`) ?? [];
  }

  async getUserRoleNames(userId: string, tenantId: string): Promise<string[]> {
    const assignments = await this.getUserRoles(userId, tenantId);
    const names: string[] = [];

    for (const assignment of assignments) {
      const role = mockRoleStore.get(assignment.roleId);
      if (role && role.isActive) {
        // Check expiration
        if (!assignment.expiresAt || assignment.expiresAt > new Date()) {
          names.push(role.name);
        }
      }
    }

    return names;
  }
}

/**
 * Mock RBAC Service (Permission Evaluation)
 */
class MockRBACService {
  private roleService: MockRoleService;
  private userRoleService: MockUserRoleService;

  constructor() {
    this.roleService = new MockRoleService();
    this.userRoleService = new MockUserRoleService();
  }

  async evaluate(params: {
    userId: string;
    tenantId: string;
    action: Action;
    resource: Resource;
    resourceId?: string;
    context?: Record<string, unknown>;
  }): Promise<PermissionCheckResult> {
    const startTime = Date.now();

    // Get effective permissions (with caching)
    const { permissions, roles } = await this.getEffectivePermissions(params.userId, params.tenantId);

    // Check for admin permission
    if (permissions.some(p => p.action === '*' && p.resource === '*')) {
      return {
        allowed: true,
        reason: 'Admin permission grants all access',
        effectiveRoles: roles,
        matchedPermission: { action: '*', resource: '*' },
        evaluationTimeMs: Date.now() - startTime,
      };
    }

    // Check for exact match
    let matched = permissions.find(
      p => p.action === params.action && p.resource === params.resource
    );

    // Check for wildcard action match
    if (!matched) {
      matched = permissions.find(
        p => p.action === '*' && p.resource === params.resource
      );
    }

    // Check for wildcard resource match
    if (!matched) {
      matched = permissions.find(
        p => p.action === params.action && p.resource === '*'
      );
    }

    if (matched) {
      // Check conditions if any
      if (matched.conditions && matched.conditions.length > 0) {
        const conditionsMet = await this.evaluateConditions(
          matched.conditions,
          params.userId,
          params.resourceId,
          params.context
        );

        if (!conditionsMet) {
          return {
            allowed: false,
            reason: 'Permission conditions not met',
            effectiveRoles: roles,
            evaluationTimeMs: Date.now() - startTime,
          };
        }
      }

      return {
        allowed: true,
        reason: `Permission granted by ${roles.join(', ')}`,
        effectiveRoles: roles,
        matchedPermission: { action: matched.action, resource: matched.resource },
        evaluationTimeMs: Date.now() - startTime,
      };
    }

    return {
      allowed: false,
      reason: `No permission found for ${params.action}:${params.resource}`,
      effectiveRoles: roles,
      evaluationTimeMs: Date.now() - startTime,
    };
  }

  async getEffectivePermissions(userId: string, tenantId: string): Promise<{
    permissions: Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }>;
    roles: string[];
  }> {
    // Check cache
    const cacheKey = `${userId}:${tenantId}`;
    const cached = mockPermissionCacheStore.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      return { permissions: cached.permissions, roles: cached.roles };
    }

    const permissions: Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }> = [];
    const roles: string[] = [];

    // Get user's role assignments
    const assignments = await this.userRoleService.getUserRoles(userId, tenantId);

    for (const assignment of assignments) {
      // Check expiration
      if (assignment.expiresAt && assignment.expiresAt <= new Date()) {
        continue;
      }

      const role = await this.roleService.getRole(assignment.roleId);
      if (!role || !role.isActive) continue;

      roles.push(role.name);

      // Get role permissions
      const rolePerms = await this.getRolePermissionsWithHierarchy(role);
      permissions.push(...rolePerms);
    }

    // Deduplicate permissions
    const uniquePerms = this.deduplicatePermissions(permissions);

    // Cache the result
    mockPermissionCacheStore.set(cacheKey, {
      userId,
      tenantId,
      permissions: uniquePerms,
      roles,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
    });

    return { permissions: uniquePerms, roles };
  }

  async getRolePermissionsWithHierarchy(role: Role): Promise<Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }>> {
    const permissions: Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }> = [];

    // Get direct permissions
    if (role.isSystem) {
      // System roles get their predefined permissions
      const systemPerms = SYSTEM_ROLE_PERMISSIONS[role.name] ?? [];
      permissions.push(...systemPerms);
    } else {
      const rolePerms = await this.roleService.getRolePermissions(role.id);
      permissions.push(...rolePerms.map(p => ({
        action: p.action,
        resource: p.resource,
        conditions: p.conditions,
      })));
    }

    // Get inherited permissions from parent role
    if (role.parentRoleId) {
      const parentRole = await this.roleService.getRole(role.parentRoleId);
      if (parentRole && parentRole.isActive) {
        const parentPerms = await this.getRolePermissionsWithHierarchy(parentRole);
        permissions.push(...parentPerms);
      }
    }

    return permissions;
  }

  async getSystemRolePermissions(roleName: string): Promise<Array<{ action: Action; resource: Resource }>> {
    return SYSTEM_ROLE_PERMISSIONS[roleName] ?? [];
  }

  private deduplicatePermissions(
    permissions: Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }>
  ): Array<{ action: Action; resource: Resource; conditions?: PermissionCondition[] }> {
    const seen = new Set<string>();
    return permissions.filter(p => {
      const key = `${p.action}:${p.resource}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async evaluateConditions(
    conditions: PermissionCondition[],
    userId: string,
    resourceId?: string,
    context?: Record<string, unknown>
  ): Promise<boolean> {
    for (const condition of conditions) {
      switch (condition.type) {
        case 'owner':
          // Check if user owns the resource
          if (context?.ownerId !== userId) {
            return false;
          }
          break;
        case 'group':
          // Check if user is in the required group
          if (condition.value && !context?.userGroups?.includes(condition.value)) {
            return false;
          }
          break;
        case 'time':
          // Check time-based conditions
          const now = new Date();
          if (condition.operator === 'between' && Array.isArray(condition.value)) {
            const [start, end] = condition.value;
            if (now < new Date(start) || now > new Date(end)) {
              return false;
            }
          }
          break;
        case 'attribute':
          // Check attribute-based conditions
          if (condition.field && condition.operator && condition.value !== undefined) {
            const actualValue = context?.[condition.field];
            if (!this.evaluateAttributeCondition(actualValue, condition.operator, condition.value)) {
              return false;
            }
          }
          break;
      }
    }
    return true;
  }

  private evaluateAttributeCondition(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'not_equals':
        return actual !== expected;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'contains':
        return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
      case 'greater_than':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'less_than':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      default:
        return false;
    }
  }

  async invalidateUserCache(userId: string, tenantId: string): Promise<void> {
    mockPermissionCacheStore.delete(`${userId}:${tenantId}`);
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('RBAC E2E Tests', () => {
  const roleService = new MockRoleService();
  const userRoleService = new MockUserRoleService();
  const rbacService = new MockRBACService();

  beforeEach(() => {
    resetStores();
    // Initialize system roles
    initializeSystemRoles();
  });

  function initializeSystemRoles(): void {
    for (const roleName of Object.values(SYSTEM_ROLES)) {
      const role: Role = {
        id: randomUUID(),
        name: roleName,
        tenantId: '', // System roles are tenant-agnostic
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRoleStore.set(role.id, role);
    }
  }

  // ===========================================================================
  // CREATE ROLES
  // ===========================================================================

  describe('Create Roles', () => {
    it('should create a new custom role', async () => {
      const role = await roleService.createRole({
        name: 'custom_reviewer',
        tenantId: TEST_TENANT_ID,
        metadata: { description: 'Custom reviewer role' },
      });

      expect(role.id).toBeDefined();
      expect(role.name).toBe('custom_reviewer');
      expect(role.tenantId).toBe(TEST_TENANT_ID);
      expect(role.isSystem).toBe(false);
      expect(role.isActive).toBe(true);
    });

    it('should not create role with system role name', async () => {
      await expect(
        roleService.createRole({
          name: SYSTEM_ROLES.ADMIN,
          tenantId: TEST_TENANT_ID,
        })
      ).rejects.toThrow('Cannot create role with system role name');
    });

    it('should not create duplicate role name in same tenant', async () => {
      await roleService.createRole({
        name: 'unique_role',
        tenantId: TEST_TENANT_ID,
      });

      await expect(
        roleService.createRole({
          name: 'unique_role',
          tenantId: TEST_TENANT_ID,
        })
      ).rejects.toThrow('Role name already exists');
    });

    it('should allow same role name in different tenants', async () => {
      const role1 = await roleService.createRole({
        name: 'shared_name',
        tenantId: TEST_TENANT_ID,
      });

      const role2 = await roleService.createRole({
        name: 'shared_name',
        tenantId: 'other-tenant',
      });

      expect(role1.id).not.toBe(role2.id);
      expect(role1.name).toBe(role2.name);
    });

    it('should create role with parent for hierarchy', async () => {
      const parentRole = await roleService.createRole({
        name: 'senior_reviewer',
        tenantId: TEST_TENANT_ID,
      });

      const childRole = await roleService.createRole({
        name: 'junior_reviewer',
        tenantId: TEST_TENANT_ID,
        parentRoleId: parentRole.id,
      });

      expect(childRole.parentRoleId).toBe(parentRole.id);
    });
  });

  // ===========================================================================
  // ASSIGN PERMISSIONS
  // ===========================================================================

  describe('Assign Permissions', () => {
    let customRole: Role;

    beforeEach(async () => {
      customRole = await roleService.createRole({
        name: 'test_role',
        tenantId: TEST_TENANT_ID,
      });
    });

    it('should add permission to role', async () => {
      const permission = await roleService.addPermission(customRole.id, {
        action: 'read',
        resource: 'intents',
      });

      expect(permission.id).toBeDefined();
      expect(permission.action).toBe('read');
      expect(permission.resource).toBe('intents');
    });

    it('should add multiple permissions to role', async () => {
      await roleService.addPermission(customRole.id, {
        action: 'read',
        resource: 'intents',
      });

      await roleService.addPermission(customRole.id, {
        action: 'create',
        resource: 'intents',
      });

      await roleService.addPermission(customRole.id, {
        action: 'read',
        resource: 'policies',
      });

      const permissions = await roleService.getRolePermissions(customRole.id);
      expect(permissions.length).toBe(3);
    });

    it('should not add duplicate permission', async () => {
      await roleService.addPermission(customRole.id, {
        action: 'read',
        resource: 'intents',
      });

      await expect(
        roleService.addPermission(customRole.id, {
          action: 'read',
          resource: 'intents',
        })
      ).rejects.toThrow('Permission already exists');
    });

    it('should add permission with conditions', async () => {
      const permission = await roleService.addPermission(customRole.id, {
        action: 'update',
        resource: 'intents',
        conditions: [
          { type: 'owner' },
          { type: 'attribute', field: 'status', operator: 'equals', value: 'pending' },
        ],
      });

      expect(permission.conditions).toBeDefined();
      expect(permission.conditions!.length).toBe(2);
    });

    it('should not modify system role permissions', async () => {
      const adminRole = Array.from(mockRoleStore.values()).find(r => r.name === SYSTEM_ROLES.ADMIN);

      await expect(
        roleService.addPermission(adminRole!.id, {
          action: 'read',
          resource: 'intents',
        })
      ).rejects.toThrow('Cannot modify system role permissions');
    });

    it('should remove permission from role', async () => {
      await roleService.addPermission(customRole.id, {
        action: 'read',
        resource: 'intents',
      });

      const removed = await roleService.removePermission(customRole.id, 'read', 'intents');
      expect(removed).toBe(true);

      const permissions = await roleService.getRolePermissions(customRole.id);
      expect(permissions.length).toBe(0);
    });
  });

  // ===========================================================================
  // ASSIGN ROLES TO USERS
  // ===========================================================================

  describe('Assign Roles to Users', () => {
    let customRole: Role;

    beforeEach(async () => {
      customRole = await roleService.createRole({
        name: 'assignable_role',
        tenantId: TEST_TENANT_ID,
      });
    });

    it('should assign role to user', async () => {
      const assignment = await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin-user',
      });

      expect(assignment.id).toBeDefined();
      expect(assignment.userId).toBe(TEST_USER_ID);
      expect(assignment.roleId).toBe(customRole.id);
    });

    it('should get user roles', async () => {
      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const roles = await userRoleService.getUserRoles(TEST_USER_ID, TEST_TENANT_ID);
      expect(roles.length).toBe(1);
      expect(roles[0].roleId).toBe(customRole.id);
    });

    it('should get user role names', async () => {
      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const roleNames = await userRoleService.getUserRoleNames(TEST_USER_ID, TEST_TENANT_ID);
      expect(roleNames).toContain('assignable_role');
    });

    it('should not assign same role twice', async () => {
      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      await expect(
        userRoleService.assignRole({
          userId: TEST_USER_ID,
          roleId: customRole.id,
          tenantId: TEST_TENANT_ID,
          grantedBy: 'admin',
        })
      ).rejects.toThrow('User already has this role');
    });

    it('should assign role with expiration', async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const assignment = await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
        expiresAt,
      });

      expect(assignment.expiresAt).toBeDefined();
      expect(assignment.expiresAt!.getTime()).toBe(expiresAt.getTime());
    });

    it('should revoke role from user', async () => {
      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const revoked = await userRoleService.revokeRole(TEST_USER_ID, customRole.id, TEST_TENANT_ID);
      expect(revoked).toBe(true);

      const roles = await userRoleService.getUserRoles(TEST_USER_ID, TEST_TENANT_ID);
      expect(roles.length).toBe(0);
    });

    it('should isolate roles by tenant', async () => {
      const otherTenantRole = await roleService.createRole({
        name: 'other_tenant_role',
        tenantId: 'other-tenant',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: customRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: otherTenantRole.id,
        tenantId: 'other-tenant',
        grantedBy: 'admin',
      });

      const tenant1Roles = await userRoleService.getUserRoles(TEST_USER_ID, TEST_TENANT_ID);
      const tenant2Roles = await userRoleService.getUserRoles(TEST_USER_ID, 'other-tenant');

      expect(tenant1Roles.length).toBe(1);
      expect(tenant2Roles.length).toBe(1);
      expect(tenant1Roles[0].roleId).not.toBe(tenant2Roles[0].roleId);
    });
  });

  // ===========================================================================
  // VERIFY PERMISSION ENFORCEMENT
  // ===========================================================================

  describe('Verify Permission Enforcement', () => {
    it('should allow action with matching permission', async () => {
      const role = await roleService.createRole({
        name: 'intent_reader',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: 'read',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const result = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'intents',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny action without matching permission', async () => {
      const role = await roleService.createRole({
        name: 'intent_reader_only',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: 'read',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const result = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'create',
        resource: 'intents',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow all actions for admin role', async () => {
      const adminRole = Array.from(mockRoleStore.values()).find(r => r.name === SYSTEM_ROLES.ADMIN);

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: adminRole!.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'system',
      });

      const result = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'delete',
        resource: 'tenants',
      });

      expect(result.allowed).toBe(true);
      expect(result.matchedPermission?.action).toBe('*');
      expect(result.matchedPermission?.resource).toBe('*');
    });

    it('should respect wildcard action permission', async () => {
      const role = await roleService.createRole({
        name: 'intent_manager',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: '*',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const createResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'create',
        resource: 'intents',
      });

      const deleteResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'delete',
        resource: 'intents',
      });

      expect(createResult.allowed).toBe(true);
      expect(deleteResult.allowed).toBe(true);
    });

    it('should evaluate conditions on permission', async () => {
      const role = await roleService.createRole({
        name: 'conditional_editor',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: 'update',
        resource: 'intents',
        conditions: [{ type: 'owner' }],
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // User is owner
      const allowedResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'update',
        resource: 'intents',
        context: { ownerId: TEST_USER_ID },
      });

      expect(allowedResult.allowed).toBe(true);

      // User is not owner
      const deniedResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'update',
        resource: 'intents',
        context: { ownerId: 'other-user' },
      });

      expect(deniedResult.allowed).toBe(false);
      expect(deniedResult.reason).toBe('Permission conditions not met');
    });

    it('should not grant permissions from expired roles', async () => {
      const role = await roleService.createRole({
        name: 'temporary_role',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: 'read',
        resource: 'intents',
      });

      // Assign with expiration in the past
      const assignment: UserRoleAssignment = {
        id: randomUUID(),
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
        grantedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000), // Already expired
      };

      mockUserRoleStore.set(`${TEST_USER_ID}:${TEST_TENANT_ID}`, [assignment]);

      const result = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'intents',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // ROLE HIERARCHY
  // ===========================================================================

  describe('Role Hierarchy', () => {
    it('should inherit permissions from parent role', async () => {
      const parentRole = await roleService.createRole({
        name: 'base_role',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(parentRole.id, {
        action: 'read',
        resource: 'intents',
      });

      const childRole = await roleService.createRole({
        name: 'extended_role',
        tenantId: TEST_TENANT_ID,
        parentRoleId: parentRole.id,
      });

      await roleService.addPermission(childRole.id, {
        action: 'create',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: childRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Should have permission from child role
      const createResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'create',
        resource: 'intents',
      });
      expect(createResult.allowed).toBe(true);

      // Should have permission inherited from parent role
      const readResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'intents',
      });
      expect(readResult.allowed).toBe(true);
    });

    it('should support multi-level hierarchy', async () => {
      const grandparentRole = await roleService.createRole({
        name: 'level_1',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(grandparentRole.id, {
        action: 'read',
        resource: 'intents',
      });

      const parentRole = await roleService.createRole({
        name: 'level_2',
        tenantId: TEST_TENANT_ID,
        parentRoleId: grandparentRole.id,
      });

      await roleService.addPermission(parentRole.id, {
        action: 'create',
        resource: 'intents',
      });

      const childRole = await roleService.createRole({
        name: 'level_3',
        tenantId: TEST_TENANT_ID,
        parentRoleId: parentRole.id,
      });

      await roleService.addPermission(childRole.id, {
        action: 'update',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: childRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Should have all three levels of permissions
      const readResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'intents',
      });
      expect(readResult.allowed).toBe(true);

      const createResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'create',
        resource: 'intents',
      });
      expect(createResult.allowed).toBe(true);

      const updateResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'update',
        resource: 'intents',
      });
      expect(updateResult.allowed).toBe(true);
    });

    it('should not inherit from inactive parent', async () => {
      const parentRole = await roleService.createRole({
        name: 'inactive_parent',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(parentRole.id, {
        action: 'read',
        resource: 'intents',
      });

      // Deactivate parent
      await roleService.updateRole(parentRole.id, { isActive: false });

      const childRole = await roleService.createRole({
        name: 'active_child',
        tenantId: TEST_TENANT_ID,
        parentRoleId: parentRole.id,
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: childRole.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      const result = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'intents',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // SYSTEM ROLES
  // ===========================================================================

  describe('System Roles', () => {
    it('should have predefined permissions for system roles', async () => {
      const permissions = await rbacService.getSystemRolePermissions(SYSTEM_ROLES.POLICY_WRITER);

      expect(permissions).toContainEqual({ action: 'create', resource: 'policies' });
      expect(permissions).toContainEqual({ action: 'read', resource: 'policies' });
      expect(permissions).toContainEqual({ action: 'update', resource: 'policies' });
    });

    it('should not allow deleting system roles', async () => {
      const adminRole = Array.from(mockRoleStore.values()).find(r => r.name === SYSTEM_ROLES.ADMIN);

      await expect(
        roleService.deleteRole(adminRole!.id)
      ).rejects.toThrow('Cannot delete system roles');
    });

    it('should enforce escalation approver permissions', async () => {
      const approverRole = Array.from(mockRoleStore.values()).find(
        r => r.name === SYSTEM_ROLES.ESCALATION_APPROVER
      );

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: approverRole!.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Should be able to approve escalations
      const approveResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'approve',
        resource: 'escalations',
      });
      expect(approveResult.allowed).toBe(true);

      // Should not be able to create intents
      const createResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'create',
        resource: 'intents',
      });
      expect(createResult.allowed).toBe(false);
    });

    it('should enforce auditor read-only permissions', async () => {
      const auditorRole = Array.from(mockRoleStore.values()).find(
        r => r.name === SYSTEM_ROLES.AUDITOR
      );

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: auditorRole!.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Should be able to read and export audit logs
      const readResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'read',
        resource: 'audit_logs',
      });
      expect(readResult.allowed).toBe(true);

      const exportResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'export',
        resource: 'audit_logs',
      });
      expect(exportResult.allowed).toBe(true);

      // Should not be able to delete anything
      const deleteResult = await rbacService.evaluate({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        action: 'delete',
        resource: 'intents',
      });
      expect(deleteResult.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // PERMISSION CACHING
  // ===========================================================================

  describe('Permission Caching', () => {
    it('should cache effective permissions', async () => {
      const role = await roleService.createRole({
        name: 'cached_role',
        tenantId: TEST_TENANT_ID,
      });

      await roleService.addPermission(role.id, {
        action: 'read',
        resource: 'intents',
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // First call populates cache
      await rbacService.getEffectivePermissions(TEST_USER_ID, TEST_TENANT_ID);

      // Verify cache exists
      const cacheKey = `${TEST_USER_ID}:${TEST_TENANT_ID}`;
      const cached = mockPermissionCacheStore.get(cacheKey);

      expect(cached).toBeDefined();
      expect(cached!.permissions.length).toBeGreaterThan(0);
    });

    it('should invalidate cache on role assignment', async () => {
      const role = await roleService.createRole({
        name: 'invalidate_test_role',
        tenantId: TEST_TENANT_ID,
      });

      // Populate cache
      await rbacService.getEffectivePermissions(TEST_USER_ID, TEST_TENANT_ID);

      // Assign role (should invalidate cache)
      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Cache should be cleared
      const cacheKey = `${TEST_USER_ID}:${TEST_TENANT_ID}`;
      const cached = mockPermissionCacheStore.get(cacheKey);

      expect(cached).toBeUndefined();
    });

    it('should invalidate cache on role revocation', async () => {
      const role = await roleService.createRole({
        name: 'revoke_test_role',
        tenantId: TEST_TENANT_ID,
      });

      await userRoleService.assignRole({
        userId: TEST_USER_ID,
        roleId: role.id,
        tenantId: TEST_TENANT_ID,
        grantedBy: 'admin',
      });

      // Populate cache
      await rbacService.getEffectivePermissions(TEST_USER_ID, TEST_TENANT_ID);

      // Revoke role (should invalidate cache)
      await userRoleService.revokeRole(TEST_USER_ID, role.id, TEST_TENANT_ID);

      // Cache should be cleared
      const cacheKey = `${TEST_USER_ID}:${TEST_TENANT_ID}`;
      const cached = mockPermissionCacheStore.get(cacheKey);

      expect(cached).toBeUndefined();
    });
  });
});
