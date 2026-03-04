/**
 * Tests for FIPS Post-Quantum Algorithm Awareness
 *
 * Validates that ML-KEM (FIPS 203) and ML-DSA (FIPS 204) algorithms
 * are registered in the FIPS mode registry and pass validation.
 */

import { describe, it, expect } from 'vitest';
import {
  FIPS_KEM_ALGORITHMS,
  FIPS_PQ_SIGNATURE_ALGORITHMS,
  ML_KEM_PUBLIC_KEY_SIZES,
  ML_DSA_PUBLIC_KEY_SIZES,
  FIPS_MINIMUM_KEY_LENGTHS,
  validateAlgorithm,
  validateKeyLength,
  isFIPSCompliant,
  CryptoOperationType,
} from '../fips-mode.js';

// =============================================================================
// ML-KEM Registry (FIPS 203)
// =============================================================================

describe('FIPS ML-KEM (FIPS 203)', () => {
  it('FIPS_KEM_ALGORITHMS has three parameter sets', () => {
    expect(Object.keys(FIPS_KEM_ALGORITHMS)).toHaveLength(3);
    expect(FIPS_KEM_ALGORITHMS['ML-KEM-512']).toBe('ml-kem-512');
    expect(FIPS_KEM_ALGORITHMS['ML-KEM-768']).toBe('ml-kem-768');
    expect(FIPS_KEM_ALGORITHMS['ML-KEM-1024']).toBe('ml-kem-1024');
  });

  it('ML-KEM public key sizes match FIPS 203', () => {
    expect(ML_KEM_PUBLIC_KEY_SIZES['ml-kem-512']).toBe(800);
    expect(ML_KEM_PUBLIC_KEY_SIZES['ml-kem-768']).toBe(1184);
    expect(ML_KEM_PUBLIC_KEY_SIZES['ml-kem-1024']).toBe(1568);
  });

  it('ML-KEM minimum key lengths are registered', () => {
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-kem-512']).toBe(6400);
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-kem-768']).toBe(9472);
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-kem-1024']).toBe(12544);
  });

  it('validateAlgorithm accepts ML-KEM algorithms', () => {
    expect(validateAlgorithm('ml-kem-512')).toBe(true);
    expect(validateAlgorithm('ml-kem-768')).toBe(true);
    expect(validateAlgorithm('ml-kem-1024')).toBe(true);
  });

  it('validateAlgorithm accepts ML-KEM case-insensitively', () => {
    expect(validateAlgorithm('ML-KEM-768')).toBe(true);
    expect(validateAlgorithm('Ml-Kem-768')).toBe(true);
  });

  it('validateKeyLength accepts correct ML-KEM key sizes', () => {
    expect(validateKeyLength('ml-kem-512', 6400)).toBe(true);
    expect(validateKeyLength('ml-kem-768', 9472)).toBe(true);
    expect(validateKeyLength('ml-kem-1024', 12544)).toBe(true);
  });

  it('validateKeyLength rejects wrong ML-KEM key sizes', () => {
    expect(validateKeyLength('ml-kem-768', 128)).toBe(false);
    expect(validateKeyLength('ml-kem-768', 2048)).toBe(false);
  });

  it('isFIPSCompliant accepts ML-KEM operations', () => {
    expect(isFIPSCompliant({
      type: CryptoOperationType.KEM_ENCAPSULATE,
      algorithm: 'ml-kem-768',
      keyLength: 9472,
    })).toBe(true);
  });
});

// =============================================================================
// ML-DSA Registry (FIPS 204)
// =============================================================================

describe('FIPS ML-DSA (FIPS 204)', () => {
  it('FIPS_PQ_SIGNATURE_ALGORITHMS has three parameter sets', () => {
    expect(Object.keys(FIPS_PQ_SIGNATURE_ALGORITHMS)).toHaveLength(3);
    expect(FIPS_PQ_SIGNATURE_ALGORITHMS['ML-DSA-44']).toBe('ml-dsa-44');
    expect(FIPS_PQ_SIGNATURE_ALGORITHMS['ML-DSA-65']).toBe('ml-dsa-65');
    expect(FIPS_PQ_SIGNATURE_ALGORITHMS['ML-DSA-87']).toBe('ml-dsa-87');
  });

  it('ML-DSA public key sizes match FIPS 204', () => {
    expect(ML_DSA_PUBLIC_KEY_SIZES['ml-dsa-44']).toBe(1312);
    expect(ML_DSA_PUBLIC_KEY_SIZES['ml-dsa-65']).toBe(1952);
    expect(ML_DSA_PUBLIC_KEY_SIZES['ml-dsa-87']).toBe(2592);
  });

  it('ML-DSA minimum key lengths are registered', () => {
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-dsa-44']).toBe(10496);
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-dsa-65']).toBe(15616);
    expect(FIPS_MINIMUM_KEY_LENGTHS['ml-dsa-87']).toBe(20736);
  });

  it('validateAlgorithm accepts ML-DSA algorithms', () => {
    expect(validateAlgorithm('ml-dsa-44')).toBe(true);
    expect(validateAlgorithm('ml-dsa-65')).toBe(true);
    expect(validateAlgorithm('ml-dsa-87')).toBe(true);
  });

  it('validateAlgorithm accepts ML-DSA case-insensitively', () => {
    expect(validateAlgorithm('ML-DSA-65')).toBe(true);
    expect(validateAlgorithm('Ml-Dsa-87')).toBe(true);
  });

  it('validateKeyLength accepts correct ML-DSA key sizes', () => {
    expect(validateKeyLength('ml-dsa-44', 10496)).toBe(true);
    expect(validateKeyLength('ml-dsa-65', 15616)).toBe(true);
    expect(validateKeyLength('ml-dsa-87', 20736)).toBe(true);
  });

  it('validateKeyLength rejects wrong ML-DSA key sizes', () => {
    expect(validateKeyLength('ml-dsa-65', 256)).toBe(false);
    expect(validateKeyLength('ml-dsa-65', 2048)).toBe(false);
  });

  it('isFIPSCompliant accepts ML-DSA sign operations', () => {
    expect(isFIPSCompliant({
      type: CryptoOperationType.SIGN,
      algorithm: 'ml-dsa-65',
      keyLength: 15616,
    })).toBe(true);
  });

  it('isFIPSCompliant accepts ML-DSA verify operations', () => {
    expect(isFIPSCompliant({
      type: CryptoOperationType.VERIFY,
      algorithm: 'ml-dsa-87',
      keyLength: 20736,
    })).toBe(true);
  });
});

// =============================================================================
// Operation Type Additions
// =============================================================================

describe('KEM Operation Types', () => {
  it('CryptoOperationType has KEM operations', () => {
    expect(CryptoOperationType.KEM_ENCAPSULATE).toBe('kem_encapsulate');
    expect(CryptoOperationType.KEM_DECAPSULATE).toBe('kem_decapsulate');
  });
});
