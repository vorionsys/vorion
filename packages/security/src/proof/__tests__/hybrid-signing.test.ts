/**
 * Tests for Hybrid Ed25519 + Dilithium3 Signing
 *
 * Validates the hybrid signature scheme that combines classical Ed25519
 * with post-quantum CRYSTALS-Dilithium3 (ML-DSA-65) for quantum-resistant
 * proof signing.
 *
 * @module proof/__tests__/hybrid-signing.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initializeHybridSigning,
  signHybrid,
  verifyHybrid,
  isHybridAlgorithm,
} from '../hybrid-signing.js';

describe('Hybrid Signing', () => {
  beforeAll(async () => {
    await initializeHybridSigning();
  });

  // ---------------------------------------------------------------------------
  // initializeHybridSigning
  // ---------------------------------------------------------------------------

  it('initializeHybridSigning is idempotent', async () => {
    // Should not throw on re-initialization
    await expect(initializeHybridSigning()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // signHybrid
  // ---------------------------------------------------------------------------

  it('signHybrid produces all required fields', async () => {
    const result = await signHybrid('test data');

    expect(result.classicalSignature).toBeDefined();
    expect(result.pqSignature).toBeDefined();
    expect(result.combinedSignature).toBeDefined();
    expect(result.classicalPublicKey).toBeDefined();
    expect(result.pqPublicKey).toBeDefined();
    expect(result.combinedPublicKey).toBeDefined();
    expect(result.algorithm).toBe('hybrid-ed25519-dilithium3');
    expect(result.signedAt).toBeDefined();

    // All signatures should be non-empty base64 strings
    expect(result.classicalSignature.length).toBeGreaterThan(0);
    expect(result.pqSignature.length).toBeGreaterThan(0);
    expect(result.combinedSignature.length).toBeGreaterThan(0);
  });

  it('Ed25519 signature is 64 bytes', async () => {
    const result = await signHybrid('test');
    const sigBytes = Buffer.from(result.classicalSignature, 'base64');
    expect(sigBytes.length).toBe(64);
  });

  it('Dilithium3 signature is 3309 bytes (FIPS 204)', async () => {
    const result = await signHybrid('test');
    const sigBytes = Buffer.from(result.pqSignature, 'base64');
    expect(sigBytes.length).toBe(3309);
  });

  it('combined signature contains both components', async () => {
    const result = await signHybrid('test');
    const combined = Buffer.from(result.combinedSignature, 'base64');

    // 4 bytes length prefix + 64 (Ed25519) + 3309 (Dilithium3) = 3377
    expect(combined.length).toBe(4 + 64 + 3309);

    // Parse length prefix
    const classicalLen = combined.readUInt32BE(0);
    expect(classicalLen).toBe(64);
  });

  it('different data produces different signatures', async () => {
    const result1 = await signHybrid('data one');
    const result2 = await signHybrid('data two');

    expect(result1.classicalSignature).not.toBe(result2.classicalSignature);
    expect(result1.pqSignature).not.toBe(result2.pqSignature);
    expect(result1.combinedSignature).not.toBe(result2.combinedSignature);
  });

  // ---------------------------------------------------------------------------
  // verifyHybrid - valid signatures
  // ---------------------------------------------------------------------------

  it('verifyHybrid succeeds for valid signature', async () => {
    const data = 'proof data to sign';
    const signed = await signHybrid(data);
    const result = await verifyHybrid(data, signed.combinedSignature, signed.combinedPublicKey);

    expect(result.valid).toBe(true);
    expect(result.classicalValid).toBe(true);
    expect(result.pqValid).toBe(true);
    expect(result.verifiedAt).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('verifyHybrid succeeds for empty string data', async () => {
    const signed = await signHybrid('');
    const result = await verifyHybrid('', signed.combinedSignature, signed.combinedPublicKey);

    expect(result.valid).toBe(true);
  });

  it('verifyHybrid succeeds for long data', async () => {
    const longData = 'x'.repeat(10000);
    const signed = await signHybrid(longData);
    const result = await verifyHybrid(longData, signed.combinedSignature, signed.combinedPublicKey);

    expect(result.valid).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // verifyHybrid - tamper detection
  // ---------------------------------------------------------------------------

  it('tampered data fails verification', async () => {
    const signed = await signHybrid('original data');
    const result = await verifyHybrid('tampered data', signed.combinedSignature, signed.combinedPublicKey);

    expect(result.valid).toBe(false);
    // At least one of the two must fail
    expect(result.classicalValid && result.pqValid).toBe(false);
  });

  it('tampered combined signature fails verification', async () => {
    const signed = await signHybrid('test data');
    const sigBytes = Buffer.from(signed.combinedSignature, 'base64');

    // Flip a byte in the middle of the signature (past the length prefix)
    sigBytes[10] ^= 0xff;
    const tampered = sigBytes.toString('base64');

    const result = await verifyHybrid('test data', tampered, signed.combinedPublicKey);
    expect(result.valid).toBe(false);
  });

  it('mismatched public key fails verification', async () => {
    const signed1 = await signHybrid('data1');

    // Re-initialize to get a new key pair
    // Instead, sign different data with same key - then use wrong key
    // We can't easily get a different key pair, so let's verify with corrupted key
    const keyBytes = Buffer.from(signed1.combinedPublicKey, 'base64');
    keyBytes[10] ^= 0xff;
    const tamperedKey = keyBytes.toString('base64');

    const result = await verifyHybrid('data1', signed1.combinedSignature, tamperedKey);
    expect(result.valid).toBe(false);
  });

  it('truncated combined signature fails verification', async () => {
    const signed = await signHybrid('test');
    const sigBytes = Buffer.from(signed.combinedSignature, 'base64');

    // Truncate to just the length prefix
    const truncated = sigBytes.subarray(0, 4).toString('base64');

    const result = await verifyHybrid('test', truncated, signed.combinedPublicKey);
    expect(result.valid).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // isHybridAlgorithm
  // ---------------------------------------------------------------------------

  it('isHybridAlgorithm returns true for hybrid algorithm', () => {
    expect(isHybridAlgorithm('hybrid-ed25519-dilithium3')).toBe(true);
  });

  it('isHybridAlgorithm returns false for classical algorithms', () => {
    expect(isHybridAlgorithm('Ed25519')).toBe(false);
    expect(isHybridAlgorithm('ECDSA-P256')).toBe(false);
    expect(isHybridAlgorithm('')).toBe(false);
  });
});
