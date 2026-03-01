/**
 * Trust-Aware CrewAI Executor
 *
 * Wraps CrewAI crews and tasks with trust-based access control.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { TrustLevel, TrustScore, Intent } from '../common/types.js';
import { TrustInsufficientError } from '../common/types.js';
import type { TrustEngine, TrustRecord } from '../trust-engine/index.js';
import { TRUST_LEVEL_NAMES } from '../trust-engine/index.js';
import type { TrustAwareEnforcementService } from '../enforce/trust-aware-enforcement-service.js';
import type { EnforcementContext, FluidDecisionResult } from '../enforce/index.js';
import type { EvaluationResult } from '../basis/types.js';
import { CrewTrustCallbackHandler, createCrewTrustCallback } from './callback.js';
import type {
  CrewAgentConfig,
  CrewConfig,
  CrewTaskConfig,
  CrewTrustCheckResult,
  TrustedTaskResult,
  TrustedCrewResult,
  DelegationResult,
  TrustGatedCrewExecutorConfig,
  TrustGatedTaskResult,
  TrustGatedCrewResult,
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

// =============================================================================
// TRUST-GATED CREW EXECUTOR
// =============================================================================

const gatedLogger = createLogger({ component: 'trust-gated-crew-executor' });

/**
 * Trust-Gated Crew Executor
 *
 * High-level wrapper that composes TrustEngine + CrewExecutor + TrustAwareEnforcementService
 * to provide a full intent -> enforce -> execute pipeline with live trust gating.
 *
 * Features:
 * - Pre-task trust score checks with configurable thresholds
 * - Optional enforcement service integration (intent -> enforce -> execute)
 * - Automatic trust decay signals on task failures
 * - Automatic trust recovery signals on task successes
 * - Detailed logging of all trust decisions
 * - Backwards-compatible: enforcement service is optional
 */
export class TrustGatedCrewExecutor {
  private trustEngine: TrustEngine;
  private crewExecutor: CrewExecutor;
  private enforcementService: TrustAwareEnforcementService | null;
  private config: Required<TrustGatedCrewExecutorConfig>;

  constructor(
    trustEngine: TrustEngine,
    config: TrustGatedCrewExecutorConfig,
    enforcementService?: TrustAwareEnforcementService | null,
  ) {
    this.trustEngine = trustEngine;
    this.enforcementService = enforcementService ?? null;

    this.config = {
      crew: config.crew,
      agents: config.agents,
      trustScoreThreshold: config.trustScoreThreshold ?? 200,
      trustLevelThreshold: config.trustLevelThreshold ?? 1,
      failureDecaySignalValue: config.failureDecaySignalValue ?? 0.1,
      successRecoverySignalValue: config.successRecoverySignalValue ?? 0.85,
      tenantId: config.tenantId ?? 'default',
      enableEnforcement: config.enableEnforcement ?? true,
    };

    // Create the inner crew executor
    this.crewExecutor = new CrewExecutor(trustEngine, config.crew);

    // Create and add agent executors
    for (const agentConfig of this.config.agents) {
      const agentExecutor = new CrewAgentExecutor(trustEngine, agentConfig);
      this.crewExecutor.addAgent(agentExecutor);
    }

    gatedLogger.info(
      {
        crewId: config.crew.crewId,
        agentCount: config.agents.length,
        trustScoreThreshold: this.config.trustScoreThreshold,
        trustLevelThreshold: this.config.trustLevelThreshold,
        enforcementEnabled: this.config.enableEnforcement && this.enforcementService !== null,
      },
      'TrustGatedCrewExecutor created',
    );
  }

  /**
   * Get the inner CrewExecutor
   */
  get executor(): CrewExecutor {
    return this.crewExecutor;
  }

  /**
   * Get the TrustEngine instance
   */
  get engine(): TrustEngine {
    return this.trustEngine;
  }

  /**
   * Get the crew ID
   */
  get crewId(): string {
    return this.crewExecutor.crewId;
  }

  /**
   * Initialize all agents in the crew
   */
  async initialize(): Promise<void> {
    await this.crewExecutor.initialize();
    gatedLogger.info({ crewId: this.crewId }, 'TrustGatedCrewExecutor initialized');
  }

  /**
   * Check if an agent passes the trust gate for a task.
   *
   * Performs two checks:
   * 1. Trust score threshold check (score >= configured threshold)
   * 2. Trust level threshold check (level >= configured threshold)
   *
   * If enforcement service is available and enabled, also runs full enforcement.
   */
  async checkTrustGate(
    agentId: string,
    task: CrewTaskConfig,
  ): Promise<{
    allowed: boolean;
    trustScore: TrustScore;
    trustLevel: TrustLevel;
    enforcementResult?: FluidDecisionResult;
    reason: string;
  }> {
    const t0 = performance.now();
    const record = await this.trustEngine.getScore(agentId);

    if (!record) {
      gatedLogger.warn(
        { agentId, taskId: task.taskId },
        'Trust gate denied: agent has no trust record',
      );
      return {
        allowed: false,
        trustScore: 0,
        trustLevel: 0 as TrustLevel,
        reason: `Agent ${agentId} has no trust record in the engine`,
      };
    }

    const currentScore = record.score;
    const currentLevel = record.level;

    // Check score threshold
    if (currentScore < this.config.trustScoreThreshold) {
      const reason = `Trust score ${currentScore} is below threshold ${this.config.trustScoreThreshold}`;
      gatedLogger.warn(
        {
          agentId,
          taskId: task.taskId,
          currentScore,
          threshold: this.config.trustScoreThreshold,
          latencyMs: Math.round(performance.now() - t0),
        },
        `Trust gate denied: ${reason}`,
      );
      return { allowed: false, trustScore: currentScore, trustLevel: currentLevel, reason };
    }

    // Check level threshold
    const requiredLevel = task.minTrustLevel ?? this.config.trustLevelThreshold;
    if (currentLevel < requiredLevel) {
      const reason = `Trust level ${TRUST_LEVEL_NAMES[currentLevel]} (T${currentLevel}) is below required ${TRUST_LEVEL_NAMES[requiredLevel]} (T${requiredLevel})`;
      gatedLogger.warn(
        {
          agentId,
          taskId: task.taskId,
          currentLevel,
          requiredLevel,
          latencyMs: Math.round(performance.now() - t0),
        },
        `Trust gate denied: ${reason}`,
      );
      return { allowed: false, trustScore: currentScore, trustLevel: currentLevel, reason };
    }

    // If enforcement service is available and enabled, run full enforcement
    if (this.enforcementService && this.config.enableEnforcement) {
      const enforcementResult = await this.runEnforcement(agentId, task, currentScore, currentLevel);

      if (enforcementResult) {
        const tier = enforcementResult.tier;
        if (tier === 'RED') {
          const reason = `Enforcement denied (RED): ${enforcementResult.decision.denialReason ?? 'policy violation'}`;
          gatedLogger.warn(
            {
              agentId,
              taskId: task.taskId,
              tier,
              decisionId: enforcementResult.decision.id,
              latencyMs: Math.round(performance.now() - t0),
            },
            `Trust gate denied via enforcement: ${reason}`,
          );
          return {
            allowed: false,
            trustScore: currentScore,
            trustLevel: currentLevel,
            enforcementResult,
            reason,
          };
        }

        if (tier === 'YELLOW') {
          const reason = `Enforcement requires refinement (YELLOW): ${enforcementResult.decision.reasoning.join('; ')}`;
          gatedLogger.info(
            {
              agentId,
              taskId: task.taskId,
              tier,
              decisionId: enforcementResult.decision.id,
              refinementOptions: enforcementResult.refinementOptions?.length ?? 0,
              latencyMs: Math.round(performance.now() - t0),
            },
            `Trust gate pending refinement: ${reason}`,
          );
          // YELLOW is treated as denied for automatic execution; callers can refine manually
          return {
            allowed: false,
            trustScore: currentScore,
            trustLevel: currentLevel,
            enforcementResult,
            reason,
          };
        }

        // GREEN - allowed
        gatedLogger.info(
          {
            agentId,
            taskId: task.taskId,
            tier,
            decisionId: enforcementResult.decision.id,
            trustScore: currentScore,
            trustLevel: currentLevel,
            latencyMs: Math.round(performance.now() - t0),
          },
          'Trust gate allowed via enforcement (GREEN)',
        );
        return {
          allowed: true,
          trustScore: currentScore,
          trustLevel: currentLevel,
          enforcementResult,
          reason: `Enforcement approved (GREEN): trust T${currentLevel} (${TRUST_LEVEL_NAMES[currentLevel]}), score ${currentScore}`,
        };
      }
    }

    // No enforcement service or enforcement disabled - use direct trust check
    const reason = `Trust gate passed: T${currentLevel} (${TRUST_LEVEL_NAMES[currentLevel]}), score ${currentScore}`;
    gatedLogger.info(
      {
        agentId,
        taskId: task.taskId,
        trustScore: currentScore,
        trustLevel: currentLevel,
        latencyMs: Math.round(performance.now() - t0),
      },
      reason,
    );
    return { allowed: true, trustScore: currentScore, trustLevel: currentLevel, reason };
  }

  /**
   * Execute a single task through the trust gate.
   *
   * Pipeline: check trust -> (optional) enforce -> execute -> record signals
   */
  async executeGatedTask<T>(
    task: CrewTaskConfig,
    taskRunner: (task: CrewTaskConfig, agent: CrewAgentExecutor) => Promise<T>,
  ): Promise<TrustGatedTaskResult<T>> {
    const t0 = performance.now();

    // Resolve agent
    const agent = this.resolveAgent(task);
    if (!agent) {
      return {
        allowed: false,
        agentId: task.assignedAgentId ?? 'unassigned',
        taskId: task.taskId,
        trustScoreAtDecision: 0,
        trustLevelAtDecision: 0 as TrustLevel,
        reason: `No agent available for task ${task.taskId}`,
        gatingLatencyMs: Math.round(performance.now() - t0),
      };
    }

    // Check trust gate
    const gateResult = await this.checkTrustGate(agent.agentId, task);
    const gatingLatencyMs = Math.round(performance.now() - t0);

    if (!gateResult.allowed) {
      // Record failure signal for trust decay on denial
      await this.recordTrustSignal(
        agent.agentId,
        'behavioral.task_gated_denied',
        this.config.failureDecaySignalValue,
        { taskId: task.taskId, reason: gateResult.reason },
      );

      return {
        allowed: false,
        agentId: agent.agentId,
        taskId: task.taskId,
        trustScoreAtDecision: gateResult.trustScore,
        trustLevelAtDecision: gateResult.trustLevel,
        enforcementTier: gateResult.enforcementResult?.tier,
        reason: gateResult.reason,
        gatingLatencyMs,
      };
    }

    // Execute the task through the agent executor
    try {
      const taskResult = await agent.executeTask(task, () => taskRunner(task, agent));

      // Record success signal for trust recovery
      await this.recordTrustSignal(
        agent.agentId,
        'behavioral.task_gated_success',
        this.config.successRecoverySignalValue,
        { taskId: task.taskId },
      );

      gatedLogger.info(
        {
          agentId: agent.agentId,
          taskId: task.taskId,
          finalScore: taskResult.finalScore,
          finalLevel: taskResult.finalLevel,
          gatingLatencyMs,
        },
        'Trust-gated task completed successfully',
      );

      return {
        allowed: true,
        result: taskResult,
        agentId: agent.agentId,
        taskId: task.taskId,
        trustScoreAtDecision: gateResult.trustScore,
        trustLevelAtDecision: gateResult.trustLevel,
        enforcementTier: gateResult.enforcementResult?.tier,
        reason: gateResult.reason,
        gatingLatencyMs,
      };
    } catch (error) {
      // Record failure signal for trust decay
      await this.recordTrustSignal(
        agent.agentId,
        'behavioral.task_gated_failure',
        this.config.failureDecaySignalValue,
        {
          taskId: task.taskId,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      gatedLogger.warn(
        {
          agentId: agent.agentId,
          taskId: task.taskId,
          error: error instanceof Error ? error.message : String(error),
          gatingLatencyMs,
        },
        'Trust-gated task failed during execution',
      );

      throw error;
    }
  }

  /**
   * Execute a full crew kickoff with trust gating on every task.
   *
   * Unlike the inner CrewExecutor.kickoff(), this method:
   * - Checks trust gate before each task individually
   * - Skips tasks that fail the trust gate (instead of throwing)
   * - Records trust signals after each success/failure
   * - Returns a comprehensive result including denied tasks
   */
  async kickoff<T>(
    tasks: CrewTaskConfig[],
    taskRunner: (task: CrewTaskConfig, agent: CrewAgentExecutor) => Promise<T>,
  ): Promise<TrustGatedCrewResult<T>> {
    gatedLogger.info(
      { crewId: this.crewId, taskCount: tasks.length },
      'Trust-gated crew kickoff starting',
    );

    const taskResults: TrustGatedTaskResult<T>[] = [];
    let tasksCompleted = 0;
    let tasksDeniedByTrust = 0;
    let tasksFailed = 0;

    for (const task of tasks) {
      try {
        const result = await this.executeGatedTask(task, taskRunner);
        taskResults.push(result);

        if (result.allowed && result.result) {
          tasksCompleted++;
        } else if (!result.allowed) {
          tasksDeniedByTrust++;
        }
      } catch (error) {
        tasksFailed++;

        // Capture as a failed result rather than propagating
        const agent = this.resolveAgent(task);
        taskResults.push({
          allowed: true, // it was allowed, but failed during execution
          agentId: agent?.agentId ?? task.assignedAgentId ?? 'unknown',
          taskId: task.taskId,
          trustScoreAtDecision: 0,
          trustLevelAtDecision: 0 as TrustLevel,
          reason: `Task execution failed: ${error instanceof Error ? error.message : String(error)}`,
          gatingLatencyMs: 0,
        });

        // Check if we've exceeded max task failures
        if (tasksFailed > (this.config.crew.maxTaskFailures ?? 0)) {
          gatedLogger.warn(
            {
              crewId: this.crewId,
              tasksFailed,
              maxAllowed: this.config.crew.maxTaskFailures ?? 0,
            },
            'Trust-gated crew aborted due to too many task failures',
          );
          break;
        }
      }
    }

    gatedLogger.info(
      {
        crewId: this.crewId,
        totalTasks: tasks.length,
        tasksCompleted,
        tasksDeniedByTrust,
        tasksFailed,
      },
      'Trust-gated crew kickoff completed',
    );

    return {
      taskResults,
      totalTasks: tasks.length,
      tasksCompleted,
      tasksDeniedByTrust,
      tasksFailed,
      crewId: this.crewId,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Resolve the agent executor for a given task
   */
  private resolveAgent(task: CrewTaskConfig): CrewAgentExecutor | undefined {
    if (task.assignedAgentId) {
      return this.crewExecutor.getAgent(task.assignedAgentId);
    }
    // Return the first available agent as fallback
    const agents = this.crewExecutor.agentExecutors;
    return agents.length > 0 ? agents[0] : undefined;
  }

  /**
   * Run enforcement pipeline: build intent -> call TrustAwareEnforcementService.decide()
   */
  private async runEnforcement(
    agentId: string,
    task: CrewTaskConfig,
    trustScore: TrustScore,
    trustLevel: TrustLevel,
  ): Promise<FluidDecisionResult | null> {
    if (!this.enforcementService) return null;

    try {
      // Build a synthetic intent from the task
      const intent: Intent = {
        id: `crew-task-${task.taskId}-${crypto.randomUUID()}`,
        entityId: agentId,
        goal: task.description,
        context: { taskId: task.taskId, crewId: this.crewId },
        metadata: { source: 'trust-gated-crew-executor', expectedOutput: task.expectedOutput },
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        actionType: 'execute',
        dataSensitivity: 'CONFIDENTIAL',
        reversibility: 'REVERSIBLE',
      };

      // Build a minimal passing evaluation (the trust check is what matters)
      const evaluation: EvaluationResult = {
        passed: true,
        finalAction: 'allow',
        rulesEvaluated: [],
        violatedRules: [],
        totalDurationMs: 0,
        evaluatedAt: new Date().toISOString(),
      };

      const context: EnforcementContext = {
        intent,
        evaluation,
        trustScore,
        trustLevel,
        tenantId: this.config.tenantId,
      };

      const result = await this.enforcementService.decide(context);

      gatedLogger.debug(
        {
          agentId,
          taskId: task.taskId,
          tier: result.tier,
          decisionId: result.decision.id,
        },
        'Enforcement decision completed for trust-gated task',
      );

      return result;
    } catch (error) {
      gatedLogger.error(
        {
          agentId,
          taskId: task.taskId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Enforcement service error during trust-gated execution; falling back to trust-only check',
      );
      return null;
    }
  }

  /**
   * Record a trust signal to the engine
   */
  private async recordTrustSignal(
    agentId: string,
    type: string,
    value: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.trustEngine.recordSignal({
        id: crypto.randomUUID(),
        entityId: agentId,
        type,
        value,
        source: 'trust-gated-crew-executor',
        timestamp: new Date().toISOString(),
        metadata: { ...metadata, crewId: this.crewId },
      });
    } catch (error) {
      gatedLogger.error(
        {
          agentId,
          type,
          value,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to record trust signal',
      );
    }
  }
}

/**
 * Create a TrustGatedCrewExecutor
 *
 * @param trustEngine - The TrustEngine instance for score lookups and signal recording
 * @param config - Configuration for the gated executor
 * @param enforcementService - Optional TrustAwareEnforcementService for full intent enforcement
 */
export function createTrustGatedCrewExecutor(
  trustEngine: TrustEngine,
  config: TrustGatedCrewExecutorConfig,
  enforcementService?: TrustAwareEnforcementService | null,
): TrustGatedCrewExecutor {
  return new TrustGatedCrewExecutor(trustEngine, config, enforcementService);
}
