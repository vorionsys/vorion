/**
 * BASIS Rule Evaluator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEvaluator, createEvaluator } from '../../../src/basis/evaluator.js';
import { parseNamespace } from '../../../src/basis/parser.js';
import type { EvaluationContext } from '../../../src/basis/types.js';

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator;

  beforeEach(() => {
    evaluator = createEvaluator();
  });

  describe('registerNamespace', () => {
    it('should register a namespace successfully', () => {
      const namespace = parseNamespace({
        namespace: 'test',
        rules: [],
      });

      expect(() => evaluator.registerNamespace(namespace)).not.toThrow();
    });
  });

  describe('evaluate', () => {
    it('should return allow when no rules match', async () => {
      const context: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'test_action',
          goal: 'Test goal',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 2,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      const result = await evaluator.evaluate(context);

      expect(result.passed).toBe(true);
      expect(result.finalAction).toBe('allow');
      expect(result.rulesEvaluated).toHaveLength(0);
    });

    it('should evaluate matching rules', async () => {
      const namespace = parseNamespace({
        namespace: 'test',
        rules: [
          {
            id: 'rule_001',
            name: 'Test Rule',
            when: {
              intentType: 'test_action',
            },
            evaluate: [
              {
                condition: 'true',
                result: 'allow',
                reason: 'Always allow test actions',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      const context: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'test_action',
          goal: 'Test goal',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 2,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      const result = await evaluator.evaluate(context);

      expect(result.passed).toBe(true);
      expect(result.finalAction).toBe('allow');
      expect(result.rulesEvaluated).toHaveLength(1);
      expect(result.rulesEvaluated[0]?.ruleName).toBe('Test Rule');
    });

    it('should return deny when a rule denies', async () => {
      const namespace = parseNamespace({
        namespace: 'test',
        rules: [
          {
            id: 'rule_001',
            name: 'Deny Rule',
            when: {
              intentType: 'blocked_action',
            },
            evaluate: [
              {
                condition: 'true',
                result: 'deny',
                reason: 'This action is not allowed',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      const context: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'blocked_action',
          goal: 'Blocked goal',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 2,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      const result = await evaluator.evaluate(context);

      expect(result.passed).toBe(false);
      expect(result.finalAction).toBe('deny');
      expect(result.violatedRules).toHaveLength(1);
    });

    it('should respect rule priority order', async () => {
      const namespace = parseNamespace({
        namespace: 'test',
        rules: [
          {
            id: 'rule_low_priority',
            name: 'Low Priority',
            priority: 100,
            when: { intentType: '*' },
            evaluate: [{ condition: 'true', result: 'allow' }],
          },
          {
            id: 'rule_high_priority',
            name: 'High Priority',
            priority: 10,
            when: { intentType: '*' },
            evaluate: [{ condition: 'true', result: 'deny' }],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      const context: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'any_action',
          goal: 'Test',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 2,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      const result = await evaluator.evaluate(context);

      // High priority deny should be evaluated first
      expect(result.finalAction).toBe('deny');
      expect(result.rulesEvaluated[0]?.ruleName).toBe('High Priority');
    });

    it('should evaluate trust level expressions', async () => {
      const namespace = parseNamespace({
        namespace: 'trust-rules',
        rules: [
          {
            id: 'high_trust_required',
            name: 'High Trust Required',
            when: { intentType: 'sensitive_action' },
            evaluate: [
              {
                condition: 'entity.trustLevel < 3',
                result: 'deny',
                reason: 'Insufficient trust level for sensitive action',
              },
              {
                condition: 'entity.trustLevel >= 3',
                result: 'allow',
                reason: 'Trust level sufficient',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      // Low trust context should be denied
      const lowTrustContext: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'sensitive_action',
          goal: 'Access sensitive data',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 200,
          trustLevel: 2,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      const lowTrustResult = await evaluator.evaluate(lowTrustContext);
      expect(lowTrustResult.passed).toBe(false);
      expect(lowTrustResult.finalAction).toBe('deny');
      expect(lowTrustResult.violatedRules[0]?.reason).toContain('Insufficient trust');

      // High trust context should be allowed
      const highTrustContext: EvaluationContext = {
        ...lowTrustContext,
        entity: {
          ...lowTrustContext.entity,
          trustScore: 700,
          trustLevel: 4,
        },
      };

      const highTrustResult = await evaluator.evaluate(highTrustContext);
      expect(highTrustResult.passed).toBe(true);
      expect(highTrustResult.finalAction).toBe('allow');
    });

    it('should evaluate string matching expressions', async () => {
      const namespace = parseNamespace({
        namespace: 'content-rules',
        rules: [
          {
            id: 'block_delete',
            name: 'Block Delete Operations',
            when: { intentType: 'file_operation' },
            evaluate: [
              {
                condition: 'contains(intent.goal, "delete") OR contains(intent.goal, "remove")',
                result: 'deny',
                reason: 'Delete operations are not permitted',
              },
              {
                condition: 'true',
                result: 'allow',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      const baseContext: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'file_operation',
          goal: 'read config file',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 3,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      // Read operation should be allowed
      const readResult = await evaluator.evaluate(baseContext);
      expect(readResult.passed).toBe(true);

      // Delete operation should be denied
      const deleteContext: EvaluationContext = {
        ...baseContext,
        intent: {
          ...baseContext.intent,
          goal: 'delete old log files',
        },
      };

      const deleteResult = await evaluator.evaluate(deleteContext);
      expect(deleteResult.passed).toBe(false);
      expect(deleteResult.finalAction).toBe('deny');
    });

    it('should evaluate complex AND/OR expressions', async () => {
      const namespace = parseNamespace({
        namespace: 'complex-rules',
        rules: [
          {
            id: 'complex_rule',
            name: 'Complex Trust and Context Rule',
            when: { intentType: '*' },
            evaluate: [
              {
                condition:
                  '(entity.trustLevel >= 4 AND entity.attributes.verified == true) OR custom.adminOverride == true',
                result: 'allow',
                reason: 'Admin override or high trust verified entity',
              },
              {
                condition: 'entity.trustLevel < 2',
                result: 'deny',
                reason: 'Trust level too low',
              },
              {
                condition: 'true',
                result: 'escalate',
                reason: 'Requires human review',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      // High trust verified agent should be allowed
      const verifiedContext: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'test_action',
          goal: 'Test',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 800,
          trustLevel: 4,
          attributes: { verified: true },
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: { adminOverride: false },
      };

      const verifiedResult = await evaluator.evaluate(verifiedContext);
      expect(verifiedResult.passed).toBe(true);
      expect(verifiedResult.finalAction).toBe('allow');

      // Admin override should allow even low trust
      const adminContext: EvaluationContext = {
        ...verifiedContext,
        entity: {
          ...verifiedContext.entity,
          trustScore: 100,
          trustLevel: 1,
          attributes: { verified: false },
        },
        custom: { adminOverride: true },
      };

      const adminResult = await evaluator.evaluate(adminContext);
      expect(adminResult.passed).toBe(true);
      expect(adminResult.finalAction).toBe('allow');

      // Very low trust without override should be denied
      const lowTrustContext: EvaluationContext = {
        ...verifiedContext,
        entity: {
          ...verifiedContext.entity,
          trustScore: 50,
          trustLevel: 1,
          attributes: { verified: false },
        },
        custom: { adminOverride: false },
      };

      const lowTrustResult = await evaluator.evaluate(lowTrustContext);
      expect(lowTrustResult.passed).toBe(false);
      expect(lowTrustResult.finalAction).toBe('deny');

      // Medium trust should escalate
      const mediumTrustContext: EvaluationContext = {
        ...verifiedContext,
        entity: {
          ...verifiedContext.entity,
          trustScore: 300,
          trustLevel: 2,
          attributes: { verified: false },
        },
        custom: { adminOverride: false },
      };

      const mediumResult = await evaluator.evaluate(mediumTrustContext);
      expect(mediumResult.finalAction).toBe('escalate');
    });

    it('should handle expression errors gracefully', async () => {
      const namespace = parseNamespace({
        namespace: 'error-handling',
        rules: [
          {
            id: 'error_rule',
            name: 'Rule with Invalid Expression',
            when: { intentType: '*' },
            evaluate: [
              {
                // Invalid expression - should be caught
                condition: 'entity.trustLevel ===',
                result: 'deny',
                reason: 'Should not match due to error',
              },
              {
                condition: 'true',
                result: 'allow',
                reason: 'Fallback to allow',
              },
            ],
          },
        ],
      });

      evaluator.registerNamespace(namespace);

      const context: EvaluationContext = {
        intent: {
          id: 'int_123',
          type: 'test_action',
          goal: 'Test',
          context: {},
        },
        entity: {
          id: 'ent_456',
          type: 'agent',
          trustScore: 500,
          trustLevel: 3,
          attributes: {},
        },
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          requestId: 'req_789',
        },
        custom: {},
      };

      // Should not throw, should fall through to next condition
      const result = await evaluator.evaluate(context);
      expect(result.passed).toBe(true);
      expect(result.finalAction).toBe('allow');
      // Should have evaluation error in details
      expect(result.rulesEvaluated[0]?.details).toHaveProperty('evaluationError');
    });
  });
});
