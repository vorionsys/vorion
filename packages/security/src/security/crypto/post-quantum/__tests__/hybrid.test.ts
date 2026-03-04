/**
 * Tests for Hybrid Classical/Post-Quantum Cryptography
 *
 * Validates hybrid modes that combine classical algorithms (X25519, Ed25519)
 * with post-quantum algorithms (Kyber, Dilithium) for defense-in-depth:
 * - HybridKEM encapsulate/decapsulate roundtrip
 * - HybridSign sign/verify roundtrip
 * - HybridCryptoProvider unified interface
 * - Utility functions for signature detection and splitting
 *
 * @module security/crypto/post-quantum/__tests__/hybrid.test
 */

import { describe, it, expect } from 'vitest';
import {
  HybridKEM,
  HybridSign,
  HybridCryptoProvider,
  HybridCryptoError,
  createHybridKEM,
  createHybridSign,
  createHybridCryptoProvider,
  createInitializedHybridCryptoProvider,
  isHybridSignature,
  splitHybridSignature,
} from '../hybrid.js';
import {
  ClassicalSignatureAlgorithm,
  DilithiumParameterSet,
} from '../types.js';

// =============================================================================
// HybridKEM
// =============================================================================

describe('HybridKEM', () => {
  it('creates with defaults', () => {
    const kem = new HybridKEM();
    const config = kem.getConfig();

    expect(config.classicalAlgorithm).toBe('x25519');
    expect(config.pqAlgorithm).toBe('kyber768');
    expect(config.requireBothValid).toBe(true);
  });

  it('generateKeyPair returns hybrid key pair with classical and PQ keys', async () => {
    const kem = new HybridKEM();
    const keyPair = await kem.generateKeyPair();

    expect(keyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.classicalPrivateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPrivateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.classicalAlgorithm).toBe('x25519');
    expect(keyPair.pqAlgorithm).toBe('kyber768');
  });

  it('encapsulate/decapsulate roundtrip produces matching shared secrets', async () => {
    const kem = new HybridKEM();
    await kem.initialize();
    const keyPair = await kem.generateKeyPair();

    const encResult = await kem.encapsulate(keyPair);
    expect(encResult.ciphertext).toBeInstanceOf(Uint8Array);
    expect(encResult.sharedSecret).toBeInstanceOf(Uint8Array);
    expect(encResult.sharedSecret.length).toBe(32);

    const decResult = await kem.decapsulate(keyPair, encResult.ciphertext);
    expect(decResult.success).toBe(true);
    expect(Buffer.from(decResult.sharedSecret).toString('hex'))
      .toBe(Buffer.from(encResult.sharedSecret).toString('hex'));
  });
});

// =============================================================================
// HybridSign
// =============================================================================

describe('HybridSign', () => {
  it('creates with defaults', () => {
    const signer = new HybridSign();
    const config = signer.getConfig();

    expect(config.classicalAlgorithm).toBe('ed25519');
    expect(config.pqAlgorithm).toBe('dilithium3');
    expect(config.requireBothValid).toBe(true);
    expect(config.acceptClassicalOnly).toBe(false);
  });

  it('generateKeyPair returns hybrid signature key pair', async () => {
    const signer = new HybridSign();
    const keyPair = await signer.generateKeyPair();

    expect(keyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.classicalPrivateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPrivateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.classicalAlgorithm).toBe('ed25519');
    expect(keyPair.pqAlgorithm).toBe('dilithium3');
  });

  it('sign/verify roundtrip succeeds', async () => {
    const signer = new HybridSign();
    await signer.initialize();
    const keyPair = await signer.generateKeyPair();
    const message = new TextEncoder().encode('Hello, hybrid world!');

    const signResult = await signer.sign(keyPair, message);
    expect(signResult.signature).toBeInstanceOf(Uint8Array);
    expect(signResult.classicalSignature).toBeInstanceOf(Uint8Array);
    expect(signResult.pqSignature).toBeInstanceOf(Uint8Array);

    const verifyResult = await signer.verify(keyPair, message, signResult.signature);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.classicalValid).toBe(true);
    expect(verifyResult.pqValid).toBe(true);
  });

  it('tampered message fails verification', async () => {
    const signer = new HybridSign();
    await signer.initialize();
    const keyPair = await signer.generateKeyPair();
    const message = new TextEncoder().encode('Original message');

    const signResult = await signer.sign(keyPair, message);
    const tampered = new TextEncoder().encode('Tampered message');

    const verifyResult = await signer.verify(keyPair, tampered, signResult.signature);
    expect(verifyResult.valid).toBe(false);
  });
});

// =============================================================================
// HybridCryptoProvider
// =============================================================================

describe('HybridCryptoProvider', () => {
  it('creates without error', () => {
    const provider = new HybridCryptoProvider();
    expect(provider).toBeInstanceOf(HybridCryptoProvider);
  });

  it('throws if not initialized', async () => {
    const provider = new HybridCryptoProvider();

    await expect(provider.generateKEMKeyPair()).rejects.toThrow(HybridCryptoError);
    await expect(provider.generateSignatureKeyPair()).rejects.toThrow(HybridCryptoError);
  });

  it('generateKEMKeyPair works after initialize', async () => {
    const provider = new HybridCryptoProvider();
    await provider.initialize();

    const keyPair = await provider.generateKEMKeyPair();
    expect(keyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
  });

  it('generateSignatureKeyPair works after initialize', async () => {
    const provider = new HybridCryptoProvider();
    await provider.initialize();

    const keyPair = await provider.generateSignatureKeyPair();
    expect(keyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
  });

  it('signMessage/verifySignature roundtrip', async () => {
    const provider = new HybridCryptoProvider();
    await provider.initialize();

    const keyPair = await provider.generateSignatureKeyPair();
    const message = new TextEncoder().encode('Provider sign/verify test');

    const signResult = await provider.signMessage(keyPair, message);
    const verifyResult = await provider.verifySignature(keyPair, message, signResult.signature);

    expect(verifyResult.valid).toBe(true);
  });

  it('getConfig returns expected defaults', () => {
    const provider = new HybridCryptoProvider();
    const config = provider.getConfig();

    expect(config.requireBothValid).toBe(true);
    expect(config.backwardCompatibilityMode).toBe(false);
    expect(config.kem.classicalAlgorithm).toBe('x25519');
    expect(config.kem.pqAlgorithm).toBe('kyber768');
    expect(config.signature.classicalAlgorithm).toBe('ed25519');
    expect(config.signature.pqAlgorithm).toBe('dilithium3');
  });

  it('isBackwardCompatibilityEnabled returns false by default', () => {
    const provider = new HybridCryptoProvider();
    expect(provider.isBackwardCompatibilityEnabled()).toBe(false);
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe('isHybridSignature', () => {
  it('returns true for large signature (ed25519 + dilithium3)', () => {
    // ed25519 = 64 bytes, dilithium3 = 3293 bytes => hybrid min ~3347
    const largeSignature = new Uint8Array(3400);
    const result = isHybridSignature(
      largeSignature,
      ClassicalSignatureAlgorithm.ED25519,
      DilithiumParameterSet.DILITHIUM3,
    );
    expect(result).toBe(true);
  });

  it('returns false for small 64-byte signature', () => {
    const smallSignature = new Uint8Array(64);
    const result = isHybridSignature(
      smallSignature,
      ClassicalSignatureAlgorithm.ED25519,
      DilithiumParameterSet.DILITHIUM3,
    );
    expect(result).toBe(false);
  });
});

describe('splitHybridSignature', () => {
  it('returns null for too-short signature', () => {
    const shortSig = new Uint8Array(100);
    const result = splitHybridSignature(
      shortSig,
      ClassicalSignatureAlgorithm.ED25519,
      DilithiumParameterSet.DILITHIUM3,
    );
    expect(result).toBeNull();
  });

  it('returns classicalSignature and pqSignature for valid-size buffer', () => {
    // dilithium3 pqSize = 3293, need at least pqSize + 64 = 3357
    const validSig = new Uint8Array(3400);
    // Fill with identifiable patterns
    validSig.fill(0xaa, 0, 107);   // classical portion (3400 - 3293 = 107)
    validSig.fill(0xbb, 107);      // PQ portion

    const result = splitHybridSignature(
      validSig,
      ClassicalSignatureAlgorithm.ED25519,
      DilithiumParameterSet.DILITHIUM3,
    );

    expect(result).not.toBeNull();
    expect(result!.classicalSignature).toBeInstanceOf(Uint8Array);
    expect(result!.pqSignature).toBeInstanceOf(Uint8Array);
    expect(result!.pqSignature.length).toBe(3293);
    expect(result!.classicalSignature.length).toBe(107);
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('Factory Functions', () => {
  it('createHybridKEM creates instance', () => {
    const kem = createHybridKEM();
    expect(kem).toBeInstanceOf(HybridKEM);
  });

  it('createHybridSign creates instance', () => {
    const signer = createHybridSign();
    expect(signer).toBeInstanceOf(HybridSign);
  });

  it('createHybridCryptoProvider creates instance', () => {
    const provider = createHybridCryptoProvider();
    expect(provider).toBeInstanceOf(HybridCryptoProvider);
  });

  it('createInitializedHybridCryptoProvider creates and initializes', async () => {
    const provider = await createInitializedHybridCryptoProvider();
    expect(provider).toBeInstanceOf(HybridCryptoProvider);

    // Should not throw because it is already initialized
    const keyPair = await provider.generateKEMKeyPair();
    expect(keyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
  });
});
