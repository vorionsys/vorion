/**
 * Post-Quantum Migration Utilities
 *
 * Provides utilities for migrating from classical cryptography to post-quantum:
 * - Key rotation from classical to hybrid to PQ-only
 * - Dual-signature verification for transition period
 * - Gradual rollout support with feature flags
 * - Algorithm negotiation for interoperability
 *
 * Migration Strategy:
 * 1. CLASSICAL_ONLY: Current state, classical algorithms only
 * 2. HYBRID: Both classical and PQ algorithms, both must pass
 * 3. PQ_PRIMARY: PQ algorithms primary, classical for backward compatibility
 * 4. PQ_ONLY: Post-quantum algorithms only, classical deprecated
 *
 * @packageDocumentation
 * @module security/crypto/post-quantum/migration
 */

import * as crypto from 'node:crypto';
import { createLogger } from '../../../common/logger.js';
import { VorionError } from '../../../common/errors.js';
import { KyberService, createKyberService } from './kyber.js';
import { DilithiumService, createDilithiumService } from './dilithium.js';
import { HybridCryptoProvider, createHybridCryptoProvider, isHybridSignature, splitHybridSignature } from './hybrid.js';
import {
  type MigrationPhase,
  type KeyRotationStatus,
  type AlgorithmNegotiationRequest,
  type AlgorithmNegotiationResult,
  type KyberParameterSet,
  type DilithiumParameterSet,
  type ClassicalKEMAlgorithm,
  type ClassicalSignatureAlgorithm,
  type HybridKEMKeyPair,
  type HybridSignatureKeyPair,
  MigrationPhase as MigPhase,
  KyberParameterSet as KyberPS,
  DilithiumParameterSet as DilithiumPS,
  ClassicalKEMAlgorithm as ClassicalKEM,
  ClassicalSignatureAlgorithm as ClassicalSig,
  PQErrorCode,
  keyRotationStatusSchema,
  algorithmNegotiationResultSchema,
} from './types.js';

const logger = createLogger({ component: 'pq-migration' });

// =============================================================================
// Error Class
// =============================================================================

/**
 * Migration-specific error
 */
export class MigrationError extends VorionError {
  override code = 'PQ_MIGRATION_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly errorCode: string = PQErrorCode.MIGRATION_ERROR,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.name = 'MigrationError';
  }
}

// =============================================================================
// Migration Configuration
// =============================================================================

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /** Current migration phase */
  currentPhase: MigrationPhase;
  /** Target migration phase */
  targetPhase: MigrationPhase;
  /** Key rotation interval in days */
  keyRotationIntervalDays: number;
  /** Grace period for old keys in days */
  keyGracePeriodDays: number;
  /** Preferred PQ KEM algorithm */
  preferredKEM: KyberParameterSet;
  /** Preferred PQ signature algorithm */
  preferredSignature: DilithiumParameterSet;
  /** Preferred classical KEM algorithm */
  classicalKEM: ClassicalKEMAlgorithm;
  /** Preferred classical signature algorithm */
  classicalSignature: ClassicalSignatureAlgorithm;
  /** Enable dual-signature verification */
  enableDualVerification: boolean;
  /** Require both signatures in hybrid mode */
  requireBothSignatures: boolean;
  /** Enable gradual rollout (percentage-based) */
  enableGradualRollout: boolean;
  /** Rollout percentage (0-100) */
  rolloutPercentage: number;
}

const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
  currentPhase: MigPhase.CLASSICAL_ONLY,
  targetPhase: MigPhase.HYBRID,
  keyRotationIntervalDays: 90,
  keyGracePeriodDays: 30,
  preferredKEM: KyberPS.KYBER768,
  preferredSignature: DilithiumPS.DILITHIUM3,
  classicalKEM: ClassicalKEM.X25519,
  classicalSignature: ClassicalSig.ED25519,
  enableDualVerification: true,
  requireBothSignatures: true,
  enableGradualRollout: false,
  rolloutPercentage: 0,
};

// =============================================================================
// Key Rotation Manager
// =============================================================================

/**
 * Manages key rotation during PQ migration
 */
export class KeyRotationManager {
  private readonly config: MigrationConfig;
  private readonly kyber: KyberService;
  private readonly dilithium: DilithiumService;
  private readonly hybridProvider: HybridCryptoProvider;

  private currentKEMKeys: Map<string, HybridKEMKeyPair> = new Map();
  private currentSignatureKeys: Map<string, HybridSignatureKeyPair> = new Map();
  private keyRotationStatus: Map<string, KeyRotationStatus> = new Map();

  constructor(config: Partial<MigrationConfig> = {}) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };

    this.kyber = createKyberService({
      defaultParameterSet: this.config.preferredKEM,
    });

    this.dilithium = createDilithiumService({
      defaultParameterSet: this.config.preferredSignature,
    });

    this.hybridProvider = createHybridCryptoProvider({
      kem: {
        classicalAlgorithm: this.config.classicalKEM,
        pqAlgorithm: this.config.preferredKEM,
      },
      signature: {
        classicalAlgorithm: this.config.classicalSignature,
        pqAlgorithm: this.config.preferredSignature,
      },
      backwardCompatibilityMode: this.config.currentPhase !== MigPhase.PQ_ONLY,
    });

    logger.info(
      {
        currentPhase: this.config.currentPhase,
        targetPhase: this.config.targetPhase,
        rotationInterval: this.config.keyRotationIntervalDays,
      },
      'KeyRotationManager initialized'
    );
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    await Promise.all([
      this.kyber.initialize(),
      this.dilithium.initialize(),
      this.hybridProvider.initialize(),
    ]);

    logger.info('KeyRotationManager initialization complete');
  }

  /**
   * Rotate KEM keys from classical to hybrid
   */
  async rotateKEMKey(keyId: string): Promise<{
    newKeyPair: HybridKEMKeyPair;
    status: KeyRotationStatus;
  }> {
    const existingKey = this.currentKEMKeys.get(keyId);
    const previousKeyId = existingKey?.keyId;

    // Generate new hybrid key pair
    const newKeyPair = await this.hybridProvider.generateKEMKeyPair();

    // Update key storage
    this.currentKEMKeys.set(keyId, newKeyPair);

    // Update rotation status
    const status: KeyRotationStatus = {
      currentKeyId: newKeyPair.keyId || crypto.randomUUID(),
      previousKeyId,
      phase: this.config.currentPhase,
      rotatedAt: new Date(),
      nextRotationAt: new Date(
        Date.now() + this.config.keyRotationIntervalDays * 24 * 60 * 60 * 1000
      ),
      classicalKeyActive: this.config.currentPhase !== MigPhase.PQ_ONLY,
      pqKeyActive: this.config.currentPhase !== MigPhase.CLASSICAL_ONLY,
    };

    this.keyRotationStatus.set(keyId, status);

    logger.info(
      {
        keyId,
        newKeyId: status.currentKeyId,
        previousKeyId,
        phase: status.phase,
      },
      'KEM key rotated'
    );

    return { newKeyPair, status };
  }

  /**
   * Rotate signature keys from classical to hybrid
   */
  async rotateSignatureKey(keyId: string): Promise<{
    newKeyPair: HybridSignatureKeyPair;
    status: KeyRotationStatus;
  }> {
    const existingKey = this.currentSignatureKeys.get(keyId);
    const previousKeyId = existingKey?.keyId;

    // Generate new hybrid key pair
    const newKeyPair = await this.hybridProvider.generateSignatureKeyPair();

    // Update key storage
    this.currentSignatureKeys.set(keyId, newKeyPair);

    // Update rotation status
    const status: KeyRotationStatus = {
      currentKeyId: newKeyPair.keyId || crypto.randomUUID(),
      previousKeyId,
      phase: this.config.currentPhase,
      rotatedAt: new Date(),
      nextRotationAt: new Date(
        Date.now() + this.config.keyRotationIntervalDays * 24 * 60 * 60 * 1000
      ),
      classicalKeyActive: this.config.currentPhase !== MigPhase.PQ_ONLY,
      pqKeyActive: this.config.currentPhase !== MigPhase.CLASSICAL_ONLY,
    };

    this.keyRotationStatus.set(keyId, status);

    logger.info(
      {
        keyId,
        newKeyId: status.currentKeyId,
        previousKeyId,
        phase: status.phase,
      },
      'Signature key rotated'
    );

    return { newKeyPair, status };
  }

  /**
   * Get key rotation status
   */
  getKeyRotationStatus(keyId: string): KeyRotationStatus | undefined {
    return this.keyRotationStatus.get(keyId);
  }

  /**
   * Check if key rotation is due
   */
  isRotationDue(keyId: string): boolean {
    const status = this.keyRotationStatus.get(keyId);
    if (!status || !status.nextRotationAt) {
      return true; // No status means rotation is needed
    }
    return new Date() >= status.nextRotationAt;
  }

  /**
   * Get current migration phase
   */
  getCurrentPhase(): MigrationPhase {
    return this.config.currentPhase;
  }

  /**
   * Advance to next migration phase
   */
  advancePhase(): MigrationPhase {
    const phases: MigrationPhase[] = [
      MigPhase.CLASSICAL_ONLY,
      MigPhase.HYBRID,
      MigPhase.PQ_PRIMARY,
      MigPhase.PQ_ONLY,
    ];

    const currentIndex = phases.indexOf(this.config.currentPhase);
    if (currentIndex < phases.length - 1) {
      this.config.currentPhase = phases[currentIndex + 1]!;
      logger.info(
        {
          newPhase: this.config.currentPhase,
          previousPhase: phases[currentIndex],
        },
        'Migration phase advanced'
      );
    }

    return this.config.currentPhase;
  }

  /**
   * Get stored KEM key pair
   */
  getKEMKeyPair(keyId: string): HybridKEMKeyPair | undefined {
    return this.currentKEMKeys.get(keyId);
  }

  /**
   * Get stored signature key pair
   */
  getSignatureKeyPair(keyId: string): HybridSignatureKeyPair | undefined {
    return this.currentSignatureKeys.get(keyId);
  }
}

// =============================================================================
// Dual Signature Verifier
// =============================================================================

/**
 * Verifies signatures during migration, supporting both classical and hybrid
 */
export class DualSignatureVerifier {
  private readonly config: MigrationConfig;
  private readonly dilithium: DilithiumService;
  private readonly hybridProvider: HybridCryptoProvider;

  constructor(config: Partial<MigrationConfig> = {}) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };

    this.dilithium = createDilithiumService({
      defaultParameterSet: this.config.preferredSignature,
    });

    this.hybridProvider = createHybridCryptoProvider({
      signature: {
        classicalAlgorithm: this.config.classicalSignature,
        pqAlgorithm: this.config.preferredSignature,
      },
      backwardCompatibilityMode: true,
    });
  }

  /**
   * Initialize the verifier
   */
  async initialize(): Promise<void> {
    await Promise.all([
      this.dilithium.initialize(),
      this.hybridProvider.initialize(),
    ]);
  }

  /**
   * Verify a signature, automatically detecting if it's classical or hybrid
   */
  async verify(
    publicKey: HybridSignatureKeyPair | { classicalPublicKey: Uint8Array; pqPublicKey?: Uint8Array },
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<{
    valid: boolean;
    signatureType: 'classical' | 'hybrid' | 'pq-only';
    classicalValid?: boolean;
    pqValid?: boolean;
    error?: string;
  }> {
    const isHybrid = isHybridSignature(
      signature,
      this.config.classicalSignature,
      this.config.preferredSignature
    );

    if (isHybrid && publicKey.pqPublicKey) {
      // Hybrid signature verification
      const result = await this.hybridProvider.verifySignature(
        publicKey as HybridSignatureKeyPair,
        message,
        signature
      );

      return {
        valid: result.valid,
        signatureType: 'hybrid',
        classicalValid: result.classicalValid,
        pqValid: result.pqValid,
        error: result.error,
      };
    } else {
      // Classical-only signature
      if (this.config.currentPhase === MigPhase.PQ_ONLY) {
        return {
          valid: false,
          signatureType: 'classical',
          error: 'Classical-only signatures not accepted in PQ_ONLY phase',
        };
      }

      const result = await this.hybridProvider.verifyClassicalSignature(
        publicKey.classicalPublicKey,
        message,
        signature
      );

      return {
        valid: result.valid,
        signatureType: 'classical',
        classicalValid: result.valid,
        error: result.error,
      };
    }
  }

  /**
   * Verify with explicit signature type
   */
  async verifyExplicit(
    publicKey: HybridSignatureKeyPair,
    message: Uint8Array,
    signature: Uint8Array,
    signatureType: 'classical' | 'hybrid' | 'pq-only'
  ): Promise<{ valid: boolean; error?: string }> {
    switch (signatureType) {
      case 'classical':
        return this.hybridProvider.verifyClassicalSignature(
          publicKey.classicalPublicKey,
          message,
          signature
        );

      case 'hybrid':
        const hybridResult = await this.hybridProvider.verifySignature(
          publicKey,
          message,
          signature
        );
        return { valid: hybridResult.valid, error: hybridResult.error };

      case 'pq-only':
        const pqResult = await this.dilithium.verify(
          publicKey.pqPublicKey,
          message,
          signature,
          this.config.preferredSignature
        );
        return { valid: pqResult.valid, error: pqResult.error };

      default:
        return { valid: false, error: `Unknown signature type: ${signatureType}` };
    }
  }
}

// =============================================================================
// Gradual Rollout Manager
// =============================================================================

/**
 * Manages gradual rollout of PQ cryptography
 */
export class GradualRolloutManager {
  private readonly config: MigrationConfig;

  constructor(config: Partial<MigrationConfig> = {}) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };
  }

  /**
   * Check if a user/entity should use PQ cryptography
   * Uses consistent hashing for deterministic rollout
   */
  shouldUsePQ(entityId: string): boolean {
    if (!this.config.enableGradualRollout) {
      // Use phase-based decision
      return this.config.currentPhase !== MigPhase.CLASSICAL_ONLY;
    }

    // Calculate consistent hash
    const hash = crypto.createHash('sha256').update(entityId).digest();
    const hashValue = hash.readUInt32BE(0) % 100;

    return hashValue < this.config.rolloutPercentage;
  }

  /**
   * Get the appropriate migration phase for an entity
   */
  getPhaseForEntity(entityId: string): MigrationPhase {
    if (!this.config.enableGradualRollout) {
      return this.config.currentPhase;
    }

    if (this.shouldUsePQ(entityId)) {
      return this.config.targetPhase;
    }

    return MigPhase.CLASSICAL_ONLY;
  }

  /**
   * Update rollout percentage
   */
  setRolloutPercentage(percentage: number): void {
    if (percentage < 0 || percentage > 100) {
      throw new MigrationError(
        `Invalid rollout percentage: ${percentage}`,
        PQErrorCode.MIGRATION_ERROR,
        { percentage }
      );
    }

    this.config.rolloutPercentage = percentage;

    logger.info(
      { newPercentage: percentage },
      'Rollout percentage updated'
    );
  }

  /**
   * Get current rollout percentage
   */
  getRolloutPercentage(): number {
    return this.config.rolloutPercentage;
  }

  /**
   * Check rollout status
   */
  getRolloutStatus(): {
    enabled: boolean;
    percentage: number;
    currentPhase: MigrationPhase;
    targetPhase: MigrationPhase;
  } {
    return {
      enabled: this.config.enableGradualRollout,
      percentage: this.config.rolloutPercentage,
      currentPhase: this.config.currentPhase,
      targetPhase: this.config.targetPhase,
    };
  }
}

// =============================================================================
// Algorithm Negotiator
// =============================================================================

/**
 * Negotiates cryptographic algorithms between parties
 */
export class AlgorithmNegotiator {
  private readonly config: MigrationConfig;

  // Preference order: PQ > Hybrid > Classical
  private readonly kemPreferenceOrder = [
    KyberPS.KYBER1024,
    KyberPS.KYBER768,
    KyberPS.KYBER512,
    ClassicalKEM.ECDH_P384,
    ClassicalKEM.ECDH_P256,
    ClassicalKEM.X25519,
  ] as const;

  private readonly signaturePreferenceOrder = [
    DilithiumPS.DILITHIUM5,
    DilithiumPS.DILITHIUM3,
    DilithiumPS.DILITHIUM2,
    ClassicalSig.ECDSA_P384,
    ClassicalSig.ECDSA_P256,
    ClassicalSig.ED25519,
  ] as const;

  constructor(config: Partial<MigrationConfig> = {}) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };
  }

  /**
   * Negotiate algorithms with a peer
   */
  negotiate(request: AlgorithmNegotiationRequest): AlgorithmNegotiationResult {
    // Determine available algorithms based on current phase
    const availableKEM = this.getAvailableKEM();
    const availableSignatures = this.getAvailableSignatures();

    // Find best matching KEM
    let selectedKEM: ClassicalKEMAlgorithm | KyberParameterSet | null = null;

    // Check for preferred first
    if (request.preferred?.kem && request.supportedKEM.includes(request.preferred.kem)) {
      if (availableKEM.includes(request.preferred.kem)) {
        selectedKEM = request.preferred.kem;
      }
    }

    // Fall back to preference order
    if (!selectedKEM) {
      for (const kem of this.kemPreferenceOrder) {
        if (request.supportedKEM.includes(kem) && availableKEM.includes(kem)) {
          selectedKEM = kem;
          break;
        }
      }
    }

    // Find best matching signature
    let selectedSignature: ClassicalSignatureAlgorithm | DilithiumParameterSet | null = null;

    if (request.preferred?.signature && request.supportedSignatures.includes(request.preferred.signature)) {
      if (availableSignatures.includes(request.preferred.signature)) {
        selectedSignature = request.preferred.signature;
      }
    }

    if (!selectedSignature) {
      for (const sig of this.signaturePreferenceOrder) {
        if (request.supportedSignatures.includes(sig) && availableSignatures.includes(sig)) {
          selectedSignature = sig;
          break;
        }
      }
    }

    // Determine if hybrid mode applies
    const kemIsPQ = selectedKEM !== null && Object.values(KyberPS).includes(selectedKEM as KyberParameterSet);
    const sigIsPQ = selectedSignature !== null && Object.values(DilithiumPS).includes(selectedSignature as DilithiumParameterSet);
    const hybridMode = request.hybridSupported && (kemIsPQ || sigIsPQ) &&
      this.config.currentPhase === MigPhase.HYBRID;

    const success = selectedKEM !== null || selectedSignature !== null;

    const result: AlgorithmNegotiationResult = {
      selectedKEM,
      selectedSignature,
      hybridMode: hybridMode === true, // Ensure boolean
      success,
      error: success ? undefined : 'No compatible algorithms found',
    };

    logger.debug(
      {
        selectedKEM,
        selectedSignature,
        hybridMode,
        success,
        peerSupported: {
          kem: request.supportedKEM,
          signatures: request.supportedSignatures,
        },
      },
      'Algorithm negotiation complete'
    );

    return result;
  }

  /**
   * Get supported KEM algorithms for the current phase
   */
  private getAvailableKEM(): (ClassicalKEMAlgorithm | KyberParameterSet)[] {
    switch (this.config.currentPhase) {
      case MigPhase.CLASSICAL_ONLY:
        return [ClassicalKEM.X25519, ClassicalKEM.ECDH_P256, ClassicalKEM.ECDH_P384];

      case MigPhase.HYBRID:
      case MigPhase.PQ_PRIMARY:
        return [
          KyberPS.KYBER512,
          KyberPS.KYBER768,
          KyberPS.KYBER1024,
          ClassicalKEM.X25519,
          ClassicalKEM.ECDH_P256,
          ClassicalKEM.ECDH_P384,
        ];

      case MigPhase.PQ_ONLY:
        return [KyberPS.KYBER512, KyberPS.KYBER768, KyberPS.KYBER1024];

      default:
        return [];
    }
  }

  /**
   * Get supported signature algorithms for the current phase
   */
  private getAvailableSignatures(): (ClassicalSignatureAlgorithm | DilithiumParameterSet)[] {
    switch (this.config.currentPhase) {
      case MigPhase.CLASSICAL_ONLY:
        return [ClassicalSig.ED25519, ClassicalSig.ECDSA_P256, ClassicalSig.ECDSA_P384];

      case MigPhase.HYBRID:
      case MigPhase.PQ_PRIMARY:
        return [
          DilithiumPS.DILITHIUM2,
          DilithiumPS.DILITHIUM3,
          DilithiumPS.DILITHIUM5,
          ClassicalSig.ED25519,
          ClassicalSig.ECDSA_P256,
          ClassicalSig.ECDSA_P384,
        ];

      case MigPhase.PQ_ONLY:
        return [DilithiumPS.DILITHIUM2, DilithiumPS.DILITHIUM3, DilithiumPS.DILITHIUM5];

      default:
        return [];
    }
  }

  /**
   * Create a negotiation request
   */
  createNegotiationRequest(): AlgorithmNegotiationRequest {
    return {
      supportedKEM: this.getAvailableKEM(),
      supportedSignatures: this.getAvailableSignatures(),
      preferred: {
        kem: this.config.preferredKEM,
        signature: this.config.preferredSignature,
      },
      hybridSupported: this.config.currentPhase === MigPhase.HYBRID,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a KeyRotationManager
 */
export function createKeyRotationManager(config?: Partial<MigrationConfig>): KeyRotationManager {
  return new KeyRotationManager(config);
}

/**
 * Create a DualSignatureVerifier
 */
export function createDualSignatureVerifier(config?: Partial<MigrationConfig>): DualSignatureVerifier {
  return new DualSignatureVerifier(config);
}

/**
 * Create a GradualRolloutManager
 */
export function createGradualRolloutManager(config?: Partial<MigrationConfig>): GradualRolloutManager {
  return new GradualRolloutManager(config);
}

/**
 * Create an AlgorithmNegotiator
 */
export function createAlgorithmNegotiator(config?: Partial<MigrationConfig>): AlgorithmNegotiator {
  return new AlgorithmNegotiator(config);
}

/**
 * Create a complete migration toolkit
 */
export async function createMigrationToolkit(config?: Partial<MigrationConfig>): Promise<{
  keyRotation: KeyRotationManager;
  dualVerifier: DualSignatureVerifier;
  rollout: GradualRolloutManager;
  negotiator: AlgorithmNegotiator;
}> {
  const keyRotation = new KeyRotationManager(config);
  const dualVerifier = new DualSignatureVerifier(config);
  const rollout = new GradualRolloutManager(config);
  const negotiator = new AlgorithmNegotiator(config);

  await Promise.all([
    keyRotation.initialize(),
    dualVerifier.initialize(),
  ]);

  return { keyRotation, dualVerifier, rollout, negotiator };
}
