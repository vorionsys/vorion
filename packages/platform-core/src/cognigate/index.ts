/**
 * Cognigate - Constrained Execution Runtime
 *
 * Executes approved intents within defined constraints and resource limits.
 * Provides resource monitoring, memory tracking, and graceful termination.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { Intent, Decision, ID } from '../common/types.js';

const logger = createLogger({ component: 'cognigate' });

/**
 * Degradation levels for graceful degradation
 * Instead of hard termination, we progressively reduce capabilities
 */
export enum DegradationLevel {
  /** Normal operation - full capabilities */
  NONE = 'none',
  /** Warning issued - monitoring increased */
  WARN = 'warn',
  /** Resources throttled to 50% */
  THROTTLE = 'throttle',
  /** Capabilities restricted - read-only mode */
  RESTRICT = 'restrict',
  /** Execution suspended - awaiting human review */
  SUSPEND = 'suspend',
}

/**
 * Degradation event emitted when an execution is degraded
 */
export interface DegradationEvent {
  intentId: ID;
  previousLevel: DegradationLevel;
  newLevel: DegradationLevel;
  reason: string;
  timestamp: string;
  resourceUsage: ResourceUsage;
}

/**
 * Callback for degradation events
 */
export type DegradationCallback = (event: DegradationEvent) => void | Promise<void>;

/**
 * Active execution tracking for termination and degradation support
 */
interface ActiveExecution {
  intentId: ID;
  abortController: AbortController;
  startedAt: number;
  memoryBaseline: number;
  memoryPeak: number;
  monitorInterval: NodeJS.Timeout | null;
  /** Current degradation level */
  degradationLevel: DegradationLevel;
  /** Original resource limits before any degradation */
  originalLimits: ResourceLimits;
  /** Current effective limits (may be reduced) */
  effectiveLimits: ResourceLimits;
  /** Number of warnings issued */
  warningCount: number;
}

/**
 * Execution context for running an intent
 */
export interface ExecutionContext {
  intent: Intent;
  decision: Decision;
  resourceLimits: ResourceLimits;
}

/**
 * Resource limits for execution
 */
export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuPercent: number;
  timeoutMs: number;
  maxNetworkRequests?: number;
  maxFileSystemOps?: number;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  intentId: ID;
  success: boolean;
  outputs: Record<string, unknown>;
  resourceUsage: ResourceUsage;
  startedAt: string;
  completedAt: string;
  error?: string;
}

/**
 * Resource usage metrics
 */
export interface ResourceUsage {
  memoryPeakMb: number;
  cpuTimeMs: number;
  wallTimeMs: number;
  networkRequests: number;
  fileSystemOps: number;
}

/**
 * Execution handler function type
 */
export type ExecutionHandler = (
  intent: Intent,
  context: Record<string, unknown>
) => Promise<Record<string, unknown>>;

/**
 * Cognigate execution gateway
 */
export class CognigateGateway {
  private handlers: Map<string, ExecutionHandler> = new Map();
  private activeExecutions: Map<ID, ActiveExecution> = new Map();
  private defaultLimits: ResourceLimits;
  private degradationCallbacks: DegradationCallback[] = [];

  constructor(defaultLimits?: Partial<ResourceLimits>) {
    this.defaultLimits = {
      maxMemoryMb: 512,
      maxCpuPercent: 50,
      timeoutMs: 300000,
      maxNetworkRequests: 100,
      maxFileSystemOps: 1000,
      ...defaultLimits,
    };
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsageMb(): number {
    const usage = process.memoryUsage();
    return Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
  }

  /**
   * Start memory monitoring for an execution with graceful degradation support
   */
  private startMemoryMonitor(
    intentId: ID,
    limits: ResourceLimits,
    abortController: AbortController
  ): ActiveExecution {
    const baseline = this.getMemoryUsageMb();
    const execution: ActiveExecution = {
      intentId,
      abortController,
      startedAt: performance.now(),
      memoryBaseline: baseline,
      memoryPeak: baseline,
      monitorInterval: null,
      degradationLevel: DegradationLevel.NONE,
      originalLimits: { ...limits },
      effectiveLimits: { ...limits },
      warningCount: 0,
    };

    // Monitor memory every 100ms with graduated response
    execution.monitorInterval = setInterval(() => {
      const currentMemory = this.getMemoryUsageMb();
      const usedMemory = currentMemory - execution.memoryBaseline;

      if (usedMemory > execution.memoryPeak - execution.memoryBaseline) {
        execution.memoryPeak = currentMemory;
      }

      const memoryPercent = usedMemory / execution.effectiveLimits.maxMemoryMb;

      // Graduated response based on memory usage
      if (memoryPercent >= 1.0 && execution.degradationLevel !== DegradationLevel.SUSPEND) {
        // At or over limit - suspend (but don't terminate)
        this.applyDegradation(execution, DegradationLevel.SUSPEND,
          `Memory limit exceeded: ${usedMemory.toFixed(1)}MB >= ${execution.effectiveLimits.maxMemoryMb}MB`);
      } else if (memoryPercent >= 0.9 && execution.degradationLevel === DegradationLevel.NONE) {
        // 90% - throttle resources
        this.applyDegradation(execution, DegradationLevel.THROTTLE,
          `Memory at 90%: ${usedMemory.toFixed(1)}MB / ${execution.effectiveLimits.maxMemoryMb}MB`);
      } else if (memoryPercent >= 0.75 && execution.degradationLevel === DegradationLevel.NONE) {
        // 75% - warn
        this.applyDegradation(execution, DegradationLevel.WARN,
          `Memory at 75%: ${usedMemory.toFixed(1)}MB / ${execution.effectiveLimits.maxMemoryMb}MB`);
      }
    }, 100);

    this.activeExecutions.set(intentId, execution);
    return execution;
  }

  /**
   * Stop memory monitoring for an execution
   */
  private stopMemoryMonitor(intentId: ID): ActiveExecution | undefined {
    const execution = this.activeExecutions.get(intentId);
    if (execution?.monitorInterval) {
      clearInterval(execution.monitorInterval);
      execution.monitorInterval = null;
    }
    this.activeExecutions.delete(intentId);
    return execution;
  }

  /**
   * Register an execution handler for an intent type
   */
  registerHandler(intentType: string, handler: ExecutionHandler): void {
    this.handlers.set(intentType, handler);
    logger.info({ intentType }, 'Handler registered');
  }

  /**
   * Execute an approved intent
   */
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { intent, decision } = context;
    const startedAt = new Date().toISOString();

    // Verify decision allows execution
    if (decision.action !== 'allow') {
      logger.warn(
        { intentId: intent.id, action: decision.action },
        'Execution blocked by decision'
      );

      return {
        intentId: intent.id,
        success: false,
        outputs: {},
        resourceUsage: this.emptyUsage(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: `Execution not allowed: ${decision.action}`,
      };
    }

    // Get handler
    const intentType = (intent.context['type'] as string) ?? 'default';
    const handler = this.handlers.get(intentType);

    if (!handler) {
      logger.warn({ intentId: intent.id, intentType }, 'No handler found');

      return {
        intentId: intent.id,
        success: false,
        outputs: {},
        resourceUsage: this.emptyUsage(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: `No handler for intent type: ${intentType}`,
      };
    }

    // Execute with limits and resource monitoring
    const limits = { ...this.defaultLimits, ...context.resourceLimits };
    const abortController = new AbortController();
    const execution = this.startMemoryMonitor(intent.id, limits, abortController);

    try {
      const execStart = performance.now();

      // Execute with abort signal support
      const outputs = await Promise.race([
        this.executeWithAbort(handler, intent, intent.context, abortController.signal),
        this.timeout(limits.timeoutMs, abortController),
      ]);

      const execEnd = performance.now();
      const finalExecution = this.stopMemoryMonitor(intent.id);
      const memoryUsed = (finalExecution?.memoryPeak ?? execution.memoryPeak) - execution.memoryBaseline;

      logger.info(
        {
          intentId: intent.id,
          durationMs: execEnd - execStart,
          memoryPeakMb: Math.max(0, memoryUsed),
        },
        'Execution completed'
      );

      return {
        intentId: intent.id,
        success: true,
        outputs: outputs as Record<string, unknown>,
        resourceUsage: {
          memoryPeakMb: Math.max(0, memoryUsed),
          cpuTimeMs: execEnd - execStart,
          wallTimeMs: execEnd - execStart,
          networkRequests: 0, // Would need handler instrumentation to track
          fileSystemOps: 0,   // Would need handler instrumentation to track
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.stopMemoryMonitor(intent.id);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const wasAborted = abortController.signal.aborted;

      logger.error(
        { intentId: intent.id, error: errorMessage, aborted: wasAborted },
        'Execution failed'
      );

      return {
        intentId: intent.id,
        success: false,
        outputs: {},
        resourceUsage: this.emptyUsage(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: wasAborted ? `Terminated: ${errorMessage}` : errorMessage,
      };
    }
  }

  /**
   * Execute handler with abort signal support
   */
  private async executeWithAbort(
    handler: ExecutionHandler,
    intent: Intent,
    context: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    // Check if already aborted
    if (signal.aborted) {
      throw new Error('Execution aborted before start');
    }

    // Create abort-aware promise
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        reject(new Error(signal.reason?.message ?? 'Execution aborted'));
      };

      signal.addEventListener('abort', abortHandler, { once: true });

      handler(intent, context)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          signal.removeEventListener('abort', abortHandler);
        });
    });
  }

  /**
   * Create a timeout promise that also aborts the execution
   */
  private timeout(ms: number, abortController: AbortController): Promise<never> {
    return new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        abortController.abort(new Error('Execution timeout'));
        reject(new Error('Execution timeout'));
      }, ms);

      // Clean up timeout if aborted externally
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
      }, { once: true });
    });
  }

  /**
   * Create empty resource usage
   */
  private emptyUsage(): ResourceUsage {
    return {
      memoryPeakMb: 0,
      cpuTimeMs: 0,
      wallTimeMs: 0,
      networkRequests: 0,
      fileSystemOps: 0,
    };
  }

  /**
   * Terminate an execution (kill switch)
   *
   * @param intentId - The intent ID to terminate
   * @returns true if the execution was found and terminated, false if not found
   */
  async terminate(intentId: ID): Promise<boolean> {
    const execution = this.activeExecutions.get(intentId);

    if (!execution) {
      logger.warn({ intentId }, 'Terminate requested but execution not found');
      return false;
    }

    logger.warn({ intentId, elapsedMs: performance.now() - execution.startedAt }, 'Terminating execution');

    // Abort the execution
    execution.abortController.abort(new Error('Execution terminated by request'));

    // Clean up
    this.stopMemoryMonitor(intentId);

    return true;
  }

  /**
   * Get the number of active executions
   */
  getActiveExecutionCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Get IDs of all active executions
   */
  getActiveExecutionIds(): ID[] {
    return Array.from(this.activeExecutions.keys());
  }

  /**
   * Check if an execution is active
   */
  isExecutionActive(intentId: ID): boolean {
    return this.activeExecutions.has(intentId);
  }

  /**
   * Register a callback for degradation events
   */
  onDegradation(callback: DegradationCallback): void {
    this.degradationCallbacks.push(callback);
  }

  /**
   * Apply a degradation level to an execution
   * This is the core of graceful degradation - instead of terminating,
   * we progressively reduce capabilities
   */
  private applyDegradation(
    execution: ActiveExecution,
    level: DegradationLevel,
    reason: string
  ): void {
    const previousLevel = execution.degradationLevel;

    // Only escalate degradation, never reduce it automatically
    if (this.getDegradationSeverity(level) <= this.getDegradationSeverity(previousLevel)) {
      return;
    }

    execution.degradationLevel = level;
    execution.warningCount++;

    // Apply resource reductions based on level
    switch (level) {
      case DegradationLevel.WARN:
        // No resource changes, just log
        logger.warn(
          { intentId: execution.intentId, level, reason },
          'Execution degraded to WARN level'
        );
        break;

      case DegradationLevel.THROTTLE:
        // Reduce limits to 50%
        execution.effectiveLimits = {
          ...execution.effectiveLimits,
          maxMemoryMb: execution.originalLimits.maxMemoryMb * 0.5,
          maxNetworkRequests: Math.floor((execution.originalLimits.maxNetworkRequests ?? 100) * 0.5),
          maxFileSystemOps: Math.floor((execution.originalLimits.maxFileSystemOps ?? 1000) * 0.5),
        };
        logger.warn(
          { intentId: execution.intentId, level, reason, effectiveLimits: execution.effectiveLimits },
          'Execution throttled to 50% resources'
        );
        break;

      case DegradationLevel.RESTRICT:
        // Severely restrict - 25% resources
        execution.effectiveLimits = {
          ...execution.effectiveLimits,
          maxMemoryMb: execution.originalLimits.maxMemoryMb * 0.25,
          maxNetworkRequests: Math.floor((execution.originalLimits.maxNetworkRequests ?? 100) * 0.1),
          maxFileSystemOps: Math.floor((execution.originalLimits.maxFileSystemOps ?? 1000) * 0.1),
        };
        logger.warn(
          { intentId: execution.intentId, level, reason },
          'Execution restricted to minimal resources'
        );
        break;

      case DegradationLevel.SUSPEND:
        // Don't terminate, but mark as suspended for human review
        logger.error(
          { intentId: execution.intentId, level, reason },
          'Execution suspended - awaiting human review'
        );
        break;
    }

    // Emit degradation event
    const event: DegradationEvent = {
      intentId: execution.intentId,
      previousLevel,
      newLevel: level,
      reason,
      timestamp: new Date().toISOString(),
      resourceUsage: {
        memoryPeakMb: Math.max(0, execution.memoryPeak - execution.memoryBaseline),
        cpuTimeMs: performance.now() - execution.startedAt,
        wallTimeMs: performance.now() - execution.startedAt,
        networkRequests: 0,
        fileSystemOps: 0,
      },
    };

    // Notify callbacks asynchronously
    for (const callback of this.degradationCallbacks) {
      Promise.resolve(callback(event)).catch(err => {
        logger.error({ error: err }, 'Degradation callback error');
      });
    }
  }

  /**
   * Get numeric severity for degradation level comparison
   */
  private getDegradationSeverity(level: DegradationLevel): number {
    const severities: Record<DegradationLevel, number> = {
      [DegradationLevel.NONE]: 0,
      [DegradationLevel.WARN]: 1,
      [DegradationLevel.THROTTLE]: 2,
      [DegradationLevel.RESTRICT]: 3,
      [DegradationLevel.SUSPEND]: 4,
    };
    return severities[level];
  }

  /**
   * Manually degrade an execution (e.g., from policy violation)
   * This allows external systems (BASIS, escalation) to degrade executions
   *
   * @param intentId - The intent ID to degrade
   * @param level - The degradation level to apply
   * @param reason - Human-readable reason for degradation
   * @returns true if degradation was applied, false if execution not found
   */
  degrade(intentId: ID, level: DegradationLevel, reason: string): boolean {
    const execution = this.activeExecutions.get(intentId);

    if (!execution) {
      logger.warn({ intentId }, 'Degrade requested but execution not found');
      return false;
    }

    this.applyDegradation(execution, level, reason);
    return true;
  }

  /**
   * Get the current degradation level of an execution
   */
  getDegradationLevel(intentId: ID): DegradationLevel | undefined {
    return this.activeExecutions.get(intentId)?.degradationLevel;
  }

  /**
   * Get effective (possibly reduced) limits for an execution
   */
  getEffectiveLimits(intentId: ID): ResourceLimits | undefined {
    return this.activeExecutions.get(intentId)?.effectiveLimits;
  }

  /**
   * Restore an execution from suspension (requires human approval)
   * This is called after HITL review approves continuation
   *
   * @param intentId - The intent ID to restore
   * @param newLimits - Optional new limits to apply
   * @returns true if restored, false if execution not found or not suspended
   */
  restore(intentId: ID, newLimits?: Partial<ResourceLimits>): boolean {
    const execution = this.activeExecutions.get(intentId);

    if (!execution) {
      logger.warn({ intentId }, 'Restore requested but execution not found');
      return false;
    }

    if (execution.degradationLevel !== DegradationLevel.SUSPEND) {
      logger.warn(
        { intentId, currentLevel: execution.degradationLevel },
        'Restore requested but execution not suspended'
      );
      return false;
    }

    // Reset to WARN level (still under observation)
    execution.degradationLevel = DegradationLevel.WARN;
    execution.effectiveLimits = {
      ...execution.originalLimits,
      ...newLimits,
    };

    logger.info(
      { intentId, effectiveLimits: execution.effectiveLimits },
      'Execution restored from suspension'
    );

    return true;
  }
}

/**
 * Create a new Cognigate gateway instance
 */
export function createGateway(
  defaultLimits?: Partial<ResourceLimits>
): CognigateGateway {
  return new CognigateGateway(defaultLimits);
}

// Re-export sandbox module
export * from './sandbox/index.js';
