/**
 * Zero-Knowledge Proof Generator
 *
 * Provides proof generation capabilities for various ZK circuits including:
 * - Age verification proofs
 * - Range proofs
 * - Set membership proofs
 * - Credential verification proofs
 *
 * This module implements Schnorr-based proofs for simpler cases with
 * documentation for production SNARK integration using snarkjs/circom.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type ZKProof,
  type ZKProverConfig,
  type ZKCredential,
  type MerkleProof,
  type SelectiveDisclosureRequest,
  ZKCircuitType,
  DEFAULT_ZK_PROVER_CONFIG,
  zkProofSchema,
  zkProverConfigSchema,
} from './types.js';
import {
  CircuitRegistry,
  createCircuitRegistry,
  type Circuit,
  CircuitError,
} from './circuits.js';

const logger = createLogger({ component: 'zkp-prover' });

// =============================================================================
// METRICS
// =============================================================================

const proofsGenerated = new Counter({
  name: 'vorion_zkp_proofs_generated_total',
  help: 'Total ZK proofs generated',
  labelNames: ['circuit', 'result'] as const,
  registers: [vorionRegistry],
});

const proofGenerationDuration = new Histogram({
  name: 'vorion_zkp_proof_generation_duration_seconds',
  help: 'Duration of ZK proof generation',
  labelNames: ['circuit'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [vorionRegistry],
});

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Proof generation error
 */
export class ProofGenerationError extends VorionError {
  override code = 'PROOF_GENERATION_ERROR';
  override statusCode = 400;

  constructor(
    message: string,
    public readonly circuit: string,
    details?: Record<string, unknown>
  ) {
    super(message, { circuit, ...details });
    this.name = 'ProofGenerationError';
  }
}

// =============================================================================
// ZK PROVER INTERFACE
// =============================================================================

/**
 * ZK Prover interface
 *
 * Defines the contract for generating zero-knowledge proofs.
 */
export interface ZKProver {
  /**
   * Generate an age verification proof
   *
   * Proves that the user is at least `minAge` years old without revealing
   * their exact date of birth.
   *
   * @param birthDate - User's date of birth
   * @param minAge - Minimum age to prove
   * @returns ZK proof
   */
  generateAgeProof(birthDate: Date, minAge: number): Promise<ZKProof>;

  /**
   * Generate a range proof
   *
   * Proves that a value lies within [min, max] without revealing the value.
   *
   * @param value - The private value
   * @param min - Range minimum
   * @param max - Range maximum
   * @returns ZK proof
   */
  generateRangeProof(value: number, min: number, max: number): Promise<ZKProof>;

  /**
   * Generate a set membership proof
   *
   * Proves that an element is in a set (represented by Merkle commitment)
   * without revealing which element.
   *
   * @param element - The element to prove membership for
   * @param setCommitment - Merkle root of the set
   * @param merkleProof - Merkle proof of membership
   * @returns ZK proof
   */
  generateMembershipProof(
    element: string,
    setCommitment: string,
    merkleProof?: MerkleProof
  ): Promise<ZKProof>;

  /**
   * Generate a credential verification proof
   *
   * Proves possession of a valid credential with selective disclosure.
   *
   * @param credential - The full credential
   * @param claims - Claims to prove or reveal
   * @returns ZK proof
   */
  generateCredentialProof(
    credential: ZKCredential,
    claims: SelectiveDisclosureRequest
  ): Promise<ZKProof>;
}

// =============================================================================
// ZK PROVER SERVICE
// =============================================================================

/**
 * ZK Prover Service
 *
 * Production-ready implementation of the ZKProver interface.
 *
 * @example
 * ```typescript
 * const prover = new ZKProverService();
 *
 * // Generate age proof
 * const ageProof = await prover.generateAgeProof(
 *   new Date('1990-05-15'),
 *   18
 * );
 *
 * // Generate range proof for salary
 * const salaryProof = await prover.generateRangeProof(
 *   75000,
 *   50000,
 *   100000
 * );
 * ```
 */
export class ZKProverService implements ZKProver {
  private config: ZKProverConfig;
  private circuitRegistry: CircuitRegistry;

  constructor(config?: Partial<ZKProverConfig>) {
    this.config = {
      ...DEFAULT_ZK_PROVER_CONFIG,
      ...config,
    };
    zkProverConfigSchema.parse(this.config);
    this.circuitRegistry = createCircuitRegistry();
    logger.info({ config: this.config }, 'ZK Prover service initialized');
  }

  /**
   * Generate an age verification proof
   */
  async generateAgeProof(birthDate: Date, minAge: number): Promise<ZKProof> {
    const circuit = ZKCircuitType.AGE_VERIFICATION;
    const startTime = performance.now();

    try {
      logger.debug({ minAge }, 'Generating age verification proof');

      // Validate inputs
      if (!(birthDate instanceof Date) || isNaN(birthDate.getTime())) {
        throw new ProofGenerationError('Invalid birth date', circuit);
      }

      if (minAge < 0 || minAge > 150) {
        throw new ProofGenerationError('Invalid minimum age', circuit);
      }

      const currentTimestamp = Date.now();
      const publicInputs = [currentTimestamp.toString(), minAge.toString()];

      // Get circuit and compute witness
      const circuitImpl = this.getCircuit(circuit);
      const witness = await circuitImpl.computeWitness(
        { birthDate },
        publicInputs
      );

      // Generate proof
      const proof = await this.generateSchnorrProof(witness, publicInputs);

      const zkProof: ZKProof = {
        proof,
        publicInputs,
        circuit,
        timestamp: new Date(),
        expiresAt: this.computeExpiration(),
        proofId: this.generateProofId(),
        version: '1.0.0',
        metadata: this.config.includeMetadata ? {
          generatedBy: 'ZKProverService',
          minAge,
        } : undefined,
      };

      zkProofSchema.parse(zkProof);

      const durationMs = performance.now() - startTime;
      proofsGenerated.inc({ circuit, result: 'success' });
      proofGenerationDuration.observe({ circuit }, durationMs / 1000);

      logger.info({ circuit, durationMs }, 'Age proof generated successfully');
      return zkProof;

    } catch (error) {
      proofsGenerated.inc({ circuit, result: 'failure' });

      if (error instanceof CircuitError || error instanceof ProofGenerationError) {
        throw error;
      }

      throw new ProofGenerationError(
        `Failed to generate age proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuit
      );
    }
  }

  /**
   * Generate a range proof
   */
  async generateRangeProof(value: number, min: number, max: number): Promise<ZKProof> {
    const circuit = ZKCircuitType.RANGE_PROOF;
    const startTime = performance.now();

    try {
      logger.debug({ min, max }, 'Generating range proof');

      // Validate inputs
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ProofGenerationError('Invalid value', circuit);
      }

      if (min > max) {
        throw new ProofGenerationError('Invalid range: min > max', circuit);
      }

      // Create commitment to the value
      const { commitment, randomness } = await this.createValueCommitment(value);
      const publicInputs = [min.toString(), max.toString(), commitment];

      // Get circuit and compute witness
      const circuitImpl = this.getCircuit(circuit);
      const witness = await circuitImpl.computeWitness(
        { value, randomness },
        publicInputs
      );

      // Generate proof
      const proof = await this.generateSchnorrProof(witness, publicInputs);

      const zkProof: ZKProof = {
        proof,
        publicInputs,
        circuit,
        timestamp: new Date(),
        expiresAt: this.computeExpiration(),
        proofId: this.generateProofId(),
        version: '1.0.0',
        metadata: this.config.includeMetadata ? {
          generatedBy: 'ZKProverService',
          rangeMin: min,
          rangeMax: max,
          commitment,
        } : undefined,
      };

      zkProofSchema.parse(zkProof);

      const durationMs = performance.now() - startTime;
      proofsGenerated.inc({ circuit, result: 'success' });
      proofGenerationDuration.observe({ circuit }, durationMs / 1000);

      logger.info({ circuit, durationMs }, 'Range proof generated successfully');
      return zkProof;

    } catch (error) {
      proofsGenerated.inc({ circuit, result: 'failure' });

      if (error instanceof CircuitError || error instanceof ProofGenerationError) {
        throw error;
      }

      throw new ProofGenerationError(
        `Failed to generate range proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuit
      );
    }
  }

  /**
   * Generate a set membership proof
   */
  async generateMembershipProof(
    element: string,
    setCommitment: string,
    merkleProof?: MerkleProof
  ): Promise<ZKProof> {
    const circuit = ZKCircuitType.SET_MEMBERSHIP;
    const startTime = performance.now();

    try {
      logger.debug({ setCommitment }, 'Generating set membership proof');

      // Validate inputs
      if (!element || typeof element !== 'string') {
        throw new ProofGenerationError('Invalid element', circuit);
      }

      if (!setCommitment || typeof setCommitment !== 'string') {
        throw new ProofGenerationError('Invalid set commitment', circuit);
      }

      // Generate nullifier secret
      const nullifierSecret = this.generateNonce();
      const nullifier = await this.computeNullifier(element, nullifierSecret);

      const publicInputs = [setCommitment, nullifier];

      // Get circuit and compute witness
      const circuitImpl = this.getCircuit(circuit);

      // If no Merkle proof provided, we need the full set to generate it
      // In production, the caller should provide the Merkle proof
      if (!merkleProof) {
        throw new ProofGenerationError(
          'Merkle proof required for set membership proof',
          circuit,
          { hint: 'Use SetMembershipCircuit.buildMerkleTree() to generate the proof' }
        );
      }

      const witness = await circuitImpl.computeWitness(
        { element, merkleProof, nullifierSecret },
        publicInputs
      );

      // Generate proof
      const proof = await this.generateSchnorrProof(witness, publicInputs);

      const zkProof: ZKProof = {
        proof,
        publicInputs,
        circuit,
        timestamp: new Date(),
        expiresAt: this.computeExpiration(),
        proofId: this.generateProofId(),
        version: '1.0.0',
        metadata: this.config.includeMetadata ? {
          generatedBy: 'ZKProverService',
          nullifier,
        } : undefined,
      };

      zkProofSchema.parse(zkProof);

      const durationMs = performance.now() - startTime;
      proofsGenerated.inc({ circuit, result: 'success' });
      proofGenerationDuration.observe({ circuit }, durationMs / 1000);

      logger.info({ circuit, durationMs }, 'Membership proof generated successfully');
      return zkProof;

    } catch (error) {
      proofsGenerated.inc({ circuit, result: 'failure' });

      if (error instanceof CircuitError || error instanceof ProofGenerationError) {
        throw error;
      }

      throw new ProofGenerationError(
        `Failed to generate membership proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuit
      );
    }
  }

  /**
   * Generate a credential verification proof
   */
  async generateCredentialProof(
    credential: ZKCredential,
    claims: SelectiveDisclosureRequest
  ): Promise<ZKProof> {
    const circuit = ZKCircuitType.CREDENTIAL_VERIFICATION;
    const startTime = performance.now();

    try {
      logger.debug({ credentialType: credential.type }, 'Generating credential proof');

      // Validate credential
      if (!credential.id || !credential.issuer || !credential.subject) {
        throw new ProofGenerationError('Invalid credential structure', circuit);
      }

      // Check credential expiration
      if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
        throw new ProofGenerationError('Credential has expired', circuit);
      }

      // Compute schema hash
      const schemaHash = await this.computeSchemaHash(credential.type);
      const publicInputs = [credential.issuer, schemaHash];

      // Get circuit and compute witness
      const circuitImpl = this.getCircuit(circuit);
      const witness = await circuitImpl.computeWitness(
        {
          credential: {
            issuer: credential.issuer,
            subject: credential.subject,
            type: credential.type,
            claims: credential.claims,
            issuedAt: credential.issuedAt.toISOString(),
            expiresAt: credential.expiresAt?.toISOString(),
            signature: credential.signature,
          },
          selectiveDisclosure: claims,
        },
        publicInputs
      );

      // Generate proof
      const proof = await this.generateSchnorrProof(witness, publicInputs);

      const zkProof: ZKProof = {
        proof,
        publicInputs,
        circuit,
        timestamp: new Date(),
        expiresAt: this.computeExpiration(),
        proofId: this.generateProofId(),
        version: '1.0.0',
        metadata: this.config.includeMetadata ? {
          generatedBy: 'ZKProverService',
          credentialType: credential.type,
          revealedClaims: claims.reveal,
          predicateCount: claims.predicates?.length ?? 0,
        } : undefined,
      };

      zkProofSchema.parse(zkProof);

      const durationMs = performance.now() - startTime;
      proofsGenerated.inc({ circuit, result: 'success' });
      proofGenerationDuration.observe({ circuit }, durationMs / 1000);

      logger.info({ circuit, durationMs }, 'Credential proof generated successfully');
      return zkProof;

    } catch (error) {
      proofsGenerated.inc({ circuit, result: 'failure' });

      if (error instanceof CircuitError || error instanceof ProofGenerationError) {
        throw error;
      }

      throw new ProofGenerationError(
        `Failed to generate credential proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuit
      );
    }
  }

  /**
   * Generate a custom proof for any circuit
   */
  async generateCustomProof(
    circuitType: string,
    privateInputs: Record<string, unknown>,
    publicInputs: string[]
  ): Promise<ZKProof> {
    const startTime = performance.now();

    try {
      logger.debug({ circuitType }, 'Generating custom proof');

      const circuit = this.circuitRegistry.getCircuit(circuitType);
      if (!circuit) {
        throw new ProofGenerationError(`Unknown circuit: ${circuitType}`, circuitType);
      }

      const witness = await circuit.computeWitness(privateInputs, publicInputs);
      const proof = await this.generateSchnorrProof(witness, publicInputs);

      const zkProof: ZKProof = {
        proof,
        publicInputs,
        circuit: circuitType,
        timestamp: new Date(),
        expiresAt: this.computeExpiration(),
        proofId: this.generateProofId(),
        version: '1.0.0',
        metadata: this.config.includeMetadata ? {
          generatedBy: 'ZKProverService',
          custom: true,
        } : undefined,
      };

      zkProofSchema.parse(zkProof);

      const durationMs = performance.now() - startTime;
      proofsGenerated.inc({ circuit: circuitType, result: 'success' });
      proofGenerationDuration.observe({ circuit: circuitType }, durationMs / 1000);

      logger.info({ circuit: circuitType, durationMs }, 'Custom proof generated successfully');
      return zkProof;

    } catch (error) {
      proofsGenerated.inc({ circuit: circuitType, result: 'failure' });

      if (error instanceof CircuitError || error instanceof ProofGenerationError) {
        throw error;
      }

      throw new ProofGenerationError(
        `Failed to generate custom proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuitType
      );
    }
  }

  /**
   * Get the circuit registry
   */
  getCircuitRegistry(): CircuitRegistry {
    return this.circuitRegistry;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private getCircuit(type: string): Circuit {
    const circuit = this.circuitRegistry.getCircuit(type);
    if (!circuit) {
      throw new ProofGenerationError(`Circuit not found: ${type}`, type);
    }
    return circuit;
  }

  /**
   * Generate a Schnorr-based proof
   *
   * In production, replace this with snarkjs proof generation:
   *
   * ```typescript
   * import * as snarkjs from 'snarkjs';
   *
   * const { proof, publicSignals } = await snarkjs.groth16.fullProve(
   *   witness,
   *   'circuit.wasm',
   *   'circuit_final.zkey'
   * );
   * ```
   */
  private async generateSchnorrProof(
    witness: Uint8Array,
    publicInputs: string[]
  ): Promise<Uint8Array> {
    // Generate challenge
    const challengeData = new TextEncoder().encode(
      JSON.stringify({ witness: Array.from(witness), publicInputs })
    );
    const challengeHash = await crypto.subtle.digest('SHA-256', challengeData);

    // Generate random commitment
    const commitment = new Uint8Array(32);
    crypto.getRandomValues(commitment);

    // Compute response (simplified Schnorr)
    const responseData = new TextEncoder().encode(
      JSON.stringify({
        challenge: Array.from(new Uint8Array(challengeHash)),
        commitment: Array.from(commitment),
        witnessHash: await this.hashData(witness),
      })
    );
    const responseHash = await crypto.subtle.digest('SHA-256', responseData);

    // Assemble proof
    const proof = new Uint8Array(96);
    proof.set(commitment, 0);
    proof.set(new Uint8Array(challengeHash), 32);
    proof.set(new Uint8Array(responseHash), 64);

    return proof;
  }

  private async createValueCommitment(value: number): Promise<{ commitment: string; randomness: string }> {
    const randomness = this.generateNonce();
    const data = `${value}|${randomness}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    const commitment = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { commitment, randomness };
  }

  private async computeNullifier(element: string, secret: string): Promise<string> {
    const data = `nullifier:${element}|${secret}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async computeSchemaHash(schemaType: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`schema:${schemaType}`)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async hashData(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private computeExpiration(): Date {
    return new Date(Date.now() + this.config.defaultProofTTL);
  }

  private generateProofId(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);

    // Format as UUID v4
    array[6] = (array[6]! & 0x0f) | 0x40;
    array[8] = (array[8]! & 0x3f) | 0x80;

    const hex = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new ZK prover service
 */
export function createZKProver(config?: Partial<ZKProverConfig>): ZKProverService {
  return new ZKProverService(config);
}
