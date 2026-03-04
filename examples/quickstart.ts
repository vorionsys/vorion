/**
 * Vorion SDK Quickstart Example
 *
 * This example demonstrates using the SDK in local mode (in-memory).
 * Perfect for testing and development without a running cognigate-api.
 *
 * Run: npm run quickstart
 */

import { Vorion } from '@vorionsys/sdk';

async function main() {
  console.log('🚀 Vorion SDK Quickstart\n');

  // Create SDK in local mode (default when no apiEndpoint)
  const vorion = new Vorion({ localMode: true });

  console.log(`Mode: ${vorion.isLocalMode() ? 'Local (in-memory)' : 'Remote'}\n`);

  // Register an AI agent
  const agent = await vorion.registerAgent({
    agentId: 'quickstart-agent',
    name: 'Quickstart Demo Agent',
    capabilities: ['read:*', 'write:documents'],
  });

  console.log(`✅ Agent registered: ${agent.getName()} (${agent.getId()})`);
  console.log(`   Capabilities: ${agent.getCapabilities().join(', ')}\n`);

  // Check initial trust
  let trust = await agent.getTrustInfo();
  console.log(`📊 Initial Trust:`);
  console.log(`   Score: ${trust.score}/1000`);
  console.log(`   Tier: T${trust.tierNumber} (${trust.tierName})\n`);

  // Request permission to read a file
  console.log('📖 Requesting: read documents/report.pdf');
  const readResult = await agent.requestAction({
    type: 'read',
    resource: 'documents/report.pdf',
  });

  console.log(`   Allowed: ${readResult.allowed}`);
  console.log(`   Decision: ${readResult.tier}`);
  console.log(`   Reason: ${readResult.reason}`);
  console.log(`   Proof ID: ${readResult.proofId}`);
  if (readResult.constraints?.length) {
    console.log(`   Constraints: ${readResult.constraints.join(', ')}`);
  }
  console.log();

  // Report success to improve trust
  if (readResult.allowed) {
    await agent.reportSuccess('read');
    console.log('✅ Reported successful action\n');
  }

  // Try an action without capability
  console.log('🔒 Requesting: delete users/admin (no capability)');
  const deleteResult = await agent.requestAction({
    type: 'delete',
    resource: 'users/admin',
  });

  console.log(`   Allowed: ${deleteResult.allowed}`);
  console.log(`   Decision: ${deleteResult.tier}`);
  console.log(`   Reason: ${deleteResult.reason}\n`);

  // Check trust after actions
  trust = await agent.getTrustInfo();
  console.log(`📊 Final Trust:`);
  console.log(`   Score: ${trust.score}/1000`);
  console.log(`   Tier: T${trust.tierNumber} (${trust.tierName})\n`);

  // Show action history
  const history = agent.getActionHistory();
  console.log(`📜 Action History (${history.length} actions):`);
  history.forEach((h, i) => {
    console.log(`   ${i + 1}. ${h.action} - ${h.allowed ? '✅' : '❌'}`);
  });

  console.log('\n✨ Quickstart complete!');
}

main().catch(console.error);
