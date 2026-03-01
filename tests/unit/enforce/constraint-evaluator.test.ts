/**
 * Constraint Evaluator Tests
 *
 * Comprehensive tests for the constraint evaluator including:
 * - Rate limit constraints
 * - Time window constraints
 * - Resource cap constraints
 * - Dependency constraints
 * - Composite constraints (AND, OR, NOT)
 * - Custom constraints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConstraintEvaluator,
  createConstraintEvaluator,
  createRateLimitConstraint,
  createTimeWindowConstraint,
  createResourceCapConstraint,
  createDependencyConstraint,
  createCompositeConstraint,
  InMemoryStateProvider,
  type RateLimitConstraint,
  type TimeWindowConstraint,
  type ResourceCapConstraint,
  type DependencyConstraint,
  type CustomConstraint,
  type ConstraintEvaluationContext,
} from '../../../src/enforce/constraint-evaluator.js';
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

function createTestContext(intent: Intent): ConstraintEvaluationContext {
  return {
    intent,
    trustScore: 750,
    trustLevel: 3,
    context: intent.context as Record<string, unknown>,
  };
}

// =============================================================================
// RATE LIMIT CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Rate Limit', () => {
  let evaluator: ConstraintEvaluator;
  let stateProvider: InMemoryStateProvider;

  beforeEach(() => {
    stateProvider = new InMemoryStateProvider();
    evaluator = createConstraintEvaluator(stateProvider);
  });

  it('should pass when within rate limit', async () => {
    const constraint = createRateLimitConstraint(
      'rl-1',
      'API Rate Limit',
      100,
      60000, // 1 minute window
      'entityId'
    );
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.action).toBe('allow');
  });

  it('should fail when rate limit exceeded', async () => {
    const constraint = createRateLimitConstraint(
      'rl-1',
      'API Rate Limit',
      5,
      60000,
      'entityId'
    );
    evaluator.addConstraint(constraint);

    // Pre-set rate count to exceed limit
    stateProvider.setRateCount(`rate:rl-1:entity-789`, 10, 60000);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.action).toBe('deny');
    expect(results[0]?.reason).toContain('Rate limit exceeded');
  });

  it('should allow burst within allowance', async () => {
    const constraint = createRateLimitConstraint(
      'rl-1',
      'API Rate Limit',
      5,
      60000,
      'entityId',
      { config: { limit: 5, windowMs: 60000, keyBy: 'entityId', burstAllowance: 10 } }
    );
    evaluator.addConstraint(constraint);

    // Set count to base limit but within burst
    stateProvider.setRateCount(`rate:rl-1:entity-789`, 8, 60000);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should handle multiple key parts', async () => {
    const constraint = createRateLimitConstraint(
      'rl-1',
      'Combined Rate Limit',
      100,
      60000,
      ['entityId', 'tenantId']
    );
    evaluator.addConstraint(constraint);

    // Set count for combined key
    stateProvider.setRateCount(`rate:rl-1:entity-789:tenant-456`, 5, 60000);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });
});

// =============================================================================
// TIME WINDOW CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Time Window', () => {
  let evaluator: ConstraintEvaluator;

  beforeEach(() => {
    evaluator = createConstraintEvaluator();
  });

  it('should pass when within allowed time window', async () => {
    // Create a time constraint that allows all hours
    const constraint = createTimeWindowConstraint('tw-1', 'All Hours', {
      config: {
        // No time restrictions - should always pass
      },
    });
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context: ConstraintEvaluationContext = {
      ...createTestContext(intent),
      environment: {
        timestamp: '2024-01-15T12:00:00Z',
        timezone: 'UTC',
      },
    };

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should fail when outside allowed time window', async () => {
    const constraint = createTimeWindowConstraint('tw-1', 'Business Hours', {
      config: {
        allowedStart: '09:00',
        allowedEnd: '10:00', // Very narrow window
      },
    });
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    // Use a timestamp guaranteed to be outside 09:00-10:00 UTC
    const context: ConstraintEvaluationContext = {
      ...createTestContext(intent),
      environment: {
        timestamp: '2024-01-15T23:00:00Z', // 23:00 UTC - definitely outside 09:00-10:00
        timezone: 'UTC',
      },
    };

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('not in allowed window');
  });

  it('should fail during blackout period', async () => {
    const constraint = createTimeWindowConstraint('tw-1', 'With Blackout', {
      config: {
        blackoutPeriods: [{
          start: '2024-01-15T11:00:00Z',
          end: '2024-01-15T13:00:00Z',
          reason: 'Maintenance',
        }],
      },
    });
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context: ConstraintEvaluationContext = {
      ...createTestContext(intent),
      environment: {
        timestamp: '2024-01-15T12:00:00Z', // Within blackout
        timezone: 'UTC',
      },
    };

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('blackout period');
  });

  it('should filter by allowed days', async () => {
    const constraint = createTimeWindowConstraint('tw-1', 'Weekdays Only', {
      config: {
        allowedDays: [1, 2, 3, 4, 5], // Mon-Fri
      },
    });
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    // January 14, 2024 is a Sunday
    const context: ConstraintEvaluationContext = {
      ...createTestContext(intent),
      environment: {
        timestamp: '2024-01-14T12:00:00Z',
        timezone: 'UTC',
      },
    };

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('Day');
  });
});

// =============================================================================
// RESOURCE CAP CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Resource Cap', () => {
  let evaluator: ConstraintEvaluator;
  let stateProvider: InMemoryStateProvider;

  beforeEach(() => {
    stateProvider = new InMemoryStateProvider();
    evaluator = createConstraintEvaluator(stateProvider);
  });

  it('should pass when within concurrent limit', async () => {
    const constraint = createResourceCapConstraint('rc-1', 'DB Connections', 'database', {
      config: {
        resourceId: 'database',
        usageKey: 'database',
        maxConcurrent: 10,
      },
    });
    evaluator.addConstraint(constraint);

    stateProvider.setResourceUsage('database', 5, 0);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should fail when concurrent limit exceeded', async () => {
    const constraint = createResourceCapConstraint('rc-1', 'DB Connections', 'database', {
      config: {
        resourceId: 'database',
        usageKey: 'database',
        maxConcurrent: 10,
      },
    });
    evaluator.addConstraint(constraint);

    stateProvider.setResourceUsage('database', 15, 0);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('Concurrent resource limit exceeded');
  });

  it('should fail when total limit exceeded', async () => {
    const constraint = createResourceCapConstraint('rc-1', 'Daily API Calls', 'api', {
      config: {
        resourceId: 'api',
        usageKey: 'api',
        maxTotal: 1000,
      },
    });
    evaluator.addConstraint(constraint);

    stateProvider.setResourceUsage('api', 0, 1500);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('Total resource limit exceeded');
  });
});

// =============================================================================
// DEPENDENCY CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Dependency', () => {
  let evaluator: ConstraintEvaluator;
  let stateProvider: InMemoryStateProvider;

  beforeEach(() => {
    stateProvider = new InMemoryStateProvider();
    evaluator = createConstraintEvaluator(stateProvider);
  });

  it('should pass when all dependencies are fulfilled', async () => {
    const constraint = createDependencyConstraint('dep-1', 'Requires Auth', {
      config: {
        requiredIntents: ['auth.login'],
        relationship: 'all',
      },
    });
    evaluator.addConstraint(constraint);

    // Add fulfilled dependency
    stateProvider.addDependency('entity-789', 'auth.login');

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should fail when required dependencies not fulfilled', async () => {
    const constraint = createDependencyConstraint('dep-1', 'Requires Auth', {
      config: {
        requiredIntents: ['auth.login', 'auth.verify'],
        relationship: 'all',
      },
    });
    evaluator.addConstraint(constraint);

    // Only one dependency fulfilled
    stateProvider.addDependency('entity-789', 'auth.login');

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('Required intents not fulfilled');
  });

  it('should pass when any dependency is fulfilled (OR)', async () => {
    const constraint = createDependencyConstraint('dep-1', 'Requires Any Auth', {
      config: {
        requiredIntents: ['auth.login', 'auth.sso'],
        relationship: 'any',
      },
    });
    evaluator.addConstraint(constraint);

    stateProvider.addDependency('entity-789', 'auth.sso');

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should check required approvals', async () => {
    const constraint = createDependencyConstraint('dep-1', 'Requires Approval', {
      config: {
        requiredApprovals: ['admin', 'security'],
        relationship: 'all',
      },
    });
    evaluator.addConstraint(constraint);

    stateProvider.addApproval('intent-123', 'admin');

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });
});

// =============================================================================
// COMPOSITE CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Composite', () => {
  let evaluator: ConstraintEvaluator;
  let stateProvider: InMemoryStateProvider;

  beforeEach(() => {
    stateProvider = new InMemoryStateProvider();
    evaluator = createConstraintEvaluator(stateProvider);
  });

  it('should evaluate AND composite correctly when all pass', async () => {
    const rateLimit = createRateLimitConstraint('rl-1', 'Rate Limit', 100, 60000, 'entityId');
    const resourceCap = createResourceCapConstraint('rc-1', 'Resource Cap', 'db', {
      config: { resourceId: 'db', usageKey: 'db', maxConcurrent: 10 },
    });

    const composite = createCompositeConstraint('comp-1', 'Combined', 'AND', [
      rateLimit,
      resourceCap,
    ]);
    evaluator.addConstraint(composite);

    stateProvider.setResourceUsage('db', 5, 0);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should evaluate AND composite correctly when one fails', async () => {
    const rateLimit = createRateLimitConstraint('rl-1', 'Rate Limit', 5, 60000, 'entityId');
    const resourceCap = createResourceCapConstraint('rc-1', 'Resource Cap', 'db', {
      config: { resourceId: 'db', usageKey: 'db', maxConcurrent: 10 },
    });

    const composite = createCompositeConstraint('comp-1', 'Combined', 'AND', [
      rateLimit,
      resourceCap,
    ]);
    evaluator.addConstraint(composite);

    // Exceed rate limit
    stateProvider.setRateCount('rate:rl-1:entity-789', 10, 60000);
    stateProvider.setResourceUsage('db', 5, 0);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
  });

  it('should evaluate OR composite correctly when one passes', async () => {
    const rateLimit = createRateLimitConstraint('rl-1', 'Rate Limit', 5, 60000, 'entityId');
    const resourceCap = createResourceCapConstraint('rc-1', 'Resource Cap', 'db', {
      config: { resourceId: 'db', usageKey: 'db', maxConcurrent: 10 },
    });

    const composite = createCompositeConstraint('comp-1', 'Any', 'OR', [
      rateLimit,
      resourceCap,
    ]);
    evaluator.addConstraint(composite);

    // Exceed rate limit but resource is fine
    stateProvider.setRateCount('rate:rl-1:entity-789', 10, 60000);
    stateProvider.setResourceUsage('db', 5, 0);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should evaluate NOT composite correctly', async () => {
    const rateLimit = createRateLimitConstraint('rl-1', 'Rate Limit', 5, 60000, 'entityId');

    const composite = createCompositeConstraint('comp-1', 'Not Exceeded', 'NOT', [rateLimit]);
    evaluator.addConstraint(composite);

    // Exceed rate limit - NOT should make it pass
    stateProvider.setRateCount('rate:rl-1:entity-789', 10, 60000);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    // NOT inverts: rate limit fails, so NOT(fail) = pass
    expect(results[0]?.passed).toBe(true);
  });
});

// =============================================================================
// CUSTOM CONSTRAINT TESTS
// =============================================================================

describe('ConstraintEvaluator - Custom', () => {
  let evaluator: ConstraintEvaluator;

  beforeEach(() => {
    evaluator = createConstraintEvaluator();
  });

  it('should evaluate custom expression', async () => {
    const constraint: CustomConstraint = {
      id: 'custom-1',
      name: 'Trust Check',
      type: 'custom',
      enabled: true,
      violationAction: 'deny',
      priority: 100,
      config: {
        expression: 'trustScore > 500',
      },
    };
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context = createTestContext(intent); // trustScore = 750

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
  });

  it('should use custom evaluator function', async () => {
    const customEvaluator = async () => true;
    evaluator.registerCustomEvaluator('alwaysPass', customEvaluator);

    const constraint: CustomConstraint = {
      id: 'custom-1',
      name: 'Custom Function',
      type: 'custom',
      enabled: true,
      violationAction: 'deny',
      priority: 100,
      config: {
        evaluatorFn: 'alwaysPass',
      },
    };
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.reason).toContain('Custom evaluator passed');
  });

  it('should handle missing custom evaluator gracefully', async () => {
    const constraint: CustomConstraint = {
      id: 'custom-1',
      name: 'Missing Function',
      type: 'custom',
      enabled: true,
      violationAction: 'deny',
      priority: 100,
      config: {
        evaluatorFn: 'nonexistent',
      },
    };
    evaluator.addConstraint(constraint);

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('No evaluator or expression');
  });
});

// =============================================================================
// CONSTRAINT MANAGEMENT TESTS
// =============================================================================

describe('ConstraintEvaluator - Management', () => {
  let evaluator: ConstraintEvaluator;

  beforeEach(() => {
    evaluator = createConstraintEvaluator();
  });

  it('should add and retrieve constraints', () => {
    const constraint = createRateLimitConstraint('rl-1', 'Test', 100, 60000, 'entityId');
    evaluator.addConstraint(constraint);

    expect(evaluator.getConstraint('rl-1')).toBeDefined();
    expect(evaluator.getAllConstraints()).toHaveLength(1);
  });

  it('should remove constraints', () => {
    const constraint = createRateLimitConstraint('rl-1', 'Test', 100, 60000, 'entityId');
    evaluator.addConstraint(constraint);

    const removed = evaluator.removeConstraint('rl-1');

    expect(removed).toBe(true);
    expect(evaluator.getConstraint('rl-1')).toBeUndefined();
  });

  it('should get enabled constraints only', () => {
    evaluator.addConstraint(createRateLimitConstraint('rl-1', 'Enabled', 100, 60000, 'entityId'));
    evaluator.addConstraint({
      ...createRateLimitConstraint('rl-2', 'Disabled', 100, 60000, 'entityId'),
      enabled: false,
    });

    const enabled = evaluator.getEnabledConstraints();
    expect(enabled).toHaveLength(1);
  });

  it('should evaluate constraints by priority', async () => {
    evaluator.addConstraint({
      ...createRateLimitConstraint('rl-low', 'Low Priority', 100, 60000, 'entityId'),
      priority: 100,
    });
    evaluator.addConstraint({
      ...createRateLimitConstraint('rl-high', 'High Priority', 100, 60000, 'entityId'),
      priority: 10,
    });

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results).toHaveLength(2);
    expect(results[0]?.constraintId).toBe('rl-high');
    expect(results[1]?.constraintId).toBe('rl-low');
  });

  it('should skip disabled constraints', async () => {
    evaluator.addConstraint({
      ...createRateLimitConstraint('rl-1', 'Disabled', 100, 60000, 'entityId'),
      enabled: false,
    });

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const results = await evaluator.evaluateAll(context);

    expect(results).toHaveLength(0);
  });

  it('should return correct statistics', () => {
    evaluator.addConstraint(createRateLimitConstraint('rl-1', 'RL', 100, 60000, 'entityId'));
    evaluator.addConstraint(createTimeWindowConstraint('tw-1', 'TW'));
    evaluator.addConstraint({
      ...createResourceCapConstraint('rc-1', 'RC', 'db'),
      enabled: false,
    });

    const stats = evaluator.getStats();

    expect(stats.totalConstraints).toBe(3);
    expect(stats.enabledConstraints).toBe(2);
    expect(stats.byType['rate-limit']).toBe(1);
    expect(stats.byType['time-window']).toBe(1);
    expect(stats.byType['resource-cap']).toBe(1);
  });

  it('should clear all constraints', () => {
    evaluator.addConstraint(createRateLimitConstraint('rl-1', 'RL', 100, 60000, 'entityId'));
    evaluator.addConstraint(createTimeWindowConstraint('tw-1', 'TW'));

    evaluator.clear();

    expect(evaluator.getAllConstraints()).toHaveLength(0);
  });
});
