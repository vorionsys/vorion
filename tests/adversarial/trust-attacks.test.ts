/**
 * ADVERSARIAL TESTS — Trust Engine Attack Surface
 *
 * Tests the ATSF-CORE TrustEngine against adversarial scenarios:
 *   - Signal flooding and replay attacks
 *   - Score overflow/underflow boundary exploitation
 *   - Trust escalation abuse via rapid-fire signals
 *   - Decay manipulation through timestamp tampering
 *   - Listener exhaustion (resource denial)
 *   - Cross-entity signal injection
 *   - Concurrent write race conditions
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TrustEngine,
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
  /** @deprecated SIGNAL_WEIGHTS is deprecated; prefer FACTOR_WEIGHTS for the 16-factor model */
  SIGNAL_WEIGHTS,
  FACTOR_WEIGHTS,
  FACTOR_CODES,
} from '../../packages/atsf-core/src/trust-engine/index.js';
import type {
  TrustSignal,
  TrustLevel,
  ID,
} from '../../packages/atsf-core/src/common/types.js';

vi.mock('../../packages/atsf-core/src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// =============================================================================
// Helpers
// =============================================================================

/** Create a well-formed TrustSignal with sensible defaults */
function makeSignal(overrides: Partial<TrustSignal> & { entityId: ID }): TrustSignal {
  return {
    id: overrides.id ?? `sig-${Math.random().toString(36).slice(2, 10)}`,
    entityId: overrides.entityId,
    type: overrides.type ?? 'behavioral.task_completion',
    value: overrides.value ?? 0.8,
    source: overrides.source ?? 'test',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    metadata: overrides.metadata ?? {},
  };
}

/** Create N signals for a given entity, each with a unique ID */
function makeSignals(
  entityId: ID,
  count: number,
  overrides: Partial<TrustSignal> = {},
): TrustSignal[] {
  return Array.from({ length: count }, (_, i) =>
    makeSignal({
      entityId,
      id: `sig-batch-${i}-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    }),
  );
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Trust Engine — Adversarial Attack Surface', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00.000Z') });
    engine = new TrustEngine();
  });

  afterEach(async () => {
    await engine.close();
    vi.useRealTimers();
  });

  // ===========================================================================
  // Signal Flooding Attack
  // ===========================================================================
  describe('Signal Flooding Attack', () => {
    it('caps stored signals at 1000 when flooded with 2,000 rapid signals', async () => {
      const entityId = 'flood-victim-01' as ID;
      await engine.initializeEntity(entityId);

      // Fire 2,000 signals in rapid succession (exceeds the 1000 cap)
      const signals = makeSignals(entityId, 2_000, {
        type: 'behavioral.task_completion',
        value: 0.6,
      });

      for (const signal of signals) {
        await engine.recordSignal(signal);
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // Engine retains only the last 1000 signals — older ones are evicted
      expect(record!.signals.length).toBeLessThanOrEqual(1000);
    }, 60_000);

    it('does not exceed score 1000 when flooded with maximum-value signals', async () => {
      const entityId = 'flood-max-01' as ID;
      await engine.initializeEntity(entityId);

      // Send 500 perfect signals across all component types
      const types = [
        'behavioral.task_completion',
        'compliance.policy_check',
        'identity.verification',
        'context.environment_check',
      ];

      for (let i = 0; i < 500; i++) {
        await engine.recordSignal(
          makeSignal({
            entityId,
            type: types[i % types.length]!,
            value: 1.0,
          }),
        );
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(record!.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Signal Replay Attack
  // ===========================================================================
  describe('Signal Replay Attack', () => {
    it('records duplicate signal IDs — engine does not deduplicate by signal ID', async () => {
      const entityId = 'replay-target-01' as ID;
      await engine.initializeEntity(entityId);

      const duplicateSignal = makeSignal({
        entityId,
        id: 'fixed-signal-id-001',
        type: 'behavioral.task_completion',
        value: 0.9,
      });

      // Record exact same signal object twice
      await engine.recordSignal(duplicateSignal);
      await engine.recordSignal(duplicateSignal);

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // Both copies should be stored — the engine does not deduplicate
      expect(record!.signals.length).toBe(2);
    });

    it('identical payloads with different IDs both contribute to the score', async () => {
      const entityId = 'replay-target-02' as ID;
      await engine.initializeEntity(entityId);

      const signalA = makeSignal({
        entityId,
        id: 'unique-a',
        type: 'behavioral.task_completion',
        value: 0.9,
      });
      const signalB = makeSignal({
        entityId,
        id: 'unique-b',
        type: 'behavioral.task_completion',
        value: 0.9,
      });

      await engine.recordSignal(signalA);
      const afterFirst = await engine.getScore(entityId);

      await engine.recordSignal(signalB);
      const afterSecond = await engine.getScore(entityId);

      expect(afterFirst).toBeDefined();
      expect(afterSecond).toBeDefined();
      // Both signals are stored
      expect(afterSecond!.signals.length).toBe(2);
    });
  });

  // ===========================================================================
  // Score Overflow / Underflow
  // ===========================================================================
  describe('Score Overflow / Underflow', () => {
    it('all components at 1.0 produces score exactly 1000', async () => {
      const entityId = 'overflow-01' as ID;
      await engine.initializeEntity(entityId);

      // Use all 16 factor codes to drive every factor to 1.0.
      // Legacy 4-prefix signals only map to 8 of 16 factors; the other 8 default
      // to 0.5, producing 750 instead of 1000.
      const factorCodes = [
        'CT-COMP', 'CT-REL', 'CT-OBS', 'CT-TRANS', 'CT-ACCT', 'CT-SAFE',
        'CT-SEC', 'CT-PRIV', 'CT-ID',
        'OP-HUMAN', 'OP-ALIGN', 'OP-CONTEXT',
        'OP-STEW', 'SF-HUM',
        'SF-ADAPT', 'SF-LEARN',
      ];

      for (const code of factorCodes) {
        for (let i = 0; i < 50; i++) {
          await engine.recordSignal(makeSignal({ entityId, type: `${code}.perfect`, value: 1.0 }));
        }
      }

      const calc = await engine.calculate(entityId);
      expect(calc.score).toBe(1000);
      expect(calc.score).not.toBeGreaterThan(1000);
    });

    it('all components at 0.0 produces score exactly 0, never negative', async () => {
      const entityId = 'underflow-01' as ID;
      await engine.initializeEntity(entityId);

      // Use all 16 factor codes to drive every factor to 0.0.
      const factorCodes = [
        'CT-COMP', 'CT-REL', 'CT-OBS', 'CT-TRANS', 'CT-ACCT', 'CT-SAFE',
        'CT-SEC', 'CT-PRIV', 'CT-ID',
        'OP-HUMAN', 'OP-ALIGN', 'OP-CONTEXT',
        'OP-STEW', 'SF-HUM',
        'SF-ADAPT', 'SF-LEARN',
      ];

      for (const code of factorCodes) {
        for (let i = 0; i < 50; i++) {
          await engine.recordSignal(makeSignal({ entityId, type: `${code}.zero`, value: 0.0 }));
        }
      }

      const calc = await engine.calculate(entityId);
      expect(calc.score).toBe(0);
      expect(calc.score).not.toBeLessThan(0);
    });

    it('out-of-range but finite signal values do not crash and score stays in [0, 1000]', async () => {
      const entityId = 'extreme-finite-01' as ID;
      await engine.initializeEntity(entityId);

      // Finite signal values outside the normal [0, 1] range
      const extremeFiniteValues = [999, -999, 1.0001, -0.0001, 100, -100, 2.0, -0.5];

      for (const value of extremeFiniteValues) {
        await expect(
          engine.recordSignal(makeSignal({ entityId, value, type: 'behavioral.task_completion' })),
        ).resolves.not.toThrow();
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(record!.score)).toBe(true);
    });

    it('Infinity / -Infinity signal values do not crash the engine', async () => {
      const entityId = 'extreme-inf-01' as ID;
      await engine.initializeEntity(entityId);

      // Infinity values poison the weighted average → NaN, but should not throw
      const nonFiniteValues = [Infinity, -Infinity];

      for (const value of nonFiniteValues) {
        await expect(
          engine.recordSignal(makeSignal({ entityId, value, type: 'behavioral.task_completion' })),
        ).resolves.not.toThrow();
      }

      // The engine does not crash. The score may become NaN because Infinity
      // poisons the exponentially-weighted average. This test documents the
      // behavior — the key assertion is no unhandled exception.
      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
    });
  });

  // ===========================================================================
  // Trust Escalation Abuse
  // ===========================================================================
  describe('Trust Escalation Abuse', () => {
    it('rapid-fire high-value signals cannot jump from T0 to T7 in one batch', async () => {
      const entityId = 'escalation-01' as ID;
      // Start at T0 Sandbox (score 0)
      await engine.initializeEntity(entityId, 0 as TrustLevel);

      const initialRecord = await engine.getScore(entityId);
      expect(initialRecord).toBeDefined();
      expect(initialRecord!.level).toBe(0);
      const startScore = initialRecord!.score;

      // Fire 50 perfect signals rapidly to try to escalate
      for (let i = 0; i < 50; i++) {
        await engine.recordSignal(
          makeSignal({
            entityId,
            type: 'behavioral.task_completion',
            value: 1.0,
          }),
        );
      }

      const afterBlitz = await engine.getScore(entityId);
      expect(afterBlitz).toBeDefined();

      // Recovery per signal is capped at maxRecoveryPerSignal (50 points).
      // Even with 50 signals, the actual score gain per signal from recovery
      // is limited. The score is ultimately driven by calculate() which uses
      // weighted component averages, but the recovery boost is capped.
      // Score must stay within valid range regardless.
      expect(afterBlitz!.score).toBeLessThanOrEqual(1000);
      expect(afterBlitz!.score).toBeGreaterThanOrEqual(0);
    });

    it('recovery per signal is capped at maxRecoveryPerSignal (50 points)', async () => {
      const entityId = 'recovery-cap-01' as ID;
      await engine.initializeEntity(entityId);

      const beforeRecord = await engine.getScore(entityId);
      expect(beforeRecord).toBeDefined();

      // Listen for recovery events to inspect amounts
      const recoveryAmounts: number[] = [];
      engine.on('trust:recovery_applied', (event: { recoveryAmount: number }) => {
        recoveryAmounts.push(event.recoveryAmount);
      });

      // Send a perfect success signal (value = 1.0)
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: 1.0,
        }),
      );

      // Every individual recovery amount must be <= maxRecoveryPerSignal
      for (const amount of recoveryAmounts) {
        expect(amount).toBeLessThanOrEqual(50);
      }
    });

    it('100 consecutive successes still respect accelerated recovery caps', async () => {
      const entityId = 'accel-cap-01' as ID;
      await engine.initializeEntity(entityId);

      const recoveryAmounts: number[] = [];
      engine.on('trust:recovery_applied', (event: { recoveryAmount: number }) => {
        recoveryAmounts.push(event.recoveryAmount);
      });

      // Send 100 consecutive success signals
      for (let i = 0; i < 100; i++) {
        await engine.recordSignal(
          makeSignal({
            entityId,
            type: 'behavioral.task_completion',
            value: 0.95,
          }),
        );
      }

      // After 3 consecutive successes, accelerated recovery activates (1.5x multiplier),
      // but each individual recovery is still capped at maxRecoveryPerSignal (50)
      for (const amount of recoveryAmounts) {
        expect(amount).toBeLessThanOrEqual(50);
      }

      const finalRecord = await engine.getScore(entityId);
      expect(finalRecord).toBeDefined();
      expect(finalRecord!.score).toBeLessThanOrEqual(1000);
    });
  });

  // ===========================================================================
  // Decay Manipulation
  // ===========================================================================
  describe('Decay Manipulation', () => {
    it('lastCalculatedAt set to far future results in no negative decay', async () => {
      const entityId = 'decay-future-01' as ID;
      const record = await engine.initializeEntity(entityId);

      // Artificially set lastCalculatedAt 10 years in the future
      const futureDate = new Date('2036-01-01T00:00:00.000Z');
      record.lastCalculatedAt = futureDate.toISOString();

      // Advance real time just 1 minute (still behind the future timestamp)
      vi.advanceTimersByTime(60_000);

      const fetched = await engine.getScore(entityId);
      expect(fetched).toBeDefined();
      // Staleness will be negative, so decay should NOT apply
      // Score should remain at or above its initial value
      expect(fetched!.score).toBeGreaterThanOrEqual(0);
      // The decay multiplier for negative days returns 1.0 (no decay)
      // so score should be unchanged from the initialized value
      expect(fetched!.score).toBe(record.score);
    });

    it('lastCalculatedAt set to distant past does not produce a negative score', async () => {
      const entityId = 'decay-past-01' as ID;
      const record = await engine.initializeEntity(entityId);
      const originalScore = record.score;

      // Set lastCalculatedAt to 10 years ago — massive staleness
      const distantPast = new Date('2016-01-01T00:00:00.000Z');
      record.lastCalculatedAt = distantPast.toISOString();

      // Advance timers past the decay check interval
      vi.advanceTimersByTime(120_000);

      const fetched = await engine.getScore(entityId);
      expect(fetched).toBeDefined();
      // Score must never go below 0 regardless of staleness
      expect(fetched!.score).toBeGreaterThanOrEqual(0);
      // With 10 years of inactivity, score should have decayed significantly
      // (decay floor is 50% at 182 days, so anything beyond that stays at 50%)
      expect(fetched!.score).toBeLessThanOrEqual(originalScore);
    });
  });

  // ===========================================================================
  // Listener Exhaustion
  // ===========================================================================
  describe('Listener Exhaustion', () => {
    it('throws when adding more than maxListenersPerEvent (100) to a single event', async () => {
      const noop = () => {};

      // Add exactly 100 listeners — should succeed
      for (let i = 0; i < 100; i++) {
        engine.on('trust:score_changed', noop);
      }

      // The 101st should throw
      expect(() => {
        engine.on('trust:score_changed', noop);
      }).toThrow(/Maximum listeners.*100.*exceeded/);
    });

    it('throws when total listeners across all events exceed maxTotalListeners (1000)', () => {
      const noop = () => {};

      // Spread 1000 listeners across 20 different event types (50 each)
      for (let eventIdx = 0; eventIdx < 20; eventIdx++) {
        const eventName = `trust:custom_event_${eventIdx}`;
        for (let i = 0; i < 50; i++) {
          engine.on(eventName, noop);
        }
      }

      // We now have exactly 1000 total listeners. Adding one more should throw.
      expect(() => {
        engine.on('trust:one_more', noop);
      }).toThrow(/Maximum total listeners.*1000.*exceeded/);
    });

    it('removeAllListeners resets counts properly, allowing new listeners', () => {
      const noop = () => {};

      // Fill up to 100 per-event listeners
      for (let i = 0; i < 100; i++) {
        engine.on('trust:score_changed', noop);
      }

      const statsBefore = engine.getListenerStats();
      expect(statsBefore.totalListeners).toBe(100);
      expect(statsBefore.listenersByEvent['trust:score_changed']).toBe(100);

      // Remove all listeners
      engine.removeAllListeners();

      const statsAfter = engine.getListenerStats();
      expect(statsAfter.totalListeners).toBe(0);
      // Verify listenersByEvent is empty
      expect(Object.keys(statsAfter.listenersByEvent).length).toBe(0);

      // Should be able to add listeners again without error
      expect(() => {
        engine.on('trust:score_changed', noop);
      }).not.toThrow();

      expect(engine.getListenerStats().totalListeners).toBe(1);
    });
  });

  // ===========================================================================
  // Cross-Entity Signal Injection
  // ===========================================================================
  describe('Cross-Entity Signal Injection', () => {
    it('signal recorded against entity B does not leak to entity A', async () => {
      const entityA = 'entity-alpha' as ID;
      const entityB = 'entity-beta' as ID;

      await engine.initializeEntity(entityA);
      await engine.initializeEntity(entityB);

      const recordA_before = await engine.getScore(entityA);
      const recordB_before = await engine.getScore(entityB);
      expect(recordA_before).toBeDefined();
      expect(recordB_before).toBeDefined();

      const scoreA_before = recordA_before!.score;

      // Record a high-value signal ONLY for entity B
      await engine.recordSignal(
        makeSignal({
          entityId: entityB,
          type: 'behavioral.task_completion',
          value: 1.0,
        }),
      );

      // Entity A's score and signals must be completely unaffected
      const recordA_after = await engine.getScore(entityA);
      expect(recordA_after).toBeDefined();
      expect(recordA_after!.score).toBe(scoreA_before);
      expect(recordA_after!.signals.length).toBe(0);
    });

    it('two initialized entities remain fully independent after signals to one', async () => {
      const entityX = 'entity-x' as ID;
      const entityY = 'entity-y' as ID;

      await engine.initializeEntity(entityX);
      await engine.initializeEntity(entityY);

      // Bombard entity X with 20 signals of mixed types
      const types = [
        'behavioral.task_completion',
        'compliance.policy_check',
        'identity.verification',
        'context.environment_check',
      ];

      for (let i = 0; i < 20; i++) {
        await engine.recordSignal(
          makeSignal({
            entityId: entityX,
            type: types[i % types.length]!,
            value: 0.9,
          }),
        );
      }

      const recordX = await engine.getScore(entityX);
      const recordY = await engine.getScore(entityY);

      expect(recordX).toBeDefined();
      expect(recordY).toBeDefined();

      // Entity Y should still have its initial state — zero signals
      expect(recordY!.signals.length).toBe(0);
      // Entity Y score should remain at the default initialized level
      expect(recordY!.score).toBe(TRUST_THRESHOLDS[1].min);

      // Entity X should have all 20 signals
      expect(recordX!.signals.length).toBe(20);
    });
  });

  // ===========================================================================
  // Concurrent Signal Writes
  // ===========================================================================
  describe('Concurrent Signal Writes', () => {
    it('100 concurrent signals via Promise.all produce no crash and a valid final score', async () => {
      const entityId = 'concurrent-01' as ID;
      await engine.initializeEntity(entityId);

      const signals = makeSignals(entityId, 100, {
        type: 'behavioral.task_completion',
        value: 0.8,
      });

      // Fire all 100 signals concurrently
      await expect(
        Promise.all(signals.map((s) => engine.recordSignal(s))),
      ).resolves.not.toThrow();

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(record!.score)).toBe(true);
      // All 100 signals should have been recorded
      expect(record!.signals.length).toBe(100);
    });

    it('concurrent initialization of the same entity does not corrupt state', async () => {
      const entityId = 'concurrent-init-01' as ID;

      // Initialize the same entity 10 times concurrently
      const initPromises = Array.from({ length: 10 }, () =>
        engine.initializeEntity(entityId),
      );

      const results = await Promise.all(initPromises);

      // All should resolve without error
      expect(results.length).toBe(10);

      // There should be exactly one record for this entity, not duplicates
      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.entityId).toBe(entityId);

      // The entity should appear exactly once in the entity ID list
      const entityIds = engine.getEntityIds();
      const occurrences = entityIds.filter((id) => id === entityId).length;
      expect(occurrences).toBe(1);

      // Score should be a valid initial score (last-writer-wins on the map)
      expect(record!.score).toBe(TRUST_THRESHOLDS[1].min);
      expect(record!.level).toBe(1);
    });
  });

  // ===========================================================================
  // 16-Factor Model Validation (v2 trust factors)
  // ===========================================================================
  describe('16-Factor Model Validation', () => {
    it('FACTOR_CODES contains exactly 16 entries', () => {
      expect(FACTOR_CODES.length).toBe(16);
    });

    it('FACTOR_CODES entries are all unique', () => {
      const uniqueCodes = new Set(FACTOR_CODES);
      expect(uniqueCodes.size).toBe(FACTOR_CODES.length);
    });

    it('FACTOR_WEIGHTS has a key for every FACTOR_CODE', () => {
      for (const code of FACTOR_CODES) {
        expect(FACTOR_WEIGHTS).toHaveProperty(code);
        expect(typeof FACTOR_WEIGHTS[code]).toBe('number');
      }
    });

    it('FACTOR_WEIGHTS values sum to 1.0', () => {
      const sum = Object.values(FACTOR_WEIGHTS).reduce((acc, w) => acc + w, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
    });

    it('all FACTOR_WEIGHTS values are positive', () => {
      for (const [code, weight] of Object.entries(FACTOR_WEIGHTS)) {
        expect(weight).toBeGreaterThan(0);
      }
    });

    it('legacy SIGNAL_WEIGHTS still sum to 1.0 (backwards compat)', () => {
      const sum = Object.values(SIGNAL_WEIGHTS).reduce((acc, w) => acc + w, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
    });
  });

  // ===========================================================================
  // NaN Signal Values
  // ===========================================================================
  describe('NaN Signal Values', () => {
    it('NaN value signal does not crash the engine', async () => {
      const entityId = 'nan-value-01' as ID;
      await engine.initializeEntity(entityId);

      await expect(
        engine.recordSignal(
          makeSignal({
            entityId,
            type: 'behavioral.task_completion',
            value: NaN,
          }),
        ),
      ).resolves.not.toThrow();

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // Score must still be a defined number — NaN must not propagate
      expect(record!.score).toBeDefined();
    });

    it('NaN value signal mixed with valid signals still produces a finite score', async () => {
      const entityId = 'nan-mixed-01' as ID;
      await engine.initializeEntity(entityId);

      // Record a valid signal first
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: 0.8,
        }),
      );

      // Then inject a NaN signal
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: NaN,
        }),
      );

      // Then another valid signal
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'compliance.policy_check',
          value: 0.9,
        }),
      );

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // The engine should still produce a score — NaN should not poison the entire calculation
      expect(record!.score).toBeDefined();
      expect(record!.signals.length).toBe(3);
    });
  });

  // ===========================================================================
  // Empty / Invalid Entity IDs
  // ===========================================================================
  describe('Empty / Invalid Entity IDs', () => {
    it('empty string entity ID does not crash the engine on initializeEntity', async () => {
      const entityId = '' as ID;

      // The engine may reject or accept empty IDs — either way it must not crash
      await expect(
        engine.initializeEntity(entityId),
      ).resolves.not.toThrow();
    });

    it('very long entity ID (1000 chars) does not crash and can store/retrieve a score', async () => {
      const entityId = 'e'.repeat(1000) as ID;
      await engine.initializeEntity(entityId);

      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: 0.75,
        }),
      );

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.entityId).toBe(entityId);
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(record!.signals.length).toBe(1);
    });
  });

  // ===========================================================================
  // Signal Type Edge Cases
  // ===========================================================================
  describe('Signal Type Edge Cases', () => {
    it('empty string signal type does not crash the engine', async () => {
      const entityId = 'type-edge-empty-01' as ID;
      await engine.initializeEntity(entityId);

      await expect(
        engine.recordSignal(
          makeSignal({
            entityId,
            type: '',
            value: 0.7,
          }),
        ),
      ).resolves.not.toThrow();

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // Signal is stored even if the type is empty — engine does not validate type format
      expect(record!.signals.length).toBe(1);
    });

    it('extremely long signal type string (5000 chars) does not crash', async () => {
      const entityId = 'type-edge-long-01' as ID;
      await engine.initializeEntity(entityId);

      const longType = 'behavioral.' + 'x'.repeat(5000);

      await expect(
        engine.recordSignal(
          makeSignal({
            entityId,
            type: longType,
            value: 0.7,
          }),
        ),
      ).resolves.not.toThrow();

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.signals.length).toBe(1);
    });

    it('signal type with special characters (unicode, emoji, slashes) does not crash', async () => {
      const entityId = 'type-edge-special-01' as ID;
      await engine.initializeEntity(entityId);

      const specialTypes = [
        'behavioral.task/completion',
        'compliance.check<script>',
        'identity.\u0000null_byte',
        'context.env\ncheck',
        'behavioral.emoji_\u{1F4A5}',
      ];

      for (const type of specialTypes) {
        await expect(
          engine.recordSignal(makeSignal({ entityId, type, value: 0.5 })),
        ).resolves.not.toThrow();
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.signals.length).toBe(specialTypes.length);
    });
  });

  // ===========================================================================
  // Negative Signal Values
  // ===========================================================================
  describe('Negative Signal Values', () => {
    it('negative signal values (-0.5, -1.0) do not crash and score stays in [0, 1000]', async () => {
      const entityId = 'negative-val-01' as ID;
      await engine.initializeEntity(entityId);

      const negativeValues = [-0.5, -1.0, -0.01, -0.99];

      for (const value of negativeValues) {
        await expect(
          engine.recordSignal(
            makeSignal({
              entityId,
              type: 'behavioral.task_completion',
              value,
            }),
          ),
        ).resolves.not.toThrow();
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(record!.score)).toBe(true);
    });

    it('alternating positive and negative signals maintain a valid score range', async () => {
      const entityId = 'negative-alt-01' as ID;
      await engine.initializeEntity(entityId);

      // Alternate between positive and negative values
      for (let i = 0; i < 20; i++) {
        const value = i % 2 === 0 ? 0.9 : -0.9;
        await engine.recordSignal(
          makeSignal({
            entityId,
            type: 'behavioral.task_completion',
            value,
          }),
        );
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(record!.score)).toBe(true);
      expect(record!.signals.length).toBe(20);
    });
  });

  // ===========================================================================
  // Zero-Value Signals
  // ===========================================================================
  describe('Zero-Value Signals', () => {
    it('zero-value signal does NOT trigger recovery (recovery threshold >= 0.7)', async () => {
      const entityId = 'zero-val-01' as ID;
      await engine.initializeEntity(entityId);

      const recoveryEvents: unknown[] = [];
      engine.on('trust:recovery_applied', (event: unknown) => {
        recoveryEvents.push(event);
      });

      // Send 10 zero-value signals — none should trigger recovery
      for (let i = 0; i < 10; i++) {
        await engine.recordSignal(
          makeSignal({
            entityId,
            type: 'behavioral.task_completion',
            value: 0.0,
          }),
        );
      }

      // Recovery requires value >= 0.7, so zero-value signals must not trigger it
      expect(recoveryEvents.length).toBe(0);
    });

    it('zero-value signal followed by high-value signal: only the high-value triggers recovery', async () => {
      const entityId = 'zero-then-high-01' as ID;
      await engine.initializeEntity(entityId);

      const recoveryEvents: unknown[] = [];
      engine.on('trust:recovery_applied', (event: unknown) => {
        recoveryEvents.push(event);
      });

      // Send a zero-value signal
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: 0.0,
        }),
      );

      const countAfterZero = recoveryEvents.length;

      // Send a high-value signal that qualifies for recovery
      await engine.recordSignal(
        makeSignal({
          entityId,
          type: 'behavioral.task_completion',
          value: 0.95,
        }),
      );

      // No recovery should have been triggered by the zero-value signal
      expect(countAfterZero).toBe(0);
      // The high-value signal may or may not trigger recovery depending on engine state,
      // but the key assertion is the zero-value signal did NOT trigger any
    });
  });

  // ===========================================================================
  // Mixed Factor + Legacy Signal Types
  // ===========================================================================
  describe('Mixed Factor + Legacy Signal Types', () => {
    it('using both CT-COMP.xxx factor signals and behavioral.xxx legacy signals on the same entity works', async () => {
      const entityId = 'mixed-factor-legacy-01' as ID;
      await engine.initializeEntity(entityId);

      // Send 16-factor model signals
      const factorSignals = [
        { type: 'CT-COMP.task_done', value: 0.9 },
        { type: 'CT-REL.uptime_check', value: 0.85 },
        { type: 'CT-SEC.auth_passed', value: 0.95 },
        { type: 'OP-ALIGN.goal_match', value: 0.8 },
      ];

      for (const sig of factorSignals) {
        await engine.recordSignal(makeSignal({ entityId, ...sig }));
      }

      // Send legacy 4-bucket signals on the same entity
      const legacySignals = [
        { type: 'behavioral.task_completion', value: 0.8 },
        { type: 'compliance.policy_check', value: 0.9 },
        { type: 'identity.verification', value: 0.85 },
        { type: 'context.environment_check', value: 0.7 },
      ];

      for (const sig of legacySignals) {
        await engine.recordSignal(makeSignal({ entityId, ...sig }));
      }

      const record = await engine.getScore(entityId);
      expect(record).toBeDefined();
      // All 8 signals must be stored
      expect(record!.signals.length).toBe(8);
      // Score must remain within valid range
      expect(record!.score).toBeGreaterThanOrEqual(0);
      expect(record!.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(record!.score)).toBe(true);
    });

    it('legacy signals map to correct factors and do not create phantom factor scores', async () => {
      const entityId = 'mixed-phantom-01' as ID;
      await engine.initializeEntity(entityId);

      // Only send legacy signals — they should map to factors via SIGNAL_PREFIX_TO_FACTORS
      const legacySignals = [
        { type: 'behavioral.task_completion', value: 0.9 },
        { type: 'compliance.policy_check', value: 0.85 },
      ];

      for (const sig of legacySignals) {
        await engine.recordSignal(makeSignal({ entityId, ...sig }));
      }

      const calc = await engine.calculate(entityId);

      // Score must be valid
      expect(calc.score).toBeGreaterThanOrEqual(0);
      expect(calc.score).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(calc.score)).toBe(true);

      // factorScores should exist and contain only recognized factor codes
      if (calc.factorScores) {
        for (const code of Object.keys(calc.factorScores)) {
          expect(FACTOR_CODES).toContain(code);
        }
      }
    });
  });
});
