/**
 * Hybrid Classical/Post-Quantum Cryptography
 *
 * Provides hybrid cryptographic modes that combine classical algorithms with
 * post-quantum algorithms for defense-in-depth during the quantum transition period.
 *
 * Hybrid Mode Benefits:
 * - Security against both classical and quantum attacks
 * - Backward compatibility with classical-only systems
 * - Gradual migration path to full PQ
 * - Protection against implementation bugs in either scheme
 *
 * NIST Recommendation:
 * During the transition to post-quantum cryptography, NIST recommends using
 * hybrid modes that combine approved post-quantum algorithms with established
 * classical algorithms.
 *
 * @packageDocumentation
 * @module security/crypto/post-quantum/hybrid
 */

import * as crypto from 'node:crypto';
import { createLogger } from '../../../common/logger.js';
import { VorionError } from '../../../common/errors.js';
import { KyberService, createKyberService } from './kyber.js';
import { DilithiumService, createDilithiumService } from './dilithium.js';
import {
  type HybridConfig,
  type HybridKEMKeyPair,
  type HybridSignatureKeyPair,
  type HybridEncapsulationResult,
  type HybridSignatureResult,
  type KyberParameterSet,
  type DilithiumParameterSet,
  type ClassicalKEMAlgorithm,
  type ClassicalSignatureAlgorithm,
  ClassicalKEMAlgorithm as ClassicalKEM,
  ClassicalSignatureAlgorithm as ClassicalSig,
  KyberParameterSet as KyberPS,
  DilithiumParameterSet as DilithiumPS,
  DEFAULT_HYBRID_CONFIG,
  PQErrorCode,
  hybridConfigSchema,
} from './types.js';

const logger = createLogger({ component: 'pq-hybrid' });

// =============================================================================
// Error Class
// =============================================================================

/**
 * Hybrid mode error
 */
export class HybridCryptoError extends VorionError {
  override code = 'HYBRID_CRYPTO_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly errorCode: string = PQErrorCode.HYBRID_MODE_ERROR,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.name = 'HybridCryptoError';
  }
}

// =============================================================================
// Hybrid KEM Service
// =============================================================================

/**
 * Configuration for Hybrid KEM
 */
export interface HybridKEMConfig {
  /** Classical algorithm */
  classicalAlgorithm: ClassicalKEMAlgorithm;
  /** Post-quantum algorithm (Kyber) */
  pqAlgorithm: KyberParameterSet;
  /** Key derivation info string */
  kdfInfo: string;
  /** Require both classical and PQ to succeed */
  requireBothValid: boolean;
}

const DEFAULT_HYBRID_KEM_CONFIG: HybridKEMConfig = {
  classicalAlgorithm: ClassicalKEM.X25519,
  pqAlgorithm: KyberPS.KYBER768,
  kdfInfo: 'vorion-hybrid-kem-v1',
  requireBothValid: true,
};

/**
 * Hybrid Key Encapsulation Mechanism combining X25519/ECDH + Kyber
 *
 * Provides IND-CCA2 security assuming either the classical or PQ scheme is secure.
 *
 * @example
 * ```typescript
 * const hybridKEM = new HybridKEM();
 *
 * // Generate key pair
 * const keyPair = await hybridKEM.generateKeyPair();
 *
 * // Encapsulate (sender)
 * const { ciphertext, sharedSecret } = await hybridKEM.encapsulate(keyPair);
 *
 * // Decapsulate (recipient)
 * const { sharedSecret: recovered } = await hybridKEM.decapsulate(keyPair, ciphertext);
 * ```
 */
export class HybridKEM {
  private readonly config: HybridKEMConfig;
  private readonly kyber: KyberService;

  constructor(config: Partial<HybridKEMConfig> = {}) {
    this.config = { ...DEFAULT_HYBRID_KEM_CONFIG, ...config };
    this.kyber = createKyberService({
      defaultParameterSet: this.config.pqAlgorithm,
    });

    logger.info(
      {
        classicalAlgorithm: this.config.classicalAlgorithm,
        pqAlgorithm: this.config.pqAlgorithm,
      },
      'HybridKEM initialized'
    );
  }

  /**
   * Initialize the hybrid KEM
   */
  async initialize(): Promise<void> {
    await this.kyber.initialize();
    logger.info('HybridKEM initialization complete');
  }

  /**
   * Generate a hybrid key pair
   */
  async generateKeyPair(): Promise<HybridKEMKeyPair> {
    return this.kyber.generateHybridKeyPair(
      this.config.pqAlgorithm,
      this.config.classicalAlgorithm
    );
  }

  /**
   * Encapsulate a shared secret
   */
  async encapsulate(keyPair: HybridKEMKeyPair): Promise<HybridEncapsulationResult> {
    return this.kyber.hybridEncapsulate(
      keyPair.classicalPublicKey,
      keyPair.pqPublicKey,
      this.config.classicalAlgorithm,
      this.config.pqAlgorithm
    );
  }

  /**
   * Decapsulate a shared secret
   */
  async decapsulate(
    keyPair: HybridKEMKeyPair,
    ciphertext: Uint8Array
  ): Promise<{ sharedSecret: Uint8Array; success: boolean }> {
    return this.kyber.hybridDecapsulate(
      keyPair.classicalPrivateKey,
      keyPair.pqPrivateKey,
      ciphertext,
      this.config.classicalAlgorithm,
      this.config.pqAlgorithm
    );
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<HybridKEMConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Hybrid Signature Service
// =============================================================================

/**
 * Configuration for Hybrid Signatures
 */
export interface HybridSignatureConfig {
  /** Classical algorithm */
  classicalAlgorithm: ClassicalSignatureAlgorithm;
  /** Post-quantum algorithm (Dilithium) */
  pqAlgorithm: DilithiumParameterSet;
  /** Require both signatures to be valid */
  requireBothValid: boolean;
  /** Accept classical-only signatures (backward compatibility) */
  acceptClassicalOnly: boolean;
}

const DEFAULT_HYBRID_SIGNATURE_CONFIG: HybridSignatureConfig = {
  classicalAlgorithm: ClassicalSig.ED25519,
  pqAlgorithm: DilithiumPS.DILITHIUM3,
  requireBothValid: true,
  acceptClassicalOnly: false,
};

/**
 * Hybrid Digital Signature combining Ed25519/ECDSA + Dilithium
 *
 * Provides EUF-CMA security assuming either the classical or PQ scheme is secure.
 *
 * @example
 * ```typescript
 * const hybridSig = new HybridSign();
 *
 * // Generate key pair
 * const keyPair = await hybridSig.generateKeyPair();
 *
 * // Sign message
 * const message = new TextEncoder().encode('Hello, hybrid world!');
 * const { signature } = await hybridSig.sign(keyPair, message);
 *
 * // Verify signature
 * const { valid } = await hybridSig.verify(keyPair, message, signature);
 * ```
 */
export class HybridSign {
  private readonly config: HybridSignatureConfig;
  private readonly dilithium: DilithiumService;

  constructor(config: Partial<HybridSignatureConfig> = {}) {
    this.config = { ...DEFAULT_HYBRID_SIGNATURE_CONFIG, ...config };
    this.dilithium = createDilithiumService({
      defaultParameterSet: this.config.pqAlgorithm,
    });

    logger.info(
      {
        classicalAlgorithm: this.config.classicalAlgorithm,
        pqAlgorithm: this.config.pqAlgorithm,
        requireBothValid: this.config.requireBothValid,
      },
      'HybridSign initialized'
    );
  }

  /**
   * Initialize the hybrid signature service
   */
  async initialize(): Promise<void> {
    await this.dilithium.initialize();
    logger.info('HybridSign initialization complete');
  }

  /**
   * Generate a hybrid signature key pair
   */
  async generateKeyPair(): Promise<HybridSignatureKeyPair> {
    return this.dilithium.generateHybridKeyPair(
      this.config.pqAlgorithm,
      this.config.classicalAlgorithm
    );
  }

  /**
   * Sign a message with hybrid signature
   */
  async sign(
    keyPair: HybridSignatureKeyPair,
    message: Uint8Array
  ): Promise<HybridSignatureResult> {
    return this.dilithium.hybridSign(
      keyPair.classicalPrivateKey,
      keyPair.pqPrivateKey,
      message,
      this.config.classicalAlgorithm,
      this.config.pqAlgorithm
    );
  }

  /**
   * Verify a hybrid signature
   */
  async verify(
    keyPair: HybridSignatureKeyPair,
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<{ valid: boolean; classicalValid: boolean; pqValid: boolean; error?: string }> {
    return this.dilithium.hybridVerify(
      keyPair.classicalPublicKey,
      keyPair.pqPublicKey,
      message,
      signature,
      this.config.classicalAlgorithm,
      this.config.pqAlgorithm,
      this.config.requireBothValid
    );
  }

  /**
   * Verify a classical-only signature (backward compatibility)
   */
  async verifyClassicalOnly(
    classicalPublicKey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.acceptClassicalOnly) {
      return {
        valid: false,
        error: 'Classical-only signatures not accepted in current configuration',
      };
    }

    try {
      let valid = false;

      if (this.config.classicalAlgorithm === ClassicalSig.ED25519) {
        const publicKey = crypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            classicalPublicKey,
          ]),
          format: 'der',
          type: 'spki',
        });

        valid = crypto.verify(null, message, publicKey, signature);
      } else {
        const hashAlg = this.config.classicalAlgorithm === ClassicalSig.ECDSA_P256 ? 'sha256' : 'sha384';

        const publicKey = crypto.createPublicKey({
          key: Buffer.from(classicalPublicKey),
          format: 'der',
          type: 'spki',
        });

        const verify = crypto.createVerify(hashAlg);
        verify.update(message);
        valid = verify.verify(publicKey, signature);
      }

      return { valid };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<HybridSignatureConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Configurable Hybrid Crypto Provider
// =============================================================================

/**
 * Unified hybrid cryptography provider with configurable algorithm selection
 *
 * Supports:
 * - Dynamic algorithm selection
 * - Backward compatibility modes
 * - Gradual PQ migration
 */
export class HybridCryptoProvider {
  private readonly config: HybridConfig;
  private readonly kem: HybridKEM;
  private readonly sign: HybridSign;
  private initialized: boolean = false;

  constructor(config: Partial<HybridConfig> = {}) {
    // Merge with defaults, ensuring nested objects are properly merged
    this.config = {
      ...DEFAULT_HYBRID_CONFIG,
      ...config,
      kem: { ...DEFAULT_HYBRID_CONFIG.kem, ...config.kem },
      signature: { ...DEFAULT_HYBRID_CONFIG.signature, ...config.signature },
    };

    this.kem = new HybridKEM({
      classicalAlgorithm: this.config.kem.classicalAlgorithm,
      pqAlgorithm: this.config.kem.pqAlgorithm,
      requireBothValid: this.config.requireBothValid,
    });

    this.sign = new HybridSign({
      classicalAlgorithm: this.config.signature.classicalAlgorithm,
      pqAlgorithm: this.config.signature.pqAlgorithm,
      requireBothValid: this.config.requireBothValid,
      acceptClassicalOnly: this.config.backwardCompatibilityMode,
    });

    logger.info(
      {
        kemClassical: this.config.kem.classicalAlgorithm,
        kemPQ: this.config.kem.pqAlgorithm,
        sigClassical: this.config.signature.classicalAlgorithm,
        sigPQ: this.config.signature.pqAlgorithm,
        backwardCompatibility: this.config.backwardCompatibilityMode,
      },
      'HybridCryptoProvider initialized'
    );
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Promise.all([
      this.kem.initialize(),
      this.sign.initialize(),
    ]);

    this.initialized = true;
    logger.info('HybridCryptoProvider initialization complete');
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new HybridCryptoError(
        'HybridCryptoProvider not initialized. Call initialize() first.',
        PQErrorCode.HYBRID_MODE_ERROR
      );
    }
  }

  // ===========================================================================
  // Key Encapsulation
  // ===========================================================================

  /**
   * Generate a hybrid KEM key pair
   */
  async generateKEMKeyPair(): Promise<HybridKEMKeyPair> {
    this.ensureInitialized();
    return this.kem.generateKeyPair();
  }

  /**
   * Encapsulate a shared secret
   */
  async encapsulate(keyPair: HybridKEMKeyPair): Promise<HybridEncapsulationResult> {
    this.ensureInitialized();
    return this.kem.encapsulate(keyPair);
  }

  /**
   * Decapsulate a shared secret
   */
  async decapsulate(
    keyPair: HybridKEMKeyPair,
    ciphertext: Uint8Array
  ): Promise<{ sharedSecret: Uint8Array; success: boolean }> {
    this.ensureInitialized();
    return this.kem.decapsulate(keyPair, ciphertext);
  }

  // ===========================================================================
  // Digital Signatures
  // ===========================================================================

  /**
   * Generate a hybrid signature key pair
   */
  async generateSignatureKeyPair(): Promise<HybridSignatureKeyPair> {
    this.ensureInitialized();
    return this.sign.generateKeyPair();
  }

  /**
   * Sign a message
   */
  async signMessage(
    keyPair: HybridSignatureKeyPair,
    message: Uint8Array
  ): Promise<HybridSignatureResult> {
    this.ensureInitialized();
    return this.sign.sign(keyPair, message);
  }

  /**
   * Verify a signature
   */
  async verifySignature(
    keyPair: HybridSignatureKeyPair,
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<{ valid: boolean; classicalValid: boolean; pqValid: boolean; error?: string }> {
    this.ensureInitialized();
    return this.sign.verify(keyPair, message, signature);
  }

  /**
   * Verify a classical-only signature (backward compatibility)
   */
  async verifyClassicalSignature(
    classicalPublicKey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<{ valid: boolean; error?: string }> {
    this.ensureInitialized();

    if (!this.config.backwardCompatibilityMode) {
      return {
        valid: false,
        error: 'Backward compatibility mode is disabled',
      };
    }

    return this.sign.verifyClassicalOnly(classicalPublicKey, message, signature);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get current configuration
   */
  getConfig(): Readonly<HybridConfig> {
    return { ...this.config };
  }

  /**
   * Check if backward compatibility mode is enabled
   */
  isBackwardCompatibilityEnabled(): boolean {
    return this.config.backwardCompatibilityMode;
  }

  /**
   * Get the KEM service
   */
  getKEMService(): HybridKEM {
    return this.kem;
  }

  /**
   * Get the signature service
   */
  getSignatureService(): HybridSign {
    return this.sign;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a HybridKEM instance
 */
export function createHybridKEM(config?: Partial<HybridKEMConfig>): HybridKEM {
  return new HybridKEM(config);
}

/**
 * Create a HybridSign instance
 */
export function createHybridSign(config?: Partial<HybridSignatureConfig>): HybridSign {
  return new HybridSign(config);
}

/**
 * Create a HybridCryptoProvider instance
 */
export function createHybridCryptoProvider(config?: Partial<HybridConfig>): HybridCryptoProvider {
  return new HybridCryptoProvider(config);
}

/**
 * Create and initialize a HybridCryptoProvider
 */
export async function createInitializedHybridCryptoProvider(
  config?: Partial<HybridConfig>
): Promise<HybridCryptoProvider> {
  const provider = new HybridCryptoProvider(config);
  await provider.initialize();
  return provider;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine if a signature is hybrid or classical-only based on size
 */
export function isHybridSignature(
  signature: Uint8Array,
  classicalAlgorithm: ClassicalSignatureAlgorithm,
  pqAlgorithm: DilithiumParameterSet
): boolean {
  // Get expected sizes
  let classicalSize: number;
  if (classicalAlgorithm === ClassicalSig.ED25519) {
    classicalSize = 64;
  } else if (classicalAlgorithm === ClassicalSig.ECDSA_P256) {
    classicalSize = 72; // Max DER size
  } else {
    classicalSize = 104; // P-384
  }

  const pqParams = {
    [DilithiumPS.DILITHIUM2]: { signatureSize: 2420 },
    [DilithiumPS.DILITHIUM3]: { signatureSize: 3293 },
    [DilithiumPS.DILITHIUM5]: { signatureSize: 4595 },
  };

  const pqSize = pqParams[pqAlgorithm].signatureSize;
  const hybridMinSize = classicalSize + pqSize;

  return signature.length >= hybridMinSize - 10; // Allow some variance for ECDSA
}

/**
 * Split a hybrid signature into components
 */
export function splitHybridSignature(
  signature: Uint8Array,
  classicalAlgorithm: ClassicalSignatureAlgorithm,
  pqAlgorithm: DilithiumParameterSet
): { classicalSignature: Uint8Array; pqSignature: Uint8Array } | null {
  const pqParams = {
    [DilithiumPS.DILITHIUM2]: { signatureSize: 2420 },
    [DilithiumPS.DILITHIUM3]: { signatureSize: 3293 },
    [DilithiumPS.DILITHIUM5]: { signatureSize: 4595 },
  };

  const pqSize = pqParams[pqAlgorithm].signatureSize;

  if (signature.length < pqSize + 64) {
    return null;
  }

  const classicalSize = signature.length - pqSize;

  return {
    classicalSignature: signature.subarray(0, classicalSize),
    pqSignature: signature.subarray(classicalSize),
  };
}
