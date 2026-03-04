/**
 * Vorion SDK Remote Mode Example
 *
 * This example demonstrates using the SDK with a running cognigate-api server.
 * The API provides persistent trust scoring, real-time policy enforcement,
 * and full audit trails.
 *
 * Prerequisites:
 *   1. Start cognigate-api: cd packages/atsf-core && npm run dev
 *   2. Set environment variables or use defaults below
 *
 * Run: npm run remote
 */

import { Vorion } from '@vorionsys/sdk';

// Configuration - set via environment or use defaults
const API_ENDPOINT = process.env.VORION_API_ENDPOINT || 'http://localhost:3000';
const API_KEY = process.env.VORION_API_KEY || 'vorion-dev-key-12345';

async function main() {
  console.log('🌐 Vorion SDK Remote Mode Example\n');

  // Create SDK in remote mode (connects to cognigate-api)
  const vorion = new Vorion({
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    timeout: 30000,
  });

  console.log(`Connecting to: ${API_ENDPOINT}`);
  console.log(`Mode: ${vorion.isLocalMode() ? 'Local' : 'Remote (cognigate-api)'}\n`);

  // Health check
  try {
    const health = await vorion.healthCheck();
    console.log(`✅ API Health: ${health.status} (v${health.version})\n`);
  } catch (error) {
    console.error('❌ Failed to connect to cognigate-api');
    console.error('   Make sure the server is running: npm run dev');
    console.error(`   Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Register an agent with the governance system
  const agent = await vorion.registerAgent({
    agentId: 'remote-demo-agent',
    name: 'Remote Demo Agent',
    capabilities: ['read:*', 'write:documents', 'execute:analysis'],
    observationTier: 'GRAY_BOX',
    metadata: {
      version: '1.0.0',
      environment: 'development',
    },
  });

  console.log(`✅ Agent registered: ${agent.getName()}`);
  console.log(`   ID: ${agent.getId()}`);
  console.log(`   Capabilities: ${agent.getCapabilities().join(', ')}\n`);

  // Get initial trust info from the server
  let trust = await agent.getTrustInfo();
  console.log(`📊 Trust Status (from server):`);
  console.log(`   Score: ${trust.score}/1000`);
  console.log(`   Tier: T${trust.tierNumber} (${trust.tierName})`);
  console.log(`   Observation: ${trust.observationTier}\n`);

  // Request a series of actions
  const actions = [
    { type: 'read', resource: 'documents/quarterly-report.pdf' },
    { type: 'write', resource: 'documents/analysis-output.json' },
    { type: 'execute', resource: 'analysis/sentiment-model' },
    { type: 'delete', resource: 'system/config' }, // Should be denied
  ];

  console.log('🔄 Processing action requests...\n');

  for (const action of actions) {
    console.log(`📝 Requesting: ${action.type} ${action.resource}`);

    const result = await agent.requestAction(action);

    console.log(`   Decision: ${result.tier} - ${result.allowed ? 'ALLOWED' : 'DENIED'}`);
    console.log(`   Reason: ${result.reason}`);
    console.log(`   Proof ID: ${result.proofId}`);
    if (result.processingTimeMs) {
      console.log(`   Processing: ${result.processingTimeMs}ms`);
    }
    if (result.constraints?.length) {
      console.log(`   Constraints: ${result.constraints.join(', ')}`);
    }

    // Report outcome to build trust
    if (result.allowed) {
      await agent.reportSuccess(action.type);
      console.log(`   ✅ Reported success`);
    }

    console.log();
  }

  // Check updated trust after actions
  trust = await agent.getTrustInfo();
  console.log(`📊 Updated Trust Status:`);
  console.log(`   Score: ${trust.score}/1000`);
  console.log(`   Tier: T${trust.tierNumber} (${trust.tierName})\n`);

  // Demonstrate failure reporting
  console.log('⚠️ Simulating a failed action...');
  await agent.reportFailure('execute', 'External API timeout');

  trust = await agent.getTrustInfo();
  console.log(`   Trust after failure: ${trust.score}/1000 (T${trust.tierNumber})\n`);

  // Show action history
  const history = agent.getActionHistory();
  console.log(`📜 Action History (${history.length} actions):`);
  history.forEach((h, i) => {
    const time = new Date(h.timestamp).toLocaleTimeString();
    console.log(`   ${i + 1}. [${time}] ${h.action} - ${h.allowed ? '✅' : '❌'}`);
  });

  console.log('\n✨ Remote mode example complete!');
  console.log('\nNext steps:');
  console.log('  - Check the cognigate-api logs for detailed audit trail');
  console.log('  - Query /api/v1/trust/remote-demo-agent for trust history');
  console.log('  - Use /api/v1/proofs to verify decision provenance');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
