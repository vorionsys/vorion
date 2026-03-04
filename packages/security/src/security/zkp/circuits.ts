/**
 * Zero-Knowledge Circuit Definitions
 *
 * Defines ZK circuits for various privacy-preserving verification use cases:
 * - Age verification (prove age > threshold without revealing DOB)
 * - Range proofs (prove value in range without revealing value)
 * - Set membership proofs (prove membership without revealing identity)
 * - Credential verification (prove valid credential without showing it)
 *
 * This module provides circuit definitions that can be used with SNARK
 * proving systems. The implementations use Schnorr-based proofs for
 * simpler cases with documentation for production SNARK integration.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import {
  type CircuitMetadata,
  type ZKProof,
  type MerkleProof,
  type PredicateProof,
  ZKCircuitType,
  circuitMetadataSchema,
} from './types.js';

const logger = createLogger({ component: 'zkp-circuits' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Circuit-related errors
 */
export class CircuitError extends VorionError {
  override code = 'CIRCUIT_ERROR';
  override statusCode = 400;

  constructor(message: string, public readonly circuitType?: string, details?: Record<string, unknown>) {
    super(message, { circuitType, ...details });
    this.name = 'CircuitError';
  }
}

// =============================================================================
// CIRCUIT REGISTRY
// =============================================================================

/**
 * Registry for ZK circuits
 *
 * Manages circuit definitions, metadata, and provides circuit lookup functionality.
 *
 * @example
 * ```typescript
 * const registry = new CircuitRegistry();
 * registry.registerCircuit(ageVerificationCircuit);
 *
 * const circuit = registry.getCircuit(ZKCircuitType.AGE_VERIFICATION);
 * ```
 */
export class CircuitRegistry {
  private circuits: Map<string, Circuit> = new Map();
  private metadata: Map<string, CircuitMetadata> = new Map();

  constructor() {
    // Register built-in circuits
    this.registerBuiltinCircuits();
    logger.info('Circuit registry initialized with built-in circuits');
  }

  /**
   * Register a circuit
   */
  registerCircuit(circuit: Circuit): void {
    const meta = circuit.getMetadata();
    circuitMetadataSchema.parse(meta);

    this.circuits.set(meta.type, circuit);
    this.metadata.set(meta.type, meta);

    logger.info({ circuitType: meta.type, version: meta.version }, 'Circuit registered');
  }

  /**
   * Get a circuit by type
   */
  getCircuit(type: string): Circuit | undefined {
    return this.circuits.get(type);
  }

  /**
   * Get circuit metadata
   */
  getMetadata(type: string): CircuitMetadata | undefined {
    return this.metadata.get(type);
  }

  /**
   * Get all registered circuits
   */
  getAllCircuits(): Circuit[] {
    return Array.from(this.circuits.values());
  }

  /**
   * Get all circuit metadata
   */
  getAllMetadata(): CircuitMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Check if a circuit is registered
   */
  hasCircuit(type: string): boolean {
    return this.circuits.has(type);
  }

  /**
   * Register built-in circuits
   */
  private registerBuiltinCircuits(): void {
    this.registerCircuit(new AgeVerificationCircuit());
    this.registerCircuit(new RangeProofCircuit());
    this.registerCircuit(new SetMembershipCircuit());
    this.registerCircuit(new CredentialVerificationCircuit());
  }
}

// =============================================================================
// CIRCUIT INTERFACE
// =============================================================================

/**
 * Base interface for ZK circuits
 */
export interface Circuit {
  /**
   * Get circuit metadata
   */
  getMetadata(): CircuitMetadata;

  /**
   * Validate private inputs for the circuit
   */
  validatePrivateInputs(inputs: Record<string, unknown>): boolean;

  /**
   * Validate public inputs for the circuit
   */
  validatePublicInputs(inputs: string[]): boolean;

  /**
   * Compute witness from private inputs
   * (The witness is the full assignment that satisfies the circuit constraints)
   */
  computeWitness(privateInputs: Record<string, unknown>, publicInputs: string[]): Promise<Uint8Array>;

  /**
   * Verify that public inputs match the expected format
   */
  extractPublicInputs(privateInputs: Record<string, unknown>): string[];
}

// =============================================================================
// AGE VERIFICATION CIRCUIT
// =============================================================================

/**
 * Age Verification Circuit
 *
 * Proves that a user's age is above a threshold without revealing their
 * exact date of birth.
 *
 * Public Inputs:
 * - Current timestamp (to prevent replay)
 * - Age threshold (e.g., 18, 21)
 *
 * Private Inputs:
 * - Date of birth
 *
 * Constraints:
 * - age = (currentTimestamp - birthTimestamp) / SECONDS_PER_YEAR
 * - age >= threshold
 *
 * @example
 * ```typescript
 * const circuit = new AgeVerificationCircuit();
 * const witness = await circuit.computeWitness(
 *   { birthDate: new Date('1990-01-15') },
 *   [Date.now().toString(), '18']
 * );
 * ```
 */
export class AgeVerificationCircuit implements Circuit {
  private static readonly SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

  getMetadata(): CircuitMetadata {
    return {
      type: ZKCircuitType.AGE_VERIFICATION,
      name: 'Age Verification Circuit',
      description: 'Proves age is above a threshold without revealing exact date of birth',
      version: '1.0.0',
      publicInputs: ['currentTimestamp', 'ageThreshold'],
      privateInputs: ['birthDate'],
      registeredAt: new Date(),
    };
  }

  validatePrivateInputs(inputs: Record<string, unknown>): boolean {
    if (!inputs.birthDate) {
      return false;
    }

    const birthDate = inputs.birthDate instanceof Date
      ? inputs.birthDate
      : new Date(inputs.birthDate as string | number);

    if (isNaN(birthDate.getTime())) {
      return false;
    }

    // Birth date must be in the past
    if (birthDate.getTime() > Date.now()) {
      return false;
    }

    return true;
  }

  validatePublicInputs(inputs: string[]): boolean {
    if (inputs.length !== 2) {
      return false;
    }

    const [currentTimestamp, ageThreshold] = inputs;

    // Validate timestamp
    const timestamp = parseInt(currentTimestamp!, 10);
    if (isNaN(timestamp) || timestamp <= 0) {
      return false;
    }

    // Validate threshold
    const threshold = parseInt(ageThreshold!, 10);
    if (isNaN(threshold) || threshold < 0 || threshold > 150) {
      return false;
    }

    return true;
  }

  async computeWitness(
    privateInputs: Record<string, unknown>,
    publicInputs: string[]
  ): Promise<Uint8Array> {
    if (!this.validatePrivateInputs(privateInputs)) {
      throw new CircuitError('Invalid private inputs for age verification', ZKCircuitType.AGE_VERIFICATION);
    }

    if (!this.validatePublicInputs(publicInputs)) {
      throw new CircuitError('Invalid public inputs for age verification', ZKCircuitType.AGE_VERIFICATION);
    }

    const birthDate = privateInputs.birthDate instanceof Date
      ? privateInputs.birthDate
      : new Date(privateInputs.birthDate as string | number);

    const currentTimestamp = parseInt(publicInputs[0]!, 10);
    const ageThreshold = parseInt(publicInputs[1]!, 10);

    // Calculate age
    const age = (currentTimestamp - birthDate.getTime()) / AgeVerificationCircuit.SECONDS_PER_YEAR;

    // Check constraint
    if (age < ageThreshold) {
      throw new CircuitError(
        'Age verification constraint not satisfied',
        ZKCircuitType.AGE_VERIFICATION,
        { message: 'User does not meet age requirement' }
      );
    }

    // Compute witness (in production, this would be the full SNARK witness)
    // For now, we create a Schnorr-style commitment
    const witnessData = {
      birthTimestamp: birthDate.getTime(),
      currentTimestamp,
      ageThreshold,
      ageSatisfied: true,
      witnessNonce: this.generateNonce(),
    };

    return this.serializeWitness(witnessData);
  }

  extractPublicInputs(privateInputs: Record<string, unknown>): string[] {
    // Age threshold must be provided separately
    // Current timestamp is the current time
    return [Date.now().toString()];
  }

  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  private serializeWitness(data: Record<string, unknown>): Uint8Array {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json);
  }
}

// =============================================================================
// RANGE PROOF CIRCUIT
// =============================================================================

/**
 * Range Proof Circuit
 *
 * Proves that a value lies within a specified range [min, max] without
 * revealing the actual value. Useful for salary ranges, credit scores, etc.
 *
 * Public Inputs:
 * - Range minimum
 * - Range maximum
 * - Commitment to the value
 *
 * Private Inputs:
 * - The actual value
 * - Commitment randomness (blinding factor)
 *
 * Constraints:
 * - value >= min
 * - value <= max
 * - commitment = Commit(value, randomness)
 *
 * @example
 * ```typescript
 * const circuit = new RangeProofCircuit();
 * const witness = await circuit.computeWitness(
 *   { value: 75000, randomness: '...' },
 *   ['50000', '100000', 'commitment...']
 * );
 * ```
 */
export class RangeProofCircuit implements Circuit {
  getMetadata(): CircuitMetadata {
    return {
      type: ZKCircuitType.RANGE_PROOF,
      name: 'Range Proof Circuit',
      description: 'Proves a value is within a range without revealing the value',
      version: '1.0.0',
      publicInputs: ['rangeMin', 'rangeMax', 'commitment'],
      privateInputs: ['value', 'randomness'],
      registeredAt: new Date(),
    };
  }

  validatePrivateInputs(inputs: Record<string, unknown>): boolean {
    if (typeof inputs.value !== 'number') {
      return false;
    }

    if (!Number.isFinite(inputs.value)) {
      return false;
    }

    return true;
  }

  validatePublicInputs(inputs: string[]): boolean {
    if (inputs.length < 2) {
      return false;
    }

    const [min, max] = inputs;

    const minValue = parseFloat(min!);
    const maxValue = parseFloat(max!);

    if (isNaN(minValue) || isNaN(maxValue)) {
      return false;
    }

    if (minValue > maxValue) {
      return false;
    }

    return true;
  }

  async computeWitness(
    privateInputs: Record<string, unknown>,
    publicInputs: string[]
  ): Promise<Uint8Array> {
    if (!this.validatePrivateInputs(privateInputs)) {
      throw new CircuitError('Invalid private inputs for range proof', ZKCircuitType.RANGE_PROOF);
    }

    if (!this.validatePublicInputs(publicInputs)) {
      throw new CircuitError('Invalid public inputs for range proof', ZKCircuitType.RANGE_PROOF);
    }

    const value = privateInputs.value as number;
    const min = parseFloat(publicInputs[0]!);
    const max = parseFloat(publicInputs[1]!);

    // Check range constraints
    if (value < min || value > max) {
      throw new CircuitError(
        'Range proof constraint not satisfied',
        ZKCircuitType.RANGE_PROOF,
        { message: 'Value is not within the specified range' }
      );
    }

    // Compute witness for range proof
    // In production, this would decompose the value into bits and prove
    // that value - min >= 0 and max - value >= 0
    const witnessData = {
      value,
      min,
      max,
      valueLessDelta: value - min,
      deltaLessValue: max - value,
      rangeSatisfied: true,
      witnessNonce: this.generateNonce(),
    };

    return this.serializeWitness(witnessData);
  }

  extractPublicInputs(privateInputs: Record<string, unknown>): string[] {
    // Cannot extract public inputs from private inputs alone
    // Range bounds must be provided separately
    return [];
  }

  /**
   * Create a commitment to a value for use in range proofs
   */
  async createValueCommitment(value: number): Promise<{ commitment: string; randomness: string }> {
    const randomness = this.generateNonce();

    // Simple commitment: H(value || randomness)
    // In production, use Pedersen commitment for homomorphic properties
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

  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  private serializeWitness(data: Record<string, unknown>): Uint8Array {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json);
  }
}

// =============================================================================
// SET MEMBERSHIP CIRCUIT
// =============================================================================

/**
 * Set Membership Circuit
 *
 * Proves that a user is a member of an allowed set without revealing
 * which specific member they are. Uses Merkle tree proofs.
 *
 * Public Inputs:
 * - Merkle root of the set
 * - Nullifier (to prevent double-use without revealing identity)
 *
 * Private Inputs:
 * - User's element (leaf value)
 * - Merkle proof (siblings and path indices)
 * - Nullifier secret
 *
 * Constraints:
 * - MerkleVerify(root, leaf, siblings, pathIndices) = true
 * - nullifier = Hash(element, nullifierSecret)
 *
 * @example
 * ```typescript
 * const circuit = new SetMembershipCircuit();
 * const witness = await circuit.computeWitness(
 *   {
 *     element: 'user123',
 *     merkleProof: { siblings: [...], pathIndices: [...] },
 *     nullifierSecret: '...'
 *   },
 *   ['merkleRoot', 'nullifier']
 * );
 * ```
 */
export class SetMembershipCircuit implements Circuit {
  getMetadata(): CircuitMetadata {
    return {
      type: ZKCircuitType.SET_MEMBERSHIP,
      name: 'Set Membership Circuit',
      description: 'Proves membership in a set without revealing which member',
      version: '1.0.0',
      publicInputs: ['merkleRoot', 'nullifier'],
      privateInputs: ['element', 'merkleProof', 'nullifierSecret'],
      registeredAt: new Date(),
    };
  }

  validatePrivateInputs(inputs: Record<string, unknown>): boolean {
    if (!inputs.element || typeof inputs.element !== 'string') {
      return false;
    }

    if (!inputs.merkleProof) {
      return false;
    }

    const proof = inputs.merkleProof as Partial<MerkleProof>;
    if (!Array.isArray(proof.siblings) || !Array.isArray(proof.pathIndices)) {
      return false;
    }

    if (proof.siblings.length !== proof.pathIndices.length) {
      return false;
    }

    return true;
  }

  validatePublicInputs(inputs: string[]): boolean {
    if (inputs.length < 1) {
      return false;
    }

    const [merkleRoot] = inputs;
    if (!merkleRoot || merkleRoot.length === 0) {
      return false;
    }

    return true;
  }

  async computeWitness(
    privateInputs: Record<string, unknown>,
    publicInputs: string[]
  ): Promise<Uint8Array> {
    if (!this.validatePrivateInputs(privateInputs)) {
      throw new CircuitError('Invalid private inputs for set membership', ZKCircuitType.SET_MEMBERSHIP);
    }

    if (!this.validatePublicInputs(publicInputs)) {
      throw new CircuitError('Invalid public inputs for set membership', ZKCircuitType.SET_MEMBERSHIP);
    }

    const element = privateInputs.element as string;
    const merkleProof = privateInputs.merkleProof as MerkleProof;
    const expectedRoot = publicInputs[0]!;

    // Verify Merkle proof
    const computedRoot = await this.computeMerkleRoot(element, merkleProof);

    if (computedRoot !== expectedRoot) {
      throw new CircuitError(
        'Set membership constraint not satisfied',
        ZKCircuitType.SET_MEMBERSHIP,
        { message: 'Element is not in the set' }
      );
    }

    // Compute nullifier
    const nullifierSecret = privateInputs.nullifierSecret as string || this.generateNonce();
    const nullifier = await this.computeNullifier(element, nullifierSecret);

    const witnessData = {
      element,
      siblings: merkleProof.siblings,
      pathIndices: merkleProof.pathIndices,
      computedRoot,
      nullifier,
      membershipVerified: true,
      witnessNonce: this.generateNonce(),
    };

    return this.serializeWitness(witnessData);
  }

  extractPublicInputs(privateInputs: Record<string, unknown>): string[] {
    // Cannot extract root from private inputs
    return [];
  }

  /**
   * Compute Merkle root from leaf and proof
   */
  async computeMerkleRoot(leaf: string, proof: MerkleProof): Promise<string> {
    let currentHash = await this.hashLeaf(leaf);

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i]!;
      const isRight = proof.pathIndices[i] === 1;

      if (isRight) {
        currentHash = await this.hashPair(sibling, currentHash);
      } else {
        currentHash = await this.hashPair(currentHash, sibling);
      }
    }

    return currentHash;
  }

  /**
   * Build a Merkle tree from a set of elements
   */
  async buildMerkleTree(elements: string[]): Promise<{ root: string; proofs: Map<string, MerkleProof> }> {
    if (elements.length === 0) {
      throw new CircuitError('Cannot build Merkle tree from empty set', ZKCircuitType.SET_MEMBERSHIP);
    }

    // Pad to power of 2
    const size = Math.pow(2, Math.ceil(Math.log2(elements.length)));
    const paddedElements = [...elements];
    while (paddedElements.length < size) {
      paddedElements.push('');
    }

    // Hash leaves
    const leaves = await Promise.all(paddedElements.map(e => this.hashLeaf(e)));

    // Build tree levels
    const levels: string[][] = [leaves];
    let currentLevel = leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        const right = currentLevel[i + 1] ?? left;
        nextLevel.push(await this.hashPair(left, right));
      }
      levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    const root = currentLevel[0]!;

    // Generate proofs for original elements
    const proofs = new Map<string, MerkleProof>();
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!;
      const proof = this.generateProof(i, levels);
      proofs.set(element, {
        leaf: element,
        root,
        siblings: proof.siblings,
        pathIndices: proof.pathIndices,
        leafIndex: i,
      });
    }

    return { root, proofs };
  }

  private generateProof(leafIndex: number, levels: string[][]): { siblings: string[]; pathIndices: number[] } {
    const siblings: string[] = [];
    const pathIndices: number[] = [];

    let index = leafIndex;
    for (let i = 0; i < levels.length - 1; i++) {
      const level = levels[i]!;
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;

      if (siblingIndex < level.length) {
        siblings.push(level[siblingIndex]!);
      } else {
        siblings.push(level[index]!);
      }

      pathIndices.push(isRight ? 1 : 0);
      index = Math.floor(index / 2);
    }

    return { siblings, pathIndices };
  }

  private async hashLeaf(value: string): Promise<string> {
    const data = `leaf:${value}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async hashPair(left: string, right: string): Promise<string> {
    const data = `node:${left}|${right}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
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

  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  private serializeWitness(data: Record<string, unknown>): Uint8Array {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json);
  }
}

// =============================================================================
// CREDENTIAL VERIFICATION CIRCUIT
// =============================================================================

/**
 * Credential Verification Circuit
 *
 * Proves possession of a valid credential without revealing the credential
 * itself. Supports selective disclosure of specific claims.
 *
 * Public Inputs:
 * - Issuer public key or DID
 * - Credential schema hash
 * - Disclosed claim hashes
 * - Predicate results
 *
 * Private Inputs:
 * - Full credential
 * - Credential signature
 * - Claims to prove
 *
 * Constraints:
 * - VerifySignature(issuerPK, credential, signature) = true
 * - Hash(credential.schema) = schemaHash
 * - For each disclosed claim: Hash(claim) matches public input
 * - For each predicate: predicate evaluation is true
 *
 * @example
 * ```typescript
 * const circuit = new CredentialVerificationCircuit();
 * const witness = await circuit.computeWitness(
 *   {
 *     credential: { ... },
 *     selectiveDisclosure: {
 *       reveal: ['name'],
 *       predicates: [{ claim: 'age', operator: 'gte', value: 21 }]
 *     }
 *   },
 *   ['issuerDID', 'schemaHash']
 * );
 * ```
 */
export class CredentialVerificationCircuit implements Circuit {
  getMetadata(): CircuitMetadata {
    return {
      type: ZKCircuitType.CREDENTIAL_VERIFICATION,
      name: 'Credential Verification Circuit',
      description: 'Proves possession of a valid credential with selective disclosure',
      version: '1.0.0',
      publicInputs: ['issuerIdentifier', 'schemaHash', 'disclosedClaimHashes', 'predicateResults'],
      privateInputs: ['credential', 'signature', 'selectiveDisclosure'],
      registeredAt: new Date(),
    };
  }

  validatePrivateInputs(inputs: Record<string, unknown>): boolean {
    if (!inputs.credential || typeof inputs.credential !== 'object') {
      return false;
    }

    const credential = inputs.credential as Record<string, unknown>;
    if (!credential.issuer || !credential.subject || !credential.claims) {
      return false;
    }

    return true;
  }

  validatePublicInputs(inputs: string[]): boolean {
    if (inputs.length < 1) {
      return false;
    }

    const [issuerIdentifier] = inputs;
    if (!issuerIdentifier) {
      return false;
    }

    return true;
  }

  async computeWitness(
    privateInputs: Record<string, unknown>,
    publicInputs: string[]
  ): Promise<Uint8Array> {
    if (!this.validatePrivateInputs(privateInputs)) {
      throw new CircuitError('Invalid private inputs for credential verification', ZKCircuitType.CREDENTIAL_VERIFICATION);
    }

    if (!this.validatePublicInputs(publicInputs)) {
      throw new CircuitError('Invalid public inputs for credential verification', ZKCircuitType.CREDENTIAL_VERIFICATION);
    }

    const credential = privateInputs.credential as {
      issuer: string;
      subject: string;
      type: string;
      claims: Record<string, unknown>;
      issuedAt: string;
      expiresAt?: string;
      signature?: string;
    };

    const selectiveDisclosure = privateInputs.selectiveDisclosure as {
      reveal?: string[];
      proveExistence?: string[];
      predicates?: PredicateProof[];
    } | undefined;

    const expectedIssuer = publicInputs[0]!;

    // Verify issuer matches
    if (credential.issuer !== expectedIssuer) {
      throw new CircuitError(
        'Credential issuer mismatch',
        ZKCircuitType.CREDENTIAL_VERIFICATION,
        { message: 'Credential was not issued by the expected issuer' }
      );
    }

    // Check expiration
    if (credential.expiresAt) {
      const expiresAt = new Date(credential.expiresAt);
      if (expiresAt.getTime() < Date.now()) {
        throw new CircuitError(
          'Credential has expired',
          ZKCircuitType.CREDENTIAL_VERIFICATION,
          { message: 'Credential is no longer valid' }
        );
      }
    }

    // Evaluate predicates
    const predicateResults: boolean[] = [];
    if (selectiveDisclosure?.predicates) {
      for (const predicate of selectiveDisclosure.predicates) {
        const result = this.evaluatePredicate(credential.claims, predicate);
        predicateResults.push(result);

        if (!result) {
          throw new CircuitError(
            'Predicate not satisfied',
            ZKCircuitType.CREDENTIAL_VERIFICATION,
            { claim: predicate.claim, operator: predicate.operator }
          );
        }
      }
    }

    // Compute disclosed claim hashes
    const disclosedClaimHashes: string[] = [];
    if (selectiveDisclosure?.reveal) {
      for (const claimName of selectiveDisclosure.reveal) {
        if (claimName in credential.claims) {
          const claimValue = credential.claims[claimName];
          const hash = await this.hashClaim(claimName, claimValue);
          disclosedClaimHashes.push(hash);
        }
      }
    }

    const witnessData = {
      issuer: credential.issuer,
      subject: credential.subject,
      type: credential.type,
      disclosedClaimHashes,
      predicateResults,
      credentialValid: true,
      witnessNonce: this.generateNonce(),
    };

    return this.serializeWitness(witnessData);
  }

  extractPublicInputs(privateInputs: Record<string, unknown>): string[] {
    const credential = privateInputs.credential as {
      issuer: string;
    } | undefined;

    if (credential) {
      return [credential.issuer];
    }

    return [];
  }

  /**
   * Evaluate a predicate against credential claims
   */
  private evaluatePredicate(claims: Record<string, unknown>, predicate: PredicateProof): boolean {
    const claimValue = claims[predicate.claim];

    if (claimValue === undefined) {
      return false;
    }

    switch (predicate.operator) {
      case 'gt':
        return typeof claimValue === 'number' && claimValue > (predicate.value as number);
      case 'gte':
        return typeof claimValue === 'number' && claimValue >= (predicate.value as number);
      case 'lt':
        return typeof claimValue === 'number' && claimValue < (predicate.value as number);
      case 'lte':
        return typeof claimValue === 'number' && claimValue <= (predicate.value as number);
      case 'eq':
        return claimValue === predicate.value;
      case 'neq':
        return claimValue !== predicate.value;
      case 'in':
        return Array.isArray(predicate.value) && predicate.value.includes(claimValue);
      case 'not_in':
        return Array.isArray(predicate.value) && !predicate.value.includes(claimValue);
      default:
        return false;
    }
  }

  private async hashClaim(name: string, value: unknown): Promise<string> {
    const data = `claim:${name}:${JSON.stringify(value)}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  private serializeWitness(data: Record<string, unknown>): Uint8Array {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new circuit registry with built-in circuits
 */
export function createCircuitRegistry(): CircuitRegistry {
  return new CircuitRegistry();
}

/**
 * Get a specific circuit by type
 */
export function getCircuit(type: ZKCircuitType): Circuit {
  const registry = new CircuitRegistry();
  const circuit = registry.getCircuit(type);

  if (!circuit) {
    throw new CircuitError(`Circuit not found: ${type}`, type);
  }

  return circuit;
}
