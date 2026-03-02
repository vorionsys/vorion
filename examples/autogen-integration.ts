/**
 * Vorion + AutoGen Integration Example
 *
 * Demonstrates trust governance for AutoGen multi-agent conversations:
 *   1. Track each AutoGen agent's trust score in a shared TrustEngine
 *   2. Record behavioral signals on message send/receive and tool calls
 *   3. Gate high-privilege operations on trust level
 *   4. Suspend agents whose trust drops below a threshold
 *   5. Read the tamper-proof signal audit trail
 *
 * This example uses `@vorionsys/atsf-core` directly — no AutoGen package
 * dependency is required. The pattern wraps AutoGen's event/callback hooks.
 *
 * Note: Vorion does not yet ship a first-party AutoGen adapter. This example
 * shows the raw adapter pattern. See langchain-integration.ts for a reference
 * to a fully-packaged integration using the higher-level facades.
 *
 * Run:  npx tsx examples/autogen-integration.ts
 */

import {
  createTrustEngine,
  TRUST_LEVEL_NAMES,
} from '@vorionsys/atsf-core';
import type { TrustEngine, TrustRecord, TrustSignal } from '@vorionsys/atsf-core';

// ---------------------------------------------------------------------------
// Minimal AutoGen-compatible types (replace with real AutoGen imports in prod)
// ---------------------------------------------------------------------------

interface AutoGenMessage {
  sender: string;           // agentId of the sender
  recipient: string;
  content: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResult?: { name: string; success: boolean; error?: string };
}

// ---------------------------------------------------------------------------
// 1. TrustSignalRecorder — maps AutoGen events to TrustSignals
// ---------------------------------------------------------------------------

class TrustSignalRecorder {
  private trustEngine: TrustEngine;
  private messageCount = 0;
  private errorCount   = 0;

  constructor(trustEngine: TrustEngine) {
    this.trustEngine = trustEngine;
  }

  private makeSignal(entityId: string, type: string, value: number, metadata?: Record<string, unknown>): TrustSignal {
    return {
      id: crypto.randomUUID(),
      entityId,
      type,
      value,
      timestamp: Date.now(),
      metadata,
    };
  }

  /**
   * Register this as your AutoGen `on_messages` / `receive` hook.
   * Example (Python side): agent.register_reply([ConversableAgent], recorder.onMessage)
   */
  async onMessage(msg: AutoGenMessage): Promise<void> {
    this.messageCount++;

    if (msg.functionResult) {
      if (msg.functionResult.success) {
        await this.trustEngine.recordSignal(
          this.makeSignal(msg.sender, 'function_call_success', 0.7, {
            functionName: msg.functionResult.name,
          }),
        );
      } else {
        this.errorCount++;
        await this.trustEngine.recordSignal(
          this.makeSignal(msg.sender, 'function_call_failure', 0.1, {
            functionName: msg.functionResult.name,
            error: msg.functionResult.error,
          }),
        );
      }
    } else if (msg.content.trim().length > 0) {
      // Record each substantive reply as a minor success signal
      await this.trustEngine.recordSignal(
        this.makeSignal(msg.sender, 'message_sent', 0.55, {
          recipient: msg.recipient,
        }),
      );
    }
  }

  get stats(): { messages: number; errors: number } {
    return { messages: this.messageCount, errors: this.errorCount };
  }
}

// ---------------------------------------------------------------------------
// 2. trustGatedAction — blocks execution when trust is below a threshold
// ---------------------------------------------------------------------------

async function trustGatedAction<T>(
  trustEngine: TrustEngine,
  agentId: string,
  minLevel: number,
  fn: () => Promise<T>,
): Promise<T> {
  const record: TrustRecord | undefined = await trustEngine.getScore(agentId);
  const currentLevel = record?.level ?? 0;

  if (currentLevel < minLevel) {
    throw new Error(
      `Agent '${agentId}' trust level ${currentLevel} ` +
      `(${TRUST_LEVEL_NAMES[currentLevel] ?? 'Unknown'}) ` +
      `is below the required ${minLevel} ` +
      `(${TRUST_LEVEL_NAMES[minLevel as keyof typeof TRUST_LEVEL_NAMES] ?? 'Unknown'})`,
    );
  }

  return fn();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Vorion + AutoGen Integration Demo ===\n');

  // -------------------------------------------------------------------------
  // 3. Bootstrap trust engine and register entities
  //    Use the same agentId strings you use in AutoGen so records line up.
  // -------------------------------------------------------------------------
  const engine = createTrustEngine();

  const agents = [
    { agentId: 'assistant-001', name: 'Research Assistant', initialLevel: 3 as const },
    { agentId: 'coder-001',     name: 'Code Writer',        initialLevel: 2 as const },
    { agentId: 'reviewer-001',  name: 'Code Reviewer',      initialLevel: 4 as const },
  ];

  for (const agent of agents) {
    await engine.initializeEntity(agent.agentId, agent.initialLevel);
  }

  for (const agent of agents) {
    const record = await engine.getScore(agent.agentId);
    console.log(
      `${agent.name.padEnd(20)} → level ${record?.level} ` +
      `(${TRUST_LEVEL_NAMES[record?.level ?? 0]})`,
    );
  }
  console.log();

  // -------------------------------------------------------------------------
  // 4. Wire the signal recorder to AutoGen events
  //    In a real AutoGen app, register onMessage via:
  //      agent.register_reply([ConversableAgent], lambda *a, **kw: recorder.onMessage(...))
  // -------------------------------------------------------------------------
  const recorder = new TrustSignalRecorder(engine);

  // Simulate a conversation: assistant → coder → reviewer
  const conversation: AutoGenMessage[] = [
    {
      sender: 'assistant-001',
      recipient: 'coder-001',
      content: 'Please implement a binary search function in Python.',
    },
    {
      sender: 'coder-001',
      recipient: 'reviewer-001',
      content: 'Here is the implementation.',
      functionCall: { name: 'write_file', args: { path: 'search.py' } },
    },
    {
      sender: 'coder-001',
      recipient: 'reviewer-001',
      content: '',
      functionResult: { name: 'write_file', success: true },
    },
    {
      sender: 'reviewer-001',
      recipient: 'assistant-001',
      content: 'Code review complete. Two minor issues found.',
    },
    {
      sender: 'reviewer-001',
      recipient: 'assistant-001',
      content: '',
      functionResult: { name: 'run_tests', success: false, error: 'ImportError on line 3' },
    },
  ];

  console.log('--- Replaying conversation and recording trust signals ---');
  for (const msg of conversation) {
    await recorder.onMessage(msg);
  }

  const { messages, errors } = recorder.stats;
  console.log(`Messages processed: ${messages}`);
  console.log(`Errors encountered: ${errors}\n`);

  // -------------------------------------------------------------------------
  // 5. Check post-conversation trust scores
  // -------------------------------------------------------------------------
  console.log('--- Post-conversation trust scores ---');
  for (const agent of agents) {
    const record = await engine.getScore(agent.agentId);
    console.log(
      `${agent.name.padEnd(20)} → score ${String(record?.score ?? 0).padStart(4)}` +
      ` | level ${record?.level} (${TRUST_LEVEL_NAMES[record?.level ?? 0]})`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Trust-gated high-privilege action (e.g., code deployment)
  //    Before calling agent.run() on a high-stakes task, gate it here.
  // -------------------------------------------------------------------------
  console.log('\n--- Trust-gated deployment (requires level 3+) ---');
  for (const agent of agents) {
    try {
      await trustGatedAction(engine, agent.agentId, 3, async () => {
        console.log(`  ${agent.agentId}: ALLOWED to deploy`);
        return true;
      });
    } catch (err) {
      console.log(`  ${agent.agentId}: DENIED — ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Filter agents for group chat participation (trust >= 2)
  //    In AutoGen, pass an allowed_speaker_selection_method that checks trust.
  // -------------------------------------------------------------------------
  console.log('\n--- Active speakers in group chat (level >= 2) ---');
  for (const agent of agents) {
    const record = await engine.getScore(agent.agentId);
    const level = record?.level ?? 0;
    const marker = level >= 2 ? '✓' : '✗';
    const status = level < 2 ? ' — suspended' : '';
    console.log(` ${marker} ${agent.agentId} (level ${level})${status}`);
  }

  // -------------------------------------------------------------------------
  // 8. Inspect the audit trail
  //    In production, swap the in-memory store for a Cognigate endpoint to get
  //    a cryptographically linked, append-only audit ledger.
  // -------------------------------------------------------------------------
  console.log('\n--- Signal audit trail for reviewer-001 ---');
  const reviewerRecord = await engine.getScore('reviewer-001');
  const recentSignals = (reviewerRecord?.signals ?? []).slice(-3);
  for (const signal of recentSignals) {
    console.log(
      `  ${signal.type.padEnd(28)} value: ${signal.value.toFixed(2)}  ` +
      `ts: ${signal.timestamp}`
    );
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
