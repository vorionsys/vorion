/**
 * Tests for Post-Quantum Cryptography Type Definitions and Zod Schemas
 *
 * Validates:
 * - Kyber (ML-KEM) parameter constants match NIST FIPS 203 spec
 * - Dilithium (ML-DSA) parameter constants match NIST FIPS 204 spec
 * - Classical algorithm constant enumerations
 * - Zod config schemas produce correct defaults
 * - Default configuration objects have expected values
 */

import { describe, it, expect } from 'vitest';

import {
  KyberParameterSet,
  KYBER_PARAMETERS,
  DilithiumParameterSet,
  DILITHIUM_PARAMETERS,
  ClassicalKEMAlgorithm,
  ClassicalSignatureAlgorithm,
  PQErrorCode,
  MigrationPhase,
  BenchmarkOperation,
  kyberConfigSchema,
  dilithiumConfigSchema,
  hybridConfigSchema,
  DEFAULT_KYBER_CONFIG,
  DEFAULT_DILITHIUM_CONFIG,
  DEFAULT_HYBRID_CONFIG,
} from '../types.js';

// =============================================================================
// Kyber Parameter Constants
// =============================================================================

describe('Kyber Parameter Constants', () => {
  it('KyberParameterSet has three values', () => {
    const values = Object.values(KyberParameterSet);
    expect(values).toHaveLength(3);
    expect(values).toContain('kyber512');
    expect(values).toContain('kyber768');
    expect(values).toContain('kyber1024');
  });

  it('KYBER_PARAMETERS has entries for all parameter sets', () => {
    const parameterSets = Object.values(KyberParameterSet);
    for (const set of parameterSets) {
      expect(KYBER_PARAMETERS).toHaveProperty(set);
      expect(KYBER_PARAMETERS[set].name).toBe(set);
    }
  });

  it('KYBER_PARAMETERS sizes match NIST spec', () => {
    // Kyber512 - Security Level 1
    const k512 = KYBER_PARAMETERS[KyberParameterSet.KYBER512];
    expect(k512.securityLevel).toBe(1);
    expect(k512.publicKeySize).toBe(800);
    expect(k512.privateKeySize).toBe(1632);
    expect(k512.ciphertextSize).toBe(768);
    expect(k512.sharedSecretSize).toBe(32);
    expect(k512.k).toBe(2);

    // Kyber768 - Security Level 3
    const k768 = KYBER_PARAMETERS[KyberParameterSet.KYBER768];
    expect(k768.securityLevel).toBe(3);
    expect(k768.publicKeySize).toBe(1184);
    expect(k768.privateKeySize).toBe(2400);
    expect(k768.ciphertextSize).toBe(1088);
    expect(k768.sharedSecretSize).toBe(32);
    expect(k768.k).toBe(3);

    // Kyber1024 - Security Level 5
    const k1024 = KYBER_PARAMETERS[KyberParameterSet.KYBER1024];
    expect(k1024.securityLevel).toBe(5);
    expect(k1024.publicKeySize).toBe(1568);
    expect(k1024.privateKeySize).toBe(3168);
    expect(k1024.ciphertextSize).toBe(1568);
    expect(k1024.sharedSecretSize).toBe(32);
    expect(k1024.k).toBe(4);
  });

  it('all shared secret sizes are 32 bytes', () => {
    for (const params of Object.values(KYBER_PARAMETERS)) {
      expect(params.sharedSecretSize).toBe(32);
    }
  });
});

// =============================================================================
// Dilithium Parameter Constants
// =============================================================================

describe('Dilithium Parameter Constants', () => {
  it('DilithiumParameterSet has three values', () => {
    const values = Object.values(DilithiumParameterSet);
    expect(values).toHaveLength(3);
    expect(values).toContain('dilithium2');
    expect(values).toContain('dilithium3');
    expect(values).toContain('dilithium5');
  });

  it('DILITHIUM_PARAMETERS has entries for all parameter sets', () => {
    const parameterSets = Object.values(DilithiumParameterSet);
    for (const set of parameterSets) {
      expect(DILITHIUM_PARAMETERS).toHaveProperty(set);
      expect(DILITHIUM_PARAMETERS[set].name).toBe(set);
    }
  });

  it('DILITHIUM_PARAMETERS sizes match NIST spec', () => {
    // Dilithium2 / ML-DSA-44 - Security Level 2
    const d2 = DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM2];
    expect(d2.securityLevel).toBe(2);
    expect(d2.publicKeySize).toBe(1312);
    expect(d2.privateKeySize).toBe(2560);
    expect(d2.signatureSize).toBe(2420);
    expect(d2.k).toBe(4);
    expect(d2.l).toBe(4);

    // Dilithium3 / ML-DSA-65 - Security Level 3
    const d3 = DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM3];
    expect(d3.securityLevel).toBe(3);
    expect(d3.publicKeySize).toBe(1952);
    expect(d3.privateKeySize).toBe(4032);
    expect(d3.signatureSize).toBe(3309);
    expect(d3.k).toBe(6);
    expect(d3.l).toBe(5);

    // Dilithium5 / ML-DSA-87 - Security Level 5
    const d5 = DILITHIUM_PARAMETERS[DilithiumParameterSet.DILITHIUM5];
    expect(d5.securityLevel).toBe(5);
    expect(d5.publicKeySize).toBe(2592);
    expect(d5.privateKeySize).toBe(4896);
    expect(d5.signatureSize).toBe(4627);
    expect(d5.k).toBe(8);
    expect(d5.l).toBe(7);
  });
});

// =============================================================================
// Classical Algorithm Constants
// =============================================================================

describe('Classical Algorithm Constants', () => {
  it('ClassicalKEMAlgorithm has three values', () => {
    const values = Object.values(ClassicalKEMAlgorithm);
    expect(values).toHaveLength(3);
    expect(values).toContain('x25519');
    expect(values).toContain('ecdh-p256');
    expect(values).toContain('ecdh-p384');
  });

  it('ClassicalSignatureAlgorithm has three values', () => {
    const values = Object.values(ClassicalSignatureAlgorithm);
    expect(values).toHaveLength(3);
    expect(values).toContain('ed25519');
    expect(values).toContain('ecdsa-p256');
    expect(values).toContain('ecdsa-p384');
  });
});

// =============================================================================
// Zod Config Schemas
// =============================================================================

describe('Zod Config Schemas', () => {
  it('kyberConfigSchema validates empty object with defaults', () => {
    const result = kyberConfigSchema.parse({});
    expect(result.defaultParameterSet).toBe('kyber768');
    expect(result.enableHybridMode).toBe(true);
    expect(result.hybridClassicalAlgorithm).toBe('x25519');
    expect(result.preferNativeBindings).toBe(true);
  });

  it('dilithiumConfigSchema validates empty object with defaults', () => {
    const result = dilithiumConfigSchema.parse({});
    expect(result.defaultParameterSet).toBe('dilithium3');
    expect(result.enableHybridMode).toBe(true);
    expect(result.hybridClassicalAlgorithm).toBe('ed25519');
    expect(result.preferNativeBindings).toBe(true);
    expect(result.preHashMessages).toBe(false);
    expect(result.preHashAlgorithm).toBe('sha256');
  });

  it('hybridConfigSchema validates with nested defaults', () => {
    const result = hybridConfigSchema.parse({
      kem: {},
      signature: {},
    });
    expect(result.requireBothValid).toBe(true);
    expect(result.backwardCompatibilityMode).toBe(false);
    expect(result.kem.classicalAlgorithm).toBe('x25519');
    expect(result.kem.pqAlgorithm).toBe('kyber768');
    expect(result.signature.classicalAlgorithm).toBe('ed25519');
    expect(result.signature.pqAlgorithm).toBe('dilithium3');
  });

  it('kyberConfigSchema rejects invalid parameter set', () => {
    expect(() =>
      kyberConfigSchema.parse({ defaultParameterSet: 'kyber256' })
    ).toThrow();
  });
});

// =============================================================================
// Default Configs
// =============================================================================

describe('Default Configs', () => {
  it('DEFAULT_KYBER_CONFIG has expected values', () => {
    expect(DEFAULT_KYBER_CONFIG.defaultParameterSet).toBe(KyberParameterSet.KYBER768);
    expect(DEFAULT_KYBER_CONFIG.enableHybridMode).toBe(true);
    expect(DEFAULT_KYBER_CONFIG.hybridClassicalAlgorithm).toBe(ClassicalKEMAlgorithm.X25519);
    expect(DEFAULT_KYBER_CONFIG.preferNativeBindings).toBe(true);
  });

  it('DEFAULT_DILITHIUM_CONFIG has expected values', () => {
    expect(DEFAULT_DILITHIUM_CONFIG.defaultParameterSet).toBe(DilithiumParameterSet.DILITHIUM3);
    expect(DEFAULT_DILITHIUM_CONFIG.enableHybridMode).toBe(true);
    expect(DEFAULT_DILITHIUM_CONFIG.hybridClassicalAlgorithm).toBe(ClassicalSignatureAlgorithm.ED25519);
    expect(DEFAULT_DILITHIUM_CONFIG.preferNativeBindings).toBe(true);
    expect(DEFAULT_DILITHIUM_CONFIG.preHashMessages).toBe(false);
    expect(DEFAULT_DILITHIUM_CONFIG.preHashAlgorithm).toBe('sha256');
  });
});
