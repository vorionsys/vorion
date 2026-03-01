-- =============================================================================
-- Migration 001: Create intents table
--
-- Supports the SupabaseIntentRepository adapter for persistent intent storage.
-- Designed for multi-tenant isolation via RLS and indexed for common query
-- patterns (entity lookup, status filtering, expiration sweeps).
--
-- Compatible with Supabase (PostgreSQL 15+).
-- =============================================================================

-- Enable UUID generation if not already available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Table: intents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intents (
  -- Primary key
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolation
  tenant_id       TEXT NOT NULL,

  -- Core fields
  entity_id       TEXT NOT NULL,
  goal            TEXT NOT NULL CHECK (char_length(goal) <= 10000),
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending', 'evaluating', 'approved', 'denied',
                    'escalated', 'executing', 'completed', 'failed', 'cancelled'
                  )),

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Trust snapshot
  trust_snapshot  JSONB DEFAULT NULL,
  trust_level     NUMERIC DEFAULT NULL,

  -- Canonical fields
  correlation_id  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  action_type     TEXT DEFAULT NULL
                  CHECK (action_type IS NULL OR action_type IN (
                    'read', 'write', 'delete', 'execute', 'communicate', 'transfer'
                  )),
  resource_scope  JSONB DEFAULT NULL,        -- stored as JSON array of strings
  data_sensitivity TEXT DEFAULT NULL
                  CHECK (data_sensitivity IS NULL OR data_sensitivity IN (
                    'PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'
                  )),
  reversibility   TEXT DEFAULT NULL
                  CHECK (reversibility IS NULL OR reversibility IN (
                    'REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'IRREVERSIBLE'
                  )),
  expires_at      TIMESTAMPTZ DEFAULT NULL,
  source          TEXT DEFAULT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Entity lookup within a tenant (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_intents_tenant_entity
  ON intents (tenant_id, entity_id);

-- Status filtering within a tenant (for dashboards, sweeps)
CREATE INDEX IF NOT EXISTS idx_intents_tenant_status
  ON intents (tenant_id, status);

-- Expiration sweep (find intents that have expired)
CREATE INDEX IF NOT EXISTS idx_intents_expires_at
  ON intents (expires_at)
  WHERE expires_at IS NOT NULL;

-- Correlation ID lookup (distributed tracing)
CREATE INDEX IF NOT EXISTS idx_intents_correlation_id
  ON intents (correlation_id);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_intents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intents_updated_at ON intents;

CREATE TRIGGER trg_intents_updated_at
  BEFORE UPDATE ON intents
  FOR EACH ROW
  EXECUTE FUNCTION update_intents_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security (RLS) for tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE intents ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access intents belonging to their tenant.
-- Expects the application to set the 'app.current_tenant_id' session variable
-- via: SET LOCAL app.current_tenant_id = '<tenant_id>';
-- Or via Supabase RLS with JWT claims: auth.jwt() ->> 'tenant_id'
CREATE POLICY tenant_isolation_policy ON intents
  FOR ALL
  USING (
    tenant_id = coalesce(
      current_setting('app.current_tenant_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')
    )
  )
  WITH CHECK (
    tenant_id = coalesce(
      current_setting('app.current_tenant_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')
    )
  );

-- ---------------------------------------------------------------------------
-- Comments for documentation
-- ---------------------------------------------------------------------------
COMMENT ON TABLE intents IS 'Stores intent submissions for the ATSF governance pipeline.';
COMMENT ON COLUMN intents.tenant_id IS 'Tenant identifier for multi-tenant isolation.';
COMMENT ON COLUMN intents.entity_id IS 'Agent or entity that submitted the intent.';
COMMENT ON COLUMN intents.goal IS 'Human-readable description of the intended action.';
COMMENT ON COLUMN intents.status IS 'Current lifecycle state (pending -> evaluating -> approved/denied/escalated -> executing -> completed/failed/cancelled).';
COMMENT ON COLUMN intents.correlation_id IS 'Distributed tracing correlation identifier.';
COMMENT ON COLUMN intents.trust_snapshot IS 'Trust state captured at submission time.';
COMMENT ON COLUMN intents.expires_at IS 'When this intent expires and should be auto-cancelled.';
