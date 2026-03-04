/**
 * Post-Quantum Cryptography Types
 *
 * Type definitions for post-quantum cryptographic operations including:
 * - CRYSTALS-Kyber key encapsulation mechanism (KEM)
 * - CRYSTALS-Dilithium digital signatures
 * - Hybrid classical/PQ modes
 *
 * Based on NIST PQC standardization (FIPS 203, FIPS 204)
 *
 * @packageDocumentation
 * @module security/crypto/post-quantum/types
 */

import { z } from 'zod';

// =============================================================================
// Kyber (ML-KEM) Types - FIPS 203
// =============================================================================

/**
 * Kyber parameter sets as defined in FIPS 203
 * - kyber512: NIST Security Level 1 (equivalent to AES-128)
 * - kyber768: NIST Security Level 3 (equivalent to AES-192)
 * - kyber1024: NIST Security Level 5 (equivalent to AES-256)
 */
export const KyberParameterSet = {
  KYBER512: 'kyber512',
  KYBER768: 'kyber768',
  KYBER1024: 'kyber1024',
} as const;

export type KyberParameterSet = (typeof KyberParameterSet)[keyof typeof KyberParameterSet];

export const kyberParameterSetSchema = z.nativeEnum(KyberParameterSet);

/**
 * Kyber parameter specifications
 */
export interface KyberParameters {
  /** Parameter set name */
  name: KyberParameterSet;
  /** NIST security level (1, 3, or 5) */
  securityLevel: 1 | 3 | 5;
  /** Public key size in bytes */
  publicKeySize: number;
  /** Private key size in bytes */
  privateKeySize: number;
  /** Ciphertext size in bytes */
  ciphertextSize: number;
  /** Shared secret size in bytes */
  sharedSecretSize: number;
  /** k parameter (module rank) */
  k: number;
}

/**
 * Kyber parameter specifications for each security level
 */
export const KYBER_PARAMETERS: Record<KyberParameterSet, KyberParameters> = {
  [KyberParameterSet.KYBER512]: {
    name: KyberParameterSet.KYBER512,
    securityLevel: 1,
    publicKeySize: 800,
    privateKeySize: 1632,
    ciphertextSize: 768,
    sharedSecretSize: 32,
    k: 2,
  },
  [KyberParameterSet.KYBER768]: {
    name: KyberParameterSet.KYBER768,
    securityLevel: 3,
    publicKeySize: 1184,
    privateKeySize: 2400,
    ciphertextSize: 1088,
    sharedSecretSize: 32,
    k: 3,
  },
  [KyberParameterSet.KYBER1024]: {
    name: KyberParameterSet.KYBER1024,
    securityLevel: 5,
    publicKeySize: 1568,
    privateKeySize: 3168,
    ciphertextSize: 1568,
    sharedSecretSize: 32,
    k: 4,
  },
} as const;

// =============================================================================
// Dilithium (ML-DSA) Types - FIPS 204
// =============================================================================

/**
 * Dilithium parameter sets as defined in FIPS 204
 * - dilithium2: NIST Security Level 2 (recommended minimum)
 * - dilithium3: NIST Security Level 3
 * - dilithium5: NIST Security Level 5
 */
export const DilithiumParameterSet = {
  DILITHIUM2: 'dilithium2',
  DILITHIUM3: 'dilithium3',
  DILITHIUM5: 'dilithium5',
} as const;

export type DilithiumParameterSet = (typeof DilithiumParameterSet)[keyof typeof DilithiumParameterSet];

export const dilithiumParameterSetSchema = z.nativeEnum(DilithiumParameterSet);

/**
 * Dilithium parameter specifications
 */
export interface DilithiumParameters {
  /** Parameter set name */
  name: DilithiumParameterSet;
  /** NIST security level (2, 3, or 5) */
  securityLevel: 2 | 3 | 5;
  /** Public key size in bytes */
  publicKeySize: number;
  /** Private key size in bytes */
  privateKeySize: number;
  /** Signature size in bytes */
  signatureSize: number;
  /** k parameter */
  k: number;
  /** l parameter */
  l: number;
}

/**
 * Dilithium parameter specifications for each security level
 */
export const DILITHIUM_PARAMETERS: Record<DilithiumParameterSet, DilithiumParameters> = {
  [DilithiumParameterSet.DILITHIUM2]: {
    name: DilithiumParameterSet.DILITHIUM2,
    securityLevel: 2,
    publicKeySize: 1312,
    privateKeySize: 2560,
    signatureSize: 2420,
    k: 4,
    l: 4,
  },
  [DilithiumParameterSet.DILITHIUM3]: {
    name: DilithiumParameterSet.DILITHIUM3,
    securityLevel: 3,
    publicKeySize: 1952,
    privateKeySize: 4032,
    signatureSize: 3309,
    k: 6,
    l: 5,
  },
  [DilithiumParameterSet.DILITHIUM5]: {
    name: DilithiumParameterSet.DILITHIUM5,
    securityLevel: 5,
    publicKeySize: 2592,
    privateKeySize: 4896,
    signatureSize: 4627,
    k: 8,
    l: 7,
  },
} as const;

// =============================================================================
// Key Pair Types
// =============================================================================

/**
 * Post-quantum algorithm identifier
 */
export type PQAlgorithm = KyberParameterSet | DilithiumParameterSet;

/**
 * Post-quantum key pair
 */
export interface PQKeyPair {
  /** Public key bytes */
  publicKey: Uint8Array;
  /** Private key bytes */
  privateKey: Uint8Array;
  /** Algorithm identifier */
  algorithm: PQAlgorithm;
  /** Key generation timestamp */
  generatedAt?: Date;
  /** Key expiration timestamp */
  expiresAt?: Date;
  /** Key identifier for tracking */
  keyId?: string;
}

export const pqKeyPairSchema = z.object({
  publicKey: z.instanceof(Uint8Array),
  privateKey: z.instanceof(Uint8Array),
  algorithm: z.union([kyberParameterSetSchema, dilithiumParameterSetSchema]),
  generatedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  keyId: z.string().optional(),
});

/**
 * Kyber-specific key pair
 */
export interface KyberKeyPair extends PQKeyPair {
  algorithm: KyberParameterSet;
}

/**
 * Dilithium-specific key pair
 */
export interface DilithiumKeyPair extends PQKeyPair {
  algorithm: DilithiumParameterSet;
}

// =============================================================================
// KEM Operation Types
// =============================================================================

/**
 * Result of KEM encapsulation
 */
export interface EncapsulationResult {
  /** Ciphertext to send to recipient */
  ciphertext: Uint8Array;
  /** Shared secret established with recipient */
  sharedSecret: Uint8Array;
}

export const encapsulationResultSchema = z.object({
  ciphertext: z.instanceof(Uint8Array),
  sharedSecret: z.instanceof(Uint8Array),
});

/**
 * Result of KEM decapsulation
 */
export interface DecapsulationResult {
  /** Recovered shared secret */
  sharedSecret: Uint8Array;
  /** Whether decapsulation was successful */
  success: boolean;
}

export const decapsulationResultSchema = z.object({
  sharedSecret: z.instanceof(Uint8Array),
  success: z.boolean(),
});

// =============================================================================
// Signature Operation Types
// =============================================================================

/**
 * Digital signature result
 */
export interface SignatureResult {
  /** The digital signature */
  signature: Uint8Array;
  /** Algorithm used for signing */
  algorithm: DilithiumParameterSet;
  /** Message digest (if pre-hashed) */
  messageDigest?: Uint8Array;
}

export const signatureResultSchema = z.object({
  signature: z.instanceof(Uint8Array),
  algorithm: dilithiumParameterSetSchema,
  messageDigest: z.instanceof(Uint8Array).optional(),
});

/**
 * Signature verification result
 */
export interface VerificationResult {
  /** Whether the signature is valid */
  valid: boolean;
  /** Error message if verification failed */
  error?: string;
}

export const verificationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
});

// =============================================================================
// Hybrid Mode Types
// =============================================================================

/**
 * Classical algorithm for hybrid KEM
 */
export const ClassicalKEMAlgorithm = {
  X25519: 'x25519',
  ECDH_P256: 'ecdh-p256',
  ECDH_P384: 'ecdh-p384',
} as const;

export type ClassicalKEMAlgorithm = (typeof ClassicalKEMAlgorithm)[keyof typeof ClassicalKEMAlgorithm];

export const classicalKEMAlgorithmSchema = z.nativeEnum(ClassicalKEMAlgorithm);

/**
 * Classical algorithm for hybrid signatures
 */
export const ClassicalSignatureAlgorithm = {
  ED25519: 'ed25519',
  ECDSA_P256: 'ecdsa-p256',
  ECDSA_P384: 'ecdsa-p384',
} as const;

export type ClassicalSignatureAlgorithm = (typeof ClassicalSignatureAlgorithm)[keyof typeof ClassicalSignatureAlgorithm];

export const classicalSignatureAlgorithmSchema = z.nativeEnum(ClassicalSignatureAlgorithm);

/**
 * Hybrid KEM key pair combining classical and PQ
 */
export interface HybridKEMKeyPair {
  /** Classical public key */
  classicalPublicKey: Uint8Array;
  /** Classical private key */
  classicalPrivateKey: Uint8Array;
  /** PQ public key */
  pqPublicKey: Uint8Array;
  /** PQ private key */
  pqPrivateKey: Uint8Array;
  /** Classical algorithm */
  classicalAlgorithm: ClassicalKEMAlgorithm;
  /** PQ algorithm */
  pqAlgorithm: KyberParameterSet;
  /** Key identifier */
  keyId?: string;
  /** Generation timestamp */
  generatedAt?: Date;
}

export const hybridKEMKeyPairSchema = z.object({
  classicalPublicKey: z.instanceof(Uint8Array),
  classicalPrivateKey: z.instanceof(Uint8Array),
  pqPublicKey: z.instanceof(Uint8Array),
  pqPrivateKey: z.instanceof(Uint8Array),
  classicalAlgorithm: classicalKEMAlgorithmSchema,
  pqAlgorithm: kyberParameterSetSchema,
  keyId: z.string().optional(),
  generatedAt: z.coerce.date().optional(),
});

/**
 * Hybrid signature key pair combining classical and PQ
 */
export interface HybridSignatureKeyPair {
  /** Classical public key */
  classicalPublicKey: Uint8Array;
  /** Classical private key */
  classicalPrivateKey: Uint8Array;
  /** PQ public key */
  pqPublicKey: Uint8Array;
  /** PQ private key */
  pqPrivateKey: Uint8Array;
  /** Classical algorithm */
  classicalAlgorithm: ClassicalSignatureAlgorithm;
  /** PQ algorithm */
  pqAlgorithm: DilithiumParameterSet;
  /** Key identifier */
  keyId?: string;
  /** Generation timestamp */
  generatedAt?: Date;
}

export const hybridSignatureKeyPairSchema = z.object({
  classicalPublicKey: z.instanceof(Uint8Array),
  classicalPrivateKey: z.instanceof(Uint8Array),
  pqPublicKey: z.instanceof(Uint8Array),
  pqPrivateKey: z.instanceof(Uint8Array),
  classicalAlgorithm: classicalSignatureAlgorithmSchema,
  pqAlgorithm: dilithiumParameterSetSchema,
  keyId: z.string().optional(),
  generatedAt: z.coerce.date().optional(),
});

/**
 * Hybrid encapsulation result
 */
export interface HybridEncapsulationResult {
  /** Combined ciphertext (classical + PQ) */
  ciphertext: Uint8Array;
  /** Classical ciphertext component */
  classicalCiphertext: Uint8Array;
  /** PQ ciphertext component */
  pqCiphertext: Uint8Array;
  /** Combined shared secret */
  sharedSecret: Uint8Array;
}

export const hybridEncapsulationResultSchema = z.object({
  ciphertext: z.instanceof(Uint8Array),
  classicalCiphertext: z.instanceof(Uint8Array),
  pqCiphertext: z.instanceof(Uint8Array),
  sharedSecret: z.instanceof(Uint8Array),
});

/**
 * Hybrid signature result
 */
export interface HybridSignatureResult {
  /** Combined signature (classical || PQ) */
  signature: Uint8Array;
  /** Classical signature component */
  classicalSignature: Uint8Array;
  /** PQ signature component */
  pqSignature: Uint8Array;
  /** Classical algorithm used */
  classicalAlgorithm: ClassicalSignatureAlgorithm;
  /** PQ algorithm used */
  pqAlgorithm: DilithiumParameterSet;
}

export const hybridSignatureResultSchema = z.object({
  signature: z.instanceof(Uint8Array),
  classicalSignature: z.instanceof(Uint8Array),
  pqSignature: z.instanceof(Uint8Array),
  classicalAlgorithm: classicalSignatureAlgorithmSchema,
  pqAlgorithm: dilithiumParameterSetSchema,
});

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Kyber service configuration
 */
export interface KyberConfig {
  /** Default parameter set */
  defaultParameterSet: KyberParameterSet;
  /** Enable hybrid mode with classical algorithm */
  enableHybridMode: boolean;
  /** Classical algorithm for hybrid mode */
  hybridClassicalAlgorithm: ClassicalKEMAlgorithm;
  /** Use native bindings if available */
  preferNativeBindings: boolean;
}

export const kyberConfigSchema = z.object({
  defaultParameterSet: kyberParameterSetSchema.default(KyberParameterSet.KYBER768),
  enableHybridMode: z.boolean().default(true),
  hybridClassicalAlgorithm: classicalKEMAlgorithmSchema.default(ClassicalKEMAlgorithm.X25519),
  preferNativeBindings: z.boolean().default(true),
});

export const DEFAULT_KYBER_CONFIG: KyberConfig = {
  defaultParameterSet: KyberParameterSet.KYBER768,
  enableHybridMode: true,
  hybridClassicalAlgorithm: ClassicalKEMAlgorithm.X25519,
  preferNativeBindings: true,
};

/**
 * Dilithium service configuration
 */
export interface DilithiumConfig {
  /** Default parameter set */
  defaultParameterSet: DilithiumParameterSet;
  /** Enable hybrid mode with classical algorithm */
  enableHybridMode: boolean;
  /** Classical algorithm for hybrid mode */
  hybridClassicalAlgorithm: ClassicalSignatureAlgorithm;
  /** Use native bindings if available */
  preferNativeBindings: boolean;
  /** Pre-hash messages before signing (for large messages) */
  preHashMessages: boolean;
  /** Hash algorithm for pre-hashing */
  preHashAlgorithm: 'sha256' | 'sha384' | 'sha512';
}

export const dilithiumConfigSchema = z.object({
  defaultParameterSet: dilithiumParameterSetSchema.default(DilithiumParameterSet.DILITHIUM3),
  enableHybridMode: z.boolean().default(true),
  hybridClassicalAlgorithm: classicalSignatureAlgorithmSchema.default(ClassicalSignatureAlgorithm.ED25519),
  preferNativeBindings: z.boolean().default(true),
  preHashMessages: z.boolean().default(false),
  preHashAlgorithm: z.enum(['sha256', 'sha384', 'sha512']).default('sha256'),
});

export const DEFAULT_DILITHIUM_CONFIG: DilithiumConfig = {
  defaultParameterSet: DilithiumParameterSet.DILITHIUM3,
  enableHybridMode: true,
  hybridClassicalAlgorithm: ClassicalSignatureAlgorithm.ED25519,
  preferNativeBindings: true,
  preHashMessages: false,
  preHashAlgorithm: 'sha256',
};

/**
 * Hybrid mode configuration
 */
export interface HybridConfig {
  /** Require both classical and PQ verification to pass */
  requireBothValid: boolean;
  /** Backward compatibility mode (accept classical-only) */
  backwardCompatibilityMode: boolean;
  /** Default KEM configuration */
  kem: {
    classicalAlgorithm: ClassicalKEMAlgorithm;
    pqAlgorithm: KyberParameterSet;
  };
  /** Default signature configuration */
  signature: {
    classicalAlgorithm: ClassicalSignatureAlgorithm;
    pqAlgorithm: DilithiumParameterSet;
  };
}

export const hybridConfigSchema = z.object({
  requireBothValid: z.boolean().default(true),
  backwardCompatibilityMode: z.boolean().default(false),
  kem: z.object({
    classicalAlgorithm: classicalKEMAlgorithmSchema.default(ClassicalKEMAlgorithm.X25519),
    pqAlgorithm: kyberParameterSetSchema.default(KyberParameterSet.KYBER768),
  }),
  signature: z.object({
    classicalAlgorithm: classicalSignatureAlgorithmSchema.default(ClassicalSignatureAlgorithm.ED25519),
    pqAlgorithm: dilithiumParameterSetSchema.default(DilithiumParameterSet.DILITHIUM3),
  }),
});

export const DEFAULT_HYBRID_CONFIG: HybridConfig = {
  requireBothValid: true,
  backwardCompatibilityMode: false,
  kem: {
    classicalAlgorithm: ClassicalKEMAlgorithm.X25519,
    pqAlgorithm: KyberParameterSet.KYBER768,
  },
  signature: {
    classicalAlgorithm: ClassicalSignatureAlgorithm.ED25519,
    pqAlgorithm: DilithiumParameterSet.DILITHIUM3,
  },
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * Post-quantum cryptography error codes
 */
export const PQErrorCode = {
  /** Key generation failed */
  KEY_GENERATION_FAILED: 'PQ_KEY_GENERATION_FAILED',
  /** Encapsulation failed */
  ENCAPSULATION_FAILED: 'PQ_ENCAPSULATION_FAILED',
  /** Decapsulation failed */
  DECAPSULATION_FAILED: 'PQ_DECAPSULATION_FAILED',
  /** Signing failed */
  SIGNING_FAILED: 'PQ_SIGNING_FAILED',
  /** Verification failed */
  VERIFICATION_FAILED: 'PQ_VERIFICATION_FAILED',
  /** Invalid key format */
  INVALID_KEY_FORMAT: 'PQ_INVALID_KEY_FORMAT',
  /** Invalid parameter set */
  INVALID_PARAMETER_SET: 'PQ_INVALID_PARAMETER_SET',
  /** Native bindings not available */
  NATIVE_BINDINGS_UNAVAILABLE: 'PQ_NATIVE_BINDINGS_UNAVAILABLE',
  /** Hybrid mode error */
  HYBRID_MODE_ERROR: 'PQ_HYBRID_MODE_ERROR',
  /** Algorithm mismatch */
  ALGORITHM_MISMATCH: 'PQ_ALGORITHM_MISMATCH',
  /** Key expired */
  KEY_EXPIRED: 'PQ_KEY_EXPIRED',
  /** Migration error */
  MIGRATION_ERROR: 'PQ_MIGRATION_ERROR',
} as const;

export type PQErrorCode = (typeof PQErrorCode)[keyof typeof PQErrorCode];

// =============================================================================
// Migration Types
// =============================================================================

/**
 * Migration phase for classical to PQ transition
 */
export const MigrationPhase = {
  /** Classical only (pre-migration) */
  CLASSICAL_ONLY: 'classical-only',
  /** Hybrid mode (both classical and PQ) */
  HYBRID: 'hybrid',
  /** PQ primary with classical fallback */
  PQ_PRIMARY: 'pq-primary',
  /** PQ only (post-migration) */
  PQ_ONLY: 'pq-only',
} as const;

export type MigrationPhase = (typeof MigrationPhase)[keyof typeof MigrationPhase];

export const migrationPhaseSchema = z.nativeEnum(MigrationPhase);

/**
 * Key rotation status
 */
export interface KeyRotationStatus {
  /** Current key ID */
  currentKeyId: string;
  /** Previous key ID (if any) */
  previousKeyId?: string;
  /** Current migration phase */
  phase: MigrationPhase;
  /** Rotation timestamp */
  rotatedAt: Date;
  /** Next scheduled rotation */
  nextRotationAt?: Date;
  /** Classical key active */
  classicalKeyActive: boolean;
  /** PQ key active */
  pqKeyActive: boolean;
}

export const keyRotationStatusSchema = z.object({
  currentKeyId: z.string(),
  previousKeyId: z.string().optional(),
  phase: migrationPhaseSchema,
  rotatedAt: z.coerce.date(),
  nextRotationAt: z.coerce.date().optional(),
  classicalKeyActive: z.boolean(),
  pqKeyActive: z.boolean(),
});

/**
 * Algorithm negotiation request
 */
export interface AlgorithmNegotiationRequest {
  /** Supported KEM algorithms */
  supportedKEM: (ClassicalKEMAlgorithm | KyberParameterSet)[];
  /** Supported signature algorithms */
  supportedSignatures: (ClassicalSignatureAlgorithm | DilithiumParameterSet)[];
  /** Preferred algorithms */
  preferred?: {
    kem?: ClassicalKEMAlgorithm | KyberParameterSet;
    signature?: ClassicalSignatureAlgorithm | DilithiumParameterSet;
  };
  /** Whether hybrid mode is supported */
  hybridSupported: boolean;
}

export const algorithmNegotiationRequestSchema = z.object({
  supportedKEM: z.array(z.union([classicalKEMAlgorithmSchema, kyberParameterSetSchema])),
  supportedSignatures: z.array(z.union([classicalSignatureAlgorithmSchema, dilithiumParameterSetSchema])),
  preferred: z.object({
    kem: z.union([classicalKEMAlgorithmSchema, kyberParameterSetSchema]).optional(),
    signature: z.union([classicalSignatureAlgorithmSchema, dilithiumParameterSetSchema]).optional(),
  }).optional(),
  hybridSupported: z.boolean(),
});

/**
 * Algorithm negotiation result
 */
export interface AlgorithmNegotiationResult {
  /** Selected KEM algorithm */
  selectedKEM: ClassicalKEMAlgorithm | KyberParameterSet | null;
  /** Selected signature algorithm */
  selectedSignature: ClassicalSignatureAlgorithm | DilithiumParameterSet | null;
  /** Whether hybrid mode was selected */
  hybridMode: boolean;
  /** Negotiation successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export const algorithmNegotiationResultSchema = z.object({
  selectedKEM: z.union([classicalKEMAlgorithmSchema, kyberParameterSetSchema, z.null()]),
  selectedSignature: z.union([classicalSignatureAlgorithmSchema, dilithiumParameterSetSchema, z.null()]),
  hybridMode: z.boolean(),
  success: z.boolean(),
  error: z.string().optional(),
});

// =============================================================================
// Benchmark Types
// =============================================================================

/**
 * Benchmark operation type
 */
export const BenchmarkOperation = {
  KEY_GENERATION: 'key_generation',
  ENCAPSULATION: 'encapsulation',
  DECAPSULATION: 'decapsulation',
  SIGN: 'sign',
  VERIFY: 'verify',
} as const;

export type BenchmarkOperation = (typeof BenchmarkOperation)[keyof typeof BenchmarkOperation];

/**
 * Single benchmark result
 */
export interface BenchmarkResult {
  /** Operation type */
  operation: BenchmarkOperation;
  /** Algorithm used (includes hybrid algorithms like 'hybrid-kem', 'hybrid-sign') */
  algorithm: string;
  /** Number of iterations */
  iterations: number;
  /** Total time in milliseconds */
  totalTimeMs: number;
  /** Average time per operation in milliseconds */
  avgTimeMs: number;
  /** Minimum time in milliseconds */
  minTimeMs: number;
  /** Maximum time in milliseconds */
  maxTimeMs: number;
  /** Standard deviation */
  stdDevMs: number;
  /** Operations per second */
  opsPerSecond: number;
  /** Memory usage in bytes (if available) */
  memoryUsageBytes?: number;
}

export const benchmarkResultSchema = z.object({
  operation: z.nativeEnum(BenchmarkOperation),
  algorithm: z.string(),
  iterations: z.number().int().positive(),
  totalTimeMs: z.number().nonnegative(),
  avgTimeMs: z.number().nonnegative(),
  minTimeMs: z.number().nonnegative(),
  maxTimeMs: z.number().nonnegative(),
  stdDevMs: z.number().nonnegative(),
  opsPerSecond: z.number().nonnegative(),
  memoryUsageBytes: z.number().int().nonnegative().optional(),
});

/**
 * Complete benchmark suite results
 */
export interface BenchmarkSuiteResult {
  /** Timestamp of benchmark run */
  timestamp: Date;
  /** Platform information */
  platform: {
    nodeVersion: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
  };
  /** Individual benchmark results */
  results: BenchmarkResult[];
  /** Whether native bindings were used */
  nativeBindingsUsed: boolean;
}

export const benchmarkSuiteResultSchema = z.object({
  timestamp: z.coerce.date(),
  platform: z.object({
    nodeVersion: z.string(),
    arch: z.string(),
    cpuModel: z.string(),
    cpuCores: z.number().int().positive(),
  }),
  results: z.array(benchmarkResultSchema),
  nativeBindingsUsed: z.boolean(),
});
