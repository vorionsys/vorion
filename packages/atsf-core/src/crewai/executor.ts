/**
 * Trust-Aware CrewAI Executor
 *
 * Wraps CrewAI crews and tasks with trust-based access control.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { TrustLevel } from '../common/types.js';
import { TrustInsufficientError } from '../common/types.js';
import type { TrustEngine, TrustRecord } from '../trust-engine/index.js';
import { TRUST_LEVEL_NAMES } from '../trust-engine/index.js';
import { CrewTrustCallbackHandler, createCrewTrustCallback } from './callback.js';
import type {
  CrewAgentConfig,
  CrewConfig,
  CrewTaskConfig,
  CrewTrustCheckResult,
  TrustedTaskResult,
  TrustedCrewResult,
  DelegationResult,
} from './types.js';

const logger = createLogger({ component: 'crewai-executor' });

// =============================================================================
// CREW AGENT EXECUTOR
// =============================================================================

/**
 * Trust-aware executor for a single crew agent
 *
 * Provides trust-gated task execution and delegation for CrewAI agents.
 */
export class CrewAgentExecutor {
  private trustEngine: TrustEngine;
  private callback: CrewTrustCallbackHandler;
  private config: CrewAgentConfig;

  constructor(trustEngine: TrustEngine, config: CrewAgentConfig) {
    this.trustEngine = trustEngine;
    this.config = config;
    this.callback = createCrewTrustCallback(trustEngine, config);
  }

  /**
   * Get the callback handler
   */
  get callbackHandler(): CrewTrustCallbackHandler {
    return this.callback;
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
   * Initialize the executor
   */
  async initialize(): Promise<void> {
    await this.callback.initialize();
  }

  /**
   * Check if the agent has sufficient trust
   */
  async checkTrust(requiredLevel?: TrustLevel): Promise<CrewTrustCheckResult> {
    const minLevel = requiredLevel ?? this.config.minTrustLevel ?? 1;
    const record = await this.trustEngine.getScore(this.config.agentId);

    if (!record) {
      return {
        allowed: false,
        agentId: this.config.agentId,
        currentLevel: 0,
        currentScore: 0,
        requiredLevel: minLevel,
        reason: 'Agent not initialized in trust engine',
      };
    }

    const allowed = record.level >= minLevel;

    return {
      allowed,
      agentId: this.config.agentId,
      currentLevel: record.level,
      currentScore: record.score,
      requiredLevel: minLevel,
      reason: allowed
        ? `Trust level ${TRUST_LEVEL_NAMES[record.level]} meets requirement`
        : `Trust level ${TRUST_LEVEL_NAMES[record.level]} below required ${TRUST_LEVEL_NAMES[minLevel]}`,
    };
  }

  /**
   * Execute a task with trust gating
   *
   * @param task - Task configuration
   * @param fn - The function to execute (typically the actual CrewAI task runner)
   * @throws TrustInsufficientError if trust is too low
   */
  async executeTask<T>(
    task: CrewTaskConfig,
    fn: () => Promise<T>,
  ): Promise<TrustedTaskResult<T>> {
    const requiredLevel = task.minTrustLevel ?? this.config.minTrustLevel ?? 1;
    const trustCheck = await this.checkTrust(requiredLevel);

    if (!trustCheck.allowed) {
      logger.warn(
        {
          agentId: this.config.agentId,
          taskId: task.taskId,
          currentLevel: trustCheck.currentLevel,
          requiredLevel: trustCheck.requiredLevel,
        },
        'Task execution blocked due to insufficient trust',
      );

      throw new TrustInsufficientError(
        trustCheck.requiredLevel,
        trustCheck.currentLevel,
      );
    }

    const runId = crypto.randomUUID();
    const initialSignals = this.callback.signalsRecorded;

    await this.callback.handleTaskStart(task.taskId, runId);

    try {
      const result = await fn();
      await this.callback.handleTaskEnd(task.taskId, runId);

      const finalRecord = await this.trustEngine.getScore(this.config.agentId);

      logger.info(
        {
          agentId: this.config.agentId,
          taskId: task.taskId,
          signalsRecorded: this.callback.signalsRecorded - initialSignals,
          finalScore: finalRecord?.score,
        },
        'Trusted task execution completed',
      );

      return {
        result,
        taskId: task.taskId,
        agentId: this.config.agentId,
        trustCheck,
        signalsRecorded: this.callback.signalsRecorded - initialSignals,
        finalScore: finalRecord?.score ?? 0,
        finalLevel: finalRecord?.level ?? 0,
      };
    } catch (error) {
      await this.callback.handleTaskError(
        task.taskId,
        error instanceof Error ? error : new Error(String(error)),
        runId,
      );
      throw error;
    }
  }

  /**
   * Delegate a task to another agent with trust gating on both sides
   *
   * @param task - Task to delegate
   * @param targetExecutor - The target agent's executor
   * @param fn - The function to execute on the target agent
   * @throws TrustInsufficientError if either agent lacks trust
   */
  async delegateTask<T>(
    task: CrewTaskConfig,
    targetExecutor: CrewAgentExecutor,
    fn: () => Promise<T>,
  ): Promise<DelegationResult<T>> {
    if (this.config.allowDelegation === false) {
      throw new Error(
        `Agent ${this.config.agentId} is not allowed to delegate tasks`,
      );
    }

    // Check delegator trust
    const delegatorCheck = await this.checkTrust();
    if (!delegatorCheck.allowed) {
      throw new TrustInsufficientError(
        delegatorCheck.requiredLevel,
        delegatorCheck.currentLevel,
      );
    }

    // Check delegatee trust
    const delegateeCheck = await targetExecutor.checkTrust(
      task.minTrustLevel ?? this.config.minTrustLevel ?? 1,
    );
    if (!delegateeCheck.allowed) {
      throw new TrustInsufficientError(
        delegateeCheck.requiredLevel,
        delegateeCheck.currentLevel,
      );
    }

    const runId = crypto.randomUUID();

    await this.callback.handleDelegationStart(
      targetExecutor.agentId,
      task.taskId,
      runId,
    );

    try {
      const result = await fn();

      await this.callback.handleDelegationEnd(
        targetExecutor.agentId,
        task.taskId,
        runId,
      );

      logger.info(
        {
          from: this.config.agentId,
          to: targetExecutor.agentId,
          taskId: task.taskId,
        },
        'Task delegation completed',
      );

      return {
        result,
        fromAgentId: this.config.agentId,
        toAgentId: targetExecutor.agentId,
        trustCheck: delegatorCheck,
        delegateeTrustCheck: delegateeCheck,
      };
    } catch (error) {
      await this.callback.handleDelegationError(
        targetExecutor.agentId,
        task.taskId,
        error instanceof Error ? error : new Error(String(error)),
        runId,
      );
      throw error;
    }
  }

  /**
   * Get current trust record for the agent
   */
  async getTrustRecord(): Promise<TrustRecord | undefined> {
    return this.trustEngine.getScore(this.config.agentId);
  }

  /**
   * Manually record a positive signal
   */
  async recordSuccess(type: string, value = 0.85): Promise<void> {
    await this.trustEngine.recordSignal({
      id: crypto.randomUUID(),
      entityId: this.config.agentId,
      type: `behavioral.${type}`,
      value,
      source: 'crewai-manual',
      timestamp: new Date().toISOString(),
      metadata: { role: this.config.role },
    });
  }

  /**
   * Manually record a negative signal
   */
  async recordFailure(type: string, value = 0.1): Promise<void> {
    await this.trustEngine.recordSignal({
      id: crypto.randomUUID(),
      entityId: this.config.agentId,
      type: `behavioral.${type}`,
      value,
      source: 'crewai-manual',
      timestamp: new Date().toISOString(),
      metadata: { role: this.config.role },
    });
  }
}

// =============================================================================
// CREW EXECUTOR
// =============================================================================

/**
 * Trust-aware crew executor
 *
 * Manages a crew of agents with collective trust governance.
 * Ensures all agents meet minimum trust requirements before crew execution.
 */
export class CrewExecutor {
  private trustEngine: TrustEngine;
  private config: Required<CrewConfig>;
  private agents: Map<string, CrewAgentExecutor> = new Map();

  constructor(trustEngine: TrustEngine, config: CrewConfig) {
    this.trustEngine = trustEngine;
    this.config = {
      crewId: config.crewId,
      process: config.process ?? 'sequential',
      minCrewTrust: config.minCrewTrust ?? 1,
      maxTaskFailures: config.maxTaskFailures ?? 0,
      recordCrewEvents: config.recordCrewEvents ?? true,
    };
  }

  /**
   * Get the crew ID
   */
  get crewId(): string {
    return this.config.crewId;
  }

  /**
   * Get the execution process type
   */
  get process(): string {
    return this.config.process;
  }

  /**
   * Get all agent executors
   */
  get agentExecutors(): CrewAgentExecutor[] {
    return Array.from(this.agents.values());
  }

  /**
   * Add an agent to the crew
   */
  addAgent(executor: CrewAgentExecutor): void {
    this.agents.set(executor.agentId, executor);
  }

  /**
   * Get an agent executor by ID
   */
  getAgent(agentId: string): CrewAgentExecutor | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Initialize all agents in the crew
   */
  async initialize(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.initialize();
    }
    logger.info(
      { crewId: this.config.crewId, agentCount: this.agents.size },
      'Crew initialized',
    );
  }

  /**
   * Get the average trust level across all crew members
   */
  async getCrewTrust(): Promise<{ averageScore: number; averageLevel: number; allMeetMinimum: boolean }> {
    if (this.agents.size === 0) {
      return { averageScore: 0, averageLevel: 0, allMeetMinimum: false };
    }

    let totalScore = 0;
    let totalLevel = 0;
    let allMeet = true;

    for (const agent of this.agents.values()) {
      const record = await this.trustEngine.getScore(agent.agentId);
      const score = record?.score ?? 0;
      const level = record?.level ?? 0;
      totalScore += score;
      totalLevel += level;
      if (level < this.config.minCrewTrust) {
        allMeet = false;
      }
    }

    return {
      averageScore: totalScore / this.agents.size,
      averageLevel: totalLevel / this.agents.size,
      allMeetMinimum: allMeet,
    };
  }

  /**
   * Execute a set of tasks with the crew
   *
   * Tasks are assigned to agents based on the configured process (sequential/hierarchical).
   * All agents must meet the minimum crew trust requirement.
   *
   * @param tasks - Tasks to execute
   * @param taskRunner - Function that runs a single task given task config and agent executor
   * @throws TrustInsufficientError if any agent fails trust check
   */
  async kickoff<T>(
    tasks: CrewTaskConfig[],
    taskRunner: (task: CrewTaskConfig, agent: CrewAgentExecutor) => Promise<T>,
  ): Promise<TrustedCrewResult<T>> {
    // Check crew-level trust
    const crewTrust = await this.getCrewTrust();
    if (!crewTrust.allMeetMinimum) {
      throw new TrustInsufficientError(
        this.config.minCrewTrust,
        Math.floor(crewTrust.averageLevel) as TrustLevel,
      );
    }

    const agentList = Array.from(this.agents.values());
    if (agentList.length === 0) {
      throw new Error('Crew has no agents');
    }

    const results: TrustedTaskResult<T>[] = [];
    let tasksFailed = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Determine which agent handles this task
      let agent: CrewAgentExecutor;
      if (task.assignedAgentId && this.agents.has(task.assignedAgentId)) {
        agent = this.agents.get(task.assignedAgentId)!;
      } else {
        // Round-robin assignment
        agent = agentList[i % agentList.length];
      }

      try {
        const taskResult = await agent.executeTask(task, () =>
          taskRunner(task, agent),
        );
        results.push(taskResult);
      } catch (error) {
        tasksFailed++;

        if (tasksFailed > this.config.maxTaskFailures) {
          logger.warn(
            {
              crewId: this.config.crewId,
              tasksFailed,
              maxAllowed: this.config.maxTaskFailures,
            },
            'Crew aborted due to too many task failures',
          );
          throw error;
        }

        logger.warn(
          {
            crewId: this.config.crewId,
            taskId: task.taskId,
            agentId: agent.agentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Task failed within tolerance, continuing',
        );
      }
    }

    let totalSignals = 0;
    for (const agent of this.agents.values()) {
      totalSignals += agent.callbackHandler.signalsRecorded;
    }

    return {
      results,
      crewId: this.config.crewId,
      crewTrust: crewTrust.averageScore,
      totalSignalsRecorded: totalSignals,
      tasksFailed,
      tasksCompleted: results.length,
    };
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a trust-aware crew agent executor
 */
export function createCrewAgentExecutor(
  trustEngine: TrustEngine,
  config: CrewAgentConfig,
): CrewAgentExecutor {
  return new CrewAgentExecutor(trustEngine, config);
}

/**
 * Create a trust-aware crew executor
 */
export function createCrewExecutor(
  trustEngine: TrustEngine,
  config: CrewConfig,
): CrewExecutor {
  return new CrewExecutor(trustEngine, config);
}
