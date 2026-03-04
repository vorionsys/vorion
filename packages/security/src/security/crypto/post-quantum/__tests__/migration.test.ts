/**
 * Tests for Post-Quantum Migration Utilities
 *
 * Validates the migration toolkit for transitioning from classical to PQ crypto:
 * - KeyRotationManager: key rotation through migration phases
 * - GradualRolloutManager: percentage-based PQ rollout
 * - AlgorithmNegotiator: algorithm selection between peers
 * - Factory functions and migration toolkit creation
 *
 * @module security/crypto/post-quantum/__tests__/migration.test
 */

import { describe, it, expect } from 'vitest';
import {
  KeyRotationManager,
  DualSignatureVerifier,
  GradualRolloutManager,
  AlgorithmNegotiator,
  MigrationError,
  createKeyRotationManager,
  createDualSignatureVerifier,
  createGradualRolloutManager,
  createAlgorithmNegotiator,
  createMigrationToolkit,
} from '../migration.js';
import {
  MigrationPhase,
  ClassicalKEMAlgorithm,
  ClassicalSignatureAlgorithm,
  KyberParameterSet,
  DilithiumParameterSet,
} from '../types.js';

// =============================================================================
// KeyRotationManager
// =============================================================================

describe('KeyRotationManager', () => {
  it('creates with default config', () => {
    const manager = new KeyRotationManager();
    expect(manager.getCurrentPhase()).toBe('classical-only');
  });

  it('getCurrentPhase returns classical-only by default', () => {
    const manager = new KeyRotationManager();
    expect(manager.getCurrentPhase()).toBe(MigrationPhase.CLASSICAL_ONLY);
  });

  it('rotateKEMKey returns newKeyPair and status after initialize', async () => {
    const manager = new KeyRotationManager();
    await manager.initialize();

    const result = await manager.rotateKEMKey('kem-key-1');

    expect(result.newKeyPair).toBeDefined();
    expect(result.newKeyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(result.newKeyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
    expect(result.status).toBeDefined();
    expect(result.status.currentKeyId).toBeDefined();
    expect(result.status.phase).toBe('classical-only');
    expect(result.status.rotatedAt).toBeInstanceOf(Date);
  });

  it('rotateSignatureKey works after initialize', async () => {
    const manager = new KeyRotationManager();
    await manager.initialize();

    const result = await manager.rotateSignatureKey('sig-key-1');

    expect(result.newKeyPair).toBeDefined();
    expect(result.newKeyPair.classicalPublicKey).toBeInstanceOf(Uint8Array);
    expect(result.newKeyPair.pqPublicKey).toBeInstanceOf(Uint8Array);
    expect(result.status.phase).toBe('classical-only');
  });

  it('getKeyRotationStatus returns status after rotation', async () => {
    const manager = new KeyRotationManager();
    await manager.initialize();

    await manager.rotateKEMKey('kem-key-2');
    const status = manager.getKeyRotationStatus('kem-key-2');

    expect(status).toBeDefined();
    expect(status!.currentKeyId).toBeDefined();
    expect(status!.classicalKeyActive).toBe(true);
    expect(status!.pqKeyActive).toBe(false); // classical-only phase
  });

  it('isRotationDue returns true for unknown key', () => {
    const manager = new KeyRotationManager();
    expect(manager.isRotationDue('nonexistent-key')).toBe(true);
  });

  it('advancePhase progresses through phases', () => {
    const manager = new KeyRotationManager();

    expect(manager.getCurrentPhase()).toBe('classical-only');

    const phase2 = manager.advancePhase();
    expect(phase2).toBe('hybrid');

    const phase3 = manager.advancePhase();
    expect(phase3).toBe('pq-primary');

    const phase4 = manager.advancePhase();
    expect(phase4).toBe('pq-only');

    // Should stay at pq-only (last phase)
    const phase5 = manager.advancePhase();
    expect(phase5).toBe('pq-only');
  });
});

// =============================================================================
// GradualRolloutManager
// =============================================================================

describe('GradualRolloutManager', () => {
  it('shouldUsePQ returns false with classical-only phase and gradual rollout disabled', () => {
    const manager = new GradualRolloutManager({
      currentPhase: MigrationPhase.CLASSICAL_ONLY,
      enableGradualRollout: false,
    });

    expect(manager.shouldUsePQ('any-entity')).toBe(false);
  });

  it('shouldUsePQ returns true with rolloutPercentage=100', () => {
    const manager = new GradualRolloutManager({
      enableGradualRollout: true,
      rolloutPercentage: 100,
    });

    expect(manager.shouldUsePQ('entity-1')).toBe(true);
    expect(manager.shouldUsePQ('entity-2')).toBe(true);
    expect(manager.shouldUsePQ('entity-999')).toBe(true);
  });

  it('shouldUsePQ returns false with rolloutPercentage=0', () => {
    const manager = new GradualRolloutManager({
      enableGradualRollout: true,
      rolloutPercentage: 0,
    });

    expect(manager.shouldUsePQ('entity-1')).toBe(false);
    expect(manager.shouldUsePQ('entity-2')).toBe(false);
  });

  it('setRolloutPercentage throws for invalid values', () => {
    const manager = new GradualRolloutManager();

    expect(() => manager.setRolloutPercentage(-1)).toThrow(MigrationError);
    expect(() => manager.setRolloutPercentage(101)).toThrow(MigrationError);
  });

  it('getRolloutStatus returns correct shape', () => {
    const manager = new GradualRolloutManager({
      enableGradualRollout: true,
      rolloutPercentage: 50,
      currentPhase: MigrationPhase.HYBRID,
      targetPhase: MigrationPhase.PQ_ONLY,
    });

    const status = manager.getRolloutStatus();

    expect(status.enabled).toBe(true);
    expect(status.percentage).toBe(50);
    expect(status.currentPhase).toBe('hybrid');
    expect(status.targetPhase).toBe('pq-only');
  });

  it('getPhaseForEntity returns correct phase', () => {
    const manager = new GradualRolloutManager({
      enableGradualRollout: true,
      rolloutPercentage: 100,
      currentPhase: MigrationPhase.CLASSICAL_ONLY,
      targetPhase: MigrationPhase.HYBRID,
    });

    // With 100% rollout, all entities should get target phase
    const phase = manager.getPhaseForEntity('any-entity');
    expect(phase).toBe('hybrid');
  });
});

// =============================================================================
// AlgorithmNegotiator
// =============================================================================

describe('AlgorithmNegotiator', () => {
  it('negotiate with classical-only phase returns only classical algorithms', () => {
    const negotiator = new AlgorithmNegotiator({
      currentPhase: MigrationPhase.CLASSICAL_ONLY,
    });

    const result = negotiator.negotiate({
      supportedKEM: [ClassicalKEMAlgorithm.X25519, KyberParameterSet.KYBER768],
      supportedSignatures: [ClassicalSignatureAlgorithm.ED25519, DilithiumParameterSet.DILITHIUM3],
      hybridSupported: false,
    });

    expect(result.success).toBe(true);
    expect(result.selectedKEM).toBe('x25519');
    expect(result.selectedSignature).toBe('ed25519');
    expect(result.hybridMode).toBe(false);
  });

  it('negotiate with hybrid phase can select PQ algorithms', () => {
    const negotiator = new AlgorithmNegotiator({
      currentPhase: MigrationPhase.HYBRID,
    });

    const result = negotiator.negotiate({
      supportedKEM: [KyberParameterSet.KYBER768],
      supportedSignatures: [DilithiumParameterSet.DILITHIUM3],
      hybridSupported: true,
    });

    expect(result.success).toBe(true);
    expect(result.selectedKEM).toBe('kyber768');
    expect(result.selectedSignature).toBe('dilithium3');
  });

  it('createNegotiationRequest returns supported algorithms based on phase', () => {
    const negotiator = new AlgorithmNegotiator({
      currentPhase: MigrationPhase.CLASSICAL_ONLY,
    });

    const request = negotiator.createNegotiationRequest();

    expect(request.supportedKEM).toContain('x25519');
    expect(request.supportedKEM).not.toContain('kyber768');
    expect(request.supportedSignatures).toContain('ed25519');
    expect(request.supportedSignatures).not.toContain('dilithium3');
    expect(request.hybridSupported).toBe(false);
  });

  it('negotiate returns success:false when no compatible algorithms', () => {
    const negotiator = new AlgorithmNegotiator({
      currentPhase: MigrationPhase.PQ_ONLY,
    });

    // Peer only supports classical, but we are PQ-only
    const result = negotiator.negotiate({
      supportedKEM: [ClassicalKEMAlgorithm.X25519],
      supportedSignatures: [ClassicalSignatureAlgorithm.ED25519],
      hybridSupported: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('Factory Functions', () => {
  it('createKeyRotationManager returns KeyRotationManager', () => {
    const manager = createKeyRotationManager();
    expect(manager).toBeInstanceOf(KeyRotationManager);
  });

  it('createDualSignatureVerifier returns DualSignatureVerifier', () => {
    const verifier = createDualSignatureVerifier();
    expect(verifier).toBeInstanceOf(DualSignatureVerifier);
  });

  it('createGradualRolloutManager returns GradualRolloutManager', () => {
    const manager = createGradualRolloutManager();
    expect(manager).toBeInstanceOf(GradualRolloutManager);
  });

  it('createAlgorithmNegotiator returns AlgorithmNegotiator', () => {
    const negotiator = createAlgorithmNegotiator();
    expect(negotiator).toBeInstanceOf(AlgorithmNegotiator);
  });
});

// =============================================================================
// Migration Toolkit
// =============================================================================

describe('createMigrationToolkit', () => {
  it('returns object with keyRotation, dualVerifier, rollout, negotiator', async () => {
    const toolkit = await createMigrationToolkit();

    expect(toolkit.keyRotation).toBeInstanceOf(KeyRotationManager);
    expect(toolkit.dualVerifier).toBeInstanceOf(DualSignatureVerifier);
    expect(toolkit.rollout).toBeInstanceOf(GradualRolloutManager);
    expect(toolkit.negotiator).toBeInstanceOf(AlgorithmNegotiator);
  });
});
