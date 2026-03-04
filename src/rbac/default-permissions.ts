/**
 * Default Role Permissions
 *
 * Defines the default permission sets for system roles.
 * These are used to initialize roles and can be customized per tenant.
 *
 * @packageDocumentation
 */

import {
  ACTIONS,
  RESOURCES,
  SYSTEM_ROLES,
  type Permission,
  type Action,
  type Resource,
} from './types.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a permission object
 */
function p(action: Action, resource: Resource): Permission {
  return { action, resource };
}

/**
 * Create owned permission (user can only access their own resources)
 */
function owned(action: Action, resource: Resource): Permission {
  return { action, resource, conditions: [{ type: 'owned' }] };
}

/**
 * Create all CRUD permissions for a resource
 */
function crud(resource: Resource): Permission[] {
  return [
    p(ACTIONS.CREATE, resource),
    p(ACTIONS.READ, resource),
    p(ACTIONS.UPDATE, resource),
    p(ACTIONS.DELETE, resource),
  ];
}

/**
 * Create read-only permission for a resource
 */
function readOnly(resource: Resource): Permission {
  return p(ACTIONS.READ, resource);
}

// =============================================================================
// SYSTEM ROLE PERMISSIONS
// =============================================================================

/**
 * Super Admin - Full system access
 */
export const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  p(ACTIONS.ALL, RESOURCES.ALL),
];

/**
 * Tenant Admin - Full tenant access
 */
export const TENANT_ADMIN_PERMISSIONS: Permission[] = [
  // Full tenant resource management
  ...crud(RESOURCES.INTENTS),
  ...crud(RESOURCES.POLICIES),
  ...crud(RESOURCES.ESCALATIONS),
  ...crud(RESOURCES.AGENTS),

  // Trust management
  ...crud(RESOURCES.TRUST_SCORES),
  ...crud(RESOURCES.TRUST_SIGNALS),

  // User management within tenant
  ...crud(RESOURCES.USERS),
  ...crud(RESOURCES.SERVICE_ACCOUNTS),
  ...crud(RESOURCES.ROLES),
  ...crud(RESOURCES.PERMISSIONS),

  // Audit access
  p(ACTIONS.READ, RESOURCES.AUDIT_LOGS),
  p(ACTIONS.EXPORT, RESOURCES.AUDIT_LOGS),

  // Webhook management
  ...crud(RESOURCES.WEBHOOKS),

  // Settings
  ...crud(RESOURCES.SETTINGS),

  // Tenant read-only
  p(ACTIONS.READ, RESOURCES.TENANTS),
];

/**
 * Policy Admin - Policy management focus
 */
export const POLICY_ADMIN_PERMISSIONS: Permission[] = [
  // Full policy management
  ...crud(RESOURCES.POLICIES),

  // Read intents to understand policy impact
  p(ACTIONS.READ, RESOURCES.INTENTS),

  // Trust visibility
  p(ACTIONS.READ, RESOURCES.TRUST_SCORES),
  p(ACTIONS.READ, RESOURCES.TRUST_SIGNALS),

  // Audit logs for compliance
  p(ACTIONS.READ, RESOURCES.AUDIT_LOGS),
];

/**
 * Security Admin - Security and access control focus
 */
export const SECURITY_ADMIN_PERMISSIONS: Permission[] = [
  // Role and permission management
  ...crud(RESOURCES.ROLES),
  ...crud(RESOURCES.PERMISSIONS),

  // User security management
  p(ACTIONS.READ, RESOURCES.USERS),
  p(ACTIONS.UPDATE, RESOURCES.USERS),

  // Service account management
  ...crud(RESOURCES.SERVICE_ACCOUNTS),

  // Trust management
  ...crud(RESOURCES.TRUST_SCORES),
  ...crud(RESOURCES.TRUST_SIGNALS),

  // Full audit access
  ...crud(RESOURCES.AUDIT_LOGS),
  p(ACTIONS.EXPORT, RESOURCES.AUDIT_LOGS),

  // Settings
  p(ACTIONS.READ, RESOURCES.SETTINGS),
  p(ACTIONS.UPDATE, RESOURCES.SETTINGS),
];

/**
 * Escalation Approver - Can approve/reject escalations
 */
export const ESCALATION_APPROVER_PERMISSIONS: Permission[] = [
  // Escalation management
  p(ACTIONS.READ, RESOURCES.ESCALATIONS),
  p(ACTIONS.APPROVE, RESOURCES.ESCALATIONS),
  p(ACTIONS.REJECT, RESOURCES.ESCALATIONS),

  // Read intents for context
  p(ACTIONS.READ, RESOURCES.INTENTS),

  // Read policies for context
  p(ACTIONS.READ, RESOURCES.POLICIES),

  // Trust visibility
  p(ACTIONS.READ, RESOURCES.TRUST_SCORES),

  // Audit logs
  p(ACTIONS.READ, RESOURCES.AUDIT_LOGS),
];

/**
 * Auditor - Read-only access for compliance
 */
export const AUDITOR_PERMISSIONS: Permission[] = [
  // Read everything
  readOnly(RESOURCES.INTENTS),
  readOnly(RESOURCES.POLICIES),
  readOnly(RESOURCES.ESCALATIONS),
  readOnly(RESOURCES.AGENTS),
  readOnly(RESOURCES.TRUST_SCORES),
  readOnly(RESOURCES.TRUST_SIGNALS),
  readOnly(RESOURCES.ROLES),
  readOnly(RESOURCES.PERMISSIONS),
  readOnly(RESOURCES.USERS),
  readOnly(RESOURCES.SERVICE_ACCOUNTS),
  readOnly(RESOURCES.WEBHOOKS),
  readOnly(RESOURCES.SETTINGS),

  // Full audit access
  p(ACTIONS.READ, RESOURCES.AUDIT_LOGS),
  p(ACTIONS.EXPORT, RESOURCES.AUDIT_LOGS),
];

/**
 * Operator - Day-to-day operations
 */
export const OPERATOR_PERMISSIONS: Permission[] = [
  // Intent operations
  p(ACTIONS.CREATE, RESOURCES.INTENTS),
  p(ACTIONS.READ, RESOURCES.INTENTS),
  p(ACTIONS.CANCEL, RESOURCES.INTENTS),

  // Read policies
  readOnly(RESOURCES.POLICIES),

  // Escalation handling
  p(ACTIONS.READ, RESOURCES.ESCALATIONS),
  p(ACTIONS.ESCALATE, RESOURCES.ESCALATIONS),

  // Trust visibility
  readOnly(RESOURCES.TRUST_SCORES),

  // Agent operations
  p(ACTIONS.READ, RESOURCES.AGENTS),
  p(ACTIONS.EXECUTE, RESOURCES.AGENTS),
];

/**
 * User - Basic user permissions
 */
export const USER_PERMISSIONS: Permission[] = [
  // Own intents only
  owned(ACTIONS.CREATE, RESOURCES.INTENTS),
  owned(ACTIONS.READ, RESOURCES.INTENTS),
  owned(ACTIONS.CANCEL, RESOURCES.INTENTS),

  // Read policies
  readOnly(RESOURCES.POLICIES),

  // Own escalations
  owned(ACTIONS.READ, RESOURCES.ESCALATIONS),

  // Own trust
  owned(ACTIONS.READ, RESOURCES.TRUST_SCORES),
];

/**
 * Service - Machine-to-machine permissions
 */
export const SERVICE_PERMISSIONS: Permission[] = [
  // Intent submission
  p(ACTIONS.CREATE, RESOURCES.INTENTS),
  p(ACTIONS.READ, RESOURCES.INTENTS),

  // Read policies
  readOnly(RESOURCES.POLICIES),

  // Trust operations
  p(ACTIONS.READ, RESOURCES.TRUST_SCORES),
  p(ACTIONS.CREATE, RESOURCES.TRUST_SIGNALS),

  // Webhook callbacks
  p(ACTIONS.READ, RESOURCES.WEBHOOKS),
];

// =============================================================================
// ROLE TO PERMISSIONS MAP
// =============================================================================

/**
 * Map of system roles to their default permissions
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
  [SYSTEM_ROLES.TENANT_ADMIN]: TENANT_ADMIN_PERMISSIONS,
  [SYSTEM_ROLES.POLICY_ADMIN]: POLICY_ADMIN_PERMISSIONS,
  [SYSTEM_ROLES.SECURITY_ADMIN]: SECURITY_ADMIN_PERMISSIONS,
  [SYSTEM_ROLES.ESCALATION_APPROVER]: ESCALATION_APPROVER_PERMISSIONS,
  [SYSTEM_ROLES.AUDITOR]: AUDITOR_PERMISSIONS,
  [SYSTEM_ROLES.OPERATOR]: OPERATOR_PERMISSIONS,
  [SYSTEM_ROLES.USER]: USER_PERMISSIONS,
  [SYSTEM_ROLES.SERVICE]: SERVICE_PERMISSIONS,
};

/**
 * Get default permissions for a role
 */
export function getDefaultPermissions(roleName: string): Permission[] {
  return DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
}

/**
 * Check if a role is a system role
 */
export function isSystemRole(roleName: string): boolean {
  return Object.values(SYSTEM_ROLES).includes(roleName as any);
}

/**
 * Get role hierarchy level (higher = more privileged)
 */
export function getRoleLevel(roleName: string): number {
  const levels: Record<string, number> = {
    [SYSTEM_ROLES.SUPER_ADMIN]: 100,
    [SYSTEM_ROLES.TENANT_ADMIN]: 90,
    [SYSTEM_ROLES.SECURITY_ADMIN]: 80,
    [SYSTEM_ROLES.POLICY_ADMIN]: 70,
    [SYSTEM_ROLES.ESCALATION_APPROVER]: 60,
    [SYSTEM_ROLES.AUDITOR]: 50,
    [SYSTEM_ROLES.OPERATOR]: 40,
    [SYSTEM_ROLES.SERVICE]: 30,
    [SYSTEM_ROLES.USER]: 20,
  };
  return levels[roleName] ?? 10;
}
