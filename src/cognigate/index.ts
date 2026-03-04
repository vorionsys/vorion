/**
 * Cognigate - Constrained Execution Runtime
 *
 * Executes approved intents within defined constraints and resource limits.
 * Features:
 * - Resource limiting (memory, CPU, timeout, network, filesystem)
 * - Output validation with PII detection and sanitization
 * - Distributed state tracking via Redis
 * - Prometheus metrics for observability
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { secureRandomString } from '../common/random.js';
import type { Intent, Decision, ID } from '../common/types.js';
import type { OutputBinding } from '../semantic-governance/types.js';

// Import types from types.ts
import type {
  ResourceLimits,
  ResourceUsage,
  ResourceStateProvider,
  OutputValidationOptions,
  TerminationReason,
} from './types.js';

// Import resource tracking components
import { ResourceTracker, createResourceTracker } from './resource-tracker.js';
import { createResourceStateProvider, RedisResourceStateProvider } from './resource-state-provider.js';
import { createExecutionInterceptors, ResourceLimitExceededError, type ExecutionInterceptors } from './resource-interceptors.js';
import { OutputIntegrator, createStrictOutputIntegrator, createPermissiveOutputIntegrator } from './output-integration.js';

// Import metrics
import {
  recordExecutionStart,
  recordExecutionComplete,
  recordResourceUsage,
  recordResourceViolation,
  recordTermination,
  recordOutputValidation,
  recordPIIDetection,
  recordOutputSanitization,
  recordProhibitedPattern,
} from './metrics.js';

const logger = createLogger({ component: 'cognigate' });

// Re-export types for consumers
export type { ResourceLimits, ResourceUsage, OutputValidationOptions, TerminationReason };
export { ResourceTracker, createResourceTracker };
export { RedisResourceStateProvider, createResourceStateProvider };
export { ResourceLimitExceededError };
export { OutputIntegrator, createStrictOutputIntegrator, createPermissiveOutputIntegrator };

/**
 * Execution context for running an intent
 */
export interface ExecutionContext {
  intent: Intent;
  decision: Decision;
  resourceLimits: ResourceLimits;
  /** Output validation options */
  outputValidation?: OutputValidationOptions;
  /** Output binding for schema validation */
  outputBinding?: OutputBinding;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  intentId: ID;
  executionId: ID;
  success: boolean;
  outputs: Record<string, unknown>;
  resourceUsage: ResourceUsage;
  startedAt: string;
  completedAt: string;
  error?: string;
  /** Whether execution was terminated due to resource limits */
  terminated?: boolean;
  /** Termination reason if applicable */
  terminationReason?: TerminationReason;
  /** Output validation result */
  outputValidation?: {
    valid: boolean;
    piiDetected: boolean;
    piiTypes: string[];
    sanitized: boolean;
  };
}

/**
 * Execution handler function type.
 * Handlers receive interceptors for sandboxed network/filesystem access.
 */
export type ExecutionHandler = (
  intent: Intent,
  context: Record<string, unknown>,
  interceptors?: ExecutionInterceptors
) => Promise<Record<string, unknown>>;

/**
 * Active execution tracking
 */
interface ActiveExecution {
  executionId: ID;
  intentId: ID;
  tracker: ResourceTracker;
  startedAt: string;
}

/**
 * Cognigate gateway options
 */
export interface CognigateGatewayOptions {
  /** Default resource limits */
  defaultLimits?: Partial<ResourceLimits>;
  /** State provider for distributed tracking (optional, uses Redis if not provided) */
  stateProvider?: ResourceStateProvider;
  /** Default output validation options */
  defaultOutputValidation?: OutputValidationOptions;
  /** Default output binding for schema validation */
  defaultOutputBinding?: OutputBinding;
  /** Whether to use distributed state (default: true) */
  useDistributedState?: boolean;
}

/**
 * Cognigate execution gateway
 */
export class CognigateGateway {
  private handlers: Map<string, ExecutionHandler> = new Map();
  private activeExecutions: Map<ID, ActiveExecution> = new Map();
  private defaultLimits: ResourceLimits;
  private stateProvider?: ResourceStateProvider;
  private outputIntegrator?: OutputIntegrator;
  private useDistributedState: boolean;
  private defaultOutputValidation?: OutputValidationOptions;
  private defaultOutputBinding?: OutputBinding;

  constructor(options: CognigateGatewayOptions = {}) {
    this.defaultLimits = {
      maxMemoryMb: 512,
      maxCpuPercent: 50,
      timeoutMs: 300000,
      maxNetworkRequests: 100,
      maxFileSystemOps: 1000,
      ...options.defaultLimits,
    };

    this.useDistributedState = options.useDistributedState ?? true;
    this.defaultOutputValidation = options.defaultOutputValidation;
    this.defaultOutputBinding = options.defaultOutputBinding;

    // Initialize state provider if distributed state enabled
    if (this.useDistributedState) {
      this.stateProvider = options.stateProvider ?? createResourceStateProvider();
    }

    // Initialize output integrator if validation options provided
    if (this.defaultOutputValidation) {
      this.outputIntegrator = new OutputIntegrator(
        this.defaultOutputValidation,
        this.defaultOutputBinding
      );
    }

    logger.info(
      {
        defaultLimits: this.defaultLimits,
        useDistributedState: this.useDistributedState,
        outputValidation: !!this.defaultOutputValidation,
      },
      'Cognigate gateway initialized'
    );
  }

  /**
   * Register an execution handler for an intent type
   */
  registerHandler(intentType: string, handler: ExecutionHandler): void {
    this.handlers.set(intentType, handler);
    logger.info({ intentType }, 'Handler registered');
  }

  /**
   * Execute an approved intent with resource limiting and output validation
   */
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { intent, decision } = context;
    const executionId = `exec-${secureRandomString(16)}`;
    const startedAt = new Date().toISOString();
    const tenantId = intent.tenantId;
    const intentType = (intent.context['type'] as string) ?? 'default';

    // Verify decision allows execution
    if (decision.action !== 'allow') {
      logger.warn(
        { intentId: intent.id, executionId, action: decision.action },
        'Execution blocked by decision'
      );

      return {
        intentId: intent.id,
        executionId,
        success: false,
        outputs: {},
        resourceUsage: this.emptyUsage(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: `Execution not allowed: ${decision.action}`,
      };
    }

    // Get handler
    const handler = this.handlers.get(intentType);

    if (!handler) {
      logger.warn({ intentId: intent.id, executionId, intentType }, 'No handler found');

      return {
        intentId: intent.id,
        executionId,
        success: false,
        outputs: {},
        resourceUsage: this.emptyUsage(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: `No handler for intent type: ${intentType}`,
      };
    }

    // Merge limits
    const limits = { ...this.defaultLimits, ...context.resourceLimits };

    // Create resource tracker
    const tracker = createResourceTracker(executionId, limits, {
      stateProvider: this.stateProvider,
    });

    // Track active execution
    this.activeExecutions.set(intent.id, {
      executionId,
      intentId: intent.id,
      tracker,
      startedAt,
    });

    // Record execution start metric
    recordExecutionStart(tenantId, intentType);

    try {
      // Start resource tracking
      await tracker.start();

      // Create interceptors if using distributed state
      let interceptors: ExecutionInterceptors | undefined;
      if (this.stateProvider) {
        interceptors = createExecutionInterceptors(
          executionId,
          limits,
          this.stateProvider,
          tracker.signal
        );
      }

      // Execute handler with timeout and resource monitoring
      const execStart = performance.now();
      let rawOutputs: Record<string, unknown>;

      try {
        rawOutputs = await this.withAbortableTimeout(
          handler(intent, intent.context, interceptors),
          limits.timeoutMs,
          tracker.signal
        );
      } catch (error) {
        // Check if termination was due to resource limits
        if (tracker.isTerminated()) {
          const terminationReason = tracker.getTerminationReason();

          if (terminationReason?.violation) {
            recordResourceViolation(tenantId, terminationReason.violation);
          }
          recordTermination(tenantId, terminationReason?.reason ?? 'unknown');

          throw error;
        }
        throw error;
      }

      const execEnd = performance.now();
      const durationSeconds = (execEnd - execStart) / 1000;

      // Stop resource tracking and get final usage
      const resourceUsage = await tracker.stop();

      // Validate output
      let validatedOutputs = rawOutputs;
      let outputValidationResult: ExecutionResult['outputValidation'];

      const outputValidationOptions = context.outputValidation ?? this.defaultOutputValidation;

      if (outputValidationOptions) {
        const integrator = context.outputValidation
          ? new OutputIntegrator(context.outputValidation, context.outputBinding)
          : this.outputIntegrator;

        if (integrator) {
          const { output, validation } = await integrator.processOutput(rawOutputs);
          validatedOutputs = output as Record<string, unknown>;

          outputValidationResult = {
            valid: validation.valid,
            piiDetected: validation.piiDetected,
            piiTypes: validation.piiTypes,
            sanitized: validation.modified,
          };

          // Record output validation metrics
          recordOutputValidation(
            tenantId,
            validation.valid ? 'valid' : 'invalid',
            validation.mode,
            validation.durationMs
          );

          if (validation.piiDetected) {
            for (const piiType of validation.piiTypes) {
              recordPIIDetection(tenantId, piiType);
            }
          }

          if (validation.modified) {
            recordOutputSanitization(tenantId);
          }

          // Record prohibited patterns
          if (validation.details.patternScan?.detected) {
            for (const pattern of validation.details.patternScan.patterns) {
              recordProhibitedPattern(tenantId, pattern.type, pattern.severity ?? 'medium');
            }
          }
        }
      }

      // Record success metrics
      recordExecutionComplete(tenantId, intentType, 'success', durationSeconds);
      recordResourceUsage(tenantId, intentType, resourceUsage);

      logger.info(
        {
          intentId: intent.id,
          executionId,
          durationMs: execEnd - execStart,
          resourceUsage,
        },
        'Execution completed'
      );

      return {
        intentId: intent.id,
        executionId,
        success: true,
        outputs: validatedOutputs,
        resourceUsage,
        startedAt,
        completedAt: new Date().toISOString(),
        outputValidation: outputValidationResult,
      };
    } catch (error) {
      // Stop tracking
      const resourceUsage = await tracker.stop();
      const execEnd = performance.now();
      const durationSeconds = (Date.now() - new Date(startedAt).getTime()) / 1000;

      const rawErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTerminated = tracker.isTerminated();
      const terminationReason = tracker.getTerminationReason();

      // Build actionable error message with context
      let errorMessage = rawErrorMessage;
      if (isTerminated && terminationReason) {
        errorMessage = `Execution terminated: ${terminationReason.reason}. ` +
          `Violation: ${terminationReason.violation ?? 'none'}. ` +
          `Intent ID: ${intent.id}. Execution ID: ${executionId}. ` +
          `Duration: ${durationSeconds.toFixed(2)}s. ` +
          `Resource usage - Memory: ${resourceUsage.memoryPeakMb}MB, Network: ${resourceUsage.networkRequests}, FS: ${resourceUsage.fileSystemOps}`;
      } else if (rawErrorMessage === 'Unknown error') {
        errorMessage = `Execution failed with unknown error. ` +
          `Intent ID: ${intent.id}. Execution ID: ${executionId}. ` +
          `Check application logs for stack trace and detailed diagnostics.`;
      }

      // Determine result type for metrics
      const result = isTerminated ? 'terminated' : 'failure';
      recordExecutionComplete(tenantId, intentType, result, durationSeconds);
      recordResourceUsage(tenantId, intentType, resourceUsage);

      if (error instanceof ResourceLimitExceededError) {
        recordResourceViolation(tenantId, `${error.limitType}_limit_exceeded` as 'network_limit_exceeded' | 'filesystem_limit_exceeded');
      }

      logger.error(
        {
          intentId: intent.id,
          executionId,
          error: errorMessage,
          terminated: isTerminated,
          terminationReason,
        },
        'Execution failed'
      );

      return {
        intentId: intent.id,
        executionId,
        success: false,
        outputs: {},
        resourceUsage,
        startedAt,
        completedAt: new Date().toISOString(),
        error: errorMessage,
        terminated: isTerminated,
        terminationReason,
      };
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(intent.id);
    }
  }

  /**
   * Execute a promise with a timeout and abort signal support.
   */
  private withAbortableTimeout<T>(
    promise: Promise<T>,
    ms: number,
    signal: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Check if already aborted
      if (signal.aborted) {
        const reason = signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason ?? 'unknown reason');
        reject(new Error(
          `Execution aborted before start: ${reason}. ` +
          `This may be due to resource limits being exceeded or manual termination. ` +
          `Check resource usage and consider increasing limits if appropriate.`
        ));
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      // Timeout handler
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          const timeoutSeconds = Math.round(ms / 1000);
          reject(new Error(
            `Execution timeout after ${timeoutSeconds} seconds. ` +
            `The operation exceeded the configured time limit. ` +
            `To resolve: (1) Optimize the operation to complete faster, ` +
            `(2) Increase timeoutMs in resource limits, or ` +
            `(3) Break the operation into smaller chunks. ` +
            `Current limit: ${timeoutSeconds}s`
          ));
        }
      }, ms);

      // Abort handler
      const onAbort = () => {
        if (!settled) {
          settled = true;
          cleanup();
          const reason = signal.reason instanceof Error
            ? signal.reason.message
            : String(signal.reason ?? 'manual termination or resource limit');
          reject(new Error(
            `Execution aborted: ${reason}. ` +
            `The operation was terminated before completion. ` +
            `This may be due to: (1) Resource limit exceeded (memory, CPU, network, filesystem), ` +
            `(2) Manual termination request, or ` +
            `(3) System shutdown. Check resource usage metrics for details.`
          ));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });

      // Promise resolution
      promise
        .then((result) => {
          if (!settled) {
            settled = true;
            cleanup();
            signal.removeEventListener('abort', onAbort);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            cleanup();
            signal.removeEventListener('abort', onAbort);
            reject(error);
          }
        });
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
   * Terminate an execution by intent ID
   */
  async terminate(intentId: ID, reason?: string): Promise<boolean> {
    const execution = this.activeExecutions.get(intentId);

    if (!execution) {
      logger.warn({ intentId }, 'Terminate requested but no active execution found');
      return false;
    }

    const terminationReason = reason ?? 'Manual termination requested';

    logger.warn(
      { intentId, executionId: execution.executionId, reason: terminationReason },
      'Terminating execution'
    );

    execution.tracker.terminate(terminationReason, 'manual');
    recordTermination(execution.intentId, 'manual');

    return true;
  }

  /**
   * Get active execution info
   */
  getActiveExecution(intentId: ID): { executionId: ID; startedAt: string } | undefined {
    const execution = this.activeExecutions.get(intentId);
    if (execution) {
      return {
        executionId: execution.executionId,
        startedAt: execution.startedAt,
      };
    }
    return undefined;
  }

  /**
   * Get count of active executions
   */
  getActiveExecutionCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * List all active execution IDs
   */
  listActiveExecutions(): Array<{ intentId: ID; executionId: ID; startedAt: string }> {
    return Array.from(this.activeExecutions.entries()).map(([intentId, exec]) => ({
      intentId,
      executionId: exec.executionId,
      startedAt: exec.startedAt,
    }));
  }
}

/**
 * Create a new Cognigate gateway instance
 */
export function createGateway(options?: CognigateGatewayOptions): CognigateGateway {
  return new CognigateGateway(options);
}

// Legacy compatibility - create gateway with just limits
export function createGatewayWithLimits(
  defaultLimits?: Partial<ResourceLimits>
): CognigateGateway {
  return new CognigateGateway({ defaultLimits });
}
