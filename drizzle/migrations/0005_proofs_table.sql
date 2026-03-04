-- Migration: 0005_proofs_table
-- Description: Create proofs and chain_metadata tables for immutable evidence chain
-- Created: 2026-01-25

-- =============================================================================
-- 1. PROOFS TABLE - Immutable evidence records with hash chain integrity
-- =============================================================================

CREATE TABLE IF NOT EXISTS "proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "chain_position" integer NOT NULL,
  "intent_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,

  -- Decision details (JSONB)
  "decision" jsonb NOT NULL,

  -- Execution context (JSONB)
  "inputs" jsonb NOT NULL,
  "outputs" jsonb NOT NULL,

  -- Chain integrity
  "hash" text NOT NULL,
  "previous_hash" text NOT NULL,

  -- Cryptographic signature
  "signature" text NOT NULL,
  "signature_public_key" text,
  "signature_algorithm" text,
  "signed_at" timestamptz,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. PROOFS INDEXES
-- =============================================================================

-- Unique chain position for ordering (ensures no gaps or duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS "proofs_chain_position_idx"
ON "proofs" ("chain_position");

-- Fast lookups by entity
CREATE INDEX IF NOT EXISTS "proofs_entity_id_idx"
ON "proofs" ("entity_id");

-- Fast lookups by intent
CREATE INDEX IF NOT EXISTS "proofs_intent_id_idx"
ON "proofs" ("intent_id");

-- Chain verification queries (lookup by hash)
CREATE INDEX IF NOT EXISTS "proofs_hash_idx"
ON "proofs" ("hash");

-- Time-based queries
CREATE INDEX IF NOT EXISTS "proofs_created_at_idx"
ON "proofs" ("created_at");

-- =============================================================================
-- 3. CHAIN METADATA TABLE - Tracks distributed chain state
-- =============================================================================

CREATE TABLE IF NOT EXISTS "chain_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "chain_id" text NOT NULL DEFAULT 'default',
  "tenant_id" text,

  -- Chain state
  "last_hash" text NOT NULL,
  "chain_length" integer NOT NULL DEFAULT 0,

  -- Verification state
  "last_verified_at" timestamptz,
  "last_verified_position" integer,
  "verification_status" text DEFAULT 'unverified',

  -- Distributed state
  "node_id" text,
  "sync_status" text DEFAULT 'synced',
  "last_sync_at" timestamptz,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Unique chain ID per tenant (or global if tenant_id is NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "chain_metadata_chain_tenant_idx"
ON "chain_metadata" ("chain_id", COALESCE("tenant_id", ''));

-- Index for tenant-scoped chain queries
CREATE INDEX IF NOT EXISTS "chain_metadata_tenant_idx"
ON "chain_metadata" ("tenant_id")
WHERE "tenant_id" IS NOT NULL;

-- Index for sync status queries
CREATE INDEX IF NOT EXISTS "chain_metadata_sync_status_idx"
ON "chain_metadata" ("sync_status", "last_sync_at");

-- =============================================================================
-- 4. COMMENTS
-- =============================================================================

COMMENT ON TABLE "proofs" IS 'Immutable evidence records with cryptographic signatures and hash chain integrity';
COMMENT ON TABLE "chain_metadata" IS 'Metadata tracking the state of proof chains for distributed verification';
COMMENT ON COLUMN "proofs"."chain_position" IS 'Sequential position in the hash chain (must be unique)';
COMMENT ON COLUMN "proofs"."hash" IS 'SHA-256 hash of proof content for integrity verification';
COMMENT ON COLUMN "proofs"."previous_hash" IS 'Hash of the previous proof in the chain';
COMMENT ON COLUMN "proofs"."signature" IS 'Ed25519/ECDSA signature of the hash';
COMMENT ON COLUMN "chain_metadata"."chain_id" IS 'Identifier for the chain (default for global chain)';
COMMENT ON COLUMN "chain_metadata"."sync_status" IS 'Status of chain synchronization across nodes';
