/**
 * Hash Verifier
 *
 * Provides tamper-evident hashing capabilities for compliance evidence exports.
 * Includes SHA-256 hashing, Merkle tree generation, and digital signatures.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  buildMerkleTree,
  sha256,
  type MerkleTreeResult,
} from '../../proof/merkle.js';
import type { EvidenceCollection } from './evidence-collector.js';

const logger = createLogger({ component: 'hash-verifier' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Hash entry for a single evidence item
 */
export interface EvidenceHash {
  /** Unique identifier for the evidence item */
  id: string;
  /** Type of evidence */
  type: string;
  /** SHA-256 hash of the evidence content */
  hash: string;
  /** Timestamp when hash was computed */
  computedAt: string;
}

/**
 * Merkle tree proof for evidence verification
 */
export interface EvidenceMerkleProof {
  /** Merkle root hash */
  root: string;
  /** Total number of evidence items (leaves) */
  leafCount: number;
  /** Tree depth */
  treeDepth: number;
  /** Algorithm used */
  algorithm: 'sha256';
  /** Timestamp when tree was built */
  builtAt: string;
}

/**
 * Digital signature for evidence package
 */
export interface EvidenceSignature {
  /** Signature algorithm */
  algorithm: 'RSASSA-PKCS1-v1_5' | 'ECDSA' | 'HMAC-SHA256';
  /** Base64-encoded signature */
  signature: string;
  /** Key identifier used for signing */
  keyId: string;
  /** Timestamp when signed */
  signedAt: string;
  /** Hash of the signed content */
  contentHash: string;
}

/**
 * Complete tamper-evident package
 */
export interface TamperEvidentPackage {
  /** Package version */
  version: string;
  /** Package identifier */
  packageId: string;
  /** Created timestamp */
  createdAt: string;

  /** Individual evidence hashes */
  evidenceHashes: EvidenceHash[];

  /** Merkle tree proof */
  merkleProof: EvidenceMerkleProof;

  /** Digital signature (if signing key available) */
  signature?: EvidenceSignature;

  /** Verification instructions */
  verificationInstructions: VerificationInstructions;
}

/**
 * Instructions for verifying the evidence package
 */
export interface VerificationInstructions {
  /** Steps for manual verification */
  steps: string[];
  /** Algorithm details */
  algorithms: {
    hash: string;
    merkle: string;
    signature?: string;
  };
  /** Sample code for verification */
  sampleCode: {
    language: string;
    code: string;
  };
  /** Contact for verification assistance */
  verificationContact?: string;
}

/**
 * Configuration for the hash verifier
 */
export interface HashVerifierConfig {
  /** Signing key (optional, for digital signatures) */
  signingKey?: CryptoKey;
  /** Signing key ID */
  signingKeyId?: string;
  /** Signing algorithm */
  signatureAlgorithm?: 'RSASSA-PKCS1-v1_5' | 'ECDSA' | 'HMAC-SHA256';
  /** Verification contact email */
  verificationContact?: string;
}

// =============================================================================
// HASH VERIFIER
// =============================================================================

/**
 * Hash Verifier for creating tamper-evident evidence packages
 */
export class HashVerifier {
  private readonly version = '1.0.0';
  private config: HashVerifierConfig;

  constructor(config: HashVerifierConfig = {}) {
    this.config = config;
    logger.info('Hash verifier initialized');
  }

  /**
   * Create a tamper-evident package for an evidence collection
   */
  async createTamperEvidentPackage(
    collection: EvidenceCollection
  ): Promise<TamperEvidentPackage> {
    const packageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    logger.info(
      {
        packageId,
        collectionId: collection.metadata.collectionId,
        totalRecords: collection.summary.totalRecords,
      },
      'Creating tamper-evident package'
    );

    const startTime = Date.now();

    // Compute individual evidence hashes
    const evidenceHashes = await this.computeEvidenceHashes(collection);

    // Build Merkle tree from hashes
    const merkleProof = await this.buildMerkleProof(evidenceHashes);

    // Create digital signature if key is available
    let signature: EvidenceSignature | undefined;
    if (this.config.signingKey) {
      signature = await this.signPackage(merkleProof.root, createdAt);
    }

    // Generate verification instructions
    const verificationInstructions = this.generateVerificationInstructions(
      signature !== undefined
    );

    const duration = Date.now() - startTime;

    logger.info(
      {
        packageId,
        hashCount: evidenceHashes.length,
        merkleRoot: merkleProof.root.slice(0, 16) + '...',
        signed: signature !== undefined,
        durationMs: duration,
      },
      'Tamper-evident package created'
    );

    return {
      version: this.version,
      packageId,
      createdAt,
      evidenceHashes,
      merkleProof,
      signature,
      verificationInstructions,
    };
  }

  /**
   * Compute SHA-256 hashes for all evidence items
   */
  private async computeEvidenceHashes(
    collection: EvidenceCollection
  ): Promise<EvidenceHash[]> {
    const hashes: EvidenceHash[] = [];
    const computedAt = new Date().toISOString();

    // Hash audit events
    for (const event of collection.auditEvents) {
      const hash = await sha256(JSON.stringify(event));
      hashes.push({
        id: event.id,
        type: 'audit_event',
        hash,
        computedAt,
      });
    }

    // Hash policy changes
    for (const change of collection.policyChanges) {
      const hash = await sha256(JSON.stringify(change));
      hashes.push({
        id: change.id,
        type: 'policy_change',
        hash,
        computedAt,
      });
    }

    // Hash access decisions
    for (const decision of collection.accessDecisions) {
      const hash = await sha256(JSON.stringify(decision));
      hashes.push({
        id: decision.id,
        type: 'access_decision',
        hash,
        computedAt,
      });
    }

    // Hash trust score changes
    for (const change of collection.trustScoreChanges) {
      const hash = await sha256(JSON.stringify(change));
      hashes.push({
        id: change.id,
        type: 'trust_score_change',
        hash,
        computedAt,
      });
    }

    // Hash escalation decisions
    for (const decision of collection.escalationDecisions) {
      const hash = await sha256(JSON.stringify(decision));
      hashes.push({
        id: decision.id,
        type: 'escalation_decision',
        hash,
        computedAt,
      });
    }

    // Hash data retention logs
    for (const log of collection.dataRetentionLogs) {
      const hash = await sha256(JSON.stringify(log));
      hashes.push({
        id: log.id,
        type: 'data_retention_log',
        hash,
        computedAt,
      });
    }

    // Hash the collection metadata
    const metadataHash = await sha256(JSON.stringify(collection.metadata));
    hashes.push({
      id: collection.metadata.collectionId,
      type: 'collection_metadata',
      hash: metadataHash,
      computedAt,
    });

    // Hash the summary
    const summaryHash = await sha256(JSON.stringify(collection.summary));
    hashes.push({
      id: `${collection.metadata.collectionId}_summary`,
      type: 'collection_summary',
      hash: summaryHash,
      computedAt,
    });

    return hashes;
  }

  /**
   * Build Merkle tree from evidence hashes
   */
  private async buildMerkleProof(
    evidenceHashes: EvidenceHash[]
  ): Promise<EvidenceMerkleProof> {
    if (evidenceHashes.length === 0) {
      // Empty collection - use a placeholder hash
      const emptyHash = await sha256('empty_evidence_collection');
      return {
        root: emptyHash,
        leafCount: 0,
        treeDepth: 0,
        algorithm: 'sha256',
        builtAt: new Date().toISOString(),
      };
    }

    // Extract just the hashes for the Merkle tree
    const hashes = evidenceHashes.map((e) => e.hash);

    // Build the tree
    const tree = await buildMerkleTree(hashes);

    return {
      root: tree.root,
      leafCount: tree.leafCount,
      treeDepth: tree.levels.length,
      algorithm: 'sha256',
      builtAt: new Date().toISOString(),
    };
  }

  /**
   * Sign the package using the configured key
   */
  private async signPackage(
    merkleRoot: string,
    timestamp: string
  ): Promise<EvidenceSignature> {
    if (!this.config.signingKey) {
      throw new Error('No signing key configured');
    }

    // Content to sign: merkle root + timestamp
    const contentToSign = `${merkleRoot}:${timestamp}`;
    const contentHash = await sha256(contentToSign);

    const encoder = new TextEncoder();
    const data = encoder.encode(contentToSign);

    // Determine algorithm parameters
    const algorithm = this.config.signatureAlgorithm ?? 'RSASSA-PKCS1-v1_5';
    let signatureAlgorithm: AlgorithmIdentifier | EcdsaParams | Algorithm;

    switch (algorithm) {
      case 'RSASSA-PKCS1-v1_5':
        signatureAlgorithm = { name: 'RSASSA-PKCS1-v1_5' };
        break;
      case 'ECDSA':
        signatureAlgorithm = { name: 'ECDSA', hash: { name: 'SHA-256' } } as EcdsaParams;
        break;
      case 'HMAC-SHA256':
        signatureAlgorithm = { name: 'HMAC' };
        break;
      default:
        throw new Error(`Unsupported signature algorithm: ${algorithm}`);
    }

    // Sign the content
    const signatureBuffer = await crypto.subtle.sign(
      signatureAlgorithm,
      this.config.signingKey,
      data
    );

    // Convert to base64
    const signatureArray = new Uint8Array(signatureBuffer);
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray));

    return {
      algorithm,
      signature: signatureBase64,
      keyId: this.config.signingKeyId ?? 'default',
      signedAt: new Date().toISOString(),
      contentHash,
    };
  }

  /**
   * Generate verification instructions
   */
  private generateVerificationInstructions(
    includeSignatureVerification: boolean
  ): VerificationInstructions {
    const steps = [
      '1. Parse the evidence JSON file and extract all evidence records.',
      '2. For each evidence record, compute SHA-256 hash of the JSON-serialized content.',
      '3. Verify that computed hashes match the hashes in the evidenceHashes array.',
      '4. Collect all evidence hashes and build a Merkle tree using SHA-256.',
      '5. Verify that the computed Merkle root matches the merkleProof.root value.',
    ];

    if (includeSignatureVerification) {
      steps.push(
        '6. To verify the digital signature, concatenate the Merkle root and signature timestamp with a colon.',
        '7. Verify the signature using the public key corresponding to the keyId.'
      );
    }

    steps.push(
      '',
      'If any verification step fails, the evidence may have been tampered with.',
      'Contact the verification contact for assistance.'
    );

    const algorithms: VerificationInstructions['algorithms'] = {
      hash: 'SHA-256 (FIPS 180-4)',
      merkle: 'Binary Merkle Tree with SHA-256 internal nodes',
    };

    if (includeSignatureVerification) {
      algorithms.signature = this.config.signatureAlgorithm ?? 'RSASSA-PKCS1-v1_5';
    }

    const sampleCode = {
      language: 'typescript',
      code: `
// Verification example using Web Crypto API
async function verifyEvidence(evidence: any, evidenceHashes: any[], merkleRoot: string): Promise<boolean> {
  // Step 1: Verify individual evidence hashes
  for (const record of evidence) {
    const computedHash = await sha256(JSON.stringify(record));
    const expectedHash = evidenceHashes.find(h => h.id === record.id)?.hash;
    if (computedHash !== expectedHash) {
      console.error(\`Hash mismatch for record \${record.id}\`);
      return false;
    }
  }

  // Step 2: Build Merkle tree and verify root
  const hashes = evidenceHashes.map(h => h.hash);
  const tree = await buildMerkleTree(hashes);
  if (tree.root !== merkleRoot) {
    console.error('Merkle root mismatch');
    return false;
  }

  return true;
}

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
`.trim(),
    };

    return {
      steps,
      algorithms,
      sampleCode,
      verificationContact: this.config.verificationContact,
    };
  }

  /**
   * Verify a tamper-evident package
   */
  async verifyPackage(
    evidence: EvidenceCollection,
    pkg: TamperEvidentPackage
  ): Promise<{
    valid: boolean;
    errors: string[];
    details: {
      hashesVerified: number;
      hashMismatches: string[];
      merkleRootValid: boolean;
      signatureValid?: boolean;
    };
  }> {
    const errors: string[] = [];
    const hashMismatches: string[] = [];
    let hashesVerified = 0;

    logger.info(
      { packageId: pkg.packageId },
      'Verifying tamper-evident package'
    );

    // Step 1: Verify individual evidence hashes
    const computedHashes = await this.computeEvidenceHashes(evidence);

    for (const computed of computedHashes) {
      const expected = pkg.evidenceHashes.find((h) => h.id === computed.id);
      if (!expected) {
        errors.push(`Missing hash for evidence ${computed.id}`);
        hashMismatches.push(computed.id);
      } else if (computed.hash !== expected.hash) {
        errors.push(`Hash mismatch for evidence ${computed.id}`);
        hashMismatches.push(computed.id);
      } else {
        hashesVerified++;
      }
    }

    // Step 2: Verify Merkle root
    const computedMerkle = await this.buildMerkleProof(computedHashes);
    const merkleRootValid = computedMerkle.root === pkg.merkleProof.root;

    if (!merkleRootValid) {
      errors.push(
        `Merkle root mismatch: expected ${pkg.merkleProof.root}, computed ${computedMerkle.root}`
      );
    }

    // Step 3: Verify signature (if present and key available)
    let signatureValid: boolean | undefined;
    if (pkg.signature && this.config.signingKey) {
      try {
        signatureValid = await this.verifySignature(pkg.signature, pkg.merkleProof.root);
        if (!signatureValid) {
          errors.push('Digital signature verification failed');
        }
      } catch (err) {
        errors.push(`Signature verification error: ${(err as Error).message}`);
        signatureValid = false;
      }
    }

    const valid = errors.length === 0;

    logger.info(
      {
        packageId: pkg.packageId,
        valid,
        errorCount: errors.length,
        hashesVerified,
      },
      'Package verification completed'
    );

    return {
      valid,
      errors,
      details: {
        hashesVerified,
        hashMismatches,
        merkleRootValid,
        signatureValid,
      },
    };
  }

  /**
   * Verify a digital signature
   */
  private async verifySignature(
    signature: EvidenceSignature,
    merkleRoot: string
  ): Promise<boolean> {
    if (!this.config.signingKey) {
      throw new Error('No signing key configured for verification');
    }

    // Reconstruct the signed content
    const contentToSign = `${merkleRoot}:${signature.signedAt}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(contentToSign);

    // Decode the signature
    const signatureBytes = Uint8Array.from(atob(signature.signature), (c) =>
      c.charCodeAt(0)
    );

    // Determine algorithm parameters
    let signatureAlgorithm: AlgorithmIdentifier | EcdsaParams | Algorithm;

    switch (signature.algorithm) {
      case 'RSASSA-PKCS1-v1_5':
        signatureAlgorithm = { name: 'RSASSA-PKCS1-v1_5' };
        break;
      case 'ECDSA':
        signatureAlgorithm = { name: 'ECDSA', hash: { name: 'SHA-256' } } as EcdsaParams;
        break;
      case 'HMAC-SHA256':
        signatureAlgorithm = { name: 'HMAC' };
        break;
      default:
        throw new Error(`Unsupported signature algorithm: ${signature.algorithm}`);
    }

    // Verify the signature
    return crypto.subtle.verify(
      signatureAlgorithm,
      this.config.signingKey,
      signatureBytes,
      data
    );
  }

  /**
   * Compute SHA-256 hash of arbitrary data
   */
  async computeHash(data: string | object): Promise<string> {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return sha256(content);
  }

  /**
   * Generate a simple hash verification report
   */
  async generateHashReport(
    collection: EvidenceCollection
  ): Promise<{
    collectionId: string;
    totalItems: number;
    hashAlgorithm: string;
    hashes: Array<{ id: string; type: string; hash: string }>;
    combinedHash: string;
    generatedAt: string;
  }> {
    const hashes = await this.computeEvidenceHashes(collection);

    // Compute combined hash of all hashes
    const allHashes = hashes.map((h) => h.hash).join('');
    const combinedHash = await sha256(allHashes);

    return {
      collectionId: collection.metadata.collectionId,
      totalItems: hashes.length,
      hashAlgorithm: 'SHA-256',
      hashes: hashes.map((h) => ({ id: h.id, type: h.type, hash: h.hash })),
      combinedHash,
      generatedAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let hashVerifierInstance: HashVerifier | null = null;

/**
 * Get the singleton hash verifier instance
 */
export function getHashVerifier(config?: HashVerifierConfig): HashVerifier {
  if (!hashVerifierInstance) {
    hashVerifierInstance = new HashVerifier(config);
  }
  return hashVerifierInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetHashVerifier(): void {
  hashVerifierInstance = null;
}

/**
 * Create a new HashVerifier instance with custom config
 */
export function createHashVerifier(config?: HashVerifierConfig): HashVerifier {
  return new HashVerifier(config);
}
