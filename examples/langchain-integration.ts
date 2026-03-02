/**
 * Vorion + LangChain Integration Example
 *
 * Demonstrates how to wrap LangChain agents with Vorion trust governance:
 *   1. Create a TrustEngine and register an agent
 *   2. Attach a TrustCallbackHandler to observe tool calls
 *   3. Use TrustAwareExecutor to gate execution on trust level
 *   4. Define trust-gated tools with createTrustTools
 *   5. Check how trust evolves after successes and failures
 *
 * This example uses `@vorionsys/atsf-core` directly (no API server required).
 *
 * In production, pair this with a Cognigate endpoint so decisions are logged
 * to a tamper-proof audit ledger.
 *
 * Run:  npx tsx examples/langchain-integration.ts
 */

import {
  createTrustEngine,
  createTrustCallback,
  createTrustAwareExecutor,
  createTrustTools,
  TrustInsufficientError,
  TRUST_LEVEL_NAMES,
} from '@vorionsys/atsf-core';

// ---------------------------------------------------------------------------
// 1. Bootstrap the trust engine
// ---------------------------------------------------------------------------
const engine = createTrustEngine();

async function main(): Promise<void> {
  console.log('=== Vorion + LangChain Integration Demo ===\n');

  // -------------------------------------------------------------------------
  // 2. Attach a TrustCallbackHandler
  //    This is a LangChain-style BaseCallbackHandler that records trust signals
  //    every time a tool starts, ends, or errors.
  // -------------------------------------------------------------------------
  const callback = createTrustCallback(engine, {
    agentId: 'lc-research-agent',
    initialTrustLevel: 3,  // Start at T3 (Monitored)
    minAllowedTrustLevel: 1,
  });

  await callback.initialize();
  console.log(`Agent registered. agentId: ${callback.agentId}`);

  let score = await engine.getScore(callback.agentId);
  console.log(`Initial trust level: ${score?.level ?? 'N/A'} (${TRUST_LEVEL_NAMES[score?.level ?? 0]})\n`);

  // -------------------------------------------------------------------------
  // 3. Simulate tool invocations via the callback
  //    In a real LangChain app, you pass `callbacks: [trustCallback]` to any
  //    chain, agent, or executor and this happens automatically.
  // -------------------------------------------------------------------------
  console.log('--- Simulating 5 tool successes ---');
  for (let i = 0; i < 5; i++) {
    await callback.handleToolStart({ name: 'web_search' }, `query-${i}`, `run-${i}`);
    await callback.handleToolEnd(`result-${i}`, `run-${i}`);
  }

  score = await engine.getScore(callback.agentId);
  console.log(`After 5 successes: level ${score?.level} (${TRUST_LEVEL_NAMES[score?.level ?? 0]})`);
  console.log(`Signals recorded: ${callback.signalsRecorded}\n`);

  // -------------------------------------------------------------------------
  // 4. Use TrustAwareExecutor to gate action execution
  //    The executor checks trust before running any action. If the agent falls
  //    below minTrustLevel, it throws TrustInsufficientError instead.
  // -------------------------------------------------------------------------
  const executor = createTrustAwareExecutor(engine, {
    agentId: callback.agentId,
    minTrustLevel: 2,
  });

  console.log('--- Running trust-gated action (should pass) ---');
  try {
    const result = await executor.execute(
      async () => {
        // Simulate a LangChain agent step (tool call, chain run, etc.)
        return { output: 'Summarized research findings', tokenCount: 412 };
      },
    );

    console.log('Action succeeded:', result.result);
    console.log(`Final score: ${result.finalScore} | level: ${result.finalLevel}`);
    console.log(`Signals during execution: ${result.signalsRecorded}\n`);
  } catch (err) {
    if (err instanceof TrustInsufficientError) {
      console.log(`Blocked — trust too low: ${err.message}`);
    } else {
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 5. Simulate failures and observe trust degradation
  // -------------------------------------------------------------------------
  console.log('--- Simulating 3 tool errors ---');
  for (let i = 0; i < 3; i++) {
    await callback.handleToolStart({ name: 'code_executor' }, `code-${i}`, `err-${i}`);
    await callback.handleToolError(new Error('Runtime exception'), `err-${i}`);
  }

  score = await engine.getScore(callback.agentId);
  console.log(`After 3 failures: level ${score?.level} (${TRUST_LEVEL_NAMES[score?.level ?? 0]})\n`);

  // -------------------------------------------------------------------------
  // 6. Explore trust-gated tools
  //    createTrustTools produces a set of LangChain-compatible tool descriptors
  //    that embed trust checks natively in their invocation handler.
  // -------------------------------------------------------------------------
  const tools = createTrustTools(engine, callback.agentId);

  console.log(`--- Trust-gated tool catalog (${tools.length} tools) ---`);
  for (const tool of tools) {
    console.log(` • ${tool.name}: ${tool.description}`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
