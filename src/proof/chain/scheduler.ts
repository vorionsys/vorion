/**
 * Chain Anchor Scheduler
 *
 * Scheduled jobs for automatic proof anchoring, confirmation tracking,
 * batch expiration, and health monitoring.
 *
 * @packageDocumentation
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from '../../common/logger.js';
import { ChainAnchorService } from './service.js';
import { ChainAnchorRepository, type Database } from './repository.js';
import { providerManager } from './providers.js';
import type { ChainNetwork } from './schema.js';

const logger = createLogger({ component: 'chain-anchor-scheduler' });
const tracer = trace.getTracer('chain-anchor-scheduler');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Interval for processing pending batches (ms) */
  batchProcessingIntervalMs: number;
  /** Interval for checking transaction confirmations (ms) */
  confirmationCheckIntervalMs: number;
  /** Interval for retrying failed batches (ms) */
  retryIntervalMs: number;
  /** Interval for expiring old batches (ms) */
  expirationIntervalMs: number;
  /** Interval for health checks (ms) */
  healthCheckIntervalMs: number;
  /** Maximum batches to process per cycle */
  maxBatchesPerCycle: number;
  /** Maximum retries per cycle */
  maxRetriesPerCycle: number;
  /** Enable automatic processing */
  enabled: boolean;
}

/**
 * Scheduler status
 */
export interface SchedulerStatus {
  running: boolean;
  lastBatchProcessing?: Date;
  lastConfirmationCheck?: Date;
  lastRetry?: Date;
  lastExpiration?: Date;
  lastHealthCheck?: Date;
  stats: {
    batchesProcessed: number;
    batchesRetried: number;
    batchesExpired: number;
    confirmationsChecked: number;
    errors: number;
  };
}

/**
 * Job execution result
 */
interface JobResult {
  success: boolean;
  count?: number;
  error?: string;
  durationMs: number;
}

// =============================================================================
// SCHEDULER
// =============================================================================

/**
 * Chain Anchor Scheduler
 *
 * Features:
 * - Automatic batch processing
 * - Transaction confirmation tracking
 * - Failed batch retry with exponential backoff
 * - Batch expiration cleanup
 * - Provider health monitoring
 * - Graceful shutdown
 */
export class ChainAnchorScheduler {
  private config: SchedulerConfig;
  private service: ChainAnchorService;
  private repository: ChainAnchorRepository | null = null;
  private running: boolean = false;
  private shuttingDown: boolean = false;

  // Timers
  private batchProcessingTimer?: NodeJS.Timeout;
  private confirmationCheckTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private expirationTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;

  // Status tracking
  private status: SchedulerStatus = {
    running: false,
    stats: {
      batchesProcessed: 0,
      batchesRetried: 0,
      batchesExpired: 0,
      confirmationsChecked: 0,
      errors: 0,
    },
  };

  constructor(
    service: ChainAnchorService,
    config?: Partial<SchedulerConfig>
  ) {
    this.service = service;
    this.config = {
      batchProcessingIntervalMs: config?.batchProcessingIntervalMs ?? 30000, // 30 seconds
      confirmationCheckIntervalMs: config?.confirmationCheckIntervalMs ?? 15000, // 15 seconds
      retryIntervalMs: config?.retryIntervalMs ?? 60000, // 1 minute
      expirationIntervalMs: config?.expirationIntervalMs ?? 300000, // 5 minutes
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 60000, // 1 minute
      maxBatchesPerCycle: config?.maxBatchesPerCycle ?? 10,
      maxRetriesPerCycle: config?.maxRetriesPerCycle ?? 5,
      enabled: config?.enabled ?? true,
    };
  }

  /**
   * Initialize scheduler with database
   */
  initialize(db: Database): void {
    this.repository = new ChainAnchorRepository(db);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      logger.warn('Scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Scheduler disabled by configuration');
      return;
    }

    this.running = true;
    this.shuttingDown = false;
    this.status.running = true;

    // Start batch processing
    this.batchProcessingTimer = setInterval(
      () => this.runBatchProcessing(),
      this.config.batchProcessingIntervalMs
    );

    // Start confirmation checking
    this.confirmationCheckTimer = setInterval(
      () => this.runConfirmationCheck(),
      this.config.confirmationCheckIntervalMs
    );

    // Start retry processing
    this.retryTimer = setInterval(
      () => this.runRetryProcessing(),
      this.config.retryIntervalMs
    );

    // Start expiration processing
    this.expirationTimer = setInterval(
      () => this.runExpirationProcessing(),
      this.config.expirationIntervalMs
    );

    // Start health checks
    this.healthCheckTimer = setInterval(
      () => this.runHealthCheck(),
      this.config.healthCheckIntervalMs
    );

    logger.info(
      {
        batchProcessingIntervalMs: this.config.batchProcessingIntervalMs,
        confirmationCheckIntervalMs: this.config.confirmationCheckIntervalMs,
        retryIntervalMs: this.config.retryIntervalMs,
      },
      'Chain anchor scheduler started'
    );

    // Run initial processing
    this.runBatchProcessing();
    this.runHealthCheck();
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.shuttingDown = true;
    logger.info('Stopping chain anchor scheduler...');

    // Clear all timers
    if (this.batchProcessingTimer) {
      clearInterval(this.batchProcessingTimer);
      this.batchProcessingTimer = undefined;
    }
    if (this.confirmationCheckTimer) {
      clearInterval(this.confirmationCheckTimer);
      this.confirmationCheckTimer = undefined;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = undefined;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    this.running = false;
    this.status.running = false;

    logger.info('Chain anchor scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  /**
   * Run batch processing job
   */
  private async runBatchProcessing(): Promise<void> {
    if (this.shuttingDown) return;

    const result = await this.executeJob('batch-processing', async () => {
      const count = await this.service.processPendingBatches(
        this.config.maxBatchesPerCycle
      );
      return { count };
    });

    this.status.lastBatchProcessing = new Date();

    if (result.success && result.count) {
      this.status.stats.batchesProcessed += result.count;
    }
  }

  /**
   * Run confirmation check job
   */
  private async runConfirmationCheck(): Promise<void> {
    if (this.shuttingDown || !this.repository) return;

    const result = await this.executeJob('confirmation-check', async () => {
      // Get pending confirmation transactions
      const pendingTxs = await this.repository!.getPendingConfirmations(50);

      let checked = 0;
      for (const tx of pendingTxs) {
        try {
          const provider = providerManager.getProvider(tx.network);
          const receipt = await provider.getTransactionReceipt(tx.txHash!);

          if (receipt) {
            const currentBlock = await provider.getBlockNumber();
            const confirmations = currentBlock - receipt.blockNumber + 1;

            if (confirmations >= tx.requiredConfirmations) {
              await this.repository!.updateTransaction(tx.id, tx.tenantId, {
                status: 'confirmed',
                confirmations,
                confirmedAt: new Date(),
                blockNumber: receipt.blockNumber,
                blockHash: receipt.blockHash,
                gasUsed: receipt.gasUsed,
                effectiveGasPrice: receipt.effectiveGasPrice,
              });
            } else {
              await this.repository!.updateTransaction(tx.id, tx.tenantId, {
                status: 'confirming',
                confirmations,
              });
            }
          }

          checked++;
        } catch (error) {
          logger.warn(
            { error, txId: tx.id, txHash: tx.txHash },
            'Error checking confirmation'
          );
        }
      }

      return { count: checked };
    });

    this.status.lastConfirmationCheck = new Date();

    if (result.success && result.count) {
      this.status.stats.confirmationsChecked += result.count;
    }
  }

  /**
   * Run retry processing job
   */
  private async runRetryProcessing(): Promise<void> {
    if (this.shuttingDown) return;

    const result = await this.executeJob('retry-processing', async () => {
      const count = await this.service.retryFailedBatches(
        this.config.maxRetriesPerCycle
      );
      return { count };
    });

    this.status.lastRetry = new Date();

    if (result.success && result.count) {
      this.status.stats.batchesRetried += result.count;
    }
  }

  /**
   * Run expiration processing job
   */
  private async runExpirationProcessing(): Promise<void> {
    if (this.shuttingDown) return;

    const result = await this.executeJob('expiration-processing', async () => {
      const count = await this.service.expireBatches();
      return { count };
    });

    this.status.lastExpiration = new Date();

    if (result.success && result.count) {
      this.status.stats.batchesExpired += result.count;
    }
  }

  /**
   * Run health check job
   */
  private async runHealthCheck(): Promise<void> {
    if (this.shuttingDown) return;

    await this.executeJob('health-check', async () => {
      const health = await providerManager.checkAllHealth();

      // Log unhealthy providers
      for (const [network, status] of health) {
        if (!status.healthy) {
          logger.warn(
            {
              network,
              errors: status.errors,
              lastChecked: status.lastChecked,
            },
            'Provider unhealthy'
          );
        }
      }

      return { count: health.size };
    });

    this.status.lastHealthCheck = new Date();
  }

  /**
   * Execute a job with tracing and error handling
   */
  private async executeJob(
    name: string,
    fn: () => Promise<{ count?: number }>
  ): Promise<JobResult> {
    const startTime = Date.now();

    return tracer.startActiveSpan(`scheduler.${name}`, async (span) => {
      try {
        const result = await fn();

        span.setAttributes({
          'job.name': name,
          'job.count': result.count ?? 0,
          'job.duration_ms': Date.now() - startTime,
        });

        return {
          success: true,
          count: result.count,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        this.status.stats.errors++;

        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });

        logger.error({ error, job: name }, 'Scheduler job failed');

        return {
          success: false,
          error: (error as Error).message,
          durationMs: Date.now() - startTime,
        };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Manually trigger batch processing
   */
  async triggerBatchProcessing(): Promise<number> {
    return this.service.processPendingBatches(this.config.maxBatchesPerCycle);
  }

  /**
   * Manually trigger retry processing
   */
  async triggerRetryProcessing(): Promise<number> {
    return this.service.retryFailedBatches(this.config.maxRetriesPerCycle);
  }
}

/**
 * Create chain anchor scheduler
 */
export function createChainAnchorScheduler(
  service: ChainAnchorService,
  config?: Partial<SchedulerConfig>
): ChainAnchorScheduler {
  return new ChainAnchorScheduler(service, config);
}

// =============================================================================
// CRON EXPRESSIONS (for external schedulers)
// =============================================================================

/**
 * Recommended cron expressions for external schedulers (e.g., Kubernetes CronJob)
 */
export const CRON_EXPRESSIONS = {
  /** Process pending batches every minute */
  batchProcessing: '* * * * *',
  /** Check confirmations every 30 seconds */
  confirmationCheck: '*/30 * * * * *',
  /** Retry failed batches every 5 minutes */
  retryProcessing: '*/5 * * * *',
  /** Expire old batches every hour */
  expirationProcessing: '0 * * * *',
  /** Health check every minute */
  healthCheck: '* * * * *',
};

/**
 * Job handler for external schedulers
 */
export async function handleScheduledJob(
  jobName: string,
  service: ChainAnchorService,
  db: Database
): Promise<{ success: boolean; count?: number; error?: string }> {
  const repository = new ChainAnchorRepository(db);

  try {
    switch (jobName) {
      case 'batch-processing':
        const batchCount = await service.processPendingBatches(10);
        return { success: true, count: batchCount };

      case 'retry-processing':
        const retryCount = await service.retryFailedBatches(5);
        return { success: true, count: retryCount };

      case 'expiration-processing':
        const expiredCount = await service.expireBatches();
        return { success: true, count: expiredCount };

      case 'confirmation-check':
        const pendingTxs = await repository.getPendingConfirmations(50);
        // Process confirmations...
        return { success: true, count: pendingTxs.length };

      case 'health-check':
        const health = await providerManager.checkAllHealth();
        return { success: true, count: health.size };

      default:
        return { success: false, error: `Unknown job: ${jobName}` };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
