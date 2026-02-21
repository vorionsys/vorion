/**
 * In-Memory Queue Adapter
 *
 * Provides a queue implementation that runs entirely in memory,
 * suitable for development, testing, or single-instance deployments.
 *
 * Features:
 * - Job storage with Map
 * - Async processing with setImmediate
 * - Retry with exponential backoff
 * - Job lifecycle tracking (waiting, active, completed, failed)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import type {
  IQueueAdapter,
  QueueJobOptions,
  JobCounts,
  JobHandler,
  Job,
} from './types.js';

const logger = createLogger({ component: 'memory-queue' });

/**
 * Internal job representation with metadata
 */
interface InternalJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  options: QueueJobOptions;
  status: 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';
  attemptsMade: number;
  createdAt: number;
  processAt: number;
  error?: Error;
}

/**
 * Default job options
 */
const DEFAULT_JOB_OPTIONS: QueueJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};

/**
 * In-memory queue adapter implementation
 */
export class MemoryQueueAdapter implements IQueueAdapter {
  private jobs = new Map<string, InternalJob>();
  private handlers: JobHandler[] = [];
  private processing = false;
  private closed = false;
  private processTimer: NodeJS.Timeout | null = null;
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
    logger.debug({ queueName: name }, 'Memory queue created');
  }

  /**
   * Add a job to the queue
   */
  async add<T>(name: string, data: T, options?: QueueJobOptions): Promise<string> {
    if (this.closed) {
      throw new Error('Queue is closed');
    }

    const jobId = options?.jobId ?? randomUUID();
    const mergedOptions = { ...DEFAULT_JOB_OPTIONS, ...options };
    const now = Date.now();
    const delay = mergedOptions.delay ?? 0;

    const job: InternalJob<T> = {
      id: jobId,
      name,
      data,
      options: mergedOptions,
      status: delay > 0 ? 'delayed' : 'waiting',
      attemptsMade: 0,
      createdAt: now,
      processAt: now + delay,
    };

    this.jobs.set(jobId, job);

    logger.debug(
      { queueName: this.name, jobId, jobName: name, delay },
      'Job added to queue'
    );

    // Trigger processing
    this.scheduleProcessing();

    return jobId;
  }

  /**
   * Register a job handler
   */
  process<T>(handler: JobHandler<T>): void {
    this.handlers.push(handler as JobHandler);
    logger.debug({ queueName: this.name }, 'Handler registered');

    // Start processing if there are jobs
    this.scheduleProcessing();
  }

  /**
   * Get job counts by status
   */
  async getJobCounts(): Promise<JobCounts> {
    const counts: JobCounts = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };

    for (const job of this.jobs.values()) {
      counts[job.status]++;
    }

    return counts;
  }

  /**
   * Close the queue and stop processing
   */
  async close(): Promise<void> {
    this.closed = true;

    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }

    // Wait for active jobs to complete (with timeout)
    const startTime = Date.now();
    const timeout = 5000;

    while (this.processing && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.debug({ queueName: this.name }, 'Memory queue closed');
  }

  /**
   * Schedule job processing
   */
  private scheduleProcessing(): void {
    if (this.closed || this.processing || this.handlers.length === 0) {
      return;
    }

    // Use setImmediate for async processing
    this.processTimer = setTimeout(() => {
      void this.processJobs();
    }, 0);
  }

  /**
   * Process jobs in the queue
   */
  private async processJobs(): Promise<void> {
    if (this.closed || this.processing) {
      return;
    }

    this.processing = true;

    try {
      const now = Date.now();

      // Move delayed jobs to waiting if ready
      for (const job of this.jobs.values()) {
        if (job.status === 'delayed' && job.processAt <= now) {
          job.status = 'waiting';
        }
      }

      // Find next waiting job
      let nextJob: InternalJob | null = null;
      let lowestPriority = Infinity;

      for (const job of this.jobs.values()) {
        if (job.status === 'waiting') {
          const priority = job.options.priority ?? 0;
          if (priority < lowestPriority) {
            lowestPriority = priority;
            nextJob = job;
          }
        }
      }

      if (nextJob) {
        await this.processJob(nextJob);
      }
    } finally {
      this.processing = false;

      // Continue processing if there are more jobs
      if (!this.closed && this.hasWaitingJobs()) {
        this.scheduleProcessing();
      }
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: InternalJob): Promise<void> {
    job.status = 'active';
    job.attemptsMade++;

    const jobObj: Job = {
      id: job.id,
      data: job.data,
      attemptsMade: job.attemptsMade,
    };

    logger.debug(
      { queueName: this.name, jobId: job.id, attempt: job.attemptsMade },
      'Processing job'
    );

    try {
      // Run all handlers
      for (const handler of this.handlers) {
        await handler(jobObj);
      }

      job.status = 'completed';
      logger.debug({ queueName: this.name, jobId: job.id }, 'Job completed');

      // Clean up completed jobs after a delay
      setTimeout(() => {
        if (job.status === 'completed') {
          this.jobs.delete(job.id);
        }
      }, 60000); // Keep for 1 minute
    } catch (error) {
      job.error = error instanceof Error ? error : new Error(String(error));

      const maxAttempts = job.options.attempts ?? 3;

      if (job.attemptsMade >= maxAttempts) {
        job.status = 'failed';
        logger.error(
          { queueName: this.name, jobId: job.id, error: job.error.message },
          'Job failed after max retries'
        );
      } else {
        // Schedule retry with backoff
        const backoff = job.options.backoff ?? { type: 'exponential', delay: 1000 };
        let delay: number;

        if (backoff.type === 'exponential') {
          delay = backoff.delay * Math.pow(2, job.attemptsMade - 1);
        } else {
          delay = backoff.delay;
        }

        job.status = 'delayed';
        job.processAt = Date.now() + delay;

        logger.debug(
          { queueName: this.name, jobId: job.id, retryIn: delay },
          'Job scheduled for retry'
        );

        // Schedule delayed processing
        setTimeout(() => {
          if (!this.closed) {
            this.scheduleProcessing();
          }
        }, delay);
      }
    }
  }

  /**
   * Check if there are waiting jobs
   */
  private hasWaitingJobs(): boolean {
    for (const job of this.jobs.values()) {
      if (job.status === 'waiting') {
        return true;
      }
    }
    return false;
  }
}

/**
 * Factory function to create a memory queue adapter
 */
export function createMemoryQueueAdapter(name: string): IQueueAdapter {
  return new MemoryQueueAdapter(name);
}
