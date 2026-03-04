/**
 * RBAC Module
 *
 * Role-Based Access Control for Vorion platform.
 * Provides hierarchical roles, fine-grained permissions, and tenant isolation.
 *
 * @packageDocumentation
 */

// Types
export {
  ACTIONS,
  RESOURCES,
  SYSTEM_ROLES,
  type Action,
  type Resource,
  type Permission,
  type PermissionCondition,
  type PermissionString,
  type SystemRole,
  type Role,
  type RolePermission,
  type UserRole,
  type ServiceAccountRole,
  type AuthSubject,
  type AuthResource,
  type AuthEnvironment,
  type AuthContext,
  type AuthDecision,
  type PermissionEvalRequest,
  type PermissionEvalResult,
  type CreateRoleOptions,
  type UpdateRoleOptions,
  type AssignRoleOptions,
  type RevokeRoleOptions,
  type RBACauditEvent,
} from './types.js';

// Default permissions
export {
  SUPER_ADMIN_PERMISSIONS,
  TENANT_ADMIN_PERMISSIONS,
  POLICY_ADMIN_PERMISSIONS,
  SECURITY_ADMIN_PERMISSIONS,
  ESCALATION_APPROVER_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  OPERATOR_PERMISSIONS,
  USER_PERMISSIONS,
  SERVICE_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  getDefaultPermissions,
  isSystemRole,
  getRoleLevel,
} from './default-permissions.js';

// Service
export {
  RBACService,
  getRBACService,
  createRBACService,
} from './service.js';

// Store (database operations)
export {
  RBACStore,
  getRBACStore,
  createRBACStore,
} from './store.js';

// Middleware
export {
  createRBACMiddleware,
  requirePermission,
  requireRole,
  requireAnyPermission,
  requireAllPermissions,
  type RBACMiddlewareOptions,
} from './middleware.js';
