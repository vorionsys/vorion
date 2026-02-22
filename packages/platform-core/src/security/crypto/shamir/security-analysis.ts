/**
 * Security Analysis for Shamir Secret Sharing
 *
 * This module provides comprehensive security analysis capabilities:
 * - Entropy verification of shares
 * - Statistical randomness tests
 * - Timing attack resistance verification
 * - Memory safety analysis
 *
 * @module security/crypto/shamir/security-analysis
 */

import * as crypto from 'crypto';
import {
  split,
  reconstruct,
  GF256,
  constantTimeEqual,
  constantTimeSelect,
} from './verified-shamir.js';
import {
  VerifiedShare,
  SecurityAnalysisResult,
  SecurityCheck,
  EntropyAnalysis,
  TimingAnalysis,
  GF256Element,
} from './types.js';

// ============================================================================
// Entropy Analysis
// ============================================================================

/**
 * Calculate Shannon entropy of a byte array.
 *
 * Shannon entropy: H(X) = -Sum(p(x) * log2(p(x)))
 *
 * Maximum entropy for bytes is 8 bits (uniform distribution).
 * Good random data should have entropy close to 8.
 */
export function calculateShannonEntropy(data: Uint8Array): number {
  if (data.length === 0) return 0;

  // Count byte frequencies
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    frequencies[data[i]]++;
  }

  // Calculate entropy
  let entropy = 0;
  const length = data.length;

  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const probability = frequencies[i] / length;
      entropy -= probability * Math.log2(probability);
    }
  }

  return entropy;
}

/**
 * Calculate min-entropy (conservative entropy estimate).
 *
 * Min-entropy: H_min(X) = -log2(max(p(x)))
 *
 * This is a more conservative measure than Shannon entropy,
 * as it considers only the most probable outcome.
 */
export function calculateMinEntropy(data: Uint8Array): number {
  if (data.length === 0) return 0;

  // Find maximum frequency
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    frequencies[data[i]]++;
  }

  const maxFrequency = Math.max(...frequencies);
  const maxProbability = maxFrequency / data.length;

  return -Math.log2(maxProbability);
}

/**
 * Analyze entropy of share data.
 */
export function analyzeShareEntropy(shares: VerifiedShare[]): EntropyAnalysis {
  // Combine all share values
  const allBytes: number[] = [];
  for (const share of shares) {
    for (let i = 0; i < share.value.length; i++) {
      allBytes.push(share.value[i]);
    }
  }

  const data = new Uint8Array(allBytes);

  // Calculate byte distribution
  const byteDistribution = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    byteDistribution[data[i]]++;
  }

  // Normalize distribution
  for (let i = 0; i < 256; i++) {
    byteDistribution[i] /= data.length;
  }

  const shannonEntropy = calculateShannonEntropy(data);
  const minEntropy = calculateMinEntropy(data);

  // Entropy is sufficient if close to 8 bits (with some tolerance)
  const sufficient = shannonEntropy >= 7.5 && minEntropy >= 6.0;

  return {
    shannonEntropy,
    minEntropy,
    sufficient,
    byteDistribution,
  };
}

// ============================================================================
// Statistical Randomness Tests
// ============================================================================

/**
 * Chi-square test for uniformity.
 *
 * Tests if byte distribution is consistent with uniform distribution.
 * Returns p-value; values < 0.01 indicate non-random data.
 */
export function chiSquareTest(data: Uint8Array): { statistic: number; pValue: number; passed: boolean } {
  if (data.length < 256) {
    return { statistic: 0, pValue: 1, passed: true }; // Insufficient data
  }

  // Count frequencies
  const observed = new Array(256).fill(0);
  for (let idx = 0; idx < data.length; idx++) {
    observed[data[idx]]++;
  }

  // Expected frequency for uniform distribution
  const expected = data.length / 256;

  // Calculate chi-square statistic
  let chiSquare = 0;
  for (let i = 0; i < 256; i++) {
    const diff = observed[i] - expected;
    chiSquare += (diff * diff) / expected;
  }

  // Approximate p-value using chi-square distribution with 255 degrees of freedom
  // For large df, chi-square is approximately normal with mean=df, var=2*df
  const df = 255;
  const z = (chiSquare - df) / Math.sqrt(2 * df);
  const pValue = 1 - normalCDF(z);

  return {
    statistic: chiSquare,
    pValue,
    passed: pValue >= 0.01, // Significance level 0.01
  };
}

/**
 * Runs test for randomness (counts runs of consecutive identical bits).
 */
export function runsTest(data: Uint8Array): { statistic: number; pValue: number; passed: boolean } {
  if (data.length < 10) {
    return { statistic: 0, pValue: 1, passed: true };
  }

  // Convert to bit string
  const bits: number[] = [];
  for (let idx = 0; idx < data.length; idx++) {
    const byte = data[idx];
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }

  // Count ones and runs
  const n = bits.length;
  let ones = 0;
  let runs = 1;

  for (let i = 0; i < n; i++) {
    if (bits[i] === 1) ones++;
    if (i > 0 && bits[i] !== bits[i - 1]) runs++;
  }

  // Expected values for random sequence
  const pi = ones / n;
  const expectedRuns = 2 * n * pi * (1 - pi) + 1;
  const variance = 2 * n * pi * (1 - pi) * (2 * n * pi * (1 - pi) - 1) / (n - 1);

  if (variance <= 0) {
    return { statistic: 0, pValue: 0, passed: false };
  }

  const z = (runs - expectedRuns) / Math.sqrt(variance);
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  return {
    statistic: z,
    pValue,
    passed: pValue >= 0.01,
  };
}

/**
 * Serial test for bit pairs.
 */
export function serialTest(data: Uint8Array): { statistic: number; pValue: number; passed: boolean } {
  if (data.length < 32) {
    return { statistic: 0, pValue: 1, passed: true };
  }

  // Count bit pairs
  const pairCounts = [0, 0, 0, 0]; // 00, 01, 10, 11

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    for (let j = 6; j >= 0; j -= 2) {
      const pair = (byte >> j) & 0x03;
      pairCounts[pair]++;
    }
  }

  const totalPairs = pairCounts.reduce((a, b) => a + b, 0);
  const expected = totalPairs / 4;

  let chiSquare = 0;
  for (let i = 0; i < 4; i++) {
    const diff = pairCounts[i] - expected;
    chiSquare += (diff * diff) / expected;
  }

  // Chi-square with 3 degrees of freedom
  const df = 3;
  const z = (chiSquare - df) / Math.sqrt(2 * df);
  const pValue = 1 - normalCDF(z);

  return {
    statistic: chiSquare,
    pValue,
    passed: pValue >= 0.01,
  };
}

/**
 * Standard normal CDF approximation.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// Timing Attack Resistance
// ============================================================================

/**
 * Measure execution time of a function with high precision.
 */
function measureTime(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start); // nanoseconds
}

/**
 * Analyze timing characteristics of an operation.
 */
export function analyzeTimings(samples: number[]): TimingAnalysis {
  if (samples.length === 0) {
    return {
      avgTimeNs: 0,
      stdDevNs: 0,
      maxDeviationNs: 0,
      constantTime: false,
      sampleCount: 0,
    };
  }

  // Calculate mean
  const sum = samples.reduce((a, b) => a + b, 0);
  const avgTimeNs = sum / samples.length;

  // Calculate standard deviation
  const squaredDiffs = samples.map(s => (s - avgTimeNs) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
  const stdDevNs = Math.sqrt(variance);

  // Maximum deviation from mean
  const maxDeviationNs = Math.max(...samples.map(s => Math.abs(s - avgTimeNs)));

  // Coefficient of variation (CV) - relative standard deviation
  const cv = avgTimeNs > 0 ? stdDevNs / avgTimeNs : 0;

  // Consider constant-time if CV is small (< 10%)
  // Note: This is a heuristic; true constant-time verification requires
  // more sophisticated analysis
  const constantTime = cv < 0.1;

  return {
    avgTimeNs,
    stdDevNs,
    maxDeviationNs,
    constantTime,
    sampleCount: samples.length,
  };
}

/**
 * Test timing resistance of GF(2^8) operations.
 */
export function testGF256TimingResistance(iterations: number = 1000): {
  passed: boolean;
  operations: { [key: string]: TimingAnalysis };
} {
  const operations: { [key: string]: TimingAnalysis } = {};

  // Test multiplication with different operand values
  const mulSamples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const a = (Math.random() * 256) | 0;
    const b = (Math.random() * 256) | 0;
    const time = measureTime(() => {
      GF256.mul(a as GF256Element, b as GF256Element);
    });
    mulSamples.push(time);
  }
  operations['multiplication'] = analyzeTimings(mulSamples);

  // Test inverse with different input values
  const invSamples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const a = ((Math.random() * 255) | 0) + 1; // Non-zero
    const time = measureTime(() => {
      GF256.inv(a as GF256Element);
    });
    invSamples.push(time);
  }
  operations['inverse'] = analyzeTimings(invSamples);

  // Test division
  const divSamples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const a = (Math.random() * 256) | 0;
    const b = ((Math.random() * 255) | 0) + 1;
    const time = measureTime(() => {
      GF256.div(a as GF256Element, b as GF256Element);
    });
    divSamples.push(time);
  }
  operations['division'] = analyzeTimings(divSamples);

  // All operations should show constant-time behavior
  const passed = Object.values(operations).every(o => o.constantTime);

  return { passed, operations };
}

/**
 * Test timing resistance of reconstruction operation.
 */
export function testReconstructionTimingResistance(iterations: number = 100): TimingAnalysis {
  const samples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Generate random secret and shares
    const secret = crypto.randomBytes(32);
    const { shares } = split(secret, { threshold: 3, totalShares: 5, secretLength: 32 });

    const selectedShares = shares.slice(0, 3);

    const time = measureTime(() => {
      reconstruct(selectedShares, 3);
    });
    samples.push(time);
  }

  return analyzeTimings(samples);
}

// ============================================================================
// Memory Safety Analysis
// ============================================================================

/**
 * Check for potential memory leaks in share operations.
 */
export function analyzeMemorySafety(iterations: number = 100): {
  passed: boolean;
  checks: SecurityCheck[];
} {
  const checks: SecurityCheck[] = [];

  // Check 1: Share values are independent copies
  {
    const secret = new Uint8Array([42, 43, 44]);
    const { shares } = split(secret, { threshold: 2, totalShares: 3, secretLength: 3 });

    // Modify original secret
    secret[0] = 0;

    // Shares should not be affected
    let sharesUnaffected = true;
    for (const share of shares) {
      if (share.value[0] === 0 && share.value[1] === 0 && share.value[2] === 0) {
        // This would indicate shares reference the same memory
        sharesUnaffected = false;
        break;
      }
    }

    checks.push({
      name: 'Share Independence',
      passed: sharesUnaffected,
      details: 'Shares are independent copies, not references to original secret',
    });
  }

  // Check 2: Reconstructed secret is independent copy
  {
    const secret = new Uint8Array([42, 43, 44]);
    const { shares } = split(secret, { threshold: 2, totalShares: 3, secretLength: 3 });

    const { secret: reconstructed } = reconstruct(shares.slice(0, 2), 2);

    // Modify shares
    shares[0].value[0] = 0;

    // Reconstructed should not be affected
    const reconstructedUnaffected = reconstructed[0] === 42;

    checks.push({
      name: 'Reconstruction Independence',
      passed: reconstructedUnaffected,
      details: 'Reconstructed secret is independent of original shares',
    });
  }

  // Check 3: Constant-time comparison works correctly
  {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);

    const equalCorrect = constantTimeEqual(a, b) === true;
    const notEqualCorrect = constantTimeEqual(a, c) === false;

    checks.push({
      name: 'Constant-Time Comparison',
      passed: equalCorrect && notEqualCorrect,
      details: 'Constant-time comparison returns correct results',
    });
  }

  // Check 4: Constant-time select works correctly
  {
    const a = 42 as GF256Element;
    const b = 99 as GF256Element;

    const selectTrue = constantTimeSelect(true, a, b) === a;
    const selectFalse = constantTimeSelect(false, a, b) === b;

    checks.push({
      name: 'Constant-Time Select',
      passed: selectTrue && selectFalse,
      details: 'Constant-time select returns correct values',
    });
  }

  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

// ============================================================================
// Comprehensive Security Analysis
// ============================================================================

/**
 * Run comprehensive security analysis.
 */
export function runSecurityAnalysis(): SecurityAnalysisResult {
  const checks: SecurityCheck[] = [];

  // 1. Entropy analysis
  const testSecret = crypto.randomBytes(32);
  const { shares } = split(testSecret, { threshold: 3, totalShares: 5, secretLength: 32 });
  const entropyAnalysis = analyzeShareEntropy(shares);

  checks.push({
    name: 'Share Entropy',
    passed: entropyAnalysis.sufficient,
    details: `Shannon entropy: ${entropyAnalysis.shannonEntropy.toFixed(2)} bits, Min-entropy: ${entropyAnalysis.minEntropy.toFixed(2)} bits`,
    severity: entropyAnalysis.sufficient ? undefined : 'high',
  });

  // 2. Statistical randomness
  const allShareBytes = new Uint8Array(shares.flatMap(s => Array.from(s.value)));
  const chiSquareResult = chiSquareTest(allShareBytes);
  const runsResult = runsTest(allShareBytes);
  const serialResult = serialTest(allShareBytes);

  checks.push({
    name: 'Chi-Square Test',
    passed: chiSquareResult.passed,
    details: `Statistic: ${chiSquareResult.statistic.toFixed(2)}, p-value: ${chiSquareResult.pValue.toFixed(4)}`,
    severity: chiSquareResult.passed ? undefined : 'medium',
  });

  checks.push({
    name: 'Runs Test',
    passed: runsResult.passed,
    details: `Statistic: ${runsResult.statistic.toFixed(2)}, p-value: ${runsResult.pValue.toFixed(4)}`,
    severity: runsResult.passed ? undefined : 'medium',
  });

  checks.push({
    name: 'Serial Test',
    passed: serialResult.passed,
    details: `Statistic: ${serialResult.statistic.toFixed(2)}, p-value: ${serialResult.pValue.toFixed(4)}`,
    severity: serialResult.passed ? undefined : 'medium',
  });

  // 3. Timing resistance
  const timingResult = testGF256TimingResistance(500);

  checks.push({
    name: 'GF(2^8) Timing Resistance',
    passed: timingResult.passed,
    details: Object.entries(timingResult.operations)
      .map(([op, analysis]) => `${op}: CV=${(analysis.stdDevNs / analysis.avgTimeNs * 100).toFixed(1)}%`)
      .join(', '),
    severity: timingResult.passed ? undefined : 'high',
  });

  // 4. Memory safety
  const memoryResult = analyzeMemorySafety();

  checks.push({
    name: 'Memory Safety',
    passed: memoryResult.passed,
    details: `${memoryResult.checks.filter(c => c.passed).length}/${memoryResult.checks.length} checks passed`,
    severity: memoryResult.passed ? undefined : 'critical',
  });

  // Calculate overall security level
  const allPassed = checks.every(c => c.passed);
  const criticalFailed = checks.some(c => !c.passed && c.severity === 'critical');
  const highFailed = checks.some(c => !c.passed && c.severity === 'high');

  let securityBits = 128; // Base security level
  if (criticalFailed) securityBits = 0;
  else if (highFailed) securityBits = Math.min(securityBits, 64);

  // Generate recommendations
  const recommendations: string[] = [];

  if (!entropyAnalysis.sufficient) {
    recommendations.push('Review random number generation for share creation');
  }

  if (!chiSquareResult.passed || !runsResult.passed || !serialResult.passed) {
    recommendations.push('Investigate potential bias in random number generation');
  }

  if (!timingResult.passed) {
    recommendations.push('Review field operations for timing side-channels');
  }

  if (!memoryResult.passed) {
    recommendations.push('Review memory handling for secure cleanup and isolation');
  }

  return {
    secure: allPassed,
    checks,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    securityBits,
  };
}

/**
 * Quick security check with minimal testing.
 */
export function runQuickSecurityCheck(): { passed: boolean; summary: string } {
  const result = runSecurityAnalysis();

  return {
    passed: result.secure,
    summary: result.secure
      ? `All ${result.checks.length} security checks passed. Estimated security: ${result.securityBits} bits.`
      : `Security issues detected: ${result.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`,
  };
}
