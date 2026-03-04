/**
 * Tests for CRYSTALS-Dilithium (ML-DSA) Post-Quantum Signatures
 *
 * With @noble/post-quantum providing FIPS 204 ML-DSA, these tests validate
 * real lattice-based digital signatures including cryptographic roundtrips:
 * - Sign/verify roundtrips MUST produce valid=true
 * - Tampered messages/signatures MUST fail verification
 * - Key sizes match NIST specifications
 *
 * @module security/crypto/post-quantum/__tests__/dilithium.test
 */

import { describe, it, expect } from 'vitest';
import {
  DilithiumService,
  DilithiumError,
  createDilithiumService,
  createInitializedDilithiumService,
} from '../dilithium.js';
import { DILITHIUM_PARAMETERS, DilithiumParameterSet } from '../types.js';

describe('DilithiumService', () => {
  // ---------------------------------------------------------------------------
  // Construction & Initialization
  // ---------------------------------------------------------------------------

  it('creates with default config', () => {
    const service = new DilithiumService();
    const config = service.getConfig();

    expect(config.defaultParameterSet).toBe('dilithium3');
    expect(config.enableHybridMode).toBe(true);
    expect(config.preferNativeBindings).toBe(true);
    expect(config.hybridClassicalAlgorithm).toBe('ed25519');
    expect(config.preHashMessages).toBe(false);
    expect(config.preHashAlgorithm).toBe('sha256');
  });

  it('creates with custom config', () => {
    const service = new DilithiumService({
      defaultParameterSet: DilithiumParameterSet.DILITHIUM5,
      enableHybridMode: false,
      preferNativeBindings: false,
      preHashMessages: true,
      preHashAlgorithm: 'sha512',
    });
    const config = service.getConfig();

    expect(config.defaultParameterSet).toBe('dilithium5');
    expect(config.enableHybridMode).toBe(false);
    expect(config.preferNativeBindings).toBe(false);
    expect(config.preHashMessages).toBe(true);
    expect(config.preHashAlgorithm).toBe('sha512');
  });

  it('initializes without native module', async () => {
    const service = new DilithiumService();
    // Should complete without throwing even though no native module is available
    await expect(service.initialize()).resolves.toBeUndefined();
  });

  it('reports noble module available after init', async () => {
    const service = new DilithiumService();
    await service.initialize();

    // @noble/post-quantum provides ML-DSA (FIPS 204)
    expect(service.isNativeAvailable()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // getParameters
  // ---------------------------------------------------------------------------

  it('getParameters returns correct params for dilithium2', () => {
    const service = new DilithiumService();
    const params = service.getParameters('dilithium2' as DilithiumParameterSet);

    expect(params.publicKeySize).toBe(1312);
    expect(params.privateKeySize).toBe(2560);
    expect(params.signatureSize).toBe(2420);
    expect(params.securityLevel).toBe(2);
    expect(params.k).toBe(4);
    expect(params.l).toBe(4);
  });

  it('getParameters returns correct params for dilithium3', () => {
    const service = new DilithiumService();
    const params = service.getParameters('dilithium3' as DilithiumParameterSet);

    expect(params.publicKeySize).toBe(1952);
    expect(params.privateKeySize).toBe(4032);
    expect(params.signatureSize).toBe(3309);
    expect(params.securityLevel).toBe(3);
    expect(params.k).toBe(6);
    expect(params.l).toBe(5);
  });

  it('getParameters returns correct params for dilithium5', () => {
    const service = new DilithiumService();
    const params = service.getParameters('dilithium5' as DilithiumParameterSet);

    expect(params.publicKeySize).toBe(2592);
    expect(params.privateKeySize).toBe(4896);
    expect(params.signatureSize).toBe(4627);
    expect(params.securityLevel).toBe(5);
    expect(params.k).toBe(8);
    expect(params.l).toBe(7);
  });

  it('getParameters throws for invalid set', () => {
    const service = new DilithiumService();

    expect(() => {
      service.getParameters('dilithium9' as DilithiumParameterSet);
    }).toThrow(DilithiumError);
  });

  // ---------------------------------------------------------------------------
  // generateKeyPair
  // ---------------------------------------------------------------------------

  it('generates key pair with correct sizes (dilithium2)', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium2' as DilithiumParameterSet);

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM2].publicKeySize);
    expect(keyPair.privateKey.length).toBe(DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM2].privateKeySize);
  });

  it('generates key pair with correct sizes (dilithium3 default)', async () => {
    const service = new DilithiumService(); // default is dilithium3
    const keyPair = await service.generateKeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(1952);
    expect(keyPair.privateKey.length).toBe(4032);
    expect(keyPair.algorithm).toBe('dilithium3');
  });

  it('generates key pair with correct sizes (dilithium5)', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium5' as DilithiumParameterSet);

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(2592);
    expect(keyPair.privateKey.length).toBe(4896);
  });

  it('key pair has keyId and generatedAt', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair();

    expect(keyPair.keyId).toBeDefined();
    expect(typeof keyPair.keyId).toBe('string');
    expect(keyPair.keyId!.length).toBeGreaterThan(0);

    expect(keyPair.generatedAt).toBeDefined();
    expect(keyPair.generatedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------------
  // sign
  // ---------------------------------------------------------------------------

  it('sign produces correct signature size', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Test message for signing');

    const result = await service.sign(keyPair.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    expect(result.signature).toBeInstanceOf(Uint8Array);
    expect(result.signature.length).toBe(DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM3].signatureSize);
    expect(result.algorithm).toBe('dilithium3');
  });

  it('sign throws on wrong private key size', async () => {
    const service = new DilithiumService();
    const wrongSizeKey = new Uint8Array(100);
    const message = new TextEncoder().encode('Test message');

    await expect(
      service.sign(wrongSizeKey, message, 'dilithium3' as DilithiumParameterSet),
    ).rejects.toThrow(DilithiumError);
  });

  // ---------------------------------------------------------------------------
  // verify
  // ---------------------------------------------------------------------------

  it('sign → verify roundtrip succeeds (dilithium3)', async () => {
    const service = new DilithiumService();
    await service.initialize(); // Load noble ML-DSA
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Test message for verification');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    const verifyResult = await service.verify(
      keyPair.publicKey,
      message,
      signResult.signature,
      'dilithium3' as DilithiumParameterSet,
    );

    // With noble ML-DSA, sign → verify MUST succeed
    expect(verifyResult.valid).toBe(true);
  });

  it('sign → verify roundtrip succeeds (dilithium2)', async () => {
    const service = new DilithiumService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('dilithium2' as DilithiumParameterSet);
    const message = new TextEncoder().encode('ML-DSA-44 test');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium2' as DilithiumParameterSet);

    const verifyResult = await service.verify(
      keyPair.publicKey,
      message,
      signResult.signature,
      'dilithium2' as DilithiumParameterSet,
    );

    expect(verifyResult.valid).toBe(true);
  });

  it('sign → verify roundtrip succeeds (dilithium5)', async () => {
    const service = new DilithiumService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('dilithium5' as DilithiumParameterSet);
    const message = new TextEncoder().encode('ML-DSA-87 test');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium5' as DilithiumParameterSet);

    const verifyResult = await service.verify(
      keyPair.publicKey,
      message,
      signResult.signature,
      'dilithium5' as DilithiumParameterSet,
    );

    expect(verifyResult.valid).toBe(true);
  });

  it('tampered message fails verification', async () => {
    const service = new DilithiumService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Original message');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    const tampered = new TextEncoder().encode('Tampered message');
    const verifyResult = await service.verify(
      keyPair.publicKey,
      tampered,
      signResult.signature,
      'dilithium3' as DilithiumParameterSet,
    );

    expect(verifyResult.valid).toBe(false);
  });

  it('wrong public key fails verification', async () => {
    const service = new DilithiumService();
    await service.initialize();
    const keyPair1 = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const keyPair2 = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Signed with key 1');
    const signResult = await service.sign(keyPair1.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    // Verify with different key pair's public key
    const verifyResult = await service.verify(
      keyPair2.publicKey,
      message,
      signResult.signature,
      'dilithium3' as DilithiumParameterSet,
    );

    expect(verifyResult.valid).toBe(false);
  });

  it('tampered signature fails verification', async () => {
    const service = new DilithiumService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Test message');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    // Flip a byte in the signature
    const tamperedSig = new Uint8Array(signResult.signature);
    tamperedSig[0] ^= 0xff;

    const verifyResult = await service.verify(
      keyPair.publicKey,
      message,
      tamperedSig,
      'dilithium3' as DilithiumParameterSet,
    );

    expect(verifyResult.valid).toBe(false);
  });

  it('verify returns invalid for wrong public key size', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Test message');
    const signResult = await service.sign(keyPair.privateKey, message, 'dilithium3' as DilithiumParameterSet);

    const wrongSizePk = new Uint8Array(100);
    const verifyResult = await service.verify(
      wrongSizePk,
      message,
      signResult.signature,
      'dilithium3' as DilithiumParameterSet,
    );

    // verify() returns { valid: false, error: ... } for wrong public key size
    // rather than throwing
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.error).toBeDefined();
    expect(typeof verifyResult.error).toBe('string');
  });

  it('verify returns invalid for wrong signature size', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);
    const message = new TextEncoder().encode('Test message');

    const wrongSizeSig = new Uint8Array(100);
    const verifyResult = await service.verify(
      keyPair.publicKey,
      message,
      wrongSizeSig,
      'dilithium3' as DilithiumParameterSet,
    );

    // verify() returns { valid: false, error: ... } for wrong signature size
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.error).toBeDefined();
    expect(typeof verifyResult.error).toBe('string');
  });

  // ---------------------------------------------------------------------------
  // Uniqueness
  // ---------------------------------------------------------------------------

  it('different messages produce different signatures', async () => {
    const service = new DilithiumService();
    const keyPair = await service.generateKeyPair('dilithium3' as DilithiumParameterSet);

    const message1 = new TextEncoder().encode('Message one');
    const message2 = new TextEncoder().encode('Message two');

    const sig1 = await service.sign(keyPair.privateKey, message1, 'dilithium3' as DilithiumParameterSet);
    const sig2 = await service.sign(keyPair.privateKey, message2, 'dilithium3' as DilithiumParameterSet);

    const sig1Hex = Buffer.from(sig1.signature).toString('hex');
    const sig2Hex = Buffer.from(sig2.signature).toString('hex');

    expect(sig1Hex).not.toBe(sig2Hex);
  });
});

describe('Factory Functions', () => {
  it('createDilithiumService creates instance', () => {
    const service = createDilithiumService();
    expect(service).toBeInstanceOf(DilithiumService);

    const config = service.getConfig();
    expect(config.defaultParameterSet).toBe('dilithium3');
  });

  it('createInitializedDilithiumService creates and initializes', async () => {
    const service = await createInitializedDilithiumService();

    expect(service).toBeInstanceOf(DilithiumService);
    // After initialization the native availability has been checked
    expect(typeof service.isNativeAvailable()).toBe('boolean');
  });
});
