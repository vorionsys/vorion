/**
 * Tests for CRYSTALS-Kyber (ML-KEM) Post-Quantum KEM
 *
 * With @noble/post-quantum providing FIPS 203 ML-KEM, these tests validate
 * real lattice-based key encapsulation including cryptographic roundtrips:
 * - Encapsulation/decapsulation shared secrets MUST match
 * - Key sizes match NIST specifications
 * - Error handling for invalid inputs
 *
 * @module security/crypto/post-quantum/__tests__/kyber.test
 */

import { describe, it, expect } from 'vitest';
import {
  KyberService,
  KyberError,
  createKyberService,
  createInitializedKyberService,
} from '../kyber.js';
import { KYBER_PARAMETERS, KyberParameterSet } from '../types.js';

describe('KyberService', () => {
  // ---------------------------------------------------------------------------
  // Construction & Initialization
  // ---------------------------------------------------------------------------

  it('creates with default config', () => {
    const service = new KyberService();
    const config = service.getConfig();

    expect(config.defaultParameterSet).toBe('kyber768');
    expect(config.enableHybridMode).toBe(true);
    expect(config.preferNativeBindings).toBe(true);
    expect(config.hybridClassicalAlgorithm).toBe('x25519');
  });

  it('creates with custom config', () => {
    const service = new KyberService({
      defaultParameterSet: KyberParameterSet.KYBER512,
      enableHybridMode: false,
      preferNativeBindings: false,
    });
    const config = service.getConfig();

    expect(config.defaultParameterSet).toBe('kyber512');
    expect(config.enableHybridMode).toBe(false);
    expect(config.preferNativeBindings).toBe(false);
  });

  it('initializes without native module', async () => {
    const service = new KyberService();
    // Should complete without throwing even though no native module is available
    await expect(service.initialize()).resolves.toBeUndefined();
  });

  it('reports noble module available after init', async () => {
    const service = new KyberService();
    await service.initialize();

    // @noble/post-quantum provides ML-KEM (FIPS 203)
    expect(service.isNativeAvailable()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // getParameters
  // ---------------------------------------------------------------------------

  it('getParameters returns correct params for kyber512', () => {
    const service = new KyberService();
    const params = service.getParameters('kyber512' as KyberParameterSet);

    expect(params.publicKeySize).toBe(800);
    expect(params.privateKeySize).toBe(1632);
    expect(params.ciphertextSize).toBe(768);
    expect(params.sharedSecretSize).toBe(32);
    expect(params.securityLevel).toBe(1);
    expect(params.k).toBe(2);
  });

  it('getParameters returns correct params for kyber768', () => {
    const service = new KyberService();
    const params = service.getParameters('kyber768' as KyberParameterSet);

    expect(params.publicKeySize).toBe(1184);
    expect(params.privateKeySize).toBe(2400);
    expect(params.ciphertextSize).toBe(1088);
    expect(params.sharedSecretSize).toBe(32);
    expect(params.securityLevel).toBe(3);
    expect(params.k).toBe(3);
  });

  it('getParameters returns correct params for kyber1024', () => {
    const service = new KyberService();
    const params = service.getParameters('kyber1024' as KyberParameterSet);

    expect(params.publicKeySize).toBe(1568);
    expect(params.privateKeySize).toBe(3168);
    expect(params.ciphertextSize).toBe(1568);
    expect(params.sharedSecretSize).toBe(32);
    expect(params.securityLevel).toBe(5);
    expect(params.k).toBe(4);
  });

  it('getParameters throws for invalid set', () => {
    const service = new KyberService();

    expect(() => {
      service.getParameters('kyber999' as KyberParameterSet);
    }).toThrow(KyberError);
  });

  // ---------------------------------------------------------------------------
  // generateKeyPair
  // ---------------------------------------------------------------------------

  it('generates key pair with correct sizes (kyber512)', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber512' as KyberParameterSet);

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(KYBER_PARAMETERS[KyberParameterSet.KYBER512].publicKeySize);
    expect(keyPair.privateKey.length).toBe(KYBER_PARAMETERS[KyberParameterSet.KYBER512].privateKeySize);
  });

  it('generates key pair with correct sizes (kyber768 default)', async () => {
    const service = new KyberService(); // default is kyber768
    const keyPair = await service.generateKeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(1184);
    expect(keyPair.privateKey.length).toBe(2400);
    expect(keyPair.algorithm).toBe('kyber768');
  });

  it('generates key pair with correct sizes (kyber1024)', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber1024' as KyberParameterSet);

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(1568);
    expect(keyPair.privateKey.length).toBe(3168);
  });

  it('key pair has keyId and generatedAt', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair();

    expect(keyPair.keyId).toBeDefined();
    expect(typeof keyPair.keyId).toBe('string');
    expect(keyPair.keyId!.length).toBeGreaterThan(0);

    expect(keyPair.generatedAt).toBeDefined();
    expect(keyPair.generatedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------------
  // encapsulate
  // ---------------------------------------------------------------------------

  it('encapsulate produces correct ciphertext and secret sizes', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const result = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);

    expect(result.ciphertext).toBeInstanceOf(Uint8Array);
    expect(result.sharedSecret).toBeInstanceOf(Uint8Array);
    expect(result.ciphertext.length).toBe(KYBER_PARAMETERS[KyberParameterSet.KYBER768].ciphertextSize);
    expect(result.sharedSecret.length).toBe(KYBER_PARAMETERS[KyberParameterSet.KYBER768].sharedSecretSize);
  });

  it('encapsulate throws on wrong public key size', async () => {
    const service = new KyberService();
    const wrongSizeKey = new Uint8Array(100); // Wrong size for any parameter set

    await expect(
      service.encapsulate(wrongSizeKey, 'kyber768' as KyberParameterSet),
    ).rejects.toThrow(KyberError);
  });

  // ---------------------------------------------------------------------------
  // decapsulate
  // ---------------------------------------------------------------------------

  it('decapsulate returns success with correct sizes', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);
    const decResult = await service.decapsulate(
      keyPair.privateKey,
      encResult.ciphertext,
      'kyber768' as KyberParameterSet,
    );

    expect(decResult.sharedSecret).toBeInstanceOf(Uint8Array);
    expect(decResult.sharedSecret.length).toBe(32);
    expect(decResult.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Cryptographic Roundtrip (requires @noble/post-quantum)
  // ---------------------------------------------------------------------------

  it('encapsulate → decapsulate shared secrets match (kyber768)', async () => {
    const service = new KyberService();
    await service.initialize(); // Load noble ML-KEM
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);
    const decResult = await service.decapsulate(
      keyPair.privateKey,
      encResult.ciphertext,
      'kyber768' as KyberParameterSet,
    );

    // With noble ML-KEM, shared secrets MUST match
    expect(Buffer.from(decResult.sharedSecret).toString('hex'))
      .toBe(Buffer.from(encResult.sharedSecret).toString('hex'));
  });

  it('encapsulate → decapsulate shared secrets match (kyber512)', async () => {
    const service = new KyberService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('kyber512' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair.publicKey, 'kyber512' as KyberParameterSet);
    const decResult = await service.decapsulate(
      keyPair.privateKey,
      encResult.ciphertext,
      'kyber512' as KyberParameterSet,
    );

    expect(Buffer.from(decResult.sharedSecret).toString('hex'))
      .toBe(Buffer.from(encResult.sharedSecret).toString('hex'));
  });

  it('encapsulate → decapsulate shared secrets match (kyber1024)', async () => {
    const service = new KyberService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('kyber1024' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair.publicKey, 'kyber1024' as KyberParameterSet);
    const decResult = await service.decapsulate(
      keyPair.privateKey,
      encResult.ciphertext,
      'kyber1024' as KyberParameterSet,
    );

    expect(Buffer.from(decResult.sharedSecret).toString('hex'))
      .toBe(Buffer.from(encResult.sharedSecret).toString('hex'));
  });

  it('wrong private key produces different shared secret', async () => {
    const service = new KyberService();
    await service.initialize();
    const keyPair1 = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const keyPair2 = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair1.publicKey, 'kyber768' as KyberParameterSet);

    // Decapsulate with wrong private key — should NOT match
    const decResult = await service.decapsulate(
      keyPair2.privateKey,
      encResult.ciphertext,
      'kyber768' as KyberParameterSet,
    );

    expect(Buffer.from(decResult.sharedSecret).toString('hex'))
      .not.toBe(Buffer.from(encResult.sharedSecret).toString('hex'));
  });

  it('different encapsulations produce different shared secrets', async () => {
    const service = new KyberService();
    await service.initialize();
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const enc1 = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);
    const enc2 = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);

    // Two independent encapsulations should produce different shared secrets
    expect(Buffer.from(enc1.sharedSecret).toString('hex'))
      .not.toBe(Buffer.from(enc2.sharedSecret).toString('hex'));
  });

  it('decapsulate throws on wrong private key size', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);
    const encResult = await service.encapsulate(keyPair.publicKey, 'kyber768' as KyberParameterSet);

    const wrongSizeKey = new Uint8Array(100);

    await expect(
      service.decapsulate(wrongSizeKey, encResult.ciphertext, 'kyber768' as KyberParameterSet),
    ).rejects.toThrow(KyberError);
  });

  it('decapsulate throws on wrong ciphertext size', async () => {
    const service = new KyberService();
    const keyPair = await service.generateKeyPair('kyber768' as KyberParameterSet);

    const wrongSizeCt = new Uint8Array(100);

    await expect(
      service.decapsulate(keyPair.privateKey, wrongSizeCt, 'kyber768' as KyberParameterSet),
    ).rejects.toThrow(KyberError);
  });

  // ---------------------------------------------------------------------------
  // Uniqueness
  // ---------------------------------------------------------------------------

  it('different key pairs produce different keys', async () => {
    const service = new KyberService();
    const keyPair1 = await service.generateKeyPair();
    const keyPair2 = await service.generateKeyPair();

    // Public keys should differ (extremely high probability with random generation)
    const pub1Hex = Buffer.from(keyPair1.publicKey).toString('hex');
    const pub2Hex = Buffer.from(keyPair2.publicKey).toString('hex');
    expect(pub1Hex).not.toBe(pub2Hex);

    // Private keys should also differ
    const priv1Hex = Buffer.from(keyPair1.privateKey).toString('hex');
    const priv2Hex = Buffer.from(keyPair2.privateKey).toString('hex');
    expect(priv1Hex).not.toBe(priv2Hex);
  });
});

describe('Factory Functions', () => {
  it('createKyberService creates instance', () => {
    const service = createKyberService();
    expect(service).toBeInstanceOf(KyberService);

    const config = service.getConfig();
    expect(config.defaultParameterSet).toBe('kyber768');
  });

  it('createInitializedKyberService creates and initializes', async () => {
    const service = await createInitializedKyberService();

    expect(service).toBeInstanceOf(KyberService);
    // After initialization the native availability has been checked
    expect(typeof service.isNativeAvailable()).toBe('boolean');
  });
});
