/**
 * Role-Based Access Control (RBAC) Module
 *
 * Comprehensive RBAC implementation for Vorion with:
 * - Hierarchical roles (admin > operator > viewer)
 * - Resource-based permissions (tenant:*, intent:read, proof:verify)
 * - Policy-based access control
 * - TenantContext integration
 * - Trust-engine integration for trust-based access
 * - Audit logging for all access decisions
 *
 * @example
 * ```typescript
 * import { RBACService, createRBACService } from './security/rbac';
 *
 * const rbac = createRBACService();
 *
 * // Check permission
 * const result = await rbac.checkAccess({
 *   subjectId: 'user-123',
 *   subjectType: 'user',
 *   resource: 'intent',
 *   action: 'read',
 *   tenantId: 'tenant-456',
 * });
 *
 * if (!result.permitted) {
 *   throw new ForbiddenError(result.reason);
 * }
 * ```
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { ForbiddenError, UnauthorizedError } from '../../common/errors.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import type { ID, TrustLevel } from '../../common/types.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../../audit/security-logger.js';
import type { SecurityActor, SecurityResource } from '../../audit/security-events.js';

// Re-export role types and utilities
export {
  BuiltinRoles,
  type BuiltinRole,
  type RoleDefinition,
  type RoleAssignment,
  type RoleScope,
  type TimeRestriction,
  type AssignmentConditions,
  ROLE_PRIORITY,
  ROLE_MINIMUM_TRUST_TIER,
  getBuiltinRoles,
  getEffectivePermissions,
  roleInheritsFrom,
  compareRoles,
  getAncestorRoles,
  validateRoleHierarchy,
  meetsTrustRequirement,
  createRoleDefinition,
  createRoleAssignment,
  roleDefinitionSchema,
  roleAssignmentSchema,
} from './roles.js';

// Re-export permission types and utilities
export {
  PermissionActions,
  ResourceTypes,
  PermissionCategories,
  type PermissionAction,
  type ResourceType,
  type PermissionCategory,
  type PermissionDefinition,
  type PermissionCheckRequest,
  type PermissionCheckResult,
  getBuiltinPermissions,
  parsePermission,
  buildPermission,
  permissionMatches,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  filterMatchingPermissions,
  isValidPermissionFormat,
  getPermissionsByCategory,
  getSensitivePermissions,
  getCompliancePermissions,
  createPermissionDefinition,
  permissionDefinitionSchema,
  permissionCheckRequestSchema,
  permissionCheckResultSchema,
} from './permissions.js';

// Re-export policy engine types and utilities
export {
  PolicyTypes,
  PolicyEffects,
  CombiningAlgorithms,
  type PolicyType,
  type PolicyEffect,
  type CombiningAlgorithm,
  type AccessPolicy,
  type PolicyTarget,
  type PolicyConditions,
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
  type EvaluatedPolicy,
  type PolicyEngineOptions,
  RBACPolicyEngine,
  createRBACPolicyEngine,
  createPolicyEvaluationContext,
  createAccessPolicy,
  accessPolicySchema,
} from './policy-engine.js';

// Import for internal use
import {
  type RoleDefinition,
  type RoleAssignment,
  getBuiltinRoles,
  getEffectivePermissions,
  ROLE_MINIMUM_TRUST_TIER,
  BuiltinRoles,
} from './roles.js';
import {
  type PermissionCheckResult,
  hasPermission,
  hasAllPermissions,
} from './permissions.js';
import {
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
  type PolicyEngineOptions,
  RBACPolicyEngine,
  createRBACPolicyEngine,
  createPolicyEvaluationContext,
  PolicyEffects,
} from './policy-engine.js';

const logger = createLogger({ component: 'rbac-service' });

// =============================================================================
// METRICS
// =============================================================================

const rbacChecks = new Counter({
  name: 'vorion_rbac_access_checks_total',
  help: 'Total RBAC access checks',
  labelNames: ['result', 'resource_type', 'action'] as const,
  registers: [vorionRegistry],
});

const rbacCheckDuration = new Histogram({
  name: 'vorion_rbac_access_check_duration_seconds',
  help: 'Duration of RBAC access check',
  labelNames: ['resource_type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

// =============================================================================
// RBAC SERVICE
// =============================================================================

/**
 * RBAC access check request
 */
export interface AccessCheckRequest {
  /** Subject ID (user, agent, or service) */
  subjectId: ID;
  /** Subject type */
  subjectType: 'user' | 'agent' | 'service';
  /** Resource type being accessed */
  resource: string;
  /** Action being performed */
  action: string;
  /** Resource ID (for resource-specific checks) */
  resourceId?: ID;
  /** Tenant context */
  tenantId?: ID;
  /** Subject's current trust tier */
  trustTier?: TrustLevel;
  /** Additional context attributes */
  context?: Record<string, unknown>;
  /** Client IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Request ID for tracing */
  requestId?: ID;
}

/**
 * RBAC access check result
 */
export interface AccessCheckResult {
  /** Whether access is permitted */
  permitted: boolean;
  /** Reason for the decision */
  reason: string;
  /** Permissions that were checked */
  checkedPermissions: string[];
  /** Roles that were evaluated */
  evaluatedRoles: string[];
  /** Missing requirements (if denied) */
  missingRequirements?: {
    permissions?: string[];
    roles?: string[];
    trustTier?: TrustLevel;
  };
  /** How the decision was made */
  decisionSource: 'policy' | 'role' | 'permission' | 'default';
  /** Evaluation duration in milliseconds */
  durationMs: number;
  /** Evaluation timestamp */
  evaluatedAt: string;
}

/**
 * RBAC Service options
 */
export interface RBACServiceOptions extends PolicyEngineOptions {
  /** Enable trust tier enforcement */
  enforceTrustTier?: boolean;
  /** Default trust tier for subjects without one */
  defaultTrustTier?: TrustLevel;
  /** Enable tenant isolation */
  enableTenantIsolation?: boolean;
  /** Allow cross-tenant access for super admins */
  allowSuperAdminCrossTenant?: boolean;
}

/**
 * RBAC Service
 *
 * High-level service for Role-Based Access Control that integrates:
 * - Role management
 * - Permission checking
 * - Policy evaluation
 * - Trust-tier enforcement
 * - Tenant isolation
 * - Audit logging
 */
export class RBACService {
  private policyEngine: RBACPolicyEngine;
  private options: Required<RBACServiceOptions>;
  private auditLogger: SecurityAuditLogger;

  constructor(options: RBACServiceOptions = {}) {
    this.options = {
      defaultCombiningAlgorithm: options.defaultCombiningAlgorithm ?? 'deny_overrides',
      defaultEffect: options.defaultEffect ?? 'deny',
      enableAuditLogging: options.enableAuditLogging ?? true,
      enableTracing: options.enableTracing ?? true,
      enableCaching: options.enableCaching ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 60000,
      enforceTrustTier: options.enforceTrustTier ?? true,
      defaultTrustTier: options.defaultTrustTier ?? 0,
      enableTenantIsolation: options.enableTenantIsolation ?? true,
      allowSuperAdminCrossTenant: options.allowSuperAdminCrossTenant ?? true,
    };

    this.policyEngine = createRBACPolicyEngine({
      defaultCombiningAlgorithm: this.options.defaultCombiningAlgorithm,
      defaultEffect: this.options.defaultEffect,
      enableAuditLogging: this.options.enableAuditLogging,
      enableTracing: this.options.enableTracing,
      enableCaching: this.options.enableCaching,
      cacheTtlMs: this.options.cacheTtlMs,
    });

    this.auditLogger = getSecurityAuditLogger();

    logger.info({
      enforceTrustTier: this.options.enforceTrustTier,
      enableTenantIsolation: this.options.enableTenantIsolation,
    }, 'RBAC service initialized');
  }

  // ===========================================================================
  // ACCESS CONTROL
  // ===========================================================================

  /**
   * Check if a subject has access to a resource
   */
  async checkAccess(request: AccessCheckRequest): Promise<AccessCheckResult> {
    const startTime = performance.now();

    // Get subject's roles and permissions
    const subjectRoles = await this.policyEngine.getSubjectRoles(
      request.subjectId,
      request.tenantId
    );
    const subjectPermissions = await this.policyEngine.getSubjectPermissions(
      request.subjectId,
      request.tenantId
    );

    const trustTier = request.trustTier ?? this.options.defaultTrustTier;
    const roleNames = subjectRoles.map(r => r.id);

    // Build evaluation context
    const context = createPolicyEvaluationContext({
      subjectId: request.subjectId,
      subjectType: request.subjectType,
      trustTier,
      roles: roleNames,
      permissions: Array.from(subjectPermissions),
      resourceType: request.resource,
      resourceAction: request.action,
      resourceId: request.resourceId,
      tenantId: request.tenantId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      requestId: request.requestId,
      subjectAttributes: request.context,
    });

    // Check trust tier requirement
    if (this.options.enforceTrustTier) {
      const trustCheck = this.checkTrustTierForRoles(subjectRoles, trustTier);
      if (!trustCheck.passed) {
        const durationMs = performance.now() - startTime;
        rbacChecks.inc({ result: 'denied', resource_type: request.resource, action: request.action });
        rbacCheckDuration.observe({ resource_type: request.resource }, durationMs / 1000);

        return {
          permitted: false,
          reason: trustCheck.reason,
          checkedPermissions: [`${request.resource}:${request.action}`],
          evaluatedRoles: roleNames,
          missingRequirements: { trustTier: trustCheck.requiredTier },
          decisionSource: 'role',
          durationMs,
          evaluatedAt: new Date().toISOString(),
        };
      }
    }

    // Check tenant isolation
    if (this.options.enableTenantIsolation && request.tenantId) {
      const tenantCheck = await this.checkTenantAccess(
        request.subjectId,
        request.tenantId,
        subjectRoles
      );
      if (!tenantCheck.passed) {
        const durationMs = performance.now() - startTime;
        rbacChecks.inc({ result: 'denied', resource_type: request.resource, action: request.action });
        rbacCheckDuration.observe({ resource_type: request.resource }, durationMs / 1000);

        return {
          permitted: false,
          reason: tenantCheck.reason,
          checkedPermissions: [`${request.resource}:${request.action}`],
          evaluatedRoles: roleNames,
          decisionSource: 'role',
          durationMs,
          evaluatedAt: new Date().toISOString(),
        };
      }
    }

    // Evaluate policies
    const policyResult = await this.policyEngine.evaluateWithTracing(context);

    const durationMs = performance.now() - startTime;
    rbacChecks.inc({
      result: policyResult.permitted ? 'granted' : 'denied',
      resource_type: request.resource,
      action: request.action,
    });
    rbacCheckDuration.observe({ resource_type: request.resource }, durationMs / 1000);

    return {
      permitted: policyResult.permitted,
      reason: policyResult.reason,
      checkedPermissions: [`${request.resource}:${request.action}`],
      evaluatedRoles: roleNames,
      missingRequirements: policyResult.missingRequirements,
      decisionSource: policyResult.decidingPolicy ? 'policy' : 'permission',
      durationMs,
      evaluatedAt: policyResult.evaluatedAt,
    };
  }

  /**
   * Check if subject has specific permission
   */
  async hasPermission(
    subjectId: ID,
    permission: string,
    tenantId?: ID
  ): Promise<boolean> {
    const permissions = await this.policyEngine.getSubjectPermissions(subjectId, tenantId);
    return hasPermission(permissions, permission);
  }

  /**
   * Check if subject has all specified permissions
   */
  async hasAllPermissions(
    subjectId: ID,
    permissions: string[],
    tenantId?: ID
  ): Promise<boolean> {
    const subjectPermissions = await this.policyEngine.getSubjectPermissions(subjectId, tenantId);
    return hasAllPermissions(subjectPermissions, permissions);
  }

  /**
   * Check if subject has a specific role
   */
  async hasRole(
    subjectId: ID,
    roleId: string,
    tenantId?: ID
  ): Promise<boolean> {
    const roles = await this.policyEngine.getSubjectRoles(subjectId, tenantId);
    return roles.some(r => r.id === roleId);
  }

  /**
   * Require access (throws ForbiddenError if denied)
   */
  async requireAccess(request: AccessCheckRequest): Promise<void> {
    const result = await this.checkAccess(request);
    if (!result.permitted) {
      throw new ForbiddenError(result.reason, {
        subjectId: request.subjectId,
        resource: request.resource,
        action: request.action,
        missingRequirements: result.missingRequirements,
      });
    }
  }

  /**
   * Require permission (throws ForbiddenError if denied)
   */
  async requirePermission(
    subjectId: ID,
    permission: string,
    tenantId?: ID
  ): Promise<void> {
    const hasPerm = await this.hasPermission(subjectId, permission, tenantId);
    if (!hasPerm) {
      throw new ForbiddenError(`Missing required permission: ${permission}`, {
        subjectId,
        permission,
        tenantId,
      });
    }
  }

  /**
   * Require role (throws ForbiddenError if denied)
   */
  async requireRole(
    subjectId: ID,
    roleId: string,
    tenantId?: ID
  ): Promise<void> {
    const hasRoleAssigned = await this.hasRole(subjectId, roleId, tenantId);
    if (!hasRoleAssigned) {
      throw new ForbiddenError(`Missing required role: ${roleId}`, {
        subjectId,
        roleId,
        tenantId,
      });
    }
  }

  // ===========================================================================
  // ROLE MANAGEMENT (Delegate to policy engine)
  // ===========================================================================

  /**
   * Add a custom role
   */
  addRole(role: RoleDefinition): void {
    this.policyEngine.addRole(role);
  }

  /**
   * Update a custom role
   */
  updateRole(roleId: string, updates: Partial<RoleDefinition>): void {
    this.policyEngine.updateRole(roleId, updates);
  }

  /**
   * Remove a custom role
   */
  removeRole(roleId: string): boolean {
    return this.policyEngine.removeRole(roleId);
  }

  /**
   * Get a role by ID
   */
  getRole(roleId: string): RoleDefinition | undefined {
    return this.policyEngine.getRole(roleId);
  }

  /**
   * Get all roles
   */
  getAllRoles(): RoleDefinition[] {
    return this.policyEngine.getAllRoles();
  }

  /**
   * Assign a role to a subject
   */
  assignRole(assignment: RoleAssignment): void {
    this.policyEngine.assignRole(assignment);
  }

  /**
   * Revoke a role from a subject
   */
  revokeRole(subjectId: ID, roleId: string, tenantId?: ID): boolean {
    return this.policyEngine.revokeRole(subjectId, roleId, tenantId);
  }

  /**
   * Get role assignments for a subject
   */
  getRoleAssignments(subjectId: ID): RoleAssignment[] {
    return this.policyEngine.getRoleAssignments(subjectId);
  }

  /**
   * Get subject's effective permissions
   */
  async getSubjectPermissions(subjectId: ID, tenantId?: ID): Promise<Set<string>> {
    return this.policyEngine.getSubjectPermissions(subjectId, tenantId);
  }

  /**
   * Get subject's roles
   */
  async getSubjectRoles(subjectId: ID, tenantId?: ID): Promise<RoleDefinition[]> {
    return this.policyEngine.getSubjectRoles(subjectId, tenantId);
  }

  // ===========================================================================
  // POLICY MANAGEMENT (Delegate to policy engine)
  // ===========================================================================

  /**
   * Get the underlying policy engine
   */
  getPolicyEngine(): RBACPolicyEngine {
    return this.policyEngine;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Check if trust tier meets requirements for assigned roles
   */
  private checkTrustTierForRoles(
    roles: RoleDefinition[],
    trustTier: TrustLevel
  ): { passed: boolean; reason: string; requiredTier?: TrustLevel } {
    for (const role of roles) {
      if (trustTier < role.minimumTrustTier) {
        return {
          passed: false,
          reason: `Trust tier T${trustTier} insufficient for role ${role.name} (requires T${role.minimumTrustTier})`,
          requiredTier: role.minimumTrustTier,
        };
      }
    }
    return { passed: true, reason: 'Trust tier sufficient' };
  }

  /**
   * Check tenant access
   */
  private async checkTenantAccess(
    subjectId: ID,
    tenantId: ID,
    roles: RoleDefinition[]
  ): Promise<{ passed: boolean; reason: string }> {
    // Super admins can access any tenant if configured
    if (this.options.allowSuperAdminCrossTenant) {
      const isSuperAdmin = roles.some(r => r.id === BuiltinRoles.SUPER_ADMIN);
      if (isSuperAdmin) {
        return { passed: true, reason: 'Super admin cross-tenant access' };
      }
    }

    // Check if subject has any role assignment for this tenant
    const assignments = this.policyEngine.getRoleAssignments(subjectId);
    const hasTenantAccess = assignments.some(
      a => a.active && (!a.tenantId || a.tenantId === tenantId)
    );

    if (!hasTenantAccess) {
      return {
        passed: false,
        reason: `No access to tenant: ${tenantId}`,
      };
    }

    return { passed: true, reason: 'Tenant access verified' };
  }

  /**
   * Get service statistics
   */
  getStats(): ReturnType<RBACPolicyEngine['getStats']> & {
    options: RBACServiceOptions;
  } {
    return {
      ...this.policyEngine.getStats(),
      options: this.options,
    };
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    this.policyEngine.destroy();
    logger.info('RBAC service destroyed');
  }
}

/**
 * Create a new RBAC service
 */
export function createRBACService(options?: RBACServiceOptions): RBACService {
  return new RBACService(options);
}

// =============================================================================
// FASTIFY MIDDLEWARE
// =============================================================================

/**
 * RBAC middleware options
 */
export interface RBACMiddlewareOptions {
  /** RBAC service instance */
  rbacService?: RBACService;
  /** Skip RBAC check for these paths */
  skipPaths?: string[];
  /** Extract subject from request */
  extractSubject?: (request: FastifyRequest) => {
    id: ID;
    type: 'user' | 'agent' | 'service';
    trustTier?: TrustLevel;
    tenantId?: ID;
  } | undefined;
  /** Get required permission for route */
  getRoutePermission?: (request: FastifyRequest) => string | undefined;
}

/**
 * Fastify request with security RBAC context
 */
export interface SecurityRBACRequestContext {
  /** RBAC service */
  rbacService: RBACService;
  /** Subject info */
  subject?: {
    id: ID;
    type: 'user' | 'agent' | 'service';
    trustTier: TrustLevel;
    roles: string[];
    permissions: string[];
  };
  /** Check access within request handler */
  checkAccess: (resource: string, action: string, resourceId?: ID) => Promise<AccessCheckResult>;
  /** Require access (throws if denied) */
  requireAccess: (resource: string, action: string, resourceId?: ID) => Promise<void>;
  /** Check permission */
  hasPermission: (permission: string) => Promise<boolean>;
  /** Require permission (throws if denied) */
  requirePermission: (permission: string) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    securityRbac?: SecurityRBACRequestContext;
  }
}

/**
 * Create RBAC middleware
 */
export function rbacMiddleware(
  options: RBACMiddlewareOptions = {}
): preHandlerHookHandler {
  const rbacService = options.rbacService ?? createRBACService();
  const skipPaths = new Set(options.skipPaths ?? []);

  const defaultExtractSubject = (request: FastifyRequest) => {
    const user = (request as { user?: {
      sub?: string;
      did?: string;
      type?: 'user' | 'agent' | 'service';
      trustTier?: TrustLevel;
      tenantId?: string;
    } }).user;

    if (!user?.sub && !user?.did) return undefined;

    return {
      id: user.did ?? user.sub!,
      type: user.type ?? 'user' as const,
      trustTier: user.trustTier,
      tenantId: user.tenantId,
    };
  };

  const extractSubject = options.extractSubject ?? defaultExtractSubject;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip configured paths
    if (skipPaths.has(request.url) || skipPaths.has(request.routeOptions.url ?? '')) {
      return;
    }

    const subject = extractSubject(request);

    // Build RBAC context
    const rbacContext: SecurityRBACRequestContext = {
      rbacService: rbacService,
      subject: subject ? {
        id: subject.id,
        type: subject.type,
        trustTier: subject.trustTier ?? 0,
        roles: [],
        permissions: [],
      } : undefined,
      checkAccess: async (resource: string, action: string, resourceId?: ID) => {
        if (!subject) {
          return {
            permitted: false,
            reason: 'No authenticated subject',
            checkedPermissions: [`${resource}:${action}`],
            evaluatedRoles: [],
            decisionSource: 'default' as const,
            durationMs: 0,
            evaluatedAt: new Date().toISOString(),
          };
        }
        return rbacService.checkAccess({
          subjectId: subject.id,
          subjectType: subject.type,
          resource,
          action,
          resourceId,
          tenantId: subject.tenantId,
          trustTier: subject.trustTier,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
        });
      },
      requireAccess: async (resource: string, action: string, resourceId?: ID) => {
        if (!subject) {
          throw new UnauthorizedError('Authentication required');
        }
        await rbacService.requireAccess({
          subjectId: subject.id,
          subjectType: subject.type,
          resource,
          action,
          resourceId,
          tenantId: subject.tenantId,
          trustTier: subject.trustTier,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
        });
      },
      hasPermission: async (permission: string) => {
        if (!subject) return false;
        return rbacService.hasPermission(subject.id, permission, subject.tenantId);
      },
      requirePermission: async (permission: string) => {
        if (!subject) {
          throw new UnauthorizedError('Authentication required');
        }
        await rbacService.requirePermission(subject.id, permission, subject.tenantId);
      },
    };

    // Populate roles and permissions if subject is available
    if (subject) {
      const roles = await rbacService.getSubjectRoles(subject.id, subject.tenantId);
      const permissions = await rbacService.getSubjectPermissions(subject.id, subject.tenantId);
      rbacContext.subject = {
        id: subject.id,
        type: subject.type,
        trustTier: subject.trustTier ?? 0,
        roles: roles.map(r => r.id),
        permissions: Array.from(permissions),
      };
    }

    request.securityRbac = rbacContext;

    // Check route-level permission if configured
    if (options.getRoutePermission) {
      const requiredPermission = options.getRoutePermission(request);
      if (requiredPermission) {
        await rbacContext.requirePermission(requiredPermission);
      }
    }
  };
}

/**
 * RBAC Fastify plugin
 */
const rbacPluginCallback: FastifyPluginCallback<RBACMiddlewareOptions> = (
  fastify: FastifyInstance,
  options: RBACMiddlewareOptions,
  done: (err?: Error) => void
) => {
  try {
    const rbacService = options.rbacService ?? createRBACService();

    // Add RBAC middleware
    fastify.addHook('preHandler', rbacMiddleware({
      ...options,
      rbacService,
    }));

    // Decorate fastify instance with RBAC service
    fastify.decorate('rbacService', rbacService);

    logger.info('RBAC plugin registered');
    done();
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * RBAC Fastify plugin
 */
export const rbacPlugin = fp(rbacPluginCallback, {
  name: 'vorion-rbac',
  fastify: '5.x',
});

declare module 'fastify' {
  interface FastifyInstance {
    rbacService?: RBACService;
  }
}

// =============================================================================
// ROUTE DECORATORS
// =============================================================================

/**
 * Permission requirement for route decoration
 */
export interface PermissionRequirement {
  /** Required permission */
  permission: string;
  /** Required role (alternative to permission) */
  role?: string;
  /** Required trust tier */
  trustTier?: TrustLevel;
  /** Operator for multiple requirements */
  operator?: 'and' | 'or';
}

/**
 * Create a preHandler that requires specific permissions
 */
export function requirePermissions(...permissions: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.securityRbac?.subject) {
      throw new UnauthorizedError('Authentication required');
    }

    for (const permission of permissions) {
      await request.securityRbac.requirePermission(permission);
    }
  };
}

/**
 * Create a preHandler that requires any of the specified permissions
 */
export function requireAnyPermission(...permissions: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.securityRbac?.subject) {
      throw new UnauthorizedError('Authentication required');
    }

    for (const permission of permissions) {
      const has = await request.securityRbac.hasPermission(permission);
      if (has) return;
    }

    throw new ForbiddenError(`Missing one of required permissions: ${permissions.join(', ')}`);
  };
}

/**
 * Create a preHandler that requires specific role
 */
export function requireRole(roleId: string): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.securityRbac?.subject) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!request.securityRbac.subject.roles.includes(roleId)) {
      throw new ForbiddenError(`Missing required role: ${roleId}`);
    }
  };
}

/**
 * Create a preHandler that requires resource-specific access
 */
export function requireResourceAccess(
  resource: string,
  action: string,
  getResourceId?: (request: FastifyRequest) => ID | undefined
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.securityRbac) {
      throw new UnauthorizedError('RBAC not configured');
    }

    const resourceId = getResourceId?.(request);
    await request.securityRbac.requireAccess(resource, action, resourceId);
  };
}

/**
 * Create a preHandler that requires minimum trust tier
 */
export function requireTrustTier(minimumTier: TrustLevel): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.securityRbac?.subject) {
      throw new UnauthorizedError('Authentication required');
    }

    if (request.securityRbac.subject.trustTier < minimumTier) {
      throw new ForbiddenError(
        `Insufficient trust tier: requires T${minimumTier}, has T${request.securityRbac.subject.trustTier}`
      );
    }
  };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let defaultRBACService: RBACService | null = null;

/**
 * Get the default RBAC service singleton
 */
export function getRBACService(options?: RBACServiceOptions): RBACService {
  if (!defaultRBACService) {
    defaultRBACService = createRBACService(options);
    logger.info('Default RBAC service created');
  }
  return defaultRBACService;
}

/**
 * Reset the default RBAC service (for testing)
 */
export function resetRBACService(): void {
  if (defaultRBACService) {
    defaultRBACService.destroy();
    defaultRBACService = null;
  }
}
