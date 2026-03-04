-- Migration: 0007_provenance_records
-- Description: Create provenance_records table for tracking data lineage with hash chain
-- Created: 2026-01-25
--
-- This table provides immutable audit trail for entity changes with:
-- - Full hash chain for tamper detection
-- - Actor tracking for accountability
-- - Tenant isolation for multi-tenant deployments

-- =============================================================================
-- 1. PROVENANCE RECORDS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "provenance_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "action" text NOT NULL,
  "data" jsonb NOT NULL,
  "actor" jsonb NOT NULL,

  -- Hash chain columns for immutability
  "hash" text NOT NULL,
  "previous_hash" text NOT NULL,
  "chain_position" integer NOT NULL,

  -- Tenant isolation
  "tenant_id" uuid NOT NULL,

  -- Optional metadata
  "metadata" jsonb,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

-- Primary lookup: find provenance by entity
CREATE INDEX IF NOT EXISTS "provenance_entity_id_idx"
ON "provenance_records" ("entity_id");

-- Tenant isolation index (CRITICAL for multi-tenant security)
CREATE INDEX IF NOT EXISTS "provenance_tenant_id_idx"
ON "provenance_records" ("tenant_id");

-- Entity type filtering
CREATE INDEX IF NOT EXISTS "provenance_entity_type_idx"
ON "provenance_records" ("entity_type");

-- Action filtering for audit queries
CREATE INDEX IF NOT EXISTS "provenance_action_idx"
ON "provenance_records" ("action");

-- Chain ordering within an entity (for reconstruction)
CREATE INDEX IF NOT EXISTS "provenance_chain_position_idx"
ON "provenance_records" ("entity_id", "chain_position");

-- Time-based queries
CREATE INDEX IF NOT EXISTS "provenance_created_at_idx"
ON "provenance_records" ("created_at");

-- Hash lookup for verification
CREATE INDEX IF NOT EXISTS "provenance_hash_idx"
ON "provenance_records" ("hash");

-- Composite index for tenant-scoped entity queries
CREATE INDEX IF NOT EXISTS "provenance_tenant_entity_idx"
ON "provenance_records" ("tenant_id", "entity_id", "chain_position");

-- =============================================================================
-- 3. COMMENTS
-- =============================================================================

COMMENT ON TABLE "provenance_records" IS 'Immutable provenance chain tracking all entity changes with cryptographic verification';
COMMENT ON COLUMN "provenance_records"."entity_id" IS 'The entity this provenance record belongs to';
COMMENT ON COLUMN "provenance_records"."entity_type" IS 'Type of entity (intent, escalation, policy, etc.)';
COMMENT ON COLUMN "provenance_records"."action" IS 'The action performed (created, updated, approved, etc.)';
COMMENT ON COLUMN "provenance_records"."data" IS 'The data associated with this action (state snapshot or diff)';
COMMENT ON COLUMN "provenance_records"."actor" IS 'JSON object describing who performed the action (type, id, name)';
COMMENT ON COLUMN "provenance_records"."hash" IS 'SHA-256 hash of record content for tamper detection';
COMMENT ON COLUMN "provenance_records"."previous_hash" IS 'Hash of previous record in chain (genesis record uses special value)';
COMMENT ON COLUMN "provenance_records"."chain_position" IS 'Position in the provenance chain for this entity';
COMMENT ON COLUMN "provenance_records"."tenant_id" IS 'Tenant ID for multi-tenant isolation';
