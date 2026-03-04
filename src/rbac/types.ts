/**
 * RBAC Module Types
 *
 * Defines the type system for Role-Based Access Control.
 * Supports hierarchical roles, fine-grained permissions, and tenant isolation.
 *
 * @packageDocumentation
 */

import type { ID } from '../common/types.js';

// =============================================================================
// PERMISSION SYSTEM
// =============================================================================

/**
 * Available actions that can be performed on resources
 */
export const ACTIONS = {
  // CRUD operations
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',

  // Advanced operations
  EXECUTE: 'execute',
  APPROVE: 'approve',
  REJECT: 'reject',
  ESCALATE: 'escalate',
  CANCEL: 'cancel',

  // Admin operations
  MANAGE: 'manage',
  ASSIGN: 'assign',
  REVOKE: 'revoke',
  AUDIT: 'audit',
  EXPORT: 'export',

  // Wildcard
  ALL: '*',
} as const;

export type Action = typeof ACTIONS[keyof typeof ACTIONS];

/**
 * Available resources that can be protected
 */
export const RESOURCES = {
  // Core resources
  INTENTS: 'intents',
  POLICIES: 'policies',
  ESCALATIONS: 'escalations',
  AGENTS: 'agents',

  // Trust resources
  TRUST_SCORES: 'trust_scores',
  TRUST_SIGNALS: 'trust_signals',

  // Security resources
  ROLES: 'roles',
  PERMISSIONS: 'permissions',
  USERS: 'users',
  SERVICE_ACCOUNTS: 'service_accounts',

  // Audit resources
  AUDIT_LOGS: 'audit_logs',
  WEBHOOKS: 'webhooks',

  // System resources
  TENANTS: 'tenants',
  SETTINGS: 'settings',

  // Wildcard
  ALL: '*',
} as const;

export type Resource = typeof RESOURCES[keyof typeof RESOURCES];

/**
 * A permission definition
 */
export interface Permission {
  /** The action being permitted */
  action: Action;
  /** The resource the action applies to */
  resource: Resource;
  /** Optional conditions that must be met */
  conditions?: PermissionCondition[];
}

/**
 * Condition types for fine-grained permissions
 */
export type PermissionCondition =
  | { type: 'owned'; field?: string }
  | { type: 'tenant_match' }
  | { type: 'status'; values: string[] }
  | { type: 'field_equals'; field: string; value: unknown }
  | { type: 'field_in'; field: string; values: unknown[] }
  | { type: 'time_window'; start?: string; end?: string }
  | { type: 'ip_whitelist'; cidrs: string[] }
  | { type: 'mfa_required' }
  | { type: 'custom'; evaluator: string; params?: Record<string, unknown> };

/**
 * Permission string format: "action:resource" or "action:resource:condition"
 * Examples: "read:intents", "create:policies", "manage:*", "*:*"
 */
export type PermissionString = `${Action}:${Resource}` | `${Action}:${Resource}:${string}`;

// =============================================================================
// ROLE SYSTEM
// =============================================================================

/**
 * Built-in system roles
 */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super_admin',
  TENANT_ADMIN: 'tenant:admin',
  POLICY_ADMIN: 'policy:admin',
  SECURITY_ADMIN: 'security:admin',
  ESCALATION_APPROVER: 'escalation_approver',
  AUDITOR: 'auditor',
  OPERATOR: 'operator',
  USER: 'user',
  SERVICE: 'service',
} as const;

export type SystemRole = typeof SYSTEM_ROLES[keyof typeof SYSTEM_ROLES];

/**
 * Role definition
 */
export interface Role {
  /** Unique identifier */
  id: ID;
  /** Role name (unique within tenant) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Tenant this role belongs to (null for global roles) */
  tenantId?: ID | null;
  /** Parent role for inheritance */
  parentRoleId?: ID | null;
  /** Whether this is a system role */
  isSystem: boolean;
  /** Whether the role is active */
  isActive: boolean;
  /** Role metadata */
  metadata?: Record<string, unknown>;
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role permission assignment
 */
export interface RolePermission {
  id: ID;
  roleId: ID;
  action: Action;
  resource: Resource;
  conditions?: PermissionCondition[];
  createdAt: Date;
}

/**
 * User role assignment
 */
export interface UserRole {
  id: ID;
  userId: ID;
  roleId: ID;
  tenantId: ID;
  grantedAt: Date;
  grantedBy?: ID;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Service account role assignment
 */
export interface ServiceAccountRole {
  id: ID;
  serviceAccountId: ID;
  roleId: ID;
  tenantId: ID;
  grantedAt: Date;
  grantedBy?: ID;
  expiresAt?: Date;
}

// =============================================================================
// AUTHORIZATION CONTEXT
// =============================================================================

/**
 * Subject requesting access
 */
export interface AuthSubject {
  type: 'user' | 'service_account' | 'system';
  id: ID;
  tenantId: ID;
  roles: string[];
  permissions?: PermissionString[];
  metadata?: Record<string, unknown>;
}

/**
 * Resource being accessed
 */
export interface AuthResource {
  type: Resource;
  id?: ID;
  tenantId?: ID;
  ownerId?: ID;
  attributes?: Record<string, unknown>;
}

/**
 * Environment context
 */
export interface AuthEnvironment {
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  mfaVerified?: boolean;
  sessionId?: string;
  traceId?: string;
}

/**
 * Full authorization context
 */
export interface AuthContext {
  subject: AuthSubject;
  resource: AuthResource;
  action: Action;
  environment: AuthEnvironment;
}

/**
 * Authorization decision
 */
export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  matchedPermissions?: PermissionString[];
  deniedBy?: string;
  constraints?: PermissionCondition[];
  auditId?: ID;
}

// =============================================================================
// PERMISSION EVALUATION
// =============================================================================

/**
 * Permission evaluation request
 */
export interface PermissionEvalRequest {
  subjectId: ID;
  subjectType: 'user' | 'service_account';
  tenantId: ID;
  action: Action;
  resource: Resource;
  resourceId?: ID;
  resourceAttributes?: Record<string, unknown>;
  environment?: Partial<AuthEnvironment>;
}

/**
 * Permission evaluation result
 */
export interface PermissionEvalResult {
  allowed: boolean;
  reason: string;
  evaluatedPermissions: {
    permission: PermissionString;
    matched: boolean;
    reason?: string;
  }[];
  effectiveRoles: string[];
  evaluationTimeMs: number;
}

// =============================================================================
// ROLE MANAGEMENT
// =============================================================================

/**
 * Options for creating a role
 */
export interface CreateRoleOptions {
  name: string;
  description?: string;
  tenantId?: ID;
  parentRoleId?: ID;
  permissions?: Permission[];
  metadata?: Record<string, unknown>;
}

/**
 * Options for updating a role
 */
export interface UpdateRoleOptions {
  name?: string;
  description?: string;
  parentRoleId?: ID | null;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Options for assigning a role to a user
 */
export interface AssignRoleOptions {
  userId: ID;
  roleId: ID;
  tenantId: ID;
  grantedBy?: ID;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Options for revoking a role from a user
 */
export interface RevokeRoleOptions {
  userId: ID;
  roleId: ID;
  tenantId: ID;
  revokedBy?: ID;
  reason?: string;
}

// =============================================================================
// AUDIT
// =============================================================================

/**
 * RBAC audit event
 */
export interface RBACauditEvent {
  id: ID;
  timestamp: Date;
  eventType:
    | 'role.created'
    | 'role.updated'
    | 'role.deleted'
    | 'permission.granted'
    | 'permission.revoked'
    | 'user_role.assigned'
    | 'user_role.revoked'
    | 'access.granted'
    | 'access.denied';
  actorId: ID;
  actorType: 'user' | 'service_account' | 'system';
  tenantId: ID;
  targetType: 'role' | 'permission' | 'user' | 'service_account';
  targetId: ID;
  details: Record<string, unknown>;
  traceId?: string;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ACTIONS as Actions,
  RESOURCES as Resources,
  SYSTEM_ROLES as SystemRoles,
};
