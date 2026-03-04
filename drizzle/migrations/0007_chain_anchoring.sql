-- Chain Anchoring Migration
-- Adds persistence for blockchain anchoring of proof records
--
-- This migration creates:
-- 1. anchor_batches - Groups of proofs to be anchored together
-- 2. anchor_transactions - Blockchain transactions for anchoring
-- 3. proof_anchors - Links proofs to their anchor batches
-- 4. agent_anchor_submissions - Tracks AgentAnchor platform submissions
-- 5. chain_anchor_config - Per-tenant anchoring configuration

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Supported blockchain networks
DO $$ BEGIN
  CREATE TYPE chain_network AS ENUM (
    'ethereum_mainnet',
    'ethereum_sepolia',
    'polygon_mainnet',
    'polygon_amoy',
    'arbitrum_one',
    'arbitrum_sepolia',
    'base_mainnet',
    'base_sepolia',
    'optimism_mainnet',
    'optimism_sepolia'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Anchor batch status
DO $$ BEGIN
  CREATE TYPE anchor_batch_status AS ENUM (
    'collecting',
    'pending',
    'submitting',
    'confirming',
    'anchored',
    'failed',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Anchor transaction status
DO $$ BEGIN
  CREATE TYPE anchor_tx_status AS ENUM (
    'pending',
    'submitted',
    'confirming',
    'confirmed',
    'failed',
    'replaced',
    'dropped'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AgentAnchor submission status
DO $$ BEGIN
  CREATE TYPE agent_anchor_status AS ENUM (
    'pending',
    'submitted',
    'verified',
    'rejected',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- ANCHOR BATCHES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "anchor_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,

  -- Batch identification
  "batch_number" integer NOT NULL,
  "chain_id" text NOT NULL DEFAULT 'default',

  -- Status tracking
  "status" anchor_batch_status NOT NULL DEFAULT 'collecting',

  -- Proof range (inclusive)
  "start_position" integer NOT NULL,
  "end_position" integer,
  "proof_count" integer NOT NULL DEFAULT 0,

  -- Merkle tree data
  "merkle_root" text,
  "merkle_tree_depth" integer,
  "merkle_tree_data" jsonb,

  -- Aggregated hash (for quick verification)
  "batch_hash" text,

  -- Target chains for anchoring
  "target_chains" jsonb NOT NULL DEFAULT '[]',

  -- Retry tracking
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 5,
  "last_error" text,
  "last_error_at" timestamptz,

  -- Timing
  "collection_started_at" timestamptz NOT NULL DEFAULT now(),
  "collection_ended_at" timestamptz,
  "anchoring_started_at" timestamptz,
  "anchored_at" timestamptz,
  "expires_at" timestamptz NOT NULL,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for anchor_batches
CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_tenant_idx"
ON "anchor_batches" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_chain_id_idx"
ON "anchor_batches" ("chain_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_status_idx"
ON "anchor_batches" ("status");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_batch_number_idx"
ON "anchor_batches" ("tenant_id", "chain_id", "batch_number");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_merkle_root_idx"
ON "anchor_batches" ("merkle_root");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_batches_pending_idx"
ON "anchor_batches" ("status", "expires_at");

-- =============================================================================
-- ANCHOR TRANSACTIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "anchor_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "anchor_batches"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,

  -- Chain details
  "network" chain_network NOT NULL,
  "chain_id_numeric" integer NOT NULL,

  -- Transaction details
  "tx_hash" text,
  "block_number" integer,
  "block_hash" text,
  "block_timestamp" timestamptz,

  -- Transaction parameters
  "from_address" text NOT NULL,
  "to_address" text NOT NULL,
  "contract_address" text,
  "gas_limit" text,
  "gas_price" text,
  "max_fee_per_gas" text,
  "max_priority_fee_per_gas" text,
  "gas_used" text,
  "effective_gas_price" text,
  "nonce" integer,

  -- Status tracking
  "status" anchor_tx_status NOT NULL DEFAULT 'pending',
  "confirmations" integer NOT NULL DEFAULT 0,
  "required_confirmations" integer NOT NULL DEFAULT 12,

  -- Transaction data
  "input_data" text,
  "merkle_root" text NOT NULL,

  -- Replacement tracking (for gas bumps)
  "replaced_by_tx_hash" text,
  "original_tx_id" uuid REFERENCES "anchor_transactions"("id"),

  -- Error tracking
  "error_message" text,
  "error_code" text,

  -- Cost tracking (in wei/gwei)
  "tx_cost_wei" text,
  "tx_cost_usd" text,

  -- Timing
  "submitted_at" timestamptz,
  "confirmed_at" timestamptz,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for anchor_transactions
CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_batch_idx"
ON "anchor_transactions" ("batch_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_tenant_idx"
ON "anchor_transactions" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_network_idx"
ON "anchor_transactions" ("network");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_tx_hash_idx"
ON "anchor_transactions" ("tx_hash") WHERE "tx_hash" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_status_idx"
ON "anchor_transactions" ("status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_block_number_idx"
ON "anchor_transactions" ("network", "block_number");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "anchor_transactions_pending_idx"
ON "anchor_transactions" ("status")
WHERE "status" IN ('pending', 'submitted', 'confirming');

-- =============================================================================
-- PROOF ANCHORS TABLE (Join table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "proof_anchors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "proof_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL REFERENCES "anchor_batches"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,

  -- Position in batch
  "batch_position" integer NOT NULL,

  -- Merkle proof for this specific proof
  "merkle_proof" jsonb,
  "merkle_leaf" text,
  "merkle_leaf_index" integer,

  -- Verification status
  "verified" boolean DEFAULT false,
  "verified_at" timestamptz,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for proof_anchors
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "proof_anchors_proof_idx"
ON "proof_anchors" ("proof_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "proof_anchors_batch_idx"
ON "proof_anchors" ("batch_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "proof_anchors_tenant_idx"
ON "proof_anchors" ("tenant_id");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "proof_anchors_batch_position_idx"
ON "proof_anchors" ("batch_id", "batch_position");

-- =============================================================================
-- AGENT ANCHOR SUBMISSIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "agent_anchor_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "anchor_batches"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,

  -- AgentAnchor identifiers
  "agent_anchor_id" text,
  "agent_id" uuid NOT NULL,
  "submission_ref" text,

  -- Status
  "status" agent_anchor_status NOT NULL DEFAULT 'pending',

  -- Request/Response data
  "request_payload" jsonb,
  "response_payload" jsonb,

  -- Verification
  "certificate_id" text,
  "certificate_url" text,
  "verification_token" text,

  -- Error tracking
  "error_message" text,
  "error_code" text,
  "retry_count" integer NOT NULL DEFAULT 0,

  -- Timing
  "submitted_at" timestamptz,
  "verified_at" timestamptz,
  "expires_at" timestamptz,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for agent_anchor_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_batch_idx"
ON "agent_anchor_submissions" ("batch_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_tenant_idx"
ON "agent_anchor_submissions" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_agent_idx"
ON "agent_anchor_submissions" ("agent_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_status_idx"
ON "agent_anchor_submissions" ("status");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_anchor_id_idx"
ON "agent_anchor_submissions" ("agent_anchor_id") WHERE "agent_anchor_id" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_anchor_submissions_certificate_idx"
ON "agent_anchor_submissions" ("certificate_id");

-- =============================================================================
-- CHAIN ANCHOR CONFIG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "chain_anchor_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,

  -- Batching configuration
  "batch_size_limit" integer NOT NULL DEFAULT 1000,
  "batch_timeout_ms" integer NOT NULL DEFAULT 300000,
  "batch_expiration_ms" integer NOT NULL DEFAULT 86400000,

  -- Target chains
  "enabled_chains" jsonb NOT NULL DEFAULT '["polygon_mainnet"]',
  "primary_chain" chain_network NOT NULL DEFAULT 'polygon_mainnet',

  -- Gas settings
  "max_gas_price_gwei" integer DEFAULT 500,
  "gas_price_buffer_percent" integer DEFAULT 20,
  "enable_gas_bumping" boolean DEFAULT true,

  -- Confirmation settings
  "required_confirmations" integer NOT NULL DEFAULT 12,

  -- AgentAnchor settings
  "agent_anchor_enabled" boolean DEFAULT true,
  "agent_anchor_api_key" text,
  "agent_anchor_endpoint" text,

  -- Circuit breaker settings
  "circuit_breaker_threshold" integer DEFAULT 5,
  "circuit_breaker_reset_ms" integer DEFAULT 300000,

  -- Retry settings
  "max_retries" integer NOT NULL DEFAULT 5,
  "retry_delay_ms" integer NOT NULL DEFAULT 30000,
  "retry_backoff_multiplier" integer DEFAULT 2,

  -- Feature flags
  "enabled" boolean NOT NULL DEFAULT true,
  "auto_anchor" boolean NOT NULL DEFAULT true,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for chain_anchor_config
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "chain_anchor_config_tenant_idx"
ON "chain_anchor_config" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "chain_anchor_config_enabled_idx"
ON "chain_anchor_config" ("enabled");

-- =============================================================================
-- ADD ANCHOR COLUMNS TO PROOFS TABLE
-- =============================================================================

-- Add anchoring columns to existing proofs table
ALTER TABLE "proofs" ADD COLUMN IF NOT EXISTS "anchor_batch_id" uuid;
ALTER TABLE "proofs" ADD COLUMN IF NOT EXISTS "anchored" boolean DEFAULT false;
ALTER TABLE "proofs" ADD COLUMN IF NOT EXISTS "anchored_at" timestamptz;

-- Index for finding unanchored proofs
CREATE INDEX CONCURRENTLY IF NOT EXISTS "proofs_unanchored_idx"
ON "proofs" ("anchored", "chain_position")
WHERE "anchored" = false;

-- Index for batch lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS "proofs_anchor_batch_idx"
ON "proofs" ("anchor_batch_id");

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE "anchor_batches" IS 'Groups of proofs aggregated for blockchain anchoring via Merkle trees';
COMMENT ON COLUMN "anchor_batches"."merkle_root" IS 'Root hash of the Merkle tree containing all proof hashes in this batch';
COMMENT ON COLUMN "anchor_batches"."target_chains" IS 'List of blockchain networks to anchor this batch to';

COMMENT ON TABLE "anchor_transactions" IS 'Blockchain transactions for anchoring proof batches';
COMMENT ON COLUMN "anchor_transactions"."tx_hash" IS 'Transaction hash on the blockchain';
COMMENT ON COLUMN "anchor_transactions"."confirmations" IS 'Number of block confirmations received';

COMMENT ON TABLE "proof_anchors" IS 'Links individual proofs to their anchor batches with Merkle proofs';
COMMENT ON COLUMN "proof_anchors"."merkle_proof" IS 'Array of hashes forming the Merkle proof path to the root';

COMMENT ON TABLE "agent_anchor_submissions" IS 'Tracks submissions to the AgentAnchor certification platform';
COMMENT ON COLUMN "agent_anchor_submissions"."certificate_id" IS 'Certificate ID issued by AgentAnchor upon verification';

COMMENT ON TABLE "chain_anchor_config" IS 'Per-tenant configuration for blockchain anchoring behavior';
COMMENT ON COLUMN "chain_anchor_config"."primary_chain" IS 'Primary blockchain network for anchoring';
