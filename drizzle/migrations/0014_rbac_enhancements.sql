-- Migration: 0014_rbac_enhancements
-- Description: Enhanced RBAC tables for full role/permission/policy management
-- Author: Claude Code
-- Date: 2026-02-03
--
-- This migration enhances the RBAC system with:
--   - rbac_roles: Enhanced roles with priority for hierarchy
--   - rbac_permissions: Standalone permission definitions
--   - rbac_role_permissions: Junction table mapping roles to permissions
--   - rbac_user_roles: User-role assignments (renamed from user_roles)
--   - rbac_policies: Access control policies with JSONB rules
--
-- Note: This extends the existing RBAC tables from 0013_rbac_tables.sql

-- =============================================================================
-- RBAC ROLES TABLE
-- Enhanced role definitions with priority for hierarchy resolution
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 0,  -- Higher = more privileged (100=super_admin, 0=guest)
  parent_role_id UUID REFERENCES rbac_roles(id) ON DELETE SET NULL,
  tenant_id UUID,  -- NULL for system/global roles
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique role name per tenant (NULL tenant = global)
CREATE UNIQUE INDEX IF NOT EXISTS rbac_roles_tenant_name_unique
  ON rbac_roles (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::UUID), name);

-- Index for tenant role lookups
CREATE INDEX IF NOT EXISTS rbac_roles_tenant_idx
  ON rbac_roles (tenant_id) WHERE tenant_id IS NOT NULL;

-- Index for system role lookups
CREATE INDEX IF NOT EXISTS rbac_roles_system_idx
  ON rbac_roles (is_system) WHERE is_system = TRUE;

-- Index for active roles
CREATE INDEX IF NOT EXISTS rbac_roles_active_idx
  ON rbac_roles (is_active) WHERE is_active = TRUE;

-- Index for role hierarchy queries
CREATE INDEX IF NOT EXISTS rbac_roles_parent_idx
  ON rbac_roles (parent_role_id) WHERE parent_role_id IS NOT NULL;

-- Index for priority-based ordering
CREATE INDEX IF NOT EXISTS rbac_roles_priority_idx
  ON rbac_roles (priority DESC);

-- =============================================================================
-- RBAC PERMISSIONS TABLE
-- Standalone permission definitions (resource:action pairs)
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,  -- e.g., 'create', 'read', 'update', 'delete', '*'
  resource TEXT NOT NULL,  -- e.g., 'intent', 'policy', 'user', '*'
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,  -- System permissions cannot be deleted
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique permission per action:resource combination
CREATE UNIQUE INDEX IF NOT EXISTS rbac_permissions_action_resource_unique
  ON rbac_permissions (action, resource);

-- Index for permission lookups by resource
CREATE INDEX IF NOT EXISTS rbac_permissions_resource_idx
  ON rbac_permissions (resource);

-- Index for permission lookups by action
CREATE INDEX IF NOT EXISTS rbac_permissions_action_idx
  ON rbac_permissions (action);

-- Index for system permission lookups
CREATE INDEX IF NOT EXISTS rbac_permissions_system_idx
  ON rbac_permissions (is_system) WHERE is_system = TRUE;

-- =============================================================================
-- RBAC ROLE PERMISSIONS TABLE
-- Junction table mapping roles to permissions
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID,  -- User ID who granted the permission
  conditions JSONB,  -- Optional conditions for contextual permissions
  PRIMARY KEY (role_id, permission_id)
);

-- Index for finding all permissions for a role
CREATE INDEX IF NOT EXISTS rbac_role_permissions_role_idx
  ON rbac_role_permissions (role_id);

-- Index for finding all roles with a permission
CREATE INDEX IF NOT EXISTS rbac_role_permissions_permission_idx
  ON rbac_role_permissions (permission_id);

-- Index for audit queries (who granted what when)
CREATE INDEX IF NOT EXISTS rbac_role_permissions_granted_idx
  ON rbac_role_permissions (granted_by, granted_at);

-- =============================================================================
-- RBAC USER ROLES TABLE
-- User-role assignments with temporal and tenant support
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- References auth.users or external user ID
  role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  tenant_id UUID,  -- Tenant context for the role assignment
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID,  -- User ID who assigned the role
  expires_at TIMESTAMPTZ,  -- NULL means no expiration
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB
);

-- Unique user-role assignment per tenant
CREATE UNIQUE INDEX IF NOT EXISTS rbac_user_roles_unique
  ON rbac_user_roles (user_id, role_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::UUID));

-- Index for user role lookups (most common query)
CREATE INDEX IF NOT EXISTS rbac_user_roles_user_idx
  ON rbac_user_roles (user_id);

-- Index for user-tenant role lookups
CREATE INDEX IF NOT EXISTS rbac_user_roles_user_tenant_idx
  ON rbac_user_roles (user_id, tenant_id);

-- Index for tenant role membership queries
CREATE INDEX IF NOT EXISTS rbac_user_roles_tenant_idx
  ON rbac_user_roles (tenant_id) WHERE tenant_id IS NOT NULL;

-- Index for role membership queries
CREATE INDEX IF NOT EXISTS rbac_user_roles_role_idx
  ON rbac_user_roles (role_id);

-- Index for expired role cleanup (active roles with expiration)
CREATE INDEX IF NOT EXISTS rbac_user_roles_expires_idx
  ON rbac_user_roles (expires_at)
  WHERE expires_at IS NOT NULL AND is_active = TRUE;

-- Index for active user roles
CREATE INDEX IF NOT EXISTS rbac_user_roles_active_idx
  ON rbac_user_roles (user_id, is_active)
  WHERE is_active = TRUE;

-- =============================================================================
-- RBAC POLICIES TABLE
-- Access control policies with JSONB rules for flexible policy definitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,  -- 'role_based', 'resource_based', 'trust_based', 'time_based', 'conditional', 'composite'
  rules JSONB NOT NULL,  -- Policy rules: conditions, effects, targets, etc.
  priority INTEGER NOT NULL DEFAULT 0,  -- Higher priority policies evaluated first
  tenant_id UUID,  -- NULL for system/global policies
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique policy name per tenant
CREATE UNIQUE INDEX IF NOT EXISTS rbac_policies_tenant_name_unique
  ON rbac_policies (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::UUID), name);

-- Index for tenant policy lookups
CREATE INDEX IF NOT EXISTS rbac_policies_tenant_idx
  ON rbac_policies (tenant_id) WHERE tenant_id IS NOT NULL;

-- Index for policy type filtering
CREATE INDEX IF NOT EXISTS rbac_policies_type_idx
  ON rbac_policies (type);

-- Index for active policies
CREATE INDEX IF NOT EXISTS rbac_policies_active_idx
  ON rbac_policies (is_active) WHERE is_active = TRUE;

-- Index for priority-based evaluation ordering
CREATE INDEX IF NOT EXISTS rbac_policies_priority_idx
  ON rbac_policies (priority DESC);

-- Composite index for policy evaluation (active + priority)
CREATE INDEX IF NOT EXISTS rbac_policies_eval_idx
  ON rbac_policies (is_active, priority DESC, type)
  WHERE is_active = TRUE;

-- GIN index for JSONB rules queries
CREATE INDEX IF NOT EXISTS rbac_policies_rules_gin_idx
  ON rbac_policies USING GIN (rules);

-- =============================================================================
-- SEED SYSTEM ROLES (Enhanced with priority)
-- =============================================================================

INSERT INTO rbac_roles (name, description, priority, is_system, is_active)
VALUES
  ('super_admin', 'Full system access with all permissions - T5 required', 100, TRUE, TRUE),
  ('admin', 'Administrative access for tenant/user/config management - T4 required', 80, TRUE, TRUE),
  ('operator', 'Operational access for intents, escalations, monitoring - T3 required', 60, TRUE, TRUE),
  ('analyst', 'Read and analysis access for intents, proofs, audit - T2 required', 40, TRUE, TRUE),
  ('viewer', 'Read-only access to intents, proofs, dashboards - T1 required', 20, TRUE, TRUE),
  ('guest', 'Minimal access for public endpoints - T0 allowed', 0, TRUE, TRUE)
ON CONFLICT DO NOTHING;

-- Set up role hierarchy (parent_role_id)
UPDATE rbac_roles SET parent_role_id = (SELECT id FROM rbac_roles WHERE name = 'super_admin' AND is_system = TRUE)
WHERE name = 'admin' AND is_system = TRUE;

UPDATE rbac_roles SET parent_role_id = (SELECT id FROM rbac_roles WHERE name = 'admin' AND is_system = TRUE)
WHERE name = 'operator' AND is_system = TRUE;

UPDATE rbac_roles SET parent_role_id = (SELECT id FROM rbac_roles WHERE name = 'operator' AND is_system = TRUE)
WHERE name = 'analyst' AND is_system = TRUE;

UPDATE rbac_roles SET parent_role_id = (SELECT id FROM rbac_roles WHERE name = 'analyst' AND is_system = TRUE)
WHERE name = 'viewer' AND is_system = TRUE;

UPDATE rbac_roles SET parent_role_id = (SELECT id FROM rbac_roles WHERE name = 'viewer' AND is_system = TRUE)
WHERE name = 'guest' AND is_system = TRUE;

-- =============================================================================
-- SEED SYSTEM PERMISSIONS
-- Core permission definitions matching the RBAC module
-- =============================================================================

INSERT INTO rbac_permissions (action, resource, description, is_system)
VALUES
  -- Wildcard permissions
  ('*', '*', 'All permissions on all resources', TRUE),

  -- Tenant permissions
  ('create', 'tenant', 'Create new tenants', TRUE),
  ('read', 'tenant', 'View tenant information', TRUE),
  ('update', 'tenant', 'Modify tenant configuration', TRUE),
  ('delete', 'tenant', 'Delete tenant and associated data', TRUE),
  ('*', 'tenant', 'All permissions on tenants', TRUE),

  -- User permissions
  ('create', 'user', 'Create new user accounts', TRUE),
  ('read', 'user', 'View user information', TRUE),
  ('update', 'user', 'Modify user accounts', TRUE),
  ('delete', 'user', 'Delete user accounts', TRUE),
  ('*', 'user', 'All permissions on users', TRUE),

  -- Role permissions
  ('create', 'role', 'Create new roles', TRUE),
  ('read', 'role', 'View role definitions', TRUE),
  ('update', 'role', 'Modify role definitions', TRUE),
  ('delete', 'role', 'Delete role definitions', TRUE),
  ('assign', 'role', 'Assign roles to users', TRUE),
  ('*', 'role', 'All permissions on roles', TRUE),

  -- Intent permissions
  ('create', 'intent', 'Submit new intents', TRUE),
  ('read', 'intent', 'View intent details', TRUE),
  ('update', 'intent', 'Modify intent details', TRUE),
  ('approve', 'intent', 'Approve pending intents', TRUE),
  ('reject', 'intent', 'Reject pending intents', TRUE),
  ('analyze', 'intent', 'Perform analysis on intents', TRUE),
  ('*', 'intent', 'All permissions on intents', TRUE),

  -- Policy permissions
  ('create', 'policy', 'Create governance policies', TRUE),
  ('read', 'policy', 'View policy definitions', TRUE),
  ('update', 'policy', 'Modify policy definitions', TRUE),
  ('delete', 'policy', 'Delete policy definitions', TRUE),
  ('*', 'policy', 'All permissions on policies', TRUE),

  -- Escalation permissions
  ('create', 'escalation', 'Create escalation requests', TRUE),
  ('read', 'escalation', 'View escalation details', TRUE),
  ('approve', 'escalation', 'Approve escalation requests', TRUE),
  ('reject', 'escalation', 'Reject escalation requests', TRUE),
  ('*', 'escalation', 'All permissions on escalations', TRUE),

  -- Proof permissions
  ('read', 'proof', 'View proof records', TRUE),
  ('verify', 'proof', 'Verify proof authenticity', TRUE),
  ('export', 'proof', 'Export proof records', TRUE),
  ('*', 'proof', 'All permissions on proofs', TRUE),

  -- Audit permissions
  ('read', 'audit', 'View audit log entries', TRUE),
  ('export', 'audit', 'Export audit log entries', TRUE),

  -- Config permissions
  ('read', 'config', 'View system configuration', TRUE),
  ('update', 'config', 'Modify system configuration', TRUE),
  ('*', 'config', 'All permissions on configuration', TRUE),

  -- Monitoring permissions
  ('read', 'dashboard', 'View dashboard data', TRUE),
  ('read', 'report', 'View reports', TRUE),
  ('create', 'report', 'Generate new reports', TRUE),
  ('export', 'report', 'Export report data', TRUE),
  ('read', 'monitoring', 'View monitoring data', TRUE),
  ('read', 'metrics', 'View system metrics', TRUE),
  ('*', 'monitoring', 'All permissions on monitoring', TRUE),

  -- Public permissions
  ('read', 'public', 'Access public information', TRUE),
  ('read', 'health', 'View health check endpoints', TRUE),
  ('read', 'profile', 'View own profile information', TRUE),
  ('update', 'profile', 'Modify own profile information', TRUE),

  -- Trust permissions
  ('read', 'trust_score', 'View trust scores', TRUE),
  ('manage', 'trust_score', 'Modify trust scores', TRUE),
  ('create', 'trust_signal', 'Submit trust signals', TRUE),
  ('read', 'trust_signal', 'View trust signals', TRUE)
ON CONFLICT (action, resource) DO NOTHING;

-- =============================================================================
-- ASSIGN PERMISSIONS TO SYSTEM ROLES
-- =============================================================================

-- Super Admin gets wildcard permission
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'super_admin' AND r.is_system = TRUE
  AND p.action = '*' AND p.resource = '*'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Admin permissions
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'admin' AND r.is_system = TRUE
  AND (
    (p.action = '*' AND p.resource IN ('tenant', 'user', 'role', 'policy', 'intent', 'config'))
    OR (p.action = 'read' AND p.resource IN ('audit', 'proof'))
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Operator permissions
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'operator' AND r.is_system = TRUE
  AND (
    (p.action IN ('read', 'create', 'update', 'approve', 'reject') AND p.resource = 'intent')
    OR (p.action = '*' AND p.resource = 'escalation')
    OR (p.action IN ('read', 'verify') AND p.resource = 'proof')
    OR (p.action = 'read' AND p.resource = 'audit')
    OR (p.action = '*' AND p.resource = 'monitoring')
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Analyst permissions
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'analyst' AND r.is_system = TRUE
  AND (
    (p.action IN ('read', 'analyze') AND p.resource = 'intent')
    OR (p.action IN ('read', 'verify') AND p.resource = 'proof')
    OR (p.action IN ('read', 'export') AND p.resource = 'audit')
    OR (p.action IN ('read', 'create', 'export') AND p.resource = 'report')
    OR (p.action = 'read' AND p.resource = 'dashboard')
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer permissions
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'viewer' AND r.is_system = TRUE
  AND (
    (p.action = 'read' AND p.resource IN ('intent', 'proof', 'dashboard', 'profile'))
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Guest permissions
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'guest' AND r.is_system = TRUE
  AND (
    (p.action = 'read' AND p.resource IN ('public', 'health'))
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- SEED DEFAULT POLICIES
-- =============================================================================

INSERT INTO rbac_policies (name, type, rules, priority, is_active)
VALUES
  (
    'default_deny',
    'role_based',
    '{
      "effect": "deny",
      "description": "Default deny policy - explicit permissions required",
      "target": {"subjectTypes": ["user", "agent", "service"]}
    }',
    -1000,  -- Lowest priority - evaluated last
    TRUE
  ),
  (
    'super_admin_allow_all',
    'role_based',
    '{
      "effect": "allow",
      "description": "Super admins have unrestricted access",
      "requiredRoles": ["super_admin"],
      "resourcePatterns": ["*:*"]
    }',
    1000,  -- Highest priority
    TRUE
  ),
  (
    'trust_tier_enforcement',
    'trust_based',
    '{
      "effect": "deny",
      "description": "Enforce minimum trust tier requirements for roles",
      "trustTierRequirements": {
        "super_admin": 5,
        "admin": 4,
        "operator": 3,
        "analyst": 2,
        "viewer": 1,
        "guest": 0
      }
    }',
    900,
    TRUE
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION update_rbac_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to rbac_roles
DROP TRIGGER IF EXISTS rbac_roles_updated_at ON rbac_roles;
CREATE TRIGGER rbac_roles_updated_at
  BEFORE UPDATE ON rbac_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_rbac_updated_at();

-- Apply updated_at trigger to rbac_policies
DROP TRIGGER IF EXISTS rbac_policies_updated_at ON rbac_policies;
CREATE TRIGGER rbac_policies_updated_at
  BEFORE UPDATE ON rbac_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_rbac_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================

COMMENT ON TABLE rbac_roles IS 'RBAC role definitions with hierarchical support and priority-based ordering';
COMMENT ON TABLE rbac_permissions IS 'Permission definitions as action:resource pairs';
COMMENT ON TABLE rbac_role_permissions IS 'Junction table mapping roles to permissions with grant metadata';
COMMENT ON TABLE rbac_user_roles IS 'User-role assignments with temporal support and tenant isolation';
COMMENT ON TABLE rbac_policies IS 'Access control policies with JSONB rules for flexible policy definitions';

COMMENT ON COLUMN rbac_roles.priority IS 'Role priority for hierarchy (higher = more privileged): 100=super_admin, 0=guest';
COMMENT ON COLUMN rbac_roles.parent_role_id IS 'Parent role for permission inheritance in role hierarchy';
COMMENT ON COLUMN rbac_roles.tenant_id IS 'NULL for system/global roles, UUID for tenant-specific custom roles';
COMMENT ON COLUMN rbac_permissions.action IS 'Permission action: create, read, update, delete, approve, reject, analyze, manage, etc.';
COMMENT ON COLUMN rbac_permissions.resource IS 'Protected resource: tenant, user, intent, policy, proof, audit, etc.';
COMMENT ON COLUMN rbac_role_permissions.conditions IS 'Optional JSONB conditions for contextual permissions (owned_only, tenant_match, etc.)';
COMMENT ON COLUMN rbac_user_roles.expires_at IS 'Temporal role assignment expiration - NULL for permanent assignments';
COMMENT ON COLUMN rbac_policies.rules IS 'JSONB policy rules: effect, target, conditions, requiredPermissions, requiredRoles, etc.';
COMMENT ON COLUMN rbac_policies.priority IS 'Policy evaluation priority - higher values evaluated first';
