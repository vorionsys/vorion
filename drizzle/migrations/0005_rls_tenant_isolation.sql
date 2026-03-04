-- Migration: RLS Tenant Isolation
-- Implements Row Level Security for multi-tenant data isolation
-- Story 1.2: FR267 - Tenant data isolation with RLS policies
--
-- This migration:
-- 1. Creates helper function for tenant context
-- 2. Enables RLS on all tenant-scoped tables
-- 3. Creates policies for CRUD operations
-- 4. Enforces append-only for audit records
-- 5. Allows service role bypass for system operations

-- =============================================================================
-- 1. Helper function to get current tenant from session
-- =============================================================================

-- Drop existing function if exists (for idempotency)
DROP FUNCTION IF EXISTS get_current_tenant_id();

-- Create function to extract tenant_id from application context
-- This should be set by the application before running queries:
-- SET app.current_tenant_id = 'tenant_123';
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::TEXT;
$$;

COMMENT ON FUNCTION get_current_tenant_id() IS
  'Returns the current tenant_id from session context. Set via: SET app.current_tenant_id = ''tenant_id''';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_current_tenant_id() TO PUBLIC;

-- =============================================================================
-- 2. Enable RLS on core tables
-- =============================================================================

-- Intents table (core action requests)
ALTER TABLE "intents" ENABLE ROW LEVEL SECURITY;

-- Intent evaluations table
ALTER TABLE "intent_evaluations" ENABLE ROW LEVEL SECURITY;

-- Intent events table (inherits tenant from intents via FK, but enforce anyway)
ALTER TABLE "intent_events" ENABLE ROW LEVEL SECURITY;

-- Escalations table
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;

-- Audit records table (append-only)
ALTER TABLE "audit_records" ENABLE ROW LEVEL SECURITY;

-- Policies table
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;

-- Policy versions table
ALTER TABLE "policy_versions" ENABLE ROW LEVEL SECURITY;

-- Encryption keys table
ALTER TABLE "encryption_keys" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Intents table policies
-- =============================================================================

-- Allow SELECT for tenant's own data
DROP POLICY IF EXISTS intents_tenant_select ON intents;
CREATE POLICY intents_tenant_select ON intents
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

-- Allow INSERT only for tenant's own data
DROP POLICY IF EXISTS intents_tenant_insert ON intents;
CREATE POLICY intents_tenant_insert ON intents
  FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Allow UPDATE only for tenant's own data
DROP POLICY IF EXISTS intents_tenant_update ON intents;
CREATE POLICY intents_tenant_update ON intents
  FOR UPDATE
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Allow DELETE only for tenant's own data (soft delete supported)
DROP POLICY IF EXISTS intents_tenant_delete ON intents;
CREATE POLICY intents_tenant_delete ON intents
  FOR DELETE
  USING (tenant_id = get_current_tenant_id());

-- =============================================================================
-- 4. Intent evaluations policies
-- =============================================================================

DROP POLICY IF EXISTS intent_evaluations_tenant_select ON intent_evaluations;
CREATE POLICY intent_evaluations_tenant_select ON intent_evaluations
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS intent_evaluations_tenant_insert ON intent_evaluations;
CREATE POLICY intent_evaluations_tenant_insert ON intent_evaluations
  FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS intent_evaluations_tenant_update ON intent_evaluations;
CREATE POLICY intent_evaluations_tenant_update ON intent_evaluations
  FOR UPDATE
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS intent_evaluations_tenant_delete ON intent_evaluations;
CREATE POLICY intent_evaluations_tenant_delete ON intent_evaluations
  FOR DELETE
  USING (tenant_id = get_current_tenant_id());

-- =============================================================================
-- 5. Intent events policies (linked via intent_id FK)
-- =============================================================================

-- Intent events don't have direct tenant_id, join through intents
DROP POLICY IF EXISTS intent_events_tenant_select ON intent_events;
CREATE POLICY intent_events_tenant_select ON intent_events
  FOR SELECT
  USING (
    intent_id IN (
      SELECT id FROM intents WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS intent_events_tenant_insert ON intent_events;
CREATE POLICY intent_events_tenant_insert ON intent_events
  FOR INSERT
  WITH CHECK (
    intent_id IN (
      SELECT id FROM intents WHERE tenant_id = get_current_tenant_id()
    )
  );

-- Intent events should be append-only (immutable event log)
DROP POLICY IF EXISTS intent_events_no_update ON intent_events;
CREATE POLICY intent_events_no_update ON intent_events
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS intent_events_no_delete ON intent_events;
CREATE POLICY intent_events_no_delete ON intent_events
  FOR DELETE
  USING (false);

-- =============================================================================
-- 6. Escalations table policies
-- =============================================================================

DROP POLICY IF EXISTS escalations_tenant_select ON escalations;
CREATE POLICY escalations_tenant_select ON escalations
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS escalations_tenant_insert ON escalations;
CREATE POLICY escalations_tenant_insert ON escalations
  FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS escalations_tenant_update ON escalations;
CREATE POLICY escalations_tenant_update ON escalations
  FOR UPDATE
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Escalations should not be deleted, only status updated
DROP POLICY IF EXISTS escalations_no_delete ON escalations;
CREATE POLICY escalations_no_delete ON escalations
  FOR DELETE
  USING (false);

-- =============================================================================
-- 7. Audit records policies (APPEND-ONLY - critical for compliance)
-- =============================================================================

DROP POLICY IF EXISTS audit_records_tenant_select ON audit_records;
CREATE POLICY audit_records_tenant_select ON audit_records
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS audit_records_tenant_insert ON audit_records;
CREATE POLICY audit_records_tenant_insert ON audit_records
  FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

-- CRITICAL: Audit records are IMMUTABLE - no updates allowed
DROP POLICY IF EXISTS audit_records_no_update ON audit_records;
CREATE POLICY audit_records_no_update ON audit_records
  FOR UPDATE
  USING (false);

-- CRITICAL: Audit records are IMMUTABLE - no deletes allowed
DROP POLICY IF EXISTS audit_records_no_delete ON audit_records;
CREATE POLICY audit_records_no_delete ON audit_records
  FOR DELETE
  USING (false);

-- =============================================================================
-- 8. Policies table policies
-- =============================================================================

DROP POLICY IF EXISTS policies_tenant_select ON policies;
CREATE POLICY policies_tenant_select ON policies
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS policies_tenant_insert ON policies;
CREATE POLICY policies_tenant_insert ON policies
  FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS policies_tenant_update ON policies;
CREATE POLICY policies_tenant_update ON policies
  FOR UPDATE
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Policies should not be deleted, only status changed to archived
DROP POLICY IF EXISTS policies_no_delete ON policies;
CREATE POLICY policies_no_delete ON policies
  FOR DELETE
  USING (false);

-- =============================================================================
-- 9. Policy versions policies (linked via policy_id FK)
-- =============================================================================

DROP POLICY IF EXISTS policy_versions_tenant_select ON policy_versions;
CREATE POLICY policy_versions_tenant_select ON policy_versions
  FOR SELECT
  USING (
    policy_id IN (
      SELECT id FROM policies WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS policy_versions_tenant_insert ON policy_versions;
CREATE POLICY policy_versions_tenant_insert ON policy_versions
  FOR INSERT
  WITH CHECK (
    policy_id IN (
      SELECT id FROM policies WHERE tenant_id = get_current_tenant_id()
    )
  );

-- Policy versions are immutable
DROP POLICY IF EXISTS policy_versions_no_update ON policy_versions;
CREATE POLICY policy_versions_no_update ON policy_versions
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS policy_versions_no_delete ON policy_versions;
CREATE POLICY policy_versions_no_delete ON policy_versions
  FOR DELETE
  USING (false);

-- =============================================================================
-- 10. Encryption keys policies
-- =============================================================================

-- System keys (tenant_id IS NULL) are only accessible by service role
-- Tenant-specific keys are tenant-scoped
DROP POLICY IF EXISTS encryption_keys_tenant_select ON encryption_keys;
CREATE POLICY encryption_keys_tenant_select ON encryption_keys
  FOR SELECT
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = get_current_tenant_id()
  );

DROP POLICY IF EXISTS encryption_keys_tenant_insert ON encryption_keys;
CREATE POLICY encryption_keys_tenant_insert ON encryption_keys
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = get_current_tenant_id()
  );

DROP POLICY IF EXISTS encryption_keys_tenant_update ON encryption_keys;
CREATE POLICY encryption_keys_tenant_update ON encryption_keys
  FOR UPDATE
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = get_current_tenant_id()
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = get_current_tenant_id()
  );

-- Keys should not be deleted, only revoked
DROP POLICY IF EXISTS encryption_keys_no_delete ON encryption_keys;
CREATE POLICY encryption_keys_no_delete ON encryption_keys
  FOR DELETE
  USING (false);

-- =============================================================================
-- 11. Service role bypass policies
-- =============================================================================

-- For each table, create a policy that allows full access when
-- the connection is using the service role (for system operations)
--
-- The application sets: SET ROLE service;
-- when running system-level operations that need cross-tenant access

-- Check if service role exists, create if not
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service') THEN
    CREATE ROLE service NOLOGIN;
  END IF;
END
$$;

-- Intents - service role bypass
DROP POLICY IF EXISTS intents_service_bypass ON intents;
CREATE POLICY intents_service_bypass ON intents
  TO service
  USING (true)
  WITH CHECK (true);

-- Intent evaluations - service role bypass
DROP POLICY IF EXISTS intent_evaluations_service_bypass ON intent_evaluations;
CREATE POLICY intent_evaluations_service_bypass ON intent_evaluations
  TO service
  USING (true)
  WITH CHECK (true);

-- Intent events - service role bypass
DROP POLICY IF EXISTS intent_events_service_bypass ON intent_events;
CREATE POLICY intent_events_service_bypass ON intent_events
  TO service
  USING (true)
  WITH CHECK (true);

-- Escalations - service role bypass
DROP POLICY IF EXISTS escalations_service_bypass ON escalations;
CREATE POLICY escalations_service_bypass ON escalations
  TO service
  USING (true)
  WITH CHECK (true);

-- Audit records - service role bypass (still append-only for service)
DROP POLICY IF EXISTS audit_records_service_select ON audit_records;
CREATE POLICY audit_records_service_select ON audit_records
  FOR SELECT
  TO service
  USING (true);

DROP POLICY IF EXISTS audit_records_service_insert ON audit_records;
CREATE POLICY audit_records_service_insert ON audit_records
  FOR INSERT
  TO service
  WITH CHECK (true);
-- Note: Even service role cannot UPDATE or DELETE audit records (immutable)

-- Policies - service role bypass
DROP POLICY IF EXISTS policies_service_bypass ON policies;
CREATE POLICY policies_service_bypass ON policies
  TO service
  USING (true)
  WITH CHECK (true);

-- Policy versions - service role bypass
DROP POLICY IF EXISTS policy_versions_service_bypass ON policy_versions;
CREATE POLICY policy_versions_service_bypass ON policy_versions
  TO service
  USING (true)
  WITH CHECK (true);

-- Encryption keys - service role bypass (for system key management)
DROP POLICY IF EXISTS encryption_keys_service_bypass ON encryption_keys;
CREATE POLICY encryption_keys_service_bypass ON encryption_keys
  TO service
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 12. Usage documentation
-- =============================================================================

COMMENT ON POLICY intents_tenant_select ON intents IS
  'Allows tenants to SELECT only their own intents. Set tenant via: SET app.current_tenant_id = ''tenant_id''';

COMMENT ON POLICY intents_service_bypass ON intents IS
  'Allows service role full access for system operations. Use: SET ROLE service';

COMMENT ON POLICY audit_records_no_update ON audit_records IS
  'Audit records are IMMUTABLE - updates are forbidden for compliance';

COMMENT ON POLICY audit_records_no_delete ON audit_records IS
  'Audit records are IMMUTABLE - deletes are forbidden for compliance';

-- =============================================================================
-- 13. Grant permissions
-- =============================================================================

-- Ensure public role can use the tenant context function
GRANT EXECUTE ON FUNCTION get_current_tenant_id() TO PUBLIC;

-- Grant service role access to tables (for bypass policies to work)
GRANT ALL ON intents TO service;
GRANT ALL ON intent_evaluations TO service;
GRANT ALL ON intent_events TO service;
GRANT ALL ON escalations TO service;
GRANT SELECT, INSERT ON audit_records TO service;
GRANT ALL ON policies TO service;
GRANT ALL ON policy_versions TO service;
GRANT ALL ON encryption_keys TO service;
