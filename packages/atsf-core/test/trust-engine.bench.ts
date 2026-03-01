/**
 * Trust Engine Performance Benchmarks
 *
 * Run with: npx vitest bench trust-engine.bench.ts
 *
 * Performance targets (per BASIS spec):
 * - Score calculation: < 1ms
 * - Signal recording: < 5ms
 * - Decay calculation: < 2ms
 * - Batch operations (100 entities): < 100ms
 * - Batch operations (1000 entities): < 1000ms
 *
 * @packageDocumentation
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import { TrustEngine, createTrustEngine } from '../src/trust-engine/index.js';
import { calculateDecayMultiplier, applyDecay } from '../src/trust-engine/decay-profiles.js';
import type { TrustSignal } from '../src/common/types.js';

// ---------------------------------------------------------------------------
// Helper: build a signal for a given entity
// ---------------------------------------------------------------------------
function makeSignal(entityId: string, i: number): TrustSignal {
  return {
    id: `signal-${entityId}-${i}`,
    entityId,
    type: i % 2 === 0 ? 'behavioral.task_completed' : 'compliance.policy_followed',
    value: 0.7 + Math.random() * 0.2,
    timestamp: new Date().toISOString(),
  };
}

// ===========================================================================
// 1. Core Score Computation
// ===========================================================================

describe('TrustEngine — Core Score Computation', () => {
  let engine: TrustEngine;

  beforeAll(async () => {
    engine = createTrustEngine();
    // Pre-populate an entity with 50 signals so calculate() has work to do
    await engine.initializeEntity('calc-entity', 2);
    for (let i = 0; i < 50; i++) {
      await engine.recordSignal(makeSignal('calc-entity', i));
    }
  });

  afterAll(async () => {
    await engine.close();
  });

  bench('calculate() — 50-signal entity', async () => {
    await engine.calculate('calc-entity');
  }, { time: 2000, iterations: 5000 });

  bench('calculate() — cold entity (0 signals)', async () => {
    const id = `cold-${Math.random()}`;
    await engine.initializeEntity(id, 1);
    await engine.calculate(id);
  }, { time: 2000, iterations: 2000 });
});

// ===========================================================================
// 2. Decay Calculation (pure function, no async overhead)
// ===========================================================================

describe('TrustEngine — Decay Calculation', () => {
  bench('calculateDecayMultiplier — 0 days', () => {
    calculateDecayMultiplier(0);
  }, { time: 1000, iterations: 100_000 });

  bench('calculateDecayMultiplier — 30 days (interpolation)', () => {
    calculateDecayMultiplier(30);
  }, { time: 1000, iterations: 100_000 });

  bench('calculateDecayMultiplier — 200 days (past last milestone)', () => {
    calculateDecayMultiplier(200);
  }, { time: 1000, iterations: 100_000 });

  bench('applyDecay — full pipeline', () => {
    applyDecay(750, 45);
  }, { time: 1000, iterations: 100_000 });
});

// ===========================================================================
// 3. Decay via getScore() (stale entity triggers milestone-based decay)
// ===========================================================================

describe('TrustEngine — getScore with Decay', () => {
  let engine: TrustEngine;

  beforeAll(async () => {
    engine = createTrustEngine({ decayCheckIntervalMs: 0 }); // always trigger decay
  });

  afterAll(async () => {
    await engine.close();
  });

  bench('getScore() — triggers decay on stale entity', async () => {
    // Each iteration creates a fresh entity whose lastCalculatedAt is "now",
    // but since decayCheckIntervalMs=0 every getScore call triggers the decay path
    const id = `decay-${Math.random()}`;
    await engine.initializeEntity(id, 3);
    await engine.getScore(id);
  }, { time: 2000, iterations: 2000 });
});

// ===========================================================================
// 4. Tier Transition Evaluation
// ===========================================================================

describe('TrustEngine — Tier Transition', () => {
  let engine: TrustEngine;

  beforeAll(async () => {
    engine = createTrustEngine();
  });

  afterAll(async () => {
    await engine.close();
  });

  bench('recordSignal — high-value signal (triggers tier change)', async () => {
    const id = `tier-${Math.random()}`;
    await engine.initializeEntity(id, 1); // T1: 200

    // High-value signals to push towards tier boundary
    const signal: TrustSignal = {
      id: `signal-${Math.random()}`,
      entityId: id,
      type: 'behavioral.task_completed',
      value: 0.95,
      timestamp: new Date().toISOString(),
    };
    await engine.recordSignal(signal);
  }, { time: 2000, iterations: 500 });

  bench('recordSignal — low-value signal (no tier change)', async () => {
    const id = `notier-${Math.random()}`;
    await engine.initializeEntity(id, 3); // T3: 500

    const signal: TrustSignal = {
      id: `signal-${Math.random()}`,
      entityId: id,
      type: 'behavioral.action',
      value: 0.5, // below success threshold
      timestamp: new Date().toISOString(),
    };
    await engine.recordSignal(signal);
  }, { time: 2000, iterations: 500 });
});

// ===========================================================================
// 5. Batch Trust Updates — 100 Agents
// ===========================================================================

describe('TrustEngine — Batch 100 Agents', () => {
  bench('initialize + record signal for 100 agents', async () => {
    const batchEngine = createTrustEngine();

    for (let i = 0; i < 100; i++) {
      const entityId = `batch100-${i}`;
      await batchEngine.initializeEntity(entityId, 1);
      await batchEngine.recordSignal({
        id: `signal-${i}`,
        entityId,
        type: 'behavioral.task_completed',
        value: 0.8,
        timestamp: new Date().toISOString(),
      });
    }

    await batchEngine.close();
  }, { time: 10000, iterations: 5 });
});

// ===========================================================================
// 6. Batch Trust Updates — 1000 Agents
// ===========================================================================

describe('TrustEngine — Batch 1000 Agents', () => {
  bench('initialize + record signal for 1000 agents', async () => {
    const batchEngine = createTrustEngine();

    for (let i = 0; i < 1000; i++) {
      const entityId = `batch1k-${i}`;
      await batchEngine.initializeEntity(entityId, 1);
      await batchEngine.recordSignal({
        id: `signal-${i}`,
        entityId,
        type: 'behavioral.task_completed',
        value: 0.8,
        timestamp: new Date().toISOString(),
      });
    }

    await batchEngine.close();
  }, { time: 30000, iterations: 3 });
});

// ===========================================================================
// 7. Signal Recording Throughput
// ===========================================================================

describe('TrustEngine — Signal Recording Throughput', () => {
  let engine: TrustEngine;

  beforeAll(async () => {
    engine = createTrustEngine();
    await engine.initializeEntity('throughput-entity', 2);
  });

  afterAll(async () => {
    await engine.close();
  });

  bench('recordSignal — single behavioral signal', async () => {
    await engine.recordSignal({
      id: `signal-${Math.random()}`,
      entityId: 'throughput-entity',
      type: 'behavioral.task_completed',
      value: 0.85,
      timestamp: new Date().toISOString(),
    });
  }, { time: 2000, iterations: 1000 });

  bench('recordSignal — mixed signal types', async () => {
    const types = [
      'behavioral.task_completed',
      'compliance.policy_followed',
      'identity.verified',
      'context.environment_check',
    ];
    await engine.recordSignal({
      id: `signal-${Math.random()}`,
      entityId: 'throughput-entity',
      type: types[Math.floor(Math.random() * types.length)]!,
      value: 0.5 + Math.random() * 0.4,
      timestamp: new Date().toISOString(),
    });
  }, { time: 2000, iterations: 1000 });
});

// ===========================================================================
// 8. Event Emission Overhead
// ===========================================================================

describe('TrustEngine — Event Emission Overhead', () => {
  bench('recordSignal with 10 listeners attached', async () => {
    const eventEngine = createTrustEngine();

    for (let i = 0; i < 10; i++) {
      eventEngine.on('trust:signal_recorded', () => {});
      eventEngine.on('trust:score_changed', () => {});
    }

    const entityId = 'event-test';
    await eventEngine.initializeEntity(entityId, 2);

    await eventEngine.recordSignal({
      id: `signal-${Math.random()}`,
      entityId,
      type: 'behavioral.action',
      value: 0.8,
      timestamp: new Date().toISOString(),
    });

    await eventEngine.close();
  }, { time: 2000, iterations: 100 });
});

// ===========================================================================
// 9. Recovery Mechanics
// ===========================================================================

describe('TrustEngine — Recovery Mechanics', () => {
  bench('accelerated recovery path (5 consecutive successes)', async () => {
    const recoveryEngine = createTrustEngine({ minSuccessesForAcceleration: 3 });
    const entityId = 'recovery-bench';
    await recoveryEngine.initializeEntity(entityId, 1);

    for (let i = 0; i < 5; i++) {
      await recoveryEngine.recordSignal({
        id: `success-${i}`,
        entityId,
        type: 'behavioral.task_completed',
        value: 0.85,
        timestamp: new Date().toISOString(),
      });
    }

    await recoveryEngine.close();
  }, { time: 5000, iterations: 20 });
});

/**
 * Performance Expectations Summary
 *
 * | Operation                          | Target    | Notes                             |
 * |------------------------------------|-----------|-----------------------------------|
 * | calculate() — 50 signals           | < 1ms     | Pure computation                  |
 * | calculateDecayMultiplier()         | < 0.01ms  | Pure function, interpolation      |
 * | getScore() with decay              | < 2ms     | Staleness check + decay calc      |
 * | recordSignal (single)              | < 5ms     | Includes calculation + events     |
 * | Batch init+signal (100 agents)     | < 500ms   | Linear scaling expected           |
 * | Batch init+signal (1000 agents)    | < 5000ms  | Linear scaling expected           |
 * | Recovery path (5 signals)          | < 25ms    | 5x recordSignal                   |
 * | Event emission (10 listeners)      | < 5ms     | Negligible overhead               |
 *
 * Memory expectations:
 * - Each entity: ~2KB base + 100 bytes per signal
 * - Signal pruning at 1000 signals per entity
 * - History pruning at 100 entries per entity
 */
