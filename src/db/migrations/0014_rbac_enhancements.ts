/**
 * RBAC Enhancements Migration
 *
 * TypeScript migration helper for the RBAC system enhancements.
 * Provides programmatic migration utilities and seed data functions.
 *
 * Corresponding SQL migration: drizzle/migrations/0014_rbac_enhancements.sql
 *
 * @packageDocumentation
 */

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  rbacRoles,
  rbacPermissions,
  rbacRolePermissions,
  rbacUserRoles,
  rbacPolicies,
  type NewRbacRole,
  type NewRbacPermission,
  type PolicyRules,
} from '../schema/rbac.js';

/**
 * Migration metadata
 */
export const migrationInfo = {
  version: '0014',
  name: 'rbac_enhancements',
  description: 'Enhanced RBAC tables for full role/permission/policy management',
  author: 'Claude Code',
  date: '2026-02-03',
};

/**
 * Built-in role definitions with priority levels
 */
export const SYSTEM_ROLES: Omit<NewRbacRole, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'super_admin',
    description: 'Full system access with all permissions - T5 required',
    priority: 100,
    isSystem: true,
    isActive: true,
  },
  {
    name: 'admin',
    description: 'Administrative access for tenant/user/config management - T4 required',
    priority: 80,
    isSystem: true,
    isActive: true,
  },
  {
    name: 'operator',
    description: 'Operational access for intents, escalations, monitoring - T3 required',
    priority: 60,
    isSystem: true,
    isActive: true,
  },
  {
    name: 'analyst',
    description: 'Read and analysis access for intents, proofs, audit - T2 required',
    priority: 40,
    isSystem: true,
    isActive: true,
  },
  {
    name: 'viewer',
    description: 'Read-only access to intents, proofs, dashboards - T1 required',
    priority: 20,
    isSystem: true,
    isActive: true,
  },
  {
    name: 'guest',
    description: 'Minimal access for public endpoints - T0 allowed',
    priority: 0,
    isSystem: true,
    isActive: true,
  },
];

/**
 * Role hierarchy (child -> parent)
 */
export const ROLE_HIERARCHY: Record<string, string> = {
  admin: 'super_admin',
  operator: 'admin',
  analyst: 'operator',
  viewer: 'analyst',
  guest: 'viewer',
};

/**
 * Built-in permission definitions
 */
export const SYSTEM_PERMISSIONS: Omit<NewRbacPermission, 'id' | 'createdAt'>[] = [
  // Wildcard
  { action: '*', resource: '*', description: 'All permissions on all resources', isSystem: true },

  // Tenant permissions
  { action: 'create', resource: 'tenant', description: 'Create new tenants', isSystem: true },
  { action: 'read', resource: 'tenant', description: 'View tenant information', isSystem: true },
  { action: 'update', resource: 'tenant', description: 'Modify tenant configuration', isSystem: true },
  { action: 'delete', resource: 'tenant', description: 'Delete tenant and associated data', isSystem: true },
  { action: '*', resource: 'tenant', description: 'All permissions on tenants', isSystem: true },

  // User permissions
  { action: 'create', resource: 'user', description: 'Create new user accounts', isSystem: true },
  { action: 'read', resource: 'user', description: 'View user information', isSystem: true },
  { action: 'update', resource: 'user', description: 'Modify user accounts', isSystem: true },
  { action: 'delete', resource: 'user', description: 'Delete user accounts', isSystem: true },
  { action: '*', resource: 'user', description: 'All permissions on users', isSystem: true },

  // Role permissions
  { action: 'create', resource: 'role', description: 'Create new roles', isSystem: true },
  { action: 'read', resource: 'role', description: 'View role definitions', isSystem: true },
  { action: 'update', resource: 'role', description: 'Modify role definitions', isSystem: true },
  { action: 'delete', resource: 'role', description: 'Delete role definitions', isSystem: true },
  { action: 'assign', resource: 'role', description: 'Assign roles to users', isSystem: true },
  { action: '*', resource: 'role', description: 'All permissions on roles', isSystem: true },

  // Intent permissions
  { action: 'create', resource: 'intent', description: 'Submit new intents', isSystem: true },
  { action: 'read', resource: 'intent', description: 'View intent details', isSystem: true },
  { action: 'update', resource: 'intent', description: 'Modify intent details', isSystem: true },
  { action: 'approve', resource: 'intent', description: 'Approve pending intents', isSystem: true },
  { action: 'reject', resource: 'intent', description: 'Reject pending intents', isSystem: true },
  { action: 'analyze', resource: 'intent', description: 'Perform analysis on intents', isSystem: true },
  { action: '*', resource: 'intent', description: 'All permissions on intents', isSystem: true },

  // Policy permissions
  { action: 'create', resource: 'policy', description: 'Create governance policies', isSystem: true },
  { action: 'read', resource: 'policy', description: 'View policy definitions', isSystem: true },
  { action: 'update', resource: 'policy', description: 'Modify policy definitions', isSystem: true },
  { action: 'delete', resource: 'policy', description: 'Delete policy definitions', isSystem: true },
  { action: '*', resource: 'policy', description: 'All permissions on policies', isSystem: true },

  // Escalation permissions
  { action: 'create', resource: 'escalation', description: 'Create escalation requests', isSystem: true },
  { action: 'read', resource: 'escalation', description: 'View escalation details', isSystem: true },
  { action: 'approve', resource: 'escalation', description: 'Approve escalation requests', isSystem: true },
  { action: 'reject', resource: 'escalation', description: 'Reject escalation requests', isSystem: true },
  { action: '*', resource: 'escalation', description: 'All permissions on escalations', isSystem: true },

  // Proof permissions
  { action: 'read', resource: 'proof', description: 'View proof records', isSystem: true },
  { action: 'verify', resource: 'proof', description: 'Verify proof authenticity', isSystem: true },
  { action: 'export', resource: 'proof', description: 'Export proof records', isSystem: true },
  { action: '*', resource: 'proof', description: 'All permissions on proofs', isSystem: true },

  // Audit permissions
  { action: 'read', resource: 'audit', description: 'View audit log entries', isSystem: true },
  { action: 'export', resource: 'audit', description: 'Export audit log entries', isSystem: true },

  // Config permissions
  { action: 'read', resource: 'config', description: 'View system configuration', isSystem: true },
  { action: 'update', resource: 'config', description: 'Modify system configuration', isSystem: true },
  { action: '*', resource: 'config', description: 'All permissions on configuration', isSystem: true },

  // Monitoring permissions
  { action: 'read', resource: 'dashboard', description: 'View dashboard data', isSystem: true },
  { action: 'read', resource: 'report', description: 'View reports', isSystem: true },
  { action: 'create', resource: 'report', description: 'Generate new reports', isSystem: true },
  { action: 'export', resource: 'report', description: 'Export report data', isSystem: true },
  { action: 'read', resource: 'monitoring', description: 'View monitoring data', isSystem: true },
  { action: 'read', resource: 'metrics', description: 'View system metrics', isSystem: true },
  { action: '*', resource: 'monitoring', description: 'All permissions on monitoring', isSystem: true },

  // Public permissions
  { action: 'read', resource: 'public', description: 'Access public information', isSystem: true },
  { action: 'read', resource: 'health', description: 'View health check endpoints', isSystem: true },
  { action: 'read', resource: 'profile', description: 'View own profile information', isSystem: true },
  { action: 'update', resource: 'profile', description: 'Modify own profile information', isSystem: true },

  // Trust permissions
  { action: 'read', resource: 'trust_score', description: 'View trust scores', isSystem: true },
  { action: 'manage', resource: 'trust_score', description: 'Modify trust scores', isSystem: true },
  { action: 'create', resource: 'trust_signal', description: 'Submit trust signals', isSystem: true },
  { action: 'read', resource: 'trust_signal', description: 'View trust signals', isSystem: true },
];

/**
 * Permission mappings for each role
 */
export const ROLE_PERMISSION_MAPPINGS: Record<string, { action: string; resource: string }[]> = {
  super_admin: [{ action: '*', resource: '*' }],
  admin: [
    { action: '*', resource: 'tenant' },
    { action: '*', resource: 'user' },
    { action: '*', resource: 'role' },
    { action: '*', resource: 'policy' },
    { action: '*', resource: 'intent' },
    { action: '*', resource: 'config' },
    { action: 'read', resource: 'audit' },
    { action: 'read', resource: 'proof' },
  ],
  operator: [
    { action: 'read', resource: 'intent' },
    { action: 'create', resource: 'intent' },
    { action: 'update', resource: 'intent' },
    { action: 'approve', resource: 'intent' },
    { action: 'reject', resource: 'intent' },
    { action: '*', resource: 'escalation' },
    { action: 'read', resource: 'proof' },
    { action: 'verify', resource: 'proof' },
    { action: 'read', resource: 'audit' },
    { action: '*', resource: 'monitoring' },
  ],
  analyst: [
    { action: 'read', resource: 'intent' },
    { action: 'analyze', resource: 'intent' },
    { action: 'read', resource: 'proof' },
    { action: 'verify', resource: 'proof' },
    { action: 'read', resource: 'audit' },
    { action: 'export', resource: 'audit' },
    { action: 'read', resource: 'report' },
    { action: 'create', resource: 'report' },
    { action: 'export', resource: 'report' },
    { action: 'read', resource: 'dashboard' },
  ],
  viewer: [
    { action: 'read', resource: 'intent' },
    { action: 'read', resource: 'proof' },
    { action: 'read', resource: 'dashboard' },
    { action: 'read', resource: 'profile' },
  ],
  guest: [
    { action: 'read', resource: 'public' },
    { action: 'read', resource: 'health' },
  ],
};

/**
 * Default access control policies
 */
export const DEFAULT_POLICIES: {
  name: string;
  type: string;
  rules: PolicyRules;
  priority: number;
}[] = [
  {
    name: 'default_deny',
    type: 'role_based',
    rules: {
      effect: 'deny',
      description: 'Default deny policy - explicit permissions required',
      target: { subjectTypes: ['user', 'agent', 'service'] },
    },
    priority: -1000,
  },
  {
    name: 'super_admin_allow_all',
    type: 'role_based',
    rules: {
      effect: 'allow',
      description: 'Super admins have unrestricted access',
      requiredRoles: ['super_admin'],
      resourcePatterns: ['*:*'],
    },
    priority: 1000,
  },
  {
    name: 'trust_tier_enforcement',
    type: 'trust_based',
    rules: {
      effect: 'deny',
      description: 'Enforce minimum trust tier requirements for roles',
      trustTierRequirements: {
        super_admin: 5,
        admin: 4,
        operator: 3,
        analyst: 2,
        viewer: 1,
        guest: 0,
      },
    },
    priority: 900,
  },
];

/**
 * Seed system roles into the database
 */
export async function seedSystemRoles(db: NodePgDatabase<any>): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const role of SYSTEM_ROLES) {
    const [inserted] = await db
      .insert(rbacRoles)
      .values(role)
      .onConflictDoNothing()
      .returning({ id: rbacRoles.id, name: rbacRoles.name });

    if (inserted) {
      roleIds.set(inserted.name, inserted.id);
    }
  }

  // Set up role hierarchy
  for (const [childRole, parentRole] of Object.entries(ROLE_HIERARCHY)) {
    const childId = roleIds.get(childRole);
    const parentId = roleIds.get(parentRole);

    if (childId && parentId) {
      await db
        .update(rbacRoles)
        .set({ parentRoleId: parentId })
        .where(sql`${rbacRoles.id} = ${childId}`);
    }
  }

  return roleIds;
}

/**
 * Seed system permissions into the database
 */
export async function seedSystemPermissions(db: NodePgDatabase<any>): Promise<Map<string, string>> {
  const permissionIds = new Map<string, string>();

  for (const permission of SYSTEM_PERMISSIONS) {
    const [inserted] = await db
      .insert(rbacPermissions)
      .values(permission)
      .onConflictDoNothing()
      .returning({ id: rbacPermissions.id, action: rbacPermissions.action, resource: rbacPermissions.resource });

    if (inserted) {
      permissionIds.set(`${inserted.action}:${inserted.resource}`, inserted.id);
    }
  }

  return permissionIds;
}

/**
 * Seed role-permission mappings
 */
export async function seedRolePermissions(
  db: NodePgDatabase<any>,
  roleIds: Map<string, string>,
  permissionIds: Map<string, string>
): Promise<void> {
  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSION_MAPPINGS)) {
    const roleId = roleIds.get(roleName);
    if (!roleId) continue;

    for (const { action, resource } of permissions) {
      const permissionId = permissionIds.get(`${action}:${resource}`);
      if (!permissionId) continue;

      await db
        .insert(rbacRolePermissions)
        .values({
          roleId,
          permissionId,
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Seed default policies
 */
export async function seedDefaultPolicies(db: NodePgDatabase<any>): Promise<void> {
  for (const policy of DEFAULT_POLICIES) {
    await db
      .insert(rbacPolicies)
      .values({
        name: policy.name,
        type: policy.type,
        rules: policy.rules,
        priority: policy.priority,
        isActive: true,
      })
      .onConflictDoNothing();
  }
}

/**
 * Run the complete seed operation
 */
export async function seedRbacData(db: NodePgDatabase<any>): Promise<{
  rolesCount: number;
  permissionsCount: number;
  mappingsCount: number;
  policiesCount: number;
}> {
  const roleIds = await seedSystemRoles(db);
  const permissionIds = await seedSystemPermissions(db);
  await seedRolePermissions(db, roleIds, permissionIds);
  await seedDefaultPolicies(db);

  return {
    rolesCount: roleIds.size,
    permissionsCount: permissionIds.size,
    mappingsCount: Object.values(ROLE_PERMISSION_MAPPINGS).reduce((sum, perms) => sum + perms.length, 0),
    policiesCount: DEFAULT_POLICIES.length,
  };
}

/**
 * Check if migration has been applied
 */
export async function isMigrationApplied(db: NodePgDatabase<any>): Promise<boolean> {
  try {
    // Check if rbac_roles table exists
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'rbac_roles'
      ) as exists
    `);

    return (result.rows[0] as any)?.exists ?? false;
  } catch {
    return false;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(db: NodePgDatabase<any>): Promise<{
  applied: boolean;
  rolesCount: number;
  permissionsCount: number;
  policiesCount: number;
}> {
  const applied = await isMigrationApplied(db);

  if (!applied) {
    return { applied: false, rolesCount: 0, permissionsCount: 0, policiesCount: 0 };
  }

  const [rolesResult, permissionsResult, policiesResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM rbac_roles`),
    db.execute(sql`SELECT COUNT(*) as count FROM rbac_permissions`),
    db.execute(sql`SELECT COUNT(*) as count FROM rbac_policies`),
  ]);

  return {
    applied: true,
    rolesCount: Number((rolesResult.rows[0] as any)?.count ?? 0),
    permissionsCount: Number((permissionsResult.rows[0] as any)?.count ?? 0),
    policiesCount: Number((policiesResult.rows[0] as any)?.count ?? 0),
  };
}
