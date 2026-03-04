/**
 * Role Definitions for Role-Based Access Control (RBAC)
 *
 * Defines hierarchical roles with inherited permissions. Roles form a
 * hierarchy where higher-privilege roles inherit all permissions from
 * lower-privilege roles.
 *
 * Hierarchy: super_admin > admin > operator > analyst > viewer > guest
 *
 * Integration with TrustTier:
 * - Roles are assigned minimum trust tier requirements
 * - Higher privilege roles require higher trust tiers
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ID, TrustLevel } from '../../common/types.js';

// =============================================================================
// ROLE TYPES
// =============================================================================

/**
 * Built-in role identifiers
 */
export const BuiltinRoles = {
  /** Full system access - T5 required */
  SUPER_ADMIN: 'super_admin',
  /** Administrative access - T4 required */
  ADMIN: 'admin',
  /** Operational access - T3 required */
  OPERATOR: 'operator',
  /** Read and analysis access - T2 required */
  ANALYST: 'analyst',
  /** Read-only access - T1 required */
  VIEWER: 'viewer',
  /** Minimal access - T0 allowed */
  GUEST: 'guest',
} as const;

export type BuiltinRole = (typeof BuiltinRoles)[keyof typeof BuiltinRoles];

/**
 * Role priority for hierarchy (higher = more privileged)
 */
export const ROLE_PRIORITY: Record<BuiltinRole, number> = {
  [BuiltinRoles.SUPER_ADMIN]: 100,
  [BuiltinRoles.ADMIN]: 80,
  [BuiltinRoles.OPERATOR]: 60,
  [BuiltinRoles.ANALYST]: 40,
  [BuiltinRoles.VIEWER]: 20,
  [BuiltinRoles.GUEST]: 0,
} as const;

/**
 * Minimum trust tier required for each role
 */
export const ROLE_MINIMUM_TRUST_TIER: Record<BuiltinRole, TrustLevel> = {
  [BuiltinRoles.SUPER_ADMIN]: 5,
  [BuiltinRoles.ADMIN]: 4,
  [BuiltinRoles.OPERATOR]: 3,
  [BuiltinRoles.ANALYST]: 2,
  [BuiltinRoles.VIEWER]: 1,
  [BuiltinRoles.GUEST]: 0,
} as const;

/**
 * Role definition with permissions and inheritance
 */
export interface RoleDefinition {
  /** Unique role identifier */
  id: string;
  /** Display name */
  name: string;
  /** Role description */
  description: string;
  /** Parent role (for inheritance) */
  parentRole?: string;
  /** Priority for hierarchy resolution */
  priority: number;
  /** Minimum trust tier required */
  minimumTrustTier: TrustLevel;
  /** Directly assigned permissions (not inherited) */
  permissions: string[];
  /** Scope restrictions (e.g., tenant-specific) */
  scope?: RoleScope;
  /** Whether this is a system role (cannot be modified) */
  isSystemRole: boolean;
  /** Whether this role is enabled */
  enabled: boolean;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Role scope restrictions
 */
export interface RoleScope {
  /** Restrict to specific tenants */
  tenantIds?: ID[];
  /** Restrict to specific resource types */
  resourceTypes?: string[];
  /** Time-based restrictions */
  timeRestrictions?: TimeRestriction[];
  /** IP-based restrictions */
  ipRestrictions?: string[];
}

/**
 * Time-based restriction
 */
export interface TimeRestriction {
  /** Start time (HH:MM) */
  startTime: string;
  /** End time (HH:MM) */
  endTime: string;
  /** Days of week (0-6, 0 = Sunday) */
  daysOfWeek: number[];
  /** Timezone */
  timezone: string;
}

/**
 * Role assignment to a subject (user, agent, service)
 */
export interface RoleAssignment {
  /** Assignment identifier */
  id: ID;
  /** Subject ID (user, agent, or service) */
  subjectId: ID;
  /** Subject type */
  subjectType: 'user' | 'agent' | 'service';
  /** Assigned role ID */
  roleId: string;
  /** Tenant context (if tenant-scoped) */
  tenantId?: ID;
  /** Assignment conditions */
  conditions?: AssignmentConditions;
  /** Assignment expiration */
  expiresAt?: string;
  /** Who assigned this role */
  assignedBy: ID;
  /** Assignment timestamp */
  assignedAt: string;
  /** Whether assignment is active */
  active: boolean;
}

/**
 * Conditions for role assignment
 */
export interface AssignmentConditions {
  /** Required trust tier at evaluation time */
  requiredTrustTier?: TrustLevel;
  /** Required IP ranges */
  allowedIpRanges?: string[];
  /** Time-based conditions */
  timeConditions?: TimeRestriction[];
  /** Custom attribute requirements */
  attributeRequirements?: Record<string, unknown>;
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const timRestrictionSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  timezone: z.string(),
});

export const roleScopeSchema = z.object({
  tenantIds: z.array(z.string()).optional(),
  resourceTypes: z.array(z.string()).optional(),
  timeRestrictions: z.array(timRestrictionSchema).optional(),
  ipRestrictions: z.array(z.string()).optional(),
});

export const roleDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  parentRole: z.string().optional(),
  priority: z.number().int().min(0).max(1000),
  minimumTrustTier: z.number().int().min(0).max(7) as z.ZodType<TrustLevel>,
  permissions: z.array(z.string()),
  scope: roleScopeSchema.optional(),
  isSystemRole: z.boolean(),
  enabled: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const assignmentConditionsSchema = z.object({
  requiredTrustTier: z.number().int().min(0).max(7).optional() as z.ZodType<TrustLevel | undefined>,
  allowedIpRanges: z.array(z.string()).optional(),
  timeConditions: z.array(timRestrictionSchema).optional(),
  attributeRequirements: z.record(z.unknown()).optional(),
});

export const roleAssignmentSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  subjectType: z.enum(['user', 'agent', 'service']),
  roleId: z.string(),
  tenantId: z.string().optional(),
  conditions: assignmentConditionsSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  assignedBy: z.string(),
  assignedAt: z.string().datetime(),
  active: z.boolean(),
});

// =============================================================================
// BUILT-IN ROLE DEFINITIONS
// =============================================================================

/**
 * Get the built-in system roles
 */
export function getBuiltinRoles(): RoleDefinition[] {
  const now = new Date().toISOString();

  return [
    {
      id: BuiltinRoles.SUPER_ADMIN,
      name: 'Super Administrator',
      description: 'Full system access with all permissions. Can manage other admins and system configuration.',
      priority: ROLE_PRIORITY[BuiltinRoles.SUPER_ADMIN],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.SUPER_ADMIN],
      permissions: ['*'],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BuiltinRoles.ADMIN,
      name: 'Administrator',
      description: 'Administrative access for tenant management, user management, and configuration.',
      parentRole: BuiltinRoles.SUPER_ADMIN,
      priority: ROLE_PRIORITY[BuiltinRoles.ADMIN],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.ADMIN],
      permissions: [
        'tenant:*',
        'user:*',
        'role:*',
        'policy:*',
        'intent:*',
        'proof:*',
        'audit:read',
        'config:*',
      ],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BuiltinRoles.OPERATOR,
      name: 'Operator',
      description: 'Operational access for managing intents, approving escalations, and monitoring.',
      parentRole: BuiltinRoles.ADMIN,
      priority: ROLE_PRIORITY[BuiltinRoles.OPERATOR],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.OPERATOR],
      permissions: [
        'intent:read',
        'intent:create',
        'intent:update',
        'intent:approve',
        'intent:reject',
        'escalation:*',
        'proof:read',
        'proof:verify',
        'audit:read',
        'monitoring:*',
      ],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BuiltinRoles.ANALYST,
      name: 'Analyst',
      description: 'Read access with analysis capabilities for intents, proofs, and audit logs.',
      parentRole: BuiltinRoles.OPERATOR,
      priority: ROLE_PRIORITY[BuiltinRoles.ANALYST],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.ANALYST],
      permissions: [
        'intent:read',
        'intent:analyze',
        'proof:read',
        'proof:verify',
        'audit:read',
        'audit:export',
        'report:*',
        'dashboard:read',
      ],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BuiltinRoles.VIEWER,
      name: 'Viewer',
      description: 'Read-only access to view intents, proofs, and basic information.',
      parentRole: BuiltinRoles.ANALYST,
      priority: ROLE_PRIORITY[BuiltinRoles.VIEWER],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.VIEWER],
      permissions: [
        'intent:read',
        'proof:read',
        'dashboard:read',
        'profile:read',
      ],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BuiltinRoles.GUEST,
      name: 'Guest',
      description: 'Minimal access for unauthenticated or low-trust subjects.',
      parentRole: BuiltinRoles.VIEWER,
      priority: ROLE_PRIORITY[BuiltinRoles.GUEST],
      minimumTrustTier: ROLE_MINIMUM_TRUST_TIER[BuiltinRoles.GUEST],
      permissions: [
        'public:read',
        'health:read',
      ],
      isSystemRole: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// =============================================================================
// ROLE UTILITIES
// =============================================================================

/**
 * Check if a role inherits from another role
 */
export function roleInheritsFrom(
  role: RoleDefinition,
  ancestorId: string,
  roleRegistry: Map<string, RoleDefinition>
): boolean {
  if (role.id === ancestorId) {
    return true;
  }

  if (!role.parentRole) {
    return false;
  }

  const parent = roleRegistry.get(role.parentRole);
  if (!parent) {
    return false;
  }

  return roleInheritsFrom(parent, ancestorId, roleRegistry);
}

/**
 * Get all permissions for a role including inherited permissions
 */
export function getEffectivePermissions(
  role: RoleDefinition,
  roleRegistry: Map<string, RoleDefinition>
): Set<string> {
  const permissions = new Set<string>(role.permissions);

  // Add inherited permissions from parent role
  if (role.parentRole) {
    const parent = roleRegistry.get(role.parentRole);
    if (parent) {
      const parentPermissions = getEffectivePermissions(parent, roleRegistry);
      for (const perm of parentPermissions) {
        permissions.add(perm);
      }
    }
  }

  return permissions;
}

/**
 * Get the effective priority for a role (considering inheritance)
 */
export function getEffectivePriority(
  role: RoleDefinition,
  roleRegistry: Map<string, RoleDefinition>
): number {
  // Return the role's own priority
  return role.priority;
}

/**
 * Compare two roles for hierarchy
 * Returns positive if roleA > roleB, negative if roleA < roleB, 0 if equal
 */
export function compareRoles(
  roleA: RoleDefinition,
  roleB: RoleDefinition,
  roleRegistry: Map<string, RoleDefinition>
): number {
  const priorityA = getEffectivePriority(roleA, roleRegistry);
  const priorityB = getEffectivePriority(roleB, roleRegistry);
  return priorityA - priorityB;
}

/**
 * Get all ancestor roles in the hierarchy
 */
export function getAncestorRoles(
  role: RoleDefinition,
  roleRegistry: Map<string, RoleDefinition>
): RoleDefinition[] {
  const ancestors: RoleDefinition[] = [];

  let current: RoleDefinition | undefined = role;
  while (current?.parentRole) {
    const parent = roleRegistry.get(current.parentRole);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }

  return ancestors;
}

/**
 * Validate that a role hierarchy has no cycles
 */
export function validateRoleHierarchy(roleRegistry: Map<string, RoleDefinition>): {
  valid: boolean;
  cycles: string[][];
} {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function detectCycle(roleId: string, path: string[]): boolean {
    if (recursionStack.has(roleId)) {
      const cycleStart = path.indexOf(roleId);
      cycles.push(path.slice(cycleStart));
      return true;
    }

    if (visited.has(roleId)) {
      return false;
    }

    visited.add(roleId);
    recursionStack.add(roleId);
    path.push(roleId);

    const role = roleRegistry.get(roleId);
    if (role?.parentRole) {
      detectCycle(role.parentRole, path);
    }

    path.pop();
    recursionStack.delete(roleId);
    return false;
  }

  for (const roleId of roleRegistry.keys()) {
    detectCycle(roleId, []);
  }

  return {
    valid: cycles.length === 0,
    cycles,
  };
}

/**
 * Check if a trust tier meets the minimum requirement for a role
 */
export function meetsTrustRequirement(
  role: RoleDefinition,
  trustTier: TrustLevel
): boolean {
  return trustTier >= role.minimumTrustTier;
}

/**
 * Create a custom role definition
 */
export function createRoleDefinition(
  partial: Omit<RoleDefinition, 'createdAt' | 'updatedAt' | 'isSystemRole'> &
    Partial<Pick<RoleDefinition, 'isSystemRole'>>
): RoleDefinition {
  const now = new Date().toISOString();
  return {
    ...partial,
    isSystemRole: partial.isSystemRole ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a role assignment
 */
export function createRoleAssignment(
  partial: Omit<RoleAssignment, 'id' | 'assignedAt' | 'active'> &
    Partial<Pick<RoleAssignment, 'active'>>
): RoleAssignment {
  return {
    id: crypto.randomUUID(),
    ...partial,
    assignedAt: new Date().toISOString(),
    active: partial.active ?? true,
  };
}
