/**
 * Vorion Security SDK - @RequirePermission Decorator
 * Permission-based access control for methods
 */

import 'reflect-metadata';
import {
  RequirePermissionOptions,
  EvaluationContext,
  PolicyResult,
} from '../types';
import { getSecurityContext, SecurityError } from './secured';

// ============================================================================
// Permission Checker Interface
// ============================================================================

export interface PermissionChecker {
  /**
   * Check if user has a specific permission
   */
  hasPermission(
    context: EvaluationContext,
    permission: string,
    resource?: string
  ): Promise<boolean>;

  /**
   * Check if user has all specified permissions
   */
  hasAllPermissions(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean>;

  /**
   * Check if user has any of the specified permissions
   */
  hasAnyPermission(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean>;

  /**
   * Get all permissions for a user
   */
  getPermissions(context: EvaluationContext): Promise<string[]>;
}

// ============================================================================
// Default Permission Checker
// ============================================================================

/**
 * Default permission checker using context permissions
 */
export class DefaultPermissionChecker implements PermissionChecker {
  async hasPermission(
    context: EvaluationContext,
    permission: string,
    _resource?: string
  ): Promise<boolean> {
    const userPermissions = context.user.permissions || [];

    // Check direct permission match
    if (userPermissions.includes(permission)) {
      return true;
    }

    // Check wildcard permissions
    const parts = permission.split(':');
    for (let i = parts.length - 1; i >= 0; i--) {
      const wildcardPermission = [...parts.slice(0, i), '*'].join(':');
      if (userPermissions.includes(wildcardPermission)) {
        return true;
      }
    }

    // Check if user has global wildcard
    if (userPermissions.includes('*')) {
      return true;
    }

    return false;
  }

  async hasAllPermissions(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (!has) return false;
    }
    return true;
  }

  async hasAnyPermission(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (has) return true;
    }
    return false;
  }

  async getPermissions(context: EvaluationContext): Promise<string[]> {
    return context.user.permissions || [];
  }
}

// ============================================================================
// RBAC Permission Checker
// ============================================================================

export interface RBACConfig {
  roles: {
    [roleName: string]: {
      permissions: string[];
      inherits?: string[];
    };
  };
}

/**
 * Role-Based Access Control permission checker
 */
export class RBACPermissionChecker implements PermissionChecker {
  private config: RBACConfig;
  private permissionCache = new Map<string, Set<string>>();

  constructor(config: RBACConfig) {
    this.config = config;
    this.buildPermissionCache();
  }

  private buildPermissionCache(): void {
    for (const roleName of Object.keys(this.config.roles)) {
      this.getPermissionsForRole(roleName);
    }
  }

  private getPermissionsForRole(roleName: string, visited = new Set<string>()): Set<string> {
    // Check cache
    const cached = this.permissionCache.get(roleName);
    if (cached) return cached;

    // Prevent circular inheritance
    if (visited.has(roleName)) {
      return new Set();
    }
    visited.add(roleName);

    const role = this.config.roles[roleName];
    if (!role) {
      return new Set();
    }

    const permissions = new Set(role.permissions);

    // Add inherited permissions
    if (role.inherits) {
      for (const inheritedRole of role.inherits) {
        const inheritedPermissions = this.getPermissionsForRole(inheritedRole, visited);
        for (const perm of inheritedPermissions) {
          permissions.add(perm);
        }
      }
    }

    this.permissionCache.set(roleName, permissions);
    return permissions;
  }

  async hasPermission(
    context: EvaluationContext,
    permission: string,
    _resource?: string
  ): Promise<boolean> {
    const userRoles = context.user.roles || (context.user.role ? [context.user.role] : []);

    for (const role of userRoles) {
      const rolePermissions = this.getPermissionsForRole(role);
      if (this.matchesPermission(rolePermissions, permission)) {
        return true;
      }
    }

    // Also check direct user permissions
    const userPermissions = context.user.permissions || [];
    if (this.matchesPermission(new Set(userPermissions), permission)) {
      return true;
    }

    return false;
  }

  private matchesPermission(permissions: Set<string>, required: string): boolean {
    if (permissions.has(required)) return true;
    if (permissions.has('*')) return true;

    // Check wildcard permissions
    const parts = required.split(':');
    for (let i = parts.length - 1; i >= 0; i--) {
      const wildcardPermission = [...parts.slice(0, i), '*'].join(':');
      if (permissions.has(wildcardPermission)) {
        return true;
      }
    }

    return false;
  }

  async hasAllPermissions(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (!has) return false;
    }
    return true;
  }

  async hasAnyPermission(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (has) return true;
    }
    return false;
  }

  async getPermissions(context: EvaluationContext): Promise<string[]> {
    const userRoles = context.user.roles || (context.user.role ? [context.user.role] : []);
    const allPermissions = new Set<string>();

    for (const role of userRoles) {
      const rolePermissions = this.getPermissionsForRole(role);
      for (const perm of rolePermissions) {
        allPermissions.add(perm);
      }
    }

    // Add direct user permissions
    const userPermissions = context.user.permissions || [];
    for (const perm of userPermissions) {
      allPermissions.add(perm);
    }

    return Array.from(allPermissions);
  }
}

// ============================================================================
// ABAC Permission Checker
// ============================================================================

export interface ABACPolicy {
  permission: string;
  conditions: {
    userAttribute?: { [key: string]: unknown };
    resourceAttribute?: { [key: string]: unknown };
    environmentAttribute?: { [key: string]: unknown };
  };
}

/**
 * Attribute-Based Access Control permission checker
 */
export class ABACPermissionChecker implements PermissionChecker {
  private policies: ABACPolicy[];
  private fallback: PermissionChecker;

  constructor(policies: ABACPolicy[], fallback?: PermissionChecker) {
    this.policies = policies;
    this.fallback = fallback || new DefaultPermissionChecker();
  }

  async hasPermission(
    context: EvaluationContext,
    permission: string,
    resource?: string
  ): Promise<boolean> {
    // Find matching policies
    const matchingPolicies = this.policies.filter((p) =>
      this.matchesPermissionPattern(p.permission, permission)
    );

    for (const policy of matchingPolicies) {
      if (this.evaluatePolicy(policy, context, resource)) {
        return true;
      }
    }

    // Fall back to default checker
    return this.fallback.hasPermission(context, permission, resource);
  }

  private matchesPermissionPattern(pattern: string, permission: string): boolean {
    if (pattern === permission) return true;
    if (pattern === '*') return true;

    const patternParts = pattern.split(':');
    const permParts = permission.split(':');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') return true;
      if (patternParts[i] !== permParts[i]) return false;
    }

    return patternParts.length === permParts.length;
  }

  private evaluatePolicy(
    policy: ABACPolicy,
    context: EvaluationContext,
    _resource?: string
  ): boolean {
    const { conditions } = policy;

    // Check user attributes
    if (conditions.userAttribute) {
      for (const [key, value] of Object.entries(conditions.userAttribute)) {
        const userValue = this.getNestedValue(context.user, key);
        if (!this.matchesValue(userValue, value)) {
          return false;
        }
      }
    }

    // Check resource attributes
    if (conditions.resourceAttribute && context.resource) {
      for (const [key, value] of Object.entries(conditions.resourceAttribute)) {
        const resourceValue = this.getNestedValue(context.resource, key);
        if (!this.matchesValue(resourceValue, value)) {
          return false;
        }
      }
    }

    // Check environment attributes
    if (conditions.environmentAttribute && context.environment) {
      for (const [key, value] of Object.entries(conditions.environmentAttribute)) {
        const envValue = this.getNestedValue(context.environment, key);
        if (!this.matchesValue(envValue, value)) {
          return false;
        }
      }
    }

    return true;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected === '*') return actual !== undefined;

    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }

    if (typeof expected === 'object' && expected !== null) {
      const op = expected as Record<string, unknown>;
      if ('$in' in op) return (op.$in as unknown[]).includes(actual);
      if ('$nin' in op) return !(op.$nin as unknown[]).includes(actual);
      if ('$gt' in op) return (actual as number) > (op.$gt as number);
      if ('$gte' in op) return (actual as number) >= (op.$gte as number);
      if ('$lt' in op) return (actual as number) < (op.$lt as number);
      if ('$lte' in op) return (actual as number) <= (op.$lte as number);
      if ('$regex' in op) return new RegExp(op.$regex as string).test(String(actual));
    }

    return actual === expected;
  }

  async hasAllPermissions(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (!has) return false;
    }
    return true;
  }

  async hasAnyPermission(
    context: EvaluationContext,
    permissions: string[],
    resource?: string
  ): Promise<boolean> {
    for (const permission of permissions) {
      const has = await this.hasPermission(context, permission, resource);
      if (has) return true;
    }
    return false;
  }

  async getPermissions(context: EvaluationContext): Promise<string[]> {
    return this.fallback.getPermissions(context);
  }
}

// ============================================================================
// Global Permission Checker Configuration
// ============================================================================

let globalPermissionChecker: PermissionChecker = new DefaultPermissionChecker();

/**
 * Configure the global permission checker
 */
export function setPermissionChecker(checker: PermissionChecker): void {
  globalPermissionChecker = checker;
}

/**
 * Get the global permission checker
 */
export function getPermissionChecker(): PermissionChecker {
  return globalPermissionChecker;
}

// ============================================================================
// Metadata Storage
// ============================================================================

const PERMISSION_METADATA_KEY = Symbol('vorion:requirePermission');

// ============================================================================
// @RequirePermission Decorator
// ============================================================================

/**
 * @RequirePermission decorator for permission-based access control
 *
 * @example
 * class UserController {
 *   @RequirePermission('users:read')
 *   async getUser(id: string) {}
 *
 *   @RequirePermission('users:write')
 *   async updateUser(id: string, data: UpdateUserDto) {}
 *
 *   @RequirePermission('users:delete')
 *   async deleteUser(id: string) {}
 * }
 *
 * @example
 * // With resource-specific permission
 * class DocumentController {
 *   @RequirePermission({ permission: 'documents:read', resource: 'documentId' })
 *   async getDocument(documentId: string) {}
 * }
 */
export function RequirePermission(
  permissionOrOptions: string | RequirePermissionOptions
): MethodDecorator {
  const options: RequirePermissionOptions =
    typeof permissionOrOptions === 'string'
      ? { permission: permissionOrOptions }
      : permissionOrOptions;

  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    // Store metadata
    Reflect.defineMetadata(
      PERMISSION_METADATA_KEY,
      { options },
      target,
      propertyKey
    );

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const context = await getSecurityContext();
      const checker = getPermissionChecker();

      // Resolve resource if specified
      let resource: string | undefined;
      if (options.resource) {
        // Try to find resource in method arguments
        const paramIndex = getParameterIndex(target, propertyKey, options.resource);
        if (paramIndex !== -1 && args[paramIndex] !== undefined) {
          resource = String(args[paramIndex]);
        }
      }

      const hasPermission = await checker.hasPermission(
        context,
        options.permission,
        resource
      );

      if (!hasPermission) {
        const result: PolicyResult = {
          outcome: 'deny',
          reason: `Missing required permission: ${options.permission}`,
          policyId: 'require-permission-decorator',
          policyVersion: '1.0.0',
          timestamp: new Date(),
        };

        throw new PermissionDeniedError(
          `Access denied: missing permission '${options.permission}'`,
          result,
          options.permission
        );
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

function getParameterIndex(
  _target: object,
  _propertyKey: string | symbol,
  paramName: string
): number {
  // In a real implementation, this would use reflect-metadata to get parameter names
  // For now, we'll return -1 (not found) since parameter name extraction requires
  // additional decorators or source code analysis
  // This is a placeholder for more sophisticated parameter resolution
  console.warn(
    `Parameter resolution for '${paramName}' requires @Param decorator. ` +
      'Falling back to no resource-specific permission check.'
  );
  return -1;
}

// ============================================================================
// Errors
// ============================================================================

export class PermissionDeniedError extends SecurityError {
  public readonly permission: string;

  constructor(message: string, result: PolicyResult, permission: string) {
    super(message, result);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if user has a permission (programmatic API)
 */
export async function hasPermission(permission: string): Promise<boolean> {
  const context = await getSecurityContext();
  return globalPermissionChecker.hasPermission(context, permission);
}

/**
 * Check if user has all permissions (programmatic API)
 */
export async function hasAllPermissions(permissions: string[]): Promise<boolean> {
  const context = await getSecurityContext();
  return globalPermissionChecker.hasAllPermissions(context, permissions);
}

/**
 * Check if user has any permission (programmatic API)
 */
export async function hasAnyPermission(permissions: string[]): Promise<boolean> {
  const context = await getSecurityContext();
  return globalPermissionChecker.hasAnyPermission(context, permissions);
}

/**
 * Get current user's permissions
 */
export async function getCurrentPermissions(): Promise<string[]> {
  const context = await getSecurityContext();
  return globalPermissionChecker.getPermissions(context);
}

/**
 * Get required permission for a method
 */
export function getRequiredPermission(
  target: object,
  methodName: string
): RequirePermissionOptions | undefined {
  const metadata = Reflect.getMetadata(
    PERMISSION_METADATA_KEY,
    target,
    methodName
  ) as { options: RequirePermissionOptions } | undefined;

  return metadata?.options;
}

// ============================================================================
// Permission String Builders
// ============================================================================

/**
 * Build permission string from parts
 */
export function permission(...parts: string[]): string {
  return parts.join(':');
}

/**
 * Common permission patterns
 */
export const Permissions = {
  read: (resource: string) => `${resource}:read`,
  write: (resource: string) => `${resource}:write`,
  delete: (resource: string) => `${resource}:delete`,
  create: (resource: string) => `${resource}:create`,
  update: (resource: string) => `${resource}:update`,
  list: (resource: string) => `${resource}:list`,
  admin: (resource: string) => `${resource}:admin`,
  all: (resource: string) => `${resource}:*`,
};
