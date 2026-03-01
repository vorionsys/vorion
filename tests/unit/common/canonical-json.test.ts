/**
 * Tests for Canonical JSON Serialization
 *
 * Verifies deterministic JSON output for cryptographic hash calculations.
 */

import { describe, it, expect } from 'vitest';
import { canonicalize, canonicalEquals, canonicalizeForHash } from '../../../src/common/canonical-json.js';

describe('canonicalize', () => {
  describe('key ordering', () => {
    it('should sort top-level object keys alphabetically', () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, m: 3, z: 1 };
      const obj3 = { m: 3, z: 1, a: 2 };

      const result1 = canonicalize(obj1);
      const result2 = canonicalize(obj2);
      const result3 = canonicalize(obj3);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should sort nested object keys recursively', () => {
      const obj1 = { z: { y: 1, x: 2 }, a: { c: 3, b: 4 } };
      const obj2 = { a: { b: 4, c: 3 }, z: { x: 2, y: 1 } };

      const result1 = canonicalize(obj1);
      const result2 = canonicalize(obj2);

      expect(result1).toBe(result2);
      expect(result1).toBe('{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}');
    });

    it('should sort deeply nested objects', () => {
      const obj = {
        level1: {
          z: {
            deep: {
              value: 1,
              another: 2,
            },
          },
          a: 'first',
        },
      };

      const result = canonicalize(obj);
      expect(result).toBe('{"level1":{"a":"first","z":{"deep":{"another":2,"value":1}}}}');
    });
  });

  describe('array handling', () => {
    it('should preserve array order (not sort array elements)', () => {
      const obj = { items: [3, 1, 2] };
      const result = canonicalize(obj);
      expect(result).toBe('{"items":[3,1,2]}');
    });

    it('should sort keys within objects inside arrays', () => {
      const obj = {
        items: [
          { z: 1, a: 2 },
          { y: 3, b: 4 },
        ],
      };
      const result = canonicalize(obj);
      expect(result).toBe('{"items":[{"a":2,"z":1},{"b":4,"y":3}]}');
    });

    it('should handle nested arrays', () => {
      const obj = { matrix: [[1, 2], [3, 4]] };
      const result = canonicalize(obj);
      expect(result).toBe('{"matrix":[[1,2],[3,4]]}');
    });
  });

  describe('special values', () => {
    it('should handle null values', () => {
      const obj = { b: null, a: 1 };
      const result = canonicalize(obj);
      expect(result).toBe('{"a":1,"b":null}');
    });

    it('should handle undefined values (excluded by JSON.stringify)', () => {
      const obj = { b: undefined, a: 1 };
      const result = canonicalize(obj);
      expect(result).toBe('{"a":1}');
    });

    it('should handle empty objects', () => {
      expect(canonicalize({})).toBe('{}');
    });

    it('should handle empty arrays', () => {
      expect(canonicalize([])).toBe('[]');
    });

    it('should handle boolean values', () => {
      const obj = { z: true, a: false };
      const result = canonicalize(obj);
      expect(result).toBe('{"a":false,"z":true}');
    });

    it('should handle number types', () => {
      const obj = { float: 3.14, integer: 42, negative: -1 };
      const result = canonicalize(obj);
      expect(result).toBe('{"float":3.14,"integer":42,"negative":-1}');
    });

    it('should handle string values with special characters', () => {
      const obj = { text: 'hello\nworld\t"quoted"' };
      const result = canonicalize(obj);
      expect(result).toBe('{"text":"hello\\nworld\\t\\"quoted\\""}');
    });
  });

  describe('deterministic output', () => {
    it('should produce identical output for equivalent objects created differently', () => {
      // Object created with literal
      const obj1 = { id: '123', data: { name: 'test', value: 42 } };

      // Object created by assignment in different order
      const obj2: Record<string, unknown> = {};
      obj2.data = { value: 42, name: 'test' };
      obj2.id = '123';

      // Object created with Object.assign
      const obj3 = Object.assign({}, { data: { value: 42, name: 'test' } }, { id: '123' });

      expect(canonicalize(obj1)).toBe(canonicalize(obj2));
      expect(canonicalize(obj2)).toBe(canonicalize(obj3));
    });

    it('should produce consistent output across multiple calls', () => {
      const obj = { timestamp: '2024-01-01', data: { nested: true } };

      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(canonicalize(obj));
      }

      expect(new Set(results).size).toBe(1);
    });
  });

  describe('proof-like structures', () => {
    it('should consistently serialize proof data structures', () => {
      const proofData1 = {
        id: 'proof-123',
        chainPosition: 5,
        intentId: 'intent-456',
        entityId: 'entity-789',
        decision: { allowed: true, reason: 'Policy match' },
        inputs: { request: 'data', context: { user: 'test' } },
        outputs: { result: 'approved' },
        previousHash: 'abc123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      // Same data with different key order
      const proofData2 = {
        createdAt: '2024-01-01T00:00:00.000Z',
        previousHash: 'abc123',
        outputs: { result: 'approved' },
        inputs: { context: { user: 'test' }, request: 'data' },
        decision: { reason: 'Policy match', allowed: true },
        entityId: 'entity-789',
        intentId: 'intent-456',
        chainPosition: 5,
        id: 'proof-123',
      };

      expect(canonicalize(proofData1)).toBe(canonicalize(proofData2));
    });
  });
});

describe('canonicalEquals', () => {
  it('should return true for canonically equal objects', () => {
    const obj1 = { b: 1, a: 2 };
    const obj2 = { a: 2, b: 1 };
    expect(canonicalEquals(obj1, obj2)).toBe(true);
  });

  it('should return false for different objects', () => {
    const obj1 = { a: 1 };
    const obj2 = { a: 2 };
    expect(canonicalEquals(obj1, obj2)).toBe(false);
  });

  it('should handle nested object comparison', () => {
    const obj1 = { outer: { z: 1, a: 2 } };
    const obj2 = { outer: { a: 2, z: 1 } };
    expect(canonicalEquals(obj1, obj2)).toBe(true);
  });
});

describe('canonicalizeForHash', () => {
  it('should return a Uint8Array', () => {
    const result = canonicalizeForHash({ test: 1 });
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('should produce consistent byte output', () => {
    const obj1 = { b: 1, a: 2 };
    const obj2 = { a: 2, b: 1 };

    const bytes1 = canonicalizeForHash(obj1);
    const bytes2 = canonicalizeForHash(obj2);

    expect(bytes1).toEqual(bytes2);
  });

  it('should encode as UTF-8', () => {
    const obj = { text: 'hello' };
    const result = canonicalizeForHash(obj);
    const expected = new TextEncoder().encode('{"text":"hello"}');
    expect(result).toEqual(expected);
  });
});
