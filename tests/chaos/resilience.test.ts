/**
 * CHAOS & RESILIENCE TESTS — Break Everything Gracefully
 *
 * C5: Merkle tree with large leaf counts — performance and correctness
 * C7: Concurrent tree operations — no corruption under parallel load
 */

import { describe, it, expect } from 'vitest';
import {
  sha256,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  generateAllProofs,
  aggregateProofs,
  serializeMerkleProof,
  deserializeMerkleProof,
} from '../../packages/platform-core/src/proof/merkle.js';

// =============================================================================
// C5: Large Merkle Trees — correctness at scale
// Catches: memory issues, incorrect proof generation for deep trees
// =============================================================================

describe('C5: Large Merkle tree resilience', () => {
  it('tree with 1000 leaves: all proofs valid', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 1000 }, (_, i) => sha256(`large-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(1000);
    expect(tree.root).toBeTruthy();

    // Spot-check proofs at boundaries
    const indices = [0, 1, 499, 500, 998, 999];
    for (const idx of indices) {
      const proof = generateMerkleProof(idx, tree);
      expect(await verifyMerkleProof(proof)).toBe(true);
    }
  }, 30000);

  it('tree with 2000 leaves: root is deterministic', async () => {
    const makeLeaves = () =>
      Promise.all(Array.from({ length: 2000 }, (_, i) => sha256(`det-${i}`)));

    const tree1 = await buildMerkleTree(await makeLeaves());
    const tree2 = await buildMerkleTree(await makeLeaves());

    expect(tree1.root).toBe(tree2.root);
    expect(tree1.leafCount).toBe(tree2.leafCount);
  }, 30000);

  it('tree depth is correct (log2 of leaf count)', async () => {
    const sizes = [2, 4, 8, 16, 32];
    for (const size of sizes) {
      const leaves = await Promise.all(
        Array.from({ length: size }, (_, i) => sha256(`depth-${size}-${i}`))
      );
      const tree = await buildMerkleTree(leaves);

      // For power-of-2 sizes, depth = log2(size) + 1 (including leaf level)
      const expectedDepth = Math.log2(size) + 1;
      expect(tree.levels.length).toBe(expectedDepth);
    }
  });

  it('out-of-bounds leaf index throws', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`bounds-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    expect(() => generateMerkleProof(-1, tree)).toThrow();
    expect(() => generateMerkleProof(4, tree)).toThrow();
    expect(() => generateMerkleProof(100, tree)).toThrow();
  });

  it('aggregateProofs handles 100 proof records', async () => {
    const proofRecords = Array.from({ length: 100 }, (_, i) => ({
      id: `agg-proof-${i}`,
      hash: `agg-hash-${i}`,
    }));

    const tree = await aggregateProofs(proofRecords);
    expect(tree.leafCount).toBe(100);
    expect(tree.root).toBeTruthy();
    expect(tree.root.length).toBe(64); // SHA-256 hex string
  }, 15000);
});

// =============================================================================
// C7: Concurrent tree operations — no corruption under parallel load
// Catches: shared state corruption, race conditions in async operations
// =============================================================================

describe('C7: Concurrent Merkle operations', () => {
  it('10 trees built concurrently produce correct independent roots', async () => {
    const treePromises = Array.from({ length: 10 }, async (_, treeIdx) => {
      const leaves = await Promise.all(
        Array.from({ length: 20 }, (_, leafIdx) =>
          sha256(`concurrent-tree-${treeIdx}-leaf-${leafIdx}`)
        )
      );
      return buildMerkleTree(leaves);
    });

    const trees = await Promise.all(treePromises);

    // All trees should have different roots (different leaf data)
    const roots = trees.map((t) => t.root);
    const uniqueRoots = new Set(roots);
    expect(uniqueRoots.size).toBe(10);

    // Each tree should still produce valid proofs
    for (const tree of trees) {
      const proof = generateMerkleProof(0, tree);
      expect(await verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('concurrent proof generation and verification on same tree', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 16 }, (_, i) => sha256(`shared-tree-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    // Generate and verify all proofs concurrently
    const verificationPromises = Array.from({ length: 16 }, async (_, i) => {
      const proof = generateMerkleProof(i, tree);
      const valid = await verifyMerkleProof(proof);
      return { index: i, valid };
    });

    const results = await Promise.all(verificationPromises);

    for (const result of results) {
      expect(result.valid).toBe(true);
    }
  });

  it('concurrent serialize/deserialize round-trips', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sha256(`serde-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const allProofs = generateAllProofs(tree);

    // Serialize and deserialize all proofs concurrently
    const roundTripPromises = allProofs.map(async (proof) => {
      const serialized = serializeMerkleProof(proof);
      const deserialized = deserializeMerkleProof(serialized);
      const valid = await verifyMerkleProof(deserialized);
      return { originalRoot: proof.root, deserializedRoot: deserialized.root, valid };
    });

    const results = await Promise.all(roundTripPromises);

    for (const result of results) {
      expect(result.originalRoot).toBe(result.deserializedRoot);
      expect(result.valid).toBe(true);
    }
  });

  it('concurrent aggregateProofs calls do not interfere', async () => {
    const batchA = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-a-${i}`,
      hash: `hash-a-${i}`,
    }));
    const batchB = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-b-${i}`,
      hash: `hash-b-${i}`,
    }));

    const [treeA, treeB] = await Promise.all([
      aggregateProofs(batchA),
      aggregateProofs(batchB),
    ]);

    // Different inputs → different roots
    expect(treeA.root).not.toBe(treeB.root);
    expect(treeA.leafCount).toBe(10);
    expect(treeB.leafCount).toBe(10);
  });
});
