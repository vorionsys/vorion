/**
 * RBAC Database Schema
 *
 * Database schema for Role-Based Access Control (RBAC) system.
 * Includes roles, permissions, role-permission mappings, user-role
 * assignments, and access control policies.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =============================================================================
// RBAC ROLES TABLE
// =============================================================================

/**
 * RBAC Roles table
 *
 * Defines roles with hierarchical support (parent_role_id) and
 * priority-based ordering for permission resolution.
 */
export const rbacRoles = pgTable(
  "rbac_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(0), // Higher = more privileged
    parentRoleId: uuid("parent_role_id").references((): any => rbacRoles.id, {
      onDelete: "set null",
    }),
    tenantId: uuid("tenant_id"), // NULL for system/global roles
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Unique role name per tenant (uses COALESCE for NULL tenant handling)
    tenantNameIdx: uniqueIndex("rbac_roles_tenant_name_unique").on(
      table.tenantId,
      table.name,
    ),
    tenantIdx: index("rbac_roles_tenant_idx").on(table.tenantId),
    systemIdx: index("rbac_roles_system_idx").on(table.isSystem),
    activeIdx: index("rbac_roles_active_idx").on(table.isActive),
    parentIdx: index("rbac_roles_parent_idx").on(table.parentRoleId),
    priorityIdx: index("rbac_roles_priority_idx").on(table.priority),
  }),
);

// =============================================================================
// RBAC PERMISSIONS TABLE
// =============================================================================

/**
 * RBAC Permissions table
 *
 * Standalone permission definitions as action:resource pairs.
 */
export const rbacPermissions = pgTable(
  "rbac_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(), // create, read, update, delete, approve, etc.
    resource: text("resource").notNull(), // intent, policy, user, tenant, etc.
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    actionResourceIdx: uniqueIndex(
      "rbac_permissions_action_resource_unique",
    ).on(table.action, table.resource),
    resourceIdx: index("rbac_permissions_resource_idx").on(table.resource),
    actionIdx: index("rbac_permissions_action_idx").on(table.action),
    systemIdx: index("rbac_permissions_system_idx").on(table.isSystem),
  }),
);

// =============================================================================
// RBAC ROLE PERMISSIONS TABLE
// =============================================================================

/**
 * RBAC Role Permissions junction table
 *
 * Maps roles to permissions with grant metadata.
 */
export const rbacRolePermissions = pgTable(
  "rbac_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => rbacRoles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => rbacPermissions.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedBy: uuid("granted_by"), // User ID who granted the permission
    conditions: jsonb("conditions").$type<Record<string, unknown>>(), // Contextual conditions
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
    roleIdx: index("rbac_role_permissions_role_idx").on(table.roleId),
    permissionIdx: index("rbac_role_permissions_permission_idx").on(
      table.permissionId,
    ),
    grantedIdx: index("rbac_role_permissions_granted_idx").on(
      table.grantedBy,
      table.grantedAt,
    ),
  }),
);

// =============================================================================
// RBAC USER ROLES TABLE
// =============================================================================

/**
 * RBAC User Roles table
 *
 * User-role assignments with temporal support (expiration) and tenant isolation.
 */
export const rbacUserRoles = pgTable(
  "rbac_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // References auth.users or external user ID
    roleId: uuid("role_id")
      .notNull()
      .references(() => rbacRoles.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id"), // Tenant context for the role assignment
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedBy: uuid("assigned_by"), // User ID who assigned the role
    expiresAt: timestamp("expires_at", { withTimezone: true }), // NULL = no expiration
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    userRoleTenantIdx: uniqueIndex("rbac_user_roles_unique").on(
      table.userId,
      table.roleId,
      table.tenantId,
    ),
    userIdx: index("rbac_user_roles_user_idx").on(table.userId),
    userTenantIdx: index("rbac_user_roles_user_tenant_idx").on(
      table.userId,
      table.tenantId,
    ),
    tenantIdx: index("rbac_user_roles_tenant_idx").on(table.tenantId),
    roleIdx: index("rbac_user_roles_role_idx").on(table.roleId),
    expiresIdx: index("rbac_user_roles_expires_idx").on(table.expiresAt),
    activeIdx: index("rbac_user_roles_active_idx").on(
      table.userId,
      table.isActive,
    ),
  }),
);

// =============================================================================
// RBAC POLICIES TABLE
// =============================================================================

/**
 * Policy rules type for JSONB column
 */
export interface PolicyRules {
  effect: "allow" | "deny" | "indeterminate" | "not_applicable";
  description?: string;
  target?: {
    subjectIds?: string[];
    subjectTypes?: ("user" | "agent" | "service")[];
    roleIds?: string[];
    tenantIds?: string[];
    excludeSubjectIds?: string[];
  };
  conditions?: {
    ipAddresses?: string[];
    timeWindow?: {
      startTime: string;
      endTime: string;
      daysOfWeek: number[];
      timezone: string;
    };
    attributes?: Record<string, unknown>;
    expression?: string;
  };
  requiredPermissions?: string[];
  requiredRoles?: string[];
  requiredTrustTier?: number;
  resourcePatterns?: string[];
  trustTierRequirements?: Record<string, number>;
}

/**
 * RBAC Policies table
 *
 * Access control policies with JSONB rules for flexible policy definitions.
 */
export const rbacPolicies = pgTable(
  "rbac_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(), // role_based, resource_based, trust_based, time_based, conditional, composite
    rules: jsonb("rules").notNull().$type<PolicyRules>(),
    priority: integer("priority").notNull().default(0), // Higher = evaluated first
    tenantId: uuid("tenant_id"), // NULL for system/global policies
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantNameIdx: uniqueIndex("rbac_policies_tenant_name_unique").on(
      table.tenantId,
      table.name,
    ),
    tenantIdx: index("rbac_policies_tenant_idx").on(table.tenantId),
    typeIdx: index("rbac_policies_type_idx").on(table.type),
    activeIdx: index("rbac_policies_active_idx").on(table.isActive),
    priorityIdx: index("rbac_policies_priority_idx").on(table.priority),
    evalIdx: index("rbac_policies_eval_idx").on(
      table.isActive,
      table.priority,
      table.type,
    ),
  }),
);

// =============================================================================
// RELATIONS
// =============================================================================

/**
 * RBAC Roles relations
 */
export const rbacRolesRelations = relations(rbacRoles, ({ one, many }) => ({
  parentRole: one(rbacRoles, {
    fields: [rbacRoles.parentRoleId],
    references: [rbacRoles.id],
    relationName: "roleHierarchy",
  }),
  childRoles: many(rbacRoles, { relationName: "roleHierarchy" }),
  rolePermissions: many(rbacRolePermissions),
  userRoles: many(rbacUserRoles),
}));

/**
 * RBAC Permissions relations
 */
export const rbacPermissionsRelations = relations(
  rbacPermissions,
  ({ many }) => ({
    rolePermissions: many(rbacRolePermissions),
  }),
);

/**
 * RBAC Role Permissions relations
 */
export const rbacRolePermissionsRelations = relations(
  rbacRolePermissions,
  ({ one }) => ({
    role: one(rbacRoles, {
      fields: [rbacRolePermissions.roleId],
      references: [rbacRoles.id],
    }),
    permission: one(rbacPermissions, {
      fields: [rbacRolePermissions.permissionId],
      references: [rbacPermissions.id],
    }),
  }),
);

/**
 * RBAC User Roles relations
 */
export const rbacUserRolesRelations = relations(rbacUserRoles, ({ one }) => ({
  role: one(rbacRoles, {
    fields: [rbacUserRoles.roleId],
    references: [rbacRoles.id],
  }),
}));

// =============================================================================
// TYPES
// =============================================================================

export type RbacRole = typeof rbacRoles.$inferSelect;
export type NewRbacRole = typeof rbacRoles.$inferInsert;

export type RbacPermission = typeof rbacPermissions.$inferSelect;
export type NewRbacPermission = typeof rbacPermissions.$inferInsert;

export type RbacRolePermission = typeof rbacRolePermissions.$inferSelect;
export type NewRbacRolePermission = typeof rbacRolePermissions.$inferInsert;

export type RbacUserRole = typeof rbacUserRoles.$inferSelect;
export type NewRbacUserRole = typeof rbacUserRoles.$inferInsert;

export type RbacPolicy = typeof rbacPolicies.$inferSelect;
export type NewRbacPolicy = typeof rbacPolicies.$inferInsert;
