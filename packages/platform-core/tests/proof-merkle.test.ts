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
  serializeMerkleProof,
  deserializeMerkleProof,
} from '../src/proof/merkle.js';

describe('sha256', () => {
  it('produces a 64-character hex string', async () => {
    const hash = await sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const hash1 = await sha256('test data');
    const hash2 = await sha256('test data');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', async () => {
    const hash1 = await sha256('input A');
    const hash2 = await sha256('input B');
    expect(hash1).not.toBe(hash2);
  });

  it('accepts Uint8Array input', async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('hello');
    const hash = await sha256(data);
    expect(hash).toHaveLength(64);
  });
});

describe('hashPair', () => {
  it('produces a valid hash from two inputs', async () => {
    const hash = await hashPair('abc', 'def');
    expect(hash).toHaveLength(64);
  });

  it('is deterministic', async () => {
    const h1 = await hashPair('a', 'b');
    const h2 = await hashPair('a', 'b');
    expect(h1).toBe(h2);
  });

  it('order matters (left + right)', async () => {
    const h1 = await hashPair('a', 'b');
    const h2 = await hashPair('b', 'a');
    expect(h1).not.toBe(h2);
  });
});

describe('buildMerkleTree', () => {
  it('throws for empty leaves', async () => {
    await expect(buildMerkleTree([])).rejects.toThrow('Cannot build Merkle tree with no leaves');
  });

  it('handles single leaf', async () => {
    const leaf = await sha256('only leaf');
    const tree = await buildMerkleTree([leaf]);
    expect(tree.root).toBe(leaf);
    expect(tree.leafCount).toBe(1);
    expect(tree.levels).toHaveLength(1);
  });

  it('handles two leaves', async () => {
    const leaf1 = await sha256('leaf1');
    const leaf2 = await sha256('leaf2');
    const tree = await buildMerkleTree([leaf1, leaf2]);

    expect(tree.leafCount).toBe(2);
    expect(tree.levels).toHaveLength(2);
    expect(tree.root).toBe(await hashPair(leaf1, leaf2));
  });

  it('handles odd number of leaves by duplicating last', async () => {
    const leaves = await Promise.all(
      ['a', 'b', 'c'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(3);
    expect(tree.root).toHaveLength(64);
  });

  it('handles power-of-two leaves correctly', async () => {
    const leaves = await Promise.all(
      ['a', 'b', 'c', 'd'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(4);
    expect(tree.levels).toHaveLength(3); // leaves + 2 internal + root
    expect(tree.root).toHaveLength(64);
  });
});

describe('generateMerkleProof and verifyMerkleProof', () => {
  it('generates valid proof for each leaf in 4-leaf tree', async () => {
    const leaves = await Promise.all(
      ['leaf0', 'leaf1', 'leaf2', 'leaf3'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);

    for (let i = 0; i < 4; i++) {
      const proof = generateMerkleProof(i, tree);
      expect(proof.leafIndex).toBe(i);
      expect(proof.leafHash).toBe(leaves[i]);
      expect(proof.root).toBe(tree.root);
      expect(proof.leafCount).toBe(4);

      const valid = await verifyMerkleProof(proof);
      expect(valid).toBe(true);
    }
  });

  it('rejects tampered proof (wrong leaf hash)', async () => {
    const leaves = await Promise.all(
      ['a', 'b'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(0, tree);

    // Tamper with leaf hash
    proof.leafHash = await sha256('tampered');
    const valid = await verifyMerkleProof(proof);
    expect(valid).toBe(false);
  });

  it('rejects proof against wrong root', async () => {
    const leaves = await Promise.all(
      ['a', 'b'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(0, tree);

    const wrongRoot = await sha256('wrong root');
    const valid = await verifyMerkleProof(proof, wrongRoot);
    expect(valid).toBe(false);
  });

  it('throws for out-of-bounds leaf index', async () => {
    const leaves = await Promise.all(['a', 'b'].map((v) => sha256(v)));
    const tree = await buildMerkleTree(leaves);

    expect(() => generateMerkleProof(-1, tree)).toThrow('out of bounds');
    expect(() => generateMerkleProof(2, tree)).toThrow('out of bounds');
  });
});

describe('verifyProofInclusion', () => {
  it('verifies proof is included in tree', async () => {
    const proofs = [
      { id: 'proof-1', hash: 'hash-1' },
      { id: 'proof-2', hash: 'hash-2' },
    ];

    const tree = await aggregateProofs(proofs);
    const merkleProof = generateMerkleProof(0, tree);

    const valid = await verifyProofInclusion('proof-1', 'hash-1', merkleProof, tree.root);
    expect(valid).toBe(true);
  });

  it('rejects proof with wrong hash', async () => {
    const proofs = [
      { id: 'proof-1', hash: 'hash-1' },
      { id: 'proof-2', hash: 'hash-2' },
    ];

    const tree = await aggregateProofs(proofs);
    const merkleProof = generateMerkleProof(0, tree);

    const valid = await verifyProofInclusion('proof-1', 'wrong-hash', merkleProof, tree.root);
    expect(valid).toBe(false);
  });
});

describe('aggregateProofs', () => {
  it('throws for empty proofs', async () => {
    await expect(aggregateProofs([])).rejects.toThrow('Cannot aggregate zero proofs');
  });

  it('aggregates multiple proofs into a Merkle tree', async () => {
    const proofs = [
      { id: 'p1', hash: 'h1' },
      { id: 'p2', hash: 'h2' },
      { id: 'p3', hash: 'h3' },
    ];

    const tree = await aggregateProofs(proofs);
    expect(tree.root).toHaveLength(64);
    expect(tree.leafCount).toBe(3);
  });

  it('single proof aggregation works', async () => {
    const proofs = [{ id: 'p1', hash: 'h1' }];
    const tree = await aggregateProofs(proofs);
    expect(tree.leafCount).toBe(1);

    const expectedLeaf = await hashProofToLeaf('p1', 'h1');
    expect(tree.root).toBe(expectedLeaf);
  });
});

describe('generateAllProofs', () => {
  it('generates one proof per leaf', async () => {
    const leaves = await Promise.all(
      ['a', 'b', 'c', 'd'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const proofs = generateAllProofs(tree);

    expect(proofs).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(proofs[i]!.leafIndex).toBe(i);
    }
  });

  it('all generated proofs are valid', async () => {
    const leaves = await Promise.all(
      ['x', 'y', 'z'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const proofs = generateAllProofs(tree);

    for (const proof of proofs) {
      const valid = await verifyMerkleProof(proof);
      expect(valid).toBe(true);
    }
  });
});

describe('serializeMerkleProof / deserializeMerkleProof', () => {
  it('round-trips correctly', async () => {
    const leaves = await Promise.all(
      ['a', 'b', 'c', 'd'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const original = generateMerkleProof(2, tree);

    const serialized = serializeMerkleProof(original);
    expect(typeof serialized).toBe('string');

    const deserialized = deserializeMerkleProof(serialized);

    expect(deserialized.leafIndex).toBe(original.leafIndex);
    expect(deserialized.leafHash).toBe(original.leafHash);
    expect(deserialized.siblingHashes).toEqual(original.siblingHashes);
    expect(deserialized.siblingDirections).toEqual(original.siblingDirections);
    expect(deserialized.root).toBe(original.root);
    expect(deserialized.leafCount).toBe(original.leafCount);
  });

  it('deserialized proof verifies correctly', async () => {
    const leaves = await Promise.all(
      ['w', 'x', 'y', 'z'].map((v) => sha256(v))
    );
    const tree = await buildMerkleTree(leaves);
    const proof = generateMerkleProof(1, tree);
    const serialized = serializeMerkleProof(proof);
    const deserialized = deserializeMerkleProof(serialized);

    const valid = await verifyMerkleProof(deserialized);
    expect(valid).toBe(true);
  });
});

describe('hashProofToLeaf', () => {
  it('is deterministic', async () => {
    const h1 = await hashProofToLeaf('proof-1', 'hash-abc');
    const h2 = await hashProofToLeaf('proof-1', 'hash-abc');
    expect(h1).toBe(h2);
  });

  it('different proof IDs produce different hashes', async () => {
    const h1 = await hashProofToLeaf('proof-1', 'hash-abc');
    const h2 = await hashProofToLeaf('proof-2', 'hash-abc');
    expect(h1).not.toBe(h2);
  });

  it('different proof hashes produce different leaf hashes', async () => {
    const h1 = await hashProofToLeaf('proof-1', 'hash-abc');
    const h2 = await hashProofToLeaf('proof-1', 'hash-def');
    expect(h1).not.toBe(h2);
  });
});
