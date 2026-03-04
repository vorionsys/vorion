-- Migration: 0013_rbac_tables
-- Description: Role-Based Access Control (RBAC) tables
-- Author: Terminal 2 Security Workstream
-- Date: 2026-02-03

-- =============================================================================
-- ROLES TABLE
-- Defines roles within the system (both system and custom tenant roles)
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT, -- NULL for global/system roles
  name TEXT NOT NULL,
  description TEXT,
  parent_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique role name per tenant (or globally for system roles)
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_name_unique
  ON roles (tenant_id, name);

-- Index for efficient tenant role lookups
CREATE INDEX IF NOT EXISTS roles_tenant_idx
  ON roles (tenant_id);

-- Index for system role lookups
CREATE INDEX IF NOT EXISTS roles_system_idx
  ON roles (is_system) WHERE is_system = TRUE;

-- Index for role hierarchy queries
CREATE INDEX IF NOT EXISTS roles_parent_idx
  ON roles (parent_role_id) WHERE parent_role_id IS NOT NULL;

-- =============================================================================
-- ROLE PERMISSIONS TABLE
-- Maps permissions to roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- e.g., 'create', 'read', 'update', 'delete', '*'
  resource TEXT NOT NULL, -- e.g., 'intents', 'policies', '*'
  conditions JSONB, -- Optional conditions for fine-grained access
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique permission per role (action + resource combination)
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_unique
  ON role_permissions (role_id, action, resource);

-- Index for role permission lookups
CREATE INDEX IF NOT EXISTS role_permissions_role_idx
  ON role_permissions (role_id);

-- Index for permission auditing (find all roles with a specific permission)
CREATE INDEX IF NOT EXISTS role_permissions_action_resource_idx
  ON role_permissions (action, resource);

-- =============================================================================
-- USER ROLES TABLE
-- Assigns roles to users with optional expiration
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  expires_at TIMESTAMPTZ, -- NULL means no expiration
  metadata JSONB
);

-- Unique user-role assignment per tenant
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique
  ON user_roles (user_id, role_id, tenant_id);

-- Index for efficient user role lookups
CREATE INDEX IF NOT EXISTS user_roles_user_tenant_idx
  ON user_roles (user_id, tenant_id);

-- Index for role membership queries
CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON user_roles (role_id);

-- Index for expired role cleanup
CREATE INDEX IF NOT EXISTS user_roles_expires_idx
  ON user_roles (expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- SERVICE ACCOUNT ROLES TABLE
-- Assigns roles to service accounts
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_account_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  expires_at TIMESTAMPTZ -- NULL means no expiration
);

-- Unique service account-role assignment per tenant
CREATE UNIQUE INDEX IF NOT EXISTS sa_roles_unique
  ON service_account_roles (service_account_id, role_id, tenant_id);

-- Index for efficient service account role lookups
CREATE INDEX IF NOT EXISTS sa_roles_sa_tenant_idx
  ON service_account_roles (service_account_id, tenant_id);

-- Index for role membership queries
CREATE INDEX IF NOT EXISTS sa_roles_role_idx
  ON service_account_roles (role_id);

-- =============================================================================
-- SEED SYSTEM ROLES
-- Insert built-in system roles (idempotent)
-- =============================================================================

INSERT INTO roles (name, description, tenant_id, is_system, is_active)
VALUES
  ('super_admin', 'Full system access - all permissions on all resources', NULL, TRUE, TRUE),
  ('tenant:admin', 'Full tenant resource management', NULL, TRUE, TRUE),
  ('policy:admin', 'Policy management focus', NULL, TRUE, TRUE),
  ('security:admin', 'Security and access control focus', NULL, TRUE, TRUE),
  ('escalation_approver', 'Can approve/reject escalations', NULL, TRUE, TRUE),
  ('auditor', 'Read-only access for compliance', NULL, TRUE, TRUE),
  ('operator', 'Day-to-day operations', NULL, TRUE, TRUE),
  ('user', 'Basic user permissions (own resources)', NULL, TRUE, TRUE),
  ('service', 'Machine-to-machine permissions', NULL, TRUE, TRUE)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- =============================================================================
-- SEED SUPER_ADMIN PERMISSIONS
-- Give super_admin the wildcard permission
-- =============================================================================

INSERT INTO role_permissions (role_id, action, resource)
SELECT r.id, '*', '*'
FROM roles r
WHERE r.name = 'super_admin' AND r.is_system = TRUE
ON CONFLICT (role_id, action, resource) DO NOTHING;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE roles IS 'RBAC role definitions - supports hierarchical roles with tenant isolation';
COMMENT ON TABLE role_permissions IS 'Permission assignments to roles - action:resource pairs with optional conditions';
COMMENT ON TABLE user_roles IS 'User-role assignments with temporal support (expiration)';
COMMENT ON TABLE service_account_roles IS 'Service account role assignments for M2M authentication';

COMMENT ON COLUMN roles.tenant_id IS 'NULL for system/global roles, tenant ID for custom roles';
COMMENT ON COLUMN roles.parent_role_id IS 'Parent role for permission inheritance';
COMMENT ON COLUMN role_permissions.conditions IS 'JSON conditions for fine-grained access (owned, tenant_match, etc.)';
COMMENT ON COLUMN user_roles.expires_at IS 'Temporal role assignment - NULL for permanent';
