/**
 * Chain Anchor Service
 *
 * Enterprise-grade service for anchoring proofs to blockchain.
 * Orchestrates batching, Merkle tree generation, transaction submission,
 * and AgentAnchor certification.
 *
 * @packageDocumentation
 */

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { createLogger } from '../../common/logger.js';
import { sha256 } from '../../common/crypto.js';
import {
  ChainAnchorRepository,
  type Database,
  type CreateBatchInput,
} from './repository.js';
import {
  createMerkleTree,
  calculateBatchHash,
  type MerkleTree,
  type MerkleProof,
} from './merkle.js';
import {
  BlockchainProvider,
  ProviderManager,
  providerManager,
  getChainConfig,
  getExplorerUrl,
  type TransactionReceipt,
  type GasEstimate,
} from './providers.js';
import {
  AgentAnchorClient,
  createAgentAnchorClient,
  type ProofSubmissionRequest,
  type ChainAnchorInfo,
} from './agent-anchor-client.js';
import type {
  AnchorBatchRow,
  AnchorTransactionRow,
  ChainAnchorConfigRow,
  ChainNetwork,
  AnchorBatchStatus,
} from './schema.js';

const logger = createLogger({ component: 'chain-anchor-service' });
const tracer = trace.getTracer('chain-anchor-service');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Proof to be anchored
 */
export interface ProofToAnchor {
  id: string;
  hash: string;
  chainPosition: number;
  tenantId: string;
}

/**
 * Anchor result for a single proof
 */
export interface ProofAnchorResult {
  proofId: string;
  batchId: string;
  merkleRoot: string;
  merkleProof: string[];
  transactions: Array<{
    network: ChainNetwork;
    txHash: string;
    blockNumber: number;
    explorerUrl: string;
  }>;
  certificateId?: string;
  certificateUrl?: string;
}

/**
 * Batch anchor result
 */
export interface BatchAnchorResult {
  batchId: string;
  batchNumber: number;
  merkleRoot: string;
  proofCount: number;
  transactions: Array<{
    network: ChainNetwork;
    txHash: string;
    blockNumber: number;
    confirmations: number;
    explorerUrl: string;
  }>;
  agentAnchorSubmission?: {
    submissionId: string;
    status: string;
    certificateId?: string;
    certificateUrl?: string;
  };
  anchoredAt: Date;
}

/**
 * Service configuration
 */
export interface ChainAnchorServiceConfig {
  defaultBatchSize: number;
  defaultBatchTimeoutMs: number;
  defaultExpirationMs: number;
  enableAgentAnchor: boolean;
  signerPrivateKey?: string;
  signerAddress?: string;
}

/**
 * Circuit breaker state
 */
interface CircuitState {
  failures: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half-open';
  nextRetry: Date | null;
}

// =============================================================================
// CHAIN ANCHOR SERVICE
// =============================================================================

/**
 * Chain Anchor Service
 *
 * Features:
 * - Automatic proof batching with configurable size/time limits
 * - Merkle tree generation for efficient on-chain verification
 * - Multi-chain anchoring (Polygon, Ethereum, Arbitrum, etc.)
 * - AgentAnchor platform integration for certification
 * - Transaction management with retry and gas bumping
 * - Circuit breaker for resilience
 * - Comprehensive metrics and tracing
 */
export class ChainAnchorService {
  private repository: ChainAnchorRepository | null = null;
  private agentAnchorClient: AgentAnchorClient | null = null;
  private config: ChainAnchorServiceConfig;
  private circuitBreakers: Map<ChainNetwork, CircuitState> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<ChainAnchorServiceConfig>) {
    this.config = {
      defaultBatchSize: config?.defaultBatchSize ?? 1000,
      defaultBatchTimeoutMs: config?.defaultBatchTimeoutMs ?? 300000,
      defaultExpirationMs: config?.defaultExpirationMs ?? 86400000,
      enableAgentAnchor: config?.enableAgentAnchor ?? true,
      signerPrivateKey: config?.signerPrivateKey,
      signerAddress: config?.signerAddress,
    };
  }

  /**
   * Initialize the service
   */
  initialize(
    db: Database,
    agentAnchorClient?: AgentAnchorClient
  ): void {
    this.repository = new ChainAnchorRepository(db);

    if (this.config.enableAgentAnchor) {
      this.agentAnchorClient = agentAnchorClient ?? createAgentAnchorClient();
    }

    // Start provider health checks
    providerManager.startHealthChecks(60000);

    this.initialized = true;
    logger.info('Chain anchor service initialized');
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.repository) {
      throw new Error('ChainAnchorService not initialized');
    }
  }

  /**
   * Add proofs to current batch
   */
  async addProofsToBatch(
    proofs: ProofToAnchor[],
    tenantId: string,
    chainId: string = 'default'
  ): Promise<{
    batchId: string;
    batchNumber: number;
    proofsAdded: number;
    batchReady: boolean;
  }> {
    return tracer.startActiveSpan('addProofsToBatch', async (span) => {
      try {
        this.ensureInitialized();

        // Get tenant config
        const config = await this.repository!.getOrCreateConfig(tenantId);

        // Get or create collecting batch
        const startPosition = proofs.length > 0 ? proofs[0]!.chainPosition : 0;
        const batch = await this.repository!.getOrCreateCollectingBatch(
          tenantId,
          chainId,
          startPosition,
          config.enabledChains ?? ['polygon_mainnet'],
          config.batchExpirationMs
        );

        // Create proof anchors
        const proofAnchors = proofs.map((proof, index) => ({
          proofId: proof.id,
          batchId: batch.id,
          tenantId,
          batchPosition: batch.proofCount + index,
          merkleLeaf: proof.hash,
        }));

        await this.repository!.createProofAnchors(proofAnchors);

        // Update batch proof count
        const newProofCount = batch.proofCount + proofs.length;
        await this.repository!.updateBatchStatus(batch.id, tenantId, 'collecting', {
          proofCount: newProofCount,
          endPosition: proofs[proofs.length - 1]?.chainPosition ?? batch.endPosition,
        });

        // Check if batch is ready
        const batchReady =
          newProofCount >= config.batchSizeLimit ||
          Date.now() - batch.collectionStartedAt.getTime() >= config.batchTimeoutMs;

        span.setAttributes({
          'batch.id': batch.id,
          'batch.number': batch.batchNumber,
          'proofs.added': proofs.length,
          'batch.total_proofs': newProofCount,
          'batch.ready': batchReady,
        });

        if (batchReady && config.autoAnchor) {
          // Trigger async anchoring
          this.anchorBatchAsync(batch.id, tenantId).catch((error) => {
            logger.error({ error, batchId: batch.id }, 'Background anchoring failed');
          });
        }

        return {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          proofsAdded: proofs.length,
          batchReady,
        };
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Finalize a batch and prepare for anchoring
   */
  async finalizeBatch(
    batchId: string,
    tenantId: string
  ): Promise<{
    merkleRoot: string;
    batchHash: string;
    proofCount: number;
    depth: number;
  }> {
    return tracer.startActiveSpan('finalizeBatch', async (span) => {
      try {
        this.ensureInitialized();

        const batch = await this.repository!.getBatch(batchId, tenantId);
        if (!batch) {
          throw new Error(`Batch ${batchId} not found`);
        }

        if (batch.status !== 'collecting') {
          throw new Error(`Batch ${batchId} is not in collecting state`);
        }

        // Get all proof anchors
        const proofAnchors = await this.repository!.getBatchProofAnchors(batchId);
        if (proofAnchors.length === 0) {
          throw new Error(`Batch ${batchId} has no proofs`);
        }

        // Extract proof hashes
        const leaves = proofAnchors.map((pa) => pa.merkleLeaf!);

        // Build Merkle tree
        const merkleTree = await createMerkleTree(leaves);
        const merkleRoot = merkleTree.getRoot();
        const batchHash = await calculateBatchHash(leaves);

        // Get all proofs and store Merkle proofs
        const allProofs = merkleTree.getAllProofs();
        for (const proofAnchor of proofAnchors) {
          const merkleProof = allProofs.get(proofAnchor.merkleLeaf!);
          if (merkleProof) {
            await this.repository!.updateProofAnchorMerkleProof(
              proofAnchor.proofId,
              merkleProof.proof,
              merkleProof.leaf,
              merkleProof.leafIndex
            );
          }
        }

        // Update batch with Merkle data
        await this.repository!.updateBatchMerkleData(
          batchId,
          tenantId,
          merkleRoot,
          merkleTree.getDepth(),
          {
            leaves,
            layers: merkleTree.getLayers(),
            proofs: Object.fromEntries(allProofs),
          },
          batchHash,
          proofAnchors[proofAnchors.length - 1]!.batchPosition,
          proofAnchors.length
        );

        // Update status to pending
        await this.repository!.updateBatchStatus(batchId, tenantId, 'pending');

        span.setAttributes({
          'batch.id': batchId,
          'merkle.root': merkleRoot,
          'merkle.depth': merkleTree.getDepth(),
          'proof.count': proofAnchors.length,
        });

        logger.info(
          {
            batchId,
            merkleRoot,
            proofCount: proofAnchors.length,
          },
          'Batch finalized'
        );

        return {
          merkleRoot,
          batchHash,
          proofCount: proofAnchors.length,
          depth: merkleTree.getDepth(),
        };
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Anchor a batch to blockchain (async background task)
   */
  private async anchorBatchAsync(batchId: string, tenantId: string): Promise<void> {
    try {
      await this.anchorBatch(batchId, tenantId);
    } catch (error) {
      logger.error({ error, batchId }, 'Async batch anchoring failed');
    }
  }

  /**
   * Anchor a batch to blockchain
   */
  async anchorBatch(
    batchId: string,
    tenantId: string
  ): Promise<BatchAnchorResult> {
    return tracer.startActiveSpan('anchorBatch', async (span) => {
      try {
        this.ensureInitialized();

        // Get batch
        let batch = await this.repository!.getBatch(batchId, tenantId);
        if (!batch) {
          throw new Error(`Batch ${batchId} not found`);
        }

        // Finalize if still collecting
        if (batch.status === 'collecting') {
          await this.finalizeBatch(batchId, tenantId);
          batch = await this.repository!.getBatch(batchId, tenantId);
        }

        if (batch!.status !== 'pending' && batch!.status !== 'failed') {
          throw new Error(`Batch ${batchId} is not in pending or failed state`);
        }

        // Update status to submitting
        await this.repository!.updateBatchStatus(batchId, tenantId, 'submitting');

        // Get config
        const config = await this.repository!.getOrCreateConfig(tenantId);

        // Submit to each target chain
        const transactions: BatchAnchorResult['transactions'] = [];
        const chainAnchors: ChainAnchorInfo[] = [];

        for (const networkStr of batch!.targetChains ?? []) {
          const network = networkStr as ChainNetwork;

          // Check circuit breaker
          if (!this.canUseNetwork(network)) {
            logger.warn({ network }, 'Circuit breaker open, skipping network');
            continue;
          }

          try {
            const txResult = await this.submitToChain(
              batch!,
              network,
              config
            );

            transactions.push({
              network,
              txHash: txResult.txHash,
              blockNumber: txResult.blockNumber,
              confirmations: txResult.confirmations,
              explorerUrl: getExplorerUrl(network, txResult.txHash),
            });

            chainAnchors.push({
              network,
              chainId: txResult.chainId,
              txHash: txResult.txHash,
              blockNumber: txResult.blockNumber,
              blockHash: txResult.blockHash,
              timestamp: new Date().toISOString(),
            });

            this.recordSuccess(network);
          } catch (error) {
            this.recordFailure(network);
            logger.error(
              { error, network, batchId },
              'Chain submission failed'
            );
          }
        }

        // Check if at least one chain succeeded
        if (transactions.length === 0) {
          await this.repository!.recordBatchError(
            batchId,
            tenantId,
            'All chain submissions failed'
          );
          throw new Error('All chain submissions failed');
        }

        // Submit to AgentAnchor if enabled
        let agentAnchorSubmission: BatchAnchorResult['agentAnchorSubmission'];
        if (this.agentAnchorClient && config.agentAnchorEnabled) {
          try {
            const submission = await this.submitToAgentAnchor(
              batch!,
              chainAnchors,
              config
            );
            agentAnchorSubmission = submission;
          } catch (error) {
            logger.error({ error, batchId }, 'AgentAnchor submission failed');
          }
        }

        // Update batch to anchored
        await this.repository!.updateBatchStatus(batchId, tenantId, 'anchored');

        const result: BatchAnchorResult = {
          batchId,
          batchNumber: batch!.batchNumber,
          merkleRoot: batch!.merkleRoot!,
          proofCount: batch!.proofCount,
          transactions,
          agentAnchorSubmission,
          anchoredAt: new Date(),
        };

        span.setAttributes({
          'batch.id': batchId,
          'batch.merkle_root': batch!.merkleRoot!,
          'batch.proof_count': batch!.proofCount,
          'transactions.count': transactions.length,
        });

        logger.info(
          {
            batchId,
            merkleRoot: batch!.merkleRoot,
            proofCount: batch!.proofCount,
            chains: transactions.map((t) => t.network),
          },
          'Batch anchored successfully'
        );

        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });

        await this.repository!.recordBatchError(
          batchId,
          tenantId,
          (error as Error).message
        );

        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Submit batch to a specific blockchain
   */
  private async submitToChain(
    batch: AnchorBatchRow,
    network: ChainNetwork,
    config: ChainAnchorConfigRow
  ): Promise<{
    txHash: string;
    blockNumber: number;
    blockHash: string;
    chainId: number;
    confirmations: number;
  }> {
    const provider = providerManager.getProvider(network);
    const chainConfig = getChainConfig(network);

    // Create transaction record
    const tx = await this.repository!.createTransaction({
      batchId: batch.id,
      tenantId: batch.tenantId,
      network,
      chainIdNumeric: chainConfig.chainId,
      fromAddress: this.config.signerAddress ?? '0x0000000000000000000000000000000000000000',
      toAddress: chainConfig.contractAddress ?? '0x0000000000000000000000000000000000000000',
      contractAddress: chainConfig.contractAddress,
      merkleRoot: batch.merkleRoot!,
      requiredConfirmations: config.requiredConfirmations,
    });

    try {
      // Encode contract call
      const callData = provider.encodeAnchorCall(
        batch.merkleRoot!,
        batch.id,
        batch.proofCount
      );

      // Estimate gas
      const gasEstimate = await provider.estimateGas({
        to: chainConfig.contractAddress ?? '',
        data: callData,
      });

      // Check gas price limits
      const gasPriceGwei = parseInt(gasEstimate.gasPrice, 16) / 1e9;
      if (gasPriceGwei > config.maxGasPriceGwei!) {
        throw new Error(
          `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds limit ${config.maxGasPriceGwei}`
        );
      }

      // Resolve the signer private key from config or environment
      const signerPrivateKey =
        this.config.signerPrivateKey ?? process.env['VORION_CHAIN_PRIVATE_KEY'];

      if (signerPrivateKey) {
        // ===================================================================
        // PRODUCTION MODE: Sign and broadcast a real blockchain transaction
        // ===================================================================
        logger.info(
          { network, batchId: batch.id },
          'Production mode: signing and broadcasting real transaction'
        );

        let ethers: typeof import('ethers');
        try {
          ethers = await import('ethers');
        } catch (importErr) {
          throw new Error(
            'ethers.js v6 is required for production chain anchoring. ' +
            'Install it with: npm install ethers@^6'
          );
        }

        // Build an ethers JsonRpcProvider from the chain RPC URL
        const rpcUrl = chainConfig.rpcUrls[0];
        if (!rpcUrl) {
          throw new Error(`No RPC URL configured for network ${network}`);
        }
        const ethersProvider = new ethers.JsonRpcProvider(rpcUrl, {
          chainId: chainConfig.chainId,
          name: chainConfig.name,
        });

        // Create a wallet from the private key and connect to the provider
        const wallet = new ethers.Wallet(signerPrivateKey, ethersProvider);
        const fromAddress = await wallet.getAddress();

        // Update the transaction record with the real from-address
        await this.repository!.updateTransaction(tx.id, batch.tenantId, {
          fromAddress,
        });

        const targetAddress =
          chainConfig.contractAddress ?? '0x0000000000000000000000000000000000000000';

        // Build the transaction request
        const txRequest: import('ethers').TransactionRequest = {
          to: targetAddress,
          data: callData,
          gasLimit: BigInt(gasEstimate.gasLimit),
          maxFeePerGas: BigInt(gasEstimate.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(gasEstimate.maxPriorityFeePerGas),
          type: 2, // EIP-1559
          chainId: chainConfig.chainId,
        };

        // Sign and send the transaction
        let sentTx: import('ethers').TransactionResponse;
        try {
          sentTx = await wallet.sendTransaction(txRequest);
        } catch (sendErr: unknown) {
          const errMsg = (sendErr as Error).message ?? String(sendErr);

          // Classify error for actionable logging
          if (errMsg.includes('insufficient funds') || errMsg.includes('INSUFFICIENT_FUNDS')) {
            logger.error(
              { network, address: fromAddress },
              'Insufficient funds for chain anchor transaction'
            );
            throw new Error(
              `Insufficient funds on ${fromAddress} for ${network}. ` +
              `Estimated cost: ${gasEstimate.estimatedCostGwei} gwei`
            );
          }
          if (errMsg.includes('nonce') || errMsg.includes('NONCE_EXPIRED')) {
            logger.error(
              { network, address: fromAddress },
              'Nonce conflict detected — resetting nonce cache'
            );
            provider.resetNonce(fromAddress);
            throw new Error(
              `Nonce conflict on ${network}. The transaction nonce was stale; ` +
              'please retry — the nonce cache has been reset.'
            );
          }
          if (errMsg.includes('replacement fee too low') || errMsg.includes('REPLACEMENT_UNDERPRICED')) {
            throw new Error(
              `Replacement transaction underpriced on ${network}. ` +
              'A pending transaction with the same nonce exists at a higher gas price.'
            );
          }
          // Generic re-throw with network context
          throw new Error(`Transaction send failed on ${network}: ${errMsg}`);
        }

        const realTxHash = sentTx.hash;

        // Persist the submitted transaction
        await this.repository!.updateTransaction(tx.id, batch.tenantId, {
          txHash: realTxHash,
          nonce: sentTx.nonce,
          status: 'submitted',
          submittedAt: new Date(),
          inputData: callData,
          gasLimit: gasEstimate.gasLimit,
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        });

        logger.info(
          { network, txHash: realTxHash, batchId: batch.id },
          'Transaction broadcast — waiting for confirmations'
        );

        // Wait for the required number of confirmations
        const requiredConfs = config.requiredConfirmations ?? 2;
        const confirmationTimeoutMs =
          Math.max(chainConfig.blockTime * requiredConfs * 4, 60) * 1000; // generous timeout

        let receipt: import('ethers').TransactionReceipt | null;
        try {
          receipt = await sentTx.wait(requiredConfs, confirmationTimeoutMs);
        } catch (waitErr: unknown) {
          const errMsg = (waitErr as Error).message ?? String(waitErr);
          if (errMsg.includes('timeout') || errMsg.includes('TIMEOUT')) {
            throw new Error(
              `Transaction ${realTxHash} on ${network} did not reach ` +
              `${requiredConfs} confirmations within ${confirmationTimeoutMs}ms`
            );
          }
          throw new Error(
            `Confirmation wait failed for ${realTxHash} on ${network}: ${errMsg}`
          );
        }

        if (!receipt) {
          throw new Error(
            `Transaction ${realTxHash} on ${network} returned null receipt after wait`
          );
        }

        if (receipt.status === 0) {
          throw new Error(
            `Transaction ${realTxHash} on ${network} reverted (block ${receipt.blockNumber})`
          );
        }

        const realBlockNumber = receipt.blockNumber;
        const realBlockHash = receipt.blockHash;
        const currentBlock = await provider.getBlockNumber();
        const actualConfirmations = currentBlock - realBlockNumber + 1;

        // Record gas cost for accounting
        const gasUsedWei = receipt.gasUsed * receipt.gasPrice;

        // Persist confirmed state
        await this.repository!.updateTransaction(tx.id, batch.tenantId, {
          status: 'confirmed',
          blockNumber: realBlockNumber,
          blockHash: realBlockHash,
          blockTimestamp: new Date(),
          confirmations: actualConfirmations,
          confirmedAt: new Date(),
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.gasPrice.toString(),
          txCostWei: gasUsedWei.toString(),
        });

        logger.info(
          {
            network,
            txHash: realTxHash,
            blockNumber: realBlockNumber,
            confirmations: actualConfirmations,
            gasUsed: receipt.gasUsed.toString(),
          },
          'Transaction confirmed on chain'
        );

        return {
          txHash: realTxHash,
          blockNumber: realBlockNumber,
          blockHash: realBlockHash,
          chainId: chainConfig.chainId,
          confirmations: actualConfirmations,
        };
      } else {
        // ===================================================================
        // DEMO MODE: Generate deterministic mock hashes for local / CI usage
        // ===================================================================
        logger.warn(
          { network, batchId: batch.id },
          'DEMO MODE: No signer key configured (set VORION_CHAIN_PRIVATE_KEY env var ' +
          'or pass signerPrivateKey in config to enable real chain anchoring). ' +
          'Generating simulated transaction data.'
        );

        const mockTxHash = '0x' + await sha256(batch.id + network + Date.now());
        const currentBlock = await provider.getBlockNumber();

        // Update transaction record
        await this.repository!.updateTransaction(tx.id, batch.tenantId, {
          txHash: mockTxHash,
          status: 'submitted',
          submittedAt: new Date(),
          inputData: callData,
          gasLimit: gasEstimate.gasLimit,
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        });

        const mockBlockNumber = currentBlock + 1;
        const mockBlockHash = '0x' + await sha256(mockTxHash + mockBlockNumber);

        // Update with simulated confirmation
        await this.repository!.updateTransaction(tx.id, batch.tenantId, {
          status: 'confirmed',
          blockNumber: mockBlockNumber,
          blockHash: mockBlockHash,
          blockTimestamp: new Date(),
          confirmations: config.requiredConfirmations,
          confirmedAt: new Date(),
        });

        return {
          txHash: mockTxHash,
          blockNumber: mockBlockNumber,
          blockHash: mockBlockHash,
          chainId: chainConfig.chainId,
          confirmations: config.requiredConfirmations,
        };
      }
    } catch (error) {
      await this.repository!.updateTransaction(tx.id, batch.tenantId, {
        status: 'failed',
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Submit to AgentAnchor platform
   */
  private async submitToAgentAnchor(
    batch: AnchorBatchRow,
    chainAnchors: ChainAnchorInfo[],
    config: ChainAnchorConfigRow
  ): Promise<{
    submissionId: string;
    status: string;
    certificateId?: string;
    certificateUrl?: string;
  }> {
    if (!this.agentAnchorClient) {
      throw new Error('AgentAnchor client not configured');
    }

    // Create submission record
    const submission = await this.repository!.createAgentAnchorSubmission({
      batchId: batch.id,
      tenantId: batch.tenantId,
      agentId: process.env['AGENT_ANCHOR_AGENT_ID'] ?? '',
      requestPayload: {
        agentId: process.env['AGENT_ANCHOR_AGENT_ID'],
        merkleRoot: batch.merkleRoot,
        proofCount: batch.proofCount,
        chainAnchors,
      },
    });

    // Submit to AgentAnchor
    const request: ProofSubmissionRequest = {
      agentId: process.env['AGENT_ANCHOR_AGENT_ID'] ?? '',
      batchId: batch.id,
      merkleRoot: batch.merkleRoot!,
      proofCount: batch.proofCount,
      startPosition: batch.startPosition,
      endPosition: batch.endPosition ?? batch.startPosition,
      chainAnchors,
      metadata: {
        batchNumber: batch.batchNumber,
        chainId: batch.chainId,
      },
    };

    const response = await this.agentAnchorClient.submitProofs(request);

    // Update submission record
    await this.repository!.updateAgentAnchorSubmission(
      submission.id,
      batch.tenantId,
      {
        agentAnchorId: response.submissionId,
        status: response.status === 'verified' ? 'verified' : 'submitted',
        certificateId: response.certificateId,
        certificateUrl: response.certificateUrl,
        verificationToken: response.verificationToken,
        submittedAt: new Date(),
        responsePayload: response as unknown as Record<string, unknown>,
      }
    );

    return {
      submissionId: response.submissionId,
      status: response.status,
      certificateId: response.certificateId,
      certificateUrl: response.certificateUrl,
    };
  }

  /**
   * Get anchor details for a proof
   */
  async getProofAnchor(proofId: string): Promise<ProofAnchorResult | null> {
    this.ensureInitialized();

    const proofAnchor = await this.repository!.getProofAnchor(proofId);
    if (!proofAnchor) {
      return null;
    }

    const batch = await this.repository!.getBatch(
      proofAnchor.batchId,
      proofAnchor.tenantId
    );
    if (!batch || batch.status !== 'anchored') {
      return null;
    }

    const transactions = await this.repository!.getBatchTransactions(batch.id);
    const submission = await this.repository!.getBatchSubmission(batch.id);

    return {
      proofId,
      batchId: batch.id,
      merkleRoot: batch.merkleRoot!,
      merkleProof: proofAnchor.merkleProof ?? [],
      transactions: transactions
        .filter((tx) => tx.status === 'confirmed')
        .map((tx) => ({
          network: tx.network,
          txHash: tx.txHash!,
          blockNumber: tx.blockNumber!,
          explorerUrl: getExplorerUrl(tx.network, tx.txHash!),
        })),
      certificateId: submission?.certificateId ?? undefined,
      certificateUrl: submission?.certificateUrl ?? undefined,
    };
  }

  /**
   * Verify a proof is anchored
   */
  async verifyProofAnchored(
    proofId: string,
    proofHash: string
  ): Promise<{
    verified: boolean;
    merkleVerified: boolean;
    chainVerified: boolean;
    certificateVerified?: boolean;
    details?: ProofAnchorResult;
  }> {
    const anchor = await this.getProofAnchor(proofId);
    if (!anchor) {
      return {
        verified: false,
        merkleVerified: false,
        chainVerified: false,
      };
    }

    // Verify Merkle proof
    const { verifyMerkleProof } = await import('./merkle.js');
    const merkleVerified = await verifyMerkleProof(
      proofHash,
      anchor.merkleProof,
      anchor.merkleProof.map(() => 'right' as const), // Simplified
      anchor.merkleRoot
    );

    // Check chain transactions
    const chainVerified = anchor.transactions.length > 0;

    // Check AgentAnchor certificate
    let certificateVerified: boolean | undefined;
    if (anchor.certificateId && this.agentAnchorClient) {
      try {
        const cert = await this.agentAnchorClient.getCertificate(
          anchor.certificateId
        );
        certificateVerified = cert.status === 'active';
      } catch {
        certificateVerified = false;
      }
    }

    return {
      verified: merkleVerified && chainVerified,
      merkleVerified,
      chainVerified,
      certificateVerified,
      details: anchor,
    };
  }

  /**
   * Process pending batches
   */
  async processPendingBatches(limit: number = 10): Promise<number> {
    this.ensureInitialized();

    const pendingBatches = await this.repository!.getPendingBatches(limit);

    let processed = 0;
    for (const batch of pendingBatches) {
      try {
        await this.anchorBatch(batch.id, batch.tenantId);
        processed++;
      } catch (error) {
        logger.error(
          { error, batchId: batch.id },
          'Failed to process pending batch'
        );
      }
    }

    return processed;
  }

  /**
   * Retry failed batches
   */
  async retryFailedBatches(limit: number = 10): Promise<number> {
    this.ensureInitialized();

    const retryableBatches = await this.repository!.getRetryableBatches(limit);

    let retried = 0;
    for (const batch of retryableBatches) {
      try {
        await this.anchorBatch(batch.id, batch.tenantId);
        retried++;
      } catch (error) {
        logger.error(
          { error, batchId: batch.id },
          'Failed to retry batch'
        );
      }
    }

    return retried;
  }

  /**
   * Expire old batches
   */
  async expireBatches(): Promise<number> {
    this.ensureInitialized();
    return this.repository!.expireBatches();
  }

  /**
   * Get service statistics
   */
  async getStats(tenantId: string): Promise<{
    batches: {
      total: number;
      anchored: number;
      failed: number;
      pending: number;
    };
    proofs: {
      totalAnchored: number;
    };
    transactions: {
      total: number;
      confirmed: number;
    };
    health: {
      circuitBreakers: Record<string, CircuitState>;
    };
  }> {
    this.ensureInitialized();

    const stats = await this.repository!.getStats(tenantId);

    return {
      batches: {
        total: stats.totalBatches,
        anchored: stats.anchoredBatches,
        failed: stats.failedBatches,
        pending: stats.pendingBatches,
      },
      proofs: {
        totalAnchored: stats.totalProofsAnchored,
      },
      transactions: {
        total: stats.totalTransactions,
        confirmed: stats.confirmedTransactions,
      },
      health: {
        circuitBreakers: Object.fromEntries(this.circuitBreakers),
      },
    };
  }

  // ===========================================================================
  // CIRCUIT BREAKER HELPERS
  // ===========================================================================

  private canUseNetwork(network: ChainNetwork): boolean {
    const state = this.circuitBreakers.get(network);
    if (!state) return true;

    if (state.state === 'closed') return true;

    if (state.state === 'open') {
      if (state.nextRetry && new Date() >= state.nextRetry) {
        state.state = 'half-open';
        return true;
      }
      return false;
    }

    return true; // half-open
  }

  private recordSuccess(network: ChainNetwork): void {
    this.circuitBreakers.set(network, {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      nextRetry: null,
    });
  }

  private recordFailure(network: ChainNetwork): void {
    const state = this.circuitBreakers.get(network) ?? {
      failures: 0,
      lastFailure: null,
      state: 'closed' as const,
      nextRetry: null,
    };

    state.failures++;
    state.lastFailure = new Date();

    if (state.failures >= 5) {
      state.state = 'open';
      state.nextRetry = new Date(Date.now() + 300000); // 5 minutes
      logger.warn({ network, failures: state.failures }, 'Circuit breaker opened');
    }

    this.circuitBreakers.set(network, state);
  }

  /**
   * Shutdown service
   */
  shutdown(): void {
    providerManager.stopHealthChecks();
    this.initialized = false;
    logger.info('Chain anchor service shutdown');
  }
}

/**
 * Create chain anchor service
 */
export function createChainAnchorService(
  config?: Partial<ChainAnchorServiceConfig>
): ChainAnchorService {
  return new ChainAnchorService(config);
}
