-- Merkle Tree Aggregation Tables
-- This migration adds tables for Merkle tree aggregation of proofs

-- Merkle roots table - stores aggregated proof tree roots
CREATE TABLE IF NOT EXISTS "merkle_roots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "root_hash" text NOT NULL,
    "leaf_count" integer NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "window_end" timestamp with time zone NOT NULL,
    "anchor_tx" text,
    "anchor_chain" text,
    "anchored_at" timestamp with time zone,
    "tree_levels" jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Merkle leaves table - maps individual proofs to their Merkle tree position
CREATE TABLE IF NOT EXISTS "merkle_leaves" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "proof_id" uuid NOT NULL,
    "root_id" uuid NOT NULL,
    "leaf_index" integer NOT NULL,
    "leaf_hash" text NOT NULL,
    "sibling_hashes" jsonb NOT NULL,
    "sibling_directions" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Merkle queue table - pending proofs waiting to be aggregated
CREATE TABLE IF NOT EXISTS "merkle_queue" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "proof_id" uuid NOT NULL,
    "proof_hash" text NOT NULL,
    "aggregated" boolean NOT NULL DEFAULT false,
    "root_id" uuid,
    "queued_at" timestamp with time zone NOT NULL DEFAULT now(),
    "aggregated_at" timestamp with time zone
);

-- Indexes for merkle_roots
CREATE UNIQUE INDEX IF NOT EXISTS "merkle_roots_root_hash_idx" ON "merkle_roots" ("root_hash");
CREATE INDEX IF NOT EXISTS "merkle_roots_window_start_idx" ON "merkle_roots" ("window_start");
CREATE INDEX IF NOT EXISTS "merkle_roots_created_at_idx" ON "merkle_roots" ("created_at");
CREATE INDEX IF NOT EXISTS "merkle_roots_anchor_tx_idx" ON "merkle_roots" ("anchor_tx");

-- Indexes for merkle_leaves
CREATE UNIQUE INDEX IF NOT EXISTS "merkle_leaves_proof_id_idx" ON "merkle_leaves" ("proof_id");
CREATE INDEX IF NOT EXISTS "merkle_leaves_root_id_idx" ON "merkle_leaves" ("root_id");
CREATE INDEX IF NOT EXISTS "merkle_leaves_leaf_hash_idx" ON "merkle_leaves" ("leaf_hash");

-- Indexes for merkle_queue
CREATE UNIQUE INDEX IF NOT EXISTS "merkle_queue_proof_id_idx" ON "merkle_queue" ("proof_id");
CREATE INDEX IF NOT EXISTS "merkle_queue_aggregated_idx" ON "merkle_queue" ("aggregated");
CREATE INDEX IF NOT EXISTS "merkle_queue_queued_at_idx" ON "merkle_queue" ("queued_at");

-- Foreign key constraints
ALTER TABLE "merkle_leaves"
    ADD CONSTRAINT "merkle_leaves_root_id_fk"
    FOREIGN KEY ("root_id") REFERENCES "merkle_roots"("id") ON DELETE CASCADE;

ALTER TABLE "merkle_leaves"
    ADD CONSTRAINT "merkle_leaves_proof_id_fk"
    FOREIGN KEY ("proof_id") REFERENCES "proofs"("id") ON DELETE CASCADE;

ALTER TABLE "merkle_queue"
    ADD CONSTRAINT "merkle_queue_proof_id_fk"
    FOREIGN KEY ("proof_id") REFERENCES "proofs"("id") ON DELETE CASCADE;

ALTER TABLE "merkle_queue"
    ADD CONSTRAINT "merkle_queue_root_id_fk"
    FOREIGN KEY ("root_id") REFERENCES "merkle_roots"("id") ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON TABLE "merkle_roots" IS 'Stores Merkle tree roots for aggregated proof batches';
COMMENT ON TABLE "merkle_leaves" IS 'Maps individual proofs to their position in Merkle trees';
COMMENT ON TABLE "merkle_queue" IS 'Queue for proofs waiting to be aggregated into Merkle trees';
