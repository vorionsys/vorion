/**
 * Vorion LangChain Integration Example
 *
 * This example demonstrates integrating Vorion governance with LangChain agents.
 * Uses the trust tools to query and report trust information.
 *
 * Features:
 *   - Trust-aware tool execution
 *   - Trust query tools for agents
 *   - Trust score reporting
 *   - Full audit trail with signals
 *
 * Run: npm run langchain
 */

import {
  createTrustEngine,
  createTrustTools,
  createTrustQueryTool,
  TRUST_LEVEL_NAMES,
} from '@vorionsys/atsf-core';

// Simulated LangChain tool interface
interface LangChainTool {
  name: string;
  description: string;
  invoke: (input: string) => Promise<string>;
}

async function main() {
  console.log('🔗 Vorion LangChain Integration Example\n');

  // Create trust engine
  const trustEngine = createTrustEngine({
    decayRate: 0.01,
    decayIntervalMs: 60000,
    failureThreshold: 0.3,
    acceleratedDecayMultiplier: 3.0,
  });

  // Initialize an agent entity in the trust system
  const agentId = 'langchain-demo-agent';
  await trustEngine.initializeEntity(agentId, 3); // Start at T3 (Monitored)

  const record = await trustEngine.getScore(agentId);
  console.log(`Agent initialized: ${agentId}`);
  console.log(`  Trust Level: T${record?.level} (${TRUST_LEVEL_NAMES[record?.level ?? 0]})`);
  console.log(`  Trust Score: ${record?.score}/1000\n`);

  // Create trust-aware tools for the agent
  console.log('Creating trust tools for LangChain agent...\n');

  const trustTools = createTrustTools(trustEngine, agentId);
  const queryTool = createTrustQueryTool(trustEngine);

  // Convert to LangChain-compatible tools
  const tools: LangChainTool[] = [
    ...trustTools.map(t => ({
      name: t.name,
      description: t.description,
      invoke: async (input: string) => t.func(input),
    })),
    {
      name: queryTool.name,
      description: queryTool.description,
      invoke: async (input: string) => queryTool.func(input),
    },
  ];

  console.log(`Created ${tools.length} trust tools:`);
  tools.forEach(t => console.log(`  - ${t.name}`));
  console.log();

  // Demonstrate tool usage
  console.log('--- Demonstrating Trust Tools ---\n');

  // 1. Check current trust
  console.log('📊 Tool: check_my_trust');
  const myTrust = await tools.find(t => t.name === 'check_my_trust')!.invoke('');
  console.log(`   Result: ${myTrust}\n`);

  // 2. Check trust requirements for different actions
  console.log('📋 Tool: check_trust_requirements');
  const actions = ['read_files', 'send_email', 'execute_code', 'access_secrets'];
  for (const action of actions) {
    const result = await tools.find(t => t.name === 'check_trust_requirements')!.invoke(action);
    const parsed = JSON.parse(result);
    console.log(`   ${action}: ${parsed.allowed ? '✅' : '❌'} (requires T${parsed.requiredLevel})`);
  }
  console.log();

  // 3. Get all trust levels
  console.log('📈 Tool: get_trust_levels');
  const levels = await tools.find(t => t.name === 'get_trust_levels')!.invoke('');
  const parsedLevels = JSON.parse(levels);
  console.log('   Trust Level System:');
  parsedLevels.levels.forEach((l: { level: number; name: string; scoreRange: { min: number; max: number } }) => {
    console.log(`     T${l.level}: ${l.name} (${l.scoreRange.min}-${l.scoreRange.max})`);
  });
  console.log();

  // 4. Report task success
  console.log('✅ Tool: report_task_success');
  const successResult = await tools.find(t => t.name === 'report_task_success')!.invoke('Completed data analysis task');
  const successParsed = JSON.parse(successResult);
  console.log(`   Recorded: ${successParsed.recorded}`);
  console.log(`   New Score: ${successParsed.newScore}/1000`);
  console.log();

  // 5. Report task failure (to demonstrate)
  console.log('❌ Tool: report_task_failure');
  const failResult = await tools.find(t => t.name === 'report_task_failure')!.invoke('API timeout during request');
  const failParsed = JSON.parse(failResult);
  console.log(`   Recorded: ${failParsed.recorded}`);
  console.log(`   New Score: ${failParsed.newScore}/1000`);
  console.log(`   Accelerated Decay: ${failParsed.acceleratedDecay}`);
  console.log();

  // 6. Query another entity's trust
  console.log('🔍 Tool: query_entity_trust');

  // Create another agent to query
  await trustEngine.initializeEntity('other-agent', 5);
  const otherResult = await tools.find(t => t.name === 'query_entity_trust')!.invoke('other-agent');
  const otherParsed = JSON.parse(otherResult);
  console.log(`   Entity: ${otherParsed.entityId}`);
  console.log(`   Score: ${otherParsed.score}/1000`);
  console.log(`   Level: T${otherParsed.level} (${otherParsed.levelName})`);
  console.log();

  // Show final trust state
  const finalRecord = await trustEngine.getScore(agentId);
  console.log('--- Final Trust State ---\n');
  console.log(`Agent: ${agentId}`);
  console.log(`  Trust Level: T${finalRecord?.level} (${TRUST_LEVEL_NAMES[finalRecord?.level ?? 0]})`);
  console.log(`  Trust Score: ${finalRecord?.score}/1000`);
  console.log(`  Signals Recorded: ${finalRecord?.signals?.length ?? 0}`);

  // Demonstrate event-driven architecture
  console.log('\n--- Event System Demo ---\n');

  trustEngine.on('trust:signal_recorded', (event) => {
    console.log(`  [Event] Signal: ${event.signal.type} (value: ${event.signal.value.toFixed(2)})`);
  });

  trustEngine.on('trust:tier_changed', (event) => {
    console.log(`  [Event] Tier changed: T${event.previousLevel} -> T${event.newLevel}`);
  });

  // Record some signals
  console.log('Recording additional signals...');
  for (let i = 0; i < 3; i++) {
    await trustEngine.recordSignal({
      id: `demo-signal-${i}`,
      entityId: agentId,
      type: 'behavioral.task_completed',
      value: 0.9,
      source: 'demo',
      timestamp: new Date().toISOString(),
      metadata: { iteration: i },
    });
  }

  console.log('\n✨ LangChain integration example complete!');
  console.log('\nKey Takeaways:');
  console.log('  - Trust tools let agents query their own trust state');
  console.log('  - Agents can check requirements before taking actions');
  console.log('  - Self-reporting builds or degrades trust over time');
  console.log('  - Event system enables real-time monitoring');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
