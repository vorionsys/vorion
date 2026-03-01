/**
 * Decision Aggregator Tests
 *
 * Comprehensive tests for the decision aggregator including:
 * - Multiple conflict resolution strategies
 * - Source weighting
 * - Audit trail
 * - Decision conversion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DecisionAggregator,
  createDecisionAggregator,
  createSourceDecision,
  type SourceDecision,
  type AggregationContext,
  type ConflictStrategy,
} from '../../../src/enforce/decision-aggregator.js';
import type { Intent } from '../../../src/common/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestIntent(overrides?: Partial<Intent>): Intent {
  return {
    id: 'intent-123',
    tenantId: 'tenant-456',
    entityId: 'entity-789',
    goal: 'access-database',
    intentType: 'data.read',
    context: {
      resource: 'database',
      operation: 'read',
    },
    metadata: {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestContext(intent: Intent): AggregationContext {
  return {
    intent,
    trustScore: 750,
    trustLevel: 3,
    context: intent.context as Record<string, unknown>,
  };
}

function createTestDecision(overrides?: Partial<SourceDecision>): SourceDecision {
  return createSourceDecision({
    sourceId: 'source-1',
    sourceType: 'policy-engine',
    sourceName: 'Test Policy',
    action: 'allow',
    reason: 'Test reason',
    ...overrides,
  });
}

// =============================================================================
// AGGREGATION TESTS
// =============================================================================

describe('DecisionAggregator - Basic Aggregation', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator();
  });

  it('should aggregate a single decision', () => {
    const decision = createTestDecision();
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate([decision], context);

    expect(result.action).toBe('allow');
    expect(result.sourceDecisions).toHaveLength(1);
    expect(result.agreingSources).toHaveLength(1);
    expect(result.disagreingSources).toHaveLength(0);
  });

  it('should return deny when no decisions provided', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate([], context);

    expect(result.action).toBe('deny');
    expect(result.confidence).toBe(0);
    expect(result.reasons).toContain('No valid decision sources');
  });

  it('should filter decisions by confidence threshold', () => {
    const aggregator = createDecisionAggregator({ minConfidenceThreshold: 0.5 });

    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow', confidence: 0.3 }),
      createTestDecision({ sourceId: 's2', action: 'deny', confidence: 0.8 }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.sourceDecisions).toHaveLength(1);
    expect(result.action).toBe('deny'); // Only high confidence decision counts
  });

  it('should collect constraints from all sources', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow', constraints: ['c1', 'c2'] }),
      createTestDecision({ sourceId: 's2', action: 'allow', constraints: ['c2', 'c3'] }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.appliedConstraints).toContain('c1');
    expect(result.appliedConstraints).toContain('c2');
    expect(result.appliedConstraints).toContain('c3');
    // Should deduplicate
    expect(result.appliedConstraints.filter(c => c === 'c2')).toHaveLength(1);
  });

  it('should track agreeing and disagreeing sources', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'deny' }),
      createTestDecision({ sourceId: 's3', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    // With deny-overrides, final action is deny
    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('deny');
    expect(result.agreingSources).toContain('s2');
    expect(result.disagreingSources).toContain('s1');
    expect(result.disagreingSources).toContain('s3');
  });
});

// =============================================================================
// CONFLICT RESOLUTION STRATEGY TESTS
// =============================================================================

describe('DecisionAggregator - Deny Overrides Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'deny-overrides' });
  });

  it('should deny when any source denies', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'deny' }),
      createTestDecision({ sourceId: 's3', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('deny');
    expect(result.conflictResolution?.strategy).toBe('deny-overrides');
    expect(result.conflictResolution?.hadConflict).toBe(true);
  });

  it('should allow when all sources allow', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow');
    expect(result.conflictResolution).toBeUndefined();
  });
});

describe('DecisionAggregator - Allow Overrides Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'allow-overrides' });
  });

  it('should allow when any source allows', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'deny' }),
      createTestDecision({ sourceId: 's2', action: 'allow' }),
      createTestDecision({ sourceId: 's3', action: 'deny' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow');
  });
});

describe('DecisionAggregator - Most Restrictive Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'most-restrictive' });
  });

  it('should choose most restrictive action', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'monitor' }),
      createTestDecision({ sourceId: 's3', action: 'limit' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // limit is more restrictive than monitor and allow
    expect(result.action).toBe('limit');
  });

  it('should choose deny as most restrictive', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'escalate' }),
      createTestDecision({ sourceId: 's2', action: 'deny' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('deny');
  });
});

describe('DecisionAggregator - Least Restrictive Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'least-restrictive' });
  });

  it('should choose least restrictive action', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'deny' }),
      createTestDecision({ sourceId: 's2', action: 'monitor' }),
      createTestDecision({ sourceId: 's3', action: 'limit' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // monitor is least restrictive among these
    expect(result.action).toBe('monitor');
  });

  it('should choose allow as least restrictive', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'limit' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow');
  });
});

describe('DecisionAggregator - Weighted Average Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'weighted-average' });
  });

  it('should favor high confidence decisions', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow', confidence: 0.9, weight: 1.0 }),
      createTestDecision({ sourceId: 's2', action: 'deny', confidence: 0.3, weight: 1.0 }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow');
  });

  it('should favor high weight decisions', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow', confidence: 0.5, weight: 0.2 }),
      createTestDecision({ sourceId: 's2', action: 'deny', confidence: 0.5, weight: 0.8 }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('deny');
  });
});

describe('DecisionAggregator - Unanimous Allow Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'unanimous-allow' });
  });

  it('should allow only when all sources allow', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'allow' }),
      createTestDecision({ sourceId: 's3', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow');
  });

  it('should use most restrictive non-allow when not unanimous', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'monitor' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('monitor');
  });
});

describe('DecisionAggregator - Majority Rules Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'majority-rules' });
  });

  it('should use majority decision', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'allow' }),
      createTestDecision({ sourceId: 's3', action: 'deny' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    expect(result.action).toBe('allow'); // 2/3 voted allow
  });

  it('should fall back to most restrictive when no majority', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'deny' }),
      createTestDecision({ sourceId: 's3', action: 'monitor' }),
      createTestDecision({ sourceId: 's4', action: 'limit' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // No majority, uses most restrictive
    expect(result.action).toBe('deny');
  });
});

describe('DecisionAggregator - Priority Based Strategy', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ defaultStrategy: 'priority-based' });
  });

  it('should use highest priority source decision', () => {
    const decisions = [
      createTestDecision({ sourceId: 's1', sourceType: 'external', action: 'allow' }),
      createTestDecision({ sourceId: 's2', sourceType: 'override', action: 'deny' }),
      createTestDecision({ sourceId: 's3', sourceType: 'policy-engine', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // Override has highest priority (0), so deny wins
    expect(result.action).toBe('deny');
  });
});

// =============================================================================
// AUDIT TRAIL TESTS
// =============================================================================

describe('DecisionAggregator - Audit Trail', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator({ enableAudit: true });
  });

  it('should record audit entries', () => {
    const decision = createTestDecision();
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([decision], context);

    const entries = aggregator.queryAudit();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.intentId).toBe(intent.id);
  });

  it('should query audit by intent ID', () => {
    const intent1 = createTestIntent({ id: 'intent-1' });
    const intent2 = createTestIntent({ id: 'intent-2' });

    aggregator.aggregate([createTestDecision()], createTestContext(intent1));
    aggregator.aggregate([createTestDecision()], createTestContext(intent2));
    aggregator.aggregate([createTestDecision()], createTestContext(intent1));

    const entries = aggregator.queryAudit({ intentId: 'intent-1' });

    expect(entries).toHaveLength(2);
    entries.forEach(e => expect(e.intentId).toBe('intent-1'));
  });

  it('should query audit by action', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([createTestDecision({ action: 'allow' })], context);
    aggregator.aggregate([createTestDecision({ action: 'deny' })], context);
    aggregator.aggregate([createTestDecision({ action: 'allow' })], context);

    const entries = aggregator.queryAudit({ action: 'deny' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.decision.action).toBe('deny');
  });

  it('should query audit by time range', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([createTestDecision()], context);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneHourFromNow = new Date(now.getTime() + 3600000);

    const entries = aggregator.queryAudit({
      startTime: oneHourAgo.toISOString(),
      endTime: oneHourFromNow.toISOString(),
    });

    expect(entries).toHaveLength(1);
  });

  it('should support pagination', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    for (let i = 0; i < 10; i++) {
      aggregator.aggregate([createTestDecision()], context);
    }

    const page1 = aggregator.queryAudit({ limit: 3, offset: 0 });
    const page2 = aggregator.queryAudit({ limit: 3, offset: 3 });

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it('should get audit entry by ID', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([createTestDecision()], context);

    const entries = aggregator.queryAudit();
    const entry = aggregator.getAuditEntry(entries[0]!.id);

    expect(entry).toBeDefined();
    expect(entry?.id).toBe(entries[0]!.id);
  });

  it('should calculate audit statistics', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([
      createTestDecision({ action: 'allow' }),
    ], context);

    aggregator.aggregate([
      createTestDecision({ action: 'deny' }),
    ], context);

    aggregator.aggregate([
      createTestDecision({ sourceId: 's1', action: 'allow' }),
      createTestDecision({ sourceId: 's2', action: 'deny' }),
    ], context);

    const stats = aggregator.getAuditStats();

    expect(stats.totalEntries).toBe(3);
    expect(stats.byAction['allow']).toBe(1);
    expect(stats.byAction['deny']).toBe(2);
    expect(stats.conflictRate).toBeGreaterThan(0);
  });

  it('should clear audit trail', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([createTestDecision()], context);
    expect(aggregator.queryAudit()).toHaveLength(1);

    aggregator.clearAudit();

    expect(aggregator.queryAudit()).toHaveLength(0);
  });

  it('should export audit trail', () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    aggregator.aggregate([createTestDecision()], context);
    aggregator.aggregate([createTestDecision()], context);

    const exported = aggregator.exportAudit();

    expect(exported).toHaveLength(2);
    expect(Array.isArray(exported)).toBe(true);
  });
});

// =============================================================================
// CONFIGURATION TESTS
// =============================================================================

describe('DecisionAggregator - Configuration', () => {
  it('should allow setting source priority', () => {
    const aggregator = createDecisionAggregator({ defaultStrategy: 'priority-based' });

    // Set external to highest priority (lower number = higher priority)
    aggregator.setSourcePriority('external', -1);

    const decisions = [
      createTestDecision({ sourceId: 's1', sourceType: 'override', action: 'deny' }),
      createTestDecision({ sourceId: 's2', sourceType: 'external', action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // External now has highest priority (lowest number)
    expect(result.action).toBe('allow');
  });

  it('should allow setting source weight', () => {
    const aggregator = createDecisionAggregator({ defaultStrategy: 'weighted-average' });

    // Make external weight very high
    aggregator.setSourceWeight('external', 100.0);
    aggregator.setSourceWeight('policy-engine', 0.1);

    const decisions = [
      createTestDecision({ sourceId: 's1', sourceType: 'policy-engine', action: 'deny', confidence: 0.9, weight: 0.1 }),
      createTestDecision({ sourceId: 's2', sourceType: 'external', action: 'allow', confidence: 0.9, weight: 100.0 }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = aggregator.aggregate(decisions, context);

    // High weight wins
    expect(result.action).toBe('allow');
  });

  it('should return configuration in stats', () => {
    const aggregator = createDecisionAggregator();

    aggregator.setSourcePriority('external', 5);
    aggregator.setSourceWeight('external', 2.0);

    const stats = aggregator.getStats();

    expect(stats.defaultStrategy).toBe('deny-overrides');
    expect(stats.sourcePriorities.find(([t]) => t === 'external')?.[1]).toBe(5);
    expect(stats.sourceWeights.find(([t]) => t === 'external')?.[1]).toBe(2.0);
  });
});

// =============================================================================
// DECISION CONVERSION TESTS
// =============================================================================

describe('DecisionAggregator - Decision Conversion', () => {
  let aggregator: DecisionAggregator;

  beforeEach(() => {
    aggregator = createDecisionAggregator();
  });

  it('should convert aggregated decision to standard Decision type', () => {
    const decisions = [
      createTestDecision({ action: 'allow' }),
    ];
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const aggregated = aggregator.aggregate(decisions, context);
    const decision = aggregator.toDecision(aggregated, context);

    expect(decision.intentId).toBe(intent.id);
    expect(decision.action).toBe('allow');
    expect(decision.trustScore).toBe(context.trustScore);
    expect(decision.trustLevel).toBe(context.trustLevel);
    expect(decision.decidedAt).toBeDefined();
    expect(decision.constraintsEvaluated).toHaveLength(1);
  });
});
