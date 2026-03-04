/**
 * API v1 RBAC Routes
 *
 * Role-Based Access Control management endpoints.
 * Provides role and permission management with tenant isolation.
 *
 * SECURITY: All routes use TenantContext for secure tenant isolation.
 * Tenant ID is extracted from JWT tokens only, never from request body/params.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { getTenantContext, type TenantContext } from '../../common/tenant-context.js';
import { getRBACService } from '../../rbac/service.js';
import { getRBACStore } from '../../rbac/store.js';
import {
  requirePermission,
  requireRole,
  createRBACMiddleware,
} from '../../rbac/middleware.js';
import { ACTIONS, RESOURCES, SYSTEM_ROLES, isSystemRole } from '../../rbac/index.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';
import { recordAuditEvent } from '../middleware/audit.js';

const rbacLogger = createLogger({ component: 'api-v1-rbac' });
const rbacService = getRBACService();
const rbacStore = getRBACStore();

// Rate limit configurations
const rbacRateLimits = {
  read: createEndpointRateLimit({ max: 100, windowSeconds: 60 }),
  write: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  admin: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
};

// =============================================================================
// SCHEMAS
// =============================================================================

const roleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const userIdParamsSchema = z.object({
  userId: z.string().min(1),
});

const roleCreateBodySchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_:]*$/i, {
    message: 'Role name must start with a letter and contain only alphanumeric characters, underscores, and colons',
  }),
  parentRoleId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const roleUpdateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentRoleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const permissionBodySchema = z.object({
  action: z.enum([
    ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE,
    ACTIONS.EXECUTE, ACTIONS.APPROVE, ACTIONS.REJECT, ACTIONS.ESCALATE,
    ACTIONS.CANCEL, ACTIONS.MANAGE, ACTIONS.ASSIGN, ACTIONS.REVOKE,
    ACTIONS.AUDIT, ACTIONS.EXPORT, ACTIONS.ALL,
  ]),
  resource: z.enum([
    RESOURCES.INTENTS, RESOURCES.POLICIES, RESOURCES.ESCALATIONS, RESOURCES.AGENTS,
    RESOURCES.TRUST_SCORES, RESOURCES.TRUST_SIGNALS, RESOURCES.ROLES, RESOURCES.PERMISSIONS,
    RESOURCES.USERS, RESOURCES.SERVICE_ACCOUNTS, RESOURCES.AUDIT_LOGS, RESOURCES.WEBHOOKS,
    RESOURCES.TENANTS, RESOURCES.SETTINGS, RESOURCES.ALL,
  ]),
  conditions: z.array(z.object({
    type: z.string(),
  }).passthrough()).optional(),
});

const roleAssignmentBodySchema = z.object({
  roleId: z.string().uuid(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const permissionCheckBodySchema = z.object({
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: z.coerce.boolean().default(false),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get tenant context from request
 */
async function getSecureTenantContext(request: FastifyRequest): Promise<TenantContext> {
  const ctx = getTenantContext(request);
  if (!ctx) {
    throw new Error('TenantContext not found - authentication required');
  }
  return ctx;
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

export async function registerRbacRoutesV1(fastify: FastifyInstance): Promise<void> {
  rbacLogger.info('Registering RBAC routes');

  // Add RBAC middleware to populate rbacBasic on requests
  fastify.addHook('preHandler', createRBACMiddleware({
    excludePaths: ['/api/v1/rbac/check'], // Allow permission check without full RBAC context
  }));

  // =========================================================================
  // ROLE MANAGEMENT
  // =========================================================================

  /**
   * List all roles for the current tenant
   */
  fastify.get('/rbac/roles', {
    schema: {
      querystring: listQuerySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            roles: { type: 'array' },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
    preHandler: [
      rbacRateLimits.read,
      requirePermission(ACTIONS.READ, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{ Querystring: z.infer<typeof listQuerySchema> }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const query = listQuerySchema.parse(request.query);

    const roles = await rbacStore.getRolesForTenant(ctx.tenantId);

    // Filter inactive if not requested
    const filteredRoles = query.includeInactive
      ? roles
      : roles.filter(r => r.isActive);

    // Paginate
    const paginatedRoles = filteredRoles.slice(query.offset, query.offset + query.limit);

    return reply.send({
      roles: paginatedRoles,
      total: filteredRoles.length,
      limit: query.limit,
      offset: query.offset,
    });
  });

  /**
   * Get role by ID
   */
  fastify.get('/rbac/roles/:id', {
    schema: {
      params: roleIdParamsSchema,
    },
    preHandler: [
      rbacRateLimits.read,
      requirePermission(ACTIONS.READ, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{ Params: z.infer<typeof roleIdParamsSchema> }>, reply: FastifyReply) => {
    const { id } = roleIdParamsSchema.parse(request.params);

    const role = await rbacStore.getRoleById(id);
    if (!role) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    // Get permissions for the role
    const permissions = role.isSystem
      ? await rbacService.getRolePermissions(role.name, role.tenantId ?? '')
      : await rbacStore.getRolePermissions(role.id);

    return reply.send({
      role,
      permissions,
    });
  });

  /**
   * Create a new role
   */
  fastify.post('/rbac/roles', {
    schema: {
      body: roleCreateBodySchema,
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.CREATE, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{ Body: z.infer<typeof roleCreateBodySchema> }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const body = roleCreateBodySchema.parse(request.body);

    // Prevent creating system roles
    if (isSystemRole(body.name)) {
      return reply.status(400).send({
        error: 'Cannot create role with system role name',
        systemRoles: Object.values(SYSTEM_ROLES),
      });
    }

    // Check if role name already exists
    const existing = await rbacStore.getRoleByName(body.name, ctx.tenantId);
    if (existing) {
      return reply.status(409).send({ error: 'Role name already exists' });
    }

    const role = await rbacStore.createRole(ctx, {
      name: body.name,
      tenantId: ctx.tenantId,
      parentRoleId: body.parentRoleId,
      metadata: body.metadata,
    });

    await recordAuditEvent(request, {
      eventType: 'rbac.role.create',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { name: role.name },
    });

    rbacLogger.info({ roleId: role.id, name: role.name }, 'Role created');

    return reply.status(201).send({ role });
  });

  /**
   * Update a role
   */
  fastify.patch('/rbac/roles/:id', {
    schema: {
      params: roleIdParamsSchema,
      body: roleUpdateBodySchema,
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.UPDATE, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{
    Params: z.infer<typeof roleIdParamsSchema>;
    Body: z.infer<typeof roleUpdateBodySchema>;
  }>, reply: FastifyReply) => {
    const { id } = roleIdParamsSchema.parse(request.params);
    const body = roleUpdateBodySchema.parse(request.body);

    const existing = await rbacStore.getRoleById(id);
    if (!existing) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    if (existing.isSystem) {
      return reply.status(403).send({ error: 'Cannot modify system roles' });
    }

    const role = await rbacStore.updateRole(id, body);

    await recordAuditEvent(request, {
      eventType: 'rbac.role.update',
      resourceType: 'role',
      resourceId: id,
      metadata: { changes: body },
    });

    return reply.send({ role });
  });

  /**
   * Delete a role
   */
  fastify.delete('/rbac/roles/:id', {
    schema: {
      params: roleIdParamsSchema,
    },
    preHandler: [
      rbacRateLimits.admin,
      requirePermission(ACTIONS.DELETE, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{ Params: z.infer<typeof roleIdParamsSchema> }>, reply: FastifyReply) => {
    const { id } = roleIdParamsSchema.parse(request.params);

    const existing = await rbacStore.getRoleById(id);
    if (!existing) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    if (existing.isSystem) {
      return reply.status(403).send({ error: 'Cannot delete system roles' });
    }

    await rbacStore.deleteRole(id);

    await recordAuditEvent(request, {
      eventType: 'rbac.role.delete',
      resourceType: 'role',
      resourceId: id,
      metadata: { name: existing.name },
    });

    return reply.status(204).send();
  });

  // =========================================================================
  // ROLE PERMISSIONS
  // =========================================================================

  /**
   * Add permission to role
   */
  fastify.post('/rbac/roles/:id/permissions', {
    schema: {
      params: roleIdParamsSchema,
      body: permissionBodySchema,
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.MANAGE, RESOURCES.PERMISSIONS),
    ],
  } as any, async (request: FastifyRequest<{
    Params: z.infer<typeof roleIdParamsSchema>;
    Body: z.infer<typeof permissionBodySchema>;
  }>, reply: FastifyReply) => {
    const { id } = roleIdParamsSchema.parse(request.params);
    const body = permissionBodySchema.parse(request.body);

    const role = await rbacStore.getRoleById(id);
    if (!role) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    if (role.isSystem) {
      return reply.status(403).send({ error: 'Cannot modify system role permissions' });
    }

    const permission = await rbacStore.addRolePermission(id, {
      action: body.action,
      resource: body.resource,
      conditions: body.conditions as any, // Zod passthrough type compatibility
    });

    await recordAuditEvent(request, {
      eventType: 'rbac.permission.grant',
      resourceType: 'role',
      resourceId: id,
      metadata: { permission: `${body.action}:${body.resource}` },
    });

    return reply.status(201).send({ permission });
  });

  /**
   * Remove permission from role
   */
  fastify.delete('/rbac/roles/:id/permissions', {
    schema: {
      params: roleIdParamsSchema,
      body: z.object({
        action: z.string(),
        resource: z.string(),
      }),
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.MANAGE, RESOURCES.PERMISSIONS),
    ],
  } as any, async (request: FastifyRequest<{
    Params: z.infer<typeof roleIdParamsSchema>;
    Body: { action: string; resource: string };
  }>, reply: FastifyReply) => {
    const { id } = roleIdParamsSchema.parse(request.params);
    const { action, resource } = request.body;

    const role = await rbacStore.getRoleById(id);
    if (!role) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    if (role.isSystem) {
      return reply.status(403).send({ error: 'Cannot modify system role permissions' });
    }

    await rbacStore.removeRolePermission(id, action as any, resource as any);

    await recordAuditEvent(request, {
      eventType: 'rbac.permission.revoke',
      resourceType: 'role',
      resourceId: id,
      metadata: { permission: `${action}:${resource}` },
    });

    return reply.status(204).send();
  });

  // =========================================================================
  // USER ROLE ASSIGNMENTS
  // =========================================================================

  /**
   * Get roles for a user
   */
  fastify.get('/rbac/users/:userId/roles', {
    schema: {
      params: userIdParamsSchema,
    },
    preHandler: [
      rbacRateLimits.read,
      requirePermission(ACTIONS.READ, RESOURCES.USERS),
    ],
  } as any, async (request: FastifyRequest<{ Params: z.infer<typeof userIdParamsSchema> }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const { userId } = userIdParamsSchema.parse(request.params);

    const roles = await rbacStore.getUserRoles(userId, ctx.tenantId);
    const roleNames = await rbacStore.getUserRoleNames(userId, ctx.tenantId);

    return reply.send({
      userId,
      roles,
      roleNames,
    });
  });

  /**
   * Assign role to user
   */
  fastify.post('/rbac/users/:userId/roles', {
    schema: {
      params: userIdParamsSchema,
      body: roleAssignmentBodySchema,
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.ASSIGN, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{
    Params: z.infer<typeof userIdParamsSchema>;
    Body: z.infer<typeof roleAssignmentBodySchema>;
  }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const { userId } = userIdParamsSchema.parse(request.params);
    const body = roleAssignmentBodySchema.parse(request.body);

    // Verify role exists
    const role = await rbacStore.getRoleById(body.roleId);
    if (!role) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    const assignment = await rbacStore.assignRoleToUser(ctx, {
      userId,
      roleId: body.roleId,
      tenantId: ctx.tenantId,
      grantedBy: ctx.userId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      metadata: body.metadata,
    });

    // Invalidate permission cache
    await rbacService.invalidateUserPermissionCache(userId, ctx.tenantId);

    await recordAuditEvent(request, {
      eventType: 'rbac.role.assign',
      resourceType: 'user',
      resourceId: userId,
      metadata: { roleId: body.roleId, roleName: role.name },
    });

    rbacLogger.info({ userId, roleId: body.roleId }, 'Role assigned to user');

    return reply.status(201).send({ assignment });
  });

  /**
   * Revoke role from user
   */
  fastify.delete('/rbac/users/:userId/roles/:roleId', {
    schema: {
      params: z.object({
        userId: z.string().min(1),
        roleId: z.string().uuid(),
      }),
    },
    preHandler: [
      rbacRateLimits.write,
      requirePermission(ACTIONS.REVOKE, RESOURCES.ROLES),
    ],
  } as any, async (request: FastifyRequest<{ Params: { userId: string; roleId: string } }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const { userId, roleId } = request.params;

    const revoked = await rbacStore.revokeRoleFromUser(userId, roleId, ctx.tenantId);
    if (!revoked) {
      return reply.status(404).send({ error: 'Role assignment not found' });
    }

    // Invalidate permission cache
    await rbacService.invalidateUserPermissionCache(userId, ctx.tenantId);

    await recordAuditEvent(request, {
      eventType: 'rbac.role.revoke',
      resourceType: 'user',
      resourceId: userId,
      metadata: { roleId },
    });

    return reply.status(204).send();
  });

  // =========================================================================
  // PERMISSION CHECKING
  // =========================================================================

  /**
   * Check current user's permissions
   */
  fastify.get('/rbac/me/permissions', {
    schema: {
    },
    preHandler: [rbacRateLimits.read],
  } as any, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);

    const permissions = await rbacService.getEffectivePermissions(
      ctx.userId,
      'user',
      ctx.tenantId
    );

    const roles = await rbacService.getEffectiveRoles(
      ctx.userId,
      'user',
      ctx.tenantId
    );

    return reply.send({
      userId: ctx.userId,
      roles,
      permissions,
    });
  });

  /**
   * Check if current user has a specific permission
   */
  fastify.post('/rbac/check', {
    schema: {
      body: permissionCheckBodySchema,
    },
    preHandler: [rbacRateLimits.read],
  } as any, async (request: FastifyRequest<{ Body: z.infer<typeof permissionCheckBodySchema> }>, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const body = permissionCheckBodySchema.parse(request.body);

    const result = await rbacService.evaluate({
      subjectId: ctx.userId,
      subjectType: 'user',
      tenantId: ctx.tenantId,
      action: body.action as any,
      resource: body.resource as any,
      resourceId: body.resourceId,
    });

    return reply.send({
      allowed: result.allowed,
      reason: result.reason,
      effectiveRoles: result.effectiveRoles,
      evaluationTimeMs: result.evaluationTimeMs,
    });
  });

  // =========================================================================
  // SYSTEM ROLES INFO
  // =========================================================================

  /**
   * Get system roles and their permissions
   */
  fastify.get('/rbac/system-roles', {
    schema: {
    },
    preHandler: [rbacRateLimits.read],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const systemRoles = await Promise.all(
      Object.values(SYSTEM_ROLES).map(async (roleName) => {
        const permissions = await rbacService.getRolePermissions(roleName, '');
        return {
          name: roleName,
          permissions: permissions.map(p => `${p.action}:${p.resource}`),
          isSystem: true,
        };
      })
    );

    return reply.send({ systemRoles });
  });

  rbacLogger.info('RBAC routes registered');
}
