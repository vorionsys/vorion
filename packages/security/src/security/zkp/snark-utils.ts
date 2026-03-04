/**
 * SNARK Utilities
 *
 * Provides utilities for working with SNARKs (Succinct Non-interactive ARguments of Knowledge):
 * - Trusted setup management
 * - Proof serialization/deserialization
 * - Key management (proving and verification keys)
 *
 * This module is designed to work with snarkjs/circom-compatible systems.
 * For production use, integrate with actual SNARK libraries.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import {
  type ZKProof,
  type SerializedZKProof,
  type ProvingKey,
  type VerificationKey,
  type TrustedSetupParams,
  zkProofSchema,
  serializedZKProofSchema,
  provingKeySchema,
  verificationKeySchema,
  trustedSetupParamsSchema,
} from './types.js';

const logger = createLogger({ component: 'zkp-snark-utils' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * SNARK-related errors
 */
export class SNARKError extends VorionError {
  override code = 'SNARK_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'SNARKError';
  }
}

// =============================================================================
// PROOF SERIALIZATION
// =============================================================================

/**
 * Proof Serialization Service
 *
 * Handles conversion between binary proof format and serialized format
 * for storage and transmission.
 *
 * @example
 * ```typescript
 * const serializer = new ProofSerializer();
 *
 * // Serialize for storage
 * const serialized = serializer.serialize(proof);
 *
 * // Deserialize
 * const proof = serializer.deserialize(serialized);
 * ```
 */
export class ProofSerializer {
  /**
   * Serialize a ZK proof for storage/transmission
   */
  serialize(proof: ZKProof): SerializedZKProof {
    zkProofSchema.parse(proof);

    // Convert Uint8Array to base64
    const proofBase64 = this.uint8ArrayToBase64(proof.proof);

    const serialized: SerializedZKProof = {
      proof: proofBase64,
      publicInputs: proof.publicInputs,
      circuit: proof.circuit,
      timestamp: proof.timestamp.toISOString(),
      expiresAt: proof.expiresAt?.toISOString(),
      metadata: proof.metadata,
      version: proof.version,
      proofId: proof.proofId,
    };

    serializedZKProofSchema.parse(serialized);
    return serialized;
  }

  /**
   * Deserialize a ZK proof from storage/transmission format
   */
  deserialize(serialized: SerializedZKProof): ZKProof {
    serializedZKProofSchema.parse(serialized);

    // Convert base64 to Uint8Array
    const proofBytes = this.base64ToUint8Array(serialized.proof);

    const proof: ZKProof = {
      proof: proofBytes,
      publicInputs: serialized.publicInputs,
      circuit: serialized.circuit,
      timestamp: new Date(serialized.timestamp),
      expiresAt: serialized.expiresAt ? new Date(serialized.expiresAt) : undefined,
      metadata: serialized.metadata,
      version: serialized.version,
      proofId: serialized.proofId,
    };

    zkProofSchema.parse(proof);
    return proof;
  }

  /**
   * Serialize proof to compact binary format
   */
  serializeBinary(proof: ZKProof): Uint8Array {
    const json = JSON.stringify(this.serialize(proof));
    return new TextEncoder().encode(json);
  }

  /**
   * Deserialize proof from compact binary format
   */
  deserializeBinary(data: Uint8Array): ZKProof {
    const json = new TextDecoder().decode(data);
    const serialized = JSON.parse(json) as SerializedZKProof;
    return this.deserialize(serialized);
  }

  /**
   * Calculate proof hash for integrity verification
   */
  async calculateProofHash(proof: ZKProof): Promise<string> {
    const serialized = this.serialize(proof);
    const data = JSON.stringify({
      proof: serialized.proof,
      publicInputs: serialized.publicInputs,
      circuit: serialized.circuit,
    });

    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );

    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Verify proof integrity using hash
   */
  async verifyProofIntegrity(proof: ZKProof, expectedHash: string): Promise<boolean> {
    const actualHash = await this.calculateProofHash(proof);
    return actualHash === expectedHash;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

/**
 * Key Management Service
 *
 * Manages proving and verification keys for ZK circuits.
 *
 * Key Types:
 * - Proving Key (pk): Used to generate proofs, can be large (MBs)
 * - Verification Key (vk): Used to verify proofs, typically small (KBs)
 *
 * @example
 * ```typescript
 * const keyManager = new KeyManager();
 *
 * // Store keys
 * await keyManager.storeProvingKey(circuitId, keyData);
 * await keyManager.storeVerificationKey(circuitId, keyData);
 *
 * // Retrieve keys
 * const pk = await keyManager.getProvingKey(circuitId);
 * const vk = await keyManager.getVerificationKey(circuitId);
 * ```
 */
export class KeyManager {
  private provingKeys: Map<string, ProvingKey> = new Map();
  private verificationKeys: Map<string, VerificationKey> = new Map();

  constructor() {
    logger.info('Key manager initialized');
  }

  /**
   * Store a proving key
   */
  async storeProvingKey(
    circuitId: string,
    keyData: Uint8Array,
    version: string = '1.0.0'
  ): Promise<ProvingKey> {
    const keyId = await this.generateKeyId(circuitId, 'pk', keyData);
    const hash = await this.computeKeyHash(keyData);

    const key: ProvingKey = {
      keyId,
      circuitId,
      keyData,
      version,
      hash,
      generatedAt: new Date(),
    };

    provingKeySchema.parse(key);
    this.provingKeys.set(circuitId, key);

    logger.info({ circuitId, keyId, size: keyData.length }, 'Proving key stored');
    return key;
  }

  /**
   * Store a verification key
   */
  async storeVerificationKey(
    circuitId: string,
    keyData: Uint8Array,
    version: string = '1.0.0'
  ): Promise<VerificationKey> {
    const keyId = await this.generateKeyId(circuitId, 'vk', keyData);
    const hash = await this.computeKeyHash(keyData);

    const key: VerificationKey = {
      keyId,
      circuitId,
      keyData,
      version,
      hash,
      generatedAt: new Date(),
    };

    verificationKeySchema.parse(key);
    this.verificationKeys.set(circuitId, key);

    logger.info({ circuitId, keyId, size: keyData.length }, 'Verification key stored');
    return key;
  }

  /**
   * Get a proving key by circuit ID
   */
  getProvingKey(circuitId: string): ProvingKey | undefined {
    return this.provingKeys.get(circuitId);
  }

  /**
   * Get a verification key by circuit ID
   */
  getVerificationKey(circuitId: string): VerificationKey | undefined {
    return this.verificationKeys.get(circuitId);
  }

  /**
   * Verify key integrity
   */
  async verifyKeyIntegrity(key: ProvingKey | VerificationKey): Promise<boolean> {
    const computedHash = await this.computeKeyHash(key.keyData);
    return computedHash === key.hash;
  }

  /**
   * Export keys for backup
   */
  exportKeys(): { provingKeys: ProvingKey[]; verificationKeys: VerificationKey[] } {
    return {
      provingKeys: Array.from(this.provingKeys.values()),
      verificationKeys: Array.from(this.verificationKeys.values()),
    };
  }

  /**
   * Import keys from backup
   */
  async importKeys(data: {
    provingKeys: Array<Omit<ProvingKey, 'keyData'> & { keyData: string }>;
    verificationKeys: Array<Omit<VerificationKey, 'keyData'> & { keyData: string }>;
  }): Promise<void> {
    // Import proving keys
    for (const pk of data.provingKeys) {
      const keyData = this.base64ToUint8Array(pk.keyData);
      const key: ProvingKey = {
        ...pk,
        keyData,
        generatedAt: new Date(pk.generatedAt),
      };

      // Verify integrity
      if (!await this.verifyKeyIntegrity(key)) {
        throw new SNARKError(`Proving key integrity check failed: ${pk.circuitId}`);
      }

      this.provingKeys.set(key.circuitId, key);
    }

    // Import verification keys
    for (const vk of data.verificationKeys) {
      const keyData = this.base64ToUint8Array(vk.keyData);
      const key: VerificationKey = {
        ...vk,
        keyData,
        generatedAt: new Date(vk.generatedAt),
      };

      // Verify integrity
      if (!await this.verifyKeyIntegrity(key)) {
        throw new SNARKError(`Verification key integrity check failed: ${vk.circuitId}`);
      }

      this.verificationKeys.set(key.circuitId, key);
    }

    logger.info({
      provingKeys: data.provingKeys.length,
      verificationKeys: data.verificationKeys.length,
    }, 'Keys imported');
  }

  /**
   * Delete keys for a circuit
   */
  deleteKeys(circuitId: string): void {
    this.provingKeys.delete(circuitId);
    this.verificationKeys.delete(circuitId);
    logger.info({ circuitId }, 'Keys deleted');
  }

  /**
   * List all circuit IDs with stored keys
   */
  listCircuits(): string[] {
    const circuits = new Set<string>();
    const pkKeys = Array.from(this.provingKeys.keys());
    const vkKeys = Array.from(this.verificationKeys.keys());
    for (const key of pkKeys) {
      circuits.add(key);
    }
    for (const key of vkKeys) {
      circuits.add(key);
    }
    return Array.from(circuits);
  }

  private async generateKeyId(circuitId: string, type: string, keyData: Uint8Array): Promise<string> {
    const data = `${circuitId}:${type}:${Date.now()}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async computeKeyHash(keyData: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData as BufferSource);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// =============================================================================
// TRUSTED SETUP
// =============================================================================

/**
 * Trusted Setup Manager
 *
 * Manages the trusted setup ceremony for SNARK circuits.
 *
 * The trusted setup is a critical security component that generates the
 * proving and verification keys. The "toxic waste" from the ceremony
 * must be destroyed to ensure system security.
 *
 * Phases:
 * 1. Contribution: Multiple parties contribute randomness
 * 2. Verification: Verify all contributions are valid
 * 3. Complete: Finalize keys and destroy toxic waste
 *
 * For production, consider using:
 * - Powers of Tau ceremony for universal setup
 * - Multi-party computation (MPC) for circuit-specific setup
 *
 * @example
 * ```typescript
 * const setup = new TrustedSetupManager();
 *
 * // Initialize ceremony
 * const params = await setup.initializeCeremony('age_verification', 10);
 *
 * // Contribute randomness
 * await setup.contribute(params.circuitId, contribution);
 *
 * // Finalize
 * const { provingKey, verificationKey } = await setup.finalize(params.circuitId);
 * ```
 */
export class TrustedSetupManager {
  private ceremonies: Map<string, TrustedSetupState> = new Map();

  constructor() {
    logger.info('Trusted setup manager initialized');
  }

  /**
   * Initialize a new trusted setup ceremony
   */
  async initializeCeremony(
    circuitId: string,
    participantsRequired: number,
    deadline: Date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  ): Promise<TrustedSetupParams> {
    if (this.ceremonies.has(circuitId)) {
      throw new SNARKError(`Ceremony already exists for circuit: ${circuitId}`);
    }

    const params: TrustedSetupParams = {
      circuitId,
      participantsRequired,
      deadline,
      phase: 'contribution',
    };

    trustedSetupParamsSchema.parse(params);

    const state: TrustedSetupState = {
      params,
      contributions: [],
      currentParticipant: 0,
    };

    this.ceremonies.set(circuitId, state);

    logger.info({ circuitId, participantsRequired, deadline }, 'Ceremony initialized');
    return params;
  }

  /**
   * Add a contribution to the ceremony
   *
   * In production, this would involve:
   * 1. Downloading current Powers of Tau
   * 2. Adding local randomness
   * 3. Computing new parameters
   * 4. Providing proof of contribution
   */
  async contribute(
    circuitId: string,
    contributorId: string,
    contribution: Uint8Array
  ): Promise<ContributionReceipt> {
    const state = this.ceremonies.get(circuitId);
    if (!state) {
      throw new SNARKError(`No ceremony found for circuit: ${circuitId}`);
    }

    if (state.params.phase !== 'contribution') {
      throw new SNARKError(`Ceremony not in contribution phase`);
    }

    if (new Date() > state.params.deadline) {
      throw new SNARKError(`Contribution deadline has passed`);
    }

    // Verify contribution (simplified)
    const contributionHash = await this.hashContribution(contribution);

    const receipt: ContributionReceipt = {
      circuitId,
      contributorId,
      contributionIndex: state.contributions.length,
      contributionHash,
      timestamp: new Date(),
    };

    state.contributions.push({
      contributorId,
      hash: contributionHash,
      timestamp: receipt.timestamp,
    });

    state.currentParticipant++;

    logger.info({
      circuitId,
      contributorId,
      contributionIndex: receipt.contributionIndex,
    }, 'Contribution added');

    // Check if we have enough contributions
    if (state.contributions.length >= state.params.participantsRequired) {
      state.params.phase = 'verification';
      logger.info({ circuitId }, 'Ceremony moved to verification phase');
    }

    return receipt;
  }

  /**
   * Verify all contributions
   */
  async verifyContributions(circuitId: string): Promise<boolean> {
    const state = this.ceremonies.get(circuitId);
    if (!state) {
      throw new SNARKError(`No ceremony found for circuit: ${circuitId}`);
    }

    if (state.params.phase !== 'verification') {
      throw new SNARKError(`Ceremony not in verification phase`);
    }

    // In production, this would verify:
    // 1. Each contribution's proof of correct computation
    // 2. Chain of contributions is valid
    // 3. No duplicate contributors

    // Simplified verification: check we have all contributions
    const verified = state.contributions.length >= state.params.participantsRequired;

    if (verified) {
      // Compute transcript hash
      const transcript = state.contributions.map(c => c.hash).join(':');
      state.params.transcriptHash = await this.hashContribution(
        new TextEncoder().encode(transcript)
      );
    }

    logger.info({ circuitId, verified }, 'Contributions verified');
    return verified;
  }

  /**
   * Finalize the ceremony and generate keys
   */
  async finalize(circuitId: string): Promise<{
    provingKey: Uint8Array;
    verificationKey: Uint8Array;
  }> {
    const state = this.ceremonies.get(circuitId);
    if (!state) {
      throw new SNARKError(`No ceremony found for circuit: ${circuitId}`);
    }

    // Verify contributions first
    const verified = await this.verifyContributions(circuitId);
    if (!verified) {
      throw new SNARKError(`Contribution verification failed`);
    }

    // In production, this would:
    // 1. Run phase 2 of setup (circuit-specific)
    // 2. Generate proving and verification keys
    // 3. Securely destroy toxic waste

    // Simulated key generation
    const provingKey = await this.generateSimulatedKey(circuitId, 'proving');
    const verificationKey = await this.generateSimulatedKey(circuitId, 'verification');

    // Mark ceremony complete
    state.params.phase = 'complete';

    logger.info({ circuitId }, 'Ceremony finalized');

    return { provingKey, verificationKey };
  }

  /**
   * Get ceremony status
   */
  getCeremonyStatus(circuitId: string): TrustedSetupParams | undefined {
    return this.ceremonies.get(circuitId)?.params;
  }

  /**
   * Get contribution history
   */
  getContributions(circuitId: string): ContributionRecord[] {
    return this.ceremonies.get(circuitId)?.contributions ?? [];
  }

  private async hashContribution(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async generateSimulatedKey(circuitId: string, type: string): Promise<Uint8Array> {
    // Generate deterministic but unique key based on circuit and type
    const seed = `${circuitId}:${type}:${Date.now()}`;
    const seedHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(seed)
    );

    // Proving keys are larger than verification keys
    const keySize = type === 'proving' ? 1024 : 256;
    const key = new Uint8Array(keySize);

    // Fill with pseudo-random data
    const seedArray = new Uint8Array(seedHash);
    for (let i = 0; i < keySize; i++) {
      key[i] = seedArray[i % seedArray.length]! ^ (i & 0xff);
    }

    return key;
  }
}

/**
 * Internal state for trusted setup ceremony
 */
interface TrustedSetupState {
  params: TrustedSetupParams;
  contributions: ContributionRecord[];
  currentParticipant: number;
}

/**
 * Contribution record
 */
interface ContributionRecord {
  contributorId: string;
  hash: string;
  timestamp: Date;
}

/**
 * Contribution receipt
 */
export interface ContributionReceipt {
  circuitId: string;
  contributorId: string;
  contributionIndex: number;
  contributionHash: string;
  timestamp: Date;
}

// =============================================================================
// SNARK INTEGRATION HELPERS
// =============================================================================

/**
 * SNARK Integration Helpers
 *
 * Utility functions for integrating with snarkjs/circom in production.
 *
 * Usage with snarkjs:
 * ```typescript
 * import * as snarkjs from 'snarkjs';
 *
 * // Generate proof
 * const { proof, publicSignals } = await snarkjs.groth16.fullProve(
 *   witness,
 *   'circuit.wasm',
 *   'circuit_final.zkey'
 * );
 *
 * // Verify proof
 * const valid = await snarkjs.groth16.verify(
 *   verificationKey,
 *   publicSignals,
 *   proof
 * );
 * ```
 */
export class SNARKIntegration {
  /**
   * Convert snarkjs proof format to ZKProof
   *
   * snarkjs Groth16 proof format:
   * {
   *   pi_a: [string, string, string],
   *   pi_b: [[string, string], [string, string], [string, string]],
   *   pi_c: [string, string, string],
   *   protocol: 'groth16'
   * }
   */
  static fromSnarkJS(
    snarkProof: SnarkJSProof,
    publicSignals: string[],
    circuit: string
  ): ZKProof {
    // Serialize snarkjs proof to bytes
    const proofJson = JSON.stringify(snarkProof);
    const proofBytes = new TextEncoder().encode(proofJson);

    return {
      proof: proofBytes,
      publicInputs: publicSignals,
      circuit,
      timestamp: new Date(),
      version: '1.0.0',
      metadata: {
        protocol: snarkProof.protocol,
        format: 'snarkjs',
      },
    };
  }

  /**
   * Convert ZKProof to snarkjs format
   */
  static toSnarkJS(proof: ZKProof): { proof: SnarkJSProof; publicSignals: string[] } {
    const proofJson = new TextDecoder().decode(proof.proof);
    const snarkProof = JSON.parse(proofJson) as SnarkJSProof;

    return {
      proof: snarkProof,
      publicSignals: proof.publicInputs,
    };
  }

  /**
   * Load circuit WASM from file/buffer
   *
   * In production, use:
   * ```typescript
   * const wasmBuffer = await fs.readFile('circuit.wasm');
   * ```
   */
  static async loadCircuitWasm(path: string): Promise<Uint8Array> {
    // Placeholder - in production, load from filesystem or remote storage
    throw new Error('ZKP circuit WASM loading is not yet implemented. See docs for planned ZKP support.');
  }

  /**
   * Load zkey (proving key) from file/buffer
   */
  static async loadZkey(path: string): Promise<Uint8Array> {
    // Placeholder - in production, load from filesystem or remote storage
    throw new Error('ZKP zkey loading is not yet implemented. See docs for planned ZKP support.');
  }

  /**
   * Export verification key for on-chain verification
   *
   * Exports verification key in format suitable for Solidity verifier contracts.
   */
  static exportVerificationKeyForSolidity(vk: VerificationKey): string {
    // In production, this would format the verification key
    // for use with a Solidity verifier contract
    const vkJson = {
      keyId: vk.keyId,
      circuitId: vk.circuitId,
      // Add formatted verification key components
    };

    return JSON.stringify(vkJson, null, 2);
  }
}

/**
 * snarkjs proof format
 */
interface SnarkJSProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve?: string;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a proof serializer
 */
export function createProofSerializer(): ProofSerializer {
  return new ProofSerializer();
}

/**
 * Create a key manager
 */
export function createKeyManager(): KeyManager {
  return new KeyManager();
}

/**
 * Create a trusted setup manager
 */
export function createTrustedSetupManager(): TrustedSetupManager {
  return new TrustedSetupManager();
}
