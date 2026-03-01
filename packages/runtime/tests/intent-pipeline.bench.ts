/**
 * Intent Pipeline Performance Benchmarks
 *
 * Run with: npx vitest bench intent-pipeline.bench.ts
 *
 * Benchmarks the runtime IntentPipeline which orchestrates:
 * Intent -> Gate Check -> Authorization -> Execution -> Proof
 *
 * Uses real in-memory TrustFacade and ProofCommitter instances (no mocks).
 *
 * Performance targets:
 * - Single intent processing: < 5ms
 * - Batch intent throughput (10 concurrent): < 20ms
 * - Batch intent throughput (100 concurrent): < 200ms
 * - Proof commit (synchronous): < 1ms
 * - Proof flush: < 50ms for 100 events
 *
 * @packageDocumentation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import {
  IntentPipeline,
  createIntentPipeline,
} from '../src/intent-pipeline/index.js';
import {
  TrustFacade,
  createTrustFacade,
} from '../src/trust-facade/index.js';
import type { AgentCredentials, Action } from '../src/trust-facade/types.js';
import {
  ProofCommitter,
  createProofCommitter,
  InMemoryProofStore,
} from '../src/proof-committer/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeCredentials(agentId = 'bench-agent'): AgentCredentials {
  return {
    agentId,
    name: `Benchmark Agent ${agentId}`,
    capabilities: ['read:data', 'query:data'],
    observationTier: 'WHITE_BOX',
  };
}

function makeAction(type = 'read'): Action {
  return {
    type,
    resource: 'data/benchmark-resource',
    context: { purpose: 'benchmark' },
  };
}

// ===========================================================================
// 1. Single Intent Processing Latency
// ===========================================================================

describe('IntentPipeline — Single Intent', () => {
  let pipeline: IntentPipeline;
  let trustFacade: TrustFacade;
  let proofCommitter: ProofCommitter;
  let credentials: AgentCredentials;
  let action: Action;

  beforeAll(async () => {
    trustFacade = createTrustFacade({ gateTrustCacheTtlMs: 3_600_000 });
    proofCommitter = createProofCommitter(
      { maxBufferSize: 10_000, flushIntervalMs: 999_999 },
      new InMemoryProofStore()
    );
    pipeline = createIntentPipeline(trustFacade, proofCommitter, {
      verboseLogging: false,
      autoRecordSignals: false,
    });

    credentials = makeCredentials();
    action = makeAction();

    // Pre-admit the agent so subsequent calls use cached admission
    await trustFacade.admit(credentials);
  });

  afterAll(async () => {
    await pipeline.stop();
  });

  bench('submit — pre-admitted agent (cache hit)', async () => {
    await pipeline.submit(credentials, action);
  }, { time: 3000, iterations: 2000 });

  bench('submit — new agent (cache miss)', async () => {
    const newCreds = makeCredentials(`new-agent-${Math.random()}`);
    await pipeline.submit(newCreds, action);
  }, { time: 3000, iterations: 1000 });

  bench('check — authorization only (no execution)', async () => {
    await pipeline.check(credentials, action);
  }, { time: 3000, iterations: 5000 });
});

// ===========================================================================
// 2. Single Intent with Execution Handler
// ===========================================================================

describe('IntentPipeline — Intent with Execution', () => {
  let pipeline: IntentPipeline;
  let trustFacade: TrustFacade;
  let proofCommitter: ProofCommitter;
  let credentials: AgentCredentials;
  let action: Action;

  beforeAll(async () => {
    trustFacade = createTrustFacade({ gateTrustCacheTtlMs: 3_600_000 });
    proofCommitter = createProofCommitter(
      { maxBufferSize: 10_000, flushIntervalMs: 999_999 },
      new InMemoryProofStore()
    );
    pipeline = createIntentPipeline(trustFacade, proofCommitter, {
      verboseLogging: false,
      autoRecordSignals: true,
    });

    // Register a lightweight handler
    pipeline.registerHandler('read', async () => ({
      success: true,
      result: { data: 'benchmark-result' },
    }));

    credentials = makeCredentials();
    action = makeAction();

    await trustFacade.admit(credentials);
  });

  afterAll(async () => {
    await pipeline.stop();
  });

  bench('submit — with execution handler + signal recording', async () => {
    await pipeline.submit(credentials, action);
  }, { time: 3000, iterations: 1000 });
});

// ===========================================================================
// 3. Batch Intent Throughput — 10 Concurrent
// ===========================================================================

describe('IntentPipeline — Batch 10 Concurrent', () => {
  let pipeline: IntentPipeline;
  let trustFacade: TrustFacade;
  let proofCommitter: ProofCommitter;
  let agents: AgentCredentials[];
  let action: Action;

  beforeAll(async () => {
    trustFacade = createTrustFacade({ gateTrustCacheTtlMs: 3_600_000 });
    proofCommitter = createProofCommitter(
      { maxBufferSize: 10_000, flushIntervalMs: 999_999 },
      new InMemoryProofStore()
    );
    pipeline = createIntentPipeline(trustFacade, proofCommitter, {
      verboseLogging: false,
      autoRecordSignals: false,
    });

    // Pre-create and pre-admit 10 agents
    agents = [];
    for (let i = 0; i < 10; i++) {
      const creds = makeCredentials(`batch10-agent-${i}`);
      agents.push(creds);
      await trustFacade.admit(creds);
    }

    action = makeAction();
  });

  afterAll(async () => {
    await pipeline.stop();
  });

  bench('10 concurrent submits (pre-admitted)', async () => {
    const promises = agents.map((creds) => pipeline.submit(creds, action));
    await Promise.all(promises);
  }, { time: 5000, iterations: 200 });
});

// ===========================================================================
// 4. Batch Intent Throughput — 100 Concurrent
// ===========================================================================

describe('IntentPipeline — Batch 100 Concurrent', () => {
  let pipeline: IntentPipeline;
  let trustFacade: TrustFacade;
  let proofCommitter: ProofCommitter;
  let agents: AgentCredentials[];
  let action: Action;

  beforeAll(async () => {
    trustFacade = createTrustFacade({ gateTrustCacheTtlMs: 3_600_000 });
    proofCommitter = createProofCommitter(
      { maxBufferSize: 50_000, flushIntervalMs: 999_999 },
      new InMemoryProofStore()
    );
    pipeline = createIntentPipeline(trustFacade, proofCommitter, {
      verboseLogging: false,
      autoRecordSignals: false,
    });

    // Pre-create and pre-admit 100 agents
    agents = [];
    for (let i = 0; i < 100; i++) {
      const creds = makeCredentials(`batch100-agent-${i}`);
      agents.push(creds);
      await trustFacade.admit(creds);
    }

    action = makeAction();
  });

  afterAll(async () => {
    await pipeline.stop();
  });

  bench('100 concurrent submits (pre-admitted)', async () => {
    const promises = agents.map((creds) => pipeline.submit(creds, action));
    await Promise.all(promises);
  }, { time: 10000, iterations: 50 });
});

// ===========================================================================
// 5. Proof Commit (Synchronous Hot Path)
// ===========================================================================

describe('ProofCommitter — Commit Hot Path', () => {
  let proofCommitter: ProofCommitter;

  beforeAll(() => {
    proofCommitter = createProofCommitter(
      { maxBufferSize: 100_000, flushIntervalMs: 999_999 },
      new InMemoryProofStore()
    );
  });

  afterAll(async () => {
    await proofCommitter.stop();
  });

  bench('commit — single event (synchronous)', () => {
    proofCommitter.commit({
      type: 'intent_submitted',
      entityId: 'bench-agent',
      payload: { intentId: `intent-${Math.random()}`, action: 'read' },
      timestamp: Date.now(),
      correlationId: 'bench-correlation',
    });
  }, { time: 2000, iterations: 50_000 });
});

// ===========================================================================
// 6. Proof Flush Performance
// ===========================================================================

describe('ProofCommitter — Flush', () => {
  bench('flush — 100 buffered events', async () => {
    const store = new InMemoryProofStore();
    const committer = createProofCommitter(
      { maxBufferSize: 100_000, flushIntervalMs: 999_999 },
      store
    );

    // Buffer 100 events
    for (let i = 0; i < 100; i++) {
      committer.commit({
        type: 'decision_made',
        entityId: `flush-entity-${i % 10}`,
        payload: { intentId: `intent-${i}`, allowed: true },
        timestamp: Date.now(),
        correlationId: `corr-${i}`,
      });
    }

    // Flush
    await committer.flush();
    await committer.stop();
  }, { time: 5000, iterations: 100 });

  bench('flush — 1000 buffered events', async () => {
    const store = new InMemoryProofStore();
    const committer = createProofCommitter(
      { maxBufferSize: 100_000, flushIntervalMs: 999_999 },
      store
    );

    // Buffer 1000 events
    for (let i = 0; i < 1000; i++) {
      committer.commit({
        type: 'execution_completed',
        entityId: `flush-entity-${i % 50}`,
        payload: { intentId: `intent-${i}`, success: true },
        timestamp: Date.now(),
        correlationId: `corr-${i}`,
      });
    }

    // Flush
    await committer.flush();
    await committer.stop();
  }, { time: 10000, iterations: 20 });
});

// ===========================================================================
// 7. TrustFacade — Admission + Authorization Micro-Benchmarks
// ===========================================================================

describe('TrustFacade — Micro-Benchmarks', () => {
  let facade: TrustFacade;
  let admittedCreds: AgentCredentials;

  beforeAll(async () => {
    facade = createTrustFacade({ gateTrustCacheTtlMs: 3_600_000 });
    admittedCreds = makeCredentials('facade-bench-agent');
    await facade.admit(admittedCreds);
  });

  bench('admit — new agent (first time)', async () => {
    const creds = makeCredentials(`facade-new-${Math.random()}`);
    await facade.admit(creds);
  }, { time: 2000, iterations: 5000 });

  bench('admit — cached agent (cache hit)', async () => {
    await facade.admit(admittedCreds);
  }, { time: 2000, iterations: 10_000 });

  bench('authorize — admitted agent, read action', async () => {
    await facade.authorize(admittedCreds.agentId, makeAction());
  }, { time: 2000, iterations: 10_000 });

  bench('fullCheck — combined admission + authorization', async () => {
    await facade.fullCheck(admittedCreds, makeAction());
  }, { time: 2000, iterations: 5000 });

  bench('recordSignal — success signal', async () => {
    await facade.recordSignal({
      agentId: admittedCreds.agentId,
      type: 'success',
      weight: 0.1,
      source: 'benchmark',
    });
  }, { time: 2000, iterations: 10_000 });
});

/**
 * Performance Expectations Summary
 *
 * | Operation                            | Target    | Notes                               |
 * |--------------------------------------|-----------|-------------------------------------|
 * | submit — cache hit                   | < 2ms     | Cached admission + authorization    |
 * | submit — cache miss                  | < 5ms     | Full admission + authorization      |
 * | submit — with handler + signals      | < 5ms     | Adds execution + signal recording   |
 * | check — authorization only           | < 1ms     | No proof commit, no execution       |
 * | 10 concurrent submits                | < 20ms    | Parallelized                        |
 * | 100 concurrent submits               | < 200ms   | Parallelized                        |
 * | commit (synchronous)                 | < 0.1ms   | SHA-256 hash + buffer push          |
 * | flush — 100 events                   | < 20ms    | Merkle root + store write           |
 * | flush — 1000 events                  | < 200ms   | Merkle root + store write           |
 * | admit — cached                       | < 0.05ms  | Map lookup                          |
 * | authorize — admitted                 | < 0.1ms   | Score lookup + evaluation           |
 * | fullCheck                            | < 0.5ms   | admit + authorize combined          |
 */
