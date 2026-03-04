/**
 * RBAC Service
 *
 * Core service for role-based access control.
 * Handles permission evaluation, role management, and caching.
 *
 * @packageDocumentation
 */

import { eq, and, or, isNull, lte, sql } from 'drizzle-orm';
import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';
import { getDatabase } from '../common/db.js';
import { type TenantContext, extractTenantId } from '../common/tenant-context.js';
import type { ID } from '../common/types.js';
import {
  roles,
  rolePermissions,
  userRoles,
  serviceAccountRoles,
} from '../intent/schema.js';
import {
  ACTIONS,
  RESOURCES,
  SYSTEM_ROLES,
  type Action,
  type Resource,
  type Permission,
  type PermissionCondition,
  type PermissionString,
  type Role,
  type UserRole,
  type AuthSubject,
  type AuthResource,
  type AuthContext,
  type AuthDecision,
  type AuthEnvironment,
  type PermissionEvalRequest,
  type PermissionEvalResult,
  type CreateRoleOptions,
  type UpdateRoleOptions,
  type AssignRoleOptions,
  type RevokeRoleOptions,
} from './types.js';
import { getDefaultPermissions, isSystemRole, getRoleLevel } from './default-permissions.js';

const logger = createLogger({ component: 'rbac-service' });

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

const CACHE_PREFIX = 'rbac:';
const CACHE_TTL_SECONDS = 300; // 5 minutes
const PERMISSION_CACHE_KEY = (subjectId: string, tenantId: string) =>
  `${CACHE_PREFIX}perms:${tenantId}:${subjectId}`;
const ROLE_CACHE_KEY = (roleId: string) => `${CACHE_PREFIX}role:${roleId}`;

// =============================================================================
// RBAC SERVICE
// =============================================================================

export class RBACService {
  private localCache: Map<string, { data: unknown; expires: number }> = new Map();

  /**
   * Evaluate if a subject has permission to perform an action on a resource
   */
  async evaluate(request: PermissionEvalRequest): Promise<PermissionEvalResult> {
    const startTime = performance.now();

    logger.debug(
      {
        subjectId: request.subjectId,
        action: request.action,
        resource: request.resource,
        resourceId: request.resourceId,
      },
      'Evaluating RBAC permission'
    );

    // Get effective permissions for the subject
    const effectivePermissions = await this.getEffectivePermissions(
      request.subjectId,
      request.subjectType,
      request.tenantId
    );

    // Get effective roles
    const effectiveRoles = await this.getEffectiveRoles(
      request.subjectId,
      request.subjectType,
      request.tenantId
    );

    // Evaluate each permission
    const evaluatedPermissions: PermissionEvalResult['evaluatedPermissions'] = [];
    let allowed = false;
    let matchReason = 'No matching permission found';

    for (const permission of effectivePermissions) {
      const [permAction, permResource] = this.parsePermissionString(permission);

      // Check action match
      const actionMatches = permAction === ACTIONS.ALL || permAction === request.action;
      if (!actionMatches) {
        evaluatedPermissions.push({
          permission,
          matched: false,
          reason: 'Action does not match',
        });
        continue;
      }

      // Check resource match
      const resourceMatches = permResource === RESOURCES.ALL || permResource === request.resource;
      if (!resourceMatches) {
        evaluatedPermissions.push({
          permission,
          matched: false,
          reason: 'Resource does not match',
        });
        continue;
      }

      // Permission matches!
      allowed = true;
      matchReason = `Matched permission: ${permission}`;
      evaluatedPermissions.push({
        permission,
        matched: true,
        reason: matchReason,
      });

      // We found a match, can stop evaluating (unless we want to log all matches)
      break;
    }

    const evaluationTimeMs = performance.now() - startTime;

    const result: PermissionEvalResult = {
      allowed,
      reason: matchReason,
      evaluatedPermissions,
      effectiveRoles,
      evaluationTimeMs,
    };

    logger.debug(
      {
        subjectId: request.subjectId,
        action: request.action,
        resource: request.resource,
        allowed,
        evaluationTimeMs,
      },
      'RBAC evaluation complete'
    );

    return result;
  }

  /**
   * Quick check if subject has a specific permission
   */
  async hasPermission(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID,
    action: Action,
    resource: Resource
  ): Promise<boolean> {
    const result = await this.evaluate({
      subjectId,
      subjectType,
      tenantId,
      action,
      resource,
    });
    return result.allowed;
  }

  /**
   * Check if subject has any of the specified permissions
   */
  async hasAnyPermission(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID,
    permissions: Array<{ action: Action; resource: Resource }>
  ): Promise<boolean> {
    for (const { action, resource } of permissions) {
      if (await this.hasPermission(subjectId, subjectType, tenantId, action, resource)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if subject has all of the specified permissions
   */
  async hasAllPermissions(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID,
    permissions: Array<{ action: Action; resource: Resource }>
  ): Promise<boolean> {
    for (const { action, resource } of permissions) {
      if (!(await this.hasPermission(subjectId, subjectType, tenantId, action, resource))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get effective permissions for a subject (with caching)
   */
  async getEffectivePermissions(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID
  ): Promise<PermissionString[]> {
    const cacheKey = PERMISSION_CACHE_KEY(subjectId, tenantId);

    // Check local cache first
    const cached = this.getFromLocalCache<PermissionString[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Check Redis cache
    try {
      const redis = getRedis();
      const redisValue = await redis.get(cacheKey);
      if (redisValue) {
        const permissions = JSON.parse(redisValue) as PermissionString[];
        this.setLocalCache(cacheKey, permissions);
        return permissions;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to read from Redis cache');
    }

    // Cache miss - compute permissions
    const roles = await this.getEffectiveRoles(subjectId, subjectType, tenantId);
    const permissions = new Set<PermissionString>();

    for (const roleName of roles) {
      const rolePermissions = await this.getRolePermissions(roleName, tenantId);
      for (const permission of rolePermissions) {
        permissions.add(this.permissionToString(permission));
      }
    }

    const permissionArray = Array.from(permissions);

    // Cache the result
    this.setLocalCache(cacheKey, permissionArray);
    try {
      const redis = getRedis();
      await redis.set(cacheKey, JSON.stringify(permissionArray), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn({ error }, 'Failed to write to Redis cache');
    }

    return permissionArray;
  }

  /**
   * Get effective roles for a subject (includes inherited roles)
   */
  async getEffectiveRoles(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID
  ): Promise<string[]> {
    // Get assigned roles from database
    const assignedRoles = await this.getAssignedRoles(subjectId, subjectType, tenantId);

    // Add inherited roles
    const effectiveRoles = new Set<string>(assignedRoles);

    for (const roleName of assignedRoles) {
      const inherited = await this.getInheritedRoles(roleName, tenantId);
      for (const inheritedRole of inherited) {
        effectiveRoles.add(inheritedRole);
      }
    }

    return Array.from(effectiveRoles);
  }

  /**
   * Get roles directly assigned to a subject
   */
  private async getAssignedRoles(
    subjectId: ID,
    subjectType: 'user' | 'service_account',
    tenantId: ID
  ): Promise<string[]> {
    const db = getDatabase();
    const now = new Date();

    try {
      let roleNames: string[];

      if (subjectType === 'service_account') {
        // Query service_account_roles table joined with roles
        const result = await db
          .select({ roleName: roles.name })
          .from(serviceAccountRoles)
          .innerJoin(roles, eq(serviceAccountRoles.roleId, roles.id))
          .where(
            and(
              eq(serviceAccountRoles.serviceAccountId, subjectId),
              eq(serviceAccountRoles.tenantId, tenantId),
              eq(roles.isActive, true),
              or(
                isNull(serviceAccountRoles.expiresAt),
                lte(sql`${now}`, serviceAccountRoles.expiresAt)
              )
            )
          );

        roleNames = result.map((r) => r.roleName);
      } else {
        // Query user_roles table joined with roles
        const result = await db
          .select({ roleName: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(
            and(
              eq(userRoles.userId, subjectId),
              eq(userRoles.tenantId, tenantId),
              eq(roles.isActive, true),
              or(
                isNull(userRoles.expiresAt),
                lte(sql`${now}`, userRoles.expiresAt)
              )
            )
          );

        roleNames = result.map((r) => r.roleName);
      }

      // Fall back to default role if no roles found in database
      if (roleNames.length === 0) {
        if (subjectType === 'service_account') {
          return [SYSTEM_ROLES.SERVICE];
        }
        return [SYSTEM_ROLES.USER];
      }

      return roleNames;
    } catch (error) {
      logger.warn(
        { error, subjectId, subjectType, tenantId },
        'Failed to query assigned roles from database, falling back to defaults'
      );
      // Graceful fallback to default roles on database error
      if (subjectType === 'service_account') {
        return [SYSTEM_ROLES.SERVICE];
      }
      return [SYSTEM_ROLES.USER];
    }
  }

  /**
   * Get roles inherited from a parent role
   */
  private async getInheritedRoles(roleName: string, tenantId: ID): Promise<string[]> {
    const db = getDatabase();
    const inherited: string[] = [];
    const visited = new Set<string>();

    try {
      // Resolve the starting role by name
      const condition = tenantId
        ? or(
            and(eq(roles.name, roleName), eq(roles.tenantId, tenantId)),
            and(eq(roles.name, roleName), isNull(roles.tenantId))
          )
        : and(eq(roles.name, roleName), isNull(roles.tenantId));

      const [startRole] = await db
        .select({ id: roles.id, parentRoleId: roles.parentRoleId })
        .from(roles)
        .where(and(condition, eq(roles.isActive, true)))
        .limit(1);

      if (!startRole || !startRole.parentRoleId) {
        return [];
      }

      // Walk up the role hierarchy via parentRoleId references
      let currentParentId: string | null = startRole.parentRoleId;
      const MAX_DEPTH = 10; // Guard against circular references
      let depth = 0;

      while (currentParentId && depth < MAX_DEPTH) {
        if (visited.has(currentParentId)) {
          break; // Circular reference detected
        }
        visited.add(currentParentId);

        const [parentRole] = await db
          .select({
            id: roles.id,
            name: roles.name,
            parentRoleId: roles.parentRoleId,
          })
          .from(roles)
          .where(and(eq(roles.id, currentParentId), eq(roles.isActive, true)))
          .limit(1);

        if (!parentRole) {
          break;
        }

        inherited.push(parentRole.name);
        currentParentId = parentRole.parentRoleId;
        depth++;
      }
    } catch (error) {
      logger.warn(
        { error, roleName, tenantId },
        'Failed to query role hierarchy from database'
      );
    }

    return inherited;
  }

  /**
   * Get permissions for a role
   */
  async getRolePermissions(roleName: string, tenantId: ID): Promise<Permission[]> {
    // Check if it's a system role
    if (isSystemRole(roleName)) {
      return getDefaultPermissions(roleName);
    }

    // Query role_permissions table for custom roles
    const db = getDatabase();

    try {
      // Look up the role by name within the tenant (or globally)
      const condition = tenantId
        ? or(
            and(eq(roles.name, roleName), eq(roles.tenantId, tenantId)),
            and(eq(roles.name, roleName), isNull(roles.tenantId))
          )
        : and(eq(roles.name, roleName), isNull(roles.tenantId));

      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(condition, eq(roles.isActive, true)))
        .limit(1);

      if (!role) {
        return [];
      }

      // Fetch all permissions assigned to this role
      const perms = await db
        .select({
          action: rolePermissions.action,
          resource: rolePermissions.resource,
          conditions: rolePermissions.conditions,
        })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));

      return perms.map((perm) => ({
        action: perm.action as Action,
        resource: perm.resource as Resource,
        conditions: perm.conditions as Permission['conditions'],
      }));
    } catch (error) {
      logger.warn(
        { error, roleName, tenantId },
        'Failed to query role permissions from database'
      );
      return [];
    }
  }

  // ===========================================================================
  // ROLE MANAGEMENT
  // ===========================================================================

  /**
   * Create a new role
   */
  async createRole(ctx: TenantContext, options: CreateRoleOptions): Promise<Role> {
    const tenantId = extractTenantId(ctx);

    logger.info(
      { roleName: options.name, tenantId },
      'Creating new role'
    );

    // Prevent creating system roles
    if (isSystemRole(options.name)) {
      throw new Error(`Cannot create role with system role name: ${options.name}`);
    }

    const db = getDatabase();

    const [inserted] = await db
      .insert(roles)
      .values({
        name: options.name,
        description: options.description,
        tenantId: options.tenantId ?? tenantId,
        parentRoleId: options.parentRoleId,
        isSystem: false,
        isActive: true,
        metadata: options.metadata,
      })
      .returning();

    const role: Role = {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description ?? undefined,
      tenantId: inserted.tenantId,
      parentRoleId: inserted.parentRoleId,
      isSystem: inserted.isSystem,
      isActive: inserted.isActive,
      metadata: inserted.metadata as Record<string, unknown> | undefined,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };

    // If permissions were provided, insert them as well
    if (options.permissions && options.permissions.length > 0) {
      const permValues = options.permissions.map((perm) => ({
        roleId: role.id,
        action: perm.action,
        resource: perm.resource,
        conditions: perm.conditions,
      }));

      await db
        .insert(rolePermissions)
        .values(permValues)
        .onConflictDoNothing();
    }

    // Invalidate cache
    await this.invalidateRoleCache(role.id);

    return role;
  }

  /**
   * Update an existing role
   */
  async updateRole(ctx: TenantContext, roleId: ID, options: UpdateRoleOptions): Promise<Role | null> {
    const tenantId = extractTenantId(ctx);

    logger.info({ roleId, tenantId }, 'Updating role');

    const db = getDatabase();

    // Build the update set from provided options
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (options.name !== undefined) updateData.name = options.name;
    if (options.description !== undefined) updateData.description = options.description;
    if (options.parentRoleId !== undefined) updateData.parentRoleId = options.parentRoleId;
    if (options.isActive !== undefined) updateData.isActive = options.isActive;
    if (options.metadata !== undefined) updateData.metadata = options.metadata;

    const [updated] = await db
      .update(roles)
      .set(updateData)
      .where(eq(roles.id, roleId))
      .returning();

    if (!updated) {
      return null;
    }

    // Invalidate cache
    await this.invalidateRoleCache(roleId);

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description ?? undefined,
      tenantId: updated.tenantId,
      parentRoleId: updated.parentRoleId,
      isSystem: updated.isSystem,
      isActive: updated.isActive,
      metadata: updated.metadata as Record<string, unknown> | undefined,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Delete a role
   */
  async deleteRole(ctx: TenantContext, roleId: ID): Promise<boolean> {
    const tenantId = extractTenantId(ctx);

    logger.info({ roleId, tenantId }, 'Deleting role');

    const db = getDatabase();

    // Soft delete by marking role as inactive (consistent with store.ts pattern)
    const [deleted] = await db
      .update(roles)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(roles.id, roleId))
      .returning();

    // Invalidate cache
    await this.invalidateRoleCache(roleId);

    return deleted !== undefined;
  }

  /**
   * Assign a role to a user
   */
  async assignRole(ctx: TenantContext, options: AssignRoleOptions): Promise<UserRole> {
    const tenantId = extractTenantId(ctx);

    logger.info(
      { userId: options.userId, roleId: options.roleId, tenantId },
      'Assigning role to user'
    );

    const db = getDatabase();

    const [inserted] = await db
      .insert(userRoles)
      .values({
        userId: options.userId,
        roleId: options.roleId,
        tenantId: options.tenantId,
        grantedBy: options.grantedBy,
        expiresAt: options.expiresAt,
        metadata: options.metadata,
      })
      .onConflictDoNothing()
      .returning();

    const userRole: UserRole = inserted
      ? {
          id: inserted.id,
          userId: inserted.userId,
          roleId: inserted.roleId,
          tenantId: inserted.tenantId,
          grantedAt: inserted.grantedAt,
          grantedBy: inserted.grantedBy ?? undefined,
          expiresAt: inserted.expiresAt ?? undefined,
          metadata: inserted.metadata as Record<string, unknown> | undefined,
        }
      : {
          // Role assignment already exists, return the intended assignment
          id: crypto.randomUUID(),
          userId: options.userId,
          roleId: options.roleId,
          tenantId: options.tenantId,
          grantedAt: new Date(),
          grantedBy: options.grantedBy,
          expiresAt: options.expiresAt,
          metadata: options.metadata,
        };

    // Invalidate user's permission cache
    await this.invalidateUserPermissionCache(options.userId, options.tenantId);

    return userRole;
  }

  /**
   * Revoke a role from a user
   */
  async revokeRole(ctx: TenantContext, options: RevokeRoleOptions): Promise<boolean> {
    const tenantId = extractTenantId(ctx);

    logger.info(
      { userId: options.userId, roleId: options.roleId, tenantId, reason: options.reason },
      'Revoking role from user'
    );

    const db = getDatabase();

    // Delete the user-role assignment from the database
    const result = await db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, options.userId),
          eq(userRoles.roleId, options.roleId),
          eq(userRoles.tenantId, options.tenantId)
        )
      );

    const revoked = (result.rowCount ?? 0) > 0;

    // Invalidate user's permission cache
    await this.invalidateUserPermissionCache(options.userId, options.tenantId);

    return revoked;
  }

  /**
   * Get roles for a user
   */
  async getUserRoles(ctx: TenantContext, userId: ID): Promise<UserRole[]> {
    const tenantId = extractTenantId(ctx);

    const db = getDatabase();
    const now = new Date();

    const result = await db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          or(
            isNull(userRoles.expiresAt),
            lte(sql`${now}`, userRoles.expiresAt)
          )
        )
      );

    return result.map((row) => ({
      id: row.id,
      userId: row.userId,
      roleId: row.roleId,
      tenantId: row.tenantId,
      grantedAt: row.grantedAt,
      grantedBy: row.grantedBy ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    }));
  }

  // ===========================================================================
  // CACHE MANAGEMENT
  // ===========================================================================

  /**
   * Invalidate permission cache for a user
   */
  async invalidateUserPermissionCache(userId: ID, tenantId: ID): Promise<void> {
    const cacheKey = PERMISSION_CACHE_KEY(userId, tenantId);
    this.localCache.delete(cacheKey);

    try {
      const redis = getRedis();
      await redis.del(cacheKey);
    } catch (error) {
      logger.warn({ error }, 'Failed to invalidate Redis cache');
    }
  }

  /**
   * Invalidate role cache
   */
  async invalidateRoleCache(roleId: ID): Promise<void> {
    const cacheKey = ROLE_CACHE_KEY(roleId);
    this.localCache.delete(cacheKey);

    try {
      const redis = getRedis();
      await redis.del(cacheKey);
    } catch (error) {
      logger.warn({ error }, 'Failed to invalidate Redis cache');
    }
  }

  /**
   * Clear all RBAC caches
   */
  async clearAllCaches(): Promise<void> {
    this.localCache.clear();

    try {
      const redis = getRedis();
      const keys = await redis.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to clear Redis caches');
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Parse permission string into action and resource
   */
  private parsePermissionString(permission: PermissionString): [Action, Resource] {
    const [action, resource] = permission.split(':') as [Action, Resource];
    return [action, resource];
  }

  /**
   * Convert permission object to string
   */
  private permissionToString(permission: Permission): PermissionString {
    return `${permission.action}:${permission.resource}` as PermissionString;
  }

  /**
   * Get from local cache
   */
  private getFromLocalCache<T>(key: string): T | null {
    const cached = this.localCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    this.localCache.delete(key);
    return null;
  }

  /**
   * Set local cache
   */
  private setLocalCache(key: string, data: unknown): void {
    this.localCache.set(key, {
      data,
      expires: Date.now() + CACHE_TTL_SECONDS * 1000,
    });
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let rbacService: RBACService | null = null;

export function getRBACService(): RBACService {
  if (!rbacService) {
    rbacService = new RBACService();
  }
  return rbacService;
}

export function createRBACService(): RBACService {
  return new RBACService();
}
