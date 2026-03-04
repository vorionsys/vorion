/**
 * ADVERSARIAL TESTS — What Would an Attacker Try?
 *
 * A7:  Merkle proof forgery — fabricated siblings, wrong tree, manipulated index
 * A13: Tree root manipulation — verify root integrity under attack
 */

import { describe, it, expect } from 'vitest';
import {
  sha256,
  hashPair,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  hashProofToLeaf,
  verifyProofInclusion,
  aggregateProofs,
  generateAllProofs,
  type MerkleProof,
} from '../../packages/platform-core/src/proof/merkle.js';

// =============================================================================
// A7: Merkle Proof Forgery
// Catches: fabricated sibling hashes, proofs from wrong trees, index manipulation
// =============================================================================

describe('A7: Merkle proof forgery attacks', () => {
  it('fabricated sibling hashes → verification fails', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sha256(`a7-real-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const realProof = generateMerkleProof(3, tree);

    // Replace all sibling hashes with fabricated ones
    const forgedProof: MerkleProof = {
      ...realProof,
      siblingHashes: await Promise.all(
        realProof.siblingHashes.map((_, i) => sha256(`forged-sibling-${i}`))
      ),
    };

    expect(await verifyMerkleProof(forgedProof)).toBe(false);
  });

  it('proof from a different tree → fails against original root', async () => {
    const leavesOriginal = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`original-${i}`))
    );
    const leavesAttacker = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`attacker-${i}`))
    );

    const originalTree = await buildMerkleTree(leavesOriginal);
    const attackerTree = await buildMerkleTree(leavesAttacker);

    // Attacker generates proof from their tree
    const attackerProof = generateMerkleProof(0, attackerTree);

    // Try to verify against original tree's root
    expect(await verifyMerkleProof(attackerProof, originalTree.root)).toBe(false);
  });

  it('manipulated leaf index → proof still checks against actual leaf hash', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sha256(`idx-${i}`))
    );
    const tree = await buildMerkleTree(leaves);

    const proof0 = generateMerkleProof(0, tree);
    const proof5 = generateMerkleProof(5, tree);

    // Take proof for index 0 but claim it's for index 5's leaf
    const swappedProof: MerkleProof = {
      ...proof0,
      leafHash: proof5.leafHash,
    };

    // Should fail because the sibling path is wrong for index 5's leaf
    expect(await verifyMerkleProof(swappedProof)).toBe(false);
  });

  it('flipped sibling direction → verification fails', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`dir-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(1, tree);

    // Flip all directions
    const flippedProof: MerkleProof = {
      ...proof,
      siblingDirections: proof.siblingDirections.map((d) => !d),
    };

    expect(await verifyMerkleProof(flippedProof)).toBe(false);
  });

  it('truncated sibling hashes → verification fails', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sha256(`trunc-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(2, tree);

    // Remove the last sibling hash (truncate the proof path)
    const truncatedProof: MerkleProof = {
      ...proof,
      siblingHashes: proof.siblingHashes.slice(0, -1),
      siblingDirections: proof.siblingDirections.slice(0, -1),
    };

    // Should fail — incomplete path can't reconstruct the root
    expect(await verifyMerkleProof(truncatedProof)).toBe(false);
  });

  it('extra sibling hash appended → verification fails', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`extra-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(0, tree);

    const extraHash = await sha256('extra-level');
    const extendedProof: MerkleProof = {
      ...proof,
      siblingHashes: [...proof.siblingHashes, extraHash],
      siblingDirections: [...proof.siblingDirections, true],
    };

    // Extra hash means the computed root won't match
    expect(await verifyMerkleProof(extendedProof)).toBe(false);
  });

  it('empty string leaf hash → cannot forge into real tree', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 4 }, (_, i) => sha256(`real-${i}`))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(0, tree);

    const emptyLeafProof: MerkleProof = {
      ...proof,
      leafHash: '',
    };

    expect(await verifyMerkleProof(emptyLeafProof)).toBe(false);
  });
});

// =============================================================================
// A13: Proof Aggregation Integrity
// Catches: manipulated proof inclusion, ID/hash mismatch
// =============================================================================

describe('A13: Proof aggregation integrity attacks', () => {
  it('verifyProofInclusion rejects wrong proof ID', async () => {
    const proofs = [
      { id: 'proof-1', hash: 'hash-1' },
      { id: 'proof-2', hash: 'hash-2' },
      { id: 'proof-3', hash: 'hash-3' },
    ];

    const tree = await aggregateProofs(proofs);
    const allProofs = generateAllProofs(tree);

    // Try to verify proof-1's inclusion using proof-2's ID
    const valid = await verifyProofInclusion(
      'proof-2',   // Wrong ID
      'hash-1',    // proof-1's hash
      allProofs[0]!, // proof-1's Merkle proof
      tree.root
    );
    expect(valid).toBe(false);
  });

  it('verifyProofInclusion rejects wrong proof hash', async () => {
    const proofs = [
      { id: 'proof-a', hash: 'hash-a' },
      { id: 'proof-b', hash: 'hash-b' },
    ];

    const tree = await aggregateProofs(proofs);
    const allProofs = generateAllProofs(tree);

    // Right ID but wrong hash
    const valid = await verifyProofInclusion(
      'proof-a',
      'tampered-hash',
      allProofs[0]!,
      tree.root
    );
    expect(valid).toBe(false);
  });

  it('valid proof inclusion succeeds for all aggregated proofs', async () => {
    const proofRecords = Array.from({ length: 5 }, (_, i) => ({
      id: `valid-proof-${i}`,
      hash: `valid-hash-${i}`,
    }));

    const tree = await aggregateProofs(proofRecords);
    const allProofs = generateAllProofs(tree);

    for (let i = 0; i < proofRecords.length; i++) {
      const valid = await verifyProofInclusion(
        proofRecords[i]!.id,
        proofRecords[i]!.hash,
        allProofs[i]!,
        tree.root
      );
      expect(valid).toBe(true);
    }
  });

  it('hashPair is not commutative — order matters for tree structure', async () => {
    const a = await sha256('value-a');
    const b = await sha256('value-b');

    const ab = await hashPair(a, b);
    const ba = await hashPair(b, a);

    // hashPair(a,b) != hashPair(b,a) unless a == b
    // This ensures tree structure integrity
    expect(ab).not.toBe(ba);
  });

  it('sha256 is collision-resistant for similar inputs', async () => {
    const hashes = await Promise.all(
      Array.from({ length: 100 }, (_, i) => sha256(`collision-test-${i}`))
    );

    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(100);
  });
});
