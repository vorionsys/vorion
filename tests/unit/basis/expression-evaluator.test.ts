/**
 * BASIS Expression Evaluator Tests
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  validateExpression,
  evaluateExpressionDetailed,
  ExpressionError,
} from '../../../src/basis/expression-evaluator.js';
import type { EvaluationContext } from '../../../src/basis/types.js';

/**
 * Create a test context with customizable values
 */
function createContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    intent: {
      id: 'int_123',
      type: 'file_write',
      goal: 'Write to config file',
      context: {
        filename: 'config.json',
        size: 1024,
        sensitive: true,
      },
    },
    entity: {
      id: 'ent_456',
      type: 'agent',
      trustScore: 500,
      trustLevel: 3,
      attributes: {
        verified: true,
        role: 'developer',
        permissions: ['read', 'write'],
      },
    },
    environment: {
      timestamp: '2024-01-15T10:30:00Z',
      timezone: 'UTC',
      requestId: 'req_789',
    },
    custom: {
      override: false,
      threshold: 100,
      tags: ['important', 'production'],
    },
    ...overrides,
  };
}

describe('ExpressionEvaluator', () => {
  describe('Literal values', () => {
    const context = createContext();

    it('should evaluate true literal', () => {
      expect(evaluateExpression('true', context)).toBe(true);
      expect(evaluateExpression('TRUE', context)).toBe(true);
      expect(evaluateExpression('True', context)).toBe(true);
    });

    it('should evaluate false literal', () => {
      expect(evaluateExpression('false', context)).toBe(false);
      expect(evaluateExpression('FALSE', context)).toBe(false);
      expect(evaluateExpression('False', context)).toBe(false);
    });

    it('should handle numeric literals', () => {
      expect(evaluateExpression('42 == 42', context)).toBe(true);
      expect(evaluateExpression('3.14 > 3', context)).toBe(true);
      expect(evaluateExpression('-5 < 0', context)).toBe(true);
    });

    it('should handle string literals', () => {
      expect(evaluateExpression('"hello" == "hello"', context)).toBe(true);
      expect(evaluateExpression("'world' == 'world'", context)).toBe(true);
      expect(evaluateExpression('"hello" != "world"', context)).toBe(true);
    });

    it('should handle escaped characters in strings', () => {
      expect(evaluateExpression('"line1\\nline2" == "line1\\nline2"', context)).toBe(true);
      expect(evaluateExpression("'tab\\there' == 'tab\\there'", context)).toBe(true);
    });
  });

  describe('Variable resolution', () => {
    const context = createContext();

    it('should resolve simple variables', () => {
      expect(evaluateExpression('entity.trustLevel == 3', context)).toBe(true);
      expect(evaluateExpression('entity.trustScore >= 500', context)).toBe(true);
    });

    it('should resolve nested variables', () => {
      expect(evaluateExpression('intent.context.filename == "config.json"', context)).toBe(true);
      expect(evaluateExpression('entity.attributes.verified == true', context)).toBe(true);
      expect(evaluateExpression('entity.attributes.role == "developer"', context)).toBe(true);
    });

    it('should handle undefined variables as undefined', () => {
      expect(evaluateExpression('exists(entity.nonexistent)', context)).toBe(false);
      // Use NOT exists() to check for undefined values - "undefined" as a literal is an identifier
      expect(evaluateExpression('NOT exists(entity.nonexistent)', context)).toBe(true);
    });

    it('should resolve custom context variables', () => {
      expect(evaluateExpression('custom.override == false', context)).toBe(true);
      expect(evaluateExpression('custom.threshold == 100', context)).toBe(true);
    });
  });

  describe('Comparison operators', () => {
    const context = createContext();

    it('should evaluate equality', () => {
      expect(evaluateExpression('entity.trustLevel == 3', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel == 4', context)).toBe(false);
    });

    it('should evaluate inequality', () => {
      expect(evaluateExpression('entity.trustLevel != 4', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel != 3', context)).toBe(false);
    });

    it('should evaluate less than', () => {
      expect(evaluateExpression('entity.trustLevel < 5', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel < 3', context)).toBe(false);
      expect(evaluateExpression('entity.trustLevel < 2', context)).toBe(false);
    });

    it('should evaluate greater than', () => {
      expect(evaluateExpression('entity.trustLevel > 2', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel > 3', context)).toBe(false);
      expect(evaluateExpression('entity.trustLevel > 5', context)).toBe(false);
    });

    it('should evaluate less than or equal', () => {
      expect(evaluateExpression('entity.trustLevel <= 3', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel <= 5', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel <= 2', context)).toBe(false);
    });

    it('should evaluate greater than or equal', () => {
      expect(evaluateExpression('entity.trustLevel >= 3', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel >= 1', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel >= 5', context)).toBe(false);
    });
  });

  describe('Logical operators', () => {
    const context = createContext();

    it('should evaluate AND with keywords', () => {
      expect(evaluateExpression('true AND true', context)).toBe(true);
      expect(evaluateExpression('true AND false', context)).toBe(false);
      expect(evaluateExpression('false AND true', context)).toBe(false);
      expect(evaluateExpression('false AND false', context)).toBe(false);
    });

    it('should evaluate AND with symbols', () => {
      expect(evaluateExpression('true && true', context)).toBe(true);
      expect(evaluateExpression('true && false', context)).toBe(false);
    });

    it('should evaluate OR with keywords', () => {
      expect(evaluateExpression('true OR true', context)).toBe(true);
      expect(evaluateExpression('true OR false', context)).toBe(true);
      expect(evaluateExpression('false OR true', context)).toBe(true);
      expect(evaluateExpression('false OR false', context)).toBe(false);
    });

    it('should evaluate OR with symbols', () => {
      expect(evaluateExpression('true || false', context)).toBe(true);
      expect(evaluateExpression('false || false', context)).toBe(false);
    });

    it('should evaluate NOT with keyword', () => {
      expect(evaluateExpression('NOT true', context)).toBe(false);
      expect(evaluateExpression('NOT false', context)).toBe(true);
    });

    it('should evaluate NOT with symbol', () => {
      expect(evaluateExpression('!true', context)).toBe(false);
      expect(evaluateExpression('!false', context)).toBe(true);
    });

    it('should handle complex logical expressions', () => {
      expect(
        evaluateExpression(
          'entity.trustLevel >= 3 AND entity.attributes.verified == true',
          context
        )
      ).toBe(true);

      expect(
        evaluateExpression(
          'entity.trustLevel < 2 OR entity.attributes.verified == true',
          context
        )
      ).toBe(true);

      expect(
        evaluateExpression(
          'NOT (entity.trustLevel < 2)',
          context
        )
      ).toBe(true);
    });

    it('should short-circuit AND evaluation', () => {
      // If first is false, second should not be evaluated
      expect(evaluateExpression('false AND (1/0 > 0)', context)).toBe(false);
    });

    it('should short-circuit OR evaluation', () => {
      // If first is true, second should not be evaluated
      expect(evaluateExpression('true OR (1/0 > 0)', context)).toBe(true);
    });
  });

  describe('Arithmetic operators', () => {
    const context = createContext();

    it('should evaluate addition', () => {
      expect(evaluateExpression('5 + 3 == 8', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel + 2 == 5', context)).toBe(true);
    });

    it('should evaluate subtraction', () => {
      expect(evaluateExpression('10 - 3 == 7', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel - 1 == 2', context)).toBe(true);
    });

    it('should evaluate multiplication', () => {
      expect(evaluateExpression('4 * 3 == 12', context)).toBe(true);
      expect(evaluateExpression('entity.trustLevel * 2 == 6', context)).toBe(true);
    });

    it('should evaluate division', () => {
      expect(evaluateExpression('12 / 4 == 3', context)).toBe(true);
      expect(evaluateExpression('entity.trustScore / 100 == 5', context)).toBe(true);
    });

    it('should evaluate modulo', () => {
      expect(evaluateExpression('10 % 3 == 1', context)).toBe(true);
      expect(evaluateExpression('entity.trustScore % 100 == 0', context)).toBe(true);
    });

    it('should handle string concatenation', () => {
      expect(evaluateExpression('"hello" + " " + "world" == "hello world"', context)).toBe(true);
    });

    it('should respect operator precedence', () => {
      // Multiplication before addition
      expect(evaluateExpression('2 + 3 * 4 == 14', context)).toBe(true);
      // Division before subtraction
      expect(evaluateExpression('10 - 6 / 2 == 7', context)).toBe(true);
    });

    it('should throw on division by zero', () => {
      expect(() => evaluateExpression('10 / 0', context)).toThrow('Division by zero');
    });

    it('should throw on modulo by zero', () => {
      expect(() => evaluateExpression('10 % 0', context)).toThrow('Modulo by zero');
    });
  });

  describe('String functions', () => {
    const context = createContext();

    it('should evaluate contains()', () => {
      expect(evaluateExpression('contains(intent.goal, "config")', context)).toBe(true);
      expect(evaluateExpression('contains(intent.goal, "delete")', context)).toBe(false);
    });

    it('should evaluate startsWith()', () => {
      expect(evaluateExpression('startsWith(intent.goal, "Write")', context)).toBe(true);
      expect(evaluateExpression('startsWith(intent.goal, "Read")', context)).toBe(false);
    });

    it('should evaluate endsWith()', () => {
      expect(evaluateExpression('endsWith(intent.context.filename, ".json")', context)).toBe(true);
      expect(evaluateExpression('endsWith(intent.context.filename, ".txt")', context)).toBe(false);
    });

    it('should evaluate matches() with regex', () => {
      expect(evaluateExpression('matches(intent.context.filename, "^config\\\\.")', context)).toBe(true);
      expect(evaluateExpression('matches(intent.context.filename, "^settings\\\\.")', context)).toBe(false);
    });

    it('should throw on invalid regex', () => {
      expect(() => evaluateExpression('matches("test", "[")', context)).toThrow('Invalid regex');
    });

    it('should evaluate length()', () => {
      expect(evaluateExpression('length("hello") == 5', context)).toBe(true);
      expect(evaluateExpression('length(entity.attributes.role) == 9', context)).toBe(true);
    });

    it('should evaluate lower()', () => {
      expect(evaluateExpression('lower("HELLO") == "hello"', context)).toBe(true);
    });

    it('should evaluate upper()', () => {
      expect(evaluateExpression('upper("hello") == "HELLO"', context)).toBe(true);
    });

    it('should evaluate trim()', () => {
      expect(evaluateExpression('trim("  hello  ") == "hello"', context)).toBe(true);
    });
  });

  describe('Utility functions', () => {
    const context = createContext();

    it('should evaluate exists()', () => {
      expect(evaluateExpression('exists(entity.trustLevel)', context)).toBe(true);
      expect(evaluateExpression('exists(entity.nonexistent)', context)).toBe(false);
    });

    it('should evaluate isEmpty()', () => {
      const emptyContext = createContext({
        custom: { emptyString: '', emptyArray: [], emptyObject: {} },
      });
      expect(evaluateExpression('isEmpty("")', emptyContext)).toBe(true);
      expect(evaluateExpression('isEmpty("hello")', emptyContext)).toBe(false);
      expect(evaluateExpression('isEmpty(custom.emptyString)', emptyContext)).toBe(true);
    });

    it('should evaluate typeof()', () => {
      expect(evaluateExpression('typeof(entity.trustLevel) == "number"', context)).toBe(true);
      expect(evaluateExpression('typeof(entity.attributes.verified) == "boolean"', context)).toBe(true);
      expect(evaluateExpression('typeof(entity.attributes.role) == "string"', context)).toBe(true);
    });

    it('should evaluate abs()', () => {
      expect(evaluateExpression('abs(-5) == 5', context)).toBe(true);
      expect(evaluateExpression('abs(5) == 5', context)).toBe(true);
    });

    it('should evaluate min()', () => {
      expect(evaluateExpression('min(5, 3, 8, 1) == 1', context)).toBe(true);
    });

    it('should evaluate max()', () => {
      expect(evaluateExpression('max(5, 3, 8, 1) == 8', context)).toBe(true);
    });
  });

  describe('Parentheses and precedence', () => {
    const context = createContext();

    it('should respect parentheses', () => {
      expect(evaluateExpression('(2 + 3) * 4 == 20', context)).toBe(true);
      expect(evaluateExpression('2 + (3 * 4) == 14', context)).toBe(true);
    });

    it('should handle nested parentheses', () => {
      expect(evaluateExpression('((2 + 3) * (4 - 2)) == 10', context)).toBe(true);
    });

    it('should handle complex expressions with proper precedence', () => {
      // NOT has higher precedence than AND
      expect(evaluateExpression('NOT false AND true', context)).toBe(true);
      // AND has higher precedence than OR
      expect(evaluateExpression('false OR true AND true', context)).toBe(true);
      expect(evaluateExpression('(false OR true) AND false', context)).toBe(false);
    });
  });

  describe('Complex real-world expressions', () => {
    it('should evaluate trust-based access control', () => {
      const context = createContext();

      // High trust agents can write to sensitive files
      expect(
        evaluateExpression(
          'entity.trustLevel >= 3 AND intent.context.sensitive == true',
          context
        )
      ).toBe(true);

      // Low trust context
      const lowTrustContext = createContext({
        entity: { ...createContext().entity, trustLevel: 1, trustScore: 100 },
      });

      expect(
        evaluateExpression(
          'entity.trustLevel >= 3 AND intent.context.sensitive == true',
          lowTrustContext
        )
      ).toBe(false);
    });

    it('should evaluate file operation rules', () => {
      const context = createContext();

      // Block delete operations on config files
      expect(
        evaluateExpression(
          'contains(intent.goal, "delete") AND endsWith(intent.context.filename, ".json")',
          context
        )
      ).toBe(false);

      // Allow write if verified
      expect(
        evaluateExpression(
          'intent.type == "file_write" AND entity.attributes.verified == true',
          context
        )
      ).toBe(true);
    });

    it('should evaluate with custom overrides', () => {
      const context = createContext({
        custom: { override: true, threshold: 100 },
      });

      // Override allows any operation
      expect(
        evaluateExpression(
          'custom.override == true OR entity.trustLevel >= 5',
          context
        )
      ).toBe(true);
    });
  });

  describe('Error handling', () => {
    const context = createContext();

    it('should throw on empty expression', () => {
      expect(() => evaluateExpression('', context)).toThrow('non-empty string');
    });

    it('should throw on invalid syntax', () => {
      expect(() => evaluateExpression('entity.trustLevel ===', context)).toThrow();
    });

    it('should throw on unclosed parentheses', () => {
      expect(() => evaluateExpression('(true AND false', context)).toThrow();
    });

    it('should throw on unknown function', () => {
      expect(() => evaluateExpression('unknownFunc(5)', context)).toThrow('Unknown function');
    });

    it('should throw on unterminated string', () => {
      expect(() => evaluateExpression('"unclosed string', context)).toThrow('Unterminated string');
    });

    it('should throw on unexpected character', () => {
      expect(() => evaluateExpression('5 @ 3', context)).toThrow('Unexpected character');
    });
  });

  describe('Security limits', () => {
    const context = createContext();

    it('should enforce maximum expression length', () => {
      const longExpression = 'true' + ' AND true'.repeat(200);
      expect(() =>
        evaluateExpression(longExpression, context, { maxLength: 100 })
      ).toThrow('maximum length');
    });

    it('should enforce maximum nesting depth', () => {
      // Create deeply nested expression
      let deepExpression = 'true';
      for (let i = 0; i < 15; i++) {
        deepExpression = `(${deepExpression})`;
      }

      expect(() =>
        evaluateExpression(deepExpression, context, { maxDepth: 5 })
      ).toThrow('nesting depth');
    });
  });

  describe('validateExpression', () => {
    it('should return valid for correct expressions', () => {
      const result = validateExpression('entity.trustLevel >= 3 AND true');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid for empty expressions', () => {
      const result = validateExpression('');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return invalid for syntax errors', () => {
      const result = validateExpression('entity.trustLevel >=');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('evaluateExpressionDetailed', () => {
    const context = createContext();

    it('should return detailed success result', () => {
      const result = evaluateExpressionDetailed('entity.trustLevel + 2', context);
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
      expect(result.booleanResult).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return detailed error result', () => {
      const result = evaluateExpressionDetailed('unknownFunc()', context);
      expect(result.success).toBe(false);
      expect(result.booleanResult).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
