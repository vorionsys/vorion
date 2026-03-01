/**
 * Vorion Quickstart Example
 *
 * Demonstrates the core SDK workflow:
 *   1. Create a Vorion client (local or remote mode)
 *   2. Register an agent with capabilities
 *   3. Submit an intent (request an action)
 *   4. Check the agent's trust score
 *   5. View the proof record (audit trail)
 *
 * Run:  npx tsx examples/quickstart.ts
 */

import { Vorion, createVorion } from '@vorionsys/sdk';
import type { VorionConfig, AgentOptions, ActionResult, TrustInfo } from '@vorionsys/sdk';

// ---------------------------------------------------------------------------
// 1. Create a Vorion client
// ---------------------------------------------------------------------------

// Local mode -- everything runs in-memory, no API server required.
// This is ideal for development, testing, and learning the API.
const vorion = createVorion({ localMode: true });

// For production, use remote mode pointing at your Cognigate API:
//
// const vorion = createVorion({
//   apiEndpoint: process.env.VORION_API_ENDPOINT ?? 'http://localhost:3000',
//   apiKey:      process.env.VORION_API_KEY      ?? 'vorion-dev-key-12345',
// });

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 2. Health check
  // -------------------------------------------------------------------------
  const health = await vorion.healthCheck();
  console.log('Health check:', health);
  // => { status: 'healthy', version: 'local' }

  // -------------------------------------------------------------------------
  // 3. Register an agent
  // -------------------------------------------------------------------------
  // Every AI agent that participates in Vorion governance must be registered.
  // You declare its identity, human-readable name, and the capabilities it
  // is allowed to request.
  const agent = await vorion.registerAgent({
    agentId: 'invoice-bot-001',
    name: 'Invoice Processing Bot',
    capabilities: ['read:documents', 'write:invoices', 'read:finance'],
    observationTier: 'GRAY_BOX', // default observation level
  });

  console.log(`\nRegistered agent: ${agent.getName()} (${agent.getId()})`);
  console.log('Capabilities:', agent.getCapabilities());

  // -------------------------------------------------------------------------
  // 4. Submit an intent (request permission to perform an action)
  // -------------------------------------------------------------------------
  // Before performing any action, the agent asks the governance system
  // whether the action is allowed. The system evaluates trust score,
  // capabilities, and policy rules, then returns a decision.
  const readResult: ActionResult = await agent.requestAction({
    type: 'read',
    resource: 'documents/quarterly-report.pdf',
  });

  console.log('\n--- Action Request: read documents ---');
  console.log('Allowed:', readResult.allowed);
  console.log('Decision tier:', readResult.tier);   // GREEN, YELLOW, or RED
  console.log('Reason:', readResult.reason);
  console.log('Proof ID:', readResult.proofId);     // unique audit trail ID
  if (readResult.constraints) {
    console.log('Constraints:', readResult.constraints);
  }

  // -------------------------------------------------------------------------
  // 5. Report the outcome
  // -------------------------------------------------------------------------
  // After completing (or failing) an action, report the outcome back.
  // This feeds the trust scoring system and adjusts the agent's score.
  if (readResult.allowed) {
    // Simulate successful action completion
    await agent.reportSuccess('read');
    console.log('\nReported success for "read" action.');
  }

  // -------------------------------------------------------------------------
  // 6. Try an action the agent does NOT have capability for
  // -------------------------------------------------------------------------
  const deleteResult: ActionResult = await agent.requestAction({
    type: 'delete',
    resource: 'finance/records',
  });

  console.log('\n--- Action Request: delete finance records ---');
  console.log('Allowed:', deleteResult.allowed);    // false
  console.log('Reason:', deleteResult.reason);       // "Missing capability: ..."

  // -------------------------------------------------------------------------
  // 7. Check the agent's trust score
  // -------------------------------------------------------------------------
  const trustInfo: TrustInfo = await agent.getTrustInfo();

  console.log('\n--- Trust Info ---');
  console.log('Score:', trustInfo.score, '/ 1000');
  console.log('Tier:', trustInfo.tierName, `(T${trustInfo.tierNumber})`);
  console.log('Observation tier:', trustInfo.observationTier);

  // -------------------------------------------------------------------------
  // 8. View action history (local proof trail)
  // -------------------------------------------------------------------------
  const history = agent.getActionHistory();

  console.log('\n--- Action History ---');
  for (const entry of history) {
    console.log(
      `  ${entry.action}: ${entry.allowed ? 'ALLOWED' : 'DENIED'} ` +
      `at ${new Date(entry.timestamp).toISOString()}`
    );
  }

  // -------------------------------------------------------------------------
  // 9. Retrieve the agent later by ID
  // -------------------------------------------------------------------------
  const retrieved = vorion.getAgent('invoice-bot-001');
  if (retrieved) {
    console.log('\nRetrieved agent by ID:', retrieved.getName());
  }

  console.log('\nAll registered agents:', vorion.getAllAgents().map(a => a.getId()));
  console.log('\nDone. The agent completed the full governance lifecycle.');
}

main().catch((err) => {
  console.error('Quickstart failed:', err);
  process.exit(1);
});
