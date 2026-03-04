/**
 * Merkle Service
 *
 * Manages Merkle tree aggregation of proofs, including:
 * - Batching proofs by time window
 * - Storing Merkle roots in database
 * - Providing Merkle proofs for historical lookups
 * - Scheduled aggregation jobs
 *
 * @packageDocumentation
 */

import { eq, and, lte, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import { createLogger } from '../common/logger.js';
import { getDatabase, type Database } from '../common/db.js';
import {
  merkleRoots,
  merkleLeaves,
  merkleQueue,
  type MerkleRoot,
  type MerkleLeaf,
} from '../db/schema/merkle.js';
import {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  hashProofToLeaf,
  type MerkleProof,
  type MerkleTreeResult,
} from './merkle.js';
import type { ID } from '../common/types.js';

const logger = createLogger({ component: 'merkle-service' });

/**
 * Default aggregation window in milliseconds (1 hour)
 */
const DEFAULT_AGGREGATION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Minimum number of proofs required for aggregation
 */
const MIN_PROOFS_FOR_AGGREGATION = 1;

/**
 * Maximum number of proofs per tree (to limit memory usage)
 */
const MAX_PROOFS_PER_TREE = 10000;

/**
 * Configuration for MerkleService
 */
export interface MerkleServiceConfig {
  /** Aggregation window in milliseconds (default: 1 hour) */
  aggregationWindowMs?: number;
  /** Minimum proofs required for aggregation (default: 1) */
  minProofsForAggregation?: number;
  /** Maximum proofs per tree (default: 10000) */
  maxProofsPerTree?: number;
}

/**
 * Result of adding a proof to the aggregation queue
 */
export interface QueueResult {
  queued: boolean;
  queueId: string;
  proofId: string;
}

/**
 * Result of an aggregation run
 */
export interface AggregationResult {
  success: boolean;
  rootId?: string;
  rootHash?: string;
  leafCount?: number;
  error?: string;
}

/**
 * Merkle root with additional metadata
 */
export interface MerkleRootInfo extends MerkleRoot {
  /** Whether this root has been anchored to a blockchain */
  anchored: boolean;
}

/**
 * Full Merkle proof response with proof details
 */
export interface MerkleProofResponse {
  found: boolean;
  proofId: string;
  merkleProof?: MerkleProof;
  rootId?: string;
  rootHash?: string;
  anchorTx?: string | null;
  anchorChain?: string | null;
  anchoredAt?: string | null;
  createdAt?: string;
}

/**
 * Service for managing Merkle tree aggregation of proofs
 */
export class MerkleService {
  private db: Database | null = null;
  private config: Required<MerkleServiceConfig>;
  private initialized: boolean = false;
  private aggregationTimer: NodeJS.Timeout | null = null;

  constructor(config: MerkleServiceConfig = {}) {
    this.config = {
      aggregationWindowMs: config.aggregationWindowMs ?? DEFAULT_AGGREGATION_WINDOW_MS,
      minProofsForAggregation: config.minProofsForAggregation ?? MIN_PROOFS_FOR_AGGREGATION,
      maxProofsPerTree: config.maxProofsPerTree ?? MAX_PROOFS_PER_TREE,
    };
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = getDatabase();
    this.initialized = true;

    logger.info(
      {
        aggregationWindowMs: this.config.aggregationWindowMs,
        minProofsForAggregation: this.config.minProofsForAggregation,
      },
      'MerkleService initialized'
    );
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<Database> {
    if (!this.initialized || !this.db) {
      await this.initialize();
    }
    return this.db!;
  }

  /**
   * Queue a proof for Merkle aggregation
   *
   * @param proofId - The proof ID
   * @param proofHash - The proof's hash
   * @returns Queue result
   */
  async queueProof(proofId: string, proofHash: string): Promise<QueueResult> {
    const db = await this.ensureInitialized();

    const queueId = crypto.randomUUID();

    await db.insert(merkleQueue).values({
      id: queueId,
      proofId,
      proofHash,
      aggregated: false,
    });

    logger.debug({ proofId, queueId }, 'Proof queued for Merkle aggregation');

    return {
      queued: true,
      queueId,
      proofId,
    };
  }

  /**
   * Get pending proofs from the queue
   *
   * @param limit - Maximum number of proofs to fetch
   * @param olderThan - Only fetch proofs older than this date
   * @returns Array of pending proofs
   */
  async getPendingProofs(
    limit: number = this.config.maxProofsPerTree,
    olderThan?: Date
  ): Promise<Array<{ id: string; proofId: string; proofHash: string; queuedAt: Date }>> {
    const db = await this.ensureInitialized();

    const conditions = [eq(merkleQueue.aggregated, false)];

    if (olderThan) {
      conditions.push(lte(merkleQueue.queuedAt, olderThan));
    }

    const results = await db
      .select({
        id: merkleQueue.id,
        proofId: merkleQueue.proofId,
        proofHash: merkleQueue.proofHash,
        queuedAt: merkleQueue.queuedAt,
      })
      .from(merkleQueue)
      .where(and(...conditions))
      .orderBy(asc(merkleQueue.queuedAt))
      .limit(limit);

    return results;
  }

  /**
   * Aggregate pending proofs into a Merkle tree
   *
   * @returns Aggregation result
   */
  async aggregatePendingProofs(): Promise<AggregationResult> {
    const db = await this.ensureInitialized();

    // Calculate the cutoff time for the aggregation window
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - this.config.aggregationWindowMs);

    // Get pending proofs within the time window
    const pendingProofs = await this.getPendingProofs(
      this.config.maxProofsPerTree,
      windowEnd
    );

    if (pendingProofs.length < this.config.minProofsForAggregation) {
      logger.debug(
        { pendingCount: pendingProofs.length, required: this.config.minProofsForAggregation },
        'Not enough pending proofs for aggregation'
      );
      return { success: false, error: 'Not enough pending proofs' };
    }

    try {
      // Build the Merkle tree
      const proofData = pendingProofs.map((p) => ({
        id: p.proofId,
        hash: p.proofHash,
      }));

      const tree = await buildMerkleTree(
        await Promise.all(proofData.map((p) => hashProofToLeaf(p.id, p.hash)))
      );

      // Generate proofs for all leaves
      const leafProofs = [];
      for (let i = 0; i < pendingProofs.length; i++) {
        leafProofs.push(generateMerkleProof(i, tree));
      }

      // Store the Merkle root
      const rootId = crypto.randomUUID();

      await db.insert(merkleRoots).values({
        id: rootId,
        rootHash: tree.root,
        leafCount: tree.leafCount,
        windowStart,
        windowEnd,
        treeLevels: tree.levels,
      });

      // Store leaf records and update queue
      const now = new Date();
      for (let i = 0; i < pendingProofs.length; i++) {
        const pending = pendingProofs[i]!;
        const proof = leafProofs[i]!;

        // Insert leaf record
        await db.insert(merkleLeaves).values({
          proofId: pending.proofId,
          rootId,
          leafIndex: proof.leafIndex,
          leafHash: proof.leafHash,
          siblingHashes: proof.siblingHashes,
          siblingDirections: proof.siblingDirections,
        });

        // Update queue item as aggregated
        await db
          .update(merkleQueue)
          .set({
            aggregated: true,
            rootId,
            aggregatedAt: now,
          })
          .where(eq(merkleQueue.id, pending.id));
      }

      logger.info(
        {
          rootId,
          rootHash: tree.root.slice(0, 16) + '...',
          leafCount: tree.leafCount,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        },
        'Merkle aggregation completed'
      );

      return {
        success: true,
        rootId,
        rootHash: tree.root,
        leafCount: tree.leafCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Merkle aggregation failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get Merkle proof for a specific proof
   *
   * @param proofId - The proof ID to get Merkle proof for
   * @returns Merkle proof response
   */
  async getMerkleProof(proofId: ID): Promise<MerkleProofResponse> {
    const db = await this.ensureInitialized();

    // Find the leaf record
    const leafResult = await db
      .select()
      .from(merkleLeaves)
      .where(eq(merkleLeaves.proofId, proofId))
      .limit(1);

    if (leafResult.length === 0) {
      // Check if proof is pending
      const pendingResult = await db
        .select()
        .from(merkleQueue)
        .where(and(eq(merkleQueue.proofId, proofId), eq(merkleQueue.aggregated, false)))
        .limit(1);

      if (pendingResult.length > 0) {
        logger.debug({ proofId }, 'Proof is pending Merkle aggregation');
        return { found: false, proofId };
      }

      return { found: false, proofId };
    }

    const leaf = leafResult[0]!;

    // Get the root record
    const rootResult = await db
      .select()
      .from(merkleRoots)
      .where(eq(merkleRoots.id, leaf.rootId))
      .limit(1);

    if (rootResult.length === 0) {
      logger.warn({ proofId, rootId: leaf.rootId }, 'Merkle root not found for leaf');
      return { found: false, proofId };
    }

    const root = rootResult[0]!;

    // Reconstruct the Merkle proof
    const merkleProof: MerkleProof = {
      leafIndex: leaf.leafIndex,
      leafHash: leaf.leafHash,
      siblingHashes: leaf.siblingHashes,
      siblingDirections: leaf.siblingDirections,
      root: root.rootHash,
      leafCount: root.leafCount,
    };

    return {
      found: true,
      proofId,
      merkleProof,
      rootId: root.id,
      rootHash: root.rootHash,
      anchorTx: root.anchorTx,
      anchorChain: root.anchorChain,
      anchoredAt: root.anchoredAt?.toISOString() ?? null,
      createdAt: root.createdAt.toISOString(),
    };
  }

  /**
   * Verify a Merkle proof for a specific proof
   *
   * @param proofId - The proof ID
   * @param proofHash - The proof's hash
   * @param expectedRoot - Optional expected root hash
   * @returns True if the proof is valid and included in the tree
   */
  async verifyMerkleProof(
    proofId: string,
    proofHash: string,
    expectedRoot?: string
  ): Promise<{ valid: boolean; error?: string }> {
    const proofResponse = await this.getMerkleProof(proofId);

    if (!proofResponse.found || !proofResponse.merkleProof) {
      return { valid: false, error: 'Merkle proof not found' };
    }

    // Verify the leaf hash matches
    const expectedLeafHash = await hashProofToLeaf(proofId, proofHash);
    if (proofResponse.merkleProof.leafHash !== expectedLeafHash) {
      return { valid: false, error: 'Leaf hash mismatch' };
    }

    // Verify the Merkle proof
    const targetRoot = expectedRoot ?? proofResponse.merkleProof.root;
    const valid = await verifyMerkleProof(proofResponse.merkleProof, targetRoot);

    return { valid };
  }

  /**
   * Get list of recent Merkle roots
   *
   * @param limit - Maximum number of roots to return
   * @param includeUnanchored - Whether to include unanchored roots
   * @returns Array of Merkle root info
   */
  async listRoots(
    limit: number = 100,
    includeUnanchored: boolean = true
  ): Promise<MerkleRootInfo[]> {
    const db = await this.ensureInitialized();

    let results;

    if (includeUnanchored) {
      results = await db
        .select()
        .from(merkleRoots)
        .orderBy(desc(merkleRoots.createdAt))
        .limit(limit);
    } else {
      results = await db
        .select()
        .from(merkleRoots)
        .where(isNotNull(merkleRoots.anchorTx))
        .orderBy(desc(merkleRoots.createdAt))
        .limit(limit);
    }

    return results.map((root) => ({
      ...root,
      anchored: root.anchorTx !== null,
    }));
  }

  /**
   * Get a specific Merkle root by ID
   *
   * @param rootId - The root ID
   * @returns The Merkle root info or undefined
   */
  async getRoot(rootId: string): Promise<MerkleRootInfo | undefined> {
    const db = await this.ensureInitialized();

    const result = await db
      .select()
      .from(merkleRoots)
      .where(eq(merkleRoots.id, rootId))
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const root = result[0]!;
    return {
      ...root,
      anchored: root.anchorTx !== null,
    };
  }

  /**
   * Get a Merkle root by its hash
   *
   * @param rootHash - The root hash
   * @returns The Merkle root info or undefined
   */
  async getRootByHash(rootHash: string): Promise<MerkleRootInfo | undefined> {
    const db = await this.ensureInitialized();

    const result = await db
      .select()
      .from(merkleRoots)
      .where(eq(merkleRoots.rootHash, rootHash))
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const root = result[0]!;
    return {
      ...root,
      anchored: root.anchorTx !== null,
    };
  }

  /**
   * Set anchor information for a Merkle root
   *
   * @param rootId - The root ID
   * @param anchorTx - The anchor transaction hash
   * @param anchorChain - The anchor chain (e.g., 'ethereum')
   * @returns True if the anchor was set
   */
  async setAnchor(
    rootId: string,
    anchorTx: string,
    anchorChain: string
  ): Promise<boolean> {
    const db = await this.ensureInitialized();

    const result = await db
      .update(merkleRoots)
      .set({
        anchorTx,
        anchorChain,
        anchoredAt: new Date(),
      })
      .where(eq(merkleRoots.id, rootId))
      .returning({ id: merkleRoots.id });

    if (result.length === 0) {
      return false;
    }

    logger.info(
      { rootId, anchorTx, anchorChain },
      'Merkle root anchored to blockchain'
    );

    return true;
  }

  /**
   * Get unanchored roots for blockchain anchoring
   *
   * @param limit - Maximum number of roots to return
   * @returns Array of unanchored Merkle roots
   */
  async getUnanchoredRoots(limit: number = 100): Promise<MerkleRoot[]> {
    const db = await this.ensureInitialized();

    const results = await db
      .select()
      .from(merkleRoots)
      .where(isNull(merkleRoots.anchorTx))
      .orderBy(asc(merkleRoots.createdAt))
      .limit(limit);

    return results;
  }

  /**
   * Start the scheduled aggregation job
   *
   * @param intervalMs - Interval between aggregation runs (default: aggregation window)
   */
  startAggregationJob(intervalMs?: number): void {
    if (this.aggregationTimer) {
      logger.warn('Aggregation job already running');
      return;
    }

    const interval = intervalMs ?? this.config.aggregationWindowMs;

    this.aggregationTimer = setInterval(async () => {
      try {
        await this.aggregatePendingProofs();
      } catch (error) {
        logger.error({ error }, 'Scheduled aggregation failed');
      }
    }, interval);

    logger.info({ intervalMs: interval }, 'Merkle aggregation job started');
  }

  /**
   * Stop the scheduled aggregation job
   */
  stopAggregationJob(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
      logger.info('Merkle aggregation job stopped');
    }
  }

  /**
   * Get aggregation statistics
   */
  async getStats(): Promise<{
    totalRoots: number;
    totalLeaves: number;
    pendingProofs: number;
    anchoredRoots: number;
  }> {
    const db = await this.ensureInitialized();

    const [rootsResult, leavesResult, pendingResult, anchoredResult] = await Promise.all([
      db.select().from(merkleRoots),
      db.select().from(merkleLeaves),
      db.select().from(merkleQueue).where(eq(merkleQueue.aggregated, false)),
      db.select().from(merkleRoots).where(isNotNull(merkleRoots.anchorTx)),
    ]);

    return {
      totalRoots: rootsResult.length,
      totalLeaves: leavesResult.length,
      pendingProofs: pendingResult.length,
      anchoredRoots: anchoredResult.length,
    };
  }
}

/**
 * Create a new MerkleService instance
 */
export function createMerkleService(config?: MerkleServiceConfig): MerkleService {
  return new MerkleService(config);
}

// Singleton instance for convenience
let merkleServiceInstance: MerkleService | null = null;

/**
 * Get the singleton MerkleService instance
 */
export function getMerkleService(): MerkleService {
  if (!merkleServiceInstance) {
    merkleServiceInstance = new MerkleService();
  }
  return merkleServiceInstance;
}
