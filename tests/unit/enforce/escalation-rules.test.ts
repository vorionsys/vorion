/**
 * Escalation Rules Tests
 *
 * Comprehensive tests for the escalation rule engine including:
 * - Rule matching
 * - Risk score computation
 * - Target selection
 * - Escalation lifecycle (create, approve, reject, timeout)
 * - Notification handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EscalationRuleEngine,
  createEscalationRuleEngine,
  createEscalationRule,
  createEscalationTarget,
  type EscalationRule,
  type EscalationTarget,
  type EscalationContext,
  type NotificationHandler,
  LoggingNotificationHandler,
} from '../../../src/enforce/escalation-rules.js';
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

function createTestContext(intent: Intent, overrides?: Partial<EscalationContext>): EscalationContext {
  return {
    intent,
    trustScore: 750,
    trustLevel: 3,
    context: intent.context as Record<string, unknown>,
    ...overrides,
  };
}

function createTestRule(overrides?: Partial<EscalationRule>): EscalationRule {
  return createEscalationRule({
    id: 'rule-1',
    name: 'High Risk Escalation',
    conditions: {
      riskScoreThreshold: 500,
    },
    escalation: {
      targets: [
        createEscalationTarget({
          id: 'target-1',
          type: 'user',
          name: 'Security Admin',
          channels: [{ type: 'email', address: 'admin@example.com' }],
        }),
      ],
      timeout: 'PT1H',
      timeoutAction: 'deny',
      requireJustification: true,
      requiredApprovals: 1,
      maxChainDepth: 3,
    },
    ...overrides,
  });
}

// =============================================================================
// RULE MANAGEMENT TESTS
// =============================================================================

describe('EscalationRuleEngine - Rule Management', () => {
  let engine: EscalationRuleEngine;

  beforeEach(() => {
    engine = createEscalationRuleEngine();
  });

  it('should add a rule', () => {
    const rule = createTestRule();
    engine.addRule(rule);

    expect(engine.getRule(rule.id)).toBeDefined();
    expect(engine.getAllRules()).toHaveLength(1);
  });

  it('should remove a rule', () => {
    const rule = createTestRule();
    engine.addRule(rule);

    const removed = engine.removeRule(rule.id);

    expect(removed).toBe(true);
    expect(engine.getRule(rule.id)).toBeUndefined();
  });

  it('should get enabled rules only', () => {
    engine.addRule(createTestRule({ id: 'r1', enabled: true }));
    engine.addRule(createTestRule({ id: 'r2', enabled: false }));
    engine.addRule(createTestRule({ id: 'r3', enabled: true }));

    const enabled = engine.getEnabledRules();
    expect(enabled).toHaveLength(2);
  });

  it('should clear all rules', () => {
    engine.addRule(createTestRule({ id: 'r1' }));
    engine.addRule(createTestRule({ id: 'r2' }));

    engine.clear();

    expect(engine.getAllRules()).toHaveLength(0);
  });
});

// =============================================================================
// RULE MATCHING TESTS
// =============================================================================

describe('EscalationRuleEngine - Rule Matching', () => {
  let engine: EscalationRuleEngine;

  beforeEach(() => {
    engine = createEscalationRuleEngine();
  });

  it('should match rule when risk score exceeds threshold', () => {
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 300 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustScore: 400, // Low trust = higher risk
      trustLevel: 1,
    });

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
    expect(result?.riskScore).toBeGreaterThan(300);
  });

  it('should not match when risk score below threshold', () => {
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 800 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustScore: 900, // High trust = low risk
      trustLevel: 5,
    });

    const result = engine.evaluate(context);

    expect(result).toBeNull();
  });

  it('should match rule by risk level', () => {
    engine.addRule(createTestRule({
      conditions: { riskLevel: 'medium' },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustScore: 300,
      trustLevel: 1,
    });

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
  });

  it('should match rule by action type', () => {
    engine.addRule(createTestRule({
      conditions: { actionTypes: ['delete-*'] },
    }));

    const intent = createTestIntent({ goal: 'delete-user' });
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
  });

  it('should not match when action type does not match', () => {
    engine.addRule(createTestRule({
      conditions: { actionTypes: ['delete-*'] },
    }));

    const intent = createTestIntent({ goal: 'read-user' });
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result).toBeNull();
  });

  it('should match rule by resource pattern', () => {
    engine.addRule(createTestRule({
      conditions: { resourcePatterns: ['database-*'] },
    }));

    const intent = createTestIntent({
      context: { resource: 'database-prod' },
    });
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
  });

  it('should match rule by resource sensitivity', () => {
    engine.addRule(createTestRule({
      conditions: { resourceSensitivity: ['restricted', 'top-secret'] },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      resourceSensitivity: 'restricted',
    });

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
  });

  it('should match rule by trust level below', () => {
    engine.addRule(createTestRule({
      conditions: { trustLevelBelow: 3 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustLevel: 2,
    });

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
  });

  it('should not match when trust level meets threshold', () => {
    engine.addRule(createTestRule({
      conditions: { trustLevelBelow: 3 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustLevel: 3,
    });

    const result = engine.evaluate(context);

    expect(result).toBeNull();
  });

  it('should match rule by intent type', () => {
    engine.addRule(createTestRule({
      conditions: { intentTypes: ['data.write', 'data.delete'] },
    }));

    const intent = createTestIntent({ intentType: 'data.delete' });
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
  });

  it('should match custom expression', () => {
    engine.addRule(createTestRule({
      conditions: { customExpression: 'trustScore < 500' },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustScore: 400,
    });

    const result = engine.evaluate(context);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
  });

  it('should evaluate rules by priority', () => {
    engine.addRule(createTestRule({
      id: 'low-priority',
      priority: 100,
      conditions: { riskScoreThreshold: 100 },
    }));

    engine.addRule(createTestRule({
      id: 'high-priority',
      priority: 10,
      conditions: { riskScoreThreshold: 100 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent, {
      trustScore: 300,
      trustLevel: 1,
    });

    const result = engine.evaluate(context);

    expect(result?.rule.id).toBe('high-priority');
  });

  it('should skip disabled rules', () => {
    engine.addRule(createTestRule({
      enabled: false,
      conditions: { riskScoreThreshold: 0 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result).toBeNull();
  });
});

// =============================================================================
// RISK COMPUTATION TESTS
// =============================================================================

describe('EscalationRuleEngine - Risk Computation', () => {
  let engine: EscalationRuleEngine;

  beforeEach(() => {
    engine = createEscalationRuleEngine();
    // Add a rule that will match most things
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 0 },
    }));
  });

  it('should compute higher risk for lower trust scores', () => {
    const intent = createTestIntent();

    const lowTrustContext = createTestContext(intent, {
      trustScore: 200,
      trustLevel: 1,
    });

    const highTrustContext = createTestContext(intent, {
      trustScore: 900,
      trustLevel: 5,
    });

    const lowTrustResult = engine.evaluate(lowTrustContext);
    const highTrustResult = engine.evaluate(highTrustContext);

    expect(lowTrustResult?.riskScore).toBeGreaterThan(highTrustResult?.riskScore ?? 0);
  });

  it('should compute higher risk for sensitive resources', () => {
    const intent = createTestIntent();

    const publicContext = createTestContext(intent, {
      resourceSensitivity: 'public',
    });

    const restrictedContext = createTestContext(intent, {
      resourceSensitivity: 'restricted',
    });

    const publicResult = engine.evaluate(publicContext);
    const restrictedResult = engine.evaluate(restrictedContext);

    expect(restrictedResult?.riskScore).toBeGreaterThan(publicResult?.riskScore ?? 0);
  });

  it('should classify risk levels correctly', () => {
    const intent = createTestIntent();

    const lowRiskContext = createTestContext(intent, {
      trustScore: 950,
      trustLevel: 5,
      resourceSensitivity: 'public',
    });

    const highRiskContext = createTestContext(intent, {
      trustScore: 100,
      trustLevel: 0,
      resourceSensitivity: 'top-secret',
    });

    const lowRiskResult = engine.evaluate(lowRiskContext);
    const highRiskResult = engine.evaluate(highRiskContext);

    expect(['minimal', 'low']).toContain(lowRiskResult?.riskLevel);
    expect(['high', 'critical']).toContain(highRiskResult?.riskLevel);
  });
});

// =============================================================================
// ESCALATION LIFECYCLE TESTS
// =============================================================================

describe('EscalationRuleEngine - Escalation Lifecycle', () => {
  let engine: EscalationRuleEngine;
  let mockNotificationHandler: NotificationHandler;

  beforeEach(() => {
    mockNotificationHandler = {
      notify: vi.fn().mockResolvedValue(true),
    };

    engine = createEscalationRuleEngine({
      notificationHandler: mockNotificationHandler,
    });

    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 0 },
    }));
  });

  it('should create an escalation', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context);
    expect(matchResult).not.toBeNull();

    const escalation = await engine.createEscalation(context, matchResult!);

    expect(escalation.id).toBeDefined();
    expect(escalation.intentId).toBe(intent.id);
    expect(escalation.status).toBe('pending');
    expect(escalation.targets).toHaveLength(1);
    expect(mockNotificationHandler.notify).toHaveBeenCalled();
  });

  it('should process an approval', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    const approved = engine.processApproval(escalation.id, {
      approverId: 'admin-1',
      approverName: 'Admin User',
      comments: 'Approved for business reasons',
    });

    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('approved');
    expect(approved?.approvals).toHaveLength(1);
  });

  it('should require multiple approvals when configured', async () => {
    engine.clear();
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 0 },
      escalation: {
        targets: [createEscalationTarget({ id: 't1', type: 'user', name: 'Admin 1' })],
        timeout: 'PT1H',
        timeoutAction: 'deny',
        requireJustification: true,
        requiredApprovals: 2,
        maxChainDepth: 3,
      },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    // First approval
    const afterFirst = engine.processApproval(escalation.id, {
      approverId: 'admin-1',
      approverName: 'Admin 1',
    });
    expect(afterFirst?.status).toBe('pending'); // Still pending

    // Second approval
    const afterSecond = engine.processApproval(escalation.id, {
      approverId: 'admin-2',
      approverName: 'Admin 2',
    });
    expect(afterSecond?.status).toBe('approved'); // Now approved
  });

  it('should process a rejection', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    const rejected = engine.processRejection(escalation.id, {
      rejecterId: 'admin-1',
      rejecterName: 'Admin User',
      reason: 'Not authorized',
    });

    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejections).toHaveLength(1);
  });

  it('should process timeout with deny action', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    const timeout = engine.processTimeout(escalation.id);

    expect(timeout).not.toBeNull();
    expect(timeout?.request.status).toBe('timeout');
    expect(timeout?.action).toBe('deny');
  });

  it('should send reminders', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    const sent = await engine.sendReminder(escalation.id);

    expect(sent).toBe(true);
    expect(mockNotificationHandler.notify).toHaveBeenCalledTimes(2); // Initial + reminder

    const updated = engine.getEscalation(escalation.id);
    expect(updated?.remindersSent).toBe(1);
  });

  it('should not approve non-pending escalations', async () => {
    const intent = createTestIntent();
    const context = createTestContext(intent);

    const matchResult = engine.evaluate(context)!;
    const escalation = await engine.createEscalation(context, matchResult);

    // Reject first
    engine.processRejection(escalation.id, {
      rejecterId: 'admin-1',
      rejecterName: 'Admin',
      reason: 'No',
    });

    // Try to approve
    const result = engine.processApproval(escalation.id, {
      approverId: 'admin-2',
      approverName: 'Admin 2',
    });

    expect(result).toBeNull();
  });
});

// =============================================================================
// TARGET SELECTION TESTS
// =============================================================================

describe('EscalationRuleEngine - Target Selection', () => {
  let engine: EscalationRuleEngine;

  beforeEach(() => {
    engine = createEscalationRuleEngine();
  });

  it('should select targets by priority', () => {
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 0 },
      escalation: {
        targets: [
          createEscalationTarget({ id: 't2', type: 'user', name: 'Low Priority', priority: 100 }),
          createEscalationTarget({ id: 't1', type: 'user', name: 'High Priority', priority: 10 }),
        ],
        timeout: 'PT1H',
        timeoutAction: 'deny',
        requireJustification: false,
        requiredApprovals: 1,
        maxChainDepth: 3,
      },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    expect(result?.selectedTargets[0]?.id).toBe('t1');
  });

  it('should filter out unavailable targets by schedule', () => {
    engine.addRule(createTestRule({
      conditions: { riskScoreThreshold: 0 },
      escalation: {
        targets: [
          createEscalationTarget({
            id: 't1',
            type: 'user',
            name: 'Available',
            priority: 10,
            availability: {
              timezone: 'UTC',
              availableHours: { start: '00:00', end: '23:59' },
            },
          }),
          createEscalationTarget({
            id: 't2',
            type: 'user',
            name: 'On Leave',
            priority: 5,
            availability: {
              timezone: 'UTC',
              outOfOffice: [{
                start: '2020-01-01T00:00:00Z',
                end: '2030-12-31T23:59:59Z',
                reason: 'Extended leave',
              }],
            },
          }),
        ],
        timeout: 'PT1H',
        timeoutAction: 'deny',
        requireJustification: false,
        requiredApprovals: 1,
        maxChainDepth: 3,
      },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent);

    const result = engine.evaluate(context);

    // Only available target should be selected
    expect(result?.selectedTargets).toHaveLength(1);
    expect(result?.selectedTargets[0]?.id).toBe('t1');
  });
});

// =============================================================================
// STATISTICS TESTS
// =============================================================================

describe('EscalationRuleEngine - Statistics', () => {
  let engine: EscalationRuleEngine;

  beforeEach(() => {
    engine = createEscalationRuleEngine();
  });

  it('should return correct statistics', async () => {
    engine.addRule(createTestRule({ id: 'r1', enabled: true }));
    engine.addRule(createTestRule({ id: 'r2', enabled: false }));

    // Create an escalation
    engine.addRule(createTestRule({
      id: 'r3',
      enabled: true,
      conditions: { riskScoreThreshold: 0 },
    }));

    const intent = createTestIntent();
    const context = createTestContext(intent);
    const matchResult = engine.evaluate(context)!;
    await engine.createEscalation(context, matchResult);

    const stats = engine.getStats();

    expect(stats.totalRules).toBe(3);
    expect(stats.enabledRules).toBe(2);
    expect(stats.activeEscalations).toBe(1);
    expect(stats.pendingEscalations).toBe(1);
  });
});
