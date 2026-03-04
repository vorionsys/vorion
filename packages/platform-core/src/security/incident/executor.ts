/**
 * Playbook Executor - Automated Incident Response Execution
 *
 * State machine for playbook execution with:
 * - Step execution with timeout handling
 * - Retry logic for failed steps
 * - Rollback capability for failed playbooks
 * - Parallel step execution where dependencies allow
 * - Persistent state tracking
 *
 * @packageDocumentation
 * @module security/incident/executor
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../common/logger.js';
import {
  Incident,
  Playbook,
  PlaybookStep,
  PlaybookExecutionState,
  StepExecutionState,
  ExecutionState,
  StepState,
  ActionContext,
  ActionResult,
  ActionDefinition,
  Evidence,
  UpdateIncidentInput,
  ExecutionStateStore,
  StepExecutionResult,
} from './types.js';

const logger = createLogger({ component: 'playbook-executor' });

// ============================================================================
// Executor Configuration
// ============================================================================

export interface PlaybookExecutorConfig {
  /** Maximum concurrent step executions */
  maxConcurrentSteps: number;
  /** Default step timeout in milliseconds */
  defaultStepTimeoutMs: number;
  /** Whether to enable automatic rollback on failure */
  enableAutoRollback: boolean;
  /** Maximum retry delay multiplier for exponential backoff */
  maxRetryBackoffMultiplier: number;
  /** Base retry delay in milliseconds */
  baseRetryDelayMs: number;
  /** State storage for persistence */
  stateStore?: ExecutionStateStore;
  /** Whether to persist state */
  persistState: boolean;
}

const DEFAULT_EXECUTOR_CONFIG: PlaybookExecutorConfig = {
  maxConcurrentSteps: 5,
  defaultStepTimeoutMs: 60000,
  enableAutoRollback: true,
  maxRetryBackoffMultiplier: 8,
  baseRetryDelayMs: 1000,
  persistState: true,
};

// ============================================================================
// In-Memory State Store (default implementation)
// ============================================================================

class InMemoryStateStore implements ExecutionStateStore {
  private states: Map<string, PlaybookExecutionState> = new Map();
  private incidentIndex: Map<string, string> = new Map();

  async save(state: PlaybookExecutionState): Promise<void> {
    this.states.set(state.executionId, { ...state });
    this.incidentIndex.set(state.incidentId, state.executionId);
  }

  async load(executionId: string): Promise<PlaybookExecutionState | null> {
    const state = this.states.get(executionId);
    return state ? { ...state } : null;
  }

  async loadByIncident(incidentId: string): Promise<PlaybookExecutionState | null> {
    const executionId = this.incidentIndex.get(incidentId);
    if (!executionId) return null;
    return this.load(executionId);
  }

  async delete(executionId: string): Promise<void> {
    const state = this.states.get(executionId);
    if (state) {
      this.incidentIndex.delete(state.incidentId);
      this.states.delete(executionId);
    }
  }

  async listActive(): Promise<PlaybookExecutionState[]> {
    return Array.from(this.states.values()).filter(
      (s) =>
        s.state === ExecutionState.RUNNING ||
        s.state === ExecutionState.PAUSED ||
        s.state === ExecutionState.WAITING_APPROVAL ||
        s.state === ExecutionState.WAITING_MANUAL
    );
  }

  async update(executionId: string, updates: Partial<PlaybookExecutionState>): Promise<void> {
    const state = this.states.get(executionId);
    if (state) {
      Object.assign(state, updates, { updatedAt: new Date() });
    }
  }
}

// ============================================================================
// Execution Events
// ============================================================================

export interface ExecutorEvents {
  'execution:started': (state: PlaybookExecutionState) => void;
  'execution:completed': (state: PlaybookExecutionState) => void;
  'execution:failed': (state: PlaybookExecutionState, error: string) => void;
  'execution:paused': (state: PlaybookExecutionState, reason: string) => void;
  'execution:resumed': (state: PlaybookExecutionState) => void;
  'execution:cancelled': (state: PlaybookExecutionState) => void;
  'execution:rolledBack': (state: PlaybookExecutionState) => void;
  'step:started': (executionId: string, stepId: string) => void;
  'step:completed': (executionId: string, stepId: string, result: StepExecutionResult) => void;
  'step:failed': (executionId: string, stepId: string, error: string) => void;
  'step:waiting': (executionId: string, stepId: string, reason: 'approval' | 'manual') => void;
  'step:approved': (executionId: string, stepId: string, approver: string) => void;
  'step:rolledBack': (executionId: string, stepId: string) => void;
}

// ============================================================================
// Playbook Executor Class
// ============================================================================

export class PlaybookExecutor extends EventEmitter {
  private readonly config: PlaybookExecutorConfig;
  private readonly stateStore: ExecutionStateStore;
  private readonly actions: Map<string, ActionDefinition> = new Map();
  private readonly activeExecutions: Map<string, AbortController> = new Map();
  private incidentUpdater?: (incidentId: string, updates: UpdateIncidentInput) => Promise<void>;
  private evidenceAdder?: (incidentId: string, evidence: Omit<Evidence, 'id' | 'collectedAt'>) => Promise<Evidence>;

  constructor(config: Partial<PlaybookExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.stateStore = config.stateStore || new InMemoryStateStore();

    logger.info('PlaybookExecutor initialized', {
      maxConcurrentSteps: this.config.maxConcurrentSteps,
      persistState: this.config.persistState,
      enableAutoRollback: this.config.enableAutoRollback,
    });
  }

  /**
   * Register handlers for incident updates and evidence
   */
  registerHandlers(handlers: {
    updateIncident: (incidentId: string, updates: UpdateIncidentInput) => Promise<void>;
    addEvidence: (incidentId: string, evidence: Omit<Evidence, 'id' | 'collectedAt'>) => Promise<Evidence>;
  }): void {
    this.incidentUpdater = handlers.updateIncident;
    this.evidenceAdder = handlers.addEvidence;
  }

  /**
   * Register an action definition
   */
  registerAction(action: ActionDefinition): void {
    this.actions.set(action.id, action);
    logger.debug('Action registered', { actionId: action.id, name: action.name });
  }

  /**
   * Get a registered action
   */
  getAction(actionId: string): ActionDefinition | undefined {
    return this.actions.get(actionId);
  }

  /**
   * Start executing a playbook for an incident
   */
  async startExecution(incident: Incident, playbook: Playbook): Promise<PlaybookExecutionState> {
    const executionId = uuidv4();

    // Check for existing active execution
    const existingExecution = await this.stateStore.loadByIncident(incident.id);
    if (existingExecution && this.isActiveState(existingExecution.state)) {
      throw new Error(`Incident ${incident.id} already has an active playbook execution`);
    }

    // Initialize step states
    const stepStates: Record<string, StepExecutionState> = {};
    for (const step of playbook.steps) {
      stepStates[step.id] = {
        stepId: step.id,
        state: StepState.PENDING,
        retryCount: 0,
      };
    }

    // Create initial execution state
    const state: PlaybookExecutionState = {
      executionId,
      incidentId: incident.id,
      playbookId: playbook.id,
      state: ExecutionState.RUNNING,
      stepStates,
      variables: {},
      startedAt: new Date(),
      updatedAt: new Date(),
      rolledBackSteps: [],
    };

    // Persist state
    if (this.config.persistState) {
      await this.stateStore.save(state);
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    logger.info('Playbook execution started', {
      executionId,
      incidentId: incident.id,
      playbookId: playbook.id,
      totalSteps: playbook.steps.length,
    });

    this.emit('execution:started', state);

    // Start execution in background
    this.runExecution(state, incident, playbook, abortController.signal).catch((error) => {
      logger.error('Playbook execution error', {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return state;
  }

  /**
   * Resume a paused execution
   */
  async resumeExecution(executionId: string, incident: Incident, playbook: Playbook): Promise<void> {
    const state = await this.stateStore.load(executionId);
    if (!state) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (state.state !== ExecutionState.PAUSED &&
        state.state !== ExecutionState.WAITING_APPROVAL &&
        state.state !== ExecutionState.WAITING_MANUAL) {
      throw new Error(`Execution is not in a resumable state: ${state.state}`);
    }

    state.state = ExecutionState.RUNNING;
    state.updatedAt = new Date();

    if (this.config.persistState) {
      await this.stateStore.update(executionId, { state: ExecutionState.RUNNING, updatedAt: new Date() });
    }

    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    logger.info('Playbook execution resumed', { executionId, incidentId: incident.id });
    this.emit('execution:resumed', state);

    // Resume execution
    this.runExecution(state, incident, playbook, abortController.signal).catch((error) => {
      logger.error('Playbook execution error on resume', {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Cancel an active execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const abortController = this.activeExecutions.get(executionId);
    if (abortController) {
      abortController.abort();
    }

    const state = await this.stateStore.load(executionId);
    if (state) {
      state.state = ExecutionState.CANCELLED;
      state.completedAt = new Date();
      state.updatedAt = new Date();

      if (this.config.persistState) {
        await this.stateStore.update(executionId, {
          state: ExecutionState.CANCELLED,
          completedAt: new Date(),
          updatedAt: new Date(),
        });
      }

      logger.info('Playbook execution cancelled', { executionId });
      this.emit('execution:cancelled', state);
    }

    this.activeExecutions.delete(executionId);
  }

  /**
   * Approve a step that requires approval
   */
  async approveStep(executionId: string, stepId: string, approver: string): Promise<void> {
    const state = await this.stateStore.load(executionId);
    if (!state) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const stepState = state.stepStates[stepId];
    if (!stepState) {
      throw new Error(`Step not found: ${stepId}`);
    }

    if (stepState.state !== StepState.WAITING_APPROVAL) {
      throw new Error(`Step ${stepId} is not waiting for approval`);
    }

    stepState.state = StepState.QUEUED;
    stepState.approvedBy = approver;
    stepState.approvedAt = new Date();
    state.updatedAt = new Date();

    if (this.config.persistState) {
      await this.stateStore.save(state);
    }

    logger.info('Step approved', { executionId, stepId, approver });
    this.emit('step:approved', executionId, stepId, approver);
  }

  /**
   * Mark a manual step as completed
   */
  async completeManualStep(
    executionId: string,
    stepId: string,
    completedBy: string,
    output?: unknown
  ): Promise<void> {
    const state = await this.stateStore.load(executionId);
    if (!state) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const stepState = state.stepStates[stepId];
    if (!stepState) {
      throw new Error(`Step not found: ${stepId}`);
    }

    if (stepState.state !== StepState.WAITING_APPROVAL) {
      throw new Error(`Step ${stepId} is not a manual step waiting for completion`);
    }

    stepState.state = StepState.COMPLETED;
    stepState.completedAt = new Date();
    stepState.output = output;
    stepState.approvedBy = completedBy;
    state.updatedAt = new Date();

    if (this.config.persistState) {
      await this.stateStore.save(state);
    }

    logger.info('Manual step completed', { executionId, stepId, completedBy });

    const result: StepExecutionResult = {
      stepId,
      success: true,
      startedAt: stepState.startedAt || new Date(),
      completedAt: new Date(),
      duration: stepState.startedAt
        ? new Date().getTime() - stepState.startedAt.getTime()
        : 0,
      retryCount: 0,
      output,
    };

    this.emit('step:completed', executionId, stepId, result);
  }

  /**
   * Rollback a failed execution
   */
  async rollbackExecution(executionId: string, incident: Incident, playbook: Playbook): Promise<void> {
    const state = await this.stateStore.load(executionId);
    if (!state) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    logger.info('Starting playbook rollback', { executionId, incidentId: incident.id });

    // Get completed steps in reverse order
    const completedSteps = playbook.steps
      .filter((step) => state.stepStates[step.id]?.state === StepState.COMPLETED)
      .reverse();

    for (const step of completedSteps) {
      if (state.rolledBackSteps.includes(step.id)) {
        continue;
      }

      const stepState = state.stepStates[step.id];
      const action = step.actionId ? this.actions.get(step.actionId) : undefined;

      if (action?.supportsRollback && action.rollback && stepState.output) {
        try {
          logger.info('Rolling back step', { executionId, stepId: step.id });

          const context = this.createActionContext(incident, playbook, step, state);
          await action.rollback(context, stepState.output);

          state.rolledBackSteps.push(step.id);
          stepState.state = StepState.ROLLED_BACK;
          stepState.rollbackCompleted = true;

          this.emit('step:rolledBack', executionId, step.id);
        } catch (error) {
          logger.error('Rollback failed for step', {
            executionId,
            stepId: step.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    state.state = ExecutionState.ROLLED_BACK;
    state.completedAt = new Date();
    state.updatedAt = new Date();

    if (this.config.persistState) {
      await this.stateStore.save(state);
    }

    logger.info('Playbook rollback completed', {
      executionId,
      rolledBackSteps: state.rolledBackSteps.length,
    });

    this.emit('execution:rolledBack', state);
  }

  /**
   * Get execution state
   */
  async getExecutionState(executionId: string): Promise<PlaybookExecutionState | null> {
    return this.stateStore.load(executionId);
  }

  /**
   * Get execution state by incident
   */
  async getExecutionByIncident(incidentId: string): Promise<PlaybookExecutionState | null> {
    return this.stateStore.loadByIncident(incidentId);
  }

  /**
   * Get all active executions
   */
  async getActiveExecutions(): Promise<PlaybookExecutionState[]> {
    return this.stateStore.listActive();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async runExecution(
    state: PlaybookExecutionState,
    incident: Incident,
    playbook: Playbook,
    abortSignal: AbortSignal
  ): Promise<void> {
    try {
      while (!abortSignal.aborted && state.state === ExecutionState.RUNNING) {
        // Find steps that can be executed
        const executableSteps = this.findExecutableSteps(state, playbook);

        if (executableSteps.length === 0) {
          // Check if all steps are complete
          const allComplete = playbook.steps.every(
            (step) =>
              state.stepStates[step.id]?.state === StepState.COMPLETED ||
              state.stepStates[step.id]?.state === StepState.SKIPPED
          );

          if (allComplete) {
            state.state = ExecutionState.COMPLETED;
            state.completedAt = new Date();
            break;
          }

          // Check if waiting for approval or manual action
          const waitingSteps = playbook.steps.filter(
            (step) =>
              state.stepStates[step.id]?.state === StepState.WAITING_APPROVAL
          );

          if (waitingSteps.length > 0) {
            const step = waitingSteps[0];
            const stepDef = playbook.steps.find((s) => s.id === step.id);

            if (stepDef?.type === 'manual') {
              state.state = ExecutionState.WAITING_MANUAL;
              this.emit('step:waiting', state.executionId, step.id, 'manual');
            } else {
              state.state = ExecutionState.WAITING_APPROVAL;
              this.emit('step:waiting', state.executionId, step.id, 'approval');
            }
            break;
          }

          // No progress possible - might be a dependency issue
          logger.warn('No executable steps and not complete', {
            executionId: state.executionId,
            stepStates: state.stepStates,
          });
          break;
        }

        // Execute steps in parallel (up to max concurrent)
        const stepsToRun = executableSteps.slice(0, this.config.maxConcurrentSteps);

        await Promise.all(
          stepsToRun.map((step) =>
            this.executeStep(state, incident, playbook, step, abortSignal)
          )
        );

        // Persist state after batch
        if (this.config.persistState) {
          await this.stateStore.save(state);
        }
      }

      // Final state persistence
      state.updatedAt = new Date();
      if (this.config.persistState) {
        await this.stateStore.save(state);
      }

      if (state.state === ExecutionState.COMPLETED) {
        logger.info('Playbook execution completed', {
          executionId: state.executionId,
          duration: state.completedAt!.getTime() - state.startedAt.getTime(),
        });
        this.emit('execution:completed', state);
      } else if (state.state === ExecutionState.FAILED) {
        logger.error('Playbook execution failed', {
          executionId: state.executionId,
          error: state.error,
        });
        this.emit('execution:failed', state, state.error || 'Unknown error');

        // Auto-rollback if enabled
        if (this.config.enableAutoRollback) {
          await this.rollbackExecution(state.executionId, incident, playbook);
        }
      } else if (state.state === ExecutionState.WAITING_APPROVAL ||
                 state.state === ExecutionState.WAITING_MANUAL) {
        logger.info('Playbook execution paused', {
          executionId: state.executionId,
          state: state.state,
        });
        this.emit('execution:paused', state, state.state);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.state = ExecutionState.FAILED;
      state.error = errorMessage;
      state.completedAt = new Date();
      state.updatedAt = new Date();

      if (this.config.persistState) {
        await this.stateStore.save(state);
      }

      logger.error('Playbook execution error', {
        executionId: state.executionId,
        error: errorMessage,
      });
      this.emit('execution:failed', state, errorMessage);
    } finally {
      this.activeExecutions.delete(state.executionId);
    }
  }

  private findExecutableSteps(
    state: PlaybookExecutionState,
    playbook: Playbook
  ): PlaybookStep[] {
    const executable: PlaybookStep[] = [];

    for (const step of playbook.steps) {
      const stepState = state.stepStates[step.id];

      // Skip if already complete, failed, or in progress
      if (
        stepState.state !== StepState.PENDING &&
        stepState.state !== StepState.QUEUED
      ) {
        continue;
      }

      // Check dependencies
      if (step.dependencies && step.dependencies.length > 0) {
        const depsComplete = step.dependencies.every(
          (depId) => state.stepStates[depId]?.state === StepState.COMPLETED
        );
        if (!depsComplete) {
          continue;
        }
      }

      // Check if requires approval and not yet approved
      if (step.requiresApproval && !stepState.approvedBy) {
        stepState.state = StepState.WAITING_APPROVAL;
        continue;
      }

      executable.push(step);
    }

    return executable;
  }

  private async executeStep(
    state: PlaybookExecutionState,
    incident: Incident,
    playbook: Playbook,
    step: PlaybookStep,
    abortSignal: AbortSignal
  ): Promise<void> {
    const stepState = state.stepStates[step.id];
    stepState.state = StepState.RUNNING;
    stepState.startedAt = new Date();

    logger.info('Executing step', {
      executionId: state.executionId,
      stepId: step.id,
      stepName: step.name,
      type: step.type,
    });

    this.emit('step:started', state.executionId, step.id);

    try {
      // Handle manual steps
      if (step.type === 'manual') {
        stepState.state = StepState.WAITING_APPROVAL;
        logger.info('Manual step waiting for completion', {
          executionId: state.executionId,
          stepId: step.id,
        });
        return;
      }

      // Get the action to execute
      const action = step.actionId ? this.actions.get(step.actionId) : undefined;

      if (!action && !step.action) {
        // No action defined - mark as complete (documentation step)
        stepState.state = StepState.COMPLETED;
        stepState.completedAt = new Date();

        const result: StepExecutionResult = {
          stepId: step.id,
          success: true,
          startedAt: stepState.startedAt!,
          completedAt: stepState.completedAt,
          duration: stepState.completedAt.getTime() - stepState.startedAt!.getTime(),
          retryCount: stepState.retryCount,
        };

        this.emit('step:completed', state.executionId, step.id, result);
        return;
      }

      // Execute with retry logic
      const maxRetries = step.retryAttempts || action?.maxRetries || 0;
      const timeout = step.timeout || action?.defaultTimeoutMs || this.config.defaultStepTimeoutMs;

      let lastError: string | undefined;
      let result: ActionResult | undefined;

      while (stepState.retryCount <= maxRetries) {
        if (abortSignal.aborted) {
          throw new Error('Execution cancelled');
        }

        try {
          const context = this.createActionContext(incident, playbook, step, state);

          // Execute with timeout
          result = await this.executeWithTimeout(
            async () => {
              if (action) {
                // Validate first if validation is defined
                if (action.validate) {
                  const validation = await action.validate(context);
                  if (!validation.valid) {
                    throw new Error(`Validation failed: ${validation.reason}`);
                  }
                }
                return action.execute(context);
              } else if (step.action) {
                // Legacy action function
                await step.action();
                return { success: true };
              }
              return { success: true };
            },
            timeout,
            abortSignal
          );

          if (result.success) {
            break;
          } else {
            lastError = result.error || 'Action returned failure';
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }

        stepState.retryCount++;

        if (stepState.retryCount <= maxRetries) {
          const delay = this.calculateRetryDelay(stepState.retryCount);
          logger.warn('Step failed, retrying', {
            executionId: state.executionId,
            stepId: step.id,
            retryCount: stepState.retryCount,
            delay,
            error: lastError,
          });
          await this.sleep(delay);
        }
      }

      // Check result
      if (result?.success) {
        stepState.state = StepState.COMPLETED;
        stepState.completedAt = new Date();
        stepState.output = result.output;

        const execResult: StepExecutionResult = {
          stepId: step.id,
          success: true,
          startedAt: stepState.startedAt!,
          completedAt: stepState.completedAt,
          duration: stepState.completedAt.getTime() - stepState.startedAt!.getTime(),
          retryCount: stepState.retryCount,
          output: result.output,
        };

        logger.info('Step completed', {
          executionId: state.executionId,
          stepId: step.id,
          duration: execResult.duration,
        });

        this.emit('step:completed', state.executionId, step.id, execResult);
      } else {
        throw new Error(lastError || 'Step execution failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stepState.state = StepState.FAILED;
      stepState.completedAt = new Date();
      stepState.error = errorMessage;

      logger.error('Step failed', {
        executionId: state.executionId,
        stepId: step.id,
        error: errorMessage,
      });

      this.emit('step:failed', state.executionId, step.id, errorMessage);

      // Handle failure mode
      if (step.onFailure === 'halt') {
        state.state = ExecutionState.FAILED;
        state.error = `Step ${step.id} failed: ${errorMessage}`;
      } else if (step.onFailure === 'continue') {
        stepState.state = StepState.SKIPPED;
      }
    }
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    abortSignal: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const abortHandler = () => {
        clearTimeout(timer);
        reject(new Error('Execution cancelled'));
      };

      abortSignal.addEventListener('abort', abortHandler, { once: true });

      fn()
        .then((result) => {
          clearTimeout(timer);
          abortSignal.removeEventListener('abort', abortHandler);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          abortSignal.removeEventListener('abort', abortHandler);
          reject(error);
        });
    });
  }

  private calculateRetryDelay(retryCount: number): number {
    const multiplier = Math.min(
      Math.pow(2, retryCount - 1),
      this.config.maxRetryBackoffMultiplier
    );
    const jitter = Math.random() * 0.3 + 0.85; // 85-115% jitter
    return Math.floor(this.config.baseRetryDelayMs * multiplier * jitter);
  }

  private createActionContext(
    incident: Incident,
    playbook: Playbook,
    step: PlaybookStep,
    state: PlaybookExecutionState
  ): ActionContext {
    const stepLogger = {
      debug: (message: string, data?: Record<string, unknown>) => {
        logger.debug({ ...data, stepId: step.id, incidentId: incident.id }, message);
      },
      info: (message: string, data?: Record<string, unknown>) => {
        logger.info({ ...data, stepId: step.id, incidentId: incident.id }, message);
      },
      warn: (message: string, data?: Record<string, unknown>) => {
        logger.warn({ ...data, stepId: step.id, incidentId: incident.id }, message);
      },
      error: (message: string, data?: Record<string, unknown>) => {
        logger.error({ ...data, stepId: step.id, incidentId: incident.id }, message);
      },
    };

    const abortController = this.activeExecutions.get(state.executionId) || new AbortController();

    return {
      incident,
      playbook,
      step,
      variables: state.variables,
      logger: stepLogger,
      addEvidence: async (evidence) => {
        if (!this.evidenceAdder) {
          throw new Error('Evidence handler not registered');
        }
        return this.evidenceAdder(incident.id, evidence);
      },
      updateIncident: async (updates) => {
        if (!this.incidentUpdater) {
          throw new Error('Incident update handler not registered');
        }
        await this.incidentUpdater(incident.id, updates);
      },
      setVariable: (key, value) => {
        state.variables[key] = value;
      },
      getVariable: <T = unknown>(key: string) => state.variables[key] as T | undefined,
      abortSignal: abortController.signal,
    };
  }

  private isActiveState(state: ExecutionState): boolean {
    return (
      state === ExecutionState.RUNNING ||
      state === ExecutionState.PAUSED ||
      state === ExecutionState.WAITING_APPROVAL ||
      state === ExecutionState.WAITING_MANUAL
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createPlaybookExecutor(
  config?: Partial<PlaybookExecutorConfig>
): PlaybookExecutor {
  return new PlaybookExecutor(config);
}

// ============================================================================
// Exports
// ============================================================================

export { InMemoryStateStore };
export type { ExecutionStateStore };
