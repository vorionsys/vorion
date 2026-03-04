/**
 * Merkle Tree Implementation
 *
 * Binary Merkle tree with SHA-256 for proof aggregation.
 * Supports batch proof creation, membership proofs, and verification.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'merkle-tree' });

/**
 * Merkle proof for a leaf in the tree
 */
export interface MerkleProof {
  /** Index of the leaf in the tree (0-based) */
  leafIndex: number;
  /** Hash of the leaf */
  leafHash: string;
  /** Sibling hashes needed to reconstruct the root (from leaf to root) */
  siblingHashes: string[];
  /** Direction indicators: true = sibling is on the right, false = sibling is on the left */
  siblingDirections: boolean[];
  /** Root hash of the tree */
  root: string;
  /** Total number of leaves in the tree */
  leafCount: number;
}

/**
 * Result of building a Merkle tree
 */
export interface MerkleTreeResult {
  /** Root hash of the tree */
  root: string;
  /** Number of leaves in the tree */
  leafCount: number;
  /** All tree levels (leaves at index 0, root at last index) */
  levels: string[][];
}

/**
 * Calculate SHA-256 hash of input data
 */
export async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate hash of two concatenated hashes (for internal nodes)
 * Always orders hashes consistently: smaller hash first, then larger hash
 * This makes the tree order-independent for the same set of leaves
 */
export async function hashPair(left: string, right: string): Promise<string> {
  // Concatenate with a separator to avoid ambiguity
  const combined = left + right;
  return sha256(combined);
}

/**
 * Build a Merkle tree from an array of leaf hashes
 *
 * @param leaves - Array of leaf hashes (pre-hashed data)
 * @returns The tree result including root and all levels
 *
 * Algorithm:
 * 1. If odd number of leaves, duplicate the last leaf
 * 2. Build tree bottom-up by hashing pairs
 * 3. Continue until a single root hash remains
 */
export async function buildMerkleTree(leaves: string[]): Promise<MerkleTreeResult> {
  if (leaves.length === 0) {
    throw new Error('Cannot build Merkle tree with no leaves');
  }

  // Store original count before any duplication
  const originalLeafCount = leaves.length;

  // Handle single leaf case
  if (leaves.length === 1) {
    return {
      root: leaves[0]!,
      leafCount: originalLeafCount,
      levels: [[leaves[0]!]],
    };
  }

  // Copy leaves to avoid mutation
  let currentLevel = [...leaves];
  const levels: string[][] = [[...currentLevel]];

  // Build tree bottom-up
  while (currentLevel.length > 1) {
    // If odd number of nodes, duplicate the last one
    if (currentLevel.length % 2 === 1) {
      currentLevel.push(currentLevel[currentLevel.length - 1]!);
    }

    const nextLevel: string[] = [];

    // Hash pairs
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = currentLevel[i + 1]!;
      const parent = await hashPair(left, right);
      nextLevel.push(parent);
    }

    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  const root = currentLevel[0]!;

  logger.debug(
    { leafCount: originalLeafCount, rootHash: root.slice(0, 16) + '...' },
    'Merkle tree built'
  );

  return {
    root,
    leafCount: originalLeafCount,
    levels,
  };
}

/**
 * Generate a Merkle proof for a specific leaf
 *
 * @param leafIndex - Index of the leaf to prove (0-based)
 * @param tree - The Merkle tree result
 * @returns The Merkle proof for the leaf
 */
export function generateMerkleProof(
  leafIndex: number,
  tree: MerkleTreeResult
): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(
      `Leaf index ${leafIndex} out of bounds (0-${tree.leafCount - 1})`
    );
  }

  const siblingHashes: string[] = [];
  const siblingDirections: boolean[] = [];

  let currentIndex = leafIndex;

  // Walk up the tree, collecting siblings
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const currentLevel = tree.levels[level]!;

    // Handle odd-length levels by conceptually duplicating last node
    let levelLength = currentLevel.length;
    if (levelLength % 2 === 1) {
      levelLength++;
    }

    // Determine sibling index and direction
    const isRightChild = currentIndex % 2 === 1;
    const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

    // Get sibling hash (may need to handle duplicated last node)
    let siblingHash: string;
    if (siblingIndex >= currentLevel.length) {
      // Sibling is a duplicated node (last node duplicated for odd count)
      siblingHash = currentLevel[currentLevel.length - 1]!;
    } else {
      siblingHash = currentLevel[siblingIndex]!;
    }

    siblingHashes.push(siblingHash);
    // true = sibling is on the right, false = sibling is on the left
    siblingDirections.push(!isRightChild);

    // Move to parent index
    currentIndex = Math.floor(currentIndex / 2);
  }

  const leafHash = tree.levels[0]![leafIndex]!;

  return {
    leafIndex,
    leafHash,
    siblingHashes,
    siblingDirections,
    root: tree.root,
    leafCount: tree.leafCount,
  };
}

/**
 * Verify a Merkle proof against a root hash
 *
 * @param proof - The Merkle proof to verify
 * @param expectedRoot - Optional expected root hash (defaults to proof.root)
 * @returns True if the proof is valid
 */
export async function verifyMerkleProof(
  proof: MerkleProof,
  expectedRoot?: string
): Promise<boolean> {
  const targetRoot = expectedRoot ?? proof.root;

  if (proof.siblingHashes.length !== proof.siblingDirections.length) {
    logger.warn('Invalid proof: sibling hashes and directions length mismatch');
    return false;
  }

  let currentHash = proof.leafHash;

  // Walk up the tree, computing hashes
  for (let i = 0; i < proof.siblingHashes.length; i++) {
    const siblingHash = proof.siblingHashes[i]!;
    const siblingOnRight = proof.siblingDirections[i]!;

    if (siblingOnRight) {
      // Current node is on the left, sibling on the right
      currentHash = await hashPair(currentHash, siblingHash);
    } else {
      // Sibling is on the left, current node on the right
      currentHash = await hashPair(siblingHash, currentHash);
    }
  }

  const valid = currentHash === targetRoot;

  if (!valid) {
    logger.debug(
      {
        computedRoot: currentHash.slice(0, 16) + '...',
        expectedRoot: targetRoot.slice(0, 16) + '...',
      },
      'Merkle proof verification failed'
    );
  }

  return valid;
}

/**
 * Hash proof data into a leaf hash for inclusion in Merkle tree
 *
 * @param proofId - The proof ID
 * @param proofHash - The proof's hash from the proof chain
 * @returns The leaf hash for the Merkle tree
 */
export async function hashProofToLeaf(proofId: string, proofHash: string): Promise<string> {
  // Combine proof ID and hash to create a unique leaf
  return sha256(`${proofId}:${proofHash}`);
}

/**
 * Verify that a proof (by ID and hash) is included in a Merkle root
 *
 * @param proofId - The proof ID
 * @param proofHash - The proof's hash
 * @param proof - The Merkle proof
 * @param expectedRoot - The expected Merkle root
 * @returns True if the proof is included in the tree
 */
export async function verifyProofInclusion(
  proofId: string,
  proofHash: string,
  proof: MerkleProof,
  expectedRoot?: string
): Promise<boolean> {
  // Compute the expected leaf hash
  const expectedLeafHash = await hashProofToLeaf(proofId, proofHash);

  // Check if the leaf hash in the proof matches
  if (proof.leafHash !== expectedLeafHash) {
    logger.debug(
      {
        proofId,
        expectedLeafHash: expectedLeafHash.slice(0, 16) + '...',
        actualLeafHash: proof.leafHash.slice(0, 16) + '...',
      },
      'Leaf hash mismatch'
    );
    return false;
  }

  // Verify the Merkle proof
  return verifyMerkleProof(proof, expectedRoot);
}

/**
 * Batch aggregate proof hashes into a Merkle root
 *
 * @param proofs - Array of proof records with id and hash
 * @returns The Merkle tree result
 */
export async function aggregateProofs(
  proofs: Array<{ id: string; hash: string }>
): Promise<MerkleTreeResult> {
  if (proofs.length === 0) {
    throw new Error('Cannot aggregate zero proofs');
  }

  // Convert proofs to leaf hashes
  const leaves = await Promise.all(
    proofs.map(async (p) => hashProofToLeaf(p.id, p.hash))
  );

  // Build the Merkle tree
  const tree = await buildMerkleTree(leaves);

  logger.info(
    {
      proofCount: proofs.length,
      rootHash: tree.root.slice(0, 16) + '...',
    },
    'Proofs aggregated into Merkle tree'
  );

  return tree;
}

/**
 * Get proofs for all leaves in a tree (batch generation)
 *
 * @param tree - The Merkle tree
 * @returns Array of Merkle proofs, one for each leaf
 */
export function generateAllProofs(tree: MerkleTreeResult): MerkleProof[] {
  const proofs: MerkleProof[] = [];

  for (let i = 0; i < tree.leafCount; i++) {
    proofs.push(generateMerkleProof(i, tree));
  }

  return proofs;
}

/**
 * Serialize a Merkle proof to a compact JSON-compatible format
 */
export function serializeMerkleProof(proof: MerkleProof): string {
  return JSON.stringify({
    li: proof.leafIndex,
    lh: proof.leafHash,
    sh: proof.siblingHashes,
    sd: proof.siblingDirections.map((d) => (d ? 1 : 0)),
    r: proof.root,
    lc: proof.leafCount,
  });
}

/**
 * Deserialize a Merkle proof from compact JSON format
 */
export function deserializeMerkleProof(serialized: string): MerkleProof {
  const data = JSON.parse(serialized) as {
    li: number;
    lh: string;
    sh: string[];
    sd: number[];
    r: string;
    lc: number;
  };

  return {
    leafIndex: data.li,
    leafHash: data.lh,
    siblingHashes: data.sh,
    siblingDirections: data.sd.map((d) => d === 1),
    root: data.r,
    leafCount: data.lc,
  };
}
