/**
 * Cognigate Resource Tracker
 *
 * Local resource tracking with polling for memory and CPU usage.
 * Uses AbortController for termination signaling.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/resource-tracker
 */

import { createLogger } from '../common/logger.js';
import type { ID } from '../common/types.js';
import type { ResourceLimits, ResourceUsage, ResourceStateProvider, TerminationReason } from './types.js';

const logger = createLogger({ component: 'cognigate-resource-tracker' });

/**
 * Default polling interval for resource monitoring (100ms)
 */
const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Resource tracker options
 */
export interface ResourceTrackerOptions {
  /** Polling interval in milliseconds (default: 100ms) */
  pollIntervalMs?: number;
  /** Resource state provider for distributed tracking */
  stateProvider?: ResourceStateProvider;
}

/**
 * Resource tracker for monitoring execution resource usage.
 *
 * Features:
 * - Polls memory via process.memoryUsage() at configurable intervals
 * - Tracks CPU via process.cpuUsage() deltas
 * - Uses AbortController for termination signaling
 * - Reports to optional distributed state provider
 */
export class ResourceTracker {
  private readonly executionId: ID;
  private readonly limits: ResourceLimits;
  private readonly pollIntervalMs: number;
  private readonly stateProvider?: ResourceStateProvider;
  private readonly abortController: AbortController;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private totalCpuTimeMs: number = 0;
  private peakMemoryMb: number = 0;
  private terminated: boolean = false;
  private terminationReason?: TerminationReason;

  constructor(
    executionId: ID,
    limits: ResourceLimits,
    options: ResourceTrackerOptions = {}
  ) {
    this.executionId = executionId;
    this.limits = limits;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stateProvider = options.stateProvider;
    this.abortController = new AbortController();
  }

  /**
   * Get the abort signal for termination
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Check if execution has been terminated
   */
  isTerminated(): boolean {
    return this.terminated;
  }

  /**
   * Get termination reason if terminated
   */
  getTerminationReason(): TerminationReason | undefined {
    return this.terminationReason;
  }

  /**
   * Start resource tracking
   */
  async start(): Promise<void> {
    if (this.pollTimer) {
      logger.warn({ executionId: this.executionId }, 'Resource tracker already started');
      return;
    }

    this.startTime = Date.now();
    this.lastCpuUsage = process.cpuUsage();

    // Initialize distributed state if provider available
    if (this.stateProvider) {
      await this.stateProvider.initExecution(
        this.executionId,
        this.limits,
        this.limits.timeoutMs + 60000 // TTL with buffer
      );
    }

    // Start polling
    this.pollTimer = setInterval(() => {
      this.poll().catch((error) => {
        logger.error(
          { executionId: this.executionId, error },
          'Resource polling error'
        );
      });
    }, this.pollIntervalMs);

    // Do initial poll immediately
    await this.poll();

    logger.debug(
      { executionId: this.executionId, limits: this.limits, pollIntervalMs: this.pollIntervalMs },
      'Resource tracking started'
    );
  }

  /**
   * Stop resource tracking
   */
  async stop(): Promise<ResourceUsage> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Final poll to capture latest metrics
    await this.poll();

    const wallTimeMs = Date.now() - this.startTime;

    // Get final metrics from distributed state if available
    if (this.stateProvider) {
      try {
        return await this.stateProvider.cleanupExecution(this.executionId);
      } catch (error) {
        logger.warn(
          { executionId: this.executionId, error },
          'Failed to cleanup distributed state, using local metrics'
        );
      }
    }

    // Return local metrics
    return {
      memoryPeakMb: this.peakMemoryMb,
      cpuTimeMs: this.totalCpuTimeMs,
      wallTimeMs,
      networkRequests: 0, // Network tracking handled by interceptors
      fileSystemOps: 0, // FS tracking handled by interceptors
    };
  }

  /**
   * Terminate execution with reason
   */
  terminate(reason: string, violation?: string): void {
    if (this.terminated) {
      return;
    }

    this.terminated = true;
    this.terminationReason = {
      violation: (violation as TerminationReason['violation']) ?? 'timeout_exceeded',
      reason,
      currentValue: 0,
      limit: 0,
      terminatedAt: new Date().toISOString(),
    };

    // Signal abort to any listeners
    this.abortController.abort(new Error(reason));

    logger.warn(
      { executionId: this.executionId, reason, violation },
      'Execution terminated'
    );
  }

  /**
   * Poll current resource usage
   */
  private async poll(): Promise<void> {
    if (this.terminated) {
      return;
    }

    // Sample memory usage
    const memUsage = process.memoryUsage();
    const currentMemoryMb = memUsage.heapUsed / (1024 * 1024);

    if (currentMemoryMb > this.peakMemoryMb) {
      this.peakMemoryMb = currentMemoryMb;
    }

    // Calculate CPU time delta
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage ?? undefined);
    const cpuDeltaMs = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
    this.totalCpuTimeMs += cpuDeltaMs;
    this.lastCpuUsage = process.cpuUsage();

    // Report to distributed state
    if (this.stateProvider) {
      try {
        await Promise.all([
          this.stateProvider.recordMemoryUsage(this.executionId, currentMemoryMb),
          cpuDeltaMs > 0 ? this.stateProvider.incrementCpuTime(this.executionId, cpuDeltaMs) : Promise.resolve(),
        ]);

        // Check if should terminate
        const result = await this.stateProvider.shouldTerminate(this.executionId, this.limits);
        if (result.terminate && !this.terminated) {
          this.terminate(result.reason ?? 'Resource limit exceeded', result.violation);
        }
      } catch (error) {
        logger.warn(
          { executionId: this.executionId, error },
          'Failed to report to distributed state'
        );
      }
    } else {
      // Local limit checking
      this.checkLocalLimits();
    }
  }

  /**
   * Check resource limits locally (when no distributed state provider)
   */
  private checkLocalLimits(): void {
    const wallTimeMs = Date.now() - this.startTime;

    // Check timeout
    if (wallTimeMs > this.limits.timeoutMs) {
      this.terminate(
        `Execution timeout exceeded: ${wallTimeMs}ms > ${this.limits.timeoutMs}ms`,
        'timeout_exceeded'
      );
      return;
    }

    // Check memory
    if (this.peakMemoryMb > this.limits.maxMemoryMb) {
      this.terminate(
        `Memory limit exceeded: ${this.peakMemoryMb.toFixed(2)}MB > ${this.limits.maxMemoryMb}MB`,
        'memory_exceeded'
      );
      return;
    }

    // Check CPU (percent of wall time)
    const allowedCpuMs = (this.limits.maxCpuPercent / 100) * wallTimeMs;
    if (this.totalCpuTimeMs > allowedCpuMs) {
      this.terminate(
        `CPU time limit exceeded: ${this.totalCpuTimeMs.toFixed(2)}ms > ${allowedCpuMs.toFixed(2)}ms (${this.limits.maxCpuPercent}% of wall time)`,
        'cpu_exceeded'
      );
    }
  }

  /**
   * Get current resource usage snapshot
   */
  getCurrentUsage(): ResourceUsage {
    return {
      memoryPeakMb: this.peakMemoryMb,
      cpuTimeMs: this.totalCpuTimeMs,
      wallTimeMs: Date.now() - this.startTime,
      networkRequests: 0,
      fileSystemOps: 0,
    };
  }
}

/**
 * Create a resource tracker instance
 */
export function createResourceTracker(
  executionId: ID,
  limits: ResourceLimits,
  options: ResourceTrackerOptions = {}
): ResourceTracker {
  return new ResourceTracker(executionId, limits, options);
}
