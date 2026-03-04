/**
 * Authentication and Authorization Integration Tests
 *
 * Tests JWT validation, role-based access control, and tenant isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

const mockTenantMembershipStore = new Map<string, any>();
const mockGroupMembershipStore = new Map<string, any>();
const mockRevokedTokenStore = new Set<string>();

function resetStores(): void {
  mockTenantMembershipStore.clear();
  mockGroupMembershipStore.clear();
  mockRevokedTokenStore.clear();
}

vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: {
      secret: 'test-secret-key-for-testing-12345',
      requireJti: true, // Enable JTI requirement for testing
      expiration: '1h',
      refreshExpiration: '7d',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1', rateLimit: 1000 },
    redis: { host: 'localhost', port: 6379, db: 0 },
    intent: {
      defaultNamespace: 'default',
      trustGates: { 'high-risk': 3 },
      defaultMinTrustLevel: 0,
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
// SERVICE IMPLEMENTATIONS
// =============================================================================

/**
 * JWT Token Service
 */
class MockJwtService {
  private secret = 'test-secret-key-for-testing-12345';

  createToken(payload: {
    sub: string;
    tenantId: string;
    roles?: string[];
    groups?: string[];
    jti?: string;
    exp?: number;
    iat?: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.sub,
      tenantId: payload.tenantId,
      roles: payload.roles ?? ['user'],
      groups: payload.groups ?? [],
      jti: payload.jti ?? randomUUID(),
      iat: payload.iat ?? now,
      exp: payload.exp ?? now + 3600,
    };

    // Simplified mock JWT (not cryptographically valid)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
    const signature = 'mock-signature';
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): { valid: boolean; payload?: any; error?: string } {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }

      // Check JTI revocation
      if (payload.jti && mockRevokedTokenStore.has(payload.jti)) {
        return { valid: false, error: 'Token has been revoked' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'Token parsing failed' };
    }
  }

  revokeToken(jti: string): void {
    mockRevokedTokenStore.add(jti);
  }

  isRevoked(jti: string): boolean {
    return mockRevokedTokenStore.has(jti);
  }
}

/**
 * Role-Based Access Control Service
 */
class MockRbacService {
  private rolePermissions: Record<string, string[]> = {
    'admin': ['*'],
    'tenant:admin': [
      'intent:create', 'intent:read', 'intent:cancel', 'intent:delete',
      'policy:create', 'policy:read', 'policy:update', 'policy:publish', 'policy:delete',
      'escalation:read', 'escalation:resolve',
      'webhook:create', 'webhook:read', 'webhook:update', 'webhook:delete',
      'audit:read',
    ],
    'policy_writer': [
      'intent:read',
      'policy:create', 'policy:read', 'policy:update',
    ],
    'policy_reader': [
      'policy:read',
    ],
    'intent_submitter': [
      'intent:create', 'intent:read', 'intent:cancel',
    ],
    'escalation_reviewer': [
      'intent:read',
      'escalation:read', 'escalation:resolve',
    ],
    'auditor': [
      'intent:read',
      'policy:read',
      'escalation:read',
      'audit:read',
    ],
    'user': [
      'intent:create', 'intent:read',
    ],
    'readonly': [
      'intent:read',
      'policy:read',
    ],
  };

  hasPermission(roles: string[], permission: string): boolean {
    for (const role of roles) {
      const perms = this.rolePermissions[role];
      if (!perms) continue;

      // Admin has all permissions
      if (perms.includes('*')) return true;

      // Check exact permission
      if (perms.includes(permission)) return true;

      // Check wildcard permissions (e.g., 'intent:*')
      const [resource, action] = permission.split(':');
      if (perms.includes(`${resource}:*`)) return true;
    }
    return false;
  }

  getEffectivePermissions(roles: string[]): string[] {
    const permissions = new Set<string>();
    for (const role of roles) {
      const perms = this.rolePermissions[role];
      if (perms) {
        perms.forEach(p => permissions.add(p));
      }
    }
    return Array.from(permissions);
  }

  validateRoleHierarchy(userRoles: string[], targetRole: string): boolean {
    // Admin can manage all roles
    if (userRoles.includes('admin')) return true;
    // Tenant admin can manage non-admin roles
    if (userRoles.includes('tenant:admin') && targetRole !== 'admin') return true;
    return false;
  }
}

/**
 * Tenant Membership Service
 */
class MockTenantMembershipService {
  async addMembership(
    userId: string,
    tenantId: string,
    role: 'owner' | 'admin' | 'member' | 'readonly' = 'member'
  ): Promise<{ id: string }> {
    const key = `${userId}:${tenantId}`;
    const membership = {
      id: randomUUID(),
      userId,
      tenantId,
      role,
      createdAt: new Date().toISOString(),
    };
    mockTenantMembershipStore.set(key, membership);
    return { id: membership.id };
  }

  async getMembership(userId: string, tenantId: string): Promise<any | null> {
    return mockTenantMembershipStore.get(`${userId}:${tenantId}`) ?? null;
  }

  async verifyAccess(userId: string, tenantId: string): Promise<{
    hasAccess: boolean;
    role?: string;
    reason?: string;
  }> {
    const membership = await this.getMembership(userId, tenantId);
    if (!membership) {
      return { hasAccess: false, reason: 'User is not a member of this tenant' };
    }
    return { hasAccess: true, role: membership.role };
  }

  async removeMembership(userId: string, tenantId: string): Promise<boolean> {
    const key = `${userId}:${tenantId}`;
    if (mockTenantMembershipStore.has(key)) {
      mockTenantMembershipStore.delete(key);
      return true;
    }
    return false;
  }

  async listTenantMembers(tenantId: string): Promise<any[]> {
    const members: any[] = [];
    const entries = Array.from(mockTenantMembershipStore.values());
    for (const membership of entries) {
      if (membership.tenantId === tenantId) {
        members.push(membership);
      }
    }
    return members;
  }
}

/**
 * Group Membership Service (Database-verified)
 */
class MockGroupMembershipService {
  async addMembership(
    userId: string,
    tenantId: string,
    groupName: string
  ): Promise<{ id: string }> {
    const key = `${userId}:${tenantId}:${groupName}`;
    const membership = {
      id: randomUUID(),
      userId,
      tenantId,
      groupName,
      active: true,
      createdAt: new Date().toISOString(),
    };
    mockGroupMembershipStore.set(key, membership);
    return { id: membership.id };
  }

  async verifyGroupMembership(
    userId: string,
    tenantId: string,
    groupName: string
  ): Promise<boolean> {
    const key = `${userId}:${tenantId}:${groupName}`;
    const membership = mockGroupMembershipStore.get(key);
    return membership?.active === true;
  }

  async getUserGroups(userId: string, tenantId: string): Promise<string[]> {
    const groups: string[] = [];
    const entries = Array.from(mockGroupMembershipStore.values());
    for (const membership of entries) {
      if (membership.userId === userId && membership.tenantId === tenantId && membership.active) {
        groups.push(membership.groupName);
      }
    }
    return groups;
  }

  async removeMembership(
    userId: string,
    tenantId: string,
    groupName: string
  ): Promise<boolean> {
    const key = `${userId}:${tenantId}:${groupName}`;
    if (mockGroupMembershipStore.has(key)) {
      mockGroupMembershipStore.delete(key);
      return true;
    }
    return false;
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Authentication and Authorization Integration Tests', () => {
  let jwtService: MockJwtService;
  let rbacService: MockRbacService;
  let tenantService: MockTenantMembershipService;
  let groupService: MockGroupMembershipService;

  const testTenantId = 'test-tenant-123';
  const testUserId = randomUUID();

  beforeAll(() => {
    jwtService = new MockJwtService();
    rbacService = new MockRbacService();
    tenantService = new MockTenantMembershipService();
    groupService = new MockGroupMembershipService();
  });

  beforeEach(() => {
    resetStores();
  });

  // ===========================================================================
  // 1. JWT Token Validation
  // ===========================================================================
  describe('JWT Token Validation', () => {
    it('should validate a valid token', () => {
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        roles: ['user'],
      });

      const result = jwtService.verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload.sub).toBe(testUserId);
      expect(result.payload.tenantId).toBe(testTenantId);
    });

    it('should reject expired token', () => {
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      });

      const result = jwtService.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should reject malformed token', () => {
      const result = jwtService.verifyToken('not.a.valid.token');
      expect(result.valid).toBe(false);
    });

    it('should reject token with missing parts', () => {
      const result = jwtService.verifyToken('only.two');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject revoked token', () => {
      const jti = randomUUID();
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        jti,
      });

      // Token should be valid initially
      expect(jwtService.verifyToken(token).valid).toBe(true);

      // Revoke the token
      jwtService.revokeToken(jti);

      // Token should now be invalid
      const result = jwtService.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has been revoked');
    });

    it('should check revocation status', () => {
      const jti = randomUUID();
      expect(jwtService.isRevoked(jti)).toBe(false);

      jwtService.revokeToken(jti);
      expect(jwtService.isRevoked(jti)).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Role-Based Access Control
  // ===========================================================================
  describe('Role-Based Access Control', () => {
    it('should grant admin all permissions', () => {
      expect(rbacService.hasPermission(['admin'], 'intent:create')).toBe(true);
      expect(rbacService.hasPermission(['admin'], 'policy:delete')).toBe(true);
      expect(rbacService.hasPermission(['admin'], 'audit:read')).toBe(true);
      expect(rbacService.hasPermission(['admin'], 'any:permission')).toBe(true);
    });

    it('should grant tenant:admin appropriate permissions', () => {
      const roles = ['tenant:admin'];
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(true);
      expect(rbacService.hasPermission(roles, 'policy:publish')).toBe(true);
      expect(rbacService.hasPermission(roles, 'webhook:delete')).toBe(true);
      expect(rbacService.hasPermission(roles, 'audit:read')).toBe(true);
    });

    it('should restrict policy_writer to policy operations', () => {
      const roles = ['policy_writer'];
      expect(rbacService.hasPermission(roles, 'policy:create')).toBe(true);
      expect(rbacService.hasPermission(roles, 'policy:update')).toBe(true);
      expect(rbacService.hasPermission(roles, 'policy:delete')).toBe(false);
      expect(rbacService.hasPermission(roles, 'policy:publish')).toBe(false);
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(false);
    });

    it('should allow intent_submitter to submit and view intents', () => {
      const roles = ['intent_submitter'];
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:cancel')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:delete')).toBe(false);
    });

    it('should allow escalation_reviewer to resolve escalations', () => {
      const roles = ['escalation_reviewer'];
      expect(rbacService.hasPermission(roles, 'escalation:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'escalation:resolve')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(false);
    });

    it('should restrict auditor to read-only operations', () => {
      const roles = ['auditor'];
      expect(rbacService.hasPermission(roles, 'audit:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'policy:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(false);
      expect(rbacService.hasPermission(roles, 'policy:update')).toBe(false);
    });

    it('should restrict readonly to viewing only', () => {
      const roles = ['readonly'];
      expect(rbacService.hasPermission(roles, 'intent:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'policy:read')).toBe(true);
      expect(rbacService.hasPermission(roles, 'intent:create')).toBe(false);
    });

    it('should combine permissions from multiple roles', () => {
      const roles = ['policy_writer', 'escalation_reviewer'];
      expect(rbacService.hasPermission(roles, 'policy:create')).toBe(true);
      expect(rbacService.hasPermission(roles, 'escalation:resolve')).toBe(true);
    });

    it('should return effective permissions for roles', () => {
      const roles = ['policy_writer'];
      const permissions = rbacService.getEffectivePermissions(roles);
      expect(permissions).toContain('policy:create');
      expect(permissions).toContain('policy:read');
      expect(permissions).toContain('policy:update');
      expect(permissions).toContain('intent:read');
    });

    it('should validate role hierarchy for admin', () => {
      expect(rbacService.validateRoleHierarchy(['admin'], 'tenant:admin')).toBe(true);
      expect(rbacService.validateRoleHierarchy(['admin'], 'policy_writer')).toBe(true);
    });

    it('should validate role hierarchy for tenant:admin', () => {
      expect(rbacService.validateRoleHierarchy(['tenant:admin'], 'policy_writer')).toBe(true);
      expect(rbacService.validateRoleHierarchy(['tenant:admin'], 'admin')).toBe(false);
    });

    it('should not allow regular user to manage roles', () => {
      expect(rbacService.validateRoleHierarchy(['user'], 'policy_writer')).toBe(false);
    });
  });

  // ===========================================================================
  // 3. Tenant Isolation
  // ===========================================================================
  describe('Tenant Isolation', () => {
    it('should verify user has access to tenant', async () => {
      await tenantService.addMembership(testUserId, testTenantId, 'member');

      const result = await tenantService.verifyAccess(testUserId, testTenantId);
      expect(result.hasAccess).toBe(true);
      expect(result.role).toBe('member');
    });

    it('should deny access to non-member', async () => {
      const result = await tenantService.verifyAccess(testUserId, testTenantId);
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('User is not a member of this tenant');
    });

    it('should enforce tenant isolation between users', async () => {
      const user1 = randomUUID();
      const user2 = randomUUID();
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';

      await tenantService.addMembership(user1, tenant1, 'member');
      await tenantService.addMembership(user2, tenant2, 'member');

      // User1 should only access tenant1
      expect((await tenantService.verifyAccess(user1, tenant1)).hasAccess).toBe(true);
      expect((await tenantService.verifyAccess(user1, tenant2)).hasAccess).toBe(false);

      // User2 should only access tenant2
      expect((await tenantService.verifyAccess(user2, tenant1)).hasAccess).toBe(false);
      expect((await tenantService.verifyAccess(user2, tenant2)).hasAccess).toBe(true);
    });

    it('should track different roles per tenant', async () => {
      const userId = randomUUID();
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';

      await tenantService.addMembership(userId, tenant1, 'admin');
      await tenantService.addMembership(userId, tenant2, 'readonly');

      const access1 = await tenantService.verifyAccess(userId, tenant1);
      const access2 = await tenantService.verifyAccess(userId, tenant2);

      expect(access1.role).toBe('admin');
      expect(access2.role).toBe('readonly');
    });

    it('should remove membership', async () => {
      await tenantService.addMembership(testUserId, testTenantId, 'member');
      expect((await tenantService.verifyAccess(testUserId, testTenantId)).hasAccess).toBe(true);

      await tenantService.removeMembership(testUserId, testTenantId);
      expect((await tenantService.verifyAccess(testUserId, testTenantId)).hasAccess).toBe(false);
    });

    it('should list tenant members', async () => {
      const user1 = randomUUID();
      const user2 = randomUUID();
      const user3 = randomUUID();

      await tenantService.addMembership(user1, testTenantId, 'admin');
      await tenantService.addMembership(user2, testTenantId, 'member');
      await tenantService.addMembership(user3, 'other-tenant', 'member');

      const members = await tenantService.listTenantMembers(testTenantId);
      expect(members.length).toBe(2);
      expect(members.map(m => m.userId).sort()).toEqual([user1, user2].sort());
    });
  });

  // ===========================================================================
  // 4. Database-Verified Group Membership
  // ===========================================================================
  describe('Database-Verified Group Membership', () => {
    it('should verify group membership from database', async () => {
      await groupService.addMembership(testUserId, testTenantId, 'governance-team');

      const isMember = await groupService.verifyGroupMembership(
        testUserId,
        testTenantId,
        'governance-team'
      );
      expect(isMember).toBe(true);
    });

    it('should deny unverified group membership', async () => {
      const isMember = await groupService.verifyGroupMembership(
        testUserId,
        testTenantId,
        'governance-team'
      );
      expect(isMember).toBe(false);
    });

    it('should get all user groups', async () => {
      await groupService.addMembership(testUserId, testTenantId, 'governance-team');
      await groupService.addMembership(testUserId, testTenantId, 'security-team');

      const groups = await groupService.getUserGroups(testUserId, testTenantId);
      expect(groups.sort()).toEqual(['governance-team', 'security-team']);
    });

    it('should isolate groups by tenant', async () => {
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';

      await groupService.addMembership(testUserId, tenant1, 'team-a');
      await groupService.addMembership(testUserId, tenant2, 'team-b');

      expect(await groupService.getUserGroups(testUserId, tenant1)).toEqual(['team-a']);
      expect(await groupService.getUserGroups(testUserId, tenant2)).toEqual(['team-b']);
    });

    it('should remove group membership', async () => {
      await groupService.addMembership(testUserId, testTenantId, 'test-group');
      expect(await groupService.verifyGroupMembership(testUserId, testTenantId, 'test-group')).toBe(true);

      await groupService.removeMembership(testUserId, testTenantId, 'test-group');
      expect(await groupService.verifyGroupMembership(testUserId, testTenantId, 'test-group')).toBe(false);
    });

    it('should NOT trust JWT group claims (security requirement)', async () => {
      // This is a conceptual test - in real implementation, escalation resolution
      // should ALWAYS verify group membership from database, not JWT claims

      // User claims these groups via JWT
      const jwtGroupClaims = ['governance-team', 'admin-team'];

      // But database shows only one membership
      await groupService.addMembership(testUserId, testTenantId, 'governance-team');

      // Verification should use database, not JWT claims
      const governanceAccess = await groupService.verifyGroupMembership(
        testUserId,
        testTenantId,
        'governance-team'
      );
      const adminAccess = await groupService.verifyGroupMembership(
        testUserId,
        testTenantId,
        'admin-team'
      );

      expect(governanceAccess).toBe(true); // In database
      expect(adminAccess).toBe(false); // NOT in database, even if in JWT
    });
  });

  // ===========================================================================
  // 5. Authorization Flow Integration
  // ===========================================================================
  describe('Authorization Flow Integration', () => {
    it('should complete full authorization check', async () => {
      // Setup: User with token, tenant membership, and group membership
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        roles: ['policy_writer'],
        groups: ['governance-team'],
      });

      await tenantService.addMembership(testUserId, testTenantId, 'member');
      await groupService.addMembership(testUserId, testTenantId, 'governance-team');

      // Step 1: Verify token
      const tokenResult = jwtService.verifyToken(token);
      expect(tokenResult.valid).toBe(true);

      // Step 2: Verify tenant access
      const tenantAccess = await tenantService.verifyAccess(
        tokenResult.payload.sub,
        tokenResult.payload.tenantId
      );
      expect(tenantAccess.hasAccess).toBe(true);

      // Step 3: Check permissions
      expect(rbacService.hasPermission(tokenResult.payload.roles, 'policy:create')).toBe(true);

      // Step 4: Verify group membership (for escalation)
      const groupAccess = await groupService.verifyGroupMembership(
        tokenResult.payload.sub,
        tokenResult.payload.tenantId,
        'governance-team'
      );
      expect(groupAccess).toBe(true);
    });

    it('should fail authorization with revoked token', async () => {
      const jti = randomUUID();
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        roles: ['admin'],
        jti,
      });

      // Initially valid
      expect(jwtService.verifyToken(token).valid).toBe(true);

      // Revoke token
      jwtService.revokeToken(jti);

      // Now fails at first step
      const tokenResult = jwtService.verifyToken(token);
      expect(tokenResult.valid).toBe(false);
    });

    it('should fail authorization without tenant membership', async () => {
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        roles: ['admin'],
      });

      // Token is valid
      const tokenResult = jwtService.verifyToken(token);
      expect(tokenResult.valid).toBe(true);

      // But no tenant membership
      const tenantAccess = await tenantService.verifyAccess(
        tokenResult.payload.sub,
        tokenResult.payload.tenantId
      );
      expect(tenantAccess.hasAccess).toBe(false);
    });

    it('should fail authorization without required permission', async () => {
      const token = jwtService.createToken({
        sub: testUserId,
        tenantId: testTenantId,
        roles: ['readonly'], // Limited role
      });

      await tenantService.addMembership(testUserId, testTenantId, 'member');

      const tokenResult = jwtService.verifyToken(token);
      expect(tokenResult.valid).toBe(true);

      // Has tenant access
      const tenantAccess = await tenantService.verifyAccess(
        tokenResult.payload.sub,
        tokenResult.payload.tenantId
      );
      expect(tenantAccess.hasAccess).toBe(true);

      // But lacks permission
      expect(rbacService.hasPermission(tokenResult.payload.roles, 'intent:create')).toBe(false);
    });
  });
});
