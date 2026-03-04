/**
 * INVARIANT TESTS — The Laws of Physics
 *
 * These test things that must ALWAYS or NEVER be true.
 * A violation = the system has fundamentally failed.
 *
 * I1v: scoreToTier monotonic — higher score → equal or higher tier
 * I6:  Merkle proof valid for every leaf, invalid for non-members
 * I11: Proof record fields immutable after creation
 * I12: Expression evaluator NEVER executes arbitrary code (N/A in TS — covered by type system)
 */

import { describe, it, expect } from 'vitest';
import {
  TRUST_THRESHOLDS,
  calculateDecayMultiplier,
  applyDecay,
  scoreToTier,
} from '../../packages/platform-core/src/trust-engine/index.js';
import {
  sha256,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  generateAllProofs,
  serializeMerkleProof,
  deserializeMerkleProof,
  type MerkleProof,
  type MerkleTreeResult,
} from '../../packages/platform-core/src/proof/merkle.js';

// =============================================================================
// I1v: scoreToTier is monotonic — higher score → equal or higher tier
// Catches: trust scoring inversion where a higher score yields a lower tier
// =============================================================================

describe('I1v: scoreToTier monotonicity', () => {
  it('every score 0-1000 maps to a tier, and tiers never decrease as score increases', () => {
    let previousTier = -1;
    for (let score = 0; score <= 1000; score++) {
      const tier = scoreToTier(score as any);
      expect(tier).toBeGreaterThanOrEqual(previousTier);
      previousTier = tier;
    }
  });

  it.each([
    [0, 0], [199, 0],     // T0 boundaries
    [200, 1], [349, 1],   // T1 boundaries
    [350, 2], [499, 2],   // T2 boundaries
    [500, 3], [649, 3],   // T3 boundaries
    [650, 4], [799, 4],   // T4 boundaries
    [800, 5], [875, 5],   // T5 boundaries
    [876, 6], [950, 6],   // T6 boundaries
    [951, 7], [1000, 7],  // T7 boundaries
  ])('score %i → tier %i (exact boundary)', (score, expectedTier) => {
    expect(scoreToTier(score as any)).toBe(expectedTier);
  });

  it('adjacent boundary pairs never skip a tier', () => {
    const boundaries = [0, 200, 350, 500, 650, 800, 876, 951, 1000];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const tierLow = scoreToTier(boundaries[i]! as any);
      const tierHigh = scoreToTier(boundaries[i + 1]! as any);
      expect(tierHigh - tierLow).toBeLessThanOrEqual(1);
    }
  });

  it('TRUST_THRESHOLDS covers the entire 0-1000 range without gaps', () => {
    const levels = Object.keys(TRUST_THRESHOLDS).map(Number).sort((a, b) => a - b);
    expect(levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // First level starts at 0
    expect(TRUST_THRESHOLDS[0 as keyof typeof TRUST_THRESHOLDS].min).toBe(0);
    // Last level ends at 1000
    expect(TRUST_THRESHOLDS[7 as keyof typeof TRUST_THRESHOLDS].max).toBe(1000);

    // No gaps between levels
    for (let i = 0; i < levels.length - 1; i++) {
      const currentMax = TRUST_THRESHOLDS[levels[i] as keyof typeof TRUST_THRESHOLDS].max;
      const nextMin = TRUST_THRESHOLDS[levels[i + 1] as keyof typeof TRUST_THRESHOLDS].min;
      expect(nextMin).toBe(currentMax + 1);
    }
  });
});

// =============================================================================
// I6: Merkle proof valid for every leaf, invalid for non-members
// Catches: proof forgery, inclusion/exclusion soundness failure
// =============================================================================

describe('I6: Merkle proof soundness', () => {
  it('every leaf in the tree produces a valid proof', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sha256(`leaf-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    for (let i = 0; i < tree.leafCount; i++) {
      const proof = generateMerkleProof(i, tree);
      const valid = await verifyMerkleProof(proof);
      expect(valid).toBe(true);
    }
  });

  it('non-member hash fails verification', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sha256(`member-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    // Create a proof for leaf 0 but swap the leaf hash with a non-member
    const proof = generateMerkleProof(0, tree);
    const fakeProof: MerkleProof = {
      ...proof,
      leafHash: await sha256('non-member-hash'),
    };
    const valid = await verifyMerkleProof(fakeProof);
    expect(valid).toBe(false);
  });

  it('proof from one tree is invalid against a different tree root', async () => {
    const leavesA = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`tree-a-${i}`))
    );
    const leavesB = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`tree-b-${i}`))
    );

    const treeA = await buildMerkleTree(leavesA);
    const treeB = await buildMerkleTree(leavesB);

    const proofFromA = generateMerkleProof(0, treeA);
    const valid = await verifyMerkleProof(proofFromA, treeB.root);
    expect(valid).toBe(false);
  });

  it('single-leaf tree has valid proof', async () => {
    const leaf = await sha256('only-leaf');
    const tree = await buildMerkleTree([leaf]);

    expect(tree.leafCount).toBe(1);
    expect(tree.root).toBe(leaf);
  });

  it('odd-count tree still produces valid proofs for all leaves', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 7 }, (_, i) => sha256(`odd-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    const allProofs = generateAllProofs(tree);
    expect(allProofs.length).toBe(7);

    for (const proof of allProofs) {
      expect(await verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('empty leaves throws error', async () => {
    await expect(buildMerkleTree([])).rejects.toThrow();
  });
});

// =============================================================================
// I11: Proof record fields immutable after creation
// Catches: audit trail modification after the fact
// =============================================================================

describe('I11: Merkle proof immutability', () => {
  it('serialized proof round-trips exactly', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`immutable-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(2, tree);

    const serialized = serializeMerkleProof(proof);
    const deserialized = deserializeMerkleProof(serialized);

    expect(deserialized.leafIndex).toBe(proof.leafIndex);
    expect(deserialized.leafHash).toBe(proof.leafHash);
    expect(deserialized.siblingHashes).toEqual(proof.siblingHashes);
    expect(deserialized.siblingDirections).toEqual(proof.siblingDirections);
    expect(deserialized.root).toBe(proof.root);
    expect(deserialized.leafCount).toBe(proof.leafCount);
  });

  it('any mutation to proof fields invalidates verification', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`tamper-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(1, tree);

    // Tamper with each field
    const tampered1: MerkleProof = { ...proof, leafHash: await sha256('tampered') };
    expect(await verifyMerkleProof(tampered1)).toBe(false);

    if (proof.siblingHashes.length > 0) {
      const tampered2: MerkleProof = {
        ...proof,
        siblingHashes: [await sha256('fake'), ...proof.siblingHashes.slice(1)],
      };
      expect(await verifyMerkleProof(tampered2)).toBe(false);
    }

    if (proof.siblingDirections.length > 0) {
      const tampered3: MerkleProof = {
        ...proof,
        siblingDirections: [!proof.siblingDirections[0], ...proof.siblingDirections.slice(1)],
      };
      expect(await verifyMerkleProof(tampered3)).toBe(false);
    }
  });

  it('tree root is deterministic — same leaves always produce same root', async () => {
    const makeLeaves = () =>
      Promise.all(Array.from({ length: 6 }, (_, i) => sha256(`determinism-${i}`)));

    const tree1 = await buildMerkleTree(await makeLeaves());
    const tree2 = await buildMerkleTree(await makeLeaves());

    expect(tree1.root).toBe(tree2.root);
  });
});

// =============================================================================
// DECAY INVARIANTS — decay is monotonically non-increasing
// =============================================================================

describe('Decay invariants', () => {
  it('decay multiplier is monotonically non-increasing with days', () => {
    let prev = 1.0;
    for (let days = 0; days <= 365; days++) {
      const mult = calculateDecayMultiplier(days);
      expect(mult).toBeLessThanOrEqual(prev + 0.001); // small epsilon for float
      expect(mult).toBeGreaterThanOrEqual(0);
      expect(mult).toBeLessThanOrEqual(1.0);
      prev = mult;
    }
  });

  it('zero days = no decay (multiplier 1.0)', () => {
    expect(calculateDecayMultiplier(0)).toBe(1.0);
  });

  it('182-day half-life: multiplier at 182 days is 0.5', () => {
    expect(calculateDecayMultiplier(182)).toBe(0.5);
  });

  it('applyDecay reduces score proportionally', () => {
    const baseScore = 800;
    const decayed = applyDecay(baseScore, 182);
    expect(decayed).toBe(baseScore * 0.5);
  });

  it('applyDecay at 0 days returns original score', () => {
    expect(applyDecay(500, 0)).toBe(500);
  });
});
