/**
 * RBAC Store
 *
 * Database operations for role-based access control.
 * Handles CRUD operations for roles, permissions, and role assignments.
 *
 * @packageDocumentation
 */

import { eq, and, or, isNull, lte, sql } from 'drizzle-orm';
import { getDatabase } from '../common/db.js';
import { createLogger } from '../common/logger.js';
import { type TenantContext, extractTenantId } from '../common/tenant-context.js';
import type { ID } from '../common/types.js';
import {
  roles,
  rolePermissions,
  userRoles,
  serviceAccountRoles,
  type RoleRow,
  type NewRoleRow,
  type RolePermissionRow,
  type NewRolePermissionRow,
  type UserRoleRow,
  type NewUserRoleRow,
  type ServiceAccountRoleRow,
  type NewServiceAccountRoleRow,
} from '../intent/schema.js';
import {
  SYSTEM_ROLES,
  type Permission,
  type Role,
  type UserRole,
  type ServiceAccountRole,
  type Action,
  type Resource,
} from './types.js';
import { getDefaultPermissions, isSystemRole } from './default-permissions.js';

const logger = createLogger({ component: 'rbac-store' });

// =============================================================================
// RBAC STORE
// =============================================================================

export class RBACStore {
  // ===========================================================================
  // ROLE OPERATIONS
  // ===========================================================================

  /**
   * Create a new role
   */
  async createRole(
    ctx: TenantContext,
    data: {
      name: string;
      description?: string;
      tenantId?: ID | null;
      parentRoleId?: ID | null;
      isSystem?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RoleRow> {
    const tenantId = data.tenantId ?? extractTenantId(ctx);
    const db = getDatabase();

    logger.info({ name: data.name, tenantId }, 'Creating role');

    const [role] = await db
      .insert(roles)
      .values({
        name: data.name,
        description: data.description,
        tenantId,
        parentRoleId: data.parentRoleId,
        isSystem: data.isSystem ?? false,
        isActive: true,
        metadata: data.metadata,
      })
      .returning();

    return role;
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId: ID): Promise<RoleRow | null> {
    const db = getDatabase();
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    return role ?? null;
  }

  /**
   * Get role by name within tenant
   */
  async getRoleByName(name: string, tenantId?: ID | null): Promise<RoleRow | null> {
    const db = getDatabase();
    const condition = tenantId
      ? and(eq(roles.name, name), eq(roles.tenantId, tenantId))
      : and(eq(roles.name, name), isNull(roles.tenantId));

    const [role] = await db.select().from(roles).where(condition).limit(1);
    return role ?? null;
  }

  /**
   * Get all roles for a tenant (including global/system roles)
   */
  async getRolesForTenant(tenantId: ID): Promise<RoleRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(roles)
      .where(
        and(
          or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)),
          eq(roles.isActive, true)
        )
      )
      .orderBy(roles.name);
  }

  /**
   * Update a role
   */
  async updateRole(
    roleId: ID,
    data: Partial<{
      name: string;
      description: string | null;
      parentRoleId: ID | null;
      isActive: boolean;
      metadata: Record<string, unknown>;
    }>
  ): Promise<RoleRow | null> {
    const db = getDatabase();

    const [role] = await db
      .update(roles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId))
      .returning();

    return role ?? null;
  }

  /**
   * Delete a role (soft delete by setting isActive to false)
   */
  async deleteRole(roleId: ID): Promise<boolean> {
    const db = getDatabase();

    const [role] = await db
      .update(roles)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(roles.id, roleId))
      .returning();

    return role !== undefined;
  }

  /**
   * Hard delete a role (use with caution)
   */
  async hardDeleteRole(roleId: ID): Promise<boolean> {
    const db = getDatabase();
    const result = await db.delete(roles).where(eq(roles.id, roleId));
    return (result.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // ROLE PERMISSION OPERATIONS
  // ===========================================================================

  /**
   * Add permission to a role
   */
  async addRolePermission(
    roleId: ID,
    permission: Permission
  ): Promise<RolePermissionRow> {
    const db = getDatabase();

    const [rolePerm] = await db
      .insert(rolePermissions)
      .values({
        roleId,
        action: permission.action,
        resource: permission.resource,
        conditions: permission.conditions,
      })
      .onConflictDoNothing()
      .returning();

    return rolePerm;
  }

  /**
   * Add multiple permissions to a role
   */
  async addRolePermissions(
    roleId: ID,
    permissions: Permission[]
  ): Promise<RolePermissionRow[]> {
    if (permissions.length === 0) return [];

    const db = getDatabase();

    const values = permissions.map((p) => ({
      roleId,
      action: p.action,
      resource: p.resource,
      conditions: p.conditions,
    }));

    return db
      .insert(rolePermissions)
      .values(values)
      .onConflictDoNothing()
      .returning();
  }

  /**
   * Get permissions for a role
   */
  async getRolePermissions(roleId: ID): Promise<RolePermissionRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
  }

  /**
   * Remove permission from a role
   */
  async removeRolePermission(
    roleId: ID,
    action: Action,
    resource: Resource
  ): Promise<boolean> {
    const db = getDatabase();
    const result = await db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.action, action),
          eq(rolePermissions.resource, resource)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Clear all permissions for a role
   */
  async clearRolePermissions(roleId: ID): Promise<void> {
    const db = getDatabase();
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  }

  // ===========================================================================
  // USER ROLE OPERATIONS
  // ===========================================================================

  /**
   * Assign role to user
   */
  async assignRoleToUser(
    ctx: TenantContext,
    data: {
      userId: ID;
      roleId: ID;
      tenantId?: ID;
      grantedBy?: ID;
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    }
  ): Promise<UserRoleRow> {
    const tenantId = data.tenantId ?? extractTenantId(ctx);
    const db = getDatabase();

    logger.info(
      { userId: data.userId, roleId: data.roleId, tenantId },
      'Assigning role to user'
    );

    const [userRole] = await db
      .insert(userRoles)
      .values({
        userId: data.userId,
        roleId: data.roleId,
        tenantId,
        grantedBy: data.grantedBy,
        expiresAt: data.expiresAt,
        metadata: data.metadata,
      })
      .onConflictDoNothing()
      .returning();

    return userRole;
  }

  /**
   * Get user's role assignments for a tenant
   */
  async getUserRoles(userId: ID, tenantId: ID): Promise<UserRoleRow[]> {
    const db = getDatabase();
    const now = new Date();

    return db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          or(isNull(userRoles.expiresAt), lte(sql`${now}`, userRoles.expiresAt))
        )
      );
  }

  /**
   * Get user's role names for a tenant (including inherited system roles)
   */
  async getUserRoleNames(userId: ID, tenantId: ID): Promise<string[]> {
    const db = getDatabase();
    const now = new Date();

    const result = await db
      .select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          eq(roles.isActive, true),
          or(isNull(userRoles.expiresAt), lte(sql`${now}`, userRoles.expiresAt))
        )
      );

    return result.map((r) => r.roleName);
  }

  /**
   * Revoke role from user
   */
  async revokeRoleFromUser(userId: ID, roleId: ID, tenantId: ID): Promise<boolean> {
    const db = getDatabase();
    const result = await db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.tenantId, tenantId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Check if user has a specific role
   */
  async userHasRole(userId: ID, roleId: ID, tenantId: ID): Promise<boolean> {
    const db = getDatabase();
    const now = new Date();

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.tenantId, tenantId),
          or(isNull(userRoles.expiresAt), lte(sql`${now}`, userRoles.expiresAt))
        )
      );

    return (result?.count ?? 0) > 0;
  }

  // ===========================================================================
  // SERVICE ACCOUNT ROLE OPERATIONS
  // ===========================================================================

  /**
   * Assign role to service account
   */
  async assignRoleToServiceAccount(
    ctx: TenantContext,
    data: {
      serviceAccountId: ID;
      roleId: ID;
      tenantId?: ID;
      grantedBy?: ID;
      expiresAt?: Date;
    }
  ): Promise<ServiceAccountRoleRow> {
    const tenantId = data.tenantId ?? extractTenantId(ctx);
    const db = getDatabase();

    logger.info(
      { serviceAccountId: data.serviceAccountId, roleId: data.roleId, tenantId },
      'Assigning role to service account'
    );

    const [saRole] = await db
      .insert(serviceAccountRoles)
      .values({
        serviceAccountId: data.serviceAccountId,
        roleId: data.roleId,
        tenantId,
        grantedBy: data.grantedBy,
        expiresAt: data.expiresAt,
      })
      .onConflictDoNothing()
      .returning();

    return saRole;
  }

  /**
   * Get service account's role assignments
   */
  async getServiceAccountRoles(serviceAccountId: ID, tenantId: ID): Promise<ServiceAccountRoleRow[]> {
    const db = getDatabase();
    const now = new Date();

    return db
      .select()
      .from(serviceAccountRoles)
      .where(
        and(
          eq(serviceAccountRoles.serviceAccountId, serviceAccountId),
          eq(serviceAccountRoles.tenantId, tenantId),
          or(
            isNull(serviceAccountRoles.expiresAt),
            lte(sql`${now}`, serviceAccountRoles.expiresAt)
          )
        )
      );
  }

  /**
   * Get service account's role names
   */
  async getServiceAccountRoleNames(serviceAccountId: ID, tenantId: ID): Promise<string[]> {
    const db = getDatabase();
    const now = new Date();

    const result = await db
      .select({ roleName: roles.name })
      .from(serviceAccountRoles)
      .innerJoin(roles, eq(serviceAccountRoles.roleId, roles.id))
      .where(
        and(
          eq(serviceAccountRoles.serviceAccountId, serviceAccountId),
          eq(serviceAccountRoles.tenantId, tenantId),
          eq(roles.isActive, true),
          or(
            isNull(serviceAccountRoles.expiresAt),
            lte(sql`${now}`, serviceAccountRoles.expiresAt)
          )
        )
      );

    return result.map((r) => r.roleName);
  }

  /**
   * Revoke role from service account
   */
  async revokeRoleFromServiceAccount(
    serviceAccountId: ID,
    roleId: ID,
    tenantId: ID
  ): Promise<boolean> {
    const db = getDatabase();
    const result = await db
      .delete(serviceAccountRoles)
      .where(
        and(
          eq(serviceAccountRoles.serviceAccountId, serviceAccountId),
          eq(serviceAccountRoles.roleId, roleId),
          eq(serviceAccountRoles.tenantId, tenantId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // PERMISSION QUERIES
  // ===========================================================================

  /**
   * Get all effective permissions for a user (combines all role permissions)
   */
  async getEffectiveUserPermissions(userId: ID, tenantId: ID): Promise<Permission[]> {
    const roleNames = await this.getUserRoleNames(userId, tenantId);
    return this.getPermissionsForRoles(roleNames, tenantId);
  }

  /**
   * Get all effective permissions for a service account
   */
  async getEffectiveServiceAccountPermissions(
    serviceAccountId: ID,
    tenantId: ID
  ): Promise<Permission[]> {
    const roleNames = await this.getServiceAccountRoleNames(serviceAccountId, tenantId);
    return this.getPermissionsForRoles(roleNames, tenantId);
  }

  /**
   * Get permissions for a list of role names
   */
  async getPermissionsForRoles(roleNames: string[], tenantId: ID): Promise<Permission[]> {
    const permissions: Permission[] = [];
    const seenPermissions = new Set<string>();

    for (const roleName of roleNames) {
      // Check if it's a system role
      if (isSystemRole(roleName)) {
        const defaultPerms = getDefaultPermissions(roleName);
        for (const perm of defaultPerms) {
          const key = `${perm.action}:${perm.resource}`;
          if (!seenPermissions.has(key)) {
            seenPermissions.add(key);
            permissions.push(perm);
          }
        }
        continue;
      }

      // Get custom role permissions from database
      const role = await this.getRoleByName(roleName, tenantId);
      if (role) {
        const rolePerms = await this.getRolePermissions(role.id);
        for (const perm of rolePerms) {
          const key = `${perm.action}:${perm.resource}`;
          if (!seenPermissions.has(key)) {
            seenPermissions.add(key);
            permissions.push({
              action: perm.action as Action,
              resource: perm.resource as Resource,
              conditions: perm.conditions as Permission['conditions'],
            });
          }
        }
      }
    }

    return permissions;
  }

  // ===========================================================================
  // CLEANUP OPERATIONS
  // ===========================================================================

  /**
   * Remove expired role assignments
   */
  async cleanupExpiredRoleAssignments(): Promise<{ users: number; serviceAccounts: number }> {
    const db = getDatabase();
    const now = new Date();

    const userResult = await db
      .delete(userRoles)
      .where(
        and(lte(userRoles.expiresAt, now), sql`${userRoles.expiresAt} IS NOT NULL`)
      );

    const saResult = await db
      .delete(serviceAccountRoles)
      .where(
        and(
          lte(serviceAccountRoles.expiresAt, now),
          sql`${serviceAccountRoles.expiresAt} IS NOT NULL`
        )
      );

    const counts = {
      users: userResult.rowCount ?? 0,
      serviceAccounts: saResult.rowCount ?? 0,
    };

    if (counts.users > 0 || counts.serviceAccounts > 0) {
      logger.info(counts, 'Cleaned up expired role assignments');
    }

    return counts;
  }

  // ===========================================================================
  // SYSTEM ROLE INITIALIZATION
  // ===========================================================================

  /**
   * Initialize system roles in the database
   */
  async initializeSystemRoles(): Promise<void> {
    const db = getDatabase();

    for (const roleName of Object.values(SYSTEM_ROLES)) {
      const existing = await this.getRoleByName(roleName, null);
      if (!existing) {
        await db.insert(roles).values({
          name: roleName,
          description: `System role: ${roleName}`,
          tenantId: null,
          isSystem: true,
          isActive: true,
        });
        logger.info({ role: roleName }, 'Created system role');
      }
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let rbacStore: RBACStore | null = null;

export function getRBACStore(): RBACStore {
  if (!rbacStore) {
    rbacStore = new RBACStore();
  }
  return rbacStore;
}

export function createRBACStore(): RBACStore {
  return new RBACStore();
}
