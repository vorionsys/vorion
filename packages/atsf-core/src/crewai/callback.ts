/**
 * CrewAI Trust Callback Handler
 *
 * Records crew agent behavior as trust signals during CrewAI execution.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { TrustSignal } from '../common/types.js';
import type { TrustEngine } from '../trust-engine/index.js';
import type {
  CrewAgentConfig,
  CrewSignalSource,
  CrewSignalWeights,
} from './types.js';

const logger = createLogger({ component: 'crewai-callback' });

/**
 * Default signal weights for crew operations
 */
const DEFAULT_WEIGHTS: Required<CrewSignalWeights> = {
  taskSuccess: 0.85,
  taskFailure: 0.1,
  delegationSuccess: 0.8,
  delegationFailure: 0.15,
  crewSuccess: 0.9,
  crewFailure: 0.1,
};

/**
 * CrewAI callback handler for trust signal recording
 *
 * This handler tracks crew agent behavior and records trust signals
 * for task execution, delegation, and crew-level events.
 */
export class CrewTrustCallbackHandler {
  private trustEngine: TrustEngine;
  private config: Required<CrewAgentConfig>;
  private signalCount = 0;
  private startTimes: Map<string, number> = new Map();

  constructor(trustEngine: TrustEngine, config: CrewAgentConfig) {
    this.trustEngine = trustEngine;
    this.config = {
      agentId: config.agentId,
      role: config.role,
      goal: config.goal ?? '',
      initialTrustLevel: config.initialTrustLevel ?? 1,
      minTrustLevel: config.minTrustLevel ?? 1,
      allowDelegation: config.allowDelegation ?? true,
      recordTaskExecution: config.recordTaskExecution ?? true,
      recordDelegation: config.recordDelegation ?? true,
      recordErrors: config.recordErrors ?? true,
      signalWeights: {
        ...DEFAULT_WEIGHTS,
        ...config.signalWeights,
      },
    };
  }

  /**
   * Get the agent ID
   */
  get agentId(): string {
    return this.config.agentId;
  }

  /**
   * Get the agent role
   */
  get role(): string {
    return this.config.role;
  }

  /**
   * Get the number of signals recorded
   */
  get signalsRecorded(): number {
    return this.signalCount;
  }

  /**
   * Initialize the agent in the trust engine if not exists
   */
  async initialize(): Promise<void> {
    const existing = await this.trustEngine.getScore(this.config.agentId);
    if (!existing) {
      await this.trustEngine.initializeEntity(
        this.config.agentId,
        this.config.initialTrustLevel,
      );
      logger.info(
        { agentId: this.config.agentId, role: this.config.role },
        'Initialized trust for crew agent',
      );
    }
  }

  /**
   * Record a trust signal
   */
  private async recordSignal(source: CrewSignalSource): Promise<void> {
    const weights = this.config.signalWeights;
    let value: number;
    let signalType: string;

    switch (source.event) {
      case 'task_end':
        value = weights.taskSuccess ?? DEFAULT_WEIGHTS.taskSuccess;
        signalType = `behavioral.task_success.${source.taskId ?? 'unknown'}`;
        break;
      case 'task_error':
        value = weights.taskFailure ?? DEFAULT_WEIGHTS.taskFailure;
        signalType = `behavioral.task_failure.${source.taskId ?? 'unknown'}`;
        break;
      case 'delegation_end':
        value = weights.delegationSuccess ?? DEFAULT_WEIGHTS.delegationSuccess;
        signalType = `behavioral.delegation_success.${source.targetAgentId ?? 'unknown'}`;
        break;
      case 'delegation_error':
        value = weights.delegationFailure ?? DEFAULT_WEIGHTS.delegationFailure;
        signalType = `behavioral.delegation_failure.${source.targetAgentId ?? 'unknown'}`;
        break;
      case 'crew_end':
        value = weights.crewSuccess ?? DEFAULT_WEIGHTS.crewSuccess;
        signalType = `behavioral.crew_success.${source.crewId ?? 'unknown'}`;
        break;
      case 'crew_error':
        value = weights.crewFailure ?? DEFAULT_WEIGHTS.crewFailure;
        signalType = `behavioral.crew_failure.${source.crewId ?? 'unknown'}`;
        break;
      default:
        return; // Don't record start events as signals
    }

    const signal: TrustSignal = {
      id: crypto.randomUUID(),
      entityId: source.agentId ?? this.config.agentId,
      type: signalType,
      value,
      source: 'crewai',
      timestamp: new Date().toISOString(),
      metadata: {
        event: source.event,
        taskId: source.taskId,
        agentId: source.agentId,
        targetAgentId: source.targetAgentId,
        crewId: source.crewId,
        duration: source.duration,
        error: source.error?.message,
        role: this.config.role,
      },
    };

    await this.trustEngine.recordSignal(signal);
    this.signalCount++;

    logger.debug({ signal }, 'Recorded trust signal from CrewAI');
  }

  /**
   * Start tracking execution time
   */
  private startTimer(runId: string): void {
    this.startTimes.set(runId, Date.now());
  }

  /**
   * Get elapsed time and clear timer
   */
  private endTimer(runId: string): number {
    const startTime = this.startTimes.get(runId);
    this.startTimes.delete(runId);
    return startTime ? Date.now() - startTime : 0;
  }

  // ============================================
  // Task Lifecycle
  // ============================================

  /**
   * Called when a task starts
   */
  async handleTaskStart(taskId: string, runId: string): Promise<void> {
    if (!this.config.recordTaskExecution) return;
    this.startTimer(runId);
    logger.debug({ taskId, runId, role: this.config.role }, 'Task started');
  }

  /**
   * Called when a task completes successfully
   */
  async handleTaskEnd(taskId: string, runId: string): Promise<void> {
    if (!this.config.recordTaskExecution) return;
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'task_end',
      taskId,
      duration,
    });
  }

  /**
   * Called when a task errors
   */
  async handleTaskError(
    taskId: string,
    error: Error,
    runId: string,
  ): Promise<void> {
    if (!this.config.recordErrors) return;
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'task_error',
      taskId,
      duration,
      error,
    });
  }

  // ============================================
  // Delegation Lifecycle
  // ============================================

  /**
   * Called when delegation starts
   */
  async handleDelegationStart(
    targetAgentId: string,
    taskId: string,
    runId: string,
  ): Promise<void> {
    if (!this.config.recordDelegation) return;
    this.startTimer(runId);
    logger.debug(
      { targetAgentId, taskId, runId },
      'Delegation started',
    );
  }

  /**
   * Called when delegation completes successfully
   */
  async handleDelegationEnd(
    targetAgentId: string,
    taskId: string,
    runId: string,
  ): Promise<void> {
    if (!this.config.recordDelegation) return;
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'delegation_end',
      targetAgentId,
      taskId,
      duration,
    });
  }

  /**
   * Called when delegation errors
   */
  async handleDelegationError(
    targetAgentId: string,
    taskId: string,
    error: Error,
    runId: string,
  ): Promise<void> {
    if (!this.config.recordErrors) return;
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'delegation_error',
      targetAgentId,
      taskId,
      duration,
      error,
    });
  }

  // ============================================
  // Crew Lifecycle
  // ============================================

  /**
   * Called when a crew run starts
   */
  async handleCrewStart(crewId: string, runId: string): Promise<void> {
    this.startTimer(runId);
    logger.debug({ crewId, runId }, 'Crew started');
  }

  /**
   * Called when a crew run completes successfully
   */
  async handleCrewEnd(crewId: string, runId: string): Promise<void> {
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'crew_end',
      crewId,
      duration,
    });
  }

  /**
   * Called when a crew run errors
   */
  async handleCrewError(
    crewId: string,
    error: Error,
    runId: string,
  ): Promise<void> {
    if (!this.config.recordErrors) return;
    const duration = this.endTimer(runId);
    await this.recordSignal({
      event: 'crew_error',
      crewId,
      duration,
      error,
    });
  }
}

/**
 * Create a crew trust callback handler
 */
export function createCrewTrustCallback(
  trustEngine: TrustEngine,
  config: CrewAgentConfig,
): CrewTrustCallbackHandler {
  return new CrewTrustCallbackHandler(trustEngine, config);
}
