/**
 * Chain Anchor Schema
 *
 * Database schema for blockchain anchoring of proof records.
 * Supports multi-chain anchoring with Merkle aggregation.
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
  boolean,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Supported blockchain networks
 */
export const chainNetworkEnum = pgEnum('chain_network', [
  'ethereum_mainnet',
  'ethereum_sepolia',
  'polygon_mainnet',
  'polygon_amoy',
  'arbitrum_one',
  'arbitrum_sepolia',
  'base_mainnet',
  'base_sepolia',
  'optimism_mainnet',
  'optimism_sepolia',
]);

/**
 * Anchor batch status
 */
export const anchorBatchStatusEnum = pgEnum('anchor_batch_status', [
  'collecting',      // Actively collecting proofs
  'pending',         // Ready for anchoring
  'submitting',      // Transaction submitted, awaiting confirmation
  'confirming',      // Awaiting required confirmations
  'anchored',        // Successfully anchored on chain
  'failed',          // Anchoring failed after retries
  'expired',         // Batch expired without anchoring
]);

/**
 * Anchor transaction status
 */
export const anchorTxStatusEnum = pgEnum('anchor_tx_status', [
  'pending',         // Transaction created, not yet submitted
  'submitted',       // Submitted to network
  'confirming',      // Awaiting confirmations
  'confirmed',       // Required confirmations reached
  'failed',          // Transaction failed
  'replaced',        // Replaced by another transaction (gas bump)
  'dropped',         // Dropped from mempool
]);

/**
 * AgentAnchor submission status
 */
export const agentAnchorStatusEnum = pgEnum('agent_anchor_status', [
  'pending',         // Not yet submitted
  'submitted',       // Submitted to AgentAnchor
  'verified',        // Verified by AgentAnchor
  'rejected',        // Rejected by AgentAnchor
  'failed',          // Submission failed
]);

// =============================================================================
// ANCHOR BATCHES TABLE
// =============================================================================

/**
 * Anchor batches - groups of proofs to be anchored together
 */
export const anchorBatches = pgTable('anchor_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: text('tenant_id').notNull(),

  // Batch identification
  batchNumber: integer('batch_number').notNull(),
  chainId: text('chain_id').notNull().default('default'),

  // Status tracking
  status: anchorBatchStatusEnum('status').notNull().default('collecting'),

  // Proof range (inclusive)
  startPosition: integer('start_position').notNull(),
  endPosition: integer('end_position'),
  proofCount: integer('proof_count').notNull().default(0),

  // Merkle tree data
  merkleRoot: text('merkle_root'),
  merkleTreeDepth: integer('merkle_tree_depth'),
  merkleTreeData: jsonb('merkle_tree_data').$type<{
    leaves: string[];
    layers: string[][];
    proofs: Record<string, string[]>;
  }>(),

  // Aggregated hash (for quick verification)
  batchHash: text('batch_hash'),

  // Target chains for anchoring
  targetChains: jsonb('target_chains').$type<string[]>().notNull().default([]),

  // Retry tracking
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(5),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),

  // Timing
  collectionStartedAt: timestamp('collection_started_at', { withTimezone: true }).defaultNow().notNull(),
  collectionEndedAt: timestamp('collection_ended_at', { withTimezone: true }),
  anchoringStartedAt: timestamp('anchoring_started_at', { withTimezone: true }),
  anchoredAt: timestamp('anchored_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('anchor_batches_tenant_idx').on(table.tenantId),
  chainIdIdx: index('anchor_batches_chain_id_idx').on(table.chainId),
  statusIdx: index('anchor_batches_status_idx').on(table.status),
  batchNumberIdx: uniqueIndex('anchor_batches_batch_number_idx').on(
    table.tenantId,
    table.chainId,
    table.batchNumber
  ),
  merkleRootIdx: index('anchor_batches_merkle_root_idx').on(table.merkleRoot),
  pendingIdx: index('anchor_batches_pending_idx').on(table.status, table.expiresAt),
}));

// =============================================================================
// ANCHOR TRANSACTIONS TABLE
// =============================================================================

/**
 * Anchor transactions - blockchain transactions for anchoring batches
 */
export const anchorTransactions = pgTable('anchor_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  batchId: uuid('batch_id').notNull().references(() => anchorBatches.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),

  // Chain details
  network: chainNetworkEnum('network').notNull(),
  chainIdNumeric: integer('chain_id_numeric').notNull(),

  // Transaction details
  txHash: text('tx_hash'),
  blockNumber: integer('block_number'),
  blockHash: text('block_hash'),
  blockTimestamp: timestamp('block_timestamp', { withTimezone: true }),

  // Transaction parameters
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  contractAddress: text('contract_address'),
  gasLimit: text('gas_limit'),
  gasPrice: text('gas_price'),
  maxFeePerGas: text('max_fee_per_gas'),
  maxPriorityFeePerGas: text('max_priority_fee_per_gas'),
  gasUsed: text('gas_used'),
  effectiveGasPrice: text('effective_gas_price'),
  nonce: integer('nonce'),

  // Status tracking
  status: anchorTxStatusEnum('status').notNull().default('pending'),
  confirmations: integer('confirmations').notNull().default(0),
  requiredConfirmations: integer('required_confirmations').notNull().default(12),

  // Transaction data
  inputData: text('input_data'),
  merkleRoot: text('merkle_root').notNull(),

  // Replacement tracking (for gas bumps)
  replacedByTxHash: text('replaced_by_tx_hash'),
  originalTxId: uuid('original_tx_id'),

  // Error tracking
  errorMessage: text('error_message'),
  errorCode: text('error_code'),

  // Cost tracking (in wei/gwei)
  txCostWei: text('tx_cost_wei'),
  txCostUsd: text('tx_cost_usd'),

  // Timing
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  batchIdx: index('anchor_transactions_batch_idx').on(table.batchId),
  tenantIdx: index('anchor_transactions_tenant_idx').on(table.tenantId),
  networkIdx: index('anchor_transactions_network_idx').on(table.network),
  txHashIdx: uniqueIndex('anchor_transactions_tx_hash_idx').on(table.txHash),
  statusIdx: index('anchor_transactions_status_idx').on(table.status),
  blockNumberIdx: index('anchor_transactions_block_number_idx').on(table.network, table.blockNumber),
  pendingIdx: index('anchor_transactions_pending_idx').on(table.status).where(
    // Only index pending/submitted/confirming transactions
  ),
}));

// =============================================================================
// PROOF ANCHORS TABLE (Join table)
// =============================================================================

/**
 * Proof anchors - links proofs to their anchor batches
 */
export const proofAnchors = pgTable('proof_anchors', {
  id: uuid('id').defaultRandom().primaryKey(),
  proofId: uuid('proof_id').notNull(),
  batchId: uuid('batch_id').notNull().references(() => anchorBatches.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),

  // Position in batch
  batchPosition: integer('batch_position').notNull(),

  // Merkle proof for this specific proof
  merkleProof: jsonb('merkle_proof').$type<string[]>(),
  merkleLeaf: text('merkle_leaf'),
  merkleLeafIndex: integer('merkle_leaf_index'),

  // Verification status
  verified: boolean('verified').default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  proofIdx: uniqueIndex('proof_anchors_proof_idx').on(table.proofId),
  batchIdx: index('proof_anchors_batch_idx').on(table.batchId),
  tenantIdx: index('proof_anchors_tenant_idx').on(table.tenantId),
  batchPositionIdx: uniqueIndex('proof_anchors_batch_position_idx').on(table.batchId, table.batchPosition),
}));

// =============================================================================
// AGENT ANCHOR SUBMISSIONS TABLE
// =============================================================================

/**
 * AgentAnchor submissions - tracks submissions to the AgentAnchor certification platform
 */
export const agentAnchorSubmissions = pgTable('agent_anchor_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  batchId: uuid('batch_id').notNull().references(() => anchorBatches.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),

  // AgentAnchor identifiers
  agentAnchorId: text('agent_anchor_id'),
  agentId: uuid('agent_id').notNull(),
  submissionRef: text('submission_ref'),

  // Status
  status: agentAnchorStatusEnum('status').notNull().default('pending'),

  // Request/Response data
  requestPayload: jsonb('request_payload').$type<{
    agentId: string;
    merkleRoot: string;
    proofCount: number;
    chainAnchors: Array<{
      network: string;
      txHash: string;
      blockNumber: number;
    }>;
    metadata: Record<string, unknown>;
  }>(),
  responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),

  // Verification
  certificateId: text('certificate_id'),
  certificateUrl: text('certificate_url'),
  verificationToken: text('verification_token'),

  // Error tracking
  errorMessage: text('error_message'),
  errorCode: text('error_code'),
  retryCount: integer('retry_count').notNull().default(0),

  // Timing
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  batchIdx: index('agent_anchor_submissions_batch_idx').on(table.batchId),
  tenantIdx: index('agent_anchor_submissions_tenant_idx').on(table.tenantId),
  agentIdx: index('agent_anchor_submissions_agent_idx').on(table.agentId),
  statusIdx: index('agent_anchor_submissions_status_idx').on(table.status),
  agentAnchorIdIdx: uniqueIndex('agent_anchor_submissions_anchor_id_idx').on(table.agentAnchorId),
  certificateIdx: index('agent_anchor_submissions_certificate_idx').on(table.certificateId),
}));

// =============================================================================
// CHAIN ANCHOR CONFIG TABLE
// =============================================================================

/**
 * Chain anchor configuration - per-tenant anchoring settings
 */
export const chainAnchorConfig = pgTable('chain_anchor_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: text('tenant_id').notNull(),

  // Batching configuration
  batchSizeLimit: integer('batch_size_limit').notNull().default(1000),
  batchTimeoutMs: integer('batch_timeout_ms').notNull().default(300000), // 5 minutes
  batchExpirationMs: integer('batch_expiration_ms').notNull().default(86400000), // 24 hours

  // Target chains
  enabledChains: jsonb('enabled_chains').$type<string[]>().notNull().default(['polygon_mainnet']),
  primaryChain: chainNetworkEnum('primary_chain').notNull().default('polygon_mainnet'),

  // Gas settings
  maxGasPriceGwei: integer('max_gas_price_gwei').default(500),
  gasPriceBufferPercent: integer('gas_price_buffer_percent').default(20),
  enableGasBumping: boolean('enable_gas_bumping').default(true),

  // Confirmation settings
  requiredConfirmations: integer('required_confirmations').notNull().default(12),

  // AgentAnchor settings
  agentAnchorEnabled: boolean('agent_anchor_enabled').default(true),
  agentAnchorApiKey: text('agent_anchor_api_key'),
  agentAnchorEndpoint: text('agent_anchor_endpoint'),

  // Circuit breaker settings
  circuitBreakerThreshold: integer('circuit_breaker_threshold').default(5),
  circuitBreakerResetMs: integer('circuit_breaker_reset_ms').default(300000), // 5 minutes

  // Retry settings
  maxRetries: integer('max_retries').notNull().default(5),
  retryDelayMs: integer('retry_delay_ms').notNull().default(30000), // 30 seconds
  retryBackoffMultiplier: integer('retry_backoff_multiplier').default(2),

  // Feature flags
  enabled: boolean('enabled').notNull().default(true),
  autoAnchor: boolean('auto_anchor').notNull().default(true),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: uniqueIndex('chain_anchor_config_tenant_idx').on(table.tenantId),
  enabledIdx: index('chain_anchor_config_enabled_idx').on(table.enabled),
}));

// =============================================================================
// RELATIONS
// =============================================================================

export const anchorBatchesRelations = relations(anchorBatches, ({ many }) => ({
  transactions: many(anchorTransactions),
  proofAnchors: many(proofAnchors),
  agentAnchorSubmissions: many(agentAnchorSubmissions),
}));

export const anchorTransactionsRelations = relations(anchorTransactions, ({ one }) => ({
  batch: one(anchorBatches, {
    fields: [anchorTransactions.batchId],
    references: [anchorBatches.id],
  }),
  originalTx: one(anchorTransactions, {
    fields: [anchorTransactions.originalTxId],
    references: [anchorTransactions.id],
    relationName: 'replacedBy',
  }),
}));

export const proofAnchorsRelations = relations(proofAnchors, ({ one }) => ({
  batch: one(anchorBatches, {
    fields: [proofAnchors.batchId],
    references: [anchorBatches.id],
  }),
}));

export const agentAnchorSubmissionsRelations = relations(agentAnchorSubmissions, ({ one }) => ({
  batch: one(anchorBatches, {
    fields: [agentAnchorSubmissions.batchId],
    references: [anchorBatches.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type AnchorBatchRow = typeof anchorBatches.$inferSelect;
export type NewAnchorBatchRow = typeof anchorBatches.$inferInsert;
export type AnchorTransactionRow = typeof anchorTransactions.$inferSelect;
export type NewAnchorTransactionRow = typeof anchorTransactions.$inferInsert;
export type ProofAnchorRow = typeof proofAnchors.$inferSelect;
export type NewProofAnchorRow = typeof proofAnchors.$inferInsert;
export type AgentAnchorSubmissionRow = typeof agentAnchorSubmissions.$inferSelect;
export type NewAgentAnchorSubmissionRow = typeof agentAnchorSubmissions.$inferInsert;
export type ChainAnchorConfigRow = typeof chainAnchorConfig.$inferSelect;
export type NewChainAnchorConfigRow = typeof chainAnchorConfig.$inferInsert;

// Type aliases for status enums
export type ChainNetwork = typeof chainNetworkEnum.enumValues[number];
export type AnchorBatchStatus = typeof anchorBatchStatusEnum.enumValues[number];
export type AnchorTxStatus = typeof anchorTxStatusEnum.enumValues[number];
export type AgentAnchorStatus = typeof agentAnchorStatusEnum.enumValues[number];
