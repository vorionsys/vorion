/**
 * Compliance Use Cases for Zero-Knowledge Proofs
 *
 * Implements privacy-preserving compliance verification for:
 * - KYC without data sharing
 * - AML screening proofs
 * - GDPR-compliant verification
 * - PCI-DSS cardholder verification
 *
 * These use cases enable regulatory compliance while preserving user privacy
 * through selective disclosure and zero-knowledge proofs.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type ZKProof,
  type VerificationResult,
  type ZKCredential,
  type ComplianceProofRequest,
  type ComplianceVerificationResult,
  type SelectiveDisclosureRequest,
  ComplianceVerificationType,
  complianceProofRequestSchema,
  complianceVerificationResultSchema,
} from './types.js';
import { ZKProverService, createZKProver } from './prover.js';
import { ZKVerifierService, createZKVerifier } from './verifier.js';
import { MerkleTreeService, AccumulatorService } from './commitment.js';

const logger = createLogger({ component: 'zkp-compliance' });

// =============================================================================
// METRICS
// =============================================================================

const complianceVerifications = new Counter({
  name: 'vorion_zkp_compliance_verifications_total',
  help: 'Total compliance verifications performed',
  labelNames: ['type', 'result'] as const,
  registers: [vorionRegistry],
});

const complianceVerificationDuration = new Histogram({
  name: 'vorion_zkp_compliance_verification_duration_seconds',
  help: 'Duration of compliance verifications',
  labelNames: ['type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [vorionRegistry],
});

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Compliance verification error
 */
export class ComplianceError extends VorionError {
  override code = 'COMPLIANCE_ERROR';
  override statusCode = 400;

  constructor(
    message: string,
    public readonly verificationType: ComplianceVerificationType,
    details?: Record<string, unknown>
  ) {
    super(message, { verificationType, ...details });
    this.name = 'ComplianceError';
  }
}

// =============================================================================
// KYC SERVICE
// =============================================================================

/**
 * KYC (Know Your Customer) Verification Service
 *
 * Enables identity verification without sharing actual identity documents.
 * Users prove they have been KYC-verified by a trusted issuer without
 * revealing their personal information.
 *
 * Supported proofs:
 * - Identity verified by issuer
 * - Age verification (e.g., over 18)
 * - Jurisdiction verification
 * - Sanctions list clearance
 *
 * @example
 * ```typescript
 * const kyc = new KYCVerificationService();
 *
 * // Verify age requirement without revealing DOB
 * const result = await kyc.verifyAgeRequirement(credential, 18);
 *
 * // Verify identity without revealing PII
 * const idResult = await kyc.verifyIdentity(credential, {
 *   requiredIssuer: 'did:example:trusted-issuer',
 *   requiredLevel: 'enhanced'
 * });
 * ```
 */
export class KYCVerificationService {
  private prover: ZKProverService;
  private verifier: ZKVerifierService;

  constructor(prover?: ZKProverService, verifier?: ZKVerifierService) {
    this.prover = prover ?? createZKProver();
    this.verifier = verifier ?? createZKVerifier();
    logger.info('KYC verification service initialized');
  }

  /**
   * Verify age requirement using ZK proof
   *
   * Proves user is at least `minAge` years old without revealing date of birth.
   */
  async verifyAgeRequirement(
    credential: ZKCredential,
    minAge: number
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ minAge }, 'Verifying age requirement');

      // Extract birth date from credential
      const birthDate = credential.claims['birthDate'];
      if (!birthDate) {
        throw new ComplianceError(
          'Credential does not contain birth date',
          ComplianceVerificationType.KYC
        );
      }

      // Generate age proof
      const proof = await this.prover.generateAgeProof(
        new Date(birthDate as string),
        minAge
      );

      // Verify the proof
      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.KYC,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.KYC },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.KYC,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        validUntil: proof.expiresAt,
        attestation: this.generateAttestation('age_verification', verificationResult),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.KYC,
        result: 'error',
      });

      if (error instanceof ComplianceError) {
        throw error;
      }

      throw new ComplianceError(
        `KYC age verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.KYC
      );
    }
  }

  /**
   * Verify identity credential without revealing PII
   */
  async verifyIdentity(
    credential: ZKCredential,
    requirements: KYCRequirements
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ requirements }, 'Verifying identity');

      // Check issuer
      if (requirements.requiredIssuer && credential.issuer !== requirements.requiredIssuer) {
        return this.createFailedResult(
          ComplianceVerificationType.KYC,
          'Credential not from required issuer'
        );
      }

      // Build selective disclosure request
      const disclosure: SelectiveDisclosureRequest = {
        proveExistence: requirements.requiredClaims ?? ['identityVerified'],
        reveal: requirements.revealClaims ?? [],
        predicates: [],
      };

      // Add level predicate if required
      if (requirements.requiredLevel) {
        const levelOrder = ['basic', 'standard', 'enhanced'];
        const requiredIndex = levelOrder.indexOf(requirements.requiredLevel);

        disclosure.predicates.push({
          claim: 'verificationLevel',
          operator: 'in',
          value: levelOrder.slice(requiredIndex),
        });
      }

      // Generate credential proof
      const proof = await this.prover.generateCredentialProof(credential, disclosure);
      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.KYC,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.KYC },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.KYC,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        validUntil: proof.expiresAt,
        attestation: this.generateAttestation('identity_verification', verificationResult),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.KYC,
        result: 'error',
      });

      if (error instanceof ComplianceError) {
        throw error;
      }

      throw new ComplianceError(
        `KYC identity verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.KYC
      );
    }
  }

  /**
   * Generate compliance attestation
   */
  private generateAttestation(verificationType: string, result: VerificationResult): string {
    const attestationData = {
      type: verificationType,
      valid: result.valid,
      circuit: result.circuit,
      verifiedAt: result.verifiedAt.toISOString(),
      publicInputs: result.publicInputs,
    };

    return Buffer.from(JSON.stringify(attestationData)).toString('base64');
  }

  private createFailedResult(
    type: ComplianceVerificationType,
    reason: string
  ): ComplianceVerificationResult {
    return {
      verificationType: type,
      compliant: false,
      proofResults: [{
        valid: false,
        circuit: 'none',
        verifiedAt: new Date(),
        publicInputs: [],
        error: reason,
      }],
      verifiedAt: new Date(),
    };
  }
}

/**
 * KYC verification requirements
 */
export interface KYCRequirements {
  /** Required credential issuer DID */
  requiredIssuer?: string;
  /** Required verification level */
  requiredLevel?: 'basic' | 'standard' | 'enhanced';
  /** Claims that must exist in credential */
  requiredClaims?: string[];
  /** Claims to reveal (selective disclosure) */
  revealClaims?: string[];
}

// =============================================================================
// AML SERVICE
// =============================================================================

/**
 * AML (Anti-Money Laundering) Screening Service
 *
 * Enables AML compliance verification without revealing transaction details
 * or user identity. Uses set membership proofs to verify users are not
 * on sanctions lists without revealing which list or the user's identity.
 *
 * @example
 * ```typescript
 * const aml = new AMLScreeningService();
 *
 * // Prove not on sanctions list
 * const result = await aml.proveNotOnSanctionsList(userId, listCommitment);
 *
 * // Verify transaction compliance
 * const txResult = await aml.verifyTransaction(transaction, limits);
 * ```
 */
export class AMLScreeningService {
  private prover: ZKProverService;
  private verifier: ZKVerifierService;
  private merkleService: MerkleTreeService;
  private accumulatorService: AccumulatorService;

  constructor(prover?: ZKProverService, verifier?: ZKVerifierService) {
    this.prover = prover ?? createZKProver();
    this.verifier = verifier ?? createZKVerifier();
    this.merkleService = new MerkleTreeService();
    this.accumulatorService = new AccumulatorService();
    logger.info('AML screening service initialized');
  }

  /**
   * Prove user is not on a sanctions list
   *
   * Uses a privacy-preserving approach where:
   * 1. A "cleared users" set is maintained
   * 2. Users prove membership in the cleared set
   * 3. No information about the sanctions list is revealed
   */
  async proveSanctionsCleared(
    userId: string,
    clearedSetCommitment: string,
    membershipProof: {
      siblings: string[];
      pathIndices: number[];
      leafIndex: number;
    }
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug('Proving sanctions clearance');

      // Generate membership proof for cleared set
      const proof = await this.prover.generateMembershipProof(
        userId,
        clearedSetCommitment,
        {
          leaf: userId,
          root: clearedSetCommitment,
          ...membershipProof,
        }
      );

      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.AML,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.AML },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.AML,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        validUntil: proof.expiresAt,
        attestation: this.generateAttestation('sanctions_clearance', verificationResult),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.AML,
        result: 'error',
      });

      throw new ComplianceError(
        `AML sanctions verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.AML
      );
    }
  }

  /**
   * Verify transaction amount is within limits
   *
   * Proves transaction is below reporting threshold without revealing amount.
   */
  async verifyTransactionCompliance(
    transactionAmount: number,
    dailyTotal: number,
    limits: AMLLimits
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ limits }, 'Verifying transaction compliance');

      const proofResults: VerificationResult[] = [];

      // Prove single transaction is under limit
      const singleTxProof = await this.prover.generateRangeProof(
        transactionAmount,
        0,
        limits.singleTransactionLimit
      );
      const singleTxResult = await this.verifier.verify(singleTxProof);
      proofResults.push(singleTxResult);

      // Prove daily total (including this tx) is under limit
      const dailyTotalWithTx = dailyTotal + transactionAmount;
      const dailyProof = await this.prover.generateRangeProof(
        dailyTotalWithTx,
        0,
        limits.dailyLimit
      );
      const dailyResult = await this.verifier.verify(dailyProof);
      proofResults.push(dailyResult);

      const compliant = proofResults.every(r => r.valid);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.AML,
        result: compliant ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.AML },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.AML,
        compliant,
        proofResults,
        verifiedAt: new Date(),
        attestation: this.generateAttestation('transaction_compliance', {
          valid: compliant,
          circuit: 'aml_transaction',
          verifiedAt: new Date(),
          publicInputs: ['limits_checked'],
        }),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.AML,
        result: 'error',
      });

      throw new ComplianceError(
        `AML transaction verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.AML
      );
    }
  }

  private generateAttestation(verificationType: string, result: VerificationResult): string {
    const attestationData = {
      type: verificationType,
      valid: result.valid,
      verifiedAt: new Date().toISOString(),
    };

    return Buffer.from(JSON.stringify(attestationData)).toString('base64');
  }
}

/**
 * AML transaction limits
 */
export interface AMLLimits {
  /** Single transaction limit */
  singleTransactionLimit: number;
  /** Daily cumulative limit */
  dailyLimit: number;
  /** Monthly limit (optional) */
  monthlyLimit?: number;
}

// =============================================================================
// GDPR SERVICE
// =============================================================================

/**
 * GDPR Compliance Verification Service
 *
 * Enables GDPR-compliant data processing verification:
 * - Data subject identity verification without revealing identity
 * - Consent verification
 * - Right to access/erasure verification
 * - Data minimization proofs
 *
 * @example
 * ```typescript
 * const gdpr = new GDPRComplianceService();
 *
 * // Verify data subject without revealing identity
 * const result = await gdpr.verifyDataSubject(subjectProof);
 *
 * // Verify consent for processing
 * const consentResult = await gdpr.verifyConsent(consentCredential, purpose);
 * ```
 */
export class GDPRComplianceService {
  private prover: ZKProverService;
  private verifier: ZKVerifierService;

  constructor(prover?: ZKProverService, verifier?: ZKVerifierService) {
    this.prover = prover ?? createZKProver();
    this.verifier = verifier ?? createZKVerifier();
    logger.info('GDPR compliance service initialized');
  }

  /**
   * Verify data subject without revealing their identity
   *
   * Proves the requester is the data subject without revealing PII.
   */
  async verifyDataSubject(
    credential: ZKCredential,
    dataSubjectCommitment: string
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug('Verifying data subject');

      // Verify credential proves ownership of data subject identifier
      const disclosure: SelectiveDisclosureRequest = {
        proveExistence: ['dataSubjectId'],
        reveal: [],
        predicates: [],
      };

      const proof = await this.prover.generateCredentialProof(credential, disclosure);
      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.GDPR,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.GDPR },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.GDPR,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        attestation: this.generateAttestation('data_subject_verification', verificationResult),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.GDPR,
        result: 'error',
      });

      throw new ComplianceError(
        `GDPR data subject verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.GDPR
      );
    }
  }

  /**
   * Verify consent for data processing
   *
   * Proves valid consent exists for a specific processing purpose.
   */
  async verifyConsent(
    consentCredential: ZKCredential,
    purpose: string,
    requirements: GDPRConsentRequirements
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ purpose }, 'Verifying consent');

      // Check consent credential structure
      if (consentCredential.type !== 'ConsentCredential') {
        return this.createFailedResult('Invalid consent credential type');
      }

      // Verify consent is not expired
      if (consentCredential.expiresAt && consentCredential.expiresAt.getTime() < Date.now()) {
        return this.createFailedResult('Consent has expired');
      }

      // Build disclosure to prove consent for purpose
      const disclosure: SelectiveDisclosureRequest = {
        proveExistence: ['consentGiven', 'purposes'],
        reveal: [],
        predicates: [
          {
            claim: 'purposes',
            operator: 'in',
            value: [purpose],
          },
        ],
      };

      // Add jurisdiction check if required
      if (requirements.requiredJurisdiction) {
        disclosure.predicates.push({
          claim: 'jurisdiction',
          operator: 'eq',
          value: requirements.requiredJurisdiction,
        });
      }

      const proof = await this.prover.generateCredentialProof(consentCredential, disclosure);
      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.GDPR,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.GDPR },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.GDPR,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        validUntil: consentCredential.expiresAt,
        attestation: this.generateAttestation('consent_verification', verificationResult),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.GDPR,
        result: 'error',
      });

      throw new ComplianceError(
        `GDPR consent verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.GDPR
      );
    }
  }

  /**
   * Verify right to erasure request
   */
  async verifyErasureRequest(
    credential: ZKCredential,
    dataSubjectCommitment: string
  ): Promise<ComplianceVerificationResult> {
    // First verify data subject
    const subjectResult = await this.verifyDataSubject(credential, dataSubjectCommitment);

    if (!subjectResult.compliant) {
      return subjectResult;
    }

    // Additional verification that requester has right to erasure
    const disclosure: SelectiveDisclosureRequest = {
      proveExistence: ['dataSubjectId', 'erasureRight'],
      reveal: [],
      predicates: [],
    };

    const proof = await this.prover.generateCredentialProof(credential, disclosure);
    const verificationResult = await this.verifier.verify(proof);

    return {
      verificationType: ComplianceVerificationType.GDPR,
      compliant: verificationResult.valid,
      proofResults: [...subjectResult.proofResults, verificationResult],
      verifiedAt: new Date(),
      attestation: this.generateAttestation('erasure_request_verification', verificationResult),
    };
  }

  private generateAttestation(verificationType: string, result: VerificationResult): string {
    const attestationData = {
      type: verificationType,
      valid: result.valid,
      verifiedAt: new Date().toISOString(),
    };

    return Buffer.from(JSON.stringify(attestationData)).toString('base64');
  }

  private createFailedResult(reason: string): ComplianceVerificationResult {
    return {
      verificationType: ComplianceVerificationType.GDPR,
      compliant: false,
      proofResults: [{
        valid: false,
        circuit: 'none',
        verifiedAt: new Date(),
        publicInputs: [],
        error: reason,
      }],
      verifiedAt: new Date(),
    };
  }
}

/**
 * GDPR consent requirements
 */
export interface GDPRConsentRequirements {
  /** Required jurisdiction (e.g., 'EU') */
  requiredJurisdiction?: string;
  /** Minimum consent age */
  minConsentAge?: number;
  /** Whether explicit consent is required */
  explicitConsentRequired?: boolean;
}

// =============================================================================
// PCI-DSS SERVICE
// =============================================================================

/**
 * PCI-DSS Cardholder Verification Service
 *
 * Enables PCI-DSS compliant cardholder verification without exposing card data:
 * - Verify card ownership without revealing card number
 * - Verify transaction authorization
 * - Prove cardholder identity
 *
 * @example
 * ```typescript
 * const pci = new PCIDSSVerificationService();
 *
 * // Verify cardholder without revealing PAN
 * const result = await pci.verifyCardholder(credential, merchantId);
 * ```
 */
export class PCIDSSVerificationService {
  private prover: ZKProverService;
  private verifier: ZKVerifierService;

  constructor(prover?: ZKProverService, verifier?: ZKVerifierService) {
    this.prover = prover ?? createZKProver();
    this.verifier = verifier ?? createZKVerifier();
    logger.info('PCI-DSS verification service initialized');
  }

  /**
   * Verify cardholder without revealing card number
   *
   * Proves:
   * 1. Possession of a valid card issued by a trusted issuer
   * 2. Card is not expired
   * 3. Card matches the cardholder (optional additional verification)
   */
  async verifyCardholder(
    cardCredential: ZKCredential,
    merchantId: string
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ merchantId }, 'Verifying cardholder');

      // Check credential type
      if (cardCredential.type !== 'CardCredential') {
        return this.createFailedResult('Invalid card credential type');
      }

      // Check not expired
      if (cardCredential.expiresAt && cardCredential.expiresAt.getTime() < Date.now()) {
        return this.createFailedResult('Card has expired');
      }

      // Build selective disclosure - prove card ownership without revealing PAN
      const disclosure: SelectiveDisclosureRequest = {
        proveExistence: ['panHash', 'cardholderName', 'expiryDate'],
        reveal: [], // Don't reveal any actual data
        predicates: [
          {
            claim: 'cardStatus',
            operator: 'eq',
            value: 'active',
          },
        ],
      };

      const proof = await this.prover.generateCredentialProof(cardCredential, disclosure);
      const verificationResult = await this.verifier.verify(proof);

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.PCI_DSS,
        result: verificationResult.valid ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.PCI_DSS },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.PCI_DSS,
        compliant: verificationResult.valid,
        proofResults: [verificationResult],
        verifiedAt: new Date(),
        attestation: this.generateAttestation('cardholder_verification', verificationResult, merchantId),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.PCI_DSS,
        result: 'error',
      });

      throw new ComplianceError(
        `PCI-DSS cardholder verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.PCI_DSS
      );
    }
  }

  /**
   * Verify card BIN is in allowed range
   *
   * Proves card is from an accepted network/issuer without revealing full PAN.
   */
  async verifyCardBINRange(
    cardCredential: ZKCredential,
    allowedBINRanges: BINRange[]
  ): Promise<ComplianceVerificationResult> {
    const startTime = performance.now();

    try {
      logger.debug({ rangeCount: allowedBINRanges.length }, 'Verifying card BIN range');

      // Get BIN from credential (first 6 digits)
      const bin = cardCredential.claims['bin'] as number | undefined;
      if (bin === undefined) {
        return this.createFailedResult('Card credential missing BIN');
      }

      // Generate range proofs for each allowed range
      const proofResults: VerificationResult[] = [];
      let binInRange = false;

      for (const range of allowedBINRanges) {
        try {
          const proof = await this.prover.generateRangeProof(
            bin,
            range.start,
            range.end
          );
          const result = await this.verifier.verify(proof);
          proofResults.push(result);

          if (result.valid) {
            binInRange = true;
            break; // Found a matching range
          }
        } catch {
          // BIN not in this range, continue checking
        }
      }

      const durationMs = performance.now() - startTime;
      complianceVerifications.inc({
        type: ComplianceVerificationType.PCI_DSS,
        result: binInRange ? 'success' : 'failure',
      });
      complianceVerificationDuration.observe(
        { type: ComplianceVerificationType.PCI_DSS },
        durationMs / 1000
      );

      const result: ComplianceVerificationResult = {
        verificationType: ComplianceVerificationType.PCI_DSS,
        compliant: binInRange,
        proofResults,
        verifiedAt: new Date(),
        attestation: this.generateAttestation('bin_verification', {
          valid: binInRange,
          circuit: 'range_proof',
          verifiedAt: new Date(),
          publicInputs: ['bin_in_range'],
        }),
      };

      complianceVerificationResultSchema.parse(result);
      return result;

    } catch (error) {
      complianceVerifications.inc({
        type: ComplianceVerificationType.PCI_DSS,
        result: 'error',
      });

      throw new ComplianceError(
        `PCI-DSS BIN verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ComplianceVerificationType.PCI_DSS
      );
    }
  }

  private generateAttestation(
    verificationType: string,
    result: VerificationResult,
    merchantId?: string
  ): string {
    const attestationData = {
      type: verificationType,
      valid: result.valid,
      verifiedAt: new Date().toISOString(),
      merchantId,
    };

    return Buffer.from(JSON.stringify(attestationData)).toString('base64');
  }

  private createFailedResult(reason: string): ComplianceVerificationResult {
    return {
      verificationType: ComplianceVerificationType.PCI_DSS,
      compliant: false,
      proofResults: [{
        valid: false,
        circuit: 'none',
        verifiedAt: new Date(),
        publicInputs: [],
        error: reason,
      }],
      verifiedAt: new Date(),
    };
  }
}

/**
 * BIN (Bank Identification Number) range
 */
export interface BINRange {
  /** Start of range (inclusive) */
  start: number;
  /** End of range (inclusive) */
  end: number;
  /** Network name (e.g., 'Visa', 'Mastercard') */
  network?: string;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a compliance verification service for the specified type
 */
export function createComplianceService(
  type: ComplianceVerificationType,
  prover?: ZKProverService,
  verifier?: ZKVerifierService
): KYCVerificationService | AMLScreeningService | GDPRComplianceService | PCIDSSVerificationService {
  switch (type) {
    case ComplianceVerificationType.KYC:
      return new KYCVerificationService(prover, verifier);
    case ComplianceVerificationType.AML:
      return new AMLScreeningService(prover, verifier);
    case ComplianceVerificationType.GDPR:
      return new GDPRComplianceService(prover, verifier);
    case ComplianceVerificationType.PCI_DSS:
      return new PCIDSSVerificationService(prover, verifier);
    default:
      throw new ComplianceError(`Unsupported compliance type: ${type}`, type);
  }
}
