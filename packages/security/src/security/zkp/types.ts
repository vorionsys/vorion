/**
 * Zero-Knowledge Proof Type Definitions
 *
 * Core type definitions for the ZKP system including proofs, verification results,
 * circuit definitions, and commitment schemes.
 *
 * This module follows the Vorion type definition patterns and integrates
 * with the existing security infrastructure.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// CIRCUIT TYPES
// =============================================================================

/**
 * Supported ZK circuit types
 */
export const ZKCircuitType = {
  /** Age verification without revealing date of birth */
  AGE_VERIFICATION: 'age_verification',
  /** Prove a value is within a range without revealing the value */
  RANGE_PROOF: 'range_proof',
  /** Prove membership in a set without revealing which element */
  SET_MEMBERSHIP: 'set_membership',
  /** Prove possession of a valid credential without revealing it */
  CREDENTIAL_VERIFICATION: 'credential_verification',
  /** Custom circuit for extensibility */
  CUSTOM: 'custom',
} as const;

export type ZKCircuitType = (typeof ZKCircuitType)[keyof typeof ZKCircuitType];

export const zkCircuitTypeSchema = z.nativeEnum(ZKCircuitType);

/**
 * Circuit metadata for registration and discovery
 */
export interface CircuitMetadata {
  /** Circuit type identifier */
  type: ZKCircuitType;
  /** Human-readable name */
  name: string;
  /** Circuit description */
  description: string;
  /** Version string (semver) */
  version: string;
  /** Expected public inputs */
  publicInputs: string[];
  /** Expected private inputs (for documentation) */
  privateInputs: string[];
  /** Verification key hash for integrity */
  verificationKeyHash?: string;
  /** When the circuit was registered */
  registeredAt: Date;
}

export const circuitMetadataSchema = z.object({
  type: zkCircuitTypeSchema,
  name: z.string().min(1),
  description: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publicInputs: z.array(z.string()),
  privateInputs: z.array(z.string()),
  verificationKeyHash: z.string().optional(),
  registeredAt: z.coerce.date(),
});

// =============================================================================
// PROOF TYPES
// =============================================================================

/**
 * Zero-Knowledge Proof structure
 *
 * Represents a cryptographic proof that can be verified without revealing
 * the underlying secret data.
 *
 * @example
 * ```typescript
 * const proof: ZKProof = {
 *   proof: new Uint8Array([...]),
 *   publicInputs: ['18', 'age_threshold'],
 *   circuit: 'age_verification',
 *   timestamp: new Date(),
 *   expiresAt: new Date(Date.now() + 3600000),
 *   metadata: { purpose: 'kyc_verification' }
 * };
 * ```
 */
export interface ZKProof {
  /** The cryptographic proof bytes */
  proof: Uint8Array;
  /** Public inputs that are revealed as part of the proof */
  publicInputs: string[];
  /** Circuit identifier used to generate the proof */
  circuit: string;
  /** When the proof was generated */
  timestamp: Date;
  /** Optional expiration time for the proof */
  expiresAt?: Date;
  /** Optional metadata for tracking and auditing */
  metadata?: Record<string, unknown>;
  /** Proof format version for compatibility */
  version?: string;
  /** Unique proof identifier for tracking */
  proofId?: string;
}

export const zkProofSchema = z.object({
  proof: z.instanceof(Uint8Array),
  publicInputs: z.array(z.string()),
  circuit: z.string().min(1),
  timestamp: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.string().optional(),
  proofId: z.string().uuid().optional(),
});

/**
 * Serializable proof format for storage and transmission
 */
export interface SerializedZKProof {
  /** Base64-encoded proof bytes */
  proof: string;
  /** Public inputs */
  publicInputs: string[];
  /** Circuit identifier */
  circuit: string;
  /** ISO timestamp when proof was generated */
  timestamp: string;
  /** ISO timestamp when proof expires */
  expiresAt?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Proof format version */
  version?: string;
  /** Unique proof identifier */
  proofId?: string;
}

export const serializedZKProofSchema = z.object({
  proof: z.string().min(1),
  publicInputs: z.array(z.string()),
  circuit: z.string().min(1),
  timestamp: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.string().optional(),
  proofId: z.string().uuid().optional(),
});

// =============================================================================
// VERIFICATION TYPES
// =============================================================================

/**
 * Result of proof verification
 *
 * Contains the verification outcome along with metadata about the verification process.
 */
export interface VerificationResult {
  /** Whether the proof is valid */
  valid: boolean;
  /** Circuit used for verification */
  circuit: string;
  /** When verification was performed */
  verifiedAt: Date;
  /** Public inputs that were verified */
  publicInputs: string[];
  /** Verification error message if invalid */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: VerificationErrorCode;
  /** Time taken to verify in milliseconds */
  verificationTimeMs?: number;
  /** Whether result was retrieved from cache */
  fromCache?: boolean;
  /** Cache entry expiration if cached */
  cacheExpiresAt?: Date;
}

export const verificationResultSchema = z.object({
  valid: z.boolean(),
  circuit: z.string().min(1),
  verifiedAt: z.coerce.date(),
  publicInputs: z.array(z.string()),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  verificationTimeMs: z.number().nonnegative().optional(),
  fromCache: z.boolean().optional(),
  cacheExpiresAt: z.coerce.date().optional(),
});

/**
 * Verification error codes for programmatic handling
 */
export const VerificationErrorCode = {
  /** Proof structure is invalid */
  INVALID_PROOF_FORMAT: 'INVALID_PROOF_FORMAT',
  /** Circuit not found or not registered */
  UNKNOWN_CIRCUIT: 'UNKNOWN_CIRCUIT',
  /** Proof has expired */
  PROOF_EXPIRED: 'PROOF_EXPIRED',
  /** Cryptographic verification failed */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /** Public inputs don't match expected format */
  INVALID_PUBLIC_INPUTS: 'INVALID_PUBLIC_INPUTS',
  /** Verification key not found */
  MISSING_VERIFICATION_KEY: 'MISSING_VERIFICATION_KEY',
  /** Internal verification error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type VerificationErrorCode = (typeof VerificationErrorCode)[keyof typeof VerificationErrorCode];

/**
 * Batch verification result for multiple proofs
 */
export interface BatchVerificationResult {
  /** All proofs valid */
  allValid: boolean;
  /** Number of proofs verified */
  totalProofs: number;
  /** Number of valid proofs */
  validProofs: number;
  /** Individual verification results */
  results: VerificationResult[];
  /** Total verification time in milliseconds */
  totalTimeMs: number;
  /** When batch verification completed */
  completedAt: Date;
}

export const batchVerificationResultSchema = z.object({
  allValid: z.boolean(),
  totalProofs: z.number().int().nonnegative(),
  validProofs: z.number().int().nonnegative(),
  results: z.array(verificationResultSchema),
  totalTimeMs: z.number().nonnegative(),
  completedAt: z.coerce.date(),
});

// =============================================================================
// COMMITMENT TYPES
// =============================================================================

/**
 * Commitment scheme types
 */
export const CommitmentScheme = {
  /** Pedersen commitment (additively homomorphic) */
  PEDERSEN: 'pedersen',
  /** Merkle tree commitment (for set membership) */
  MERKLE: 'merkle',
  /** Cryptographic accumulator (for dynamic sets) */
  ACCUMULATOR: 'accumulator',
  /** Hash commitment (simple binding) */
  HASH: 'hash',
} as const;

export type CommitmentScheme = (typeof CommitmentScheme)[keyof typeof CommitmentScheme];

export const commitmentSchemeSchema = z.nativeEnum(CommitmentScheme);

/**
 * Generic commitment structure
 */
export interface Commitment {
  /** Commitment scheme used */
  scheme: CommitmentScheme;
  /** The commitment value (hash or group element) */
  value: string;
  /** Optional blinding factor (for opening proofs) */
  blindingFactor?: string;
  /** When the commitment was created */
  createdAt: Date;
  /** Additional scheme-specific parameters */
  parameters?: Record<string, unknown>;
}

export const commitmentSchema = z.object({
  scheme: commitmentSchemeSchema,
  value: z.string().min(1),
  blindingFactor: z.string().optional(),
  createdAt: z.coerce.date(),
  parameters: z.record(z.unknown()).optional(),
});

/**
 * Merkle tree proof for set membership
 */
export interface MerkleProof {
  /** The leaf value being proven */
  leaf: string;
  /** The Merkle root */
  root: string;
  /** Sibling hashes along the path */
  siblings: string[];
  /** Path indices (left=0, right=1) */
  pathIndices: number[];
  /** Leaf index in the tree */
  leafIndex: number;
}

export const merkleProofSchema = z.object({
  leaf: z.string().min(1),
  root: z.string().min(1),
  siblings: z.array(z.string()),
  pathIndices: z.array(z.number().int().min(0).max(1)),
  leafIndex: z.number().int().nonnegative(),
});

/**
 * Pedersen commitment with opening
 */
export interface PedersenCommitment {
  /** The commitment C = g^v * h^r */
  commitment: string;
  /** Generator g (public parameter) */
  generatorG: string;
  /** Generator h (public parameter) */
  generatorH: string;
  /** Value being committed (private) */
  value?: string;
  /** Blinding factor r (private) */
  blindingFactor?: string;
}

export const pedersenCommitmentSchema = z.object({
  commitment: z.string().min(1),
  generatorG: z.string().min(1),
  generatorH: z.string().min(1),
  value: z.string().optional(),
  blindingFactor: z.string().optional(),
});

// =============================================================================
// CREDENTIAL TYPES
// =============================================================================

/**
 * Credential for ZK credential proofs
 */
export interface ZKCredential {
  /** Credential identifier */
  id: string;
  /** Credential issuer DID */
  issuer: string;
  /** Credential subject DID */
  subject: string;
  /** Credential type (e.g., 'AgeCredential', 'EmploymentCredential') */
  type: string;
  /** Credential claims (attribute-value pairs) */
  claims: Record<string, unknown>;
  /** Credential issuance date */
  issuedAt: Date;
  /** Credential expiration date */
  expiresAt?: Date;
  /** Issuer signature over the credential */
  signature: string;
  /** Revocation status commitment (for efficient revocation checks) */
  revocationCommitment?: string;
}

export const zkCredentialSchema = z.object({
  id: z.string().min(1),
  issuer: z.string().min(1),
  subject: z.string().min(1),
  type: z.string().min(1),
  claims: z.record(z.unknown()),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  signature: z.string().min(1),
  revocationCommitment: z.string().optional(),
});

/**
 * Selective disclosure request for credential proofs
 */
export interface SelectiveDisclosureRequest {
  /** Claims to prove (without revealing values) */
  proveExistence: string[];
  /** Claims to reveal */
  reveal: string[];
  /** Predicate proofs (e.g., age > 18) */
  predicates: PredicateProof[];
}

export const selectiveDisclosureRequestSchema = z.object({
  proveExistence: z.array(z.string()),
  reveal: z.array(z.string()),
  predicates: z.array(z.lazy(() => predicateProofSchema)),
});

/**
 * Predicate proof for range/comparison proofs
 */
export interface PredicateProof {
  /** Claim name */
  claim: string;
  /** Comparison operator */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in' | 'not_in';
  /** Comparison value */
  value: unknown;
}

export const predicateProofSchema = z.object({
  claim: z.string().min(1),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'not_in']),
  value: z.unknown(),
});

// =============================================================================
// PROVER/VERIFIER INTERFACES
// =============================================================================

/**
 * Configuration for the ZK prover
 */
export interface ZKProverConfig {
  /** Default proof expiration in milliseconds */
  defaultProofTTL: number;
  /** Maximum proof generation timeout in milliseconds */
  proofGenerationTimeout: number;
  /** Whether to include metadata in proofs */
  includeMetadata: boolean;
  /** Custom circuit registry path */
  circuitRegistryPath?: string;
}

/**
 * Default ZK prover configuration
 */
export const DEFAULT_ZK_PROVER_CONFIG: ZKProverConfig = {
  defaultProofTTL: 3600000, // 1 hour
  proofGenerationTimeout: 30000, // 30 seconds
  includeMetadata: true,
};

export const zkProverConfigSchema = z.object({
  defaultProofTTL: z.number().int().positive().default(DEFAULT_ZK_PROVER_CONFIG.defaultProofTTL),
  proofGenerationTimeout: z.number().int().positive().default(DEFAULT_ZK_PROVER_CONFIG.proofGenerationTimeout),
  includeMetadata: z.boolean().default(DEFAULT_ZK_PROVER_CONFIG.includeMetadata),
  circuitRegistryPath: z.string().optional(),
});

/**
 * Configuration for the ZK verifier
 */
export interface ZKVerifierConfig {
  /** Enable verification result caching */
  enableCaching: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
  /** Maximum cache size */
  maxCacheSize: number;
  /** Reject expired proofs */
  rejectExpiredProofs: boolean;
  /** Clock skew tolerance in milliseconds */
  clockSkewTolerance: number;
}

/**
 * Default ZK verifier configuration
 */
export const DEFAULT_ZK_VERIFIER_CONFIG: ZKVerifierConfig = {
  enableCaching: true,
  cacheTTL: 300000, // 5 minutes
  maxCacheSize: 10000,
  rejectExpiredProofs: true,
  clockSkewTolerance: 5000, // 5 seconds
};

export const zkVerifierConfigSchema = z.object({
  enableCaching: z.boolean().default(DEFAULT_ZK_VERIFIER_CONFIG.enableCaching),
  cacheTTL: z.number().int().positive().default(DEFAULT_ZK_VERIFIER_CONFIG.cacheTTL),
  maxCacheSize: z.number().int().positive().default(DEFAULT_ZK_VERIFIER_CONFIG.maxCacheSize),
  rejectExpiredProofs: z.boolean().default(DEFAULT_ZK_VERIFIER_CONFIG.rejectExpiredProofs),
  clockSkewTolerance: z.number().int().nonnegative().default(DEFAULT_ZK_VERIFIER_CONFIG.clockSkewTolerance),
});

// =============================================================================
// COMPLIANCE TYPES
// =============================================================================

/**
 * Compliance verification type
 */
export const ComplianceVerificationType = {
  /** Know Your Customer verification */
  KYC: 'kyc',
  /** Anti-Money Laundering screening */
  AML: 'aml',
  /** GDPR data subject verification */
  GDPR: 'gdpr',
  /** PCI-DSS cardholder verification */
  PCI_DSS: 'pci_dss',
  /** SOC 2 access verification */
  SOC2: 'soc2',
  /** Custom compliance check */
  CUSTOM: 'custom',
} as const;

export type ComplianceVerificationType = (typeof ComplianceVerificationType)[keyof typeof ComplianceVerificationType];

export const complianceVerificationTypeSchema = z.nativeEnum(ComplianceVerificationType);

/**
 * Compliance proof request
 */
export interface ComplianceProofRequest {
  /** Type of compliance verification */
  verificationType: ComplianceVerificationType;
  /** Required proofs */
  requiredProofs: string[];
  /** Optional additional constraints */
  constraints?: Record<string, unknown>;
  /** Request timestamp */
  requestedAt: Date;
  /** Request expiration */
  expiresAt?: Date;
  /** Nonce for replay protection */
  nonce: string;
}

export const complianceProofRequestSchema = z.object({
  verificationType: complianceVerificationTypeSchema,
  requiredProofs: z.array(z.string()),
  constraints: z.record(z.unknown()).optional(),
  requestedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  nonce: z.string().min(1),
});

/**
 * Compliance verification result
 */
export interface ComplianceVerificationResult {
  /** Verification type */
  verificationType: ComplianceVerificationType;
  /** Overall compliance status */
  compliant: boolean;
  /** Individual proof results */
  proofResults: VerificationResult[];
  /** Compliance timestamp */
  verifiedAt: Date;
  /** Validity period end */
  validUntil?: Date;
  /** Compliance attestation (for audit trail) */
  attestation?: string;
}

export const complianceVerificationResultSchema = z.object({
  verificationType: complianceVerificationTypeSchema,
  compliant: z.boolean(),
  proofResults: z.array(verificationResultSchema),
  verifiedAt: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  attestation: z.string().optional(),
});

// =============================================================================
// TRUSTED SETUP TYPES
// =============================================================================

/**
 * Trusted setup ceremony parameters
 */
export interface TrustedSetupParams {
  /** Circuit identifier */
  circuitId: string;
  /** Number of participants required */
  participantsRequired: number;
  /** Contribution deadline */
  deadline: Date;
  /** Current ceremony phase */
  phase: 'contribution' | 'verification' | 'complete';
  /** Ceremony transcript hash */
  transcriptHash?: string;
}

export const trustedSetupParamsSchema = z.object({
  circuitId: z.string().min(1),
  participantsRequired: z.number().int().positive(),
  deadline: z.coerce.date(),
  phase: z.enum(['contribution', 'verification', 'complete']),
  transcriptHash: z.string().optional(),
});

/**
 * Proving key for generating proofs
 */
export interface ProvingKey {
  /** Key identifier */
  keyId: string;
  /** Circuit this key is for */
  circuitId: string;
  /** Serialized key data */
  keyData: Uint8Array;
  /** Key version */
  version: string;
  /** Key hash for integrity */
  hash: string;
  /** When the key was generated */
  generatedAt: Date;
}

export const provingKeySchema = z.object({
  keyId: z.string().min(1),
  circuitId: z.string().min(1),
  keyData: z.instanceof(Uint8Array),
  version: z.string(),
  hash: z.string().min(1),
  generatedAt: z.coerce.date(),
});

/**
 * Verification key for verifying proofs
 */
export interface VerificationKey {
  /** Key identifier */
  keyId: string;
  /** Circuit this key is for */
  circuitId: string;
  /** Serialized key data */
  keyData: Uint8Array;
  /** Key version */
  version: string;
  /** Key hash for integrity */
  hash: string;
  /** When the key was generated */
  generatedAt: Date;
}

export const verificationKeySchema = z.object({
  keyId: z.string().min(1),
  circuitId: z.string().min(1),
  keyData: z.instanceof(Uint8Array),
  version: z.string(),
  hash: z.string().min(1),
  generatedAt: z.coerce.date(),
});

// =============================================================================
// POLICY INTEGRATION TYPES
// =============================================================================

/**
 * ZK proof policy condition for integration with policy engine
 */
export interface ZKProofPolicyCondition {
  /** Required circuit type */
  circuit: ZKCircuitType;
  /** Required public inputs pattern */
  publicInputsPattern?: Record<string, unknown>;
  /** Maximum proof age in milliseconds */
  maxProofAge?: number;
  /** Whether to allow cached verification results */
  allowCachedVerification?: boolean;
  /** Required compliance type if applicable */
  complianceType?: ComplianceVerificationType;
}

export const zkProofPolicyConditionSchema = z.object({
  circuit: zkCircuitTypeSchema,
  publicInputsPattern: z.record(z.unknown()).optional(),
  maxProofAge: z.number().int().positive().optional(),
  allowCachedVerification: z.boolean().optional(),
  complianceType: complianceVerificationTypeSchema.optional(),
});

/**
 * Session proof cache entry
 */
export interface SessionProofCache {
  /** Session identifier */
  sessionId: string;
  /** Cached proofs by circuit type */
  proofs: Map<string, ZKProof>;
  /** Cached verification results */
  verificationResults: Map<string, VerificationResult>;
  /** Session creation time */
  createdAt: Date;
  /** Session expiration */
  expiresAt: Date;
}

export const sessionProofCacheSchema = z.object({
  sessionId: z.string().min(1),
  proofs: z.map(z.string(), zkProofSchema),
  verificationResults: z.map(z.string(), verificationResultSchema),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
