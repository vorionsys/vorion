/**
 * Tests for CrewAI Integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrustEngine } from '../src/trust-engine/index.js';
import { CrewTrustCallbackHandler, createCrewTrustCallback } from '../src/crewai/callback.js';
import {
  CrewAgentExecutor,
  CrewExecutor,
  createCrewAgentExecutor,
  createCrewExecutor,
} from '../src/crewai/executor.js';
import { createCrewTrustTools } from '../src/crewai/tools.js';
import type { CrewAgentConfig, CrewConfig, CrewTaskConfig } from '../src/crewai/types.js';

// =============================================================================
// HELPERS
// =============================================================================

function createTestEngine(): TrustEngine {
  return new TrustEngine();
}

const defaultAgentConfig: CrewAgentConfig = {
  agentId: 'crew-agent-001',
  role: 'Researcher',
  goal: 'Research topics',
  initialTrustLevel: 4,
  minTrustLevel: 1,
  allowDelegation: true,
};

const defaultCrewConfig: CrewConfig = {
  crewId: 'test-crew',
  process: 'sequential',
  minCrewTrust: 1,
  maxTaskFailures: 0,
};

function makeTask(overrides?: Partial<CrewTaskConfig>): CrewTaskConfig {
  return {
    taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    description: 'Test task',
    ...overrides,
  };
}

// =============================================================================
// CALLBACK HANDLER TESTS
// =============================================================================

describe('CrewTrustCallbackHandler', () => {
  let engine: TrustEngine;
  let handler: CrewTrustCallbackHandler;

  beforeEach(() => {
    engine = createTestEngine();
    handler = new CrewTrustCallbackHandler(engine, defaultAgentConfig);
  });

  it('exposes agent ID and role', () => {
    expect(handler.agentId).toBe('crew-agent-001');
    expect(handler.role).toBe('Researcher');
  });

  it('starts with zero signals recorded', () => {
    expect(handler.signalsRecorded).toBe(0);
  });

  it('initializes agent in trust engine', async () => {
    await handler.initialize();
    const record = await engine.getScore('crew-agent-001');
    expect(record).toBeDefined();
    expect(record!.level).toBe(4);
  });

  it('skips initialization if agent already exists', async () => {
    await engine.initializeEntity('crew-agent-001', 3);
    await handler.initialize();
    const record = await engine.getScore('crew-agent-001');
    expect(record!.level).toBe(3); // Should keep original level
  });

  it('records task completion signal', async () => {
    await handler.initialize();
    const runId = 'run-1';
    await handler.handleTaskStart('task-1', runId);
    await handler.handleTaskEnd('task-1', runId);
    expect(handler.signalsRecorded).toBe(1);
  });

  it('records task error signal', async () => {
    await handler.initialize();
    const runId = 'run-2';
    await handler.handleTaskStart('task-1', runId);
    await handler.handleTaskError('task-1', new Error('test error'), runId);
    expect(handler.signalsRecorded).toBe(1);
  });

  it('records delegation signals', async () => {
    await handler.initialize();
    const runId = 'run-3';
    await handler.handleDelegationStart('target-agent', 'task-1', runId);
    await handler.handleDelegationEnd('target-agent', 'task-1', runId);
    expect(handler.signalsRecorded).toBe(1);
  });

  it('records crew lifecycle signals', async () => {
    await handler.initialize();
    const runId = 'run-4';
    await handler.handleCrewStart('crew-1', runId);
    await handler.handleCrewEnd('crew-1', runId);
    expect(handler.signalsRecorded).toBe(1);
  });

  it('does not record start events as signals', async () => {
    await handler.initialize();
    await handler.handleTaskStart('task-1', 'run-x');
    await handler.handleCrewStart('crew-1', 'run-y');
    await handler.handleDelegationStart('target', 'task-1', 'run-z');
    expect(handler.signalsRecorded).toBe(0);
  });

  it('respects recordTaskExecution=false', async () => {
    const quietHandler = new CrewTrustCallbackHandler(engine, {
      ...defaultAgentConfig,
      recordTaskExecution: false,
    });
    await quietHandler.initialize();
    await quietHandler.handleTaskStart('task-1', 'run-1');
    await quietHandler.handleTaskEnd('task-1', 'run-1');
    expect(quietHandler.signalsRecorded).toBe(0);
  });

  it('respects recordDelegation=false', async () => {
    const quietHandler = new CrewTrustCallbackHandler(engine, {
      ...defaultAgentConfig,
      recordDelegation: false,
    });
    await quietHandler.initialize();
    await quietHandler.handleDelegationStart('t', 'task-1', 'run-1');
    await quietHandler.handleDelegationEnd('t', 'task-1', 'run-1');
    expect(quietHandler.signalsRecorded).toBe(0);
  });

  it('creates handler via factory', () => {
    const h = createCrewTrustCallback(engine, defaultAgentConfig);
    expect(h).toBeInstanceOf(CrewTrustCallbackHandler);
    expect(h.agentId).toBe('crew-agent-001');
  });
});

// =============================================================================
// CREW AGENT EXECUTOR TESTS
// =============================================================================

describe('CrewAgentExecutor', () => {
  let engine: TrustEngine;
  let executor: CrewAgentExecutor;

  beforeEach(async () => {
    engine = createTestEngine();
    executor = new CrewAgentExecutor(engine, defaultAgentConfig);
    await executor.initialize();
  });

  it('exposes agent ID and role', () => {
    expect(executor.agentId).toBe('crew-agent-001');
    expect(executor.role).toBe('Researcher');
  });

  it('checks trust and allows when sufficient', async () => {
    const check = await executor.checkTrust(1);
    expect(check.allowed).toBe(true);
    expect(check.currentLevel).toBe(4);
    expect(check.requiredLevel).toBe(1);
  });

  it('checks trust and blocks when insufficient', async () => {
    const check = await executor.checkTrust(7);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('below required');
  });

  it('returns not-allowed for uninitialized agent', async () => {
    const freshExecutor = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'uninitialized-agent',
    });
    const check = await freshExecutor.checkTrust();
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('not initialized');
  });

  it('executes task with trust gating', async () => {
    const task = makeTask();
    const result = await executor.executeTask(task, async () => 'task-result');

    expect(result.result).toBe('task-result');
    expect(result.taskId).toBe(task.taskId);
    expect(result.agentId).toBe('crew-agent-001');
    expect(result.trustCheck.allowed).toBe(true);
    expect(result.signalsRecorded).toBe(1);
  });

  it('blocks task execution when trust insufficient', async () => {
    const task = makeTask({ minTrustLevel: 7 });
    await expect(
      executor.executeTask(task, async () => 'never'),
    ).rejects.toThrow('Trust level');
  });

  it('records failure signal on task error', async () => {
    const task = makeTask();
    await expect(
      executor.executeTask(task, async () => {
        throw new Error('task failed');
      }),
    ).rejects.toThrow('task failed');

    expect(executor.callbackHandler.signalsRecorded).toBe(1);
  });

  it('delegates task to another agent', async () => {
    const targetExecutor = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'crew-agent-002',
      role: 'Writer',
    });
    await targetExecutor.initialize();

    const task = makeTask();
    const result = await executor.delegateTask(
      task,
      targetExecutor,
      async () => 'delegated-result',
    );

    expect(result.result).toBe('delegated-result');
    expect(result.fromAgentId).toBe('crew-agent-001');
    expect(result.toAgentId).toBe('crew-agent-002');
    expect(result.trustCheck.allowed).toBe(true);
    expect(result.delegateeTrustCheck.allowed).toBe(true);
  });

  it('blocks delegation when not allowed', async () => {
    const noDelExecutor = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'no-del-agent',
      allowDelegation: false,
    });
    await noDelExecutor.initialize();

    const target = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'target-agent',
    });
    await target.initialize();

    await expect(
      noDelExecutor.delegateTask(makeTask(), target, async () => 'x'),
    ).rejects.toThrow('not allowed to delegate');
  });

  it('records success and failure signals', async () => {
    await executor.recordSuccess('manual_test');
    await executor.recordFailure('manual_error');

    const record = await executor.getTrustRecord();
    expect(record).toBeDefined();
  });

  it('creates executor via factory', () => {
    const ex = createCrewAgentExecutor(engine, defaultAgentConfig);
    expect(ex).toBeInstanceOf(CrewAgentExecutor);
  });
});

// =============================================================================
// CREW EXECUTOR TESTS
// =============================================================================

describe('CrewExecutor', () => {
  let engine: TrustEngine;
  let crew: CrewExecutor;
  let agent1: CrewAgentExecutor;
  let agent2: CrewAgentExecutor;

  beforeEach(async () => {
    engine = createTestEngine();
    crew = new CrewExecutor(engine, defaultCrewConfig);

    agent1 = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'agent-1',
      role: 'Researcher',
    });
    agent2 = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'agent-2',
      role: 'Writer',
    });

    crew.addAgent(agent1);
    crew.addAgent(agent2);
    await crew.initialize();
  });

  it('exposes crew ID and process', () => {
    expect(crew.crewId).toBe('test-crew');
    expect(crew.process).toBe('sequential');
  });

  it('returns agent executors', () => {
    expect(crew.agentExecutors).toHaveLength(2);
  });

  it('gets agent by ID', () => {
    expect(crew.getAgent('agent-1')).toBe(agent1);
    expect(crew.getAgent('agent-2')).toBe(agent2);
    expect(crew.getAgent('unknown')).toBeUndefined();
  });

  it('computes crew trust', async () => {
    const trust = await crew.getCrewTrust();
    expect(trust.averageScore).toBeGreaterThan(0);
    expect(trust.averageLevel).toBeGreaterThanOrEqual(1);
    expect(trust.allMeetMinimum).toBe(true);
  });

  it('returns zero trust for empty crew', async () => {
    const emptyCrew = new CrewExecutor(engine, defaultCrewConfig);
    const trust = await emptyCrew.getCrewTrust();
    expect(trust.averageScore).toBe(0);
    expect(trust.allMeetMinimum).toBe(false);
  });

  it('executes tasks sequentially via kickoff', async () => {
    const tasks = [
      makeTask({ taskId: 'task-1' }),
      makeTask({ taskId: 'task-2' }),
    ];

    const result = await crew.kickoff(tasks, async (task) => {
      return `result-${task.taskId}`;
    });

    expect(result.crewId).toBe('test-crew');
    expect(result.tasksCompleted).toBe(2);
    expect(result.tasksFailed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].result).toBe('result-task-1');
    expect(result.results[1].result).toBe('result-task-2');
  });

  it('assigns tasks round-robin when not pre-assigned', async () => {
    const tasks = [
      makeTask({ taskId: 'task-1' }),
      makeTask({ taskId: 'task-2' }),
      makeTask({ taskId: 'task-3' }),
    ];

    const agentOrder: string[] = [];
    await crew.kickoff(tasks, async (_task, agent) => {
      agentOrder.push(agent.agentId);
      return 'ok';
    });

    expect(agentOrder).toEqual(['agent-1', 'agent-2', 'agent-1']);
  });

  it('assigns tasks to specific agents when pre-assigned', async () => {
    const tasks = [
      makeTask({ taskId: 'task-1', assignedAgentId: 'agent-2' }),
      makeTask({ taskId: 'task-2', assignedAgentId: 'agent-1' }),
    ];

    const agentOrder: string[] = [];
    await crew.kickoff(tasks, async (_task, agent) => {
      agentOrder.push(agent.agentId);
      return 'ok';
    });

    expect(agentOrder).toEqual(['agent-2', 'agent-1']);
  });

  it('blocks kickoff when crew trust is insufficient', async () => {
    const highTrustCrew = new CrewExecutor(engine, {
      ...defaultCrewConfig,
      minCrewTrust: 7,
    });

    const lowAgent = new CrewAgentExecutor(engine, {
      ...defaultAgentConfig,
      agentId: 'low-agent',
      initialTrustLevel: 1,
    });
    highTrustCrew.addAgent(lowAgent);
    await highTrustCrew.initialize();

    await expect(
      highTrustCrew.kickoff([makeTask()], async () => 'x'),
    ).rejects.toThrow('Trust level');
  });

  it('aborts on too many task failures', async () => {
    const tasks = [
      makeTask({ taskId: 'task-1' }),
      makeTask({ taskId: 'task-2' }),
    ];

    await expect(
      crew.kickoff(tasks, async () => {
        throw new Error('always fails');
      }),
    ).rejects.toThrow('always fails');
  });

  it('tolerates failures within maxTaskFailures', async () => {
    const tolerantCrew = new CrewExecutor(engine, {
      ...defaultCrewConfig,
      maxTaskFailures: 1,
    });
    tolerantCrew.addAgent(agent1);
    await tolerantCrew.initialize();

    let callCount = 0;
    const tasks = [
      makeTask({ taskId: 'task-1' }),
      makeTask({ taskId: 'task-2' }),
    ];

    const result = await tolerantCrew.kickoff(tasks, async () => {
      callCount++;
      if (callCount === 1) throw new Error('first fails');
      return 'second succeeds';
    });

    expect(result.tasksFailed).toBe(1);
    expect(result.tasksCompleted).toBe(1);
  });

  it('throws for empty crew', async () => {
    const emptyCrew = new CrewExecutor(engine, {
      ...defaultCrewConfig,
      minCrewTrust: 0 as any,
    });

    await expect(
      emptyCrew.kickoff([makeTask()], async () => 'x'),
    ).rejects.toThrow();
  });

  it('creates crew executor via factory', () => {
    const ex = createCrewExecutor(engine, defaultCrewConfig);
    expect(ex).toBeInstanceOf(CrewExecutor);
  });
});

// =============================================================================
// CREW TRUST TOOLS TESTS
// =============================================================================

describe('createCrewTrustTools', () => {
  let engine: TrustEngine;

  beforeEach(async () => {
    engine = createTestEngine();
    await engine.initializeEntity('crew-agent-001', 4);
    await engine.initializeEntity('crew-agent-002', 2);
  });

  it('creates 6 tools', () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      'check_agent_trust',
      'check_crew_member_trust',
      'check_delegation_allowed',
      'get_trust_levels',
      'report_task_success',
      'report_task_failure',
    ]);
  });

  it('check_agent_trust returns own trust info', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[0].func(''));
    expect(result.agentId).toBe('crew-agent-001');
    expect(result.level).toBe(4);
    expect(result.score).toBeGreaterThan(0);
  });

  it('check_agent_trust returns error for unknown agent', async () => {
    const tools = createCrewTrustTools(engine, 'unknown-agent');
    const result = JSON.parse(await tools[0].func(''));
    expect(result.error).toBe('Trust record not found');
  });

  it('check_crew_member_trust returns target info', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[1].func('crew-agent-002'));
    expect(result.agentId).toBe('crew-agent-002');
    expect(result.level).toBe(2);
  });

  it('check_delegation_allowed evaluates both agents', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[2].func('crew-agent-002'));
    expect(result.allowed).toBe(true);
    expect(result.yourLevel).toBe(4);
    expect(result.targetLevel).toBe(2);
  });

  it('get_trust_levels returns level info', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[3].func(''));
    expect(result.levels).toBeDefined();
    expect(result.levels.length).toBeGreaterThan(0);
  });

  it('report_task_success records positive signal', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[4].func('Completed research'));
    expect(result.recorded).toBe(true);
    expect(result.newScore).toBeDefined();
  });

  it('report_task_failure records negative signal', async () => {
    const tools = createCrewTrustTools(engine, 'crew-agent-001');
    const result = JSON.parse(await tools[5].func('Failed to complete'));
    expect(result.recorded).toBe(true);
    expect(result.newScore).toBeDefined();
  });
});
