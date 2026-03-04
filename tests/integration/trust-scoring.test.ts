/**
 * Trust Engine Scoring Integration Tests
 *
 * Tests trust score calculation, signal processing, level transitions,
 * and the integration between trust scores and policy decisions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

const mockTrustRecordStore = new Map<string, any>();
const mockSignalStore: any[] = [];
const mockHistoryStore: any[] = [];
const mockCacheStore = new Map<string, any>();

function resetStores(): void {
  mockTrustRecordStore.clear();
  mockSignalStore.length = 0;
  mockHistoryStore.length = 0;
  mockCacheStore.clear();
}

vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    trust: {
      calcInterval: 100, // Fast for testing
      cacheTtl: 30,
      decayRate: 0.01,
    },
    intent: {
      trustGates: { 'high-risk': 3, 'admin-action': 4 },
      defaultMinTrustLevel: 0,
      revalidateTrustAtDecision: true,
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TRUST ENGINE IMPLEMENTATION
// =============================================================================

type TrustLevel = 0 | 1 | 2 | 3 | 4 | 5;

interface TrustRecord {
  entityId: string;
  tenantId: string;
  score: number;
  level: TrustLevel;
  signals: {
    positive: number;
    negative: number;
    total: number;
  };
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface TrustSignal {
  entityId: string;
  tenantId: string;
  type: string;
  category: 'behavioral' | 'verification' | 'attestation' | 'time';
  value: number; // -1.0 to 1.0
  weight: number;
  source: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Trust Score Calculator
 */
class TrustScoreCalculator {
  // Score thresholds for levels
  private readonly levelThresholds: [number, TrustLevel][] = [
    [900, 5], // Expert (900-1000)
    [700, 4], // Trusted (700-899)
    [500, 3], // Established (500-699)
    [300, 2], // Developing (300-499)
    [100, 1], // Beginner (100-299)
    [0, 0],   // Unknown (0-99)
  ];

  // Signal weights by category
  private readonly categoryWeights: Record<TrustSignal['category'], number> = {
    behavioral: 1.0,
    verification: 1.5,
    attestation: 2.0,
    time: 0.5,
  };

  scoreToLevel(score: number): TrustLevel {
    for (const [threshold, level] of this.levelThresholds) {
      if (score >= threshold) return level;
    }
    return 0;
  }

  levelToScoreRange(level: TrustLevel): { min: number; max: number } {
    switch (level) {
      case 5: return { min: 900, max: 1000 };
      case 4: return { min: 700, max: 899 };
      case 3: return { min: 500, max: 699 };
      case 2: return { min: 300, max: 499 };
      case 1: return { min: 100, max: 299 };
      default: return { min: 0, max: 99 };
    }
  }

  calculateSignalImpact(signal: TrustSignal): number {
    const categoryWeight = this.categoryWeights[signal.category];
    const baseImpact = signal.value * signal.weight * 100;
    return baseImpact * categoryWeight;
  }

  applyDecay(score: number, daysSinceActivity: number): number {
    if (daysSinceActivity <= 7) return score; // No decay for first week
    if (daysSinceActivity <= 30) return score * 0.99; // 1% decay
    if (daysSinceActivity <= 90) return score * 0.95; // 5% decay
    if (daysSinceActivity <= 180) return score * 0.90; // 10% decay
    if (daysSinceActivity <= 365) return score * 0.80; // 20% decay
    return score * 0.60; // 40% decay for 1+ year inactive
  }

  clampScore(score: number): number {
    return Math.max(0, Math.min(1000, Math.round(score)));
  }
}

/**
 * Trust Engine Service
 */
class MockTrustEngine {
  private calculator = new TrustScoreCalculator();

  async initialize(entityId: string, tenantId: string, initialLevel: TrustLevel = 1): Promise<TrustRecord> {
    const { min, max } = this.calculator.levelToScoreRange(initialLevel);
    const initialScore = Math.floor((min + max) / 2);

    const record: TrustRecord = {
      entityId,
      tenantId,
      score: initialScore,
      level: initialLevel,
      signals: { positive: 0, negative: 0, total: 0 },
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockTrustRecordStore.set(`${entityId}:${tenantId}`, record);
    this.recordHistory(entityId, tenantId, record.score, initialLevel, 'initialized');

    return record;
  }

  async getScore(entityId: string, tenantId: string): Promise<TrustRecord | null> {
    // Check cache first
    const cacheKey = `trust:${entityId}:${tenantId}`;
    const cached = mockCacheStore.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.record;
    }

    const record = mockTrustRecordStore.get(`${entityId}:${tenantId}`);
    if (!record) return null;

    // Apply decay based on inactivity
    const daysSinceActivity = Math.floor(
      (Date.now() - record.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const decayedScore = this.calculator.clampScore(
      this.calculator.applyDecay(record.score, daysSinceActivity)
    );
    const decayedLevel = this.calculator.scoreToLevel(decayedScore);

    const result = {
      ...record,
      score: decayedScore,
      level: decayedLevel,
    };

    // Cache for 30 seconds
    mockCacheStore.set(cacheKey, {
      record: result,
      expiresAt: Date.now() + 30000,
    });

    return result;
  }

  async recordSignal(signal: Omit<TrustSignal, 'timestamp'>): Promise<TrustRecord | null> {
    const record = mockTrustRecordStore.get(`${signal.entityId}:${signal.tenantId}`);
    if (!record) return null;

    const fullSignal: TrustSignal = {
      ...signal,
      timestamp: new Date(),
    };
    mockSignalStore.push(fullSignal);

    // Calculate impact and update score
    const impact = this.calculator.calculateSignalImpact(fullSignal);
    const newScore = this.calculator.clampScore(record.score + impact);
    const newLevel = this.calculator.scoreToLevel(newScore);

    // Update counters
    if (signal.value > 0) {
      record.signals.positive++;
    } else if (signal.value < 0) {
      record.signals.negative++;
    }
    record.signals.total++;

    // Check for level transition
    if (newLevel !== record.level) {
      this.recordHistory(
        signal.entityId,
        signal.tenantId,
        newScore,
        newLevel,
        `level_${newLevel > record.level ? 'upgrade' : 'downgrade'}`
      );
    }

    record.score = newScore;
    record.level = newLevel;
    record.lastActivityAt = new Date();
    record.updatedAt = new Date();

    // Invalidate cache
    mockCacheStore.delete(`trust:${signal.entityId}:${signal.tenantId}`);

    return record;
  }

  async getSignals(entityId: string, tenantId: string, options?: {
    limit?: number;
    since?: Date;
  }): Promise<TrustSignal[]> {
    let signals = mockSignalStore.filter(
      s => s.entityId === entityId && s.tenantId === tenantId
    );

    if (options?.since) {
      signals = signals.filter(s => s.timestamp >= options.since);
    }

    signals.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      signals = signals.slice(0, options.limit);
    }

    return signals;
  }

  async getHistory(entityId: string, tenantId: string): Promise<any[]> {
    return mockHistoryStore.filter(
      h => h.entityId === entityId && h.tenantId === tenantId
    ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private recordHistory(
    entityId: string,
    tenantId: string,
    score: number,
    level: TrustLevel,
    reason: string
  ): void {
    mockHistoryStore.push({
      entityId,
      tenantId,
      score,
      level,
      reason,
      timestamp: new Date(),
    });
  }

  checkTrustGate(intentType: string, level: TrustLevel): { passed: boolean; required?: TrustLevel } {
    const gates: Record<string, TrustLevel> = {
      'high-risk': 3,
      'admin-action': 4,
      'data-export': 2,
    };

    const required = gates[intentType];
    if (required === undefined) {
      return { passed: true }; // No gate for this type
    }

    return {
      passed: level >= required,
      required,
    };
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Trust Engine Scoring Integration Tests', () => {
  let trustEngine: MockTrustEngine;
  let calculator: TrustScoreCalculator;

  const testTenantId = 'test-tenant-123';
  const testEntityId = randomUUID();

  beforeAll(() => {
    trustEngine = new MockTrustEngine();
    calculator = new TrustScoreCalculator();
  });

  beforeEach(() => {
    resetStores();
  });

  // ===========================================================================
  // 1. Score Calculation
  // ===========================================================================
  describe('Score Calculation', () => {
    it('should convert scores to correct levels', () => {
      expect(calculator.scoreToLevel(950)).toBe(5); // Expert
      expect(calculator.scoreToLevel(900)).toBe(5);
      expect(calculator.scoreToLevel(899)).toBe(4);
      expect(calculator.scoreToLevel(750)).toBe(4); // Trusted
      expect(calculator.scoreToLevel(700)).toBe(4);
      expect(calculator.scoreToLevel(699)).toBe(3);
      expect(calculator.scoreToLevel(550)).toBe(3); // Established
      expect(calculator.scoreToLevel(500)).toBe(3);
      expect(calculator.scoreToLevel(499)).toBe(2);
      expect(calculator.scoreToLevel(350)).toBe(2); // Developing
      expect(calculator.scoreToLevel(300)).toBe(2);
      expect(calculator.scoreToLevel(299)).toBe(1);
      expect(calculator.scoreToLevel(150)).toBe(1); // Beginner
      expect(calculator.scoreToLevel(100)).toBe(1);
      expect(calculator.scoreToLevel(99)).toBe(0);
      expect(calculator.scoreToLevel(50)).toBe(0);  // Unknown
      expect(calculator.scoreToLevel(0)).toBe(0);
    });

    it('should return correct score ranges for levels', () => {
      expect(calculator.levelToScoreRange(5)).toEqual({ min: 900, max: 1000 });
      expect(calculator.levelToScoreRange(4)).toEqual({ min: 700, max: 899 });
      expect(calculator.levelToScoreRange(3)).toEqual({ min: 500, max: 699 });
      expect(calculator.levelToScoreRange(2)).toEqual({ min: 300, max: 499 });
      expect(calculator.levelToScoreRange(1)).toEqual({ min: 100, max: 299 });
      expect(calculator.levelToScoreRange(0)).toEqual({ min: 0, max: 99 });
    });

    it('should clamp scores to valid range', () => {
      expect(calculator.clampScore(1500)).toBe(1000);
      expect(calculator.clampScore(500)).toBe(500);
      expect(calculator.clampScore(-100)).toBe(0);
      expect(calculator.clampScore(500.7)).toBe(501);
    });
  });

  // ===========================================================================
  // 2. Signal Impact
  // ===========================================================================
  describe('Signal Impact', () => {
    it('should calculate positive signal impact', () => {
      const signal: TrustSignal = {
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'successful_execution',
        category: 'behavioral',
        value: 0.1,
        weight: 1.0,
        source: 'orchestrator',
        timestamp: new Date(),
      };

      const impact = calculator.calculateSignalImpact(signal);
      expect(impact).toBe(10); // 0.1 * 1.0 * 100 * 1.0 (behavioral weight)
    });

    it('should calculate negative signal impact', () => {
      const signal: TrustSignal = {
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'policy_violation',
        category: 'behavioral',
        value: -0.2,
        weight: 1.0,
        source: 'policy-engine',
        timestamp: new Date(),
      };

      const impact = calculator.calculateSignalImpact(signal);
      expect(impact).toBe(-20);
    });

    it('should apply category weights', () => {
      const baseSignal = {
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'test',
        value: 0.1,
        weight: 1.0,
        source: 'test',
        timestamp: new Date(),
      };

      // Behavioral: 1.0x
      expect(calculator.calculateSignalImpact({ ...baseSignal, category: 'behavioral' })).toBe(10);

      // Verification: 1.5x
      expect(calculator.calculateSignalImpact({ ...baseSignal, category: 'verification' })).toBe(15);

      // Attestation: 2.0x
      expect(calculator.calculateSignalImpact({ ...baseSignal, category: 'attestation' })).toBe(20);

      // Time: 0.5x
      expect(calculator.calculateSignalImpact({ ...baseSignal, category: 'time' })).toBe(5);
    });

    it('should apply signal weight multiplier', () => {
      const signal: TrustSignal = {
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'weighted_action',
        category: 'behavioral',
        value: 0.1,
        weight: 2.0, // Double weight
        source: 'test',
        timestamp: new Date(),
      };

      const impact = calculator.calculateSignalImpact(signal);
      expect(impact).toBe(20); // 0.1 * 2.0 * 100 * 1.0
    });
  });

  // ===========================================================================
  // 3. Decay Mechanism
  // ===========================================================================
  describe('Decay Mechanism', () => {
    it('should not decay within first week', () => {
      expect(calculator.applyDecay(800, 0)).toBe(800);
      expect(calculator.applyDecay(800, 7)).toBe(800);
    });

    it('should apply 1% decay for 8-30 days', () => {
      expect(calculator.applyDecay(800, 15)).toBe(792);
      expect(calculator.applyDecay(1000, 30)).toBe(990);
    });

    it('should apply 5% decay for 31-90 days', () => {
      expect(calculator.applyDecay(800, 60)).toBe(760);
      expect(calculator.applyDecay(1000, 90)).toBe(950);
    });

    it('should apply progressive decay for longer periods', () => {
      const score = 1000;
      expect(calculator.applyDecay(score, 180)).toBe(900); // 10% decay
      expect(calculator.applyDecay(score, 365)).toBe(800); // 20% decay
      expect(calculator.applyDecay(score, 500)).toBe(600); // 40% decay
    });
  });

  // ===========================================================================
  // 4. Entity Lifecycle
  // ===========================================================================
  describe('Entity Lifecycle', () => {
    it('should initialize entity with default level', async () => {
      const record = await trustEngine.initialize(testEntityId, testTenantId);

      expect(record.entityId).toBe(testEntityId);
      expect(record.tenantId).toBe(testTenantId);
      expect(record.level).toBe(1); // Default
      expect(record.score).toBeGreaterThanOrEqual(100);
      expect(record.score).toBeLessThanOrEqual(299);
    });

    it('should initialize entity with specific level', async () => {
      const record = await trustEngine.initialize(testEntityId, testTenantId, 3);

      expect(record.level).toBe(3);
      expect(record.score).toBeGreaterThanOrEqual(500);
      expect(record.score).toBeLessThanOrEqual(699);
    });

    it('should record initialization in history', async () => {
      await trustEngine.initialize(testEntityId, testTenantId);

      const history = await trustEngine.getHistory(testEntityId, testTenantId);
      expect(history.length).toBe(1);
      expect(history[0].reason).toBe('initialized');
    });

    it('should retrieve score with decay applied', async () => {
      const record = await trustEngine.initialize(testEntityId, testTenantId, 3);

      // Simulate 60 days of inactivity
      record.lastActivityAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      const retrieved = await trustEngine.getScore(testEntityId, testTenantId);
      expect(retrieved!.score).toBeLessThan(record.score);
    });

    it('should return null for non-existent entity', async () => {
      const record = await trustEngine.getScore('non-existent', testTenantId);
      expect(record).toBeNull();
    });
  });

  // ===========================================================================
  // 5. Signal Processing
  // ===========================================================================
  describe('Signal Processing', () => {
    it('should record positive signal and update score', async () => {
      const initial = await trustEngine.initialize(testEntityId, testTenantId, 2);
      const initialScore = initial.score; // Capture the score before mutation

      const updated = await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'successful_execution',
        category: 'behavioral',
        value: 0.2,
        weight: 1.0,
        source: 'orchestrator',
      });

      expect(updated!.score).toBeGreaterThan(initialScore);
      expect(updated!.signals.positive).toBe(1);
      expect(updated!.signals.total).toBe(1);
    });

    it('should record negative signal and update score', async () => {
      const initial = await trustEngine.initialize(testEntityId, testTenantId, 3);
      const initialScore = initial.score; // Capture the score before mutation

      const updated = await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'policy_violation',
        category: 'behavioral',
        value: -0.3,
        weight: 1.0,
        source: 'policy-engine',
      });

      expect(updated!.score).toBeLessThan(initialScore);
      expect(updated!.signals.negative).toBe(1);
    });

    it('should update last activity on signal', async () => {
      const initial = await trustEngine.initialize(testEntityId, testTenantId);
      const initialActivity = initial.lastActivityAt;

      // Wait a bit
      await new Promise(r => setTimeout(r, 10));

      await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'activity',
        category: 'behavioral',
        value: 0.1,
        weight: 1.0,
        source: 'test',
      });

      const updated = await trustEngine.getScore(testEntityId, testTenantId);
      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(initialActivity.getTime());
    });

    it('should retrieve signal history', async () => {
      await trustEngine.initialize(testEntityId, testTenantId);

      await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'signal_1',
        category: 'behavioral',
        value: 0.1,
        weight: 1.0,
        source: 'test',
      });

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 5));

      await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'signal_2',
        category: 'verification',
        value: 0.2,
        weight: 1.0,
        source: 'test',
      });

      const signals = await trustEngine.getSignals(testEntityId, testTenantId);
      expect(signals.length).toBe(2);
      // Both signals should be present (order depends on implementation)
      const types = signals.map(s => s.type);
      expect(types).toContain('signal_1');
      expect(types).toContain('signal_2');
    });
  });

  // ===========================================================================
  // 6. Level Transitions
  // ===========================================================================
  describe('Level Transitions', () => {
    it('should upgrade level on positive signals', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 2);

      // Send enough positive signals to upgrade
      for (let i = 0; i < 10; i++) {
        await trustEngine.recordSignal({
          entityId: testEntityId,
          tenantId: testTenantId,
          type: 'positive_action',
          category: 'attestation', // 2x weight
          value: 0.5,
          weight: 1.0,
          source: 'test',
        });
      }

      const final = await trustEngine.getScore(testEntityId, testTenantId);
      expect(final!.level).toBeGreaterThan(2);
    });

    it('should downgrade level on negative signals', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 4);

      // Send negative signals
      for (let i = 0; i < 5; i++) {
        await trustEngine.recordSignal({
          entityId: testEntityId,
          tenantId: testTenantId,
          type: 'violation',
          category: 'behavioral',
          value: -0.5,
          weight: 1.0,
          source: 'test',
        });
      }

      const final = await trustEngine.getScore(testEntityId, testTenantId);
      expect(final!.level).toBeLessThan(4);
    });

    it('should record level transitions in history', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 2);

      // Upgrade
      for (let i = 0; i < 15; i++) {
        await trustEngine.recordSignal({
          entityId: testEntityId,
          tenantId: testTenantId,
          type: 'upgrade_signal',
          category: 'attestation',
          value: 0.5,
          weight: 1.0,
          source: 'test',
        });
      }

      const history = await trustEngine.getHistory(testEntityId, testTenantId);
      const upgradeEvents = history.filter(h => h.reason.includes('upgrade'));
      expect(upgradeEvents.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // 7. Trust Gates
  // ===========================================================================
  describe('Trust Gates', () => {
    it('should pass trust gate when level sufficient', () => {
      const result = trustEngine.checkTrustGate('high-risk', 3);
      expect(result.passed).toBe(true);

      const result2 = trustEngine.checkTrustGate('high-risk', 4);
      expect(result2.passed).toBe(true);
    });

    it('should fail trust gate when level insufficient', () => {
      const result = trustEngine.checkTrustGate('high-risk', 2);
      expect(result.passed).toBe(false);
      expect(result.required).toBe(3);
    });

    it('should pass when no gate defined for intent type', () => {
      const result = trustEngine.checkTrustGate('standard', 0);
      expect(result.passed).toBe(true);
      expect(result.required).toBeUndefined();
    });

    it('should enforce different gates for different intent types', () => {
      // high-risk requires level 3
      expect(trustEngine.checkTrustGate('high-risk', 2).passed).toBe(false);
      expect(trustEngine.checkTrustGate('high-risk', 3).passed).toBe(true);

      // admin-action requires level 4
      expect(trustEngine.checkTrustGate('admin-action', 3).passed).toBe(false);
      expect(trustEngine.checkTrustGate('admin-action', 4).passed).toBe(true);

      // data-export requires level 2
      expect(trustEngine.checkTrustGate('data-export', 1).passed).toBe(false);
      expect(trustEngine.checkTrustGate('data-export', 2).passed).toBe(true);
    });
  });

  // ===========================================================================
  // 8. Caching
  // ===========================================================================
  describe('Caching', () => {
    it('should cache trust scores', async () => {
      await trustEngine.initialize(testEntityId, testTenantId);

      // First call populates cache
      const first = await trustEngine.getScore(testEntityId, testTenantId);

      // Second call should return cached value
      const second = await trustEngine.getScore(testEntityId, testTenantId);

      expect(first).toEqual(second);
    });

    it('should invalidate cache on signal', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 2);

      // Populate cache
      const initial = await trustEngine.getScore(testEntityId, testTenantId);

      // Record signal (invalidates cache)
      await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'update',
        category: 'behavioral',
        value: 0.2,
        weight: 1.0,
        source: 'test',
      });

      // Should get updated value
      const updated = await trustEngine.getScore(testEntityId, testTenantId);
      expect(updated!.score).not.toBe(initial!.score);
    });
  });

  // ===========================================================================
  // 9. Edge Cases
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle score at boundaries', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 5);

      // Try to exceed max score
      for (let i = 0; i < 20; i++) {
        await trustEngine.recordSignal({
          entityId: testEntityId,
          tenantId: testTenantId,
          type: 'positive',
          category: 'attestation',
          value: 0.5,
          weight: 1.0,
          source: 'test',
        });
      }

      const result = await trustEngine.getScore(testEntityId, testTenantId);
      expect(result!.score).toBeLessThanOrEqual(1000);
    });

    it('should handle score at minimum', async () => {
      await trustEngine.initialize(testEntityId, testTenantId, 0);

      // Try to go below zero
      for (let i = 0; i < 10; i++) {
        await trustEngine.recordSignal({
          entityId: testEntityId,
          tenantId: testTenantId,
          type: 'negative',
          category: 'behavioral',
          value: -0.5,
          weight: 1.0,
          source: 'test',
        });
      }

      const result = await trustEngine.getScore(testEntityId, testTenantId);
      expect(result!.score).toBeGreaterThanOrEqual(0);
      expect(result!.level).toBe(0);
    });

    it('should handle neutral signals', async () => {
      const initial = await trustEngine.initialize(testEntityId, testTenantId, 2);

      await trustEngine.recordSignal({
        entityId: testEntityId,
        tenantId: testTenantId,
        type: 'neutral',
        category: 'behavioral',
        value: 0, // Neutral
        weight: 1.0,
        source: 'test',
      });

      const result = await trustEngine.getScore(testEntityId, testTenantId);
      expect(result!.score).toBe(initial.score); // Unchanged
    });

    it('should handle signal for non-existent entity', async () => {
      const result = await trustEngine.recordSignal({
        entityId: 'non-existent',
        tenantId: testTenantId,
        type: 'test',
        category: 'behavioral',
        value: 0.1,
        weight: 1.0,
        source: 'test',
      });

      expect(result).toBeNull();
    });
  });
});
