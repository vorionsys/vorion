import { describe, it, expect } from 'vitest';
import {
  parseNamespace,
  validateRule,
  validateNamespace,
} from '../src/basis/parser.js';

describe('validateRule', () => {
  it('validates a well-formed rule', () => {
    const result = validateRule({
      id: 'rule-1',
      name: 'Test Rule',
      description: 'A test rule',
      priority: 100,
      enabled: true,
      when: {
        intentType: 'execute',
        conditions: [
          { field: 'risk.level', operator: 'greater_than', value: 5 },
        ],
      },
      evaluate: [
        { condition: 'risk.level > 5', result: 'deny', reason: 'High risk' },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates minimal rule (uses defaults)', () => {
    const result = validateRule({
      id: 'rule-2',
      name: 'Minimal Rule',
      when: {},
      evaluate: [
        { condition: 'true', result: 'allow' },
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('rejects rule without id', () => {
    const result = validateRule({
      name: 'No ID',
      when: {},
      evaluate: [{ condition: 'true', result: 'allow' }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects rule without name', () => {
    const result = validateRule({
      id: 'rule-3',
      when: {},
      evaluate: [{ condition: 'true', result: 'allow' }],
    });

    expect(result.valid).toBe(false);
  });

  it('rejects rule without evaluate', () => {
    const result = validateRule({
      id: 'rule-4',
      name: 'No evaluate',
      when: {},
    });

    expect(result.valid).toBe(false);
  });

  it('rejects invalid condition operator', () => {
    const result = validateRule({
      id: 'rule-5',
      name: 'Bad operator',
      when: {
        conditions: [
          { field: 'x', operator: 'invalid_op', value: 1 },
        ],
      },
      evaluate: [{ condition: 'true', result: 'allow' }],
    });

    expect(result.valid).toBe(false);
  });

  it('rejects invalid result value', () => {
    const result = validateRule({
      id: 'rule-6',
      name: 'Bad result',
      when: {},
      evaluate: [{ condition: 'true', result: 'invalid' }],
    });

    expect(result.valid).toBe(false);
  });

  it('validates all valid result types', () => {
    const resultTypes = ['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate'];
    for (const resultType of resultTypes) {
      const result = validateRule({
        id: `rule-${resultType}`,
        name: `${resultType} rule`,
        when: {},
        evaluate: [{ condition: 'true', result: resultType }],
      });
      expect(result.valid).toBe(true);
    }
  });

  it('validates all valid condition operators', () => {
    const operators = [
      'equals', 'not_equals', 'greater_than', 'less_than',
      'greater_than_or_equal', 'less_than_or_equal',
      'in', 'not_in', 'contains', 'not_contains',
      'matches', 'exists', 'not_exists',
    ];
    for (const op of operators) {
      const result = validateRule({
        id: `rule-${op}`,
        name: `${op} rule`,
        when: {
          conditions: [{ field: 'x', operator: op, value: 1 }],
        },
        evaluate: [{ condition: 'true', result: 'allow' }],
      });
      expect(result.valid).toBe(true);
    }
  });

  it('validates escalation config', () => {
    const result = validateRule({
      id: 'rule-esc',
      name: 'Escalation rule',
      when: {},
      evaluate: [{
        condition: 'risk > 8',
        result: 'escalate',
        reason: 'High risk requires approval',
        escalation: {
          to: 'admin',
          timeout: '1h',
          requireJustification: true,
          autoDenyOnTimeout: true,
        },
      }],
    });

    expect(result.valid).toBe(true);
  });
});

describe('validateNamespace', () => {
  it('validates a well-formed namespace', () => {
    const result = validateNamespace({
      namespace: 'finance',
      description: 'Finance rules',
      version: '1.0.0',
      rules: [
        {
          id: 'rule-1',
          name: 'Test',
          when: {},
          evaluate: [{ condition: 'true', result: 'allow' }],
        },
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('validates namespace with defaults', () => {
    const result = validateNamespace({
      namespace: 'minimal',
      rules: [],
    });

    expect(result.valid).toBe(true);
  });

  it('rejects namespace without name', () => {
    const result = validateNamespace({
      rules: [],
    });

    expect(result.valid).toBe(false);
  });

  it('rejects namespace with invalid rules', () => {
    const result = validateNamespace({
      namespace: 'bad',
      rules: [{ invalid: true }],
    });

    expect(result.valid).toBe(false);
  });
});

describe('parseNamespace', () => {
  it('parses a valid namespace definition', () => {
    const ns = parseNamespace({
      namespace: 'test-ns',
      description: 'Test namespace',
      version: '2.0.0',
      rules: [
        {
          id: 'rule-1',
          name: 'Test Rule',
          description: 'A test',
          priority: 50,
          enabled: true,
          when: {
            intentType: 'execute',
            conditions: [
              { field: 'amount', operator: 'greater_than', value: 1000 },
            ],
          },
          evaluate: [
            { condition: 'amount > 1000', result: 'escalate', reason: 'Large amount' },
          ],
        },
      ],
    });

    expect(ns.name).toBe('test-ns');
    expect(ns.description).toBe('Test namespace');
    expect(ns.version).toBe('2.0.0');
    expect(ns.rules).toHaveLength(1);
    expect(ns.rules[0].id).toBe('rule-1');
    expect(ns.rules[0].name).toBe('Test Rule');
    expect(ns.rules[0].priority).toBe(50);
    expect(ns.rules[0].enabled).toBe(true);
    expect(ns.rules[0].when.intentType).toBe('execute');
    expect(ns.rules[0].when.conditions).toHaveLength(1);
    expect(ns.rules[0].evaluate).toHaveLength(1);
    expect(ns.rules[0].evaluate[0].result).toBe('escalate');
    expect(ns.id).toBeTruthy(); // auto-generated UUID
    expect(ns.createdAt).toBeTruthy();
    expect(ns.updatedAt).toBeTruthy();
  });

  it('uses defaults for missing optional fields', () => {
    const ns = parseNamespace({
      namespace: 'defaults',
      rules: [
        {
          id: 'r1',
          name: 'R1',
          when: {},
          evaluate: [{ condition: 'true', result: 'allow' }],
        },
      ],
    });

    expect(ns.description).toBe('');
    expect(ns.version).toBe('1.0.0');
    expect(ns.rules[0].description).toBe('');
    expect(ns.rules[0].priority).toBe(100);
    expect(ns.rules[0].enabled).toBe(true);
  });

  it('throws on invalid namespace definition', () => {
    expect(() => parseNamespace({ invalid: true })).toThrow();
    expect(() => parseNamespace(null)).toThrow();
  });

  it('parses rules with multiple intent types', () => {
    const ns = parseNamespace({
      namespace: 'multi',
      rules: [
        {
          id: 'r1',
          name: 'Multi intent',
          when: { intentType: ['read', 'write', 'execute'] },
          evaluate: [{ condition: 'true', result: 'allow' }],
        },
      ],
    });

    expect(ns.rules[0].when.intentType).toEqual(['read', 'write', 'execute']);
  });
});
