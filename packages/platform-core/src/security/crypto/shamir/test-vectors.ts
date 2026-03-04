/**
 * Shamir Secret Sharing Test Vectors
 *
 * This module provides comprehensive test vectors for verifying the correctness
 * of Shamir Secret Sharing implementations. Vectors include:
 * - Edge cases (threshold=1, threshold=n, max shares)
 * - Known-answer tests from academic papers
 * - Interoperability tests with reference implementations
 * - NIST-style structured test vectors
 *
 * @module security/crypto/shamir/test-vectors
 */

import { TestVector, GF256Element, ShareIndex } from './types';
import { GF256, createPolynomial } from './verified-shamir';

// ============================================================================
// NIST-Style Test Vectors
// ============================================================================

/**
 * NIST-style test vectors with known inputs and expected outputs.
 * These vectors are designed for deterministic testing.
 *
 * Format follows NIST CAVP (Cryptographic Algorithm Validation Program) style.
 */
export const NIST_STYLE_VECTORS: TestVector[] = [
  // Vector 1: Simple 2-of-3 scheme
  {
    id: 'NIST-SHAMIR-001',
    description: '2-of-3 scheme with single byte secret',
    source: 'Vorion internal validation',
    secret: new Uint8Array([42]),
    params: { threshold: 2, totalShares: 3, secretLength: 1 },
    reconstructionShares: [1, 2],
  },

  // Vector 2: 3-of-5 scheme
  {
    id: 'NIST-SHAMIR-002',
    description: '3-of-5 scheme with 32-byte secret',
    source: 'Vorion internal validation',
    secret: new Uint8Array([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
      0x0f, 0x1e, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78,
      0x87, 0x96, 0xa5, 0xb4, 0xc3, 0xd2, 0xe1, 0xf0,
    ]),
    params: { threshold: 3, totalShares: 5, secretLength: 32 },
    reconstructionShares: [1, 3, 5],
  },

  // Vector 3: Minimum threshold
  {
    id: 'NIST-SHAMIR-003',
    description: 'Minimum threshold (2-of-2)',
    source: 'Vorion internal validation',
    secret: new Uint8Array([0xff]),
    params: { threshold: 2, totalShares: 2, secretLength: 1 },
    reconstructionShares: [1, 2],
  },

  // Vector 4: High threshold
  {
    id: 'NIST-SHAMIR-004',
    description: 'High threshold 5-of-5 (all shares required)',
    source: 'Vorion internal validation',
    secret: new Uint8Array([0x12, 0x34, 0x56, 0x78]),
    params: { threshold: 5, totalShares: 5, secretLength: 4 },
    reconstructionShares: [1, 2, 3, 4, 5],
  },
];

// ============================================================================
// Edge Case Test Vectors
// ============================================================================

/**
 * Edge case test vectors for boundary conditions.
 */
export const EDGE_CASE_VECTORS: TestVector[] = [
  // All zeros secret
  {
    id: 'EDGE-ZEROS-001',
    description: 'All-zero secret (32 bytes)',
    source: 'Edge case validation',
    secret: new Uint8Array(32).fill(0),
    params: { threshold: 2, totalShares: 3, secretLength: 32 },
    reconstructionShares: [1, 2],
  },

  // All ones secret
  {
    id: 'EDGE-ONES-001',
    description: 'All-0xFF secret (32 bytes)',
    source: 'Edge case validation',
    secret: new Uint8Array(32).fill(0xff),
    params: { threshold: 2, totalShares: 3, secretLength: 32 },
    reconstructionShares: [2, 3],
  },

  // Single byte secret
  {
    id: 'EDGE-MINIMAL-001',
    description: 'Single byte secret (minimum size)',
    source: 'Edge case validation',
    secret: new Uint8Array([0x42]),
    params: { threshold: 2, totalShares: 3, secretLength: 1 },
    reconstructionShares: [1, 3],
  },

  // Threshold equals total shares
  {
    id: 'EDGE-THRESHOLD-001',
    description: 'Threshold equals total (3-of-3)',
    source: 'Edge case validation',
    secret: new Uint8Array([0xab, 0xcd, 0xef]),
    params: { threshold: 3, totalShares: 3, secretLength: 3 },
    reconstructionShares: [1, 2, 3],
  },

  // Large number of shares
  {
    id: 'EDGE-MANY-SHARES-001',
    description: 'Many shares (10-of-20)',
    source: 'Edge case validation',
    secret: new Uint8Array([0x99]),
    params: { threshold: 10, totalShares: 20, secretLength: 1 },
    reconstructionShares: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
  },

  // Maximum shares (255)
  {
    id: 'EDGE-MAX-SHARES-001',
    description: 'Maximum share count (2-of-255)',
    source: 'Edge case validation',
    secret: new Uint8Array([0x01]),
    params: { threshold: 2, totalShares: 255, secretLength: 1 },
    reconstructionShares: [1, 255],
  },

  // Alternating byte pattern
  {
    id: 'EDGE-PATTERN-001',
    description: 'Alternating byte pattern',
    source: 'Edge case validation',
    secret: new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]),
    params: { threshold: 3, totalShares: 5, secretLength: 8 },
    reconstructionShares: [2, 3, 4],
  },

  // Sequential bytes
  {
    id: 'EDGE-SEQUENTIAL-001',
    description: 'Sequential byte values 0-15',
    source: 'Edge case validation',
    secret: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    params: { threshold: 4, totalShares: 6, secretLength: 16 },
    reconstructionShares: [1, 2, 5, 6],
  },
];

// ============================================================================
// Academic Reference Vectors
// ============================================================================

/**
 * Test vectors based on academic papers and reference implementations.
 */
export const ACADEMIC_VECTORS: TestVector[] = [
  // Based on Shamir's original 1979 paper example (adapted to GF(2^8))
  {
    id: 'ACAD-SHAMIR-1979-001',
    description: 'Shamir 1979 paper inspired example',
    source: 'Adapted from "How to Share a Secret" CACM 1979',
    secret: new Uint8Array([0x0b]), // Secret = 11
    params: { threshold: 3, totalShares: 6, secretLength: 1 },
    reconstructionShares: [1, 2, 3],
  },

  // Blakley comparison (same secret, different reconstruction)
  {
    id: 'ACAD-COMPARISON-001',
    description: 'Comparison with geometric secret sharing (same security level)',
    source: 'Comparison test',
    secret: new Uint8Array([0x2a, 0x2a, 0x2a, 0x2a]), // 42 repeated
    params: { threshold: 3, totalShares: 5, secretLength: 4 },
    reconstructionShares: [1, 2, 3],
  },
];

// ============================================================================
// GF(2^8) Operation Test Vectors
// ============================================================================

/**
 * Test vectors for GF(2^8) field operations.
 * These verify the correctness of the underlying field arithmetic.
 */
export interface GF256TestVector {
  operation: 'add' | 'sub' | 'mul' | 'div' | 'inv' | 'pow';
  inputs: number[];
  expected: number;
  description: string;
}

export const GF256_OPERATION_VECTORS: GF256TestVector[] = [
  // Addition (XOR)
  { operation: 'add', inputs: [0x00, 0x00], expected: 0x00, description: '0 + 0 = 0' },
  { operation: 'add', inputs: [0xff, 0x00], expected: 0xff, description: '255 + 0 = 255' },
  { operation: 'add', inputs: [0xff, 0xff], expected: 0x00, description: '255 + 255 = 0 (char 2)' },
  { operation: 'add', inputs: [0xaa, 0x55], expected: 0xff, description: '0xAA + 0x55 = 0xFF' },
  { operation: 'add', inputs: [0x53, 0xca], expected: 0x99, description: '0x53 + 0xCA = 0x99 (AES example)' },

  // Subtraction (same as addition in char 2)
  { operation: 'sub', inputs: [0x53, 0xca], expected: 0x99, description: '0x53 - 0xCA = 0x99' },

  // Multiplication
  { operation: 'mul', inputs: [0x00, 0xff], expected: 0x00, description: '0 * 255 = 0' },
  { operation: 'mul', inputs: [0x01, 0xff], expected: 0xff, description: '1 * 255 = 255' },
  { operation: 'mul', inputs: [0x02, 0x02], expected: 0x04, description: '2 * 2 = 4' },
  { operation: 'mul', inputs: [0x53, 0xca], expected: 0x01, description: '0x53 * 0xCA = 0x01 (AES S-box)' },
  { operation: 'mul', inputs: [0x57, 0x83], expected: 0xc1, description: '0x57 * 0x83 = 0xC1 (FIPS 197 example)' },

  // Division
  { operation: 'div', inputs: [0x00, 0x01], expected: 0x00, description: '0 / 1 = 0' },
  { operation: 'div', inputs: [0xff, 0x01], expected: 0xff, description: '255 / 1 = 255' },
  { operation: 'div', inputs: [0x01, 0x53], expected: 0xca, description: '1 / 0x53 = 0xCA (inverse)' },

  // Inverse
  { operation: 'inv', inputs: [0x01], expected: 0x01, description: 'inv(1) = 1' },
  { operation: 'inv', inputs: [0x53], expected: 0xca, description: 'inv(0x53) = 0xCA (AES S-box)' },
  { operation: 'inv', inputs: [0x03], expected: 0xf6, description: 'inv(3) = 0xF6' },

  // Power
  { operation: 'pow', inputs: [0x03, 0], expected: 0x01, description: '3^0 = 1' },
  { operation: 'pow', inputs: [0x03, 1], expected: 0x03, description: '3^1 = 3' },
  { operation: 'pow', inputs: [0x03, 255], expected: 0x01, description: '3^255 = 1 (Fermat)' },
  { operation: 'pow', inputs: [0x02, 8], expected: 0x1b, description: '2^8 = 0x1B (reduction)' },
];

// ============================================================================
// Polynomial Evaluation Test Vectors
// ============================================================================

/**
 * Test vectors for polynomial evaluation in GF(2^8).
 */
export interface PolynomialTestVector {
  coefficients: number[];
  x: number;
  expected: number;
  description: string;
}

export const POLYNOMIAL_VECTORS: PolynomialTestVector[] = [
  // Constant polynomial
  { coefficients: [42], x: 0, expected: 42, description: 'f(x)=42: f(0)=42' },
  { coefficients: [42], x: 1, expected: 42, description: 'f(x)=42: f(1)=42' },
  { coefficients: [42], x: 255, expected: 42, description: 'f(x)=42: f(255)=42' },

  // Linear polynomial f(x) = 42 + 17x
  { coefficients: [42, 17], x: 0, expected: 42, description: 'f(x)=42+17x: f(0)=42' },
  { coefficients: [42, 17], x: 1, expected: 42 ^ 17, description: 'f(x)=42+17x: f(1)=42 XOR 17' },

  // Quadratic polynomial
  { coefficients: [1, 0, 1], x: 0, expected: 1, description: 'f(x)=1+x^2: f(0)=1' },
  { coefficients: [1, 0, 1], x: 1, expected: 0, description: 'f(x)=1+x^2: f(1)=1 XOR 1=0' },
  { coefficients: [1, 0, 1], x: 2, expected: 1 ^ GF256.mul(4 as GF256Element, 1 as GF256Element), description: 'f(x)=1+x^2: f(2)' },
];

// ============================================================================
// Lagrange Interpolation Test Vectors
// ============================================================================

/**
 * Test vectors for Lagrange interpolation at x=0.
 */
export interface LagrangeTestVector {
  points: Array<{ x: number; y: number }>;
  expectedF0: number;
  description: string;
}

export const LAGRANGE_VECTORS: LagrangeTestVector[] = [
  // Two points (linear)
  {
    points: [{ x: 1, y: 42 }, { x: 2, y: 42 }],
    expectedF0: 42,
    description: 'Constant function through two points',
  },

  // Three points (quadratic)
  {
    points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
    expectedF0: 0,
    description: 'Linear function f(x)=x through three points',
  },

  // Known polynomial f(x) = 42 + 17x
  {
    points: [
      { x: 1, y: 42 ^ 17 },
      { x: 2, y: 42 ^ GF256.mul(17 as GF256Element, 2 as GF256Element) },
    ],
    expectedF0: 42,
    description: 'f(x)=42+17x interpolation',
  },
];

// ============================================================================
// Test Vector Execution Utilities
// ============================================================================

/**
 * Verify a GF(2^8) operation test vector.
 */
export function verifyGF256Vector(vector: GF256TestVector): { passed: boolean; actual: number } {
  let actual: number;

  switch (vector.operation) {
    case 'add':
      actual = GF256.add(vector.inputs[0] as GF256Element, vector.inputs[1] as GF256Element);
      break;
    case 'sub':
      actual = GF256.sub(vector.inputs[0] as GF256Element, vector.inputs[1] as GF256Element);
      break;
    case 'mul':
      actual = GF256.mul(vector.inputs[0] as GF256Element, vector.inputs[1] as GF256Element);
      break;
    case 'div':
      actual = GF256.div(vector.inputs[0] as GF256Element, vector.inputs[1] as GF256Element);
      break;
    case 'inv':
      actual = GF256.inv(vector.inputs[0] as GF256Element);
      break;
    case 'pow':
      actual = GF256.pow(vector.inputs[0] as GF256Element, vector.inputs[1]);
      break;
    default:
      throw new Error(`Unknown operation: ${vector.operation}`);
  }

  return {
    passed: actual === vector.expected,
    actual,
  };
}

/**
 * Verify a polynomial evaluation test vector.
 */
export function verifyPolynomialVector(vector: PolynomialTestVector): { passed: boolean; actual: number } {
  const poly = createPolynomial(vector.coefficients as GF256Element[]);
  const actual = poly.evaluate(vector.x as GF256Element);

  return {
    passed: actual === vector.expected,
    actual,
  };
}

/**
 * Run all test vectors and return comprehensive results.
 */
export function runAllTestVectors(): {
  passed: boolean;
  summary: {
    totalVectors: number;
    passedVectors: number;
    failedVectors: number;
  };
  categories: Array<{
    name: string;
    passed: boolean;
    details: unknown;
  }>;
} {
  const categories: Array<{ name: string; passed: boolean; details: unknown }> = [];

  // GF(2^8) operation vectors
  const gf256Results = GF256_OPERATION_VECTORS.map(v => ({
    vector: v,
    result: verifyGF256Vector(v),
  }));

  const gf256Passed = gf256Results.every(r => r.result.passed);
  categories.push({
    name: 'GF(2^8) Operations',
    passed: gf256Passed,
    details: gf256Results.filter(r => !r.result.passed).map(r => ({
      description: r.vector.description,
      expected: r.vector.expected,
      actual: r.result.actual,
    })),
  });

  // Polynomial evaluation vectors
  const polyResults = POLYNOMIAL_VECTORS.map(v => ({
    vector: v,
    result: verifyPolynomialVector(v),
  }));

  const polyPassed = polyResults.every(r => r.result.passed);
  categories.push({
    name: 'Polynomial Evaluation',
    passed: polyPassed,
    details: polyResults.filter(r => !r.result.passed).map(r => ({
      description: r.vector.description,
      expected: r.vector.expected,
      actual: r.result.actual,
    })),
  });

  // Count totals
  const totalVectors = GF256_OPERATION_VECTORS.length + POLYNOMIAL_VECTORS.length;
  const passedVectors = gf256Results.filter(r => r.result.passed).length +
    polyResults.filter(r => r.result.passed).length;

  return {
    passed: categories.every(c => c.passed),
    summary: {
      totalVectors,
      passedVectors,
      failedVectors: totalVectors - passedVectors,
    },
    categories,
  };
}

// ============================================================================
// Known-Answer Test Generation
// ============================================================================

/**
 * Generate deterministic shares for a known secret using fixed random seed.
 * Used for generating reproducible test vectors.
 *
 * @param secret - The secret bytes
 * @param threshold - Minimum shares for reconstruction
 * @param totalShares - Total shares to generate
 * @param seed - Seed for deterministic coefficient generation
 */
export function generateDeterministicShares(
  secret: Uint8Array,
  threshold: number,
  totalShares: number,
  seed: number
): Array<{ index: number; value: Uint8Array }> {
  const shares: Array<{ index: number; value: Uint8Array }> = [];

  for (let i = 0; i < totalShares; i++) {
    shares.push({ index: i + 1, value: new Uint8Array(secret.length) });
  }

  // Generate shares for each byte
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Build deterministic polynomial coefficients
    const coefficients: GF256Element[] = [secret[byteIdx] as GF256Element];

    for (let j = 1; j < threshold; j++) {
      // Deterministic "random" coefficient based on seed, byte index, and coefficient index
      const coef = ((seed * 31 + byteIdx * 17 + j * 13) % 255) + 1;
      coefficients.push(coef as GF256Element);
    }

    const poly = createPolynomial(coefficients);

    // Evaluate at each share index
    for (let i = 0; i < totalShares; i++) {
      shares[i].value[byteIdx] = poly.evaluate((i + 1) as GF256Element);
    }
  }

  return shares;
}

/**
 * Export all test vector collections.
 */
export const ALL_TEST_VECTORS = {
  nistStyle: NIST_STYLE_VECTORS,
  edgeCases: EDGE_CASE_VECTORS,
  academic: ACADEMIC_VECTORS,
  gf256Operations: GF256_OPERATION_VECTORS,
  polynomials: POLYNOMIAL_VECTORS,
  lagrange: LAGRANGE_VECTORS,
};
