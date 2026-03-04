/**
 * PROPERTY-BASED TESTS — Let the Machine Find Bugs
 *
 * Uses fast-check to generate thousands of random inputs and verify
 * mathematical properties that must hold for ALL inputs.
 *
 * P6:  Merkle inclusion soundness for random leaf counts
 * P7:  Merkle exclusion — random non-member always fails
 * P8:  Serialization round-trip identity
 * P9:  Trust tier boundaries are partition (no gaps, no overlaps)
 * P10: Decay multiplier properties
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  sha256,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  generateAllProofs,
  serializeMerkleProof,
  deserializeMerkleProof,
  type MerkleProof,
} from '../../packages/platform-core/src/proof/merkle.js';
import {
  TRUST_THRESHOLDS,
  calculateDecayMultiplier,
  applyDecay,
  scoreToTier,
} from '../../packages/platform-core/src/trust-engine/index.js';

// =============================================================================
// P6: Merkle inclusion soundness — proof valid for all leaves, any tree size
// =============================================================================

describe('P6: Merkle inclusion soundness (property)', () => {
  it('for any tree size 1-50, every leaf has a valid proof', { timeout: 30000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        async (leafCount) => {
          const leaves = await Promise.all(
            Array.from({ length: leafCount }, (_, i) => sha256(`p6-leaf-${leafCount}-${i}`))
          );
          const tree = await buildMerkleTree(leaves);

          expect(tree.leafCount).toBe(leafCount);

          for (let i = 0; i < leafCount; i++) {
            const proof = generateMerkleProof(i, tree);
            const valid = await verifyMerkleProof(proof);
            expect(valid).toBe(true);
          }
        }
      ),
      { numRuns: 20 } // Each run builds a tree + verifies all leaves
    );
  });
});

// =============================================================================
// P7: Merkle exclusion — random hash NOT in tree always fails
// =============================================================================

describe('P7: Merkle exclusion (property)', () => {
  it('a random non-member hash never produces a valid proof', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        async (leafCount, randomSeed) => {
          const leaves = await Promise.all(
            Array.from({ length: leafCount }, (_, i) => sha256(`p7-member-${i}`))
          );
          const tree = await buildMerkleTree(leaves);

          // Generate a non-member hash
          const nonMemberHash = await sha256(`non-member-${randomSeed}`);

          // Take a valid proof structure but replace the leaf hash
          const validProof = generateMerkleProof(0, tree);
          const forgedProof: MerkleProof = {
            ...validProof,
            leafHash: nonMemberHash,
          };

          const valid = await verifyMerkleProof(forgedProof);
          expect(valid).toBe(false);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// =============================================================================
// P8: Serialization round-trip — deserialize(serialize(proof)) ≡ proof
// =============================================================================

describe('P8: Merkle proof serialization round-trip (property)', () => {
  it('serialize then deserialize preserves all fields for any tree', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }),
        async (leafCount) => {
          const leaves = await Promise.all(
            Array.from({ length: leafCount }, (_, i) => sha256(`p8-${leafCount}-${i}`))
          );
          const tree = await buildMerkleTree(leaves);
          const allProofs = generateAllProofs(tree);

          for (const proof of allProofs) {
            const serialized = serializeMerkleProof(proof);
            const deserialized = deserializeMerkleProof(serialized);

            expect(deserialized.leafIndex).toBe(proof.leafIndex);
            expect(deserialized.leafHash).toBe(proof.leafHash);
            expect(deserialized.siblingHashes).toEqual(proof.siblingHashes);
            expect(deserialized.siblingDirections).toEqual(proof.siblingDirections);
            expect(deserialized.root).toBe(proof.root);
            expect(deserialized.leafCount).toBe(proof.leafCount);

            // Deserialized proof must still verify
            const valid = await verifyMerkleProof(deserialized);
            expect(valid).toBe(true);
          }
        }
      ),
      { numRuns: 15 }
    );
  });
});

// =============================================================================
// P9: Trust tier boundaries form a perfect partition of [0, 1000]
// =============================================================================

describe('P9: Trust tier partition (property)', () => {
  it('every score 0-1000 maps to exactly one tier', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (score) => {
          const tier = scoreToTier(score as any);
          expect(tier).toBeGreaterThanOrEqual(0);
          expect(tier).toBeLessThanOrEqual(7);
          expect(Number.isInteger(tier)).toBe(true);

          // Score must fall within that tier's threshold range
          const threshold = TRUST_THRESHOLDS[tier as keyof typeof TRUST_THRESHOLDS];
          expect(score).toBeGreaterThanOrEqual(threshold.min);
          expect(score).toBeLessThanOrEqual(threshold.max);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('scoreToTier is a pure function (deterministic)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (score) => {
          const tier1 = scoreToTier(score as any);
          const tier2 = scoreToTier(score as any);
          expect(tier1).toBe(tier2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// =============================================================================
// P10: Decay multiplier properties
// =============================================================================

describe('P10: Decay multiplier properties', () => {
  it('multiplier is always in [0, 1] for any non-negative days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        (days) => {
          const mult = calculateDecayMultiplier(days);
          expect(mult).toBeGreaterThanOrEqual(0);
          expect(mult).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('more days = equal or lower multiplier (monotonically non-increasing)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        (daysA, daysB) => {
          const multA = calculateDecayMultiplier(daysA);
          const multB = calculateDecayMultiplier(daysB);
          if (daysA <= daysB) {
            expect(multA).toBeGreaterThanOrEqual(multB - 0.001);
          } else {
            expect(multB).toBeGreaterThanOrEqual(multA - 0.001);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('applyDecay never increases score', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 5000 }),
        (baseScore, days) => {
          const decayed = applyDecay(baseScore, days);
          expect(decayed).toBeLessThanOrEqual(baseScore + 0.001);
          expect(decayed).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('applyDecay is deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (score, days) => {
          expect(applyDecay(score, days)).toBe(applyDecay(score, days));
        }
      ),
      { numRuns: 100 }
    );
  });
});
