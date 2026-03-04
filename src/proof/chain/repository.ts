/**
 * Chain Anchor Repository
 *
 * Database operations for anchor batches, transactions, and configurations.
 * Provides CRUD operations with proper transaction handling.
 *
 * @packageDocumentation
 */

import { eq, and, lt, gt, gte, lte, asc, desc, sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createLogger } from '../../common/logger.js';
import {
  anchorBatches,
  anchorTransactions,
  proofAnchors,
  agentAnchorSubmissions,
  chainAnchorConfig,
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
  type AnchorBatchStatus,
  type AnchorTxStatus,
  type AgentAnchorStatus,
  type ChainNetwork,
} from './schema.js';

const logger = createLogger({ component: 'chain-anchor-repository' });

// =============================================================================
// TYPES
// =============================================================================

export type Database = PostgresJsDatabase<Record<string, never>>;

export interface CreateBatchInput {
  tenantId: string;
  chainId?: string;
  startPosition: number;
  targetChains: string[];
  expiresAt: Date;
  maxRetries?: number;
}

export interface CreateTransactionInput {
  batchId: string;
  tenantId: string;
  network: ChainNetwork;
  chainIdNumeric: number;
  fromAddress: string;
  toAddress: string;
  contractAddress?: string;
  merkleRoot: string;
  requiredConfirmations?: number;
}

export interface UpdateTransactionInput {
  txHash?: string;
  blockNumber?: number;
  blockHash?: string;
  blockTimestamp?: Date;
  status?: AnchorTxStatus;
  confirmations?: number;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  nonce?: number;
  inputData?: string;
  errorMessage?: string;
  errorCode?: string;
  txCostWei?: string;
  txCostUsd?: string;
  submittedAt?: Date;
  confirmedAt?: Date;
}

export interface CreateProofAnchorInput {
  proofId: string;
  batchId: string;
  tenantId: string;
  batchPosition: number;
  merkleLeaf?: string;
  merkleLeafIndex?: number;
}

export interface CreateAgentAnchorSubmissionInput {
  batchId: string;
  tenantId: string;
  agentId: string;
  requestPayload: Record<string, unknown>;
  expiresAt?: Date;
}

export interface BatchQueryOptions {
  tenantId: string;
  status?: AnchorBatchStatus | AnchorBatchStatus[];
  chainId?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'batchNumber';
  orderDirection?: 'asc' | 'desc';
}

// =============================================================================
// CHAIN ANCHOR REPOSITORY
// =============================================================================

/**
 * Repository for chain anchor database operations
 */
export class ChainAnchorRepository {
  constructor(private db: Database) {}

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  /**
   * Create a new anchor batch
   */
  async createBatch(input: CreateBatchInput): Promise<AnchorBatchRow> {
    // Get next batch number
    const lastBatch = await this.db
      .select({ batchNumber: anchorBatches.batchNumber })
      .from(anchorBatches)
      .where(
        and(
          eq(anchorBatches.tenantId, input.tenantId),
          eq(anchorBatches.chainId, input.chainId ?? 'default')
        )
      )
      .orderBy(desc(anchorBatches.batchNumber))
      .limit(1);

    const batchNumber = (lastBatch[0]?.batchNumber ?? 0) + 1;

    const newBatch: NewAnchorBatchRow = {
      tenantId: input.tenantId,
      batchNumber,
      chainId: input.chainId ?? 'default',
      status: 'collecting',
      startPosition: input.startPosition,
      targetChains: input.targetChains,
      maxRetries: input.maxRetries ?? 5,
      expiresAt: input.expiresAt,
    };

    const [result] = await this.db
      .insert(anchorBatches)
      .values(newBatch)
      .returning();

    logger.info(
      {
        batchId: result!.id,
        batchNumber: result!.batchNumber,
        tenantId: input.tenantId,
      },
      'Created anchor batch'
    );

    return result!;
  }

  /**
   * Get batch by ID
   */
  async getBatch(id: string, tenantId: string): Promise<AnchorBatchRow | null> {
    const [result] = await this.db
      .select()
      .from(anchorBatches)
      .where(and(eq(anchorBatches.id, id), eq(anchorBatches.tenantId, tenantId)))
      .limit(1);

    return result ?? null;
  }

  /**
   * Get current collecting batch or create new one
   */
  async getOrCreateCollectingBatch(
    tenantId: string,
    chainId: string,
    startPosition: number,
    targetChains: string[],
    expirationMs: number
  ): Promise<AnchorBatchRow> {
    // Try to find existing collecting batch
    const [existing] = await this.db
      .select()
      .from(anchorBatches)
      .where(
        and(
          eq(anchorBatches.tenantId, tenantId),
          eq(anchorBatches.chainId, chainId),
          eq(anchorBatches.status, 'collecting')
        )
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    // Create new batch
    return this.createBatch({
      tenantId,
      chainId,
      startPosition,
      targetChains,
      expiresAt: new Date(Date.now() + expirationMs),
    });
  }

  /**
   * Update batch status
   */
  async updateBatchStatus(
    id: string,
    tenantId: string,
    status: AnchorBatchStatus,
    additionalData?: Partial<AnchorBatchRow>
  ): Promise<AnchorBatchRow | null> {
    const updateData: Partial<AnchorBatchRow> = {
      status,
      updatedAt: new Date(),
      ...additionalData,
    };

    // Set timestamps based on status
    if (status === 'pending') {
      updateData.collectionEndedAt = new Date();
    } else if (status === 'submitting') {
      updateData.anchoringStartedAt = new Date();
    } else if (status === 'anchored') {
      updateData.anchoredAt = new Date();
    }

    const [result] = await this.db
      .update(anchorBatches)
      .set(updateData)
      .where(and(eq(anchorBatches.id, id), eq(anchorBatches.tenantId, tenantId)))
      .returning();

    if (result) {
      logger.info({ batchId: id, status }, 'Updated batch status');
    }

    return result ?? null;
  }

  /**
   * Update batch with Merkle tree data
   */
  async updateBatchMerkleData(
    id: string,
    tenantId: string,
    merkleRoot: string,
    merkleTreeDepth: number,
    merkleTreeData: {
      leaves: string[];
      layers: string[][];
      proofs: Record<string, string[]>;
    },
    batchHash: string,
    endPosition: number,
    proofCount: number
  ): Promise<AnchorBatchRow | null> {
    const [result] = await this.db
      .update(anchorBatches)
      .set({
        merkleRoot,
        merkleTreeDepth,
        merkleTreeData,
        batchHash,
        endPosition,
        proofCount,
        updatedAt: new Date(),
      })
      .where(and(eq(anchorBatches.id, id), eq(anchorBatches.tenantId, tenantId)))
      .returning();

    return result ?? null;
  }

  /**
   * Record batch error
   */
  async recordBatchError(
    id: string,
    tenantId: string,
    error: string
  ): Promise<AnchorBatchRow | null> {
    const [result] = await this.db
      .update(anchorBatches)
      .set({
        lastError: error,
        lastErrorAt: new Date(),
        retryCount: sql`${anchorBatches.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(anchorBatches.id, id), eq(anchorBatches.tenantId, tenantId)))
      .returning();

    return result ?? null;
  }

  /**
   * Query batches
   */
  async queryBatches(options: BatchQueryOptions): Promise<AnchorBatchRow[]> {
    const conditions = [eq(anchorBatches.tenantId, options.tenantId)];

    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(anchorBatches.status, options.status));
      } else {
        conditions.push(eq(anchorBatches.status, options.status));
      }
    }

    if (options.chainId) {
      conditions.push(eq(anchorBatches.chainId, options.chainId));
    }

    const orderColumn =
      options.orderBy === 'batchNumber'
        ? anchorBatches.batchNumber
        : anchorBatches.createdAt;

    const orderFn = options.orderDirection === 'asc' ? asc : desc;

    return this.db
      .select()
      .from(anchorBatches)
      .where(and(...conditions))
      .orderBy(orderFn(orderColumn))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
  }

  /**
   * Get batches pending anchoring
   */
  async getPendingBatches(limit: number = 10): Promise<AnchorBatchRow[]> {
    return this.db
      .select()
      .from(anchorBatches)
      .where(
        and(
          eq(anchorBatches.status, 'pending'),
          gt(anchorBatches.expiresAt, new Date())
        )
      )
      .orderBy(asc(anchorBatches.createdAt))
      .limit(limit);
  }

  /**
   * Get batches needing retry
   */
  async getRetryableBatches(limit: number = 10): Promise<AnchorBatchRow[]> {
    return this.db
      .select()
      .from(anchorBatches)
      .where(
        and(
          inArray(anchorBatches.status, ['failed', 'submitting']),
          lt(anchorBatches.retryCount, anchorBatches.maxRetries),
          gt(anchorBatches.expiresAt, new Date())
        )
      )
      .orderBy(asc(anchorBatches.lastErrorAt))
      .limit(limit);
  }

  /**
   * Expire old batches
   */
  async expireBatches(): Promise<number> {
    const result = await this.db
      .update(anchorBatches)
      .set({
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(anchorBatches.status, ['collecting', 'pending', 'submitting']),
          lt(anchorBatches.expiresAt, new Date())
        )
      )
      .returning({ id: anchorBatches.id });

    if (result.length > 0) {
      logger.info({ count: result.length }, 'Expired anchor batches');
    }

    return result.length;
  }

  // ===========================================================================
  // TRANSACTION OPERATIONS
  // ===========================================================================

  /**
   * Create anchor transaction
   */
  async createTransaction(input: CreateTransactionInput): Promise<AnchorTransactionRow> {
    const newTx: NewAnchorTransactionRow = {
      batchId: input.batchId,
      tenantId: input.tenantId,
      network: input.network,
      chainIdNumeric: input.chainIdNumeric,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      contractAddress: input.contractAddress,
      merkleRoot: input.merkleRoot,
      requiredConfirmations: input.requiredConfirmations ?? 12,
      status: 'pending',
    };

    const [result] = await this.db
      .insert(anchorTransactions)
      .values(newTx)
      .returning();

    logger.info(
      {
        txId: result!.id,
        batchId: input.batchId,
        network: input.network,
      },
      'Created anchor transaction'
    );

    return result!;
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(
    id: string,
    tenantId: string
  ): Promise<AnchorTransactionRow | null> {
    const [result] = await this.db
      .select()
      .from(anchorTransactions)
      .where(
        and(
          eq(anchorTransactions.id, id),
          eq(anchorTransactions.tenantId, tenantId)
        )
      )
      .limit(1);

    return result ?? null;
  }

  /**
   * Get transaction by hash
   */
  async getTransactionByHash(txHash: string): Promise<AnchorTransactionRow | null> {
    const [result] = await this.db
      .select()
      .from(anchorTransactions)
      .where(eq(anchorTransactions.txHash, txHash))
      .limit(1);

    return result ?? null;
  }

  /**
   * Update transaction
   */
  async updateTransaction(
    id: string,
    tenantId: string,
    input: UpdateTransactionInput
  ): Promise<AnchorTransactionRow | null> {
    const [result] = await this.db
      .update(anchorTransactions)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(anchorTransactions.id, id),
          eq(anchorTransactions.tenantId, tenantId)
        )
      )
      .returning();

    return result ?? null;
  }

  /**
   * Get transactions for batch
   */
  async getBatchTransactions(batchId: string): Promise<AnchorTransactionRow[]> {
    return this.db
      .select()
      .from(anchorTransactions)
      .where(eq(anchorTransactions.batchId, batchId))
      .orderBy(desc(anchorTransactions.createdAt));
  }

  /**
   * Get pending transactions needing confirmation check
   */
  async getPendingConfirmations(limit: number = 50): Promise<AnchorTransactionRow[]> {
    return this.db
      .select()
      .from(anchorTransactions)
      .where(
        and(
          inArray(anchorTransactions.status, ['submitted', 'confirming']),
          sql`${anchorTransactions.txHash} IS NOT NULL`
        )
      )
      .orderBy(asc(anchorTransactions.submittedAt))
      .limit(limit);
  }

  // ===========================================================================
  // PROOF ANCHOR OPERATIONS
  // ===========================================================================

  /**
   * Create proof anchors in batch
   */
  async createProofAnchors(
    inputs: CreateProofAnchorInput[]
  ): Promise<ProofAnchorRow[]> {
    if (inputs.length === 0) return [];

    const values: NewProofAnchorRow[] = inputs.map((input) => ({
      proofId: input.proofId,
      batchId: input.batchId,
      tenantId: input.tenantId,
      batchPosition: input.batchPosition,
      merkleLeaf: input.merkleLeaf,
      merkleLeafIndex: input.merkleLeafIndex,
    }));

    const results = await this.db
      .insert(proofAnchors)
      .values(values)
      .returning();

    logger.info(
      { count: results.length, batchId: inputs[0]?.batchId },
      'Created proof anchors'
    );

    return results;
  }

  /**
   * Get proof anchor by proof ID
   */
  async getProofAnchor(proofId: string): Promise<ProofAnchorRow | null> {
    const [result] = await this.db
      .select()
      .from(proofAnchors)
      .where(eq(proofAnchors.proofId, proofId))
      .limit(1);

    return result ?? null;
  }

  /**
   * Update proof anchor with Merkle proof
   */
  async updateProofAnchorMerkleProof(
    proofId: string,
    merkleProof: string[],
    merkleLeaf: string,
    merkleLeafIndex: number
  ): Promise<ProofAnchorRow | null> {
    const [result] = await this.db
      .update(proofAnchors)
      .set({
        merkleProof,
        merkleLeaf,
        merkleLeafIndex,
      })
      .where(eq(proofAnchors.proofId, proofId))
      .returning();

    return result ?? null;
  }

  /**
   * Mark proof as verified
   */
  async markProofVerified(proofId: string): Promise<ProofAnchorRow | null> {
    const [result] = await this.db
      .update(proofAnchors)
      .set({
        verified: true,
        verifiedAt: new Date(),
      })
      .where(eq(proofAnchors.proofId, proofId))
      .returning();

    return result ?? null;
  }

  /**
   * Get proof anchors for batch
   */
  async getBatchProofAnchors(batchId: string): Promise<ProofAnchorRow[]> {
    return this.db
      .select()
      .from(proofAnchors)
      .where(eq(proofAnchors.batchId, batchId))
      .orderBy(asc(proofAnchors.batchPosition));
  }

  // ===========================================================================
  // AGENT ANCHOR SUBMISSION OPERATIONS
  // ===========================================================================

  /**
   * Create AgentAnchor submission
   */
  async createAgentAnchorSubmission(
    input: CreateAgentAnchorSubmissionInput
  ): Promise<AgentAnchorSubmissionRow> {
    const newSubmission: NewAgentAnchorSubmissionRow = {
      batchId: input.batchId,
      tenantId: input.tenantId,
      agentId: input.agentId,
      requestPayload: input.requestPayload,
      expiresAt: input.expiresAt,
      status: 'pending',
    };

    const [result] = await this.db
      .insert(agentAnchorSubmissions)
      .values(newSubmission)
      .returning();

    return result!;
  }

  /**
   * Update AgentAnchor submission
   */
  async updateAgentAnchorSubmission(
    id: string,
    tenantId: string,
    update: Partial<AgentAnchorSubmissionRow>
  ): Promise<AgentAnchorSubmissionRow | null> {
    const [result] = await this.db
      .update(agentAnchorSubmissions)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentAnchorSubmissions.id, id),
          eq(agentAnchorSubmissions.tenantId, tenantId)
        )
      )
      .returning();

    return result ?? null;
  }

  /**
   * Get submission for batch
   */
  async getBatchSubmission(batchId: string): Promise<AgentAnchorSubmissionRow | null> {
    const [result] = await this.db
      .select()
      .from(agentAnchorSubmissions)
      .where(eq(agentAnchorSubmissions.batchId, batchId))
      .orderBy(desc(agentAnchorSubmissions.createdAt))
      .limit(1);

    return result ?? null;
  }

  // ===========================================================================
  // CONFIG OPERATIONS
  // ===========================================================================

  /**
   * Get or create tenant config
   */
  async getOrCreateConfig(tenantId: string): Promise<ChainAnchorConfigRow> {
    const [existing] = await this.db
      .select()
      .from(chainAnchorConfig)
      .where(eq(chainAnchorConfig.tenantId, tenantId))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await this.db
      .insert(chainAnchorConfig)
      .values({ tenantId })
      .returning();

    logger.info({ tenantId }, 'Created default chain anchor config');

    return created!;
  }

  /**
   * Update config
   */
  async updateConfig(
    tenantId: string,
    update: Partial<ChainAnchorConfigRow>
  ): Promise<ChainAnchorConfigRow | null> {
    const [result] = await this.db
      .update(chainAnchorConfig)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(eq(chainAnchorConfig.tenantId, tenantId))
      .returning();

    return result ?? null;
  }

  /**
   * Get all enabled configs
   */
  async getEnabledConfigs(): Promise<ChainAnchorConfigRow[]> {
    return this.db
      .select()
      .from(chainAnchorConfig)
      .where(eq(chainAnchorConfig.enabled, true));
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get anchoring statistics for tenant
   */
  async getStats(tenantId: string): Promise<{
    totalBatches: number;
    anchoredBatches: number;
    failedBatches: number;
    pendingBatches: number;
    totalProofsAnchored: number;
    totalTransactions: number;
    confirmedTransactions: number;
  }> {
    const batchStats = await this.db
      .select({
        status: anchorBatches.status,
        count: sql<number>`count(*)::int`,
        proofCount: sql<number>`sum(${anchorBatches.proofCount})::int`,
      })
      .from(anchorBatches)
      .where(eq(anchorBatches.tenantId, tenantId))
      .groupBy(anchorBatches.status);

    const txStats = await this.db
      .select({
        status: anchorTransactions.status,
        count: sql<number>`count(*)::int`,
      })
      .from(anchorTransactions)
      .where(eq(anchorTransactions.tenantId, tenantId))
      .groupBy(anchorTransactions.status);

    const statusMap = new Map(batchStats.map((s) => [s.status, s]));
    const txStatusMap = new Map(txStats.map((s) => [s.status, s]));

    return {
      totalBatches: batchStats.reduce((sum, s) => sum + s.count, 0),
      anchoredBatches: statusMap.get('anchored')?.count ?? 0,
      failedBatches: statusMap.get('failed')?.count ?? 0,
      pendingBatches:
        (statusMap.get('collecting')?.count ?? 0) +
        (statusMap.get('pending')?.count ?? 0) +
        (statusMap.get('submitting')?.count ?? 0),
      totalProofsAnchored: statusMap.get('anchored')?.proofCount ?? 0,
      totalTransactions: txStats.reduce((sum, s) => sum + s.count, 0),
      confirmedTransactions: txStatusMap.get('confirmed')?.count ?? 0,
    };
  }
}

/**
 * Create chain anchor repository
 */
export function createChainAnchorRepository(db: Database): ChainAnchorRepository {
  return new ChainAnchorRepository(db);
}
