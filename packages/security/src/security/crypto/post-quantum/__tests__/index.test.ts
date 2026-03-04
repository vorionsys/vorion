/**
 * Tests for Post-Quantum Cryptography Module Barrel Exports
 *
 * Validates:
 * - PQ_MODULE_INFO constant structure and values
 * - Key type and service re-exports are available
 * - Convenience factory functions return properly initialized instances
 */

import { describe, it, expect } from 'vitest';

import {
  // Module info
  PQ_MODULE_INFO,

  // Re-exported types/constants
  KyberService,
  DilithiumService,
  PQErrorCode,
  MigrationPhase,

  // Convenience factories
  createServicesForSecurityLevel,
  createPostQuantumProvider,
} from '../index.js';

// =============================================================================
// PQ_MODULE_INFO
// =============================================================================

describe('PQ_MODULE_INFO', () => {
  it('has version string', () => {
    expect(typeof PQ_MODULE_INFO.version).toBe('string');
    expect(PQ_MODULE_INFO.version).toBeTruthy();
  });

  it('lists three KEM algorithms', () => {
    expect(PQ_MODULE_INFO.algorithms.kem).toHaveLength(3);
    expect(PQ_MODULE_INFO.algorithms.kem).toContain('kyber512');
    expect(PQ_MODULE_INFO.algorithms.kem).toContain('kyber768');
    expect(PQ_MODULE_INFO.algorithms.kem).toContain('kyber1024');
  });

  it('lists three signature algorithms', () => {
    expect(PQ_MODULE_INFO.algorithms.signatures).toHaveLength(3);
    expect(PQ_MODULE_INFO.algorithms.signatures).toContain('dilithium2');
    expect(PQ_MODULE_INFO.algorithms.signatures).toContain('dilithium3');
    expect(PQ_MODULE_INFO.algorithms.signatures).toContain('dilithium5');
  });

  it('lists hybrid KEM and signature algorithms', () => {
    expect(PQ_MODULE_INFO.algorithms.hybrid.kem).toHaveLength(3);
    expect(PQ_MODULE_INFO.algorithms.hybrid.signatures).toHaveLength(3);
  });

  it('references FIPS 203 and FIPS 204', () => {
    expect(PQ_MODULE_INFO.nistStandards.kyber).toContain('FIPS 203');
    expect(PQ_MODULE_INFO.nistStandards.dilithium).toContain('FIPS 204');
  });

  it('recommends kyber768 and dilithium3', () => {
    expect(PQ_MODULE_INFO.recommended.kem).toBe('kyber768');
    expect(PQ_MODULE_INFO.recommended.signature).toBe('dilithium3');
  });
});

// =============================================================================
// Re-exports
// =============================================================================

describe('Re-exports', () => {
  it('exports KyberService', () => {
    expect(KyberService).toBeDefined();
    expect(typeof KyberService).toBe('function');
  });

  it('exports DilithiumService', () => {
    expect(DilithiumService).toBeDefined();
    expect(typeof DilithiumService).toBe('function');
  });

  it('exports PQErrorCode', () => {
    expect(PQErrorCode).toBeDefined();
    expect(PQErrorCode.KEY_GENERATION_FAILED).toBe('PQ_KEY_GENERATION_FAILED');
    expect(PQErrorCode.ENCAPSULATION_FAILED).toBe('PQ_ENCAPSULATION_FAILED');
  });

  it('exports MigrationPhase', () => {
    expect(MigrationPhase).toBeDefined();
    expect(MigrationPhase.CLASSICAL_ONLY).toBe('classical-only');
    expect(MigrationPhase.HYBRID).toBe('hybrid');
    expect(MigrationPhase.PQ_PRIMARY).toBe('pq-primary');
    expect(MigrationPhase.PQ_ONLY).toBe('pq-only');
  });
});

// =============================================================================
// Convenience Factories
// =============================================================================

describe('Convenience Factories', () => {
  it('createServicesForSecurityLevel(3) returns kyber and dilithium', async () => {
    const services = await createServicesForSecurityLevel(3);
    expect(services).toHaveProperty('kyber');
    expect(services).toHaveProperty('dilithium');
    expect(services.kyber).toBeDefined();
    expect(services.dilithium).toBeDefined();
  });

  it('createPostQuantumProvider returns initialized provider', async () => {
    const provider = await createPostQuantumProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.generateKEMKeyPair).toBe('function');
    expect(typeof provider.encapsulate).toBe('function');
  });
});
