/**
 * Vorion Trust Scoring Example
 *
 * Demonstrates the trust score lifecycle using two approaches:
 *   A. @vorionsys/sdk (simple Vorion class) -- local mode
 *   B. @vorionsys/cognigate (full Cognigate client) -- remote API mode
 *
 * Topics covered:
 *   - Getting current trust status
 *   - Submitting outcomes to update trust
 *   - Viewing trust history
 *   - Understanding tier transitions (T0-T7)
 *   - Using branded TrustScore types from @vorionsys/contracts
 *
 * Run:  npx tsx examples/trust-scoring.ts
 */

// ---------------------------------------------------------------------------
// Part A: Trust scoring with the simple SDK (local mode)
// ---------------------------------------------------------------------------

import { createVorion } from '@vorionsys/sdk';
import type { TrustInfo } from '@vorionsys/sdk';

async function localModeTrustDemo(): Promise<void> {
  console.log('=== Part A: Trust Scoring with @vorionsys/sdk (local mode) ===\n');

  const vorion = createVorion({ localMode: true });

  // Register an agent -- starts at trust score 500 (T3: Monitored)
  const agent = await vorion.registerAgent({
    agentId: 'data-analyst-001',
    name: 'Data Analyst Bot',
    capabilities: ['read:*', 'analyze:*'],
  });

  // Step 1: Check initial trust status
  let trust: TrustInfo = await agent.getTrustInfo();
  console.log('Initial trust status:');
  printTrustInfo(trust);

  // Step 2: Simulate successful actions to build trust
  // Each successful action slightly increases the trust score.
  console.log('\nPerforming 10 successful actions...');
  for (let i = 0; i < 10; i++) {
    const result = await agent.requestAction({
      type: 'read',
      resource: 'analytics/dashboard',
    });
    if (result.allowed) {
      await agent.reportSuccess('read');
    }
  }

  trust = await agent.getTrustInfo();
  console.log('\nTrust after 10 successes:');
  printTrustInfo(trust);

  // Step 3: Simulate a failure -- trust decreases more steeply
  console.log('\nReporting a failure...');
  await agent.reportFailure('analyze', 'Produced incorrect summary');

  trust = await agent.getTrustInfo();
  console.log('\nTrust after failure:');
  printTrustInfo(trust);

  // Step 4: Show action history as a lightweight audit trail
  const history = agent.getActionHistory();
  console.log(`\nAction history (${history.length} entries):`);
  const allowed = history.filter(h => h.allowed).length;
  const denied  = history.filter(h => !h.allowed).length;
  console.log(`  Allowed: ${allowed}, Denied: ${denied}`);
}

// ---------------------------------------------------------------------------
// Part B: Trust scoring with the Cognigate client (remote API)
// ---------------------------------------------------------------------------

import { Cognigate, CognigateError } from '@vorionsys/cognigate';
import type { TrustStatus, GovernanceDecision } from '@vorionsys/cognigate';

async function remoteModeTrustDemo(): Promise<void> {
  console.log('\n=== Part B: Trust Scoring with @vorionsys/cognigate (remote API) ===\n');

  // The Cognigate client requires an API key.
  // In a real app, read from environment variables.
  const apiKey = process.env.VORION_API_KEY;
  if (!apiKey) {
    console.log('Skipping remote demo -- set VORION_API_KEY to run this section.');
    console.log('Showing the code structure instead:\n');
    showRemoteModeStructure();
    return;
  }

  const client = new Cognigate({
    apiKey,
    baseUrl: process.env.VORION_API_ENDPOINT ?? 'https://cognigate.dev/v1',
  });

  try {
    // Step 1: Get trust status for an agent
    const status: TrustStatus = await client.trust.getStatus('data-analyst-001');
    console.log('Trust status:');
    console.log(`  Entity:     ${status.entityId}`);
    console.log(`  Score:      ${status.trustScore} / 1000`);
    console.log(`  Tier:       ${status.tierName} (${status.trustTier})`);
    console.log(`  Compliant:  ${status.compliant}`);
    console.log(`  Warnings:   ${status.warnings.length > 0 ? status.warnings.join(', ') : 'none'}`);
    console.log(`  Factors:    ${JSON.stringify(status.factorScores)}`);

    // Step 2: Submit an outcome to update the trust score
    // After an agent completes an action (tracked by a proof ID),
    // report whether it succeeded or failed.
    const updatedStatus = await client.trust.submitOutcome(
      'data-analyst-001',
      'proof-abc-123',       // proof ID from a previous governance decision
      {
        success: true,
        metrics: { accuracy: 0.95, latency: 120 },
        notes: 'Completed data analysis within SLA',
      }
    );
    console.log('\nAfter submitting success outcome:');
    console.log(`  Score: ${updatedStatus.trustScore} (was ${status.trustScore})`);
    console.log(`  Tier:  ${updatedStatus.tierName}`);

    // Step 3: View trust history
    const history = await client.trust.getHistory('data-analyst-001', {
      limit: 5,
    });
    console.log('\nTrust history (last 5 entries):');
    for (const entry of history) {
      console.log(`  Score: ${entry.score}, Tier: ${entry.tier}, Time: ${entry.timestamp}`);
    }

    // Step 4: Understand tier from score using static helpers
    const tier = Cognigate.getTierFromScore(updatedStatus.trustScore);
    const tierName = Cognigate.getTierName(tier);
    const thresholds = Cognigate.getTierThresholds(tier);
    console.log(`\nCurrent tier breakdown:`);
    console.log(`  Tier: ${tierName}`);
    console.log(`  Score range: ${thresholds.min}-${thresholds.max}`);

  } catch (err) {
    if (err instanceof CognigateError) {
      console.error(`Cognigate API error [${err.code}]: ${err.message}`);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Part C: Branded TrustScore types from @vorionsys/contracts
// ---------------------------------------------------------------------------

import {
  createTrustScore,
  createTrustScoreClamped,
  parseTrustScore,
  normalizeTo100,
  normalizeToDecimal,
  addToTrustScore,
  isCriticallyLow,
  meetsThreshold,
  INITIAL_TRUST_SCORE,
  CIRCUIT_BREAKER_THRESHOLD,
} from '@vorionsys/contracts/canonical';
import type { TrustScore } from '@vorionsys/contracts/canonical';

function brandedTrustScoreDemo(): void {
  console.log('\n=== Part C: Branded TrustScore types (@vorionsys/contracts) ===\n');

  // createTrustScore validates and returns a branded type.
  // Raw numbers cannot accidentally be used where TrustScore is expected.
  const score: TrustScore = createTrustScore(750);
  console.log('Created TrustScore:', score);

  // Clamped variant -- out-of-range values are clamped instead of throwing.
  const clamped = createTrustScoreClamped(1500);
  console.log('Clamped(1500):', clamped);  // 1000

  // Safe parsing returns a result object instead of throwing.
  const parseResult = parseTrustScore(750);
  if (parseResult.success) {
    console.log('Parsed score:', parseResult.score);
  }

  const badResult = parseTrustScore(-50);
  if (!badResult.success) {
    console.log('Parse error:', badResult.error);
  }

  // Scale conversions
  console.log('\nScale conversions:');
  console.log(`  750 -> 0-100 scale: ${normalizeTo100(score)}`);        // 75
  console.log(`  750 -> 0-1 decimal: ${normalizeToDecimal(score)}`);    // 0.75

  // Arithmetic: add a delta, result is clamped to 0-1000
  const boosted = addToTrustScore(score, 100);
  console.log(`\n750 + 100 = ${boosted}`);  // 850

  const penalized = addToTrustScore(score, -800);
  console.log(`750 - 800 = ${penalized}`);  // 0 (clamped)

  // Threshold checks
  console.log('\nThreshold checks:');
  console.log(`  Score ${score} >= INITIAL (${INITIAL_TRUST_SCORE})?`, meetsThreshold(score, INITIAL_TRUST_SCORE));
  console.log(`  Score ${penalized} is critically low?`, isCriticallyLow(penalized));
  console.log(`  Circuit breaker threshold: ${CIRCUIT_BREAKER_THRESHOLD}`);
}

// ---------------------------------------------------------------------------
// Part D: Tier transition reference
// ---------------------------------------------------------------------------

function tierTransitionReference(): void {
  console.log('\n=== Part D: Tier Transition Reference ===\n');

  // Trust tiers map score ranges to autonomy levels.
  // Higher trust = more autonomy; failures cause faster drops than successes cause gains.
  const tiers = [
    { tier: 'T0', name: 'Sandbox',     range: '0-199',   desc: 'Fully sandboxed, no real actions' },
    { tier: 'T1', name: 'Observed',    range: '200-349',  desc: 'Read-only observation' },
    { tier: 'T2', name: 'Provisional', range: '350-499',  desc: 'Limited actions with approval' },
    { tier: 'T3', name: 'Monitored',   range: '500-649',  desc: 'Standard monitoring (default start)' },
    { tier: 'T4', name: 'Standard',    range: '650-799',  desc: 'Self-directed within bounds' },
    { tier: 'T5', name: 'Trusted',     range: '800-875',  desc: 'Expanded autonomy' },
    { tier: 'T6', name: 'Certified',   range: '876-950',  desc: 'Independent operation' },
    { tier: 'T7', name: 'Autonomous',  range: '951-1000', desc: 'Full autonomy' },
  ];

  console.log('Tier | Name        | Score Range | Description');
  console.log('-----|-------------|-------------|-----------------------------------');
  for (const t of tiers) {
    console.log(
      `${t.tier.padEnd(4)} | ${t.name.padEnd(11)} | ${t.range.padEnd(11)} | ${t.desc}`
    );
  }

  console.log('\nKey behaviors:');
  console.log('  - New agents start at T3 (score 500) in local mode');
  console.log('  - Successes increase score incrementally (+1 to +2 per action)');
  console.log('  - Failures decrease score more steeply (-20 per failure)');
  console.log('  - Tier transitions happen automatically as score crosses thresholds');
  console.log('  - Below T1 (score < 200), all actions are denied');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printTrustInfo(info: TrustInfo): void {
  console.log(`  Score:            ${info.score} / 1000`);
  console.log(`  Tier:             ${info.tierName} (T${info.tierNumber})`);
  console.log(`  Observation tier: ${info.observationTier}`);
}

function showRemoteModeStructure(): void {
  console.log(`  // 1. Get trust status
  const status = await client.trust.getStatus('agent-id');
  //    -> { entityId, trustScore, trustTier, tierName, capabilities, ... }

  // 2. Submit an outcome to update trust
  const updated = await client.trust.submitOutcome('agent-id', 'proof-id', {
    success: true,
    metrics: { accuracy: 0.95 },
  });
  //    -> Updated TrustStatus with new score

  // 3. View trust history
  const history = await client.trust.getHistory('agent-id', { limit: 10 });
  //    -> Array<{ score, tier, timestamp }>

  // 4. Static tier helpers
  const tier = Cognigate.getTierFromScore(750);
  const name = Cognigate.getTierName(tier);
  const range = Cognigate.getTierThresholds(tier);
`);
}

// ---------------------------------------------------------------------------
// Run all demos
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await localModeTrustDemo();
  await remoteModeTrustDemo();
  brandedTrustScoreDemo();
  tierTransitionReference();
}

main().catch((err) => {
  console.error('Trust scoring example failed:', err);
  process.exit(1);
});
