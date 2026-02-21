/**
 * Merkle Tree Schema
 *
 * Database schema for Merkle tree aggregation of proofs.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Merkle roots table - stores aggregated proof tree roots
 */
export const merkleRoots = pgTable(
  'merkle_roots',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The Merkle root hash (SHA-256 hex string) */
    rootHash: text('root_hash').notNull(),

    /** Number of proof leaves in this tree */
    leafCount: integer('leaf_count').notNull(),

    /** Time window start for proofs included in this tree */
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),

    /** Time window end for proofs included in this tree */
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),

    /** Optional anchor transaction (for blockchain anchoring) */
    anchorTx: text('anchor_tx'),

    /** Anchor chain (e.g., 'ethereum', 'bitcoin') */
    anchorChain: text('anchor_chain'),

    /** Anchor timestamp (when anchored to blockchain) */
    anchoredAt: timestamp('anchored_at', { withTimezone: true }),

    /** Full tree structure for reconstruction (optional, for debugging) */
    treeLevels: jsonb('tree_levels').$type<string[][]>(),

    /** Creation timestamp */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Fast lookup by root hash
    rootHashIdx: uniqueIndex('merkle_roots_root_hash_idx').on(table.rootHash),
    // Query by time window
    windowStartIdx: index('merkle_roots_window_start_idx').on(table.windowStart),
    // Query by creation time
    createdAtIdx: index('merkle_roots_created_at_idx').on(table.createdAt),
    // Query for unanchored roots
    anchorTxIdx: index('merkle_roots_anchor_tx_idx').on(table.anchorTx),
  })
);

/**
 * Merkle leaves table - maps individual proofs to their Merkle tree position
 */
export const merkleLeaves = pgTable(
  'merkle_leaves',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the proof */
    proofId: uuid('proof_id').notNull(),

    /** Reference to the Merkle root this leaf belongs to */
    rootId: uuid('root_id').notNull(),

    /** Leaf index in the tree (0-based) */
    leafIndex: integer('leaf_index').notNull(),

    /** The leaf hash (SHA-256 of proof_id:proof_hash) */
    leafHash: text('leaf_hash').notNull(),

    /** Sibling hashes for proof reconstruction (JSON array) */
    siblingHashes: jsonb('sibling_hashes').notNull().$type<string[]>(),

    /** Sibling directions (true = right, false = left) */
    siblingDirections: jsonb('sibling_directions').notNull().$type<boolean[]>(),

    /** Creation timestamp */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Fast lookup by proof ID
    proofIdIdx: uniqueIndex('merkle_leaves_proof_id_idx').on(table.proofId),
    // Fast lookup by root ID
    rootIdIdx: index('merkle_leaves_root_id_idx').on(table.rootId),
    // Leaf hash lookup
    leafHashIdx: index('merkle_leaves_leaf_hash_idx').on(table.leafHash),
  })
);

/**
 * Pending proofs queue - proofs waiting to be aggregated into a Merkle tree
 */
export const merkleQueue = pgTable(
  'merkle_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the proof */
    proofId: uuid('proof_id').notNull(),

    /** The proof's hash for leaf computation */
    proofHash: text('proof_hash').notNull(),

    /** Whether this proof has been aggregated */
    aggregated: boolean('aggregated').notNull().default(false),

    /** Reference to the Merkle root (set after aggregation) */
    rootId: uuid('root_id'),

    /** Queue timestamp */
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Aggregation timestamp */
    aggregatedAt: timestamp('aggregated_at', { withTimezone: true }),
  },
  (table) => ({
    // Fast lookup by proof ID
    proofIdIdx: uniqueIndex('merkle_queue_proof_id_idx').on(table.proofId),
    // Find pending proofs efficiently
    aggregatedIdx: index('merkle_queue_aggregated_idx').on(table.aggregated),
    // Order by queue time
    queuedAtIdx: index('merkle_queue_queued_at_idx').on(table.queuedAt),
  })
);

// Type exports
export type MerkleRoot = typeof merkleRoots.$inferSelect;
export type NewMerkleRoot = typeof merkleRoots.$inferInsert;
export type MerkleLeaf = typeof merkleLeaves.$inferSelect;
export type NewMerkleLeaf = typeof merkleLeaves.$inferInsert;
export type MerkleQueueItem = typeof merkleQueue.$inferSelect;
export type NewMerkleQueueItem = typeof merkleQueue.$inferInsert;
