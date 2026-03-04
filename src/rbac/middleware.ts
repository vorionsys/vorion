/**
 * RBAC Middleware
 *
 * Fastify middleware for role-based access control.
 * Provides route-level permission and role enforcement.
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { createLogger } from '../common/logger.js';
import { extractTenantId, type TenantContext, createTenantContext } from '../common/tenant-context.js';
import type { ID } from '../common/types.js';
import { getRBACService } from './service.js';
import { ACTIONS, type Action, type Resource, type PermissionString } from './types.js';

const logger = createLogger({ component: 'rbac-middleware' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Basic RBAC context type for simple middleware
 */
export interface BasicRBACContext {
  subjectId: ID;
  subjectType: 'user' | 'service_account';
  tenantId: ID;
  roles: string[];
  permissions: PermissionString[];
}

/**
 * Extended request with basic RBAC context
 */
declare module 'fastify' {
  interface FastifyRequest {
    rbacBasic?: BasicRBACContext;
  }
}

/**
 * JWT payload structure
 */
interface JwtPayload {
  sub: string;
  tid?: string;
  tenantId?: string;
  roles?: string[];
  type?: 'user' | 'service_account';
  iss?: string;
}

/**
 * Options for RBAC middleware
 */
export interface RBACMiddlewareOptions {
  /** Skip RBAC checks for these paths */
  excludePaths?: string[];
  /** Skip RBAC checks for these methods */
  excludeMethods?: string[];
  /** Custom function to extract subject from request */
  extractSubject?: (request: FastifyRequest) => Promise<{
    subjectId: ID;
    subjectType: 'user' | 'service_account';
    tenantId: ID;
  } | null>;
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Create RBAC middleware for Fastify
 *
 * This middleware attaches RBAC context to the request and can be used
 * to enforce permissions at the route level.
 *
 * @example
 * ```typescript
 * // Register middleware
 * app.addHook('preHandler', createRBACMiddleware());
 *
 * // Use permission decorator on routes
 * app.get('/admin', {
 *   preHandler: requirePermission('manage', 'settings'),
 * }, handler);
 * ```
 */
export function createRBACMiddleware(
  options: RBACMiddlewareOptions = {}
): preHandlerHookHandler {
  const {
    excludePaths = ['/health', '/metrics', '/api/health'],
    excludeMethods = ['OPTIONS'],
    extractSubject,
  } = options;

  return async function rbacMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Skip for excluded paths
    if (excludePaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    // Skip for excluded methods
    if (excludeMethods.includes(request.method)) {
      return;
    }

    try {
      // Extract subject from request
      let subject: {
        subjectId: ID;
        subjectType: 'user' | 'service_account';
        tenantId: ID;
      } | null = null;

      if (extractSubject) {
        subject = await extractSubject(request);
      } else {
        // Default extraction from JWT
        subject = await extractSubjectFromJwt(request);
      }

      if (!subject) {
        // No authenticated subject - let auth middleware handle this
        return;
      }

      // Get RBAC service
      const rbacService = getRBACService();

      // Get effective roles and permissions
      const effectiveRoles = await rbacService.getEffectiveRoles(
        subject.subjectId,
        subject.subjectType,
        subject.tenantId
      );

      const effectivePermissions = await rbacService.getEffectivePermissions(
        subject.subjectId,
        subject.subjectType,
        subject.tenantId
      );

      // Attach RBAC context to request
      request.rbacBasic = {
        subjectId: subject.subjectId,
        subjectType: subject.subjectType,
        tenantId: subject.tenantId,
        roles: effectiveRoles,
        permissions: effectivePermissions,
      };

      logger.debug(
        {
          subjectId: subject.subjectId,
          roles: effectiveRoles.length,
          permissions: effectivePermissions.length,
        },
        'RBAC context attached to request'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize RBAC context');
      // Don't fail the request - let downstream handlers decide
    }
  };
}

/**
 * Extract subject from JWT token
 */
async function extractSubjectFromJwt(
  request: FastifyRequest
): Promise<{
  subjectId: ID;
  subjectType: 'user' | 'service_account';
  tenantId: ID;
} | null> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();

    if (!payload.sub) {
      return null;
    }

    const tenantId = payload.tid ?? payload.tenantId;
    if (!tenantId) {
      return null;
    }

    // Determine subject type from token
    let subjectType: 'user' | 'service_account' = 'user';
    if (payload.type === 'service_account' || payload.iss?.includes('service')) {
      subjectType = 'service_account';
    }

    return {
      subjectId: payload.sub,
      subjectType,
      tenantId,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// PERMISSION GUARDS
// =============================================================================

/**
 * Require a specific permission to access a route
 *
 * @example
 * ```typescript
 * app.post('/policies', {
 *   preHandler: requirePermission('create', 'policies'),
 * }, createPolicyHandler);
 * ```
 */
export function requirePermission(
  action: Action,
  resource: Resource
): preHandlerHookHandler {
  return async function permissionGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.rbacBasic) {
      logger.warn({ url: request.url }, 'RBAC context not found');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const rbacService = getRBACService();
    const hasPermission = await rbacService.hasPermission(
      request.rbacBasic.subjectId,
      request.rbacBasic.subjectType,
      request.rbacBasic.tenantId,
      action,
      resource
    );

    if (!hasPermission) {
      logger.warn(
        {
          subjectId: request.rbacBasic.subjectId,
          action,
          resource,
          url: request.url,
        },
        'Permission denied'
      );

      return reply.status(403).send({
        error: 'Forbidden',
        message: `Permission denied: ${action}:${resource}`,
        required: `${action}:${resource}`,
      });
    }
  };
}

/**
 * Require a specific role to access a route
 *
 * @example
 * ```typescript
 * app.delete('/admin/user/:id', {
 *   preHandler: requireRole('tenant:admin'),
 * }, deleteUserHandler);
 * ```
 */
export function requireRole(roleName: string): preHandlerHookHandler {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.rbacBasic) {
      logger.warn({ url: request.url }, 'RBAC context not found');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const hasRole = request.rbacBasic.roles.includes(roleName);

    if (!hasRole) {
      logger.warn(
        {
          subjectId: request.rbacBasic.subjectId,
          requiredRole: roleName,
          currentRoles: request.rbacBasic.roles,
          url: request.url,
        },
        'Role check failed'
      );

      return reply.status(403).send({
        error: 'Forbidden',
        message: `Required role: ${roleName}`,
        required: roleName,
      });
    }
  };
}

/**
 * Require any of the specified permissions
 *
 * @example
 * ```typescript
 * app.get('/data', {
 *   preHandler: requireAnyPermission([
 *     { action: 'read', resource: 'intents' },
 *     { action: 'read', resource: 'policies' },
 *   ]),
 * }, getDataHandler);
 * ```
 */
export function requireAnyPermission(
  permissions: Array<{ action: Action; resource: Resource }>
): preHandlerHookHandler {
  return async function anyPermissionGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.rbacBasic) {
      logger.warn({ url: request.url }, 'RBAC context not found');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const rbacService = getRBACService();
    const hasAny = await rbacService.hasAnyPermission(
      request.rbacBasic.subjectId,
      request.rbacBasic.subjectType,
      request.rbacBasic.tenantId,
      permissions
    );

    if (!hasAny) {
      const required = permissions.map((p) => `${p.action}:${p.resource}`);
      logger.warn(
        {
          subjectId: request.rbacBasic.subjectId,
          required,
          url: request.url,
        },
        'No matching permission found'
      );

      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Permission denied',
        required: `One of: ${required.join(', ')}`,
      });
    }
  };
}

/**
 * Require all of the specified permissions
 *
 * @example
 * ```typescript
 * app.post('/admin/migrate', {
 *   preHandler: requireAllPermissions([
 *     { action: 'manage', resource: 'settings' },
 *     { action: 'delete', resource: 'intents' },
 *   ]),
 * }, migrateHandler);
 * ```
 */
export function requireAllPermissions(
  permissions: Array<{ action: Action; resource: Resource }>
): preHandlerHookHandler {
  return async function allPermissionsGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.rbacBasic) {
      logger.warn({ url: request.url }, 'RBAC context not found');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const rbacService = getRBACService();
    const hasAll = await rbacService.hasAllPermissions(
      request.rbacBasic.subjectId,
      request.rbacBasic.subjectType,
      request.rbacBasic.tenantId,
      permissions
    );

    if (!hasAll) {
      const required = permissions.map((p) => `${p.action}:${p.resource}`);
      logger.warn(
        {
          subjectId: request.rbacBasic.subjectId,
          required,
          url: request.url,
        },
        'Missing required permissions'
      );

      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Permission denied',
        required: `All of: ${required.join(', ')}`,
      });
    }
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the current request has a specific permission
 * Useful for conditional logic within handlers
 */
export async function checkPermission(
  request: FastifyRequest,
  action: Action,
  resource: Resource
): Promise<boolean> {
  if (!request.rbacBasic) {
    return false;
  }

  const rbacService = getRBACService();
  return rbacService.hasPermission(
    request.rbacBasic.subjectId,
    request.rbacBasic.subjectType,
    request.rbacBasic.tenantId,
    action,
    resource
  );
}

/**
 * Check if the current request has a specific role
 */
export function checkRole(request: FastifyRequest, roleName: string): boolean {
  return request.rbacBasic?.roles.includes(roleName) ?? false;
}

/**
 * Get the current user's effective permissions from the request
 */
export function getRequestPermissions(request: FastifyRequest): PermissionString[] {
  return request.rbacBasic?.permissions ?? [];
}

/**
 * Get the current user's effective roles from the request
 */
export function getRequestRoles(request: FastifyRequest): string[] {
  return request.rbacBasic?.roles ?? [];
}
