/**
 * Post-Quantum Cryptography Module
 *
 * Provides post-quantum cryptographic primitives for the Vorion security platform:
 *
 * ## Key Encapsulation (KEM)
 * - **CRYSTALS-Kyber (ML-KEM)**: NIST FIPS 203 standardized KEM
 *   - Kyber512: Security Level 1
 *   - Kyber768: Security Level 3 (recommended)
 *   - Kyber1024: Security Level 5
 *
 * ## Digital Signatures
 * - **CRYSTALS-Dilithium (ML-DSA)**: NIST FIPS 204 standardized signatures
 *   - Dilithium2: Security Level 2
 *   - Dilithium3: Security Level 3 (recommended)
 *   - Dilithium5: Security Level 5
 *
 * ## Hybrid Modes
 * - X25519 + Kyber for KEM
 * - Ed25519 + Dilithium for signatures
 * - Configurable algorithm selection
 * - Backward compatibility support
 *
 * ## Migration Support
 * - Key rotation from classical to PQ
 * - Dual-signature verification
 * - Gradual rollout support
 * - Algorithm negotiation
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   createKyberService,
 *   createDilithiumService,
 *   createHybridCryptoProvider,
 *   createMigrationToolkit,
 * } from './security/crypto/post-quantum';
 *
 * // Key Encapsulation with Kyber
 * const kyber = createKyberService();
 * await kyber.initialize();
 *
 * const keyPair = await kyber.generateKeyPair('kyber768');
 * const { ciphertext, sharedSecret } = await kyber.encapsulate(keyPair.publicKey);
 * const { sharedSecret: recovered } = await kyber.decapsulate(keyPair.privateKey, ciphertext);
 *
 * // Digital Signatures with Dilithium
 * const dilithium = createDilithiumService();
 * await dilithium.initialize();
 *
 * const sigKeyPair = await dilithium.generateKeyPair('dilithium3');
 * const message = new TextEncoder().encode('Hello, PQ world!');
 * const { signature } = await dilithium.sign(sigKeyPair.privateKey, message);
 * const { valid } = await dilithium.verify(sigKeyPair.publicKey, message, signature);
 *
 * // Hybrid Mode (recommended for transition)
 * const hybrid = createHybridCryptoProvider();
 * await hybrid.initialize();
 *
 * const hybridKeyPair = await hybrid.generateKEMKeyPair();
 * const { sharedSecret } = await hybrid.encapsulate(hybridKeyPair);
 * ```
 *
 * ## PRODUCTION NOTE
 *
 * This module includes a reference implementation for demonstration and testing.
 * For production deployment, configure native bindings:
 *
 * - Install liboqs-node: `npm install liboqs-node`
 * - Or use @cloudflare/pq-crypto
 * - Or compile with OpenSSL 3.2+ with PQ provider
 *
 * The services automatically detect and use native bindings when available.
 *
 * @packageDocumentation
 * @module security/crypto/post-quantum
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Kyber Types
  KyberParameterSet,
  type KyberParameters,
  KYBER_PARAMETERS,
  type KyberKeyPair,

  // Dilithium Types
  DilithiumParameterSet,
  type DilithiumParameters,
  DILITHIUM_PARAMETERS,
  type DilithiumKeyPair,

  // Key Pair Types
  type PQAlgorithm,
  type PQKeyPair,
  pqKeyPairSchema,

  // KEM Operation Types
  type EncapsulationResult,
  type DecapsulationResult,
  encapsulationResultSchema,
  decapsulationResultSchema,

  // Signature Operation Types
  type SignatureResult,
  type VerificationResult,
  signatureResultSchema,
  verificationResultSchema,

  // Hybrid Types
  ClassicalKEMAlgorithm,
  ClassicalSignatureAlgorithm,
  type HybridKEMKeyPair,
  type HybridSignatureKeyPair,
  type HybridEncapsulationResult,
  type HybridSignatureResult,
  hybridKEMKeyPairSchema,
  hybridSignatureKeyPairSchema,
  hybridEncapsulationResultSchema,
  hybridSignatureResultSchema,

  // Configuration Types
  type KyberConfig,
  type DilithiumConfig,
  type HybridConfig,
  DEFAULT_KYBER_CONFIG,
  DEFAULT_DILITHIUM_CONFIG,
  DEFAULT_HYBRID_CONFIG,
  kyberConfigSchema,
  dilithiumConfigSchema,
  hybridConfigSchema,

  // Error Types
  PQErrorCode,

  // Migration Types
  MigrationPhase,
  type KeyRotationStatus,
  type AlgorithmNegotiationRequest,
  type AlgorithmNegotiationResult,
  keyRotationStatusSchema,
  algorithmNegotiationRequestSchema,
  algorithmNegotiationResultSchema,

  // Benchmark Types
  BenchmarkOperation,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  benchmarkResultSchema,
  benchmarkSuiteResultSchema,
} from './types.js';

// =============================================================================
// Kyber (ML-KEM) Service
// =============================================================================

export {
  KyberService,
  KyberError,
  createKyberService,
  createInitializedKyberService,
} from './kyber.js';

// =============================================================================
// Dilithium (ML-DSA) Service
// =============================================================================

export {
  DilithiumService,
  DilithiumError,
  createDilithiumService,
  createInitializedDilithiumService,
} from './dilithium.js';

// =============================================================================
// Hybrid Cryptography
// =============================================================================

export {
  // Hybrid KEM
  HybridKEM,
  type HybridKEMConfig,
  createHybridKEM,

  // Hybrid Signatures
  HybridSign,
  type HybridSignatureConfig,
  createHybridSign,

  // Unified Provider
  HybridCryptoProvider,
  HybridCryptoError,
  createHybridCryptoProvider,
  createInitializedHybridCryptoProvider,

  // Utilities
  isHybridSignature,
  splitHybridSignature,
} from './hybrid.js';

// =============================================================================
// Migration Utilities
// =============================================================================

export {
  // Key Rotation
  KeyRotationManager,
  createKeyRotationManager,

  // Dual Verification
  DualSignatureVerifier,
  createDualSignatureVerifier,

  // Gradual Rollout
  GradualRolloutManager,
  createGradualRolloutManager,

  // Algorithm Negotiation
  AlgorithmNegotiator,
  createAlgorithmNegotiator,

  // Migration Toolkit
  createMigrationToolkit,

  // Error
  MigrationError,

  // Config
  type MigrationConfig,
} from './migration.js';

// =============================================================================
// Benchmarks
// =============================================================================

export {
  BenchmarkRunner,
  type BenchmarkConfig,
  createBenchmarkRunner,
  runQuickBenchmark,
  runFullBenchmark,
} from './benchmark.js';

// =============================================================================
// Convenience Factory Functions
// =============================================================================

import { createInitializedKyberService } from './kyber.js';
import { createInitializedDilithiumService } from './dilithium.js';
import { createInitializedHybridCryptoProvider } from './hybrid.js';
import { createMigrationToolkit, type MigrationConfig } from './migration.js';
import { KyberParameterSet, DilithiumParameterSet, type HybridConfig, MigrationPhase } from './types.js';

/**
 * Create a fully initialized post-quantum crypto provider
 *
 * This is the recommended entry point for most use cases.
 * Returns a hybrid provider configured with sensible defaults.
 *
 * @example
 * ```typescript
 * const pq = await createPostQuantumProvider();
 *
 * // Generate keys
 * const kemKeys = await pq.generateKEMKeyPair();
 * const sigKeys = await pq.generateSignatureKeyPair();
 *
 * // Use for encryption
 * const { ciphertext, sharedSecret } = await pq.encapsulate(kemKeys);
 *
 * // Use for signing
 * const message = new Uint8Array([1, 2, 3, 4]);
 * const { signature } = await pq.signMessage(sigKeys, message);
 * ```
 */
export async function createPostQuantumProvider(config?: Partial<HybridConfig>) {
  return createInitializedHybridCryptoProvider(config);
}

/**
 * Create services for a specific security level
 *
 * @param level - NIST security level (1, 3, or 5)
 */
export async function createServicesForSecurityLevel(level: 1 | 3 | 5): Promise<{
  kyber: Awaited<ReturnType<typeof createInitializedKyberService>>;
  dilithium: Awaited<ReturnType<typeof createInitializedDilithiumService>>;
}> {
  const kyberAlg = level === 1 ? KyberParameterSet.KYBER512 :
    level === 3 ? KyberParameterSet.KYBER768 :
    KyberParameterSet.KYBER1024;

  const dilithiumAlg = level === 5 ? DilithiumParameterSet.DILITHIUM5 :
    level === 3 ? DilithiumParameterSet.DILITHIUM3 :
    DilithiumParameterSet.DILITHIUM2;

  const [kyber, dilithium] = await Promise.all([
    createInitializedKyberService({ defaultParameterSet: kyberAlg }),
    createInitializedDilithiumService({ defaultParameterSet: dilithiumAlg }),
  ]);

  return { kyber, dilithium };
}

/**
 * Create a migration-ready setup with gradual rollout support
 *
 * @example
 * ```typescript
 * const migration = await createMigrationReadySetup({
 *   currentPhase: 'hybrid',
 *   rolloutPercentage: 10,
 * });
 *
 * // Check if user should use PQ
 * if (migration.rollout.shouldUsePQ(userId)) {
 *   // Use PQ cryptography
 * }
 * ```
 */
export async function createMigrationReadySetup(config?: Partial<MigrationConfig>) {
  return createMigrationToolkit({
    currentPhase: MigrationPhase.HYBRID,
    enableGradualRollout: true,
    rolloutPercentage: 0,
    ...config,
  });
}

// =============================================================================
// Module Information
// =============================================================================

/**
 * Module version and capabilities
 */
export const PQ_MODULE_INFO = {
  version: '1.0.0',
  algorithms: {
    kem: ['kyber512', 'kyber768', 'kyber1024'],
    signatures: ['dilithium2', 'dilithium3', 'dilithium5'],
    hybrid: {
      kem: ['x25519+kyber', 'ecdh-p256+kyber', 'ecdh-p384+kyber'],
      signatures: ['ed25519+dilithium', 'ecdsa-p256+dilithium', 'ecdsa-p384+dilithium'],
    },
  },
  nistStandards: {
    kyber: 'FIPS 203 (ML-KEM)',
    dilithium: 'FIPS 204 (ML-DSA)',
  },
  recommended: {
    kem: 'kyber768',
    signature: 'dilithium3',
    mode: 'hybrid',
  },
} as const;
