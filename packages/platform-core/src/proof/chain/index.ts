/**
 * Blockchain Anchoring Module
 *
 * Provides optional blockchain anchoring for proofs to create
 * tamper-evident timestamps on public ledgers.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type { ID } from '../../common/types.js';
import type { Database } from '../../common/db.js';
import {
  sha256,
  buildMerkleTree,
  generateMerkleProof,
  generateAllProofs,
  verifyMerkleProof,
  hashProofToLeaf,
  type MerkleProof,
  type MerkleTreeResult,
} from '../merkle.js';

const logger = createLogger({ component: 'chain-anchor' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Proof data prepared for blockchain anchoring
 */
export interface ProofToAnchor {
  /** Proof ID */
  id: ID;
  /** Proof hash to anchor */
  hash: string;
  /** Timestamp of proof creation */
  timestamp: Date;
  /** Tenant ID */
  tenantId?: string;
  /** Chain position in batch */
  chainPosition?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of anchoring a single proof
 */
export interface ProofAnchorResult {
  /** Proof ID that was anchored */
  proofId: ID;
  /** Whether anchoring succeeded */
  success: boolean;
  /** Transaction hash on the blockchain */
  txHash?: string;
  /** Block number where anchor was included */
  blockNumber?: number;
  /** Chain identifier (e.g., 'ethereum-mainnet', 'polygon') */
  chainId?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp of anchoring */
  anchoredAt?: Date;
}

/**
 * Result of anchoring a batch of proofs
 */
export interface BatchAnchorResult {
  /** Total proofs in batch */
  total: number;
  /** Successfully anchored count */
  succeeded: number;
  /** Failed count */
  failed: number;
  /** Individual results */
  results: ProofAnchorResult[];
  /** Merkle root of the batch (if batched) */
  batchRoot?: string;
  /** Transaction hash for batch anchor */
  batchTxHash?: string;
}

/**
 * Configuration for chain anchor service
 */
export interface ChainAnchorConfig {
  /** Default batch size for Merkle tree anchoring */
  defaultBatchSize?: number;
  /** Default batch timeout in ms */
  defaultBatchTimeoutMs?: number;
  /** Enable agent anchor (record agent in proofs) */
  enableAgentAnchor?: boolean;
  /** Enable anchoring */
  enabled?: boolean;
  /** Chain to use (e.g., 'ethereum', 'polygon', 'arbitrum') */
  chain?: string;
  /** RPC endpoint URL */
  rpcUrl?: string;
  /** Contract address for anchoring */
  contractAddress?: string;
}

/**
 * Chain anchor statistics
 */
export interface ChainAnchorStats {
  /** Total proofs anchored */
  totalAnchored: number;
  /** Total batches processed */
  totalBatches: number;
  /** Pending proofs */
  pendingCount: number;
  /** Last anchor timestamp */
  lastAnchorAt?: Date;
  /** Chain ID */
  chainId?: string;
}

// =============================================================================
// INTERNAL ANCHOR STORE TYPES
// =============================================================================

/**
 * Stored anchor record in the in-memory anchor store.
 * Represents a proof that has been anchored (locally or to blockchain).
 */
interface StoredAnchorRecord {
  /** The anchor result returned to callers */
  result: ProofAnchorResult;
  /** Original proof hash that was anchored */
  proofHash: string;
  /** Merkle proof path if this proof was part of a batch */
  merkleProof?: MerkleProof;
  /** Batch root hash if part of a batch */
  batchRoot?: string;
  /** Timestamp when this record was stored */
  storedAt: Date;
}

// =============================================================================
// CHAIN ANCHOR SERVICE
// =============================================================================

/**
 * Service for anchoring proofs to blockchain
 *
 * Supports multiple chains and batching via Merkle trees for efficiency.
 *
 * Architecture layers:
 *  1. Local proof layer (current): In-memory Map + optional database persistence.
 *     All anchoring operations store proofs locally with deterministic anchor IDs,
 *     Merkle tree batching, and full verification capabilities.
 *  2. L2 blockchain layer (future): Polygon / Arbitrum on-chain anchoring.
 *     When rpcUrl and contractAddress are configured, Merkle roots will be
 *     submitted to an on-chain anchor contract for tamper-evident timestamping.
 *
 * // ---- Future Polygon L2 Integration Architecture ----
 * // When config.rpcUrl and config.contractAddress are set:
 * //   1. anchorProof / anchorBatch computes the Merkle root as it does today
 * //   2. A ProofAnchorContract adapter calls:
 * //        contract.anchorRoot(merkleRoot, leafCount, metadata)
 * //   3. The tx receipt provides txHash and blockNumber for ProofAnchorResult
 * //   4. Verification calls contract.verifyRoot(merkleRoot) to confirm on-chain
 * //   5. The in-memory store continues to hold Merkle paths for local verification
 * // ---------------------------------------------------
 */
export class ChainAnchorService {
  private config: ChainAnchorConfig;
  private db?: Database;
  private pendingProofs: ProofToAnchor[] = [];
  private stats: ChainAnchorStats = {
    totalAnchored: 0,
    totalBatches: 0,
    pendingCount: 0,
  };

  /**
   * In-memory anchor store keyed by proofId.
   * Serves as the primary local proof layer. In production this would be
   * backed by the database; the in-memory Map provides zero-dependency
   * functionality for development and testing.
   */
  private anchorStore: Map<string, StoredAnchorRecord> = new Map();

  /**
   * Auto-incrementing simulated block number for the local anchor layer.
   * Each anchorProof call increments this to simulate blockchain progression.
   */
  private simulatedBlockNumber: number = 0;

  constructor(config: ChainAnchorConfig) {
    this.config = config;
    logger.info('Chain anchor service created', {
      batchSize: config.defaultBatchSize,
      chain: config.chain,
    });
  }

  /**
   * Initialize with database connection
   */
  initialize(db: Database): void {
    this.db = db;
    logger.info('Chain anchor service initialized');
  }

  /**
   * Check if anchoring is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * Add proofs to the current batch
   */
  async addProofsToBatch(proofs: ProofToAnchor[]): Promise<void> {
    this.pendingProofs.push(...proofs);
    this.stats.pendingCount = this.pendingProofs.length;

    logger.debug('Added proofs to batch', {
      added: proofs.length,
      pending: this.pendingProofs.length,
    });

    // Auto-flush if batch size reached
    const batchSize = this.config.defaultBatchSize ?? 1000;
    if (this.pendingProofs.length >= batchSize) {
      await this.processPendingBatches();
    }
  }

  /**
   * Process pending batches
   */
  async processPendingBatches(): Promise<BatchAnchorResult[]> {
    if (this.pendingProofs.length === 0) {
      return [];
    }

    const batchSize = this.config.defaultBatchSize ?? 1000;
    const results: BatchAnchorResult[] = [];

    while (this.pendingProofs.length > 0) {
      const batch = this.pendingProofs.splice(0, batchSize);
      const result = await this.anchorBatch(batch);
      results.push(result);
    }

    this.stats.pendingCount = 0;
    return results;
  }

  /**
   * Anchor a single proof to blockchain
   *
   * Local proof layer implementation:
   *  - Generates a deterministic anchor ID (txHash) from the proof hash using SHA-256
   *  - Assigns an incrementing simulated block number
   *  - Stores the anchor record in the in-memory store for later lookup and verification
   *
   * When a real blockchain backend is configured (rpcUrl + contractAddress),
   * this method would submit the proof hash to the on-chain anchor contract
   * and use the actual txHash and blockNumber from the receipt.
   */
  async anchorProof(proof: ProofToAnchor): Promise<ProofAnchorResult> {
    logger.info('Anchoring proof', { proofId: proof.id });

    const chainId = this.config.chain || 'local';
    const anchoredAt = new Date();

    // Generate a deterministic anchor ID (txHash) from the proof hash.
    // Prefixed with '0x' to resemble an EVM transaction hash.
    const txHash = '0x' + await sha256(`anchor:${proof.hash}:${proof.id}`);

    // Simulate block progression
    this.simulatedBlockNumber++;
    const blockNumber = this.simulatedBlockNumber;

    const result: ProofAnchorResult = {
      proofId: proof.id,
      success: true,
      txHash,
      blockNumber,
      chainId,
      anchoredAt,
    };

    // Store in the local anchor store for lookup and verification
    this.anchorStore.set(proof.id, {
      result,
      proofHash: proof.hash,
      storedAt: anchoredAt,
    });

    this.stats.totalAnchored++;
    this.stats.lastAnchorAt = anchoredAt;
    this.stats.chainId = chainId;

    logger.info('Proof anchored', {
      proofId: proof.id,
      txHash: txHash.slice(0, 18) + '...',
      blockNumber,
      chainId,
    });

    return result;
  }

  /**
   * Anchor a batch of proofs using Merkle tree
   *
   * Implementation:
   *  1. Convert each proof into a Merkle leaf hash (sha256 of proofId:proofHash)
   *  2. Build a binary Merkle tree from all leaf hashes
   *  3. Generate individual Merkle proofs (inclusion paths) for every leaf
   *  4. Compute a deterministic batch txHash from the Merkle root
   *  5. Store each proof's anchor record with its Merkle path for later verification
   *
   * The Merkle root is the single value that would be submitted on-chain in
   * a production L2 deployment, making batch anchoring O(1) on-chain cost
   * regardless of the number of proofs in the batch.
   */
  async anchorBatch(proofs: ProofToAnchor[]): Promise<BatchAnchorResult> {
    logger.info('Anchoring proof batch', { count: proofs.length });

    if (proofs.length === 0) {
      return { total: 0, succeeded: 0, failed: 0, results: [] };
    }

    const chainId = this.config.chain || 'local';
    const anchoredAt = new Date();
    const results: ProofAnchorResult[] = [];
    let succeeded = 0;
    let failed = 0;

    try {
      // Step 1: Compute leaf hashes for every proof in the batch
      const leafHashes = await Promise.all(
        proofs.map((p) => hashProofToLeaf(p.id, p.hash))
      );

      // Step 2: Build the binary Merkle tree
      const tree: MerkleTreeResult = await buildMerkleTree(leafHashes);

      // Step 3: Generate Merkle inclusion proofs for each leaf
      const merkleProofs: MerkleProof[] = generateAllProofs(tree);

      // Step 4: Derive a deterministic batch txHash from the Merkle root
      const batchTxHash = '0x' + await sha256(`batch-anchor:${tree.root}`);

      // Simulate block progression for the batch (one block per batch)
      this.simulatedBlockNumber++;
      const blockNumber = this.simulatedBlockNumber;

      // Step 5: Create individual anchor results and store them
      for (let i = 0; i < proofs.length; i++) {
        const proof = proofs[i]!;
        const merkleProof = merkleProofs[i]!;

        // Each proof in the batch shares the same txHash and block (batched into one tx)
        const proofTxHash = batchTxHash;

        const anchorResult: ProofAnchorResult = {
          proofId: proof.id,
          success: true,
          txHash: proofTxHash,
          blockNumber,
          chainId,
          anchoredAt,
        };

        // Store with Merkle path for future verification
        this.anchorStore.set(proof.id, {
          result: anchorResult,
          proofHash: proof.hash,
          merkleProof,
          batchRoot: tree.root,
          storedAt: anchoredAt,
        });

        results.push(anchorResult);
        succeeded++;
      }

      this.stats.totalAnchored += succeeded;
      this.stats.totalBatches++;
      this.stats.lastAnchorAt = anchoredAt;
      this.stats.chainId = chainId;

      logger.info('Proof batch anchored', {
        total: proofs.length,
        succeeded,
        merkleRoot: tree.root.slice(0, 16) + '...',
        batchTxHash: batchTxHash.slice(0, 18) + '...',
        blockNumber,
      });

      return {
        total: proofs.length,
        succeeded,
        failed,
        results,
        batchRoot: tree.root,
        batchTxHash,
      };
    } catch (error) {
      // If Merkle tree construction fails, mark all proofs as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, count: proofs.length }, 'Batch anchoring failed');

      for (const proof of proofs) {
        results.push({
          proofId: proof.id,
          success: false,
          chainId,
          error: errorMessage,
        });
        failed++;
      }

      return {
        total: proofs.length,
        succeeded: 0,
        failed,
        results,
      };
    }
  }

  /**
   * Get anchor status for a specific proof
   *
   * Looks up the proof anchor record from the in-memory store.
   * Returns the full ProofAnchorResult including txHash, blockNumber,
   * chainId, and anchoring timestamp, or null if the proof has not
   * been anchored.
   *
   * In a production deployment with database persistence, this would
   * query the anchor records table instead of the in-memory Map.
   */
  async getProofAnchor(proofId: ID): Promise<ProofAnchorResult | null> {
    logger.debug('Getting proof anchor', { proofId });

    const record = this.anchorStore.get(proofId);
    if (!record) {
      logger.debug('Proof anchor not found', { proofId });
      return null;
    }

    return record.result;
  }

  /**
   * Verify a proof is properly anchored
   *
   * Verification steps:
   *  1. Look up the anchor record from the in-memory store
   *  2. Verify the provided hash matches the stored proof hash
   *  3. If the proof was part of a Merkle batch, verify the Merkle inclusion path
   *     by recomputing the leaf hash and walking the path up to the stored root
   *  4. Return a verification result with details
   *
   * In a production L2 deployment, step 3 would additionally verify
   * that the Merkle root is anchored on-chain by querying the anchor contract.
   */
  async verifyProofAnchored(
    proofId: ID,
    hash: string
  ): Promise<{ valid: boolean; error?: string; details?: Record<string, unknown> }> {
    logger.debug('Verifying proof anchor', { proofId });

    // Step 1: Look up the anchor record
    const record = this.anchorStore.get(proofId);
    if (!record) {
      return {
        valid: false,
        error: 'Proof anchor not found - proof has not been anchored',
      };
    }

    // Step 2: Verify the proof hash matches what was anchored
    if (record.proofHash !== hash) {
      logger.warn('Proof hash mismatch during verification', {
        proofId,
        expectedHash: record.proofHash.slice(0, 16) + '...',
        providedHash: hash.slice(0, 16) + '...',
      });
      return {
        valid: false,
        error: 'Proof hash does not match the anchored hash - possible tampering',
        details: {
          anchoredHash: record.proofHash,
          providedHash: hash,
        },
      };
    }

    // Step 3: If part of a Merkle batch, verify the inclusion path
    if (record.merkleProof && record.batchRoot) {
      // Recompute the expected leaf hash from the proof data
      const expectedLeafHash = await hashProofToLeaf(proofId, hash);

      // Verify the leaf hash matches what's in the Merkle proof
      if (record.merkleProof.leafHash !== expectedLeafHash) {
        return {
          valid: false,
          error: 'Merkle leaf hash mismatch - proof data inconsistency',
          details: {
            expectedLeafHash,
            storedLeafHash: record.merkleProof.leafHash,
          },
        };
      }

      // Verify the full Merkle inclusion path against the batch root
      const merkleValid = await verifyMerkleProof(record.merkleProof, record.batchRoot);
      if (!merkleValid) {
        return {
          valid: false,
          error: 'Merkle inclusion proof verification failed - tree integrity compromised',
          details: {
            batchRoot: record.batchRoot,
            leafIndex: record.merkleProof.leafIndex,
            leafHash: record.merkleProof.leafHash,
          },
        };
      }

      logger.debug('Proof anchor verified with Merkle path', {
        proofId,
        batchRoot: record.batchRoot.slice(0, 16) + '...',
        leafIndex: record.merkleProof.leafIndex,
      });

      return {
        valid: true,
        details: {
          txHash: record.result.txHash,
          blockNumber: record.result.blockNumber,
          chainId: record.result.chainId,
          batchRoot: record.batchRoot,
          merkleLeafIndex: record.merkleProof.leafIndex,
          merklePathLength: record.merkleProof.siblingHashes.length,
          anchoredAt: record.result.anchoredAt?.toISOString(),
        },
      };
    }

    // Single proof (not batched) - hash match is sufficient
    logger.debug('Proof anchor verified (single proof)', {
      proofId,
      txHash: record.result.txHash?.slice(0, 18) + '...',
    });

    return {
      valid: true,
      details: {
        txHash: record.result.txHash,
        blockNumber: record.result.blockNumber,
        chainId: record.result.chainId,
        anchoredAt: record.result.anchoredAt?.toISOString(),
      },
    };
  }

  /**
   * Get statistics
   */
  getStats(): ChainAnchorStats {
    return { ...this.stats };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    // Process any remaining proofs
    if (this.pendingProofs.length > 0) {
      await this.processPendingBatches();
    }
    logger.info('Chain anchor service shutdown');
  }
}

// =============================================================================
// CHAIN ANCHOR SCHEDULER
// =============================================================================

/**
 * Scheduler for batching and periodically anchoring proofs
 */
export class ChainAnchorScheduler {
  private service: ChainAnchorService;
  private db?: Database;
  private intervalId?: ReturnType<typeof setInterval>;
  private batchSize: number;
  private intervalMs: number;

  constructor(
    service: ChainAnchorService,
    options: { batchSize?: number; intervalMs?: number } = {}
  ) {
    this.service = service;
    this.batchSize = options.batchSize || 1000;
    this.intervalMs = options.intervalMs || 300000; // 5 minutes default
  }

  /**
   * Initialize with database connection
   */
  initialize(db: Database): void {
    this.db = db;
    logger.info('Chain anchor scheduler initialized');
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    logger.info('Starting chain anchor scheduler', {
      batchSize: this.batchSize,
      intervalMs: this.intervalMs,
    });

    this.intervalId = setInterval(() => {
      this.flush().catch((err) => {
        logger.error('Failed to flush anchor batch', { error: err });
      });
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Stopped chain anchor scheduler');
    }
  }

  /**
   * Queue a proof for anchoring
   */
  async queue(proof: ProofToAnchor): Promise<void> {
    await this.service.addProofsToBatch([proof]);
  }

  /**
   * Flush pending proofs to blockchain
   */
  async flush(): Promise<BatchAnchorResult[]> {
    return this.service.processPendingBatches();
  }

  /**
   * Get count of pending proofs
   */
  getPendingCount(): number {
    return this.service.getStats().pendingCount;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a chain anchor service
 */
export function createChainAnchorService(
  config: ChainAnchorConfig
): ChainAnchorService {
  return new ChainAnchorService(config);
}

/**
 * Create a chain anchor scheduler
 */
export function createChainAnchorScheduler(
  service: ChainAnchorService,
  options?: { batchSize?: number; intervalMs?: number }
): ChainAnchorScheduler {
  return new ChainAnchorScheduler(service, options);
}
