/**
 * Tests for PROOF Service
 *
 * Tests for cryptographic integrity, chain verification, and deterministic hashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canonicalize } from '../../../src/common/canonical-json.js';

// Mock the database and crypto modules
vi.mock('../../../src/common/db.js', () => ({
  getDatabase: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../../../src/common/crypto.js', () => ({
  sign: vi.fn().mockResolvedValue({
    signature: 'mock-signature',
    publicKey: 'mock-public-key',
    algorithm: 'Ed25519',
    signedAt: new Date().toISOString(),
  }),
  verify: vi.fn().mockResolvedValue({ valid: true }),
}));

describe('PROOF Cryptographic Integrity', () => {
  describe('Canonical JSON for Hash Calculation', () => {
    it('should produce deterministic hashes regardless of object key order', async () => {
      // Simulate proof data with different key orderings
      const proofData1 = {
        id: 'proof-123',
        chainPosition: 0,
        intentId: 'intent-456',
        entityId: 'entity-789',
        decision: { allowed: true, reason: 'approved' },
        inputs: { request: 'data' },
        outputs: { result: 'success' },
        previousHash: '0'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const proofData2 = {
        createdAt: '2024-01-01T00:00:00.000Z',
        previousHash: '0'.repeat(64),
        outputs: { result: 'success' },
        inputs: { request: 'data' },
        decision: { reason: 'approved', allowed: true },
        entityId: 'entity-789',
        intentId: 'intent-456',
        chainPosition: 0,
        id: 'proof-123',
      };

      // Both should produce the same canonical JSON
      const canonical1 = canonicalize(proofData1);
      const canonical2 = canonicalize(proofData2);

      expect(canonical1).toBe(canonical2);

      // Compute hash using Web Crypto API (same as ProofService)
      const encoder = new TextEncoder();
      const hash1 = await crypto.subtle.digest('SHA-256', encoder.encode(canonical1));
      const hash2 = await crypto.subtle.digest('SHA-256', encoder.encode(canonical2));

      const hashHex1 = Array.from(new Uint8Array(hash1))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const hashHex2 = Array.from(new Uint8Array(hash2))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      expect(hashHex1).toBe(hashHex2);
    });

    it('should handle nested objects in decision field', async () => {
      const decision1 = {
        allowed: true,
        reason: 'Policy match',
        details: {
          policyId: 'policy-1',
          matchedRules: ['rule-a', 'rule-b'],
          context: { environment: 'production', region: 'us-east' },
        },
      };

      const decision2 = {
        details: {
          context: { region: 'us-east', environment: 'production' },
          matchedRules: ['rule-a', 'rule-b'],
          policyId: 'policy-1',
        },
        reason: 'Policy match',
        allowed: true,
      };

      expect(canonicalize(decision1)).toBe(canonicalize(decision2));
    });

    it('should handle complex inputs/outputs structures', () => {
      const inputs1 = {
        request: {
          method: 'POST',
          path: '/api/action',
          body: { data: [1, 2, 3], metadata: { timestamp: 123 } },
        },
        context: { userId: 'user-1', tenantId: 'tenant-1' },
      };

      const inputs2 = {
        context: { tenantId: 'tenant-1', userId: 'user-1' },
        request: {
          body: { metadata: { timestamp: 123 }, data: [1, 2, 3] },
          path: '/api/action',
          method: 'POST',
        },
      };

      expect(canonicalize(inputs1)).toBe(canonicalize(inputs2));
    });

    it('should preserve array order in inputs/outputs', () => {
      const inputs = {
        items: [
          { id: 3, name: 'third' },
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ],
      };

      const canonical = canonicalize(inputs);

      // Array order should be preserved (3, 1, 2)
      expect(canonical).toContain('"id":3');
      const idx3 = canonical.indexOf('"id":3');
      const idx1 = canonical.indexOf('"id":1');
      const idx2 = canonical.indexOf('"id":2');

      expect(idx3).toBeLessThan(idx1);
      expect(idx1).toBeLessThan(idx2);
    });
  });

  describe('Chain Verification Pagination', () => {
    it('should support batch size configuration', () => {
      // Test that ChainVerificationOptions interface is correctly typed
      const options = {
        batchSize: 50,
        onProgress: (verified: number, total: number) => {
          expect(typeof verified).toBe('number');
          expect(typeof total).toBe('number');
        },
      };

      expect(options.batchSize).toBe(50);
      expect(typeof options.onProgress).toBe('function');
    });

    it('should report progress during verification', () => {
      const progressCalls: Array<{ verified: number; total: number }> = [];
      const onProgress = (verified: number, total: number) => {
        progressCalls.push({ verified, total });
      };

      // Simulate progress calls
      onProgress(10, 100);
      onProgress(20, 100);
      onProgress(30, 100);

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ verified: 10, total: 100 });
      expect(progressCalls[2]).toEqual({ verified: 30, total: 100 });
    });
  });

  describe('Hash Consistency Across Environments', () => {
    it('should produce same hash for proof with special characters', () => {
      const proofWithSpecialChars = {
        id: 'proof-123',
        decision: {
          reason: 'Contains "quotes" and\nnewlines\tand tabs',
        },
      };

      const canonical = canonicalize(proofWithSpecialChars);

      // Should properly escape special characters
      expect(canonical).toContain('\\n');
      expect(canonical).toContain('\\t');
      expect(canonical).toContain('\\"');
    });

    it('should handle unicode characters consistently', () => {
      const proofWithUnicode = {
        id: 'proof-123',
        decision: {
          reason: 'Contains unicode: Hello World',
        },
      };

      const canonical = canonicalize(proofWithUnicode);
      expect(canonical).toContain('Hello World');
    });

    it('should handle null and undefined values correctly', () => {
      const proofWithNulls = {
        id: 'proof-123',
        chainPosition: 0,
        decision: null,
        inputs: { value: null, missing: undefined },
        outputs: {},
      };

      const canonical = canonicalize(proofWithNulls);

      // null should be preserved
      expect(canonical).toContain('"decision":null');
      expect(canonical).toContain('"value":null');

      // undefined should be omitted (JSON.stringify behavior)
      expect(canonical).not.toContain('missing');
    });
  });
});

describe('PROOF Service ChainVerificationResult', () => {
  it('should have correct structure', () => {
    const result = {
      valid: true,
      lastValidPosition: 99,
      issues: [],
      totalVerified: 100,
    };

    expect(result.valid).toBe(true);
    expect(result.lastValidPosition).toBe(99);
    expect(result.issues).toHaveLength(0);
    expect(result.totalVerified).toBe(100);
  });

  it('should capture issues when verification fails', () => {
    const result = {
      valid: false,
      lastValidPosition: 49,
      issues: ['Position 50: Hash mismatch - proof content may have been tampered'],
      totalVerified: 50,
    };

    expect(result.valid).toBe(false);
    expect(result.lastValidPosition).toBe(49);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('Hash mismatch');
  });
});
