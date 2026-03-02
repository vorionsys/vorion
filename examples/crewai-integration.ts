/**
 * Vorion + CrewAI Integration Example
 *
 * Demonstrates trust governance for multi-agent crews:
 *   1. Build a two-agent crew (Researcher + Analyst)
 *   2. Attach TrustCallbackHandlers to each agent via CrewAgentExecutor
 *   3. Run tasks through CrewAgentExecutor.executeTask with trust gating
 *   4. Use CrewExecutor.kickoff to enforce minimum crew trust
 *   5. Observe how task outcomes evolve trust scores
 *
 * This example uses `@vorionsys/atsf-core` directly (no API server required).
 *
 * In production, pair this with a Cognigate endpoint so all crew decisions are
 * logged to a cryptographically linked audit ledger.
 *
 * Run:  npx tsx examples/crewai-integration.ts
 */

import { TrustEngine, TRUST_LEVEL_NAMES, TrustInsufficientError } from '@vorionsys/atsf-core';
import {
  createCrewAgentExecutor,
  createCrewExecutor,
  createCrewTrustTools,
} from '@vorionsys/atsf-core';
import type { CrewAgentConfig, CrewConfig, CrewTaskConfig } from '@vorionsys/atsf-core';

// ---------------------------------------------------------------------------
// 1. Bootstrap a shared trust engine for the crew
// ---------------------------------------------------------------------------
const engine = new TrustEngine();

// ---------------------------------------------------------------------------
// 2. Define agent configurations
// ---------------------------------------------------------------------------
const researcherConfig: CrewAgentConfig = {
  agentId: 'researcher-001',
  role: 'Senior Researcher',
  goal: 'Gather comprehensive information on assigned topics',
  initialTrustLevel: 4,
  minTrustLevel: 2,
  allowDelegation: true,
};

const analystConfig: CrewAgentConfig = {
  agentId: 'analyst-001',
  role: 'Data Analyst',
  goal: 'Transform raw data into actionable insights',
  initialTrustLevel: 3,
  minTrustLevel: 2,
  allowDelegation: false,
};

// ---------------------------------------------------------------------------
// 3. Crew configuration
// ---------------------------------------------------------------------------
const crewConfig: CrewConfig = {
  crewId: 'research-analysis-crew',
  process: 'sequential',
  minCrewTrust: 2,
  maxTaskFailures: 1,
};

// ---------------------------------------------------------------------------
// 4. Sample tasks
// ---------------------------------------------------------------------------
const tasks: CrewTaskConfig[] = [
  {
    taskId: 'task-lit-review',
    description: 'Literature review on AI governance frameworks',
    assignedAgentId: 'researcher-001',
  },
  {
    taskId: 'task-data-analysis',
    description: 'Analyze trust metric trends from last 30 days',
    assignedAgentId: 'analyst-001',
  },
];

async function main(): Promise<void> {
  console.log('=== Vorion + CrewAI Integration Demo ===\n');

  // -------------------------------------------------------------------------
  // 5. Create per-agent executors (each wraps its own TrustCallbackHandler)
  //    In a real CrewAI app, wrap each CrewAI Agent object in a
  //    CrewAgentExecutor and use it as the gateway for task execution.
  // -------------------------------------------------------------------------
  const researcherExecutor = createCrewAgentExecutor(engine, researcherConfig);
  const analystExecutor    = createCrewAgentExecutor(engine, analystConfig);

  await researcherExecutor.initialize();
  await analystExecutor.initialize();

  let rscore = await engine.getScore(researcherConfig.agentId);
  let ascore  = await engine.getScore(analystConfig.agentId);
  console.log(`Researcher  → level ${rscore?.level} (${TRUST_LEVEL_NAMES[rscore?.level ?? 0]})`);
  console.log(`Analyst     → level ${ascore?.level} (${TRUST_LEVEL_NAMES[ascore?.level ?? 0]})\n`);

  // -------------------------------------------------------------------------
  // 6. Run tasks individually through CrewAgentExecutor
  //    executeTask(task, fn) checks trust, runs fn(), and records signals.
  //    fn is a zero-argument async function — the task context is captured
  //    via closure (just as CrewAI's task runner would call your agent).
  // -------------------------------------------------------------------------
  console.log('--- Researcher: running literature review task ---');
  const task1 = tasks[0]!;
  const r1 = await researcherExecutor.executeTask(task1, async () => {
    // Simulate research (real usage: call a LangChain agent, browse tool, etc.)
    return `3 papers found; key themes: accountability, explainability, oversight`;
  });
  console.log(`Result:           ${r1.result}`);
  console.log(`Signals recorded: ${r1.signalsRecorded}`);
  console.log(`Final score:      ${r1.finalScore} | level: ${r1.finalLevel}\n`);

  console.log('--- Analyst: running data analysis task ---');
  const task2 = tasks[1]!;
  const r2 = await analystExecutor.executeTask(task2, async () => {
    return `5 anomalies detected; 12% improvement trend in T4+ agents over 30d`;
  });
  console.log(`Result:           ${r2.result}`);
  console.log(`Signals recorded: ${r2.signalsRecorded}`);
  console.log(`Final score:      ${r2.finalScore} | level: ${r2.finalLevel}\n`);

  // -------------------------------------------------------------------------
  // 7. Run the whole crew with CrewExecutor.kickoff
  //    kickoff checks every agent meets minCrewTrust, dispatches tasks
  //    by assignedAgentId (or round-robin), and respects maxTaskFailures.
  // -------------------------------------------------------------------------
  console.log('--- Running full crew via kickoff ---');
  const crewExecutor = createCrewExecutor(engine, crewConfig);
  crewExecutor.addAgent(researcherExecutor);
  crewExecutor.addAgent(analystExecutor);
  await crewExecutor.initialize();

  const crewResult = await crewExecutor.kickoff(tasks, async (task, _agent) => {
    // In a real app this is where you'd call your CrewAI task runner
    return `Completed: ${task.description}`;
  });

  console.log(`Tasks completed: ${crewResult.tasksCompleted}`);
  console.log(`Tasks failed:    ${crewResult.tasksFailed}`);
  console.log(`Total signals:   ${crewResult.totalSignalsRecorded}`);
  console.log(`Crew trust avg:  ${crewResult.crewTrust.toFixed(0)}\n`);

  // -------------------------------------------------------------------------
  // 8. What happens when trust is too low?
  //    Simulate failures to drop analyst below the task's minTrustLevel.
  // -------------------------------------------------------------------------
  console.log('--- Simulating trust failure ---');
  const cb = analystExecutor.callbackHandler;
  for (let i = 0; i < 5; i++) {
    await cb.handleTaskStart('failure-sim', `fail-${i}`);
    await cb.handleTaskError(new Error('Simulated error'), `fail-${i}`);
  }

  try {
    await analystExecutor.executeTask(
      { taskId: 'should-be-blocked', description: 'High-trust task', minTrustLevel: 5 },
      async () => 'This should not execute',
    );
  } catch (err) {
    if (err instanceof TrustInsufficientError) {
      console.log(`Blocked as expected: ${err.message}\n`);
    } else {
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 9. Expose trust info to agents via LangChain-compatible tool descriptors
  //    Pass these to your CrewAI Agent's tools list so the agent can query
  //    its own trust level before initiating high-privilege operations.
  // -------------------------------------------------------------------------
  console.log('--- Trust-gated tool catalog ---');
  const tools = createCrewTrustTools(engine, researcherConfig.agentId);
  for (const tool of tools) {
    console.log(` • ${tool.name}: ${tool.description}`);
  }

  // Final trust scores
  rscore = await engine.getScore(researcherConfig.agentId);
  ascore  = await engine.getScore(analystConfig.agentId);
  console.log(`\nFinal researcher trust: level ${rscore?.level}`);
  console.log(`Final analyst trust:    level ${ascore?.level}`);

  console.log('\n=== Done ===');
}

main().catch(console.error);
