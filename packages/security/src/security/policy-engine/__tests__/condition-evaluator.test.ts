/**
 * Tests for ConditionEvaluator
 *
 * Validates all 7 condition types, 16 operators, composite logic,
 * custom evaluators, evaluateAll, getNestedValue, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConditionEvaluator } from '../condition-evaluator.js';
import type {
  PolicyCondition,
  PolicyContext,
  PolicyContextRequest,
} from '../types.js';

// =============================================================================
// MOCK LOGGER
// =============================================================================

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// =============================================================================
// TEST HELPERS
// =============================================================================

function baseRequest(overrides?: Partial<PolicyContextRequest>): PolicyContextRequest {
  return {
    id: 'req-1',
    method: 'GET',
    path: '/api/data',
    url: 'https://example.com/api/data',
    ip: '192.168.1.100',
    userAgent: 'TestAgent/1.0',
    headers: { 'x-custom': 'header-value', authorization: 'Bearer tok' },
    query: { search: 'term', page: '1' },
    ...overrides,
  };
}

function baseContext(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    request: baseRequest(),
    user: {
      id: 'user-1',
      email: 'alice@acme.com',
      role: 'admin',
      department: 'engineering',
      tenant: 'acme',
      groups: ['devs', 'leads'],
      permissions: ['read', 'write', 'delete'],
      attributes: { level: 3, region: { code: 'US-WEST' } },
    },
    resource: {
      id: 'res-1',
      sensitivityLevel: 'confidential',
      dataType: 'pii',
      classification: 'internal',
      owner: 'bob',
      department: 'hr',
      region: 'us-east-1',
      tags: ['sensitive', 'gdpr'],
      attributes: { retention: { days: 90 } },
    },
    risk: {
      userRiskScore: 35,
      ipReputation: 80,
      deviceTrust: 70,
      sessionRisk: 20,
      anomalyScore: 15,
      threatLevel: 'low',
    },
    environment: {
      // Wednesday 2025-06-11 at 14:30 UTC
      timestamp: '2025-06-11T14:30:00.000Z',
      timezone: 'UTC',
      dayOfWeek: 3,
      hour: 14,
    },
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('ConditionEvaluator', () => {
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    evaluator = new ConditionEvaluator();
  });

  // ---------------------------------------------------------------------------
  // 1. User Attribute Conditions
  // ---------------------------------------------------------------------------
  describe('user_attribute conditions', () => {
    it('should match role equals', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'equals',
        value: 'admin',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.conditionType).toBe('user_attribute');
      expect(result.field).toBe('role');
      expect(result.actual).toBe('admin');
    });

    it('should not match role not_equals when role is the same', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'not_equals',
        value: 'admin',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('should match groups contains a specific group', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'groups',
        operator: 'contains',
        value: 'leads',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toEqual(['devs', 'leads']);
    });

    it('should match email_domain extraction', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'email_domain',
        operator: 'equals',
        value: 'acme.com',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('acme.com');
    });

    it('should match not_exists when user is absent', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'not_exists',
        value: undefined,
      };
      const ctx = baseContext({ user: undefined });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });

    it('should not match exists when user is absent', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'exists',
        value: undefined,
      };
      const ctx = baseContext({ user: undefined });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Request Attribute Conditions
  // ---------------------------------------------------------------------------
  describe('request_attribute conditions', () => {
    it('should match path with regex via matches operator', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'path',
        operator: 'matches',
        value: '^/api/.*',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should match method in array', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'method',
        operator: 'in',
        value: ['GET', 'POST'],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('GET');
    });

    it('should match ip equals', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'ip',
        operator: 'equals',
        value: '192.168.1.100',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should resolve header by headerName (lowercased)', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'header',
        headerName: 'X-Custom',
        operator: 'equals',
        value: 'header-value',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('header-value');
    });

    it('should resolve query param by queryParam', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'query',
        queryParam: 'search',
        operator: 'equals',
        value: 'term',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('term');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Time-Based Conditions
  // ---------------------------------------------------------------------------
  describe('time_based conditions', () => {
    it('should evaluate business_hours as true during work hours on a weekday', () => {
      // Wed 14:30 UTC => within 9-17 Mon-Fri
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'business_hours',
        operator: 'equals',
        value: true,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(true);
    });

    it('should evaluate weekend as false on a Wednesday', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'weekend',
        operator: 'equals',
        value: false,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(false);
    });

    it('should evaluate weekend as true on a Saturday', () => {
      // Saturday 2025-06-14T10:00:00.000Z
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'weekend',
        operator: 'equals',
        value: true,
      };
      const ctx = baseContext({
        environment: {
          timestamp: '2025-06-14T10:00:00.000Z',
          timezone: 'UTC',
          dayOfWeek: 6,
          hour: 10,
        },
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(true);
    });

    it('should compare hour with greater_than_or_equal', () => {
      // hour is 14 in UTC
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'hour',
        operator: 'greater_than_or_equal',
        value: 14,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(14);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Risk-Based Conditions
  // ---------------------------------------------------------------------------
  describe('risk_based conditions', () => {
    it('should match user_risk_score greater_than threshold', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'greater_than',
        value: 30,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(35);
    });

    it('should match threat_level equals', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'threat_level',
        operator: 'equals',
        value: 'low',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should match ip_reputation less_than', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'ip_reputation',
        operator: 'less_than',
        value: 90,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(80);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Resource Attribute Conditions
  // ---------------------------------------------------------------------------
  describe('resource_attribute conditions', () => {
    it('should match sensitivity_level in array', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'sensitivity_level',
        operator: 'in',
        value: ['confidential', 'restricted'],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('confidential');
    });

    it('should match not_exists when resource is absent', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'sensitivity_level',
        operator: 'not_exists',
        value: undefined,
      };
      const ctx = baseContext({ resource: undefined });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });

    it('should not match exists when resource is absent', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'sensitivity_level',
        operator: 'equals',
        value: 'confidential',
      };
      const ctx = baseContext({ resource: undefined });
      const result = evaluator.evaluate(condition, ctx);
      // no resource => operator is 'equals' not 'not_exists', so matched is false
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Composite Conditions
  // ---------------------------------------------------------------------------
  describe('composite conditions', () => {
    it('should match AND when all sub-conditions are true', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'and',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin' },
          { type: 'risk_based', field: 'threat_level', operator: 'equals', value: 'low' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.conditionType).toBe('composite');
    });

    it('should not match AND when one sub-condition is false', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'and',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin' },
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'viewer' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('should match OR when at least one sub-condition is true', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'or',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'viewer' },
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should invert result with NOT operator', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'not',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'viewer' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      // role is 'admin', sub-condition is false, NOT makes it true
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Custom Conditions
  // ---------------------------------------------------------------------------
  describe('custom conditions', () => {
    it('should invoke a registered custom evaluator and return its result', () => {
      const mockEvaluator = vi.fn().mockReturnValue(true);
      evaluator.registerCustomEvaluator('cel', mockEvaluator);

      const condition: PolicyCondition = {
        type: 'custom',
        expression: 'user.role == "admin"',
        language: 'cel',
        params: { extra: 'data' },
      };
      const ctx = baseContext();
      const result = evaluator.evaluate(condition, ctx);

      expect(result.matched).toBe(true);
      expect(result.conditionType).toBe('custom');
      expect(mockEvaluator).toHaveBeenCalledWith(
        'user.role == "admin"',
        'cel',
        ctx,
        { extra: 'data' },
      );
    });

    it('should return error when no evaluator is registered for language', () => {
      const condition: PolicyCondition = {
        type: 'custom',
        expression: 'some.expr',
        language: 'jmespath',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
      expect(result.error).toContain('No evaluator registered for language: jmespath');
    });

    it('should allow unregistering a custom evaluator', () => {
      const mockEvaluator = vi.fn().mockReturnValue(true);
      evaluator.registerCustomEvaluator('cel', mockEvaluator);
      const removed = evaluator.unregisterCustomEvaluator('cel');
      expect(removed).toBe(true);

      const condition: PolicyCondition = {
        type: 'custom',
        expression: 'test',
        language: 'cel',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
      expect(result.error).toContain('No evaluator registered');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Operator Coverage
  // ---------------------------------------------------------------------------
  describe('compareValues operators', () => {
    it('equals should perform deep array equality', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'groups',
        operator: 'equals',
        value: ['devs', 'leads'],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('between should match value within [min, max] inclusive range', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [30, 40],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true); // 35 is in [30, 40]
    });

    it('between should not match value outside range', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [50, 100],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false); // 35 is not in [50, 100]
    });

    it('starts_with should check string prefix', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'path',
        operator: 'starts_with',
        value: '/api',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('ends_with should check string suffix', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'path',
        operator: 'ends_with',
        value: '/data',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('contains should check substring in string', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'user_agent',
        operator: 'contains',
        value: 'TestAgent',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('in operator should check value membership in array', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'department',
        operator: 'in',
        value: ['engineering', 'product', 'design'],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('not_in operator should confirm non-membership', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'department',
        operator: 'not_in',
        value: ['sales', 'marketing'],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. evaluateAll
  // ---------------------------------------------------------------------------
  describe('evaluateAll', () => {
    const trueCondition: PolicyCondition = {
      type: 'user_attribute',
      field: 'role',
      operator: 'equals',
      value: 'admin',
    };
    const falseCondition: PolicyCondition = {
      type: 'user_attribute',
      field: 'role',
      operator: 'equals',
      value: 'viewer',
    };

    it('should return matched=true with AND logic when all conditions pass', () => {
      const { matched, results } = evaluator.evaluateAll(
        [trueCondition, trueCondition],
        baseContext(),
        'and',
      );
      expect(matched).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should short-circuit AND and return matched=false when one condition fails', () => {
      const { matched, results } = evaluator.evaluateAll(
        [falseCondition, trueCondition],
        baseContext(),
        'and',
      );
      expect(matched).toBe(false);
      // Short-circuit: only 1 result evaluated
      expect(results).toHaveLength(1);
    });

    it('should return matched=true with OR logic when at least one passes', () => {
      const { matched, results } = evaluator.evaluateAll(
        [falseCondition, trueCondition],
        baseContext(),
        'or',
      );
      expect(matched).toBe(true);
      // Short-circuit on second hit
      expect(results).toHaveLength(2);
    });

    it('should return matched=false with OR logic when none pass', () => {
      const { matched, results } = evaluator.evaluateAll(
        [falseCondition, falseCondition],
        baseContext(),
        'or',
      );
      expect(matched).toBe(false);
      expect(results).toHaveLength(2);
    });

    it('should invert the first condition result with NOT logic', () => {
      const { matched } = evaluator.evaluateAll(
        [falseCondition],
        baseContext(),
        'not',
      );
      // falseCondition matched=false, NOT inverts to true
      expect(matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. getNestedValue via custom field
  // ---------------------------------------------------------------------------
  describe('getNestedValue via custom field', () => {
    it('should resolve nested user attribute via dot notation', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'custom',
        customField: 'region.code',
        operator: 'equals',
        value: 'US-WEST',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('US-WEST');
    });

    it('should return undefined for missing nested path', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'custom',
        customField: 'nonexistent.deep.path',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Error Handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('should return error for unknown condition type', () => {
      const condition = {
        type: 'unknown_type',
        field: 'anything',
        operator: 'equals',
        value: 'x',
      } as unknown as PolicyCondition;

      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
      expect(result.error).toContain('Unknown condition type');
    });

    it('should catch evaluator errors and return error in result', () => {
      const throwingEvaluator = vi.fn().mockImplementation(() => {
        throw new Error('Evaluator crashed');
      });
      evaluator.registerCustomEvaluator('bad', throwingEvaluator);

      const condition: PolicyCondition = {
        type: 'custom',
        expression: 'boom',
        language: 'custom',
      };
      // language defaults to 'custom' but we registered 'bad', so let's fix:
      evaluator.registerCustomEvaluator('custom', throwingEvaluator);

      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
      expect(result.error).toBe('Evaluator crashed');
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor options
  // ---------------------------------------------------------------------------
  describe('constructor options', () => {
    it('should accept custom evaluators via options', () => {
      const customMap = new Map();
      const mockEval = vi.fn().mockReturnValue(true);
      customMap.set('jsonpath', mockEval);

      const evalWithOpts = new ConditionEvaluator({ customEvaluators: customMap });
      const condition: PolicyCondition = {
        type: 'custom',
        expression: '$.user.role',
        language: 'jsonpath',
      };
      const result = evalWithOpts.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(mockEval).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Untested user_attribute fields
  // ---------------------------------------------------------------------------
  describe('user_attribute field resolution', () => {
    it('should resolve tenant field', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'tenant',
        operator: 'equals',
        value: 'acme',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('acme');
    });

    it('should resolve permissions field', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'permissions',
        operator: 'contains',
        value: 'write',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toEqual(['read', 'write', 'delete']);
    });

    it('should resolve department field', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'department',
        operator: 'equals',
        value: 'engineering',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('engineering');
    });

    it('should return undefined for unknown user_attribute field', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'unknown_field' as any,
        operator: 'exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
      expect(result.actual).toBeUndefined();
    });

    it('should return undefined for custom field without customField', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'custom',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBeUndefined();
    });

    it('should extract email_domain with undefined email', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'email_domain',
        operator: 'not_exists',
        value: undefined,
      };
      const ctx = baseContext({
        user: { id: 'user-1', role: 'admin' },
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Untested request_attribute fields
  // ---------------------------------------------------------------------------
  describe('request_attribute field resolution', () => {
    it('should resolve body field with bodyPath', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'body',
        bodyPath: 'data.name',
        operator: 'equals',
        value: 'test',
      };
      const ctx = baseContext({
        request: baseRequest({ body: { data: { name: 'test' } } }),
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('test');
    });

    it('should resolve body field without bodyPath (entire body)', () => {
      const bodyObj = { key: 'val' };
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'body',
        operator: 'exists',
        value: undefined,
      };
      const ctx = baseContext({
        request: baseRequest({ body: bodyObj }),
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toEqual(bodyObj);
    });

    it('should resolve origin field', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'origin',
        operator: 'equals',
        value: 'https://app.example.com',
      };
      const ctx = baseContext({
        request: baseRequest({ origin: 'https://app.example.com' }),
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('https://app.example.com');
    });

    it('should resolve referer field', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'referer',
        operator: 'starts_with',
        value: 'https://app',
      };
      const ctx = baseContext({
        request: baseRequest({ referer: 'https://app.example.com/page' }),
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });

    it('should resolve custom request field via customField', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'custom',
        customField: 'ip',
        operator: 'equals',
        value: '192.168.1.100',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return undefined for custom field without customField', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'custom',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return undefined for header without headerName', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'header',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return undefined for query without queryParam', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'query',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return undefined for unknown request_attribute field', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'unknown_field' as any,
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Untested time_based fields
  // ---------------------------------------------------------------------------
  describe('time_based field resolution', () => {
    it('should evaluate weekend as true on Sunday (dayOfWeek 0)', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'weekend',
        operator: 'equals',
        value: true,
      };
      const ctx = baseContext({
        environment: {
          timestamp: '2025-06-15T10:00:00.000Z', // Sunday
          timezone: 'UTC',
          dayOfWeek: 0,
          hour: 10,
        },
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(true);
    });

    it('should evaluate day_of_week field', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'day_of_week',
        operator: 'equals',
        value: 3, // Wednesday
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(3);
    });

    it('should evaluate date field', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'date',
        operator: 'equals',
        value: '2025-06-11',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should evaluate holiday field with provider', () => {
      const holidayProvider = vi.fn().mockReturnValue(true);
      const evalWithHoliday = new ConditionEvaluator({
        holidayCalendarProvider: holidayProvider,
      });
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'holiday',
        holidayCalendar: 'us-federal',
        operator: 'equals',
        value: true,
      };
      const result = evalWithHoliday.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(true);
      expect(holidayProvider).toHaveBeenCalledWith('us-federal', expect.any(Date));
    });

    it('should evaluate holiday field without provider using environment', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'holiday',
        operator: 'equals',
        value: true,
      };
      const ctx = baseContext({
        environment: {
          timestamp: '2025-12-25T10:00:00.000Z',
          timezone: 'UTC',
          dayOfWeek: 4,
          hour: 10,
          isHoliday: true,
        },
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(true);
    });

    it('should evaluate holiday field without provider and no isHoliday defaults to false', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'holiday',
        operator: 'equals',
        value: false,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(false);
    });

    it('should evaluate custom time field as undefined/false', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'custom' as any,
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.actual).toBeUndefined();
    });

    it('should evaluate business_hours with custom startHour/endHour', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'business_hours',
        operator: 'equals',
        value: false,
        startHour: 8,
        endHour: 12,
      };
      // hour=14 is outside 8-12 range
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(false);
    });

    it('should evaluate business_hours with custom daysOfWeek', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'business_hours',
        operator: 'equals',
        value: false,
        daysOfWeek: [1, 2], // Mon, Tue only — Wed excluded
      };
      // baseContext is Wednesday (dayOfWeek=3)
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(false);
    });

    it('should use current date when no timestamp in environment', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'hour',
        operator: 'greater_than_or_equal',
        value: 0,
      };
      const ctx = baseContext({ environment: undefined });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });

    it('should use condition timezone over environment timezone', () => {
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'hour',
        operator: 'greater_than_or_equal',
        value: 0,
        timezone: 'America/New_York',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should use defaultTimezone when none specified', () => {
      const evalWithTz = new ConditionEvaluator({ defaultTimezone: 'America/Chicago' });
      const condition: PolicyCondition = {
        type: 'time_based',
        field: 'hour',
        operator: 'greater_than_or_equal',
        value: 0,
      };
      const ctx = baseContext({ environment: { timestamp: '2025-06-11T14:30:00.000Z', timezone: undefined as any, dayOfWeek: 3, hour: 14 } });
      const result = evalWithTz.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Untested risk_based fields
  // ---------------------------------------------------------------------------
  describe('risk_based field resolution', () => {
    it('should resolve device_trust', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'device_trust',
        operator: 'greater_than',
        value: 50,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(70);
    });

    it('should resolve session_risk', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'session_risk',
        operator: 'less_than',
        value: 50,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(20);
    });

    it('should resolve anomaly_score', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'anomaly_score',
        operator: 'less_than',
        value: 30,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(15);
    });

    it('should resolve custom risk field via customField', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'custom',
        customField: 'userRiskScore',
        operator: 'equals',
        value: 35,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(35);
    });

    it('should return undefined for custom risk field without customField', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'custom',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should fallback to user.riskScore when risk is undefined', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'equals',
        value: 42,
      };
      const ctx = baseContext({
        risk: undefined,
        user: { id: 'user-1', riskScore: 42 },
      });
      const result = evaluator.evaluate(condition, ctx);
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(42);
    });

    it('should return undefined for unknown risk_based field', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'unknown_field' as any,
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Untested resource_attribute fields
  // ---------------------------------------------------------------------------
  describe('resource_attribute field resolution', () => {
    it('should resolve data_type', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'data_type',
        operator: 'equals',
        value: 'pii',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('pii');
    });

    it('should resolve classification', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'classification',
        operator: 'equals',
        value: 'internal',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('internal');
    });

    it('should resolve owner', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'owner',
        operator: 'equals',
        value: 'bob',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('bob');
    });

    it('should resolve department', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'department',
        operator: 'equals',
        value: 'hr',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('hr');
    });

    it('should resolve region', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'region',
        operator: 'equals',
        value: 'us-east-1',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe('us-east-1');
    });

    it('should resolve tags', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'tags',
        operator: 'contains',
        value: 'gdpr',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toEqual(['sensitive', 'gdpr']);
    });

    it('should resolve custom resource field via customField', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'custom',
        customField: 'retention.days',
        operator: 'equals',
        value: 90,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
      expect(result.actual).toBe(90);
    });

    it('should return undefined for custom field without customField', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'custom',
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return undefined for unknown resource_attribute field', () => {
      const condition: PolicyCondition = {
        type: 'resource_attribute',
        field: 'unknown_field' as any,
        operator: 'not_exists',
        value: undefined,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 17. Operator boundary tests (mutation-killing)
  // ---------------------------------------------------------------------------
  describe('operator boundary tests', () => {
    it('less_than_or_equal should match when values are equal', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'less_than_or_equal',
        value: 35, // exact match
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('less_than_or_equal should not match when actual > expected', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'less_than_or_equal',
        value: 34, // just below
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('greater_than should not match when values are equal', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'greater_than',
        value: 35, // exact match
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('less_than should not match when values are equal', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'less_than',
        value: 35, // exact match
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('greater_than_or_equal should match when values are equal', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'greater_than_or_equal',
        value: 35, // exact match
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('greater_than_or_equal should not match when actual < expected', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'greater_than_or_equal',
        value: 36, // just above
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('between should match at exact min boundary', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [35, 40], // exact min boundary
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('between should match at exact max boundary', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [30, 35], // exact max boundary
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('between should not match just outside min boundary', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [36, 40], // just above
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('between should return false for non-number actual', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'between',
        value: [0, 100],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('between should return false for non-array expected', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: 50, // not an array
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('between should return false when expected has wrong length', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'between',
        value: [10], // only one element
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('not_contains should return true when string does not contain substring', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'user_agent',
        operator: 'not_contains',
        value: 'Bot',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('not_contains should return false when string contains substring', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'user_agent',
        operator: 'not_contains',
        value: 'TestAgent',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('matches should return false for invalid regex pattern', () => {
      const condition: PolicyCondition = {
        type: 'request_attribute',
        field: 'path',
        operator: 'matches',
        value: '[invalid',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('matches should return false for non-string actual', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'matches',
        value: '\\d+',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('starts_with should return false when actual is not a string', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'groups',
        operator: 'starts_with',
        value: 'dev',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('ends_with should return false when actual is not a string', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'groups',
        operator: 'ends_with',
        value: 'leads',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('greater_than should return false for non-number values', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'greater_than',
        value: 5,
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('in should return false for non-array expected', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'in',
        value: 'admin', // not an array
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('not_in should return true for non-array expected (because isIn returns false)', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'not_in',
        value: 'admin', // not an array
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('unknown operator should return false', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'invalid_op' as any,
        value: 'admin',
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Deep equality edge cases
  // ---------------------------------------------------------------------------
  describe('equals deep comparison', () => {
    it('should return false for different types', () => {
      const condition: PolicyCondition = {
        type: 'risk_based',
        field: 'user_risk_score',
        operator: 'equals',
        value: '35', // string, not number
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('should return false for arrays of different length', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'groups',
        operator: 'equals',
        value: ['devs'], // length 1 vs length 2
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('should compare nested objects deeply', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'custom',
        customField: 'region',
        operator: 'equals',
        value: { code: 'US-WEST' },
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });

    it('should return false for objects with different number of keys', () => {
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'custom',
        customField: 'region',
        operator: 'equals',
        value: { code: 'US-WEST', extra: true },
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 19. Composite logic edge cases
  // ---------------------------------------------------------------------------
  describe('composite edge cases', () => {
    it('should handle NOT with empty conditions (returns true)', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'not',
        conditions: [],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(true); // results.length === 0 ? true
    });

    it('should handle unknown composite operator (returns false)', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'xor' as any,
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });

    it('should handle OR with all false sub-conditions', () => {
      const condition: PolicyCondition = {
        type: 'composite',
        operator: 'or',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'viewer' },
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'editor' },
        ],
      };
      const result = evaluator.evaluate(condition, baseContext());
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 20. evaluateAll edge cases
  // ---------------------------------------------------------------------------
  describe('evaluateAll edge cases', () => {
    it('should handle empty conditions array with AND (returns true)', () => {
      const { matched, results } = evaluator.evaluateAll([], baseContext(), 'and');
      expect(matched).toBe(true);
      expect(results).toHaveLength(0);
    });

    it('should handle empty conditions array with OR (returns false)', () => {
      const { matched, results } = evaluator.evaluateAll([], baseContext(), 'or');
      expect(matched).toBe(false);
      expect(results).toHaveLength(0);
    });

    it('should short-circuit OR on first match', () => {
      const trueCondition: PolicyCondition = {
        type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin',
      };
      const falseCondition: PolicyCondition = {
        type: 'user_attribute', field: 'role', operator: 'equals', value: 'viewer',
      };
      const { matched, results } = evaluator.evaluateAll(
        [trueCondition, falseCondition],
        baseContext(),
        'or',
      );
      expect(matched).toBe(true);
      expect(results).toHaveLength(1); // short-circuited
    });
  });

  // ---------------------------------------------------------------------------
  // 21. Unregister non-existent evaluator
  // ---------------------------------------------------------------------------
  describe('unregisterCustomEvaluator', () => {
    it('should return false when removing non-existent evaluator', () => {
      expect(evaluator.unregisterCustomEvaluator('nonexistent')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 22. createConditionEvaluator factory
  // ---------------------------------------------------------------------------
  describe('createConditionEvaluator', () => {
    it('should create a working instance via factory function', async () => {
      const { createConditionEvaluator } = await import('../condition-evaluator.js');
      const eval2 = createConditionEvaluator();
      const condition: PolicyCondition = {
        type: 'user_attribute',
        field: 'role',
        operator: 'equals',
        value: 'admin',
      };
      const result = eval2.evaluate(condition, baseContext());
      expect(result.matched).toBe(true);
    });
  });
});
