/**
 * Vorion Governance Enforcement Example
 *
 * Demonstrates governance workflows using two approaches:
 *   A. @vorionsys/sdk -- simple requestAction / reportSuccess / reportFailure
 *   B. @vorionsys/cognigate -- full governance API with intent parsing,
 *      enforcement, permission checks, and proof records
 *
 * Topics covered:
 *   - Parsing natural-language intent into structured actions
 *   - Enforcing governance rules on intents
 *   - Checking permissions without creating proof records
 *   - Handling ALLOW / DENY / ESCALATE / DEGRADE decisions
 *   - Retrieving and verifying proof records
 *
 * Run:  npx tsx examples/governance.ts
 */

// ---------------------------------------------------------------------------
// Part A: Governance with the simple SDK
// ---------------------------------------------------------------------------

import { createVorion } from '@vorionsys/sdk';
import type { ActionResult } from '@vorionsys/sdk';

async function sdkGovernanceDemo(): Promise<void> {
  console.log('=== Part A: Governance with @vorionsys/sdk ===\n');

  const vorion = createVorion({ localMode: true });

  // Register an agent with specific capabilities.
  // Capabilities follow the pattern "action:resource" and support wildcards.
  const agent = await vorion.registerAgent({
    agentId: 'compliance-bot-001',
    name: 'Compliance Checker Bot',
    capabilities: [
      'read:documents',    // can read documents
      'analyze:*',         // can analyze anything
      'write:reports',     // can write reports
    ],
  });

  // ----- Allowed action -----
  // The agent has "read:documents" capability, so this is permitted.
  const readResult: ActionResult = await agent.requestAction({
    type: 'read',
    resource: 'documents/compliance-policy.pdf',
  });

  console.log('1. Read documents (has capability):');
  console.log(`   Allowed: ${readResult.allowed}`);
  console.log(`   Tier:    ${readResult.tier}`);       // GREEN
  console.log(`   Reason:  ${readResult.reason}`);
  console.log(`   Proof:   ${readResult.proofId}`);

  if (readResult.allowed) {
    await agent.reportSuccess('read');
  }

  // ----- Denied action (missing capability) -----
  // The agent does NOT have "delete:*" capability.
  const deleteResult: ActionResult = await agent.requestAction({
    type: 'delete',
    resource: 'documents/old-report.pdf',
  });

  console.log('\n2. Delete documents (no capability):');
  console.log(`   Allowed: ${deleteResult.allowed}`);  // false
  console.log(`   Tier:    ${deleteResult.tier}`);      // RED
  console.log(`   Reason:  ${deleteResult.reason}`);    // "Missing capability: delete:documents"

  // ----- Action with parameters -----
  // Parameters provide context for richer governance decisions.
  const writeResult: ActionResult = await agent.requestAction({
    type: 'write',
    resource: 'reports/quarterly-compliance',
    parameters: {
      format: 'pdf',
      audience: 'board-of-directors',
      classification: 'confidential',
    },
  });

  console.log('\n3. Write report (with parameters):');
  console.log(`   Allowed:     ${writeResult.allowed}`);
  console.log(`   Constraints: ${writeResult.constraints?.join(', ') ?? 'none'}`);

  // ----- Handling constraints -----
  // When an action is allowed, the governance system may attach constraints
  // (e.g., rate limits, audit requirements) based on the agent's trust tier.
  if (writeResult.allowed && writeResult.constraints) {
    console.log('\n   Governance constraints applied:');
    for (const constraint of writeResult.constraints) {
      console.log(`     - ${constraint}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Part B: Full governance with the Cognigate client
// ---------------------------------------------------------------------------

import { Cognigate, CognigateError } from '@vorionsys/cognigate';
import type {
  GovernanceResult,
  GovernanceDecision,
  Intent,
  IntentParseResult,
  ProofRecord,
} from '@vorionsys/cognigate';

async function cognigateGovernanceDemo(): Promise<void> {
  console.log('\n=== Part B: Governance with @vorionsys/cognigate ===\n');

  const apiKey = process.env.VORION_API_KEY;
  if (!apiKey) {
    console.log('Skipping remote demo -- set VORION_API_KEY to run this section.');
    console.log('Showing the code structure instead:\n');
    showGovernanceCodeStructure();
    return;
  }

  const client = new Cognigate({
    apiKey,
    baseUrl: process.env.VORION_API_ENDPOINT ?? 'https://cognigate.dev/v1',
  });

  try {
    // -----------------------------------------------------------------
    // Step 1: Parse a natural-language intent
    // -----------------------------------------------------------------
    // The governance system can parse free-text descriptions of what an
    // agent wants to do into a structured Intent object.
    const parseResult: IntentParseResult = await client.governance.parseIntent(
      'compliance-bot-001',
      'Read the Q4 financial compliance report and generate a summary'
    );

    const intent: Intent = parseResult.intent;
    console.log('Parsed intent:');
    console.log(`  Action:       ${intent.parsedAction}`);
    console.log(`  Risk level:   ${intent.riskLevel}`);
    console.log(`  Confidence:   ${parseResult.confidence}`);
    console.log(`  Required:     ${intent.requiredCapabilities.join(', ')}`);

    // -----------------------------------------------------------------
    // Step 2: Enforce governance rules on the parsed intent
    // -----------------------------------------------------------------
    // The enforce step evaluates the intent against the agent's trust
    // score, capabilities, and active policies. It returns one of four
    // decisions: ALLOW, DENY, ESCALATE, or DEGRADE.
    const result: GovernanceResult = await client.governance.enforce(intent);

    console.log('\nGovernance decision:');
    console.log(`  Decision:   ${result.decision}`);
    console.log(`  Trust:      ${result.trustScore} / 1000 (${result.trustTier})`);
    console.log(`  Reasoning:  ${result.reasoning}`);
    console.log(`  Granted:    ${result.grantedCapabilities.join(', ') || 'none'}`);
    console.log(`  Denied:     ${result.deniedCapabilities.join(', ') || 'none'}`);
    if (result.proofId) {
      console.log(`  Proof ID:   ${result.proofId}`);
    }

    // Handle each decision type
    handleGovernanceDecision(result);

    // -----------------------------------------------------------------
    // Step 3: Convenience method -- parse + enforce in one call
    // -----------------------------------------------------------------
    const evaluation = await client.governance.evaluate(
      'compliance-bot-001',
      'Delete all customer records older than 7 years'
    );

    console.log('\nCombined evaluate (parse + enforce):');
    console.log(`  Action:   ${evaluation.intent.parsedAction}`);
    console.log(`  Risk:     ${evaluation.intent.riskLevel}`);
    console.log(`  Decision: ${evaluation.result.decision}`);

    // -----------------------------------------------------------------
    // Step 4: Check permissions without creating a proof record
    // -----------------------------------------------------------------
    // canPerform is a lightweight check -- useful for UI gating.
    const canRead = await client.governance.canPerform(
      'compliance-bot-001',
      'read:documents',
      ['read:documents', 'analyze:*']
    );

    console.log('\nPermission check (no proof created):');
    console.log(`  Can read documents? ${canRead.allowed}`);
    console.log(`  Reason: ${canRead.reason}`);

    // -----------------------------------------------------------------
    // Step 5: Retrieve proof records for audit
    // -----------------------------------------------------------------
    if (result.proofId) {
      const proof: ProofRecord = await client.proofs.get(result.proofId);
      console.log('\nProof record:');
      console.log(`  ID:            ${proof.id}`);
      console.log(`  Decision:      ${proof.decision}`);
      console.log(`  Outcome:       ${proof.outcome}`);
      console.log(`  Trust before:  ${proof.trustScoreBefore}`);
      console.log(`  Trust after:   ${proof.trustScoreAfter}`);
      console.log(`  Hash:          ${proof.hash}`);
      console.log(`  Previous hash: ${proof.previousHash}`);
    }

    // -----------------------------------------------------------------
    // Step 6: Verify proof chain integrity
    // -----------------------------------------------------------------
    const verification = await client.proofs.verify('compliance-bot-001');
    console.log('\nProof chain verification:');
    console.log(`  Valid:  ${verification.valid}`);
    console.log(`  Errors: ${verification.errors.length > 0 ? verification.errors.join(', ') : 'none'}`);

  } catch (err) {
    if (err instanceof CognigateError) {
      console.error(`\nCognigate error [${err.code}] (HTTP ${err.status}): ${err.message}`);
      if (err.details) {
        console.error('Details:', err.details);
      }
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Decision handler
// ---------------------------------------------------------------------------

function handleGovernanceDecision(result: GovernanceResult): void {
  console.log('\nDecision handling:');

  switch (result.decision) {
    case 'ALLOW':
      // The action is permitted. Proceed and report the outcome afterward.
      console.log('  -> ALLOW: Proceed with the action.');
      console.log(`     Granted capabilities: ${result.grantedCapabilities.join(', ')}`);
      if (result.constraints) {
        console.log(`     Constraints: ${JSON.stringify(result.constraints)}`);
      }
      break;

    case 'DENY':
      // The action is blocked. Log the reason and do not proceed.
      console.log('  -> DENY: Action blocked.');
      console.log(`     Reason: ${result.reasoning}`);
      console.log(`     Denied capabilities: ${result.deniedCapabilities.join(', ')}`);
      break;

    case 'ESCALATE':
      // The action requires human review. Queue for approval.
      console.log('  -> ESCALATE: Requires human approval.');
      console.log(`     Reason: ${result.reasoning}`);
      console.log('     Next step: Send to approval queue.');
      break;

    case 'DEGRADE':
      // The action is partially allowed with reduced capabilities.
      console.log('  -> DEGRADE: Partial execution allowed.');
      console.log(`     Granted: ${result.grantedCapabilities.join(', ')}`);
      console.log(`     Denied:  ${result.deniedCapabilities.join(', ')}`);
      console.log('     Next step: Execute with reduced scope.');
      break;
  }
}

// ---------------------------------------------------------------------------
// Code structure for remote mode (shown when no API key is set)
// ---------------------------------------------------------------------------

function showGovernanceCodeStructure(): void {
  console.log(`  // 1. Parse intent from natural language
  const parseResult = await client.governance.parseIntent(
    'agent-id',
    'Read the compliance report and summarize findings'
  );
  // -> { intent: { parsedAction, riskLevel, ... }, confidence: 0.95 }

  // 2. Enforce governance rules
  const result = await client.governance.enforce(parseResult.intent);
  // -> { decision: 'ALLOW'|'DENY'|'ESCALATE'|'DEGRADE', ... }

  // 3. Convenience: parse + enforce in one call
  const { intent, result } = await client.governance.evaluate(
    'agent-id',
    'Delete old records'
  );

  // 4. Lightweight permission check (no proof record created)
  const canDo = await client.governance.canPerform(
    'agent-id',
    'read:documents',
    ['read:documents']
  );
  // -> { allowed: true, reason: '...' }

  // 5. Retrieve proof record for audit
  const proof = await client.proofs.get('proof-id');
  // -> { id, decision, outcome, trustScoreBefore, trustScoreAfter, hash, ... }

  // 6. Verify proof chain integrity
  const verification = await client.proofs.verify('agent-id');
  // -> { valid: true, errors: [] }
`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await sdkGovernanceDemo();
  await cognigateGovernanceDemo();
}

main().catch((err) => {
  console.error('Governance example failed:', err);
  process.exit(1);
});
