/**
 * Permission Definitions for Role-Based Access Control (RBAC)
 *
 * Defines a comprehensive permission system with:
 * - Resource-based permissions (resource:action format)
 * - Wildcard support for flexible permission patterns
 * - Permission categories for organization
 * - Permission validation and matching
 *
 * Permission format: `resource:action` or `resource:action:scope`
 * Examples:
 * - `intent:read` - Read any intent
 * - `intent:*` - All actions on intents
 * - `*` - All permissions (super admin)
 * - `tenant:user:create` - Create users within tenant scope
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ID } from '../../common/types.js';

// =============================================================================
// PERMISSION TYPES
// =============================================================================

/**
 * Permission actions that can be performed on resources
 */
export const PermissionActions = {
  // CRUD operations
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',

  // Specialized operations
  EXECUTE: 'execute',
  APPROVE: 'approve',
  REJECT: 'reject',
  ESCALATE: 'escalate',
  VERIFY: 'verify',
  EXPORT: 'export',
  IMPORT: 'import',
  ANALYZE: 'analyze',
  MANAGE: 'manage',
  CONFIGURE: 'configure',

  // Wildcard
  ALL: '*',
} as const;

export type PermissionAction = (typeof PermissionActions)[keyof typeof PermissionActions];

/**
 * Resource types that can be protected
 */
export const ResourceTypes = {
  // Core resources
  TENANT: 'tenant',
  USER: 'user',
  AGENT: 'agent',
  SERVICE: 'service',

  // Intent/governance resources
  INTENT: 'intent',
  POLICY: 'policy',
  CONSTRAINT: 'constraint',
  ESCALATION: 'escalation',

  // Audit/proof resources
  PROOF: 'proof',
  AUDIT: 'audit',
  AUDIT_LOG: 'audit_log',

  // Configuration resources
  CONFIG: 'config',
  ROLE: 'role',
  PERMISSION: 'permission',
  API_KEY: 'api_key',
  WEBHOOK: 'webhook',

  // Security resources
  SESSION: 'session',
  TOKEN: 'token',
  CREDENTIAL: 'credential',
  SECRET: 'secret',
  KEY: 'key',

  // Operational resources
  DASHBOARD: 'dashboard',
  REPORT: 'report',
  MONITORING: 'monitoring',
  HEALTH: 'health',
  METRICS: 'metrics',

  // Public resources
  PUBLIC: 'public',
  PROFILE: 'profile',

  // Trust resources
  TRUST_SCORE: 'trust_score',
  TRUST_SIGNAL: 'trust_signal',

  // Wildcard
  ALL: '*',
} as const;

export type ResourceType = (typeof ResourceTypes)[keyof typeof ResourceTypes];

/**
 * Permission categories for organization
 */
export const PermissionCategories = {
  ADMINISTRATION: 'administration',
  OPERATIONS: 'operations',
  SECURITY: 'security',
  AUDIT: 'audit',
  CONFIGURATION: 'configuration',
  MONITORING: 'monitoring',
  PUBLIC: 'public',
} as const;

export type PermissionCategory = (typeof PermissionCategories)[keyof typeof PermissionCategories];

/**
 * Permission definition
 */
export interface PermissionDefinition {
  /** Permission identifier (resource:action format) */
  id: string;
  /** Display name */
  name: string;
  /** Permission description */
  description: string;
  /** Resource type */
  resource: ResourceType | string;
  /** Action type */
  action: PermissionAction | string;
  /** Permission category */
  category: PermissionCategory;
  /** Whether this is sensitive (requires higher audit) */
  sensitive: boolean;
  /** Required for specific compliance (SOC2, GDPR, etc.) */
  compliance?: string[];
  /** Whether this is a system permission (cannot be modified) */
  isSystemPermission: boolean;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Permission check request
 */
export interface PermissionCheckRequest {
  /** Subject requesting permission */
  subjectId: ID;
  /** Subject type */
  subjectType: 'user' | 'agent' | 'service';
  /** Required permission(s) */
  permissions: string[];
  /** Resource being accessed (for resource-specific checks) */
  resourceId?: ID;
  /** Resource type */
  resourceType?: string;
  /** Tenant context */
  tenantId?: ID;
  /** Additional context for evaluation */
  context?: Record<string, unknown>;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether permission is granted */
  granted: boolean;
  /** Permissions that were granted */
  grantedPermissions: string[];
  /** Permissions that were denied */
  deniedPermissions: string[];
  /** Reason for denial (if denied) */
  reason?: string;
  /** How permission was granted (role, direct, inherited) */
  grantSource?: 'role' | 'direct' | 'inherited' | 'wildcard';
  /** Role that granted the permission */
  grantingRole?: string;
  /** Evaluation timestamp */
  evaluatedAt: string;
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const permissionDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  resource: z.string(),
  action: z.string(),
  category: z.nativeEnum(PermissionCategories),
  sensitive: z.boolean(),
  compliance: z.array(z.string()).optional(),
  isSystemPermission: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
});

export const permissionCheckRequestSchema = z.object({
  subjectId: z.string(),
  subjectType: z.enum(['user', 'agent', 'service']),
  permissions: z.array(z.string()).min(1),
  resourceId: z.string().optional(),
  resourceType: z.string().optional(),
  tenantId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export const permissionCheckResultSchema = z.object({
  granted: z.boolean(),
  grantedPermissions: z.array(z.string()),
  deniedPermissions: z.array(z.string()),
  reason: z.string().optional(),
  grantSource: z.enum(['role', 'direct', 'inherited', 'wildcard']).optional(),
  grantingRole: z.string().optional(),
  evaluatedAt: z.string().datetime(),
});

// =============================================================================
// BUILT-IN PERMISSIONS
// =============================================================================

/**
 * Get all built-in system permissions
 */
export function getBuiltinPermissions(): PermissionDefinition[] {
  return [
    // -------------------------------------------------------------------------
    // Administration Permissions
    // -------------------------------------------------------------------------
    {
      id: 'tenant:create',
      name: 'Create Tenant',
      description: 'Create new tenants',
      resource: ResourceTypes.TENANT,
      action: PermissionActions.CREATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'tenant:read',
      name: 'Read Tenant',
      description: 'View tenant information',
      resource: ResourceTypes.TENANT,
      action: PermissionActions.READ,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'tenant:update',
      name: 'Update Tenant',
      description: 'Modify tenant configuration',
      resource: ResourceTypes.TENANT,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'tenant:delete',
      name: 'Delete Tenant',
      description: 'Delete tenant and all associated data',
      resource: ResourceTypes.TENANT,
      action: PermissionActions.DELETE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2', 'GDPR'],
      isSystemPermission: true,
    },
    {
      id: 'user:create',
      name: 'Create User',
      description: 'Create new user accounts',
      resource: ResourceTypes.USER,
      action: PermissionActions.CREATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'user:read',
      name: 'Read User',
      description: 'View user information',
      resource: ResourceTypes.USER,
      action: PermissionActions.READ,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'user:update',
      name: 'Update User',
      description: 'Modify user accounts',
      resource: ResourceTypes.USER,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'user:delete',
      name: 'Delete User',
      description: 'Delete user accounts',
      resource: ResourceTypes.USER,
      action: PermissionActions.DELETE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2', 'GDPR'],
      isSystemPermission: true,
    },
    {
      id: 'role:create',
      name: 'Create Role',
      description: 'Create new roles',
      resource: ResourceTypes.ROLE,
      action: PermissionActions.CREATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'role:read',
      name: 'Read Role',
      description: 'View role definitions',
      resource: ResourceTypes.ROLE,
      action: PermissionActions.READ,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'role:update',
      name: 'Update Role',
      description: 'Modify role definitions',
      resource: ResourceTypes.ROLE,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'role:delete',
      name: 'Delete Role',
      description: 'Delete role definitions',
      resource: ResourceTypes.ROLE,
      action: PermissionActions.DELETE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'role:assign',
      name: 'Assign Role',
      description: 'Assign roles to users/agents',
      resource: ResourceTypes.ROLE,
      action: 'assign',
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Operations Permissions
    // -------------------------------------------------------------------------
    {
      id: 'intent:create',
      name: 'Create Intent',
      description: 'Submit new intents for evaluation',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.CREATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'intent:read',
      name: 'Read Intent',
      description: 'View intent details',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.READ,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'intent:update',
      name: 'Update Intent',
      description: 'Modify intent details',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'intent:approve',
      name: 'Approve Intent',
      description: 'Approve pending intents',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.APPROVE,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'intent:reject',
      name: 'Reject Intent',
      description: 'Reject pending intents',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.REJECT,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'intent:analyze',
      name: 'Analyze Intent',
      description: 'Perform analysis on intents',
      resource: ResourceTypes.INTENT,
      action: PermissionActions.ANALYZE,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'escalation:create',
      name: 'Create Escalation',
      description: 'Create escalation requests',
      resource: ResourceTypes.ESCALATION,
      action: PermissionActions.CREATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'escalation:read',
      name: 'Read Escalation',
      description: 'View escalation details',
      resource: ResourceTypes.ESCALATION,
      action: PermissionActions.READ,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'escalation:approve',
      name: 'Approve Escalation',
      description: 'Approve escalation requests',
      resource: ResourceTypes.ESCALATION,
      action: PermissionActions.APPROVE,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'escalation:reject',
      name: 'Reject Escalation',
      description: 'Reject escalation requests',
      resource: ResourceTypes.ESCALATION,
      action: PermissionActions.REJECT,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'policy:create',
      name: 'Create Policy',
      description: 'Create governance policies',
      resource: ResourceTypes.POLICY,
      action: PermissionActions.CREATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'policy:read',
      name: 'Read Policy',
      description: 'View policy definitions',
      resource: ResourceTypes.POLICY,
      action: PermissionActions.READ,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'policy:update',
      name: 'Update Policy',
      description: 'Modify policy definitions',
      resource: ResourceTypes.POLICY,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'policy:delete',
      name: 'Delete Policy',
      description: 'Delete policy definitions',
      resource: ResourceTypes.POLICY,
      action: PermissionActions.DELETE,
      category: PermissionCategories.OPERATIONS,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Audit Permissions
    // -------------------------------------------------------------------------
    {
      id: 'proof:read',
      name: 'Read Proof',
      description: 'View proof records',
      resource: ResourceTypes.PROOF,
      action: PermissionActions.READ,
      category: PermissionCategories.AUDIT,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'proof:verify',
      name: 'Verify Proof',
      description: 'Verify proof authenticity',
      resource: ResourceTypes.PROOF,
      action: PermissionActions.VERIFY,
      category: PermissionCategories.AUDIT,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'proof:export',
      name: 'Export Proof',
      description: 'Export proof records',
      resource: ResourceTypes.PROOF,
      action: PermissionActions.EXPORT,
      category: PermissionCategories.AUDIT,
      sensitive: true,
      compliance: ['SOC2', 'GDPR'],
      isSystemPermission: true,
    },
    {
      id: 'audit:read',
      name: 'Read Audit Log',
      description: 'View audit log entries',
      resource: ResourceTypes.AUDIT,
      action: PermissionActions.READ,
      category: PermissionCategories.AUDIT,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'audit:export',
      name: 'Export Audit Log',
      description: 'Export audit log entries',
      resource: ResourceTypes.AUDIT,
      action: PermissionActions.EXPORT,
      category: PermissionCategories.AUDIT,
      sensitive: true,
      compliance: ['SOC2', 'GDPR'],
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Security Permissions
    // -------------------------------------------------------------------------
    {
      id: 'api_key:create',
      name: 'Create API Key',
      description: 'Create new API keys',
      resource: ResourceTypes.API_KEY,
      action: PermissionActions.CREATE,
      category: PermissionCategories.SECURITY,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'api_key:read',
      name: 'Read API Key',
      description: 'View API key information',
      resource: ResourceTypes.API_KEY,
      action: PermissionActions.READ,
      category: PermissionCategories.SECURITY,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'api_key:delete',
      name: 'Delete API Key',
      description: 'Revoke API keys',
      resource: ResourceTypes.API_KEY,
      action: PermissionActions.DELETE,
      category: PermissionCategories.SECURITY,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'session:read',
      name: 'Read Session',
      description: 'View active sessions',
      resource: ResourceTypes.SESSION,
      action: PermissionActions.READ,
      category: PermissionCategories.SECURITY,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'session:delete',
      name: 'Delete Session',
      description: 'Terminate active sessions',
      resource: ResourceTypes.SESSION,
      action: PermissionActions.DELETE,
      category: PermissionCategories.SECURITY,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'secret:read',
      name: 'Read Secret',
      description: 'Access secrets',
      resource: ResourceTypes.SECRET,
      action: PermissionActions.READ,
      category: PermissionCategories.SECURITY,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'secret:manage',
      name: 'Manage Secret',
      description: 'Create, update, and rotate secrets',
      resource: ResourceTypes.SECRET,
      action: PermissionActions.MANAGE,
      category: PermissionCategories.SECURITY,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Configuration Permissions
    // -------------------------------------------------------------------------
    {
      id: 'config:read',
      name: 'Read Configuration',
      description: 'View system configuration',
      resource: ResourceTypes.CONFIG,
      action: PermissionActions.READ,
      category: PermissionCategories.CONFIGURATION,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'config:update',
      name: 'Update Configuration',
      description: 'Modify system configuration',
      resource: ResourceTypes.CONFIG,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.CONFIGURATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'webhook:create',
      name: 'Create Webhook',
      description: 'Create webhook configurations',
      resource: ResourceTypes.WEBHOOK,
      action: PermissionActions.CREATE,
      category: PermissionCategories.CONFIGURATION,
      sensitive: true,
      isSystemPermission: true,
    },
    {
      id: 'webhook:read',
      name: 'Read Webhook',
      description: 'View webhook configurations',
      resource: ResourceTypes.WEBHOOK,
      action: PermissionActions.READ,
      category: PermissionCategories.CONFIGURATION,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'webhook:update',
      name: 'Update Webhook',
      description: 'Modify webhook configurations',
      resource: ResourceTypes.WEBHOOK,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.CONFIGURATION,
      sensitive: true,
      isSystemPermission: true,
    },
    {
      id: 'webhook:delete',
      name: 'Delete Webhook',
      description: 'Delete webhook configurations',
      resource: ResourceTypes.WEBHOOK,
      action: PermissionActions.DELETE,
      category: PermissionCategories.CONFIGURATION,
      sensitive: true,
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Monitoring Permissions
    // -------------------------------------------------------------------------
    {
      id: 'dashboard:read',
      name: 'Read Dashboard',
      description: 'View dashboard data',
      resource: ResourceTypes.DASHBOARD,
      action: PermissionActions.READ,
      category: PermissionCategories.MONITORING,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'report:read',
      name: 'Read Report',
      description: 'View reports',
      resource: ResourceTypes.REPORT,
      action: PermissionActions.READ,
      category: PermissionCategories.MONITORING,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'report:create',
      name: 'Create Report',
      description: 'Generate new reports',
      resource: ResourceTypes.REPORT,
      action: PermissionActions.CREATE,
      category: PermissionCategories.MONITORING,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'report:export',
      name: 'Export Report',
      description: 'Export report data',
      resource: ResourceTypes.REPORT,
      action: PermissionActions.EXPORT,
      category: PermissionCategories.MONITORING,
      sensitive: true,
      compliance: ['GDPR'],
      isSystemPermission: true,
    },
    {
      id: 'monitoring:read',
      name: 'Read Monitoring',
      description: 'View monitoring data',
      resource: ResourceTypes.MONITORING,
      action: PermissionActions.READ,
      category: PermissionCategories.MONITORING,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'metrics:read',
      name: 'Read Metrics',
      description: 'View system metrics',
      resource: ResourceTypes.METRICS,
      action: PermissionActions.READ,
      category: PermissionCategories.MONITORING,
      sensitive: false,
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Public Permissions
    // -------------------------------------------------------------------------
    {
      id: 'public:read',
      name: 'Read Public',
      description: 'Access public information',
      resource: ResourceTypes.PUBLIC,
      action: PermissionActions.READ,
      category: PermissionCategories.PUBLIC,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'health:read',
      name: 'Read Health',
      description: 'View health check endpoints',
      resource: ResourceTypes.HEALTH,
      action: PermissionActions.READ,
      category: PermissionCategories.PUBLIC,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'profile:read',
      name: 'Read Profile',
      description: 'View own profile information',
      resource: ResourceTypes.PROFILE,
      action: PermissionActions.READ,
      category: PermissionCategories.PUBLIC,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'profile:update',
      name: 'Update Profile',
      description: 'Modify own profile information',
      resource: ResourceTypes.PROFILE,
      action: PermissionActions.UPDATE,
      category: PermissionCategories.PUBLIC,
      sensitive: false,
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Trust Permissions
    // -------------------------------------------------------------------------
    {
      id: 'trust_score:read',
      name: 'Read Trust Score',
      description: 'View trust scores',
      resource: ResourceTypes.TRUST_SCORE,
      action: PermissionActions.READ,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'trust_score:manage',
      name: 'Manage Trust Score',
      description: 'Modify trust scores',
      resource: ResourceTypes.TRUST_SCORE,
      action: PermissionActions.MANAGE,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
    {
      id: 'trust_signal:create',
      name: 'Create Trust Signal',
      description: 'Submit trust signals',
      resource: ResourceTypes.TRUST_SIGNAL,
      action: PermissionActions.CREATE,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },
    {
      id: 'trust_signal:read',
      name: 'Read Trust Signal',
      description: 'View trust signals',
      resource: ResourceTypes.TRUST_SIGNAL,
      action: PermissionActions.READ,
      category: PermissionCategories.OPERATIONS,
      sensitive: false,
      isSystemPermission: true,
    },

    // -------------------------------------------------------------------------
    // Wildcard Permissions
    // -------------------------------------------------------------------------
    {
      id: '*',
      name: 'Super Admin',
      description: 'All permissions (super administrator)',
      resource: ResourceTypes.ALL,
      action: PermissionActions.ALL,
      category: PermissionCategories.ADMINISTRATION,
      sensitive: true,
      compliance: ['SOC2'],
      isSystemPermission: true,
    },
  ];
}

// =============================================================================
// PERMISSION UTILITIES
// =============================================================================

/**
 * Parse a permission string into resource and action
 */
export function parsePermission(permission: string): {
  resource: string;
  action: string;
  scope?: string;
} {
  const parts = permission.split(':');

  if (parts.length === 1) {
    return { resource: parts[0]!, action: '*' };
  }

  if (parts.length === 2) {
    return { resource: parts[0]!, action: parts[1]! };
  }

  return {
    resource: parts[0]!,
    action: parts[1]!,
    scope: parts.slice(2).join(':'),
  };
}

/**
 * Build a permission string from components
 */
export function buildPermission(
  resource: string,
  action: string,
  scope?: string
): string {
  if (scope) {
    return `${resource}:${action}:${scope}`;
  }
  return `${resource}:${action}`;
}

/**
 * Check if a permission string matches a required permission
 * Supports wildcard matching
 */
export function permissionMatches(
  granted: string,
  required: string
): boolean {
  // Universal wildcard
  if (granted === '*') {
    return true;
  }

  const grantedParts = parsePermission(granted);
  const requiredParts = parsePermission(required);

  // Check resource match
  if (grantedParts.resource !== '*' && grantedParts.resource !== requiredParts.resource) {
    return false;
  }

  // Check action match
  if (grantedParts.action !== '*' && grantedParts.action !== requiredParts.action) {
    return false;
  }

  // Check scope match (if present)
  if (grantedParts.scope && requiredParts.scope) {
    if (grantedParts.scope !== '*' && grantedParts.scope !== requiredParts.scope) {
      return false;
    }
  }

  return true;
}

/**
 * Check if any granted permission matches the required permission
 */
export function hasPermission(
  grantedPermissions: Set<string> | string[],
  requiredPermission: string
): boolean {
  const permissions = grantedPermissions instanceof Set
    ? grantedPermissions
    : new Set(grantedPermissions);

  for (const granted of permissions) {
    if (permissionMatches(granted, requiredPermission)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if all required permissions are granted
 */
export function hasAllPermissions(
  grantedPermissions: Set<string> | string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.every(required =>
    hasPermission(grantedPermissions, required)
  );
}

/**
 * Check if any of the required permissions are granted
 */
export function hasAnyPermission(
  grantedPermissions: Set<string> | string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.some(required =>
    hasPermission(grantedPermissions, required)
  );
}

/**
 * Get all permissions that match a pattern
 */
export function filterMatchingPermissions(
  allPermissions: string[],
  pattern: string
): string[] {
  return allPermissions.filter(perm => permissionMatches(pattern, perm));
}

/**
 * Validate a permission string format
 */
export function isValidPermissionFormat(permission: string): boolean {
  // Allow single wildcard
  if (permission === '*') {
    return true;
  }

  // Must be resource:action format
  const parts = permission.split(':');
  if (parts.length < 1 || parts.length > 3) {
    return false;
  }

  // Each part must be alphanumeric with underscores or wildcard
  const validPart = /^[\w*]+$/;
  return parts.every(part => validPart.test(part));
}

/**
 * Get permissions grouped by category
 */
export function getPermissionsByCategory(): Record<PermissionCategory, PermissionDefinition[]> {
  const permissions = getBuiltinPermissions();
  const grouped: Record<PermissionCategory, PermissionDefinition[]> = {
    [PermissionCategories.ADMINISTRATION]: [],
    [PermissionCategories.OPERATIONS]: [],
    [PermissionCategories.SECURITY]: [],
    [PermissionCategories.AUDIT]: [],
    [PermissionCategories.CONFIGURATION]: [],
    [PermissionCategories.MONITORING]: [],
    [PermissionCategories.PUBLIC]: [],
  };

  for (const perm of permissions) {
    grouped[perm.category].push(perm);
  }

  return grouped;
}

/**
 * Get sensitive permissions
 */
export function getSensitivePermissions(): PermissionDefinition[] {
  return getBuiltinPermissions().filter(p => p.sensitive);
}

/**
 * Get permissions required for compliance
 */
export function getCompliancePermissions(compliance: string): PermissionDefinition[] {
  return getBuiltinPermissions().filter(
    p => p.compliance?.includes(compliance)
  );
}

/**
 * Create a custom permission definition
 */
export function createPermissionDefinition(
  partial: Omit<PermissionDefinition, 'isSystemPermission'> &
    Partial<Pick<PermissionDefinition, 'isSystemPermission'>>
): PermissionDefinition {
  return {
    ...partial,
    isSystemPermission: partial.isSystemPermission ?? false,
  };
}
