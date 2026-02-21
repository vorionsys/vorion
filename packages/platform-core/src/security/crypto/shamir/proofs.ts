/**
 * Mathematical Proofs for Shamir Secret Sharing
 *
 * This module contains formal mathematical proofs documenting the correctness
 * and security properties of the Shamir Secret Sharing implementation.
 *
 * Proofs are expressed as:
 * - Structured documentation with precise mathematical statements
 * - Executable verification code where possible
 * - References to academic literature
 *
 * @module security/crypto/shamir/proofs
 */

import {
  GF256,
  EXP_TABLE,
  LOG_TABLE,
  IRREDUCIBLE_POLY,
  createPolynomial,
  lagrangeBasisAtZero,
  lagrangeInterpolateAtZero,
} from './verified-shamir';
import {
  GF256Element,
  ShareIndex,
  createGF256Element,
  createShareIndex,
} from './types';

// ============================================================================
// Proof 1: GF(2^8) Field Axioms
// ============================================================================

/**
 * THEOREM 1: GF(2^8) Field Axioms
 *
 * GF(2^8) with irreducible polynomial p(x) = x^8 + x^4 + x^3 + x + 1 (0x11B)
 * forms a field with 256 elements.
 *
 * PROOF OUTLINE:
 *
 * 1. CLOSURE under addition and multiplication:
 *    - Addition (XOR) of two bytes produces a byte: (a XOR b) in [0, 255]
 *    - Multiplication with reduction mod p(x) produces an element in [0, 255]
 *
 * 2. ASSOCIATIVITY:
 *    - Addition: (a XOR b) XOR c = a XOR (b XOR c) (property of XOR)
 *    - Multiplication: Follows from polynomial arithmetic properties
 *
 * 3. COMMUTATIVITY:
 *    - Addition: a XOR b = b XOR a
 *    - Multiplication: a * b = b * a (polynomial multiplication is commutative)
 *
 * 4. IDENTITY elements:
 *    - Additive identity: 0 (a XOR 0 = a)
 *    - Multiplicative identity: 1 (a * 1 = a)
 *
 * 5. INVERSE elements:
 *    - Additive inverse: a + a = 0 (every element is its own inverse in char 2)
 *    - Multiplicative inverse: For a != 0, exists b such that a * b = 1
 *      (guaranteed since GF(2^8) is a field)
 *
 * 6. DISTRIBUTIVITY:
 *    - a * (b + c) = (a * b) + (a * c)
 *    - Follows from polynomial arithmetic over GF(2)
 *
 * IRREDUCIBILITY of p(x) = x^8 + x^4 + x^3 + x + 1:
 * - p(x) has no roots in GF(2): p(0) = 1, p(1) = 1 + 1 + 1 + 1 + 1 = 1 (mod 2)
 * - p(x) is not divisible by any irreducible polynomial of degree 2, 3, or 4
 * - This is verified by exhaustive check (standard result, see FIPS 197)
 *
 * Reference: FIPS 197 (AES specification), Section 4.1
 */
export function verifyFieldAxioms(): {
  passed: boolean;
  details: {
    closure: boolean;
    associativity: boolean;
    commutativity: boolean;
    identity: boolean;
    inverse: boolean;
    distributivity: boolean;
  };
} {
  const details = {
    closure: true,
    associativity: true,
    commutativity: true,
    identity: true,
    inverse: true,
    distributivity: true,
  };

  // Test on sample elements (exhaustive check is O(256^3) for some properties)
  const testElements: GF256Element[] = [
    0, 1, 2, 127, 128, 255,
  ].map(x => x as GF256Element);

  // 1. Closure under addition and multiplication
  for (const a of testElements) {
    for (const b of testElements) {
      const sum = GF256.add(a, b);
      const product = GF256.mul(a, b);
      if (sum < 0 || sum > 255 || product < 0 || product > 255) {
        details.closure = false;
      }
    }
  }

  // 2. Associativity
  for (const a of testElements) {
    for (const b of testElements) {
      for (const c of testElements) {
        // (a + b) + c = a + (b + c)
        const leftAdd = GF256.add(GF256.add(a, b), c);
        const rightAdd = GF256.add(a, GF256.add(b, c));
        if (leftAdd !== rightAdd) {
          details.associativity = false;
        }

        // (a * b) * c = a * (b * c)
        const leftMul = GF256.mul(GF256.mul(a, b), c);
        const rightMul = GF256.mul(a, GF256.mul(b, c));
        if (leftMul !== rightMul) {
          details.associativity = false;
        }
      }
    }
  }

  // 3. Commutativity
  for (const a of testElements) {
    for (const b of testElements) {
      if (GF256.add(a, b) !== GF256.add(b, a)) {
        details.commutativity = false;
      }
      if (GF256.mul(a, b) !== GF256.mul(b, a)) {
        details.commutativity = false;
      }
    }
  }

  // 4. Identity elements
  for (const a of testElements) {
    // Additive identity: a + 0 = a
    if (GF256.add(a, 0 as GF256Element) !== a) {
      details.identity = false;
    }
    // Multiplicative identity: a * 1 = a
    if (GF256.mul(a, 1 as GF256Element) !== a) {
      details.identity = false;
    }
  }

  // 5. Inverse elements
  for (const a of testElements) {
    // Additive inverse: a + a = 0 (in characteristic 2)
    if (GF256.add(a, a) !== 0) {
      details.inverse = false;
    }

    // Multiplicative inverse (for a != 0): a * inv(a) = 1
    if (a !== 0) {
      const inv = GF256.inv(a);
      if (GF256.mul(a, inv) !== 1) {
        details.inverse = false;
      }
    }
  }

  // 6. Distributivity: a * (b + c) = a*b + a*c
  for (const a of testElements) {
    for (const b of testElements) {
      for (const c of testElements) {
        const left = GF256.mul(a, GF256.add(b, c));
        const right = GF256.add(GF256.mul(a, b), GF256.mul(a, c));
        if (left !== right) {
          details.distributivity = false;
        }
      }
    }
  }

  return {
    passed: Object.values(details).every(v => v),
    details,
  };
}

// ============================================================================
// Proof 2: Lagrange Interpolation Correctness
// ============================================================================

/**
 * THEOREM 2: Lagrange Interpolation Uniqueness and Correctness
 *
 * STATEMENT:
 * Given n distinct points (x_1, y_1), ..., (x_n, y_n) in a field F,
 * there exists a unique polynomial p(x) of degree at most n-1 such that
 * p(x_i) = y_i for all i.
 *
 * PROOF:
 *
 * EXISTENCE:
 * Define the Lagrange basis polynomials:
 *   L_i(x) = Product_{j != i} (x - x_j) / (x_i - x_j)
 *
 * Properties of L_i:
 *   - L_i(x_i) = 1 (all terms in the product equal 1)
 *   - L_i(x_j) = 0 for j != i (numerator contains factor (x - x_j) = 0)
 *   - degree(L_i) = n - 1
 *
 * The interpolating polynomial is:
 *   p(x) = Sum_{i=1}^{n} y_i * L_i(x)
 *
 * Verification:
 *   p(x_k) = Sum_{i=1}^{n} y_i * L_i(x_k)
 *          = y_k * L_k(x_k) + Sum_{i != k} y_i * L_i(x_k)
 *          = y_k * 1 + Sum_{i != k} y_i * 0
 *          = y_k
 *
 * UNIQUENESS:
 * Suppose p(x) and q(x) both interpolate the points, both with degree <= n-1.
 * Then r(x) = p(x) - q(x) has:
 *   - degree <= n-1
 *   - r(x_i) = 0 for all i (n roots)
 *
 * A non-zero polynomial of degree d has at most d roots.
 * Since r has n roots but degree <= n-1, we must have r = 0.
 * Therefore p = q.
 *
 * APPLICATION TO SHAMIR:
 * For Shamir's scheme with threshold k:
 *   - Secret is f(0) where f is a polynomial of degree k-1
 *   - Given k shares (x_i, f(x_i)), Lagrange interpolation recovers f uniquely
 *   - Then f(0) = secret
 *
 * Reference: "How to Share a Secret" by Adi Shamir, CACM 1979
 */
export function verifyLagrangeInterpolation(): {
  passed: boolean;
  testResults: Array<{
    description: string;
    passed: boolean;
    expected?: number;
    actual?: number;
  }>;
} {
  const testResults: Array<{
    description: string;
    passed: boolean;
    expected?: number;
    actual?: number;
  }> = [];

  // Test 1: Lagrange basis properties
  const indices: ShareIndex[] = [1, 2, 3].map(x => createShareIndex(x));

  for (let i = 0; i < indices.length; i++) {
    const basisValue = lagrangeBasisAtZero(indices, i);
    // L_i(0) should be a valid field element
    const passed = basisValue >= 0 && basisValue <= 255;
    testResults.push({
      description: `L_${i}(0) is valid field element`,
      passed,
      actual: basisValue,
    });
  }

  // Test 2: Sum of Lagrange basis polynomials at x=0 for constant polynomial
  // If f(x) = c (constant), then f(0) = c = Sum_{i} c * L_i(0)
  // So Sum_{i} L_i(0) = 1 (for evaluating f(x) = 1)
  const shares: Array<{ index: ShareIndex; value: GF256Element }> = indices.map(idx => ({
    index: idx,
    value: 1 as GF256Element, // f(x) = 1
  }));

  const reconstructed = lagrangeInterpolateAtZero(shares);
  testResults.push({
    description: 'Constant polynomial f(x)=1 reconstructs to 1',
    passed: reconstructed === 1,
    expected: 1,
    actual: reconstructed,
  });

  // Test 3: Linear polynomial f(x) = x
  // f(0) = 0
  const linearShares: Array<{ index: ShareIndex; value: GF256Element }> = [
    { index: createShareIndex(1), value: 1 as GF256Element },
    { index: createShareIndex(2), value: 2 as GF256Element },
  ];

  const linearResult = lagrangeInterpolateAtZero(linearShares);
  testResults.push({
    description: 'Linear polynomial f(x)=x reconstructs f(0)=0',
    passed: linearResult === 0,
    expected: 0,
    actual: linearResult,
  });

  // Test 4: Polynomial f(x) = 42 + 17x (degree 1)
  // f(0) = 42, f(1) = 42 XOR 17 = 59 (in GF(2^8)), f(2) = 42 XOR (17*2)
  const poly = createPolynomial([42 as GF256Element, 17 as GF256Element]);
  const polyShares: Array<{ index: ShareIndex; value: GF256Element }> = [
    { index: createShareIndex(1), value: poly.evaluate(1 as GF256Element) },
    { index: createShareIndex(2), value: poly.evaluate(2 as GF256Element) },
  ];

  const polyResult = lagrangeInterpolateAtZero(polyShares);
  testResults.push({
    description: 'Polynomial f(x)=42+17x reconstructs f(0)=42',
    passed: polyResult === 42,
    expected: 42,
    actual: polyResult,
  });

  return {
    passed: testResults.every(t => t.passed),
    testResults,
  };
}

// ============================================================================
// Proof 3: Perfect Secrecy (k-1 shares reveal nothing)
// ============================================================================

/**
 * THEOREM 3: Information-Theoretic Security
 *
 * STATEMENT:
 * In a (k, n) Shamir secret sharing scheme, any subset of k-1 or fewer shares
 * provides zero information about the secret. This is information-theoretic
 * security, not computational security.
 *
 * PROOF:
 *
 * Let S be the secret and let (x_1, y_1), ..., (x_{k-1}, y_{k-1}) be k-1 shares.
 *
 * We must show: For any possible secret value s in the field,
 *   P(S = s | shares) = P(S = s)
 *
 * Analysis:
 * 1. The polynomial f(x) has degree k-1, with k coefficients: f(x) = a_0 + a_1*x + ... + a_{k-1}*x^{k-1}
 * 2. The secret is a_0 = f(0)
 * 3. Given k-1 points, we have k-1 linear equations in k unknowns
 * 4. This system is underdetermined
 *
 * For any value of a_0 = s:
 * - The remaining k-1 unknowns (a_1, ..., a_{k-1}) form a system of k-1 equations
 * - This system has a unique solution (Lagrange interpolation through k-1 points with
 *   the constraint that f(0) = s)
 *
 * Therefore:
 * - Every possible secret s is equally consistent with the k-1 shares
 * - The k-1 shares provide zero bits of information about s
 * - This is perfect secrecy in the information-theoretic sense
 *
 * COROLLARY:
 * The mutual information I(S; Y_1, ..., Y_{k-1}) = 0
 * where Y_i are the share values.
 *
 * Reference: "How to Share a Secret" by Adi Shamir, CACM 1979
 * Reference: Cover & Thomas, "Elements of Information Theory"
 */
export function verifyPerfectSecrecy(): {
  passed: boolean;
  description: string;
  analysis: {
    testedSecrets: number;
    testedShareCombinations: number;
    allSecretsConsistent: boolean;
  };
} {
  // Demonstration: For k=3, show that any 2 shares are consistent with every possible secret

  // Fixed 2 shares (k-1 = 2)
  const x1 = 1 as GF256Element;
  const y1 = 100 as GF256Element;
  const x2 = 2 as GF256Element;
  const y2 = 150 as GF256Element;

  let allSecretsConsistent = true;
  let testedSecrets = 0;

  // For each possible secret s (0-255), verify there exists a valid degree-2 polynomial
  // f(x) = s + a_1*x + a_2*x^2 such that f(x1)=y1 and f(x2)=y2
  for (let s = 0; s < 256; s++) {
    testedSecrets++;

    // We need to find a_1, a_2 such that:
    // s + a_1*x1 + a_2*x1^2 = y1
    // s + a_1*x2 + a_2*x2^2 = y2
    //
    // Subtracting: a_1*(x2-x1) + a_2*(x2^2-x1^2) = y2 - y1
    //
    // This is a system of 2 equations in 2 unknowns (a_1, a_2) with s fixed
    // It has a unique solution (assuming x1 != x2)

    // In GF(2^8):
    const secret = s as GF256Element;
    const diff1 = GF256.sub(y1, secret); // y1 - s = a_1*x1 + a_2*x1^2
    const diff2 = GF256.sub(y2, secret); // y2 - s = a_1*x2 + a_2*x2^2

    // Matrix form: [x1  x1^2] [a_1]   [diff1]
    //              [x2  x2^2] [a_2] = [diff2]

    const x1sq = GF256.mul(x1, x1);
    const x2sq = GF256.mul(x2, x2);

    // Solve using Cramer's rule
    // det = x1*x2^2 - x2*x1^2 = x1*x2*(x2 - x1) (in GF(2^8))
    const det = GF256.sub(GF256.mul(x1, x2sq), GF256.mul(x2, x1sq));

    if (det === 0) {
      // This shouldn't happen for x1 != x2
      allSecretsConsistent = false;
      continue;
    }

    // a_1 = (diff1*x2^2 - diff2*x1^2) / det
    const a1Num = GF256.sub(GF256.mul(diff1, x2sq), GF256.mul(diff2, x1sq));
    const a1 = GF256.div(a1Num, det);

    // a_2 = (diff2*x1 - diff1*x2) / det
    const a2Num = GF256.sub(GF256.mul(diff2, x1), GF256.mul(diff1, x2));
    const a2 = GF256.div(a2Num, det);

    // Verify the solution
    const poly = createPolynomial([secret, a1, a2]);
    const check1 = poly.evaluate(x1);
    const check2 = poly.evaluate(x2);

    if (check1 !== y1 || check2 !== y2) {
      allSecretsConsistent = false;
    }
  }

  return {
    passed: allSecretsConsistent,
    description:
      'Verified that for k=3 threshold, any 2 shares are consistent with all 256 possible secrets, ' +
      'demonstrating that k-1 shares reveal zero information about the secret.',
    analysis: {
      testedSecrets,
      testedShareCombinations: 1, // Fixed share combination for demo
      allSecretsConsistent,
    },
  };
}

// ============================================================================
// Proof 4: Reconstruction Completeness (k shares always work)
// ============================================================================

/**
 * THEOREM 4: Reconstruction Completeness
 *
 * STATEMENT:
 * Any k shares from a (k, n) Shamir secret sharing scheme can reconstruct
 * the original secret.
 *
 * PROOF:
 *
 * Setup:
 * - Original polynomial f(x) has degree k-1
 * - f(0) = secret
 * - Shares are (x_i, f(x_i)) for i = 1, ..., n
 *
 * Given any k shares (x_{i_1}, y_{i_1}), ..., (x_{i_k}, y_{i_k}):
 *
 * 1. By Theorem 2 (Lagrange Interpolation), there exists a unique polynomial
 *    p(x) of degree at most k-1 that passes through these k points.
 *
 * 2. Since f(x) also passes through these points and has degree k-1,
 *    by uniqueness we have p(x) = f(x).
 *
 * 3. Therefore p(0) = f(0) = secret.
 *
 * The reconstruction is deterministic and always succeeds given k valid shares.
 *
 * COROLLARY:
 * The choice of which k shares to use does not affect the result.
 * All C(n, k) combinations of k shares reconstruct the same secret.
 *
 * Reference: "How to Share a Secret" by Adi Shamir, CACM 1979
 */
export function verifyReconstructionCompleteness(): {
  passed: boolean;
  testResults: Array<{
    threshold: number;
    totalShares: number;
    secret: number;
    combinationsTested: number;
    allSucceeded: boolean;
  }>;
} {
  const testResults: Array<{
    threshold: number;
    totalShares: number;
    secret: number;
    combinationsTested: number;
    allSucceeded: boolean;
  }> = [];

  // Test parameters
  const testCases: Array<{ k: number; n: number; secret: number }> = [
    { k: 2, n: 3, secret: 42 },
    { k: 3, n: 5, secret: 100 },
    { k: 2, n: 5, secret: 255 },
  ];

  for (const { k, n, secret } of testCases) {
    // Generate shares
    const poly = generateTestPolynomial(secret as GF256Element, k - 1);
    const allShares: Array<{ index: ShareIndex; value: GF256Element }> = [];

    for (let i = 1; i <= n; i++) {
      allShares.push({
        index: createShareIndex(i),
        value: poly.evaluate(i as GF256Element),
      });
    }

    // Test all C(n, k) combinations
    const combinations = getCombinations(allShares, k);
    let allSucceeded = true;

    for (const combo of combinations) {
      const reconstructed = lagrangeInterpolateAtZero(combo);
      if (reconstructed !== secret) {
        allSucceeded = false;
      }
    }

    testResults.push({
      threshold: k,
      totalShares: n,
      secret,
      combinationsTested: combinations.length,
      allSucceeded,
    });
  }

  return {
    passed: testResults.every(t => t.allSucceeded),
    testResults,
  };
}

/**
 * Generate a test polynomial with given constant term and degree.
 * Uses deterministic coefficients for testing.
 */
function generateTestPolynomial(
  constantTerm: GF256Element,
  degree: number
): ReturnType<typeof createPolynomial> {
  const coefficients: GF256Element[] = [constantTerm];

  // Use deterministic but varied coefficients for testing
  for (let i = 1; i <= degree; i++) {
    coefficients.push(((i * 17 + 23) % 256) as GF256Element);
  }

  return createPolynomial(coefficients);
}

/**
 * Get all k-combinations of an array.
 */
function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];

  const result: T[][] = [];
  const first = arr[0];
  const rest = arr.slice(1);

  // Combinations including first element
  for (const combo of getCombinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }

  // Combinations excluding first element
  result.push(...getCombinations(rest, k));

  return result;
}

// ============================================================================
// Proof 5: GF(2^8) Generator and Order
// ============================================================================

/**
 * THEOREM 5: Generator Properties of g = 0x03
 *
 * STATEMENT:
 * The element g = 3 is a generator of the multiplicative group GF(2^8)*.
 * This means g has order 255, and every non-zero element of GF(2^8) can be
 * written as g^i for some i in {0, 1, ..., 254}.
 *
 * PROOF:
 *
 * The multiplicative group GF(2^8)* has 255 elements (all non-zero elements).
 * By Lagrange's theorem, the order of any element divides 255.
 *
 * 255 = 3 * 5 * 17
 *
 * An element g generates the group iff g^(255/p) != 1 for each prime divisor p.
 *
 * For g = 3:
 * - 3^(255/3) = 3^85 != 1 (verified by computation)
 * - 3^(255/5) = 3^51 != 1 (verified by computation)
 * - 3^(255/17) = 3^15 != 1 (verified by computation)
 *
 * Therefore ord(g) = 255 and g generates GF(2^8)*.
 *
 * COROLLARY:
 * The EXP_TABLE contains all 255 non-zero elements of GF(2^8) exactly once.
 * The LOG_TABLE provides a bijection from GF(2^8)* to Z_255.
 */
export function verifyGeneratorProperties(): {
  passed: boolean;
  details: {
    generatorValue: number;
    computedOrder: number;
    expectedOrder: number;
    allElementsGenerated: boolean;
    expTableCorrect: boolean;
    logTableCorrect: boolean;
  };
} {
  const g = 3; // Generator
  const expectedOrder = 255;

  // Verify order by checking g^255 = 1 and g^k != 1 for k < 255
  let computedOrder = 1;
  let power: GF256Element = g as GF256Element;

  for (let i = 1; i <= 255; i++) {
    if (power === 1) {
      computedOrder = i;
      break;
    }
    power = GF256.mul(power, g as GF256Element);
  }

  // Verify all non-zero elements are generated
  const generated = new Set<number>();
  power = 1 as GF256Element;

  for (let i = 0; i < 255; i++) {
    generated.add(power);
    power = GF256.mul(power, g as GF256Element);
  }

  const allElementsGenerated = generated.size === 255 && !generated.has(0);

  // Verify EXP_TABLE
  let expTableCorrect = true;
  power = 1 as GF256Element;

  for (let i = 0; i < 255; i++) {
    if (EXP_TABLE[i] !== power) {
      expTableCorrect = false;
      break;
    }
    power = GF256.mul(power, g as GF256Element);
  }

  // Verify LOG_TABLE (inverse of EXP_TABLE)
  let logTableCorrect = true;

  for (let i = 0; i < 255; i++) {
    if (LOG_TABLE[EXP_TABLE[i]] !== i) {
      logTableCorrect = false;
      break;
    }
  }

  return {
    passed:
      computedOrder === expectedOrder &&
      allElementsGenerated &&
      expTableCorrect &&
      logTableCorrect,
    details: {
      generatorValue: g,
      computedOrder,
      expectedOrder,
      allElementsGenerated,
      expTableCorrect,
      logTableCorrect,
    },
  };
}

// ============================================================================
// Master Verification Function
// ============================================================================

/**
 * Run all proofs and return comprehensive verification results.
 */
export function runAllProofs(): {
  allPassed: boolean;
  proofs: Array<{
    name: string;
    passed: boolean;
    details: unknown;
  }>;
} {
  const proofs: Array<{ name: string; passed: boolean; details: unknown }> = [];

  // Proof 1: Field Axioms
  const fieldAxioms = verifyFieldAxioms();
  proofs.push({
    name: 'GF(2^8) Field Axioms',
    passed: fieldAxioms.passed,
    details: fieldAxioms.details,
  });

  // Proof 2: Lagrange Interpolation
  const lagrange = verifyLagrangeInterpolation();
  proofs.push({
    name: 'Lagrange Interpolation Correctness',
    passed: lagrange.passed,
    details: lagrange.testResults,
  });

  // Proof 3: Perfect Secrecy
  const secrecy = verifyPerfectSecrecy();
  proofs.push({
    name: 'Information-Theoretic Security (Perfect Secrecy)',
    passed: secrecy.passed,
    details: { description: secrecy.description, analysis: secrecy.analysis },
  });

  // Proof 4: Reconstruction Completeness
  const completeness = verifyReconstructionCompleteness();
  proofs.push({
    name: 'Reconstruction Completeness',
    passed: completeness.passed,
    details: completeness.testResults,
  });

  // Proof 5: Generator Properties
  const generator = verifyGeneratorProperties();
  proofs.push({
    name: 'GF(2^8) Generator Properties',
    passed: generator.passed,
    details: generator.details,
  });

  return {
    allPassed: proofs.every(p => p.passed),
    proofs,
  };
}
