-- Migration: 0009_fix_sequence
-- Description: Fix audit_records.sequence_number by adding a sequence generator
-- Created: 2026-01-25
--
-- This fixes the issue in 0003_enterprise_hardening.sql where sequence_number
-- was defined as NOT NULL without a DEFAULT value or sequence.
--
-- The sequence provides:
-- - Auto-incrementing values for new audit records
-- - No gaps guarantee (unlike SERIAL which can have gaps)
-- - Tenant-scoped sequence support via function

-- =============================================================================
-- 1. CREATE SEQUENCE FOR AUDIT RECORDS
-- =============================================================================

-- Create a global sequence for audit record numbering
-- Note: For high-volume multi-tenant deployments, consider tenant-scoped sequences
CREATE SEQUENCE IF NOT EXISTS "audit_records_sequence_number_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 100;  -- Cache 100 values for better performance

-- =============================================================================
-- 2. SET DEFAULT VALUE FOR SEQUENCE NUMBER
-- =============================================================================

-- Add default value to use the sequence
-- This handles new inserts automatically
ALTER TABLE "audit_records"
  ALTER COLUMN "sequence_number" SET DEFAULT nextval('audit_records_sequence_number_seq');

-- =============================================================================
-- 3. UPDATE SEQUENCE TO MATCH EXISTING DATA
-- =============================================================================

-- If there are existing records, set the sequence to continue from the max value
DO $$
DECLARE
  max_seq bigint;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) INTO max_seq FROM audit_records;
  IF max_seq > 0 THEN
    PERFORM setval('audit_records_sequence_number_seq', max_seq, true);
  END IF;
END $$;

-- =============================================================================
-- 4. CREATE HELPER FUNCTION FOR TENANT-SCOPED SEQUENCES (OPTIONAL)
-- =============================================================================

-- This function can be used for tenant-scoped sequence numbers if needed
-- Usage: SELECT get_next_audit_sequence('tenant-123')
CREATE OR REPLACE FUNCTION get_next_audit_sequence(p_tenant_id text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  next_seq bigint;
BEGIN
  -- Get the next sequence number for this tenant
  -- Uses advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('audit_seq_' || p_tenant_id));

  SELECT COALESCE(MAX(sequence_number), 0) + 1
  INTO next_seq
  FROM audit_records
  WHERE tenant_id = p_tenant_id;

  RETURN next_seq;
END;
$$;

-- =============================================================================
-- 5. COMMENTS
-- =============================================================================

COMMENT ON SEQUENCE "audit_records_sequence_number_seq" IS 'Global sequence for audit record ordering';
COMMENT ON FUNCTION get_next_audit_sequence(text) IS 'Returns the next sequence number for a specific tenant (optional tenant-scoped ordering)';
