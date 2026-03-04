/**
 * Canonical JSON Serialization
 *
 * Provides deterministic JSON serialization for cryptographic operations.
 * Standard JSON.stringify is NOT deterministic - object key order can vary
 * between environments and runtimes, causing hash mismatches.
 *
 * This module ensures:
 * - Object keys are always sorted alphabetically (recursive)
 * - Arrays maintain their order (not sorted)
 * - Consistent handling of special values (null, undefined)
 * - No whitespace or formatting variations
 *
 * @packageDocumentation
 */

/**
 * Recursively sort object keys and create a canonical representation
 *
 * @param obj - The object to canonicalize
 * @returns A new object with recursively sorted keys
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  if (typeof obj === 'object' && obj !== null) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return obj;
}

/**
 * Convert an object to a canonical (deterministic) JSON string
 *
 * This function guarantees that the same logical object will always
 * produce the exact same string output, regardless of:
 * - The order in which keys were defined
 * - The JavaScript runtime or version
 * - How the object was constructed
 *
 * IMPORTANT: Use this for all cryptographic hash calculations
 * where consistency is required across different systems.
 *
 * @param obj - The object to serialize
 * @returns Deterministic JSON string with sorted keys
 *
 * @example
 * ```typescript
 * // These produce the same output
 * canonicalize({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 * canonicalize({ a: 2, b: 1 }); // '{"a":2,"b":1}'
 *
 * // Nested objects are also sorted
 * canonicalize({ z: { y: 1, x: 2 }, a: 3 });
 * // '{"a":3,"z":{"x":2,"y":1}}'
 * ```
 */
export function canonicalize(obj: unknown): string {
  const sorted = sortObjectKeys(obj);
  return JSON.stringify(sorted);
}

/**
 * Compare two objects for canonical equality
 *
 * Two objects are canonically equal if their canonical JSON
 * representations are identical.
 *
 * @param a - First object to compare
 * @param b - Second object to compare
 * @returns true if objects are canonically equal
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Compute a hash-ready string from an object
 *
 * This is a convenience function that combines canonicalization
 * with encoding preparation for hash functions.
 *
 * @param obj - The object to prepare for hashing
 * @returns UTF-8 encoded canonical JSON as Uint8Array
 */
export function canonicalizeForHash(obj: unknown): Uint8Array {
  const canonical = canonicalize(obj);
  return new TextEncoder().encode(canonical);
}
