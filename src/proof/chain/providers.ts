/**
 * Blockchain Provider Abstraction
 *
 * Enterprise-grade blockchain provider layer supporting multiple networks.
 * Includes connection pooling, failover, gas estimation, and transaction management.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { sha256 } from '../../common/crypto.js';
import type { ChainNetwork } from './schema.js';

const logger = createLogger({ component: 'chain-provider' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Chain configuration
 */
export interface ChainConfig {
  network: ChainNetwork;
  chainId: number;
  name: string;
  rpcUrls: string[];
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockTime: number; // seconds
  confirmationsRequired: number;
  maxGasPriceGwei: number;
  contractAddress?: string;
}

/**
 * Transaction request
 */
export interface TransactionRequest {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
}

/**
 * Transaction response
 */
export interface TransactionResponse {
  hash: string;
  nonce: number;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  from: string;
  to: string;
  value: string;
  data: string;
  chainId: number;
}

/**
 * Transaction receipt
 */
export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  from: string;
  to: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: 'success' | 'reverted';
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

/**
 * Gas estimate
 */
export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedCostWei: string;
  estimatedCostGwei: string;
}

/**
 * Block info
 */
export interface BlockInfo {
  number: number;
  hash: string;
  timestamp: number;
  transactions: string[];
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  network: ChainNetwork;
  healthy: boolean;
  latencyMs: number;
  blockNumber: number;
  lastChecked: Date;
  errors: string[];
}

// =============================================================================
// CHAIN CONFIGURATIONS
// =============================================================================

export const CHAIN_CONFIGS: Record<ChainNetwork, ChainConfig> = {
  ethereum_mainnet: {
    network: 'ethereum_mainnet',
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrls: [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
    ],
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 12,
    confirmationsRequired: 12,
    maxGasPriceGwei: 500,
  },
  ethereum_sepolia: {
    network: 'ethereum_sepolia',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrls: [
      'https://rpc.sepolia.org',
      'https://sepolia.drpc.org',
    ],
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 12,
    confirmationsRequired: 3,
    maxGasPriceGwei: 100,
  },
  polygon_mainnet: {
    network: 'polygon_mainnet',
    chainId: 137,
    name: 'Polygon Mainnet',
    rpcUrls: [
      'https://polygon.llamarpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon-bor-rpc.publicnode.com',
    ],
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 128,
    maxGasPriceGwei: 1000,
  },
  polygon_amoy: {
    network: 'polygon_amoy',
    chainId: 80002,
    name: 'Polygon Amoy',
    rpcUrls: [
      'https://rpc-amoy.polygon.technology',
      'https://polygon-amoy-bor-rpc.publicnode.com',
    ],
    explorerUrl: 'https://amoy.polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 12,
    maxGasPriceGwei: 100,
  },
  arbitrum_one: {
    network: 'arbitrum_one',
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum',
    ],
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 0.25,
    confirmationsRequired: 64,
    maxGasPriceGwei: 50,
  },
  arbitrum_sepolia: {
    network: 'arbitrum_sepolia',
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrls: [
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    explorerUrl: 'https://sepolia.arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 0.25,
    confirmationsRequired: 12,
    maxGasPriceGwei: 50,
  },
  base_mainnet: {
    network: 'base_mainnet',
    chainId: 8453,
    name: 'Base Mainnet',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
    ],
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 64,
    maxGasPriceGwei: 50,
  },
  base_sepolia: {
    network: 'base_sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrls: [
      'https://sepolia.base.org',
    ],
    explorerUrl: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 12,
    maxGasPriceGwei: 50,
  },
  optimism_mainnet: {
    network: 'optimism_mainnet',
    chainId: 10,
    name: 'Optimism Mainnet',
    rpcUrls: [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism',
    ],
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 64,
    maxGasPriceGwei: 50,
  },
  optimism_sepolia: {
    network: 'optimism_sepolia',
    chainId: 11155420,
    name: 'Optimism Sepolia',
    rpcUrls: [
      'https://sepolia.optimism.io',
    ],
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTime: 2,
    confirmationsRequired: 12,
    maxGasPriceGwei: 50,
  },
};

// =============================================================================
// PROOF ANCHOR CONTRACT ABI
// =============================================================================

/**
 * Minimal ABI for proof anchor contract
 */
export const PROOF_ANCHOR_ABI = [
  {
    name: 'anchor',
    type: 'function',
    inputs: [
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'batchId', type: 'bytes32' },
      { name: 'proofCount', type: 'uint256' },
    ],
    outputs: [{ name: 'anchorId', type: 'uint256' }],
  },
  {
    name: 'verify',
    type: 'function',
    inputs: [
      { name: 'anchorId', type: 'uint256' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [{ name: 'valid', type: 'bool' }],
  },
  {
    name: 'getAnchor',
    type: 'function',
    inputs: [{ name: 'anchorId', type: 'uint256' }],
    outputs: [
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'batchId', type: 'bytes32' },
      { name: 'proofCount', type: 'uint256' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    name: 'Anchored',
    type: 'event',
    inputs: [
      { name: 'anchorId', type: 'uint256', indexed: true },
      { name: 'merkleRoot', type: 'bytes32', indexed: true },
      { name: 'batchId', type: 'bytes32', indexed: false },
      { name: 'proofCount', type: 'uint256', indexed: false },
    ],
  },
];

// =============================================================================
// BLOCKCHAIN PROVIDER
// =============================================================================

/**
 * Blockchain provider for a specific network
 */
export class BlockchainProvider {
  private config: ChainConfig;
  private rpcIndex: number = 0;
  private healthStatus: ProviderHealth;
  private nonceCache: Map<string, number> = new Map();

  constructor(network: ChainNetwork) {
    const config = CHAIN_CONFIGS[network];
    if (!config) {
      throw new Error(`Unknown network: ${network}`);
    }

    this.config = config;
    this.healthStatus = {
      network,
      healthy: false,
      latencyMs: 0,
      blockNumber: 0,
      lastChecked: new Date(),
      errors: [],
    };
  }

  /**
   * Get chain configuration
   */
  getConfig(): ChainConfig {
    return this.config;
  }

  /**
   * Get current RPC URL with failover
   */
  private getRpcUrl(): string {
    return this.config.rpcUrls[this.rpcIndex % this.config.rpcUrls.length]!;
  }

  /**
   * Rotate to next RPC endpoint
   */
  private rotateRpc(): void {
    this.rpcIndex = (this.rpcIndex + 1) % this.config.rpcUrls.length;
    logger.info(
      { network: this.config.network, rpcUrl: this.getRpcUrl() },
      'Rotated to next RPC endpoint'
    );
  }

  /**
   * Make JSON-RPC call with retry and failover
   */
  private async rpcCall<T>(
    method: string,
    params: unknown[],
    retries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries * this.config.rpcUrls.length; attempt++) {
      const rpcUrl = this.getRpcUrl();

      try {
        const startTime = Date.now();
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
        });

        const latency = Date.now() - startTime;

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json() as { result?: T; error?: { message: string } };

        if (data.error) {
          throw new Error(data.error.message);
        }

        // Update health on success
        this.healthStatus.healthy = true;
        this.healthStatus.latencyMs = latency;
        this.healthStatus.lastChecked = new Date();

        return data.result as T;
      } catch (error) {
        lastError = error as Error;
        this.healthStatus.errors.push((error as Error).message);

        logger.warn(
          {
            network: this.config.network,
            rpcUrl,
            method,
            error: (error as Error).message,
            attempt,
          },
          'RPC call failed, retrying'
        );

        // Rotate to next endpoint
        this.rotateRpc();

        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt % retries) * 1000)
        );
      }
    }

    this.healthStatus.healthy = false;
    throw lastError || new Error('RPC call failed');
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const result = await this.rpcCall<string>('eth_blockNumber', []);
    const blockNumber = parseInt(result, 16);
    this.healthStatus.blockNumber = blockNumber;
    return blockNumber;
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number | 'latest'): Promise<BlockInfo | null> {
    const blockParam =
      blockNumber === 'latest' ? 'latest' : `0x${blockNumber.toString(16)}`;

    const result = await this.rpcCall<{
      number: string;
      hash: string;
      timestamp: string;
      transactions: string[];
    } | null>('eth_getBlockByNumber', [blockParam, false]);

    if (!result) return null;

    return {
      number: parseInt(result.number, 16),
      hash: result.hash,
      timestamp: parseInt(result.timestamp, 16),
      transactions: result.transactions,
    };
  }

  /**
   * Get transaction count (nonce) for address
   */
  async getTransactionCount(address: string): Promise<number> {
    const result = await this.rpcCall<string>('eth_getTransactionCount', [
      address,
      'pending',
    ]);
    return parseInt(result, 16);
  }

  /**
   * Get cached nonce with increment
   */
  async getNonce(address: string): Promise<number> {
    const cached = this.nonceCache.get(address);
    if (cached !== undefined) {
      this.nonceCache.set(address, cached + 1);
      return cached;
    }

    const nonce = await this.getTransactionCount(address);
    this.nonceCache.set(address, nonce + 1);
    return nonce;
  }

  /**
   * Reset nonce cache for address
   */
  resetNonce(address: string): void {
    this.nonceCache.delete(address);
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(tx: TransactionRequest): Promise<GasEstimate> {
    // Get gas limit estimate
    const gasLimitHex = await this.rpcCall<string>('eth_estimateGas', [
      {
        to: tx.to,
        data: tx.data,
        value: tx.value || '0x0',
      },
    ]);

    // Get gas price
    const gasPriceHex = await this.rpcCall<string>('eth_gasPrice', []);

    // Get base fee for EIP-1559
    const block = await this.getBlock('latest');
    const baseFee = block ? BigInt(block.timestamp) : BigInt(0); // Placeholder

    // Calculate fees
    const gasLimit = BigInt(gasLimitHex);
    const gasPrice = BigInt(gasPriceHex);

    // Add 20% buffer to gas limit
    const bufferedGasLimit = (gasLimit * BigInt(120)) / BigInt(100);

    // Calculate EIP-1559 fees
    const maxPriorityFeePerGas = BigInt(2e9); // 2 gwei
    const maxFeePerGas = gasPrice + maxPriorityFeePerGas;

    // Estimate cost
    const estimatedCostWei = bufferedGasLimit * maxFeePerGas;
    const estimatedCostGwei = estimatedCostWei / BigInt(1e9);

    return {
      gasLimit: '0x' + bufferedGasLimit.toString(16),
      gasPrice: gasPriceHex,
      maxFeePerGas: '0x' + maxFeePerGas.toString(16),
      maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
      estimatedCostWei: estimatedCostWei.toString(),
      estimatedCostGwei: estimatedCostGwei.toString(),
    };
  }

  /**
   * Send raw signed transaction
   */
  async sendRawTransaction(signedTx: string): Promise<string> {
    return this.rpcCall<string>('eth_sendRawTransaction', [signedTx]);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const result = await this.rpcCall<{
      transactionHash: string;
      blockNumber: string;
      blockHash: string;
      transactionIndex: string;
      from: string;
      to: string;
      gasUsed: string;
      effectiveGasPrice: string;
      status: string;
      logs: Array<{
        address: string;
        topics: string[];
        data: string;
      }>;
    } | null>('eth_getTransactionReceipt', [txHash]);

    if (!result) return null;

    return {
      transactionHash: result.transactionHash,
      blockNumber: parseInt(result.blockNumber, 16),
      blockHash: result.blockHash,
      transactionIndex: parseInt(result.transactionIndex, 16),
      from: result.from,
      to: result.to,
      gasUsed: result.gasUsed,
      effectiveGasPrice: result.effectiveGasPrice,
      status: result.status === '0x1' ? 'success' : 'reverted',
      logs: result.logs,
    };
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(
    txHash: string,
    confirmations: number = this.config.confirmationsRequired,
    timeoutMs: number = 300000
  ): Promise<TransactionReceipt> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const receipt = await this.getTransactionReceipt(txHash);

      if (receipt) {
        const currentBlock = await this.getBlockNumber();
        const txConfirmations = currentBlock - receipt.blockNumber + 1;

        if (txConfirmations >= confirmations) {
          logger.info(
            {
              txHash,
              blockNumber: receipt.blockNumber,
              confirmations: txConfirmations,
            },
            'Transaction confirmed'
          );
          return receipt;
        }

        logger.debug(
          {
            txHash,
            currentConfirmations: txConfirmations,
            requiredConfirmations: confirmations,
          },
          'Waiting for confirmations'
        );
      }

      // Wait for next block
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.blockTime * 1000)
      );
    }

    throw new Error(`Transaction ${txHash} not confirmed within timeout`);
  }

  /**
   * Encode function call data
   */
  encodeAnchorCall(merkleRoot: string, batchId: string, proofCount: number): string {
    // Function selector for anchor(bytes32,bytes32,uint256)
    const selector = '0x8c2a993e'; // keccak256("anchor(bytes32,bytes32,uint256)").slice(0,10)

    // Pad parameters to 32 bytes
    const merkleRootPadded = merkleRoot.startsWith('0x')
      ? merkleRoot.slice(2).padStart(64, '0')
      : merkleRoot.padStart(64, '0');

    const batchIdPadded = batchId.startsWith('0x')
      ? batchId.slice(2).padStart(64, '0')
      : batchId.padStart(64, '0');

    const proofCountHex = proofCount.toString(16).padStart(64, '0');

    return selector + merkleRootPadded + batchIdPadded + proofCountHex;
  }

  /**
   * Check provider health
   */
  async checkHealth(): Promise<ProviderHealth> {
    try {
      const startTime = Date.now();
      const blockNumber = await this.getBlockNumber();
      const latency = Date.now() - startTime;

      this.healthStatus = {
        network: this.config.network,
        healthy: true,
        latencyMs: latency,
        blockNumber,
        lastChecked: new Date(),
        errors: [],
      };
    } catch (error) {
      this.healthStatus = {
        network: this.config.network,
        healthy: false,
        latencyMs: 0,
        blockNumber: this.healthStatus.blockNumber,
        lastChecked: new Date(),
        errors: [(error as Error).message],
      };
    }

    return this.healthStatus;
  }

  /**
   * Get health status
   */
  getHealth(): ProviderHealth {
    return this.healthStatus;
  }
}

// =============================================================================
// PROVIDER MANAGER
// =============================================================================

/**
 * Manages multiple blockchain providers
 */
export class ProviderManager {
  private providers: Map<ChainNetwork, BlockchainProvider> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  /**
   * Get or create provider for network
   */
  getProvider(network: ChainNetwork): BlockchainProvider {
    let provider = this.providers.get(network);
    if (!provider) {
      provider = new BlockchainProvider(network);
      this.providers.set(network, provider);
    }
    return provider;
  }

  /**
   * Get all active providers
   */
  getAllProviders(): Map<ChainNetwork, BlockchainProvider> {
    return this.providers;
  }

  /**
   * Start health check monitoring
   */
  startHealthChecks(intervalMs: number = 60000): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const [network, provider] of this.providers) {
        try {
          await provider.checkHealth();
        } catch (error) {
          logger.error(
            { network, error: (error as Error).message },
            'Health check failed'
          );
        }
      }
    }, intervalMs);
  }

  /**
   * Stop health check monitoring
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Get all provider health statuses
   */
  async checkAllHealth(): Promise<Map<ChainNetwork, ProviderHealth>> {
    const results = new Map<ChainNetwork, ProviderHealth>();

    await Promise.all(
      Array.from(this.providers.entries()).map(async ([network, provider]) => {
        const health = await provider.checkHealth();
        results.set(network, health);
      })
    );

    return results;
  }
}

/**
 * Singleton provider manager instance
 */
export const providerManager = new ProviderManager();

/**
 * Get chain configuration by network
 */
export function getChainConfig(network: ChainNetwork): ChainConfig {
  const config = CHAIN_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }
  return config;
}

/**
 * Get explorer URL for transaction
 */
export function getExplorerUrl(network: ChainNetwork, txHash: string): string {
  const config = CHAIN_CONFIGS[network];
  return `${config.explorerUrl}/tx/${txHash}`;
}
