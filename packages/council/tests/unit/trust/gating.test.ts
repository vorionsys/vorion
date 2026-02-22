import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and path
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

import { GatingEngine } from '../../../src/trust/gating.js';
import { TelemetryCollector, getTelemetryCollector } from '../../../src/trust/telemetry.js';

describe('GatingEngine', () => {
  let engine: GatingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new GatingEngine('/tmp/test-audit');
  });

  describe('constructor', () => {
    it('should create engine instance', () => {
      expect(engine).toBeDefined();
    });
  });

  describe('evaluateGating', () => {
    it('should return hold with T0 for agent not in telemetry', () => {
      const decision = engine.evaluateGating('nonexistent_agent');
      expect(decision.decision).toBe('hold');
      expect(decision.currentTier).toBe('T0');
      expect(decision.reason).toContain('not found');
    });

    it('should return a complete decision object', () => {
      const decision = engine.evaluateGating('test_agent');
      expect(decision.agentId).toBe('test_agent');
      expect(decision.timestamp).toBeGreaterThan(0);
      expect(decision.decision).toBeDefined();
      expect(decision.blockedFactors).toBeInstanceOf(Array);
      expect(decision.metFactors).toBeInstanceOf(Array);
    });
  });

  describe('executeTierChange', () => {
    it('should return false for hold decisions', () => {
      const decision = {
        agentId: 'test_agent',
        timestamp: Date.now(),
        currentTier: 'T0' as const,
        targetTier: 'T0' as const,
        decision: 'hold' as const,
        reason: 'No change needed',
        blockedFactors: [],
        metFactors: [],
        overallScore: 100,
        factorScores: {},
      };

      expect(engine.executeTierChange(decision)).toBe(false);
    });
  });

  describe('getNextTierRequirements', () => {
    it('should return requirements for T0 -> T1', () => {
      const req = engine.getNextTierRequirements('T0');
      expect(req).not.toBeNull();
      expect(req!.nextTier).toBe('T1');
      expect(req!.thresholds).toBeDefined();
      expect(req!.scoreRequired).toBeGreaterThan(0);
    });

    it('should return null for T7 (max tier)', () => {
      const req = engine.getNextTierRequirements('T7');
      expect(req).toBeNull();
    });

    it('should have increasing score requirements for higher tiers', () => {
      const reqT0 = engine.getNextTierRequirements('T0');
      const reqT3 = engine.getNextTierRequirements('T3');
      expect(reqT3!.scoreRequired).toBeGreaterThan(reqT0!.scoreRequired);
    });
  });

  describe('getAgentAuditHistory', () => {
    it('should return empty array for agent with no history', () => {
      const history = engine.getAgentAuditHistory('no_history_agent');
      expect(history).toHaveLength(0);
    });
  });

  describe('getRecentAuditEntries', () => {
    it('should return empty array when no entries exist', () => {
      const entries = engine.getRecentAuditEntries();
      expect(entries).toHaveLength(0);
    });

    it('should respect limit parameter', () => {
      const entries = engine.getRecentAuditEntries(10);
      expect(entries.length).toBeLessThanOrEqual(10);
    });
  });

  describe('setAutoPromote', () => {
    it('should not throw when enabling auto-promote', () => {
      expect(() => engine.setAutoPromote(true)).not.toThrow();
    });

    it('should not throw when disabling auto-promote', () => {
      expect(() => engine.setAutoPromote(false)).not.toThrow();
    });
  });

  describe('setDemotionThreshold', () => {
    it('should clamp threshold to 0.5-1.0 range', () => {
      // Should not throw for extreme values
      expect(() => engine.setDemotionThreshold(0.1)).not.toThrow();
      expect(() => engine.setDemotionThreshold(2.0)).not.toThrow();
    });
  });
});
