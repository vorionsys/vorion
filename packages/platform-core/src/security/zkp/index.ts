/**
 * Zero-Knowledge Proof System for Vorion Security Platform
 *
 * This module provides a comprehensive Zero-Knowledge Proof (ZKP) system for
 * privacy-preserving verification in the Vorion security platform.
 *
 * Features:
 * - Age verification without revealing date of birth
 * - Attribute range proofs (salary, credit score, etc.)
 * - Set membership proofs (allowed lists without revealing identity)
 * - Credential verification with selective disclosure
 * - Compliance verification (KYC, AML, GDPR, PCI-DSS)
 * - Policy engine integration
 * - Session-based proof caching
 *
 * Architecture:
 * - Circuits: Define ZK circuit constraints and witness computation
 * - Prover: Generate cryptographic proofs
 * - Verifier: Verify proofs with caching and batch support
 * - Commitments: Pedersen, Merkle, and accumulator schemes
 * - Compliance: Regulatory compliance verification
 * - SNARK Utils: Trusted setup and key management
 * - Integration: Policy engine integration
 *
 * Usage:
 * ```typescript
 * import {
 *   createZKProver,
 *   createZKVerifier,
 *   ZKCircuitType,
 * } from './security/zkp';
 *
 * // Generate an age proof
 * const prover = createZKProver();
 * const proof = await prover.generateAgeProof(birthDate, 18);
 *
 * // Verify the proof
 * const verifier = createZKVerifier();
 * const result = await verifier.verify(proof);
 *
 * if (result.valid) {
 *   console.log('User is at least 18 years old');
 * }
 * ```
 *
 * Production SNARK Integration:
 * The current implementation uses Schnorr-based proofs for demonstration.
 * For production, integrate with snarkjs/circom:
 *
 * ```typescript
 * import * as snarkjs from 'snarkjs';
 *
 * // Generate proof with snarkjs
 * const { proof, publicSignals } = await snarkjs.groth16.fullProve(
 *   witness,
 *   'circuit.wasm',
 *   'circuit_final.zkey'
 * );
 *
 * // Verify with snarkjs
 * const valid = await snarkjs.groth16.verify(
 *   verificationKey,
 *   publicSignals,
 *   proof
 * );
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

export {
  // Circuit types
  ZKCircuitType,
  type CircuitMetadata,
  zkCircuitTypeSchema,
  circuitMetadataSchema,

  // Proof types
  type ZKProof,
  type SerializedZKProof,
  zkProofSchema,
  serializedZKProofSchema,

  // Verification types
  type VerificationResult,
  type BatchVerificationResult,
  VerificationErrorCode,
  verificationResultSchema,
  batchVerificationResultSchema,

  // Commitment types
  CommitmentScheme,
  type Commitment,
  type MerkleProof,
  type PedersenCommitment,
  commitmentSchemeSchema,
  commitmentSchema,
  merkleProofSchema,
  pedersenCommitmentSchema,

  // Credential types
  type ZKCredential,
  type SelectiveDisclosureRequest,
  type PredicateProof,
  zkCredentialSchema,
  selectiveDisclosureRequestSchema,
  predicateProofSchema,

  // Configuration types
  type ZKProverConfig,
  type ZKVerifierConfig,
  DEFAULT_ZK_PROVER_CONFIG,
  DEFAULT_ZK_VERIFIER_CONFIG,
  zkProverConfigSchema,
  zkVerifierConfigSchema,

  // Compliance types
  ComplianceVerificationType,
  type ComplianceProofRequest,
  type ComplianceVerificationResult,
  complianceVerificationTypeSchema,
  complianceProofRequestSchema,
  complianceVerificationResultSchema,

  // Trusted setup types
  type TrustedSetupParams,
  type ProvingKey,
  type VerificationKey,
  trustedSetupParamsSchema,
  provingKeySchema,
  verificationKeySchema,

  // Policy integration types
  type ZKProofPolicyCondition,
  type SessionProofCache,
  zkProofPolicyConditionSchema,
  sessionProofCacheSchema,
} from './types.js';

// =============================================================================
// CIRCUITS
// =============================================================================

export {
  // Circuit classes
  CircuitRegistry,
  AgeVerificationCircuit,
  RangeProofCircuit,
  SetMembershipCircuit,
  CredentialVerificationCircuit,

  // Interface
  type Circuit,

  // Factory
  createCircuitRegistry,
  getCircuit,

  // Error
  CircuitError,
} from './circuits.js';

// =============================================================================
// PROVER
// =============================================================================

export {
  // Service
  ZKProverService,

  // Interface
  type ZKProver,

  // Factory
  createZKProver,

  // Error
  ProofGenerationError,
} from './prover.js';

// =============================================================================
// VERIFIER
// =============================================================================

export {
  // Service
  ZKVerifierService,

  // Factory
  createZKVerifier,

  // Error
  VerificationError,
} from './verifier.js';

// =============================================================================
// COMMITMENT
// =============================================================================

export {
  // Services
  PedersenCommitmentService,
  MerkleTreeService,
  AccumulatorService,
  HashCommitmentService,

  // Types
  type PedersenOpening,
  type MerkleTree,
  type AccumulatorState,
  type AccumulatorWitness,

  // Factory
  createCommitmentService,

  // Error
  CommitmentError,
} from './commitment.js';

// =============================================================================
// COMPLIANCE
// =============================================================================

export {
  // Services
  KYCVerificationService,
  AMLScreeningService,
  GDPRComplianceService,
  PCIDSSVerificationService,

  // Types
  type KYCRequirements,
  type AMLLimits,
  type GDPRConsentRequirements,
  type BINRange,

  // Factory
  createComplianceService,

  // Error
  ComplianceError,
} from './compliance.js';

// =============================================================================
// SNARK UTILS
// =============================================================================

export {
  // Services
  ProofSerializer,
  KeyManager,
  TrustedSetupManager,
  SNARKIntegration,

  // Types
  type ContributionReceipt,

  // Factories
  createProofSerializer,
  createKeyManager,
  createTrustedSetupManager,

  // Error
  SNARKError,
} from './snark-utils.js';

// =============================================================================
// INTEGRATION
// =============================================================================

export {
  // Services
  SessionProofCacheManager,
  ProofRefreshManager,
  ZKPPolicyConditionEvaluator,

  // Types
  type ProofRefreshPolicy,
  type PolicyConditionResult,
  type MultiConditionResult,

  // Factories
  createSessionProofCache,
  createProofRefreshManager,
  createZKPPolicyEvaluator,

  // Error
  ZKPPolicyError,
} from './integration.js';

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

import { ZKProverService } from './prover.js';
import { ZKVerifierService } from './verifier.js';
import { ZKPPolicyConditionEvaluator } from './integration.js';
import type { ZKProof, VerificationResult, ZKCredential, SelectiveDisclosureRequest } from './types.js';

/**
 * Quick proof generation for common use cases
 */
export const ZKP = {
  /**
   * Generate an age verification proof
   *
   * @param birthDate - Date of birth
   * @param minAge - Minimum age to prove
   * @returns ZK proof
   *
   * @example
   * ```typescript
   * const proof = await ZKP.proveAge(new Date('1990-01-15'), 21);
   * ```
   */
  async proveAge(birthDate: Date, minAge: number): Promise<ZKProof> {
    const prover = new ZKProverService();
    return prover.generateAgeProof(birthDate, minAge);
  },

  /**
   * Generate a range proof
   *
   * @param value - Private value
   * @param min - Range minimum
   * @param max - Range maximum
   * @returns ZK proof
   *
   * @example
   * ```typescript
   * const proof = await ZKP.proveRange(75000, 50000, 100000);
   * ```
   */
  async proveRange(value: number, min: number, max: number): Promise<ZKProof> {
    const prover = new ZKProverService();
    return prover.generateRangeProof(value, min, max);
  },

  /**
   * Generate a credential proof with selective disclosure
   *
   * @param credential - Full credential
   * @param disclosure - Selective disclosure request
   * @returns ZK proof
   *
   * @example
   * ```typescript
   * const proof = await ZKP.proveCredential(credential, {
   *   reveal: ['name'],
   *   proveExistence: ['age'],
   *   predicates: [{ claim: 'age', operator: 'gte', value: 18 }]
   * });
   * ```
   */
  async proveCredential(
    credential: ZKCredential,
    disclosure: SelectiveDisclosureRequest
  ): Promise<ZKProof> {
    const prover = new ZKProverService();
    return prover.generateCredentialProof(credential, disclosure);
  },

  /**
   * Verify a ZK proof
   *
   * @param proof - Proof to verify
   * @returns Verification result
   *
   * @example
   * ```typescript
   * const result = await ZKP.verify(proof);
   * if (result.valid) {
   *   // Proof is valid
   * }
   * ```
   */
  async verify(proof: ZKProof): Promise<VerificationResult> {
    const verifier = new ZKVerifierService();
    const result = await verifier.verify(proof);
    verifier.destroy();
    return result;
  },

  /**
   * Verify multiple proofs in batch
   *
   * @param proofs - Proofs to verify
   * @returns Batch verification result
   */
  async verifyBatch(proofs: ZKProof[]) {
    const verifier = new ZKVerifierService();
    const result = await verifier.verifyBatch(proofs);
    verifier.destroy();
    return result;
  },
};

/**
 * Create a fully configured ZKP system
 *
 * @returns Object with prover, verifier, and policy evaluator
 *
 * @example
 * ```typescript
 * const zkSystem = createZKPSystem();
 *
 * // Generate proof
 * const proof = await zkSystem.prover.generateAgeProof(dob, 18);
 *
 * // Verify
 * const result = await zkSystem.verifier.verify(proof);
 *
 * // Use in policies
 * await zkSystem.policyEvaluator.evaluate(sessionId, condition, proof);
 *
 * // Cleanup
 * zkSystem.destroy();
 * ```
 */
export function createZKPSystem() {
  const prover = new ZKProverService();
  const verifier = new ZKVerifierService();
  const policyEvaluator = new ZKPPolicyConditionEvaluator({ verifier });

  return {
    prover,
    verifier,
    policyEvaluator,

    /**
     * Clean up all resources
     */
    destroy() {
      verifier.destroy();
      policyEvaluator.destroy();
    },
  };
}
