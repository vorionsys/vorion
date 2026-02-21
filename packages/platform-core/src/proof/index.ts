/**
 * PROOF - Immutable Evidence System
 *
 * Creates and maintains cryptographically sealed records of all governance decisions.
 * Uses Ed25519 (or ECDSA P-256 fallback) for cryptographic signatures.
 * Persists to PostgreSQL for durability with optional blockchain anchoring.
 *
 * CRITICAL: Uses distributed locking (Redis) and database row locking (SELECT FOR UPDATE)
 * to prevent hash chain corruption in multi-instance deployments.
 *
 * @packageDocumentation
 */

import { eq, and, gte, lte, asc, desc, sql } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { createLogger } from '../common/logger.js';
import { sign, verify } from '../common/crypto.js';
import { getDatabase, type Database } from '../common/db.js';
import { getPool } from '../common/db.js';
import { getLockService, type LockService } from '../common/lock.js';
import { proofs, proofChainMeta, type NewProof } from '@vorionsys/contracts/db';
import type { Proof, Decision, Intent, ID } from '../common/types.js';
import { canonicalize } from '../common/canonical-json.js';
import {
  type ChainAnchorConfig as BaseChainAnchorConfig,
  ChainAnchorService,
  createChainAnchorService,
  ChainAnchorScheduler,
  createChainAnchorScheduler,
} from './chain/index.js';

/**
 * Extended chain anchor config for ProofService
 * Adds autoAnchor scheduling and convenience aliases for batch options.
 */
interface ChainAnchorConfig extends BaseChainAnchorConfig {
  autoAnchor?: boolean;
  batchSize?: number;
  batchTimeoutMs?: number;
}

const logger = createLogger({ component: 'proof' });
const tracer = trace.getTracer('proof-service');

/**
 * Proof creation request
 */
export interface ProofRequest {
  intent: Intent;
  decision: Decision;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** Tenant ID for scoped locking (REQUIRED for multi-tenant isolation) */
  tenantId: string;
}

/**
 * Proof verification result
 */
export interface VerificationResult {
  valid: boolean;
  proofId: ID;
  chainPosition: number;
  issues: string[];
  verifiedAt: string;
}

/**
 * Proof query options
 */
export interface ProofQuery {
  entityId?: ID;
  intentId?: ID;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Extended proof with signature metadata
 */
export interface SignedProof extends Proof {
  signatureData?: {
    publicKey: string;
    algorithm: string;
    signedAt: string;
  };
}

/**
 * Chain statistics
 */
export interface ChainStats {
  totalProofs: number;
  chainLength: number;
  lastProofAt: string | null;
}

/**
 * Chain verification options for paginated verification
 */
export interface ChainVerificationOptions {
  /** Number of proofs to verify per batch (default: 100) */
  batchSize?: number;
  /** Callback for progress updates */
  onProgress?: (verified: number, total: number) => void;
}

/**
 * Chain verification result with streaming support
 */
export interface ChainVerificationResult {
  valid: boolean;
  lastValidPosition: number;
  issues: string[];
  totalVerified: number;
}

/**
 * Generate per-tenant lock key for proof chain operations
 *
 * SECURITY FIX: Using per-tenant locks prevents cross-tenant DoS attacks
 * where one tenant's heavy proof creation could block other tenants.
 *
 * @param tenantId - The tenant ID for scoped locking
 * @returns Tenant-scoped lock key
 */
function getProofChainLockKey(tenantId: string): string {
  return `proof:chain:${tenantId}:create`;
}

/**
 * Legacy lock key for proof chain operations
 * @deprecated Use getProofChainLockKey(tenantId) instead
 */
const PROOF_CHAIN_LOCK_KEY = 'proof:chain:create';

/**
 * Default genesis hash for empty chain
 */
const GENESIS_HASH = '0'.repeat(64);

/**
 * Lock options for proof creation
 */
const PROOF_LOCK_OPTIONS = {
  lockTimeoutMs: 30000, // 30 seconds max lock hold time
  acquireTimeoutMs: 10000, // 10 seconds to acquire lock
};

/**
 * PROOF service for evidence management with PostgreSQL persistence
 *
 * CRITICAL FIX (PA-C1/PA-C2/DS-C1): This service now uses:
 * 1. Redis distributed locks to serialize proof creation across instances
 * 2. PostgreSQL row-level locking (SELECT FOR UPDATE) for chain state
 * 3. All state updates happen inside the transaction
 *
 * This prevents hash chain corruption in multi-instance deployments.
 */
export class ProofService {
  private db: Database | null = null;
  private lockService: LockService | null = null;
  private chainId: string = 'default';
  private initialized: boolean = false;
  private chainAnchorService: ChainAnchorService | null = null;
  private chainAnchorScheduler: ChainAnchorScheduler | null = null;
  private chainAnchorConfig: ChainAnchorConfig = {
    enabled: false,
    autoAnchor: false,
  };

  /**
   * Initialize the service - ensures database and lock service are ready
   *
   * NOTE: Chain state (lastHash, chainLength) is NO LONGER cached in memory.
   * It is always read from the database inside a transaction to prevent
   * race conditions in multi-instance deployments.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = getDatabase();
    this.lockService = getLockService();

    // Ensure chain metadata exists (using upsert pattern)
    const meta = await this.db
      .select()
      .from(proofChainMeta)
      .where(eq(proofChainMeta.chainId, this.chainId))
      .limit(1);

    if (meta.length === 0) {
      // Create initial chain metadata
      await this.db.insert(proofChainMeta).values({
        chainId: this.chainId,
        lastHash: GENESIS_HASH,
        chainLength: 0,
      });
      logger.info('New proof chain initialized');
    } else {
      logger.info(
        { chainLength: meta[0]!.chainLength, lastHash: meta[0]!.lastHash.slice(0, 16) + '...' },
        'Proof chain metadata verified'
      );
    }

    this.initialized = true;
  }

  /**
   * Enable blockchain anchoring for proofs
   */
  enableChainAnchoring(config: ChainAnchorConfig): void {
    if (!this.initialized || !this.db) {
      throw new Error('ProofService must be initialized before enabling chain anchoring');
    }

    this.chainAnchorConfig = config;

    if (config.enabled) {
      // Create chain anchor service
      this.chainAnchorService = createChainAnchorService({
        defaultBatchSize: config.batchSize ?? 1000,
        defaultBatchTimeoutMs: config.batchTimeoutMs ?? 300000,
        enableAgentAnchor: true,
      });
      this.chainAnchorService.initialize(this.db);

      // Create and start scheduler if auto-anchor is enabled
      if (config.autoAnchor) {
        this.chainAnchorScheduler = createChainAnchorScheduler(this.chainAnchorService);
        this.chainAnchorScheduler.initialize(this.db);
        this.chainAnchorScheduler.start();
      }

      logger.info(
        { autoAnchor: config.autoAnchor, batchSize: config.batchSize },
        'Chain anchoring enabled'
      );
    }
  }

  /**
   * Get chain anchor service (for direct access)
   */
  getChainAnchorService(): ChainAnchorService | null {
    return this.chainAnchorService;
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
   * Create a new proof record with cryptographic signature
   *
   * CRITICAL FIX (PA-C1/PA-C2/DS-C1): This method now uses:
   * 1. Redis distributed lock to serialize across multiple service instances
   * 2. PostgreSQL SELECT FOR UPDATE to lock the chain metadata row
   * 3. All state reads and writes happen inside the transaction
   *
   * SECURITY FIX: Uses per-tenant lock keys to prevent cross-tenant DoS attacks.
   * Each tenant has their own lock scope, so heavy proof creation by one tenant
   * cannot block proof creation for other tenants.
   *
   * This ensures hash chain integrity in multi-instance deployments.
   */
  async create(request: ProofRequest): Promise<SignedProof> {
    await this.ensureInitialized();

    if (!this.lockService) {
      throw new Error('Lock service not initialized');
    }

    // Validate tenantId is provided
    if (!request.tenantId) {
      throw new Error('tenantId is required for proof creation (security: prevents cross-tenant DoS)');
    }

    // SECURITY: Use per-tenant lock key to prevent cross-tenant DoS
    const lockKey = getProofChainLockKey(request.tenantId);

    logger.debug(
      { tenantId: request.tenantId, lockKey },
      'Acquiring per-tenant proof chain lock'
    );

    // Step 1: Acquire distributed lock to serialize proof creation across instances
    const lockResult = await this.lockService.acquire(
      lockKey,
      PROOF_LOCK_OPTIONS
    );

    if (!lockResult.acquired || !lockResult.lock) {
      logger.error(
        { error: lockResult.error, tenantId: request.tenantId, lockKey },
        'Failed to acquire distributed lock for proof creation'
      );
      throw new Error(`Failed to acquire proof chain lock: ${lockResult.error}`);
    }

    try {
      // Step 2: Execute proof creation with database row locking
      return await this.createProofWithLock(request);
    } finally {
      // Step 3: Always release the distributed lock
      await lockResult.lock.release();
    }
  }

  /**
   * Internal method to create proof with database row locking
   * Called only after distributed lock is acquired
   */
  private async createProofWithLock(request: ProofRequest): Promise<SignedProof> {
    const pool = getPool();
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    const proofId = crypto.randomUUID();
    const createdAt = new Date();

    // Use raw SQL for the transaction to support SELECT FOR UPDATE
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Step 1: Lock and read chain metadata with SELECT FOR UPDATE
      // This prevents concurrent modifications within the same database
      const metaResult = await client.query(
        `SELECT chain_id, last_hash, chain_length
         FROM proof_chain_meta
         WHERE chain_id = $1
         FOR UPDATE`,
        [this.chainId]
      );

      if (metaResult.rows.length === 0) {
        throw new Error(`Chain metadata not found for chain: ${this.chainId}`);
      }

      const chainMeta = metaResult.rows[0];
      const chainPosition = chainMeta.chain_length;
      const previousHash = chainMeta.last_hash;

      // Step 2: Build proof data for hashing using DB state (not local state)
      const proofData = {
        id: proofId,
        chainPosition,
        intentId: request.intent.id,
        entityId: request.intent.entityId,
        decision: request.decision,
        inputs: request.inputs,
        outputs: request.outputs,
        previousHash,
        createdAt: createdAt.toISOString(),
      };

      // Step 3: Calculate hash of the proof content
      const hash = await this.calculateHash(proofData);

      // Step 4: Sign the hash with Ed25519/ECDSA
      const signatureResult = await sign(hash);

      // Step 5: Insert proof record
      await client.query(
        `INSERT INTO proofs (
          id, chain_position, intent_id, entity_id, decision, inputs, outputs,
          hash, previous_hash, signature, signature_public_key, signature_algorithm,
          signed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          proofId,
          chainPosition,
          request.intent.id,
          request.intent.entityId,
          JSON.stringify(request.decision),
          JSON.stringify(request.inputs),
          JSON.stringify(request.outputs),
          hash,
          previousHash,
          signatureResult.signature,
          signatureResult.publicKey,
          signatureResult.algorithm,
          new Date(signatureResult.signedAt),
          createdAt,
        ]
      );

      // Step 6: Update chain metadata (inside same transaction)
      await client.query(
        `UPDATE proof_chain_meta
         SET last_hash = $1, chain_length = $2, updated_at = $3
         WHERE chain_id = $4`,
        [hash, chainPosition + 1, new Date(), this.chainId]
      );

      // Step 7: Commit transaction
      await client.query('COMMIT');

      const signedProof: SignedProof = {
        id: proofId,
        chainPosition,
        intentId: request.intent.id,
        entityId: request.intent.entityId,
        decision: request.decision,
        inputs: request.inputs,
        outputs: request.outputs,
        hash,
        previousHash,
        signature: signatureResult.signature,
        createdAt: createdAt.toISOString(),
        signatureData: {
          publicKey: signatureResult.publicKey,
          algorithm: signatureResult.algorithm,
          signedAt: signatureResult.signedAt,
        },
      };

      logger.info(
        {
          proofId,
          intentId: request.intent.id,
          chainPosition,
          signed: true,
        },
        'Proof created and signed with distributed lock'
      );

      return signedProof;
    } catch (error) {
      // Rollback on any error
      await client.query('ROLLBACK');
      logger.error({ error }, 'Failed to create proof, transaction rolled back');
      throw error;
    } finally {
      // Always release the database connection
      client.release();
    }
  }

  /**
   * Get a proof by ID
   */
  async get(id: ID): Promise<SignedProof | undefined> {
    const db = await this.ensureInitialized();

    const result = await db
      .select()
      .from(proofs)
      .where(eq(proofs.id, id))
      .limit(1);

    if (result.length === 0) return undefined;

    return this.toSignedProof(result[0]!);
  }

  /**
   * Query proofs
   */
  async query(query: ProofQuery): Promise<SignedProof[]> {
    const db = await this.ensureInitialized();

    const conditions = [];

    if (query.entityId) {
      conditions.push(eq(proofs.entityId, query.entityId));
    }

    if (query.intentId) {
      conditions.push(eq(proofs.intentId, query.intentId));
    }

    if (query.startDate) {
      conditions.push(gte(proofs.createdAt, new Date(query.startDate)));
    }

    if (query.endDate) {
      conditions.push(lte(proofs.createdAt, new Date(query.endDate)));
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    const results = await db
      .select()
      .from(proofs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(proofs.chainPosition))
      .limit(limit)
      .offset(offset);

    return results.map((r) => this.toSignedProof(r));
  }

  /**
   * Verify a proof's integrity (hash, chain linkage, and signature)
   */
  async verify(id: ID): Promise<VerificationResult> {
    const db = await this.ensureInitialized();
    const issues: string[] = [];

    const result = await db
      .select()
      .from(proofs)
      .where(eq(proofs.id, id))
      .limit(1);

    if (result.length === 0) {
      return {
        valid: false,
        proofId: id,
        chainPosition: -1,
        issues: ['Proof not found'],
        verifiedAt: new Date().toISOString(),
      };
    }

    const proof = result[0]!;

    // Verify hash
    const proofData = {
      id: proof.id,
      chainPosition: proof.chainPosition,
      intentId: proof.intentId,
      entityId: proof.entityId,
      decision: proof.decision,
      inputs: proof.inputs,
      outputs: proof.outputs,
      previousHash: proof.previousHash,
      createdAt: proof.createdAt.toISOString(),
    };

    const expectedHash = await this.calculateHash(proofData);

    if (proof.hash !== expectedHash) {
      issues.push('Hash mismatch - proof content may have been tampered');
    }

    // Verify chain linkage
    if (proof.chainPosition > 0) {
      const previousResult = await db
        .select()
        .from(proofs)
        .where(eq(proofs.chainPosition, proof.chainPosition - 1))
        .limit(1);

      if (previousResult.length > 0) {
        const previous = previousResult[0]!;
        if (proof.previousHash !== previous.hash) {
          issues.push('Chain linkage broken - previous hash does not match');
        }
      } else {
        issues.push('Previous proof in chain not found');
      }
    }

    // Verify cryptographic signature
    if (proof.signature && proof.signaturePublicKey) {
      const sigResult = await verify(
        proof.hash,
        proof.signature,
        proof.signaturePublicKey
      );
      if (!sigResult.valid) {
        issues.push(
          `Signature verification failed: ${sigResult.error || 'invalid signature'}`
        );
      }
    } else {
      issues.push('Missing signature or public key');
    }

    logger.info(
      {
        proofId: id,
        valid: issues.length === 0,
        issues,
        signatureVerified: issues.length === 0,
      },
      'Proof verified'
    );

    return {
      valid: issues.length === 0,
      proofId: id,
      chainPosition: proof.chainPosition,
      issues,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify the entire chain integrity using streaming pagination
   *
   * Instead of loading all proofs into memory at once, this method
   * processes proofs in batches to handle large chains efficiently.
   *
   * @param options - Verification options including batch size and progress callback
   * @returns Chain verification result
   */
  async verifyChain(options: ChainVerificationOptions = {}): Promise<ChainVerificationResult> {
    const db = await this.ensureInitialized();
    const issues: string[] = [];
    let lastValidPosition = -1;
    let totalVerified = 0;

    const batchSize = options.batchSize ?? 100;
    let offset = 0;
    let hasMore = true;

    // Get total count for progress reporting
    const countResult = await db
      .select({ count: proofs.chainPosition })
      .from(proofs)
      .orderBy(desc(proofs.chainPosition))
      .limit(1);

    const totalCount = countResult.length > 0 ? countResult[0]!.count + 1 : 0;

    // Stream through proofs in batches
    while (hasMore) {
      const batch = await db
        .select()
        .from(proofs)
        .orderBy(asc(proofs.chainPosition))
        .limit(batchSize)
        .offset(offset);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const proof of batch) {
        const verification = await this.verify(proof.id);

        if (!verification.valid) {
          issues.push(`Position ${proof.chainPosition}: ${verification.issues.join(', ')}`);
          hasMore = false;
          break;
        }

        lastValidPosition = proof.chainPosition;
        totalVerified++;

        // Report progress if callback provided
        if (options.onProgress) {
          options.onProgress(totalVerified, totalCount);
        }
      }

      // If we found an issue, stop processing
      if (issues.length > 0) {
        break;
      }

      offset += batchSize;

      // Check if we've processed all proofs
      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    // Update chain metadata with verification result
    await db
      .update(proofChainMeta)
      .set({
        lastVerifiedAt: new Date(),
        lastVerifiedPosition: lastValidPosition,
        updatedAt: new Date(),
      })
      .where(eq(proofChainMeta.chainId, this.chainId));

    return {
      valid: issues.length === 0,
      lastValidPosition,
      issues,
      totalVerified,
    };
  }

  /**
   * Calculate hash for a proof record using canonical JSON
   *
   * IMPORTANT: Uses canonical JSON serialization to ensure deterministic
   * hash calculation across different environments. Standard JSON.stringify
   * does NOT guarantee key order, which can cause hash mismatches.
   */
  private async calculateHash(
    proof: Omit<Proof, 'hash' | 'signature'>
  ): Promise<string> {
    // Use canonical JSON for deterministic serialization
    // Keys are sorted alphabetically to ensure consistent hashing
    const data = canonicalize({
      id: proof.id,
      chainPosition: proof.chainPosition,
      intentId: proof.intentId,
      entityId: proof.entityId,
      decision: proof.decision,
      inputs: proof.inputs,
      outputs: proof.outputs,
      previousHash: proof.previousHash,
      createdAt: proof.createdAt,
    });

    // Use Web Crypto API for SHA-256
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Convert database row to SignedProof
   */
  private toSignedProof(row: typeof proofs.$inferSelect): SignedProof {
    return {
      id: row.id,
      chainPosition: row.chainPosition,
      intentId: row.intentId,
      entityId: row.entityId,
      decision: row.decision,
      inputs: row.inputs,
      outputs: row.outputs,
      hash: row.hash,
      previousHash: row.previousHash,
      signature: row.signature,
      createdAt: row.createdAt.toISOString(),
      signatureData: row.signaturePublicKey
        ? {
            publicKey: row.signaturePublicKey,
            algorithm: row.signatureAlgorithm ?? 'unknown',
            signedAt: row.signedAt?.toISOString() ?? row.createdAt.toISOString(),
          }
        : undefined,
    };
  }

  /**
   * Get chain statistics
   *
   * NOTE: Chain stats are now always read from the database to ensure
   * accuracy in multi-instance deployments.
   */
  async getStats(): Promise<ChainStats> {
    const db = await this.ensureInitialized();

    // Read chain metadata from database
    const meta = await db
      .select()
      .from(proofChainMeta)
      .where(eq(proofChainMeta.chainId, this.chainId))
      .limit(1);

    const chainLength = meta.length > 0 ? meta[0]!.chainLength : 0;

    const result = await db
      .select()
      .from(proofs)
      .orderBy(desc(proofs.createdAt))
      .limit(1);

    return {
      totalProofs: chainLength,
      chainLength: chainLength,
      lastProofAt: result.length > 0 ? result[0]!.createdAt.toISOString() : null,
    };
  }

  /**
   * Get the current chain position (for testing/debugging)
   * Reads directly from database to ensure accuracy.
   */
  async getChainPosition(): Promise<{ lastHash: string; chainLength: number }> {
    const db = await this.ensureInitialized();

    const meta = await db
      .select()
      .from(proofChainMeta)
      .where(eq(proofChainMeta.chainId, this.chainId))
      .limit(1);

    if (meta.length === 0) {
      return { lastHash: GENESIS_HASH, chainLength: 0 };
    }

    return {
      lastHash: meta[0]!.lastHash,
      chainLength: meta[0]!.chainLength,
    };
  }
}

/**
 * Create a new PROOF service instance
 */
export function createProofService(): ProofService {
  return new ProofService();
}

// Re-export chain anchoring module
export type { ChainAnchorConfig } from './chain/index.js';
export { ChainAnchorService, createChainAnchorService, ChainAnchorScheduler, createChainAnchorScheduler } from './chain/index.js';
