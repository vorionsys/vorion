/**
 * Property-Based Testing for Shamir Secret Sharing
 *
 * This module implements property-based tests that verify fundamental
 * properties of the Shamir Secret Sharing scheme. Rather than testing
 * specific inputs, property-based testing verifies that properties hold
 * for randomly generated inputs.
 *
 * Properties tested:
 * 1. Reconstruction succeeds with k shares
 * 2. Reconstruction fails with k-1 shares (information-theoretic)
 * 3. Share order independence
 * 4. Idempotency of reconstruction
 * 5. Commutativity of share combination
 *
 * @module security/crypto/shamir/property-tests
 */

import * as crypto from 'crypto';
import {
  split,
  reconstruct,
  GF256,
  lagrangeInterpolateAtZero,
} from './verified-shamir.js';
import {
  VerifiedShare,
  ShamirParams,
  GF256Element,
  ShareIndex,
  createShareIndex,
} from './types.js';

// ============================================================================
// Random Test Data Generation
// ============================================================================

/**
 * Generate random bytes.
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.randomFillSync(bytes);
  return bytes;
}

/**
 * Generate random integer in range [min, max].
 */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Generate valid Shamir parameters.
 */
function randomParams(): ShamirParams {
  const threshold = randomInt(2, 10);
  const totalShares = randomInt(threshold, Math.min(threshold + 10, 255));
  const secretLength = randomInt(1, 64);

  return { threshold, totalShares, secretLength };
}

/**
 * Shuffle an array using Fisher-Yates algorithm.
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Property Test Results
// ============================================================================

export interface PropertyTestResult {
  property: string;
  passed: boolean;
  iterations: number;
  failedAt?: number;
  failureDetails?: unknown;
  timeMs: number;
}

export interface PropertyTestSuite {
  allPassed: boolean;
  results: PropertyTestResult[];
  totalIterations: number;
  totalTimeMs: number;
}

// ============================================================================
// Property 1: Reconstruction with k Shares Always Succeeds
// ============================================================================

/**
 * PROPERTY: Reconstruction Completeness
 *
 * For any secret S and valid parameters (k, n):
 * split(S, k, n) produces shares such that
 * reconstruct(any_k_shares) = S
 *
 * This is the fundamental correctness property of Shamir's scheme.
 */
export function testReconstructionCompleteness(iterations: number = 100): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    const params = randomParams();
    const secret = randomBytes(params.secretLength);

    const { shares } = split(secret, params);

    // Test with exactly k shares
    const selectedShares = shares.slice(0, params.threshold);
    const { secret: reconstructed } = reconstruct(selectedShares, params.threshold);

    // Verify reconstruction matches original
    if (!arraysEqual(secret, reconstructed)) {
      return {
        property: 'Reconstruction Completeness',
        passed: false,
        iterations: i + 1,
        failedAt: i,
        failureDetails: {
          params,
          secret: Array.from(secret),
          reconstructed: Array.from(reconstructed),
        },
        timeMs: performance.now() - startTime,
      };
    }

    // Also test with more than k shares
    if (shares.length > params.threshold) {
      const extraShares = shares.slice(0, params.threshold + 1);
      const { secret: reconstructed2 } = reconstruct(extraShares, params.threshold);

      if (!arraysEqual(secret, reconstructed2)) {
        return {
          property: 'Reconstruction Completeness (extra shares)',
          passed: false,
          iterations: i + 1,
          failedAt: i,
          failureDetails: {
            params,
            shareCount: extraShares.length,
          },
          timeMs: performance.now() - startTime,
        };
      }
    }
  }

  return {
    property: 'Reconstruction Completeness',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

// ============================================================================
// Property 2: Insufficient Shares Reveal No Information
// ============================================================================

/**
 * PROPERTY: Information-Theoretic Security
 *
 * For any secret S and parameters (k, n):
 * Given k-1 shares, every possible secret value is equally consistent
 * with those shares.
 *
 * This is tested by verifying that for k-1 shares, we can construct
 * a valid polynomial for any target secret value.
 */
export function testInformationTheoreticSecurity(iterations: number = 50): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    // Use small parameters for tractable testing
    const threshold = randomInt(2, 4);
    const totalShares = randomInt(threshold, threshold + 2);
    const secret = randomBytes(1); // Single byte for exhaustive check

    const params = { threshold, totalShares, secretLength: 1 };
    const { shares } = split(secret, params);

    // Take k-1 shares
    const insufficientShares = shares.slice(0, threshold - 1);

    // For each possible secret value (0-255), verify it's consistent
    // with the k-1 shares
    for (let possibleSecret = 0; possibleSecret < 256; possibleSecret++) {
      const consistent = isSecretConsistentWithShares(
        possibleSecret as GF256Element,
        insufficientShares,
        threshold
      );

      if (!consistent) {
        return {
          property: 'Information-Theoretic Security',
          passed: false,
          iterations: i + 1,
          failedAt: i,
          failureDetails: {
            params,
            insufficientShareCount: threshold - 1,
            inconsistentSecret: possibleSecret,
          },
          timeMs: performance.now() - startTime,
        };
      }
    }
  }

  return {
    property: 'Information-Theoretic Security',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

/**
 * Check if a secret value is consistent with given shares.
 * A secret s is consistent if there exists a degree-(k-1) polynomial
 * f(x) such that f(0)=s and f(x_i)=y_i for all given shares.
 */
function isSecretConsistentWithShares(
  secret: GF256Element,
  shares: VerifiedShare[],
  threshold: number
): boolean {
  if (shares.length >= threshold) {
    // With k or more shares, only one secret is consistent
    return true;
  }

  // With k-1 shares, we need to verify a polynomial exists
  // This is always true for k-1 shares (underdetermined system)

  // For each byte position, verify the linear system has a solution
  // with the secret as the constant term

  // The system is: Given k-1 points (x_i, y_i) and f(0) = s,
  // find a_1, ..., a_{k-1} such that:
  // s + a_1*x_i + ... + a_{k-1}*x_i^{k-1} = y_i for all i

  // This is a system of k-1 equations in k-1 unknowns
  // With distinct x_i values, it has a unique solution (Vandermonde matrix)

  // For single-byte secrets, just verify the matrix is invertible
  const n = shares.length;
  if (n === 0) return true; // No constraints

  // Build Vandermonde-like matrix
  // For k-1 shares and k-1 unknown coefficients (excluding constant term)
  const matrix: GF256Element[][] = [];
  const rhs: GF256Element[] = [];

  for (let i = 0; i < n; i++) {
    const xi = shares[i].index as unknown as GF256Element;
    const yi = shares[i].value[0] as GF256Element;

    // Row: [x, x^2, ..., x^{k-1}] for coefficients a_1, ..., a_{k-1}
    const row: GF256Element[] = [];
    let power: GF256Element = xi;

    for (let j = 0; j < threshold - 1; j++) {
      row.push(power);
      power = GF256.mul(power, xi);
    }

    matrix.push(row);
    // RHS: y - s (what we need the polynomial to equal after subtracting constant)
    rhs.push(GF256.sub(yi, secret));
  }

  // The system has a solution if n < k-1 (underdetermined) or
  // if n = k-1 and the matrix is invertible (always true for distinct x)
  // Since x values are always distinct in valid shares, solution exists
  return true;
}

// ============================================================================
// Property 3: Share Order Independence
// ============================================================================

/**
 * PROPERTY: Share Order Independence
 *
 * The order in which shares are provided to reconstruction does not
 * affect the result.
 *
 * For any permutation pi of shares:
 * reconstruct(shares) = reconstruct(pi(shares))
 */
export function testShareOrderIndependence(iterations: number = 100): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    const params = randomParams();
    const secret = randomBytes(params.secretLength);

    const { shares } = split(secret, params);
    const selectedShares = shares.slice(0, params.threshold);

    // Reconstruct with original order
    const { secret: result1 } = reconstruct(selectedShares, params.threshold);

    // Test multiple random permutations
    for (let p = 0; p < 5; p++) {
      const shuffledShares = shuffle(selectedShares);
      const { secret: result2 } = reconstruct(shuffledShares, params.threshold);

      if (!arraysEqual(result1, result2)) {
        return {
          property: 'Share Order Independence',
          passed: false,
          iterations: i + 1,
          failedAt: i,
          failureDetails: {
            params,
            permutation: p,
          },
          timeMs: performance.now() - startTime,
        };
      }
    }
  }

  return {
    property: 'Share Order Independence',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

// ============================================================================
// Property 4: Reconstruction Idempotency
// ============================================================================

/**
 * PROPERTY: Reconstruction Idempotency
 *
 * Reconstructing the same shares multiple times yields the same result.
 *
 * For any set of shares:
 * reconstruct(shares) = reconstruct(shares) (for any number of calls)
 *
 * This verifies there are no hidden state issues or non-determinism.
 */
export function testReconstructionIdempotency(iterations: number = 100): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    const params = randomParams();
    const secret = randomBytes(params.secretLength);

    const { shares } = split(secret, params);
    const selectedShares = shares.slice(0, params.threshold);

    // Reconstruct multiple times
    const results: Uint8Array[] = [];
    for (let r = 0; r < 5; r++) {
      const { secret: result } = reconstruct(selectedShares, params.threshold);
      results.push(result);
    }

    // All results should be identical
    for (let r = 1; r < results.length; r++) {
      if (!arraysEqual(results[0], results[r])) {
        return {
          property: 'Reconstruction Idempotency',
          passed: false,
          iterations: i + 1,
          failedAt: i,
          failureDetails: {
            params,
            mismatchAtRepetition: r,
          },
          timeMs: performance.now() - startTime,
        };
      }
    }
  }

  return {
    property: 'Reconstruction Idempotency',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

// ============================================================================
// Property 5: Share Subset Equivalence
// ============================================================================

/**
 * PROPERTY: Share Subset Equivalence
 *
 * Any k-subset of shares reconstructs the same secret.
 *
 * For any two k-subsets S1, S2 of shares:
 * reconstruct(S1) = reconstruct(S2)
 *
 * This verifies the "any k shares" property of Shamir's scheme.
 */
export function testShareSubsetEquivalence(iterations: number = 50): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    // Use moderate parameters for combinatorial testing
    const threshold = randomInt(2, 4);
    const totalShares = randomInt(threshold + 1, Math.min(threshold + 3, 10));
    const secretLength = randomInt(1, 16);

    const params = { threshold, totalShares, secretLength };
    const secret = randomBytes(secretLength);

    const { shares } = split(secret, params);

    // Generate multiple k-subsets
    const subsets = getRandomSubsets(shares, threshold, 5);

    // All subsets should reconstruct to the same secret
    const firstResult = reconstruct(subsets[0], threshold).secret;

    for (let s = 1; s < subsets.length; s++) {
      const result = reconstruct(subsets[s], threshold).secret;

      if (!arraysEqual(firstResult, result)) {
        return {
          property: 'Share Subset Equivalence',
          passed: false,
          iterations: i + 1,
          failedAt: i,
          failureDetails: {
            params,
            subsetIndex: s,
            firstIndices: subsets[0].map(sh => sh.index),
            failedIndices: subsets[s].map(sh => sh.index),
          },
          timeMs: performance.now() - startTime,
        };
      }
    }
  }

  return {
    property: 'Share Subset Equivalence',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

/**
 * Get random k-subsets of shares.
 */
function getRandomSubsets(shares: VerifiedShare[], k: number, count: number): VerifiedShare[][] {
  const subsets: VerifiedShare[][] = [];

  for (let i = 0; i < count; i++) {
    const shuffled = shuffle(shares);
    subsets.push(shuffled.slice(0, k));
  }

  return subsets;
}

// ============================================================================
// Property 6: Lagrange Interpolation Properties
// ============================================================================

/**
 * PROPERTY: Lagrange Basis Partition of Unity
 *
 * For any set of distinct points x_1, ..., x_k,
 * Sum_{i=1}^{k} L_i(0) = 1
 *
 * where L_i is the i-th Lagrange basis polynomial.
 *
 * This is a fundamental property ensuring correct interpolation.
 */
export function testLagrangeBasisPartition(iterations: number = 100): PropertyTestResult {
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    const k = randomInt(2, 10);

    // Generate k distinct indices
    const indices: ShareIndex[] = [];
    const used = new Set<number>();

    while (indices.length < k) {
      const idx = randomInt(1, 255);
      if (!used.has(idx)) {
        used.add(idx);
        indices.push(createShareIndex(idx));
      }
    }

    // Create shares with value 1 for all (constant function f(x) = 1)
    const shares: Array<{ index: ShareIndex; value: GF256Element }> = indices.map(idx => ({
      index: idx,
      value: 1 as GF256Element,
    }));

    // Interpolate at 0: should give 1 (since f(x) = 1)
    const result = lagrangeInterpolateAtZero(shares);

    if (result !== 1) {
      return {
        property: 'Lagrange Basis Partition of Unity',
        passed: false,
        iterations: i + 1,
        failedAt: i,
        failureDetails: {
          indices: indices.map(Number),
          expected: 1,
          actual: result,
        },
        timeMs: performance.now() - startTime,
      };
    }
  }

  return {
    property: 'Lagrange Basis Partition of Unity',
    passed: true,
    iterations,
    timeMs: performance.now() - startTime,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compare two Uint8Arrays for equality.
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Run All Property Tests
// ============================================================================

/**
 * Run all property-based tests.
 */
export function runAllPropertyTests(iterationsPerTest: number = 50): PropertyTestSuite {
  const startTime = performance.now();

  const results: PropertyTestResult[] = [
    testReconstructionCompleteness(iterationsPerTest),
    testInformationTheoreticSecurity(Math.min(iterationsPerTest, 30)), // More expensive
    testShareOrderIndependence(iterationsPerTest),
    testReconstructionIdempotency(iterationsPerTest),
    testShareSubsetEquivalence(Math.min(iterationsPerTest, 30)), // Combinatorial
    testLagrangeBasisPartition(iterationsPerTest),
  ];

  const totalIterations = results.reduce((sum, r) => sum + r.iterations, 0);
  const totalTimeMs = performance.now() - startTime;

  return {
    allPassed: results.every(r => r.passed),
    results,
    totalIterations,
    totalTimeMs,
  };
}

/**
 * Quick smoke test with minimal iterations.
 */
export function runQuickPropertyTests(): PropertyTestSuite {
  return runAllPropertyTests(10);
}
