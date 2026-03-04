/**
 * Chain Anchor Module
 *
 * Enterprise-grade blockchain anchoring for proof records.
 * Provides Merkle tree aggregation, multi-chain support, and AgentAnchor integration.
 *
 * @packageDocumentation
 */

// =============================================================================
// SCHEMA EXPORTS
// =============================================================================

export {
  // Enums
  chainNetworkEnum,
  anchorBatchStatusEnum,
  anchorTxStatusEnum,
  agentAnchorStatusEnum,
  // Tables
  anchorBatches,
  anchorTransactions,
  proofAnchors,
  agentAnchorSubmissions,
  chainAnchorConfig,
  // Relations
  anchorBatchesRelations,
  anchorTransactionsRelations,
  proofAnchorsRelations,
  agentAnchorSubmissionsRelations,
  // Types
  type AnchorBatchRow,
  type NewAnchorBatchRow,
  type AnchorTransactionRow,
  type NewAnchorTransactionRow,
  type ProofAnchorRow,
  type NewProofAnchorRow,
  type AgentAnchorSubmissionRow,
  type NewAgentAnchorSubmissionRow,
  type ChainAnchorConfigRow,
  type NewChainAnchorConfigRow,
  type ChainNetwork,
  type AnchorBatchStatus,
  type AnchorTxStatus,
  type AgentAnchorStatus,
} from './schema.js';

// =============================================================================
// MERKLE TREE EXPORTS
// =============================================================================

export {
  MerkleTree,
  createMerkleTree,
  verifyMerkleProof,
  verifyMultipleProofs,
  calculateBatchHash,
  type MerkleNode,
  type MerkleProof,
  type MerkleTreeData,
  type MerkleVerification,
} from './merkle.js';

// =============================================================================
// PROVIDER EXPORTS
// =============================================================================

export {
  BlockchainProvider,
  ProviderManager,
  providerManager,
  getChainConfig,
  getExplorerUrl,
  CHAIN_CONFIGS,
  PROOF_ANCHOR_ABI,
  type ChainConfig,
  type TransactionRequest,
  type TransactionResponse,
  type TransactionReceipt,
  type GasEstimate,
  type BlockInfo,
  type ProviderHealth,
} from './providers.js';

// =============================================================================
// AGENT ANCHOR CLIENT EXPORTS
// =============================================================================

export {
  AgentAnchorClient,
  AgentAnchorApiError,
  createAgentAnchorClient,
  validateAgentAnchorConfig,
  type AgentAnchorConfig,
  type ProofSubmissionRequest,
  type ProofSubmissionResponse,
  type ChainAnchorInfo,
  type Certificate,
  type VerificationRequest,
  type VerificationResponse,
  type AgentTrustStatus,
} from './agent-anchor-client.js';

// =============================================================================
// REPOSITORY EXPORTS
// =============================================================================

export {
  ChainAnchorRepository,
  createChainAnchorRepository,
  type Database,
  type CreateBatchInput,
  type CreateTransactionInput,
  type UpdateTransactionInput,
  type CreateProofAnchorInput,
  type CreateAgentAnchorSubmissionInput,
  type BatchQueryOptions,
} from './repository.js';

// =============================================================================
// SERVICE EXPORTS
// =============================================================================

export {
  ChainAnchorService,
  createChainAnchorService,
  type ProofToAnchor,
  type ProofAnchorResult,
  type BatchAnchorResult,
  type ChainAnchorServiceConfig,
} from './service.js';

// =============================================================================
// SCHEDULER EXPORTS
// =============================================================================

export {
  ChainAnchorScheduler,
  createChainAnchorScheduler,
  handleScheduledJob,
  CRON_EXPRESSIONS,
  type SchedulerConfig,
  type SchedulerStatus,
} from './scheduler.js';

// =============================================================================
// METRICS EXPORTS
// =============================================================================

export {
  createChainAnchorMetrics,
  getChainAnchorMetrics,
  resetChainAnchorMetrics,
  recordBatchCreated,
  recordBatchAnchored,
  recordBatchFailed,
  recordTransactionSubmitted,
  recordTransactionConfirmed,
  recordProviderMetrics,
  recordCircuitBreakerState,
  recordAgentAnchorSubmission,
  recordMerkleTreeBuilt,
  recordProofVerification,
  recordSchedulerJob,
} from './metrics.js';
