/**
 * Commitment Schemes for Zero-Knowledge Proofs
 *
 * Implements various cryptographic commitment schemes used in ZK proofs:
 * - Pedersen commitments (additively homomorphic)
 * - Merkle tree commitments (for set membership)
 * - Accumulator commitments (for dynamic sets)
 * - Commitment opening proofs
 *
 * These primitives are foundational for building privacy-preserving protocols.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import {
  type Commitment,
  type MerkleProof,
  type PedersenCommitment,
  CommitmentScheme,
  commitmentSchema,
  merkleProofSchema,
  pedersenCommitmentSchema,
} from './types.js';

const logger = createLogger({ component: 'zkp-commitment' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Commitment-related errors
 */
export class CommitmentError extends VorionError {
  override code = 'COMMITMENT_ERROR';
  override statusCode = 400;

  constructor(message: string, public readonly scheme?: CommitmentScheme, details?: Record<string, unknown>) {
    super(message, { scheme, ...details });
    this.name = 'CommitmentError';
  }
}

// =============================================================================
// PEDERSEN COMMITMENT
// =============================================================================

/**
 * Pedersen Commitment Service
 *
 * Implements Pedersen commitments which are:
 * - Perfectly hiding (computationally binding)
 * - Additively homomorphic: C(v1) * C(v2) = C(v1 + v2)
 *
 * Commitment: C = g^v * h^r
 * where:
 * - g, h are generators of a prime-order group
 * - v is the value being committed
 * - r is a random blinding factor
 *
 * Note: This implementation uses SHA-256 hash-based simulation.
 * For production, use elliptic curve implementations (e.g., ristretto255).
 *
 * @example
 * ```typescript
 * const pedersen = new PedersenCommitmentService();
 *
 * // Create a commitment
 * const { commitment, opening } = await pedersen.commit(BigInt(42));
 *
 * // Verify the commitment
 * const valid = await pedersen.verify(commitment, BigInt(42), opening);
 * ```
 */
export class PedersenCommitmentService {
  private generatorG: string;
  private generatorH: string;

  constructor() {
    // In production, these would be verifiably random group elements
    // For simulation, we use hash-based "generators"
    this.generatorG = 'pedersen_generator_g_v1';
    this.generatorH = 'pedersen_generator_h_v1';

    logger.info('Pedersen commitment service initialized');
  }

  /**
   * Create a commitment to a value
   *
   * @param value - The value to commit to (as bigint for large numbers)
   * @param blindingFactor - Optional blinding factor (random if not provided)
   * @returns Commitment and opening information
   */
  async commit(
    value: bigint | number,
    blindingFactor?: string
  ): Promise<{ commitment: PedersenCommitment; opening: PedersenOpening }> {
    const v = typeof value === 'number' ? BigInt(Math.floor(value)) : value;
    const r = blindingFactor ?? await this.generateRandomScalar();

    // Simulate C = g^v * h^r using hash
    const gv = await this.hashToPoint(`${this.generatorG}:${v.toString()}`);
    const hr = await this.hashToPoint(`${this.generatorH}:${r}`);
    const commitmentValue = await this.combinePoints(gv, hr);

    const commitment: PedersenCommitment = {
      commitment: commitmentValue,
      generatorG: this.generatorG,
      generatorH: this.generatorH,
    };

    const opening: PedersenOpening = {
      value: v.toString(),
      blindingFactor: r,
    };

    pedersenCommitmentSchema.parse(commitment);
    logger.debug('Created Pedersen commitment');

    return { commitment, opening };
  }

  /**
   * Verify a commitment opening
   *
   * @param commitment - The commitment to verify
   * @param value - The claimed value
   * @param blindingFactor - The blinding factor used
   * @returns Whether the opening is valid
   */
  async verify(
    commitment: PedersenCommitment,
    value: bigint | number,
    blindingFactor: string
  ): Promise<boolean> {
    const v = typeof value === 'number' ? BigInt(Math.floor(value)) : value;

    // Recompute commitment
    const gv = await this.hashToPoint(`${commitment.generatorG}:${v.toString()}`);
    const hr = await this.hashToPoint(`${commitment.generatorH}:${blindingFactor}`);
    const recomputed = await this.combinePoints(gv, hr);

    return recomputed === commitment.commitment;
  }

  /**
   * Add two commitments (homomorphic addition)
   *
   * C(v1, r1) + C(v2, r2) = C(v1 + v2, r1 + r2)
   */
  async add(
    c1: PedersenCommitment,
    c2: PedersenCommitment
  ): Promise<PedersenCommitment> {
    // In elliptic curve setting, this would be point addition
    // For simulation, we concatenate and hash
    const combined = await this.hashToPoint(`add:${c1.commitment}:${c2.commitment}`);

    return {
      commitment: combined,
      generatorG: c1.generatorG,
      generatorH: c1.generatorH,
    };
  }

  /**
   * Create a commitment to zero for zero-knowledge proofs
   */
  async commitToZero(): Promise<{ commitment: PedersenCommitment; blindingFactor: string }> {
    const { commitment, opening } = await this.commit(BigInt(0));
    return { commitment, blindingFactor: opening.blindingFactor };
  }

  /**
   * Generate a random scalar for blinding
   */
  async generateRandomScalar(): Promise<string> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  private async hashToPoint(data: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async combinePoints(p1: string, p2: string): Promise<string> {
    return this.hashToPoint(`combine:${p1}:${p2}`);
  }
}

/**
 * Opening information for a Pedersen commitment
 */
export interface PedersenOpening {
  /** The committed value */
  value: string;
  /** The blinding factor */
  blindingFactor: string;
}

// =============================================================================
// MERKLE TREE COMMITMENT
// =============================================================================

/**
 * Merkle Tree Commitment Service
 *
 * Implements Merkle tree commitments for set membership proofs.
 * The root of the tree commits to all elements in the set.
 *
 * Features:
 * - Efficient O(log n) membership proofs
 * - Dynamic tree updates (add/remove elements)
 * - Sparse tree support for large sets
 *
 * @example
 * ```typescript
 * const merkle = new MerkleTreeService();
 *
 * // Build tree from elements
 * const { root, tree } = await merkle.buildTree(['alice', 'bob', 'charlie']);
 *
 * // Generate membership proof
 * const proof = merkle.generateProof(tree, 'bob');
 *
 * // Verify proof
 * const valid = await merkle.verifyProof(root, 'bob', proof);
 * ```
 */
export class MerkleTreeService {
  private readonly hashPrefix = 'merkle_v1';

  constructor() {
    logger.info('Merkle tree service initialized');
  }

  /**
   * Build a Merkle tree from elements
   */
  async buildTree(elements: string[]): Promise<{
    root: string;
    tree: MerkleTree;
    proofs: Map<string, MerkleProof>;
  }> {
    if (elements.length === 0) {
      throw new CommitmentError('Cannot build tree from empty set', CommitmentScheme.MERKLE);
    }

    // Remove duplicates and sort for determinism
    const uniqueElements = Array.from(new Set(elements)).sort();

    // Pad to power of 2
    const size = Math.pow(2, Math.ceil(Math.log2(uniqueElements.length)));
    const paddedElements = [...uniqueElements];
    while (paddedElements.length < size) {
      paddedElements.push(''); // Empty leaves
    }

    // Hash leaves
    const leaves = await Promise.all(
      paddedElements.map(e => this.hashLeaf(e))
    );

    // Build tree levels
    const levels: string[][] = [leaves];
    let currentLevel = leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        const right = currentLevel[i + 1] ?? left;
        nextLevel.push(await this.hashNode(left, right));
      }
      levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    const root = currentLevel[0]!;

    // Create tree structure
    const tree: MerkleTree = {
      root,
      levels,
      elements: paddedElements,
      depth: levels.length - 1,
    };

    // Generate proofs for all original elements
    const proofs = new Map<string, MerkleProof>();
    for (let i = 0; i < uniqueElements.length; i++) {
      const element = uniqueElements[i]!;
      const proof = this.generateProofInternal(tree, i);
      proofs.set(element, proof);
    }

    logger.debug({ elementCount: uniqueElements.length, depth: tree.depth }, 'Built Merkle tree');

    return { root, tree, proofs };
  }

  /**
   * Generate a membership proof for an element
   */
  generateProof(tree: MerkleTree, element: string): MerkleProof {
    const index = tree.elements.indexOf(element);
    if (index === -1) {
      throw new CommitmentError('Element not found in tree', CommitmentScheme.MERKLE);
    }

    return this.generateProofInternal(tree, index);
  }

  /**
   * Verify a membership proof
   */
  async verifyProof(root: string, element: string, proof: MerkleProof): Promise<boolean> {
    merkleProofSchema.parse(proof);

    // Compute root from leaf and proof
    let currentHash = await this.hashLeaf(element);

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i]!;
      const isRight = proof.pathIndices[i] === 1;

      if (isRight) {
        currentHash = await this.hashNode(sibling, currentHash);
      } else {
        currentHash = await this.hashNode(currentHash, sibling);
      }
    }

    return currentHash === root;
  }

  /**
   * Update a leaf in the tree
   */
  async updateLeaf(
    tree: MerkleTree,
    oldElement: string,
    newElement: string
  ): Promise<{ newRoot: string; newTree: MerkleTree }> {
    const index = tree.elements.indexOf(oldElement);
    if (index === -1) {
      throw new CommitmentError('Element not found in tree', CommitmentScheme.MERKLE);
    }

    // Update elements
    const newElements = [...tree.elements];
    newElements[index] = newElement;

    // Rebuild tree (could be optimized to only update affected path)
    const { root, tree: newTree } = await this.buildTree(newElements.filter(e => e !== ''));

    return { newRoot: root, newTree };
  }

  /**
   * Add an element to the tree
   */
  async addElement(
    tree: MerkleTree,
    element: string
  ): Promise<{ newRoot: string; newTree: MerkleTree }> {
    const elements = tree.elements.filter(e => e !== '');
    elements.push(element);

    return this.buildTree(elements).then(result => ({
      newRoot: result.root,
      newTree: result.tree,
    }));
  }

  /**
   * Create a sparse Merkle tree with a default empty value
   */
  async createSparseTree(depth: number): Promise<{
    root: string;
    emptyRoots: string[];
  }> {
    // Compute empty roots for each level
    const emptyRoots: string[] = [];
    let currentEmpty = await this.hashLeaf('');

    for (let i = 0; i < depth; i++) {
      emptyRoots.push(currentEmpty);
      currentEmpty = await this.hashNode(currentEmpty, currentEmpty);
    }

    return {
      root: currentEmpty,
      emptyRoots,
    };
  }

  private generateProofInternal(tree: MerkleTree, leafIndex: number): MerkleProof {
    const siblings: string[] = [];
    const pathIndices: number[] = [];

    let index = leafIndex;
    for (let i = 0; i < tree.depth; i++) {
      const level = tree.levels[i]!;
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;

      if (siblingIndex < level.length) {
        siblings.push(level[siblingIndex]!);
      } else {
        siblings.push(level[index]!);
      }

      pathIndices.push(isRight ? 1 : 0);
      index = Math.floor(index / 2);
    }

    return {
      leaf: tree.elements[leafIndex]!,
      root: tree.root,
      siblings,
      pathIndices,
      leafIndex,
    };
  }

  private async hashLeaf(value: string): Promise<string> {
    const data = `${this.hashPrefix}:leaf:${value}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async hashNode(left: string, right: string): Promise<string> {
    const data = `${this.hashPrefix}:node:${left}:${right}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * Merkle tree structure
 */
export interface MerkleTree {
  /** Tree root */
  root: string;
  /** All levels of the tree */
  levels: string[][];
  /** Elements (padded) */
  elements: string[];
  /** Tree depth */
  depth: number;
}

// =============================================================================
// ACCUMULATOR COMMITMENT
// =============================================================================

/**
 * Cryptographic Accumulator Service
 *
 * Implements accumulator commitments for dynamic set membership.
 * Unlike Merkle trees, accumulators have constant-size proofs.
 *
 * Features:
 * - Constant-size membership proofs
 * - Efficient batch updates
 * - Non-membership proofs
 *
 * Note: This implementation uses hash-based simulation.
 * For production, use RSA or bilinear accumulator implementations.
 *
 * @example
 * ```typescript
 * const accumulator = new AccumulatorService();
 *
 * // Add elements
 * let state = await accumulator.initialize();
 * state = await accumulator.add(state, 'element1');
 *
 * // Generate witness
 * const witness = await accumulator.createWitness(state, 'element1');
 *
 * // Verify
 * const valid = await accumulator.verify(state.value, 'element1', witness);
 * ```
 */
export class AccumulatorService {
  private readonly accumulatorSeed: string;

  constructor() {
    // In production, this would be the RSA modulus or group parameters
    this.accumulatorSeed = 'accumulator_seed_v1';
    logger.info('Accumulator service initialized');
  }

  /**
   * Initialize a new accumulator
   */
  async initialize(): Promise<AccumulatorState> {
    const initialValue = await this.hash(`${this.accumulatorSeed}:init`);

    return {
      value: initialValue,
      elements: new Set(),
      version: 0,
    };
  }

  /**
   * Add an element to the accumulator
   */
  async add(state: AccumulatorState, element: string): Promise<AccumulatorState> {
    if (state.elements.has(element)) {
      return state; // Element already present
    }

    // In RSA accumulator: acc' = acc^hash(element) mod N
    // Simulation: hash(acc || element)
    const newValue = await this.hash(`${state.value}:add:${element}`);

    const newElements = new Set(state.elements);
    newElements.add(element);

    return {
      value: newValue,
      elements: newElements,
      version: state.version + 1,
    };
  }

  /**
   * Remove an element from the accumulator
   */
  async remove(state: AccumulatorState, element: string): Promise<AccumulatorState> {
    if (!state.elements.has(element)) {
      return state; // Element not present
    }

    // Rebuild accumulator without the element
    let newState = await this.initialize();
    const elementsArray = Array.from(state.elements);
    for (const e of elementsArray) {
      if (e !== element) {
        newState = await this.add(newState, e);
      }
    }

    return {
      ...newState,
      version: state.version + 1,
    };
  }

  /**
   * Create a membership witness for an element
   */
  async createWitness(state: AccumulatorState, element: string): Promise<AccumulatorWitness> {
    if (!state.elements.has(element)) {
      throw new CommitmentError('Element not in accumulator', CommitmentScheme.ACCUMULATOR);
    }

    // In RSA accumulator: witness = acc without element
    // Simulation: compute accumulator of all other elements
    let witnessState = await this.initialize();
    const elementsArray = Array.from(state.elements);
    for (const e of elementsArray) {
      if (e !== element) {
        witnessState = await this.add(witnessState, e);
      }
    }

    return {
      element,
      witness: witnessState.value,
      accumulatorValue: state.value,
      version: state.version,
    };
  }

  /**
   * Verify a membership witness
   */
  async verify(
    accumulatorValue: string,
    element: string,
    witness: AccumulatorWitness
  ): Promise<boolean> {
    // Recompute: acc should equal witness^hash(element)
    // Simulation: hash(witness || element) should equal acc
    const recomputed = await this.hash(`${witness.witness}:add:${element}`);
    return recomputed === accumulatorValue;
  }

  /**
   * Batch add multiple elements
   */
  async batchAdd(state: AccumulatorState, elements: string[]): Promise<AccumulatorState> {
    let currentState = state;
    for (const element of elements) {
      currentState = await this.add(currentState, element);
    }
    return currentState;
  }

  /**
   * Update a witness after accumulator changes
   */
  async updateWitness(
    oldWitness: AccumulatorWitness,
    newState: AccumulatorState,
    addedElements: string[],
    removedElements: string[]
  ): Promise<AccumulatorWitness> {
    // For efficiency, witnesses can be updated without recomputing from scratch
    // This is a simplified version that recomputes
    if (!newState.elements.has(oldWitness.element)) {
      throw new CommitmentError('Element no longer in accumulator', CommitmentScheme.ACCUMULATOR);
    }

    return this.createWitness(newState, oldWitness.element);
  }

  private async hash(data: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * Accumulator state
 */
export interface AccumulatorState {
  /** Current accumulator value */
  value: string;
  /** Elements in the accumulator */
  elements: Set<string>;
  /** Version number for updates */
  version: number;
}

/**
 * Accumulator membership witness
 */
export interface AccumulatorWitness {
  /** Element being proven */
  element: string;
  /** Witness value */
  witness: string;
  /** Accumulator value at time of witness creation */
  accumulatorValue: string;
  /** Version number */
  version: number;
}

// =============================================================================
// HASH COMMITMENT
// =============================================================================

/**
 * Simple Hash Commitment Service
 *
 * Implements basic hash-based commitments.
 * Computationally binding but not perfectly hiding.
 *
 * Commitment: C = H(value || nonce)
 *
 * @example
 * ```typescript
 * const hash = new HashCommitmentService();
 *
 * // Create commitment
 * const { commitment, nonce } = await hash.commit('secret');
 *
 * // Verify
 * const valid = await hash.verify(commitment, 'secret', nonce);
 * ```
 */
export class HashCommitmentService {
  constructor() {
    logger.info('Hash commitment service initialized');
  }

  /**
   * Create a hash commitment
   */
  async commit(value: string): Promise<{ commitment: Commitment; nonce: string }> {
    const nonce = await this.generateNonce();
    const commitmentValue = await this.hash(`${value}:${nonce}`);

    const commitment: Commitment = {
      scheme: CommitmentScheme.HASH,
      value: commitmentValue,
      createdAt: new Date(),
    };

    commitmentSchema.parse(commitment);

    return { commitment, nonce };
  }

  /**
   * Verify a hash commitment opening
   */
  async verify(commitment: Commitment, value: string, nonce: string): Promise<boolean> {
    const recomputed = await this.hash(`${value}:${nonce}`);
    return recomputed === commitment.value;
  }

  /**
   * Create a time-locked commitment
   */
  async commitWithExpiry(
    value: string,
    expiresAt: Date
  ): Promise<{ commitment: Commitment; nonce: string }> {
    const nonce = await this.generateNonce();
    const commitmentValue = await this.hash(`${value}:${nonce}:${expiresAt.getTime()}`);

    const commitment: Commitment = {
      scheme: CommitmentScheme.HASH,
      value: commitmentValue,
      createdAt: new Date(),
      parameters: { expiresAt: expiresAt.toISOString() },
    };

    commitmentSchema.parse(commitment);

    return { commitment, nonce };
  }

  private async hash(data: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async generateNonce(): Promise<string> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create commitment service for the specified scheme
 */
export function createCommitmentService(scheme: CommitmentScheme):
  PedersenCommitmentService | MerkleTreeService | AccumulatorService | HashCommitmentService {
  switch (scheme) {
    case CommitmentScheme.PEDERSEN:
      return new PedersenCommitmentService();
    case CommitmentScheme.MERKLE:
      return new MerkleTreeService();
    case CommitmentScheme.ACCUMULATOR:
      return new AccumulatorService();
    case CommitmentScheme.HASH:
      return new HashCommitmentService();
    default:
      throw new CommitmentError(`Unknown commitment scheme: ${scheme}`);
  }
}
