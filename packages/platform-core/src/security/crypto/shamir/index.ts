/**
 * Verified Shamir Secret Sharing
 *
 * A formally verified implementation of Shamir's Secret Sharing scheme
 * with comprehensive testing, mathematical proofs, and security analysis.
 *
 * This module provides:
 * - GF(2^8) arithmetic with proven correctness
 * - Polynomial evaluation with overflow protection
 * - Lagrange interpolation with numerical stability
 * - Constant-time operations to prevent timing attacks
 * - Input validation with mathematical bounds checking
 *
 * Security Properties:
 * - Information-theoretic security: k-1 shares reveal nothing
 * - Perfect secrecy: each share is uniformly random
 * - Constant-time: resistant to timing side-channel attacks
 *
 * @example
 * ```typescript
 * import { split, reconstruct } from './security/crypto/shamir';
 *
 * // Split a secret into 5 shares with threshold 3
 * const secret = new TextEncoder().encode('my-secret-key');
 * const { shares } = split(secret, {
 *   threshold: 3,
 *   totalShares: 5,
 *   secretLength: secret.length,
 * });
 *
 * // Reconstruct with any 3 shares
 * const { secret: recovered } = reconstruct(shares.slice(0, 3), 3);
 * ```
 *
 * @module security/crypto/shamir
 */

// ============================================================================
// Core Types
// ============================================================================

export {
  // Type brands
  ShareIndex,
  GF256Element,

  // Core interfaces
  VerifiedShare,
  ShamirParams,
  ShamirConfig,
  ShareMetadata,
  ShareValidationResult,
  ReconstructionResult,
  SplitResult,

  // Field types
  GF256Operations,
  GF256Polynomial,

  // Test and analysis types
  TestVector,
  SecurityAnalysisResult,
  SecurityCheck,
  EntropyAnalysis,
  TimingAnalysis,

  // Type guards and factories
  isShareIndex,
  isGF256Element,
  createShareIndex,
  createGF256Element,
  validateShamirParams,
} from './types.js';

// ============================================================================
// Core Implementation
// ============================================================================

export {
  // Field operations
  GF256,
  EXP_TABLE,
  LOG_TABLE,
  IRREDUCIBLE_POLY,

  // Polynomial operations
  createPolynomial,
  generateRandomPolynomial,

  // Lagrange interpolation
  lagrangeBasisAtZero,
  lagrangeInterpolateAtZero,

  // Main operations
  split,
  reconstruct,

  // Validation
  validateShare,
  verifyShareCompatibility,

  // Constant-time utilities
  constantTimeSelect,
  constantTimeEqual,
} from './verified-shamir.js';

// ============================================================================
// Mathematical Proofs
// ============================================================================

export {
  verifyFieldAxioms,
  verifyLagrangeInterpolation,
  verifyPerfectSecrecy,
  verifyReconstructionCompleteness,
  verifyGeneratorProperties,
  runAllProofs,
} from './proofs.js';

// ============================================================================
// Test Vectors
// ============================================================================

export {
  // Test vector collections
  NIST_STYLE_VECTORS,
  EDGE_CASE_VECTORS,
  ACADEMIC_VECTORS,
  GF256_OPERATION_VECTORS,
  POLYNOMIAL_VECTORS,
  LAGRANGE_VECTORS,
  ALL_TEST_VECTORS,

  // Test vector types
  GF256TestVector,
  PolynomialTestVector,
  LagrangeTestVector,

  // Verification functions
  verifyGF256Vector,
  verifyPolynomialVector,
  runAllTestVectors,
  generateDeterministicShares,
} from './test-vectors.js';

// ============================================================================
// Property-Based Testing
// ============================================================================

export {
  // Individual property tests
  testReconstructionCompleteness,
  testInformationTheoreticSecurity,
  testShareOrderIndependence,
  testReconstructionIdempotency,
  testShareSubsetEquivalence,
  testLagrangeBasisPartition,

  // Test suite runners
  runAllPropertyTests,
  runQuickPropertyTests,

  // Result types
  PropertyTestResult,
  PropertyTestSuite,
} from './property-tests.js';

// ============================================================================
// Security Analysis
// ============================================================================

export {
  // Entropy analysis
  calculateShannonEntropy,
  calculateMinEntropy,
  analyzeShareEntropy,

  // Statistical tests
  chiSquareTest,
  runsTest,
  serialTest,

  // Timing analysis
  analyzeTimings,
  testGF256TimingResistance,
  testReconstructionTimingResistance,

  // Memory safety
  analyzeMemorySafety,

  // Comprehensive analysis
  runSecurityAnalysis,
  runQuickSecurityCheck,
} from './security-analysis.js';

// ============================================================================
// Interoperability
// ============================================================================

export {
  // Vault compatibility
  VaultShare,
  toVaultFormat,
  fromVaultFormat,
  verifyVaultCompatibility,

  // secrets.js compatibility
  SecretsJsShare,
  toSecretsJsFormat,
  fromSecretsJsFormat,
  verifySecretsJsCompatibility,

  // Cross-implementation testing
  generateInteropTestVectors,
  runInteroperabilityTests,
  getCompatibilityReport,
  IMPLEMENTATION_DIFFERENCES,
} from './comparison.js';

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run all verification and testing suites.
 *
 * @returns Comprehensive verification results
 */
export async function runFullVerification(): Promise<{
  proofs: { allPassed: boolean; proofs: unknown[] };
  testVectors: { passed: boolean; summary: unknown };
  propertyTests: { allPassed: boolean; totalIterations: number };
  securityAnalysis: { secure: boolean; checks: unknown[] };
  interoperability: { allCompatible: boolean };
}> {
  // Import dynamically to avoid circular dependencies
  const { runAllProofs } = await import('./proofs.js');
  const { runAllTestVectors } = await import('./test-vectors.js');
  const { runQuickPropertyTests } = await import('./property-tests.js');
  const { runSecurityAnalysis } = await import('./security-analysis.js');
  const { runInteroperabilityTests } = await import('./comparison.js');

  const proofs = runAllProofs();
  const testVectors = runAllTestVectors();
  const propertyTests = runQuickPropertyTests();
  const securityAnalysis = runSecurityAnalysis();
  const interoperability = runInteroperabilityTests();

  return {
    proofs: {
      allPassed: proofs.allPassed,
      proofs: proofs.proofs,
    },
    testVectors: {
      passed: testVectors.passed,
      summary: testVectors.summary,
    },
    propertyTests: {
      allPassed: propertyTests.allPassed,
      totalIterations: propertyTests.totalIterations,
    },
    securityAnalysis: {
      secure: securityAnalysis.secure,
      checks: securityAnalysis.checks,
    },
    interoperability: {
      allCompatible: interoperability.allCompatible,
    },
  };
}

/**
 * Quick verification check for CI/CD pipelines.
 *
 * @returns Whether all quick checks pass
 */
export function runQuickVerification(): boolean {
  const { runAllProofs } = require('./proofs');
  const { runQuickPropertyTests } = require('./property-tests');
  const { runQuickSecurityCheck } = require('./security-analysis');

  const proofs = runAllProofs();
  const propertyTests = runQuickPropertyTests();
  const security = runQuickSecurityCheck();

  return proofs.allPassed && propertyTests.allPassed && security.passed;
}
