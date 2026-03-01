/**
 * Merkle Tree Performance Benchmarks
 *
 * Run with: npx vitest bench merkle.bench.ts
 *
 * Benchmarks the core Merkle tree operations that underpin the proof
 * aggregation system: tree construction, proof generation, proof verification,
 * and the MerkleAggregationService batch anchor workflow.
 *
 * Performance targets:
 * - Tree construction (100 leaves): < 5ms
 * - Tree construction (1000 leaves): < 50ms
 * - Proof generation: < 5ms per proof
 * - Proof verification: < 0.5ms per proof
 * - Batch anchor (100 items): < 50ms
 *
 * @packageDocumentation
 */

import { describe, bench, beforeAll } from 'vitest';
import * as crypto from 'node:crypto';
import {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  MerkleAggregationService,
  createMerkleAggregationService,
} from '../src/proof/merkle.js';
import type { MerkleProof } from '../src/proof/merkle.js';

// ---------------------------------------------------------------------------
// Helpers: generate deterministic leaf hashes
// ---------------------------------------------------------------------------
function generateLeafHashes(count: number): string[] {
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    hashes.push(
      crypto.createHash('sha256').update(`leaf-data-${i}`).digest('hex')
    );
  }
  return hashes;
}

// Pre-generate leaf sets of various sizes (outside bench calls)
let leaves10: string[];
let leaves100: string[];
let leaves1000: string[];

// Pre-generated proofs for verification benchmarks
let proof10: MerkleProof;
let proof100: MerkleProof;
let proof1000: MerkleProof;

beforeAll(() => {
  leaves10 = generateLeafHashes(10);
  leaves100 = generateLeafHashes(100);
  leaves1000 = generateLeafHashes(1000);

  // Generate proofs up front for verification benchmarks
  proof10 = generateMerkleProof(leaves10, 5)!;
  proof100 = generateMerkleProof(leaves100, 50)!;
  proof1000 = generateMerkleProof(leaves1000, 500)!;
});

// ===========================================================================
// 1. Tree Construction
// ===========================================================================

describe('Merkle Tree — Construction', () => {
  bench('buildMerkleTree — 10 leaves', () => {
    buildMerkleTree(leaves10);
  }, { time: 2000, iterations: 10_000 });

  bench('buildMerkleTree — 100 leaves', () => {
    buildMerkleTree(leaves100);
  }, { time: 2000, iterations: 5000 });

  bench('buildMerkleTree — 1000 leaves', () => {
    buildMerkleTree(leaves1000);
  }, { time: 5000, iterations: 500 });

  bench('buildMerkleTree — single leaf (edge case)', () => {
    buildMerkleTree([leaves10[0]!]);
  }, { time: 1000, iterations: 50_000 });
});

// ===========================================================================
// 2. Proof Generation
// ===========================================================================

describe('Merkle Tree — Proof Generation', () => {
  bench('generateMerkleProof — 10-leaf tree, middle leaf', () => {
    generateMerkleProof(leaves10, 5);
  }, { time: 2000, iterations: 10_000 });

  bench('generateMerkleProof — 100-leaf tree, middle leaf', () => {
    generateMerkleProof(leaves100, 50);
  }, { time: 2000, iterations: 5000 });

  bench('generateMerkleProof — 1000-leaf tree, middle leaf', () => {
    generateMerkleProof(leaves1000, 500);
  }, { time: 5000, iterations: 500 });

  bench('generateMerkleProof — 1000-leaf tree, first leaf', () => {
    generateMerkleProof(leaves1000, 0);
  }, { time: 5000, iterations: 500 });

  bench('generateMerkleProof — 1000-leaf tree, last leaf', () => {
    generateMerkleProof(leaves1000, 999);
  }, { time: 5000, iterations: 500 });
});

// ===========================================================================
// 3. Proof Verification
// ===========================================================================

describe('Merkle Tree — Proof Verification', () => {
  bench('verifyMerkleProof — 10-leaf tree', () => {
    verifyMerkleProof(proof10);
  }, { time: 2000, iterations: 50_000 });

  bench('verifyMerkleProof — 100-leaf tree', () => {
    verifyMerkleProof(proof100);
  }, { time: 2000, iterations: 50_000 });

  bench('verifyMerkleProof — 1000-leaf tree', () => {
    verifyMerkleProof(proof1000);
  }, { time: 2000, iterations: 50_000 });
});

// ===========================================================================
// 4. Full Generate + Verify Cycle
// ===========================================================================

describe('Merkle Tree — Generate + Verify Cycle', () => {
  bench('generate + verify — 100-leaf tree', () => {
    const proof = generateMerkleProof(leaves100, 42)!;
    verifyMerkleProof(proof);
  }, { time: 2000, iterations: 5000 });

  bench('generate + verify — 1000-leaf tree', () => {
    const proof = generateMerkleProof(leaves1000, 42)!;
    verifyMerkleProof(proof);
  }, { time: 5000, iterations: 500 });
});

// ===========================================================================
// 5. Aggregation Service — Batch Anchoring
// ===========================================================================

describe('Merkle Aggregation — Batch Anchor', () => {
  bench('addItem + anchor — 10 items', async () => {
    const service = createMerkleAggregationService({
      minBatchSize: 1000, // Prevent auto-anchor
      maxBatchSize: 10_000,
      maxBatchAgeMs: 999_999,
    });

    for (let i = 0; i < 10; i++) {
      await service.addItem(`item-${i}`, `proof-data-for-item-${i}`);
    }
    await service.anchor();

    service.destroy();
  }, { time: 5000, iterations: 500 });

  bench('addItem + anchor — 100 items', async () => {
    const service = createMerkleAggregationService({
      minBatchSize: 1000,
      maxBatchSize: 10_000,
      maxBatchAgeMs: 999_999,
    });

    for (let i = 0; i < 100; i++) {
      await service.addItem(`item-${i}`, `proof-data-for-item-${i}`);
    }
    await service.anchor();

    service.destroy();
  }, { time: 5000, iterations: 100 });

  bench('addItem + anchor — 1000 items', async () => {
    const service = createMerkleAggregationService({
      minBatchSize: 10_000,
      maxBatchSize: 100_000,
      maxBatchAgeMs: 999_999,
    });

    for (let i = 0; i < 1000; i++) {
      await service.addItem(`item-${i}`, `proof-data-for-item-${i}`);
    }
    await service.anchor();

    service.destroy();
  }, { time: 10000, iterations: 10 });
});

// ===========================================================================
// 6. Aggregation Service — Proof Retrieval After Anchor
// ===========================================================================

describe('Merkle Aggregation — Proof Retrieval', () => {
  let service: MerkleAggregationService;
  let anchorId: string;

  beforeAll(async () => {
    service = createMerkleAggregationService({
      minBatchSize: 10_000,
      maxBatchSize: 100_000,
      maxBatchAgeMs: 999_999,
    });

    for (let i = 0; i < 500; i++) {
      await service.addItem(`item-${i}`, `proof-data-for-item-${i}`);
    }
    const result = await service.anchor();
    anchorId = result!.anchor.anchorId;
  });

  bench('getProof — existing item in 500-item anchor', () => {
    service.getProof(anchorId, 'item-250');
  }, { time: 2000, iterations: 50_000 });

  bench('getAnchor — by ID', () => {
    service.getAnchor(anchorId);
  }, { time: 2000, iterations: 50_000 });

  bench('verifyInclusion — item in 500-item anchor', () => {
    service.verifyInclusion(anchorId, 'item-250', `proof-data-for-item-250`);
  }, { time: 2000, iterations: 10_000 });
});

/**
 * Performance Expectations Summary
 *
 * | Operation                          | Target     | Notes                              |
 * |------------------------------------|------------|------------------------------------|
 * | buildMerkleTree — 10 leaves        | < 0.1ms    | 4 tree levels                      |
 * | buildMerkleTree — 100 leaves       | < 1ms      | 7 tree levels                      |
 * | buildMerkleTree — 1000 leaves      | < 10ms     | 10 tree levels                     |
 * | generateMerkleProof — 100 leaves   | < 2ms      | Includes tree rebuild              |
 * | generateMerkleProof — 1000 leaves  | < 20ms     | Includes tree rebuild              |
 * | verifyMerkleProof — any size       | < 0.1ms    | O(log n) hash operations           |
 * | Batch anchor — 100 items           | < 50ms     | SHA-256 + tree + proofs            |
 * | Batch anchor — 1000 items          | < 500ms    | SHA-256 + tree + proofs            |
 * | verifyInclusion                    | < 0.5ms    | Hash + proof verify                |
 */
