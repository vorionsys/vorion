/**
 * Policy Engine Tests
 *
 * Comprehensive tests for the policy engine including:
 * - Policy evaluation
 * - Rule matching
 * - Constraint templates
 * - Policy versioning
 * - Runtime updates
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PolicyEngine,
  createPolicyEngine,
  createEnforcementPolicy,
  type EnforcementPolicy,
  type PolicyRule,
  type ConstraintTemplate,
  type PolicyEvaluationContext,
} from '../../../src/enforce/policy-engine.js';
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
      table: 'users',
    },
    metadata: {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestPolicy(overrides?: Partial<EnforcementPolicy>): EnforcementPolicy {
  return createEnforcementPolicy({
    id: 'policy-1',
    name: 'Test Policy',
    rules: [
      {
        id: 'rule-1',
        name: 'Match access-database',
        condition: {
          type: 'expression',
          expression: 'intent.goal == "access-database"',
        },
        action: 'allow',
        priority: 100,
        enabled: true,
      },
    ],
    ...overrides,
  });
}

function createTestContext(intent: Intent): PolicyEvaluationContext {
  return {
    intent,
    trustScore: 750,
    trustLevel: 3,
    context: intent.context as Record<string, unknown>,
  };
}

// =============================================================================
// POLICY ENGINE TESTS
// =============================================================================

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = createPolicyEngine();
  });

  describe('Policy Management', () => {
    it('should add a policy', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      expect(engine.getPolicy(policy.id)).toBeDefined();
      expect(engine.getAllPolicies()).toHaveLength(1);
    });

    it('should remove a policy', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      const removed = engine.removePolicy(policy.id);

      expect(removed).toBe(true);
      expect(engine.getPolicy(policy.id)).toBeUndefined();
    });

    it('should update a policy with versioning', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      engine.updatePolicy(policy.id, { priority: 50 }, {
        version: '1.1.0',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
        description: 'Updated priority',
      });

      const updated = engine.getPolicy(policy.id);
      expect(updated?.priority).toBe(50);
      expect(updated?.version.version).toBe('1.1.0');
    });

    it('should track policy versions', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      engine.updatePolicy(policy.id, { priority: 50 }, {
        version: '1.1.0',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
      });

      const versions = engine.getPolicyVersions(policy.id);
      expect(versions).toHaveLength(2);
      expect(versions[0]?.version).toBe('1.0.0');
      expect(versions[1]?.version).toBe('1.1.0');
    });

    it('should rollback policy to previous version', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      engine.updatePolicy(policy.id, { priority: 50 }, {
        version: '1.1.0',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
      });

      const rolledBack = engine.rollbackPolicy(policy.id);
      expect(rolledBack).toBe(true);

      const current = engine.getPolicy(policy.id);
      expect(current?.version.version).toBe('1.0.0');
    });

    it('should get enabled policies only', () => {
      engine.addPolicy(createTestPolicy({ id: 'p1', enabled: true }));
      engine.addPolicy(createTestPolicy({ id: 'p2', enabled: false }));
      engine.addPolicy(createTestPolicy({ id: 'p3', enabled: true }));

      const enabled = engine.getEnabledPolicies();
      expect(enabled).toHaveLength(2);
    });

    it('should enforce maximum policy limit', () => {
      const limitedEngine = createPolicyEngine({ maxPolicies: 2 });

      limitedEngine.addPolicy(createTestPolicy({ id: 'p1' }));
      limitedEngine.addPolicy(createTestPolicy({ id: 'p2' }));

      expect(() => {
        limitedEngine.addPolicy(createTestPolicy({ id: 'p3' }));
      }).toThrow('Maximum policy limit');
    });
  });

  describe('Policy Evaluation', () => {
    it('should match a simple expression policy', () => {
      const policy = createTestPolicy();
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(1);
      expect(results[0]?.matched).toBe(true);
      expect(results[0]?.action).toBe('allow');
    });

    it('should not match when expression does not match', () => {
      const policy = createTestPolicy({
        rules: [{
          id: 'rule-1',
          name: 'Match different goal',
          condition: {
            type: 'expression',
            expression: 'intent.goal == "delete-database"',
          },
          action: 'deny',
          priority: 100,
          enabled: true,
        }],
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(1);
      expect(results[0]?.matched).toBe(false);
    });

    it('should evaluate numeric comparisons', () => {
      const policy = createTestPolicy({
        rules: [{
          id: 'rule-1',
          name: 'High trust only',
          condition: {
            type: 'expression',
            expression: 'trustScore > 500',
          },
          action: 'allow',
          priority: 100,
          enabled: true,
        }],
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results[0]?.matched).toBe(true);
    });

    it('should evaluate composite conditions with AND', () => {
      const policy = createTestPolicy({
        rules: [{
          id: 'rule-1',
          name: 'Multiple conditions',
          condition: {
            type: 'composite',
            logic: 'AND',
            conditions: [
              { type: 'expression', expression: 'intent.goal == "access-database"' },
              { type: 'expression', expression: 'trustScore > 500' },
            ],
          },
          action: 'allow',
          priority: 100,
          enabled: true,
        }],
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent); // trustScore = 750

      const results = engine.evaluate(context);

      expect(results[0]?.matched).toBe(true);
    });

    it('should evaluate composite conditions with OR', () => {
      const policy = createTestPolicy({
        rules: [{
          id: 'rule-1',
          name: 'Either condition',
          condition: {
            type: 'composite',
            logic: 'OR',
            conditions: [
              { type: 'expression', expression: 'intent.goal == "wrong-goal"' },
              { type: 'expression', expression: 'trustScore > 500' },
            ],
          },
          action: 'allow',
          priority: 100,
          enabled: true,
        }],
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent); // trustScore = 750

      const results = engine.evaluate(context);

      expect(results[0]?.matched).toBe(true);
    });

    it('should evaluate policies by priority order', () => {
      engine.addPolicy(createTestPolicy({
        id: 'low-priority',
        name: 'Low Priority',
        priority: 100,
        rules: [{
          id: 'rule-1',
          name: 'Allow',
          condition: { type: 'expression', expression: 'trustScore >= 0' },
          action: 'allow',
          priority: 100,
          enabled: true,
        }],
      }));

      engine.addPolicy(createTestPolicy({
        id: 'high-priority',
        name: 'High Priority',
        priority: 10,
        rules: [{
          id: 'rule-1',
          name: 'Deny',
          condition: { type: 'expression', expression: 'trustScore >= 0' },
          action: 'deny',
          priority: 100,
          enabled: true,
        }],
      }));

      const intent = createTestIntent();
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      // High priority evaluated first, short-circuits on deny
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.policyId).toBe('high-priority');
      expect(results[0]?.action).toBe('deny');
    });

    it('should skip disabled policies', () => {
      engine.addPolicy(createTestPolicy({ enabled: false }));

      const intent = createTestIntent();
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(0);
    });

    it('should determine final action from results', () => {
      const results = [
        { matched: true, action: 'allow' as const, policyId: 'p1', policyName: 'P1', rulesEvaluated: [], matchedRules: [], appliedConstraints: [], durationMs: 0, evaluatedAt: '' },
        { matched: true, action: 'deny' as const, policyId: 'p2', policyName: 'P2', rulesEvaluated: [], matchedRules: [], appliedConstraints: [], durationMs: 0, evaluatedAt: '' },
      ];

      const action = engine.determineFinalAction(results);
      expect(action).toBe('deny');
    });
  });

  describe('Policy Conditions', () => {
    it('should filter by trust level', () => {
      const policy = createTestPolicy({
        conditions: {
          trustLevels: [4, 5],
        },
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent); // trustLevel 3

      const results = engine.evaluate(context);

      // Policy should not be applicable due to trust level
      expect(results).toHaveLength(0);
    });

    it('should filter by action patterns', () => {
      const policy = createTestPolicy({
        conditions: {
          actionPatterns: ['delete-*'],
        },
      });
      engine.addPolicy(policy);

      const intent = createTestIntent({ goal: 'access-database' });
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(0);
    });

    it('should match wildcard action patterns', () => {
      const policy = createTestPolicy({
        conditions: {
          actionPatterns: ['access-*'],
        },
      });
      engine.addPolicy(policy);

      const intent = createTestIntent({ goal: 'access-database' });
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(1);
    });

    it('should filter by intent types', () => {
      const policy = createTestPolicy({
        conditions: {
          intentTypes: ['data.write'],
        },
      });
      engine.addPolicy(policy);

      const intent = createTestIntent({ intentType: 'data.read' });
      const context = createTestContext(intent);

      const results = engine.evaluate(context);

      expect(results).toHaveLength(0);
    });

    it('should filter by time conditions', () => {
      const policy = createTestPolicy({
        conditions: {
          timeConditions: [{
            startHour: 0,
            endHour: 23,
          }],
        },
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = {
        ...createTestContext(intent),
        environment: {
          timestamp: new Date().toISOString(), // Current time - should be in window
          timezone: 'UTC',
        },
      };

      const results = engine.evaluate(context);

      // Should match - all hours allowed
      expect(results).toHaveLength(1);
    });
  });

  describe('Constraint Templates', () => {
    it('should add and retrieve templates', () => {
      const template: ConstraintTemplate = {
        id: 'template-1',
        name: 'Trust Check',
        description: 'Check minimum trust level',
        parameters: [
          { name: 'minLevel', type: 'number', required: true },
        ],
        expression: 'trustLevel >= {{minLevel}}',
        tags: ['trust', 'security'],
        version: '1.0.0',
      };

      engine.addTemplate(template);

      expect(engine.getTemplate('template-1')).toBeDefined();
      expect(engine.getAllTemplates()).toHaveLength(1);
    });

    it('should evaluate template-based conditions', () => {
      const template: ConstraintTemplate = {
        id: 'trust-check',
        name: 'Trust Check',
        description: 'Check minimum trust score',
        parameters: [
          { name: 'minScore', type: 'number', required: true },
        ],
        expression: 'trustScore > {{minScore}}',
        tags: ['trust'],
        version: '1.0.0',
      };

      engine.addTemplate(template);

      const policy = createTestPolicy({
        rules: [{
          id: 'rule-1',
          name: 'Trust template rule',
          condition: {
            type: 'template',
            templateId: 'trust-check',
            templateParams: { minScore: 500 },
          },
          action: 'allow',
          priority: 100,
          enabled: true,
        }],
      });
      engine.addPolicy(policy);

      const intent = createTestIntent();
      const context = createTestContext(intent); // trustScore = 750

      const results = engine.evaluate(context);

      expect(results[0]?.matched).toBe(true);
    });

    it('should find templates by tag', () => {
      engine.addTemplate({
        id: 't1',
        name: 'Template 1',
        description: '',
        parameters: [],
        expression: 'true',
        tags: ['security', 'compliance'],
        version: '1.0.0',
      });

      engine.addTemplate({
        id: 't2',
        name: 'Template 2',
        description: '',
        parameters: [],
        expression: 'true',
        tags: ['trust'],
        version: '1.0.0',
      });

      const securityTemplates = engine.findTemplatesByTag('security');
      expect(securityTemplates).toHaveLength(1);
      expect(securityTemplates[0]?.id).toBe('t1');
    });
  });

  describe('Update Listeners', () => {
    it('should notify listeners on policy add', () => {
      const events: Array<{ policyId: string; action: string }> = [];

      engine.onPolicyUpdate((policyId, action) => {
        events.push({ policyId, action });
      });

      engine.addPolicy(createTestPolicy({ id: 'p1' }));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ policyId: 'p1', action: 'add' });
    });

    it('should notify listeners on policy update', () => {
      const events: Array<{ policyId: string; action: string }> = [];

      engine.addPolicy(createTestPolicy({ id: 'p1' }));

      engine.onPolicyUpdate((policyId, action) => {
        events.push({ policyId, action });
      });

      engine.updatePolicy('p1', { priority: 50 }, {
        version: '1.1.0',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ policyId: 'p1', action: 'update' });
    });

    it('should allow unsubscribing from updates', () => {
      const events: string[] = [];

      const unsubscribe = engine.onPolicyUpdate((policyId) => {
        events.push(policyId);
      });

      engine.addPolicy(createTestPolicy({ id: 'p1' }));
      expect(events).toHaveLength(1);

      unsubscribe();

      engine.addPolicy(createTestPolicy({ id: 'p2' }));
      expect(events).toHaveLength(1); // No new events
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', () => {
      engine.addPolicy(createTestPolicy({ id: 'p1', enabled: true }));
      engine.addPolicy(createTestPolicy({ id: 'p2', enabled: false }));
      engine.addTemplate({
        id: 't1',
        name: 'T1',
        description: '',
        parameters: [],
        expression: 'true',
        tags: [],
        version: '1.0.0',
      });

      const stats = engine.getStats();

      expect(stats.totalPolicies).toBe(2);
      expect(stats.enabledPolicies).toBe(1);
      expect(stats.totalTemplates).toBe(1);
      expect(stats.totalVersions).toBe(2);
    });
  });

  describe('Clear', () => {
    it('should clear all policies and templates', () => {
      engine.addPolicy(createTestPolicy({ id: 'p1' }));
      engine.addTemplate({
        id: 't1',
        name: 'T1',
        description: '',
        parameters: [],
        expression: 'true',
        tags: [],
        version: '1.0.0',
      });

      engine.clear();

      expect(engine.getAllPolicies()).toHaveLength(0);
      expect(engine.getAllTemplates()).toHaveLength(0);
    });
  });
});
