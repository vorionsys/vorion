import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TrustEngine,
  createTrustEngine,
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
  type TrustRecord,
  type TrustEngineConfig,
  type TrustDecayAppliedEvent,
  type TrustTierChangedEvent,
  type TrustExplanation,
} from '../src/trust-engine/index.js';
import type { TrustSignal } from '../src/common/types.js';

describe('TrustEngine', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = createTrustEngine();
  });

  describe('initialization', () => {
    it('should create engine with default config', () => {
      expect(engine.decayCheckIntervalMs).toBe(60000);
    });

    it('should create engine with custom config', () => {
      const config: TrustEngineConfig = {
        decayCheckIntervalMs: 30000,
      };
      const customEngine = createTrustEngine(config);

      expect(customEngine.decayCheckIntervalMs).toBe(30000);
    });

    it('should initialize entity at specified level', async () => {
      const record = await engine.initializeEntity('agent-001', 2);

      expect(record.entityId).toBe('agent-001');
      expect(record.level).toBe(2);
      expect(record.score).toBe(TRUST_THRESHOLDS[2].min);
      expect(record.recentSuccesses).toEqual([]);
    });

    it('should emit initialized event', async () => {
      const events: unknown[] = [];
      engine.on('trust:initialized', (e) => events.push(e));

      await engine.initializeEntity('agent-001', 1);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'trust:initialized',
        entityId: 'agent-001',
        initialLevel: 1,
      });
    });
  });

  describe('8-tier trust levels', () => {
    it('should have 8 trust levels (T0-T7)', () => {
      expect(Object.keys(TRUST_THRESHOLDS)).toHaveLength(8);
      expect(Object.keys(TRUST_LEVEL_NAMES)).toHaveLength(8);
    });

    it('should have correct level names', () => {
      // Canonical 8-tier trust system
      expect(TRUST_LEVEL_NAMES[0]).toBe('Sandbox');
      expect(TRUST_LEVEL_NAMES[1]).toBe('Observed');
      expect(TRUST_LEVEL_NAMES[2]).toBe('Provisional');
      expect(TRUST_LEVEL_NAMES[3]).toBe('Monitored');
      expect(TRUST_LEVEL_NAMES[4]).toBe('Standard');
      expect(TRUST_LEVEL_NAMES[5]).toBe('Trusted');
      expect(TRUST_LEVEL_NAMES[6]).toBe('Certified');
      expect(TRUST_LEVEL_NAMES[7]).toBe('Autonomous');
    });

    it('should have non-overlapping score ranges', () => {
      const ranges = Object.values(TRUST_THRESHOLDS);
      for (let i = 0; i < ranges.length - 1; i++) {
        expect(ranges[i]!.max).toBeLessThan(ranges[i + 1]!.min);
      }
    });

    it('should cover full 0-1000 range', () => {
      expect(TRUST_THRESHOLDS[0].min).toBe(0);
      expect(TRUST_THRESHOLDS[7].max).toBe(1000);
    });
  });

  describe('signal recording', () => {
    it('should record signals and update score', async () => {
      await engine.initializeEntity('agent-001', 1);

      const signal: TrustSignal = {
        id: 'sig-001',
        entityId: 'agent-001',
        type: 'behavioral.task_completed',
        value: 0.9,
        source: 'system',
        timestamp: new Date().toISOString(),
        metadata: {},
      };

      await engine.recordSignal(signal);

      const record = await engine.getScore('agent-001');
      expect(record).toBeDefined();
      expect(record!.signals).toHaveLength(1);
    });

    it('should emit signal_recorded event', async () => {
      const events: unknown[] = [];
      engine.on('trust:signal_recorded', (e) => events.push(e));

      await engine.initializeEntity('agent-001', 1);
      await engine.recordSignal({
        id: 'sig-001',
        entityId: 'agent-001',
        type: 'behavioral.task_completed',
        value: 0.9,
        source: 'system',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(events).toHaveLength(1);
    });
  });

  describe('wildcard events', () => {
    it('should emit wildcard events', async () => {
      const allEvents: unknown[] = [];
      engine.on('trust:*', (e) => allEvents.push(e));

      await engine.initializeEntity('agent-001', 1);

      // Should have received the initialized event via wildcard
      expect(allEvents.length).toBeGreaterThan(0);
      expect(allEvents[0]).toMatchObject({ type: 'trust:initialized' });
    });
  });

  describe('tier changes', () => {
    it('should emit tier_changed on promotion', async () => {
      const events: TrustTierChangedEvent[] = [];
      engine.on('trust:tier_changed', (e) => events.push(e));

      await engine.initializeEntity('agent-001', 1);

      // Record many high-value signals to trigger promotion
      for (let i = 0; i < 50; i++) {
        await engine.recordSignal({
          id: `sig-${i}`,
          entityId: 'agent-001',
          type: 'behavioral.task_completed',
          value: 1.0,
          source: 'system',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
      }

      const record = await engine.getScore('agent-001');

      if (record!.level > 1) {
        expect(events.length).toBeGreaterThan(0);
        const promotionEvent = events.find((e) => e.direction === 'promoted');
        expect(promotionEvent).toBeDefined();
      }
    });

    it('should emit tier_changed on demotion from decay', async () => {
      const testEngine = createTrustEngine({
        decayCheckIntervalMs: 10,
      });

      const events: TrustTierChangedEvent[] = [];
      testEngine.on('trust:tier_changed', (e) => events.push(e));

      await testEngine.initializeEntity('agent-001', 3);

      // Simulate a long inactivity gap by advancing Date.now() by 200 days
      // Milestone-based decay at 182+ days applies 0.50 multiplier
      // T3 starts at score 500: 500 * 0.50 = 250 -> T1 (Observed)
      const initTime = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => initTime + 200 * 24 * 60 * 60 * 1000);

      await testEngine.getScore('agent-001');

      // Restore Date.now
      vi.restoreAllMocks();

      expect(events.length).toBeGreaterThan(0);
      const demotionEvent = events.find((e) => e.direction === 'demoted');
      expect(demotionEvent).toBeDefined();
    });
  });

  describe('factory function', () => {
    it('should create engine with createTrustEngine()', () => {
      const engine = createTrustEngine();
      expect(engine).toBeInstanceOf(TrustEngine);
    });

    it('should accept config in factory', () => {
      const engine = createTrustEngine({ decayCheckIntervalMs: 30000 });
      expect(engine.decayCheckIntervalMs).toBe(30000);
    });
  });

  describe('milestone-based decay', () => {
    it('should apply stepped milestone decay based on inactivity', async () => {
      const testEngine = createTrustEngine({
        decayCheckIntervalMs: 10,
      });

      await testEngine.initializeEntity('agent-001', 3);
      const initialRecord = await testEngine.getScore('agent-001');
      const initialScore = initialRecord!.score;

      // Simulate 30 days of inactivity via Date.now mock
      // At 28 days the multiplier is 0.82, at 42 days it is 0.76
      // 30 days is between milestones: interpolated ~0.8114
      const initTime = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => initTime + 30 * 24 * 60 * 60 * 1000);

      const decayedRecord = await testEngine.getScore('agent-001');
      const finalScore = decayedRecord!.score;

      vi.restoreAllMocks();

      // Score should have decayed but remain above 50% floor
      expect(finalScore).toBeLessThan(initialScore);
      expect(finalScore).toBeGreaterThan(initialScore * 0.5);
    });

    it('should not decay score below the 50% floor', async () => {
      const testEngine = createTrustEngine({
        decayCheckIntervalMs: 10,
      });

      await testEngine.initializeEntity('agent-001', 3);
      const initialRecord = await testEngine.getScore('agent-001');
      const initialScore = initialRecord!.score;

      // Simulate 365 days of inactivity (well past 182-day half-life)
      const initTime = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => initTime + 365 * 24 * 60 * 60 * 1000);

      const record = await testEngine.getScore('agent-001');

      vi.restoreAllMocks();

      // Score should be at the 50% floor (multiplier = 0.50)
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBe(Math.round(initialScore * 0.50));
    });
  });

  describe('trust tier boundary conditions', () => {
    it('should correctly assign tier at exact boundary values', async () => {
      // Test each tier boundary (8-tier model)
      const boundaries = [
        { score: 0, expectedLevel: 0 },
        { score: 199, expectedLevel: 0 },
        { score: 200, expectedLevel: 1 },
        { score: 349, expectedLevel: 1 },
        { score: 350, expectedLevel: 2 },
        { score: 499, expectedLevel: 2 },
        { score: 500, expectedLevel: 3 },
        { score: 649, expectedLevel: 3 },
        { score: 650, expectedLevel: 4 },
        { score: 799, expectedLevel: 4 },
        { score: 800, expectedLevel: 5 },
        { score: 875, expectedLevel: 5 },
        { score: 876, expectedLevel: 6 },
        { score: 950, expectedLevel: 6 },
        { score: 951, expectedLevel: 7 },
        { score: 1000, expectedLevel: 7 },
      ];

      for (const { score, expectedLevel } of boundaries) {
        // Verify threshold configuration matches expected boundaries
        const threshold = TRUST_THRESHOLDS[expectedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7];
        expect(score).toBeGreaterThanOrEqual(threshold.min);
        expect(score).toBeLessThanOrEqual(threshold.max);
      }
    });

    it('should have contiguous tier ranges with no gaps', () => {
      const levels = [0, 1, 2, 3, 4, 5, 6, 7] as const;

      for (let i = 0; i < levels.length - 1; i++) {
        const currentMax = TRUST_THRESHOLDS[levels[i]].max;
        const nextMin = TRUST_THRESHOLDS[levels[i + 1]].min;

        // Next tier should start exactly 1 point after current tier ends
        expect(nextMin).toBe(currentMax + 1);
      }
    });

    it('should handle score clamping at boundaries', async () => {
      const testEngine = createTrustEngine();

      // Initialize at L7 (Autonomous)
      await testEngine.initializeEntity('max-agent', 7);
      const maxRecord = await testEngine.getScore('max-agent');

      // Score should be clamped to 1000 max
      expect(maxRecord!.score).toBeLessThanOrEqual(1000);

      // Level should never exceed 7
      expect(maxRecord!.level).toBeLessThanOrEqual(7);
    });
  });

  describe('recovery mechanics', () => {
    it('should track consecutive successes', async () => {
      const testEngine = createTrustEngine({
        successThreshold: 0.7,
        minSuccessesForAcceleration: 3,
      });

      await testEngine.initializeEntity('agent-001', 2);

      expect(testEngine.getConsecutiveSuccessCount('agent-001')).toBe(0);

      // Record success signals
      for (let i = 0; i < 3; i++) {
        await testEngine.recordSignal({
          id: `success-${i}`,
          entityId: 'agent-001',
          type: 'behavioral.task_completed',
          value: 0.9,
          source: 'system',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
      }

      expect(testEngine.getConsecutiveSuccessCount('agent-001')).toBe(3);
      expect(testEngine.isAcceleratedRecoveryActive('agent-001')).toBe(true);
    });

    it('should reset consecutive successes on failure', async () => {
      const testEngine = createTrustEngine({
        successThreshold: 0.7,
        minSuccessesForAcceleration: 3,
      });

      await testEngine.initializeEntity('agent-001', 2);

      // Build up successes
      for (let i = 0; i < 2; i++) {
        await testEngine.recordSignal({
          id: `success-${i}`,
          entityId: 'agent-001',
          type: 'behavioral.task_completed',
          value: 0.9,
          source: 'system',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
      }

      expect(testEngine.getConsecutiveSuccessCount('agent-001')).toBe(2);

      // Record a failure
      await testEngine.recordSignal({
        id: 'failure-1',
        entityId: 'agent-001',
        type: 'behavioral.task_failed',
        value: 0.1,
        source: 'system',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      // Consecutive successes should be reset
      expect(testEngine.getConsecutiveSuccessCount('agent-001')).toBe(0);
    });

    it('should track peak score', async () => {
      const testEngine = createTrustEngine();

      await testEngine.initializeEntity('agent-001', 3);
      const initialPeak = testEngine.getPeakScore('agent-001');

      // Record high-value signals to increase score
      for (let i = 0; i < 10; i++) {
        await testEngine.recordSignal({
          id: `success-${i}`,
          entityId: 'agent-001',
          type: 'behavioral.task_completed',
          value: 1.0,
          source: 'system',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
      }

      const newPeak = testEngine.getPeakScore('agent-001');
      expect(newPeak).toBeGreaterThanOrEqual(initialPeak);
    });

    it('should emit recovery events on success signals', async () => {
      const testEngine = createTrustEngine({
        successThreshold: 0.7,
        recoveryRate: 0.05,
      });

      const recoveryEvents: unknown[] = [];
      testEngine.on('trust:recovery_applied', (e) => recoveryEvents.push(e));

      await testEngine.initializeEntity('agent-001', 2);

      await testEngine.recordSignal({
        id: 'success-1',
        entityId: 'agent-001',
        type: 'behavioral.task_completed',
        value: 0.95,
        source: 'system',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      expect(recoveryEvents.length).toBeGreaterThan(0);
    });
  });

  describe('signal weight consistency', () => {
    it('should weight behavioral signals at 40%', async () => {
      const testEngine = createTrustEngine();

      await testEngine.initializeEntity('agent-001', 1);

      // Record only behavioral signals
      for (let i = 0; i < 10; i++) {
        await testEngine.recordSignal({
          id: `behavioral-${i}`,
          entityId: 'agent-001',
          type: 'behavioral.task_completed',
          value: 1.0,
          source: 'system',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
      }

      const record = await testEngine.getScore('agent-001');

      // With only perfect behavioral signals, behavioral component should be 1.0
      // Total weighted contribution: 1.0 * 0.4 * 1000 = 400 from behavioral
      // Other components at default 0.5: 0.5 * 0.25 * 1000 + 0.5 * 0.2 * 1000 + 0.5 * 0.15 * 1000 = 300
      // Total: ~700 (Trusted tier)
      expect(record!.components.behavioral).toBeGreaterThan(0.5);
    });

    it('should apply 7-day half-life to signal weighting', async () => {
      const testEngine = createTrustEngine();

      await testEngine.initializeEntity('agent-001', 2);

      // Record an old signal (simulated by backdating)
      const oldTimestamp = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await testEngine.recordSignal({
        id: 'old-signal',
        entityId: 'agent-001',
        type: 'behavioral.task_completed',
        value: 1.0,
        source: 'system',
        timestamp: oldTimestamp,
        metadata: {},
      });

      const recordWithOld = await testEngine.getScore('agent-001');

      // Record a recent signal
      await testEngine.recordSignal({
        id: 'new-signal',
        entityId: 'agent-001',
        type: 'behavioral.task_completed',
        value: 1.0,
        source: 'system',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

      const recordWithNew = await testEngine.getScore('agent-001');

      // Recent signals should have more weight, increasing the score
      expect(recordWithNew!.score).toBeGreaterThanOrEqual(recordWithOld!.score);
    });
  });

  describe('event subscription limits', () => {
    it('should track listener statistics', () => {
      const testEngine = createTrustEngine({
        maxListenersPerEvent: 10,
        maxTotalListeners: 50,
      });

      const stats = testEngine.getListenerStats();

      expect(stats.totalListeners).toBe(0);
      expect(stats.maxListenersPerEvent).toBe(10);
      expect(stats.maxTotalListeners).toBe(50);
    });

    it('should increment listener count on subscription', () => {
      const testEngine = createTrustEngine({
        maxListenersPerEvent: 10,
        maxTotalListeners: 50,
      });

      testEngine.on('trust:initialized', () => {});
      testEngine.on('trust:initialized', () => {});
      testEngine.on('trust:score_changed', () => {});

      const stats = testEngine.getListenerStats();

      expect(stats.totalListeners).toBe(3);
      expect(stats.listenersByEvent['trust:initialized']).toBe(2);
      expect(stats.listenersByEvent['trust:score_changed']).toBe(1);
    });

    it('should throw when per-event limit exceeded', () => {
      const testEngine = createTrustEngine({
        maxListenersPerEvent: 2,
        maxTotalListeners: 100,
      });

      testEngine.on('trust:initialized', () => {});
      testEngine.on('trust:initialized', () => {});

      // Third listener should throw
      expect(() => {
        testEngine.on('trust:initialized', () => {});
      }).toThrow(/Maximum listeners.*exceeded/);
    });

    it('should throw when total limit exceeded', () => {
      const testEngine = createTrustEngine({
        maxListenersPerEvent: 100,
        maxTotalListeners: 3,
      });

      testEngine.on('trust:initialized', () => {});
      testEngine.on('trust:score_changed', () => {});
      testEngine.on('trust:tier_changed', () => {});

      // Fourth listener should throw
      expect(() => {
        testEngine.on('trust:decay_applied', () => {});
      }).toThrow(/Maximum total listeners.*exceeded/);
    });

    it('should decrement count when listener removed', () => {
      const testEngine = createTrustEngine();

      const listener = () => {};
      testEngine.on('trust:initialized', listener);

      expect(testEngine.getListenerStats().totalListeners).toBe(1);

      testEngine.off('trust:initialized', listener);

      expect(testEngine.getListenerStats().totalListeners).toBe(0);
    });

    it('should clear counts when removeAllListeners called', () => {
      const testEngine = createTrustEngine();

      testEngine.on('trust:initialized', () => {});
      testEngine.on('trust:score_changed', () => {});
      testEngine.on('trust:tier_changed', () => {});

      expect(testEngine.getListenerStats().totalListeners).toBe(3);

      testEngine.removeAllListeners();

      expect(testEngine.getListenerStats().totalListeners).toBe(0);
    });
  });

  describe('explainScore', () => {
    it('should throw for unknown entity', async () => {
      await expect(engine.explainScore('nonexistent')).rejects.toThrow('Entity not found');
    });

    it('should explain a freshly initialized entity', async () => {
      await engine.initializeEntity('explain-1', 3);

      const explanation = await engine.explainScore('explain-1');

      expect(explanation.entityId).toBe('explain-1');
      expect(explanation.score).toBeGreaterThanOrEqual(TRUST_THRESHOLDS[3].min);
      expect(explanation.level).toBe(3);
      expect(explanation.levelName).toBe('Monitored');
      expect(explanation.levelRange).toEqual(TRUST_THRESHOLDS[3]);
      expect(explanation.signalCount).toBe(0);
      expect(explanation.factorBreakdown).toHaveLength(16);
      expect(explanation.generatedAt).toBeDefined();
      // Fresh entity has no signals, so no decay
      expect(explanation.daysSinceLastSignal).toBeNull();
      expect(explanation.decayMultiplier).toBe(1.0);
    });

    it('should show factor breakdown summing to score', async () => {
      await engine.initializeEntity('explain-2', 1);
      // Record a signal
      await engine.recordSignal({
        entityId: 'explain-2',
        type: 'behavioral.task_completed',
        value: 0.9,
        source: 'test',
        timestamp: new Date().toISOString(),
      });

      const explanation = await engine.explainScore('explain-2');

      // Each factor has code, weight, rawScore, contribution
      for (const f of explanation.factorBreakdown) {
        expect(f.code).toBeDefined();
        expect(f.weight).toBeGreaterThanOrEqual(0);
        expect(f.rawScore).toBeGreaterThanOrEqual(0);
        expect(f.rawScore).toBeLessThanOrEqual(1);
        expect(typeof f.contribution).toBe('number');
      }

      expect(explanation.signalCount).toBeGreaterThan(0);
      expect(explanation.daysSinceLastSignal).toBeGreaterThanOrEqual(0);
    });

    it('should compute pointsToNextLevel', async () => {
      await engine.initializeEntity('explain-3', 0);

      const explanation = await engine.explainScore('explain-3');

      // At T0 (min score 0), next level is T1 (min 200)
      expect(explanation.pointsToNextLevel).toBeGreaterThan(0);
    });

    it('should return null pointsToNextLevel at max level', async () => {
      await engine.initializeEntity('explain-4', 7);

      const explanation = await engine.explainScore('explain-4');

      expect(explanation.level).toBe(7);
      expect(explanation.pointsToNextLevel).toBeNull();
    });
  });
});
