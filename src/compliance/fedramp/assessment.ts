/**
 * FedRAMP Assessment Support
 *
 * Provides support for FedRAMP assessments including:
 * - 3PAO assessment preparation
 * - SAR (Security Assessment Report) tracking
 * - Finding remediation
 * - Authorization package generation
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import type { ImplementationStatus, FindingSeverity } from '../types.js';

const logger = createLogger({ component: 'fedramp-assessment' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Assessment types
 */
export const ASSESSMENT_TYPES = [
  'initial',
  'annual',
  'significant-change',
  'periodic',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/**
 * Assessment status
 */
export const ASSESSMENT_STATUSES = [
  'planning',
  'document-review',
  'testing',
  'reporting',
  'remediation',
  'complete',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/**
 * Finding status
 */
export const FINDING_STATUSES = [
  'open',
  'in-remediation',
  'remediated',
  'verified-closed',
  'risk-accepted',
  'false-positive',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Finding risk level
 */
export const FINDING_RISK_LEVELS = ['high', 'moderate', 'low'] as const;
export type FindingRiskLevel = (typeof FINDING_RISK_LEVELS)[number];

/**
 * Authorization package document types
 */
export const PACKAGE_DOCUMENT_TYPES = [
  'ssp',
  'sap',
  'sar',
  'poam',
  'ato-letter',
  'boundary-diagram',
  'data-flow-diagram',
  'network-diagram',
  'incident-response-plan',
  'contingency-plan',
  'configuration-management-plan',
  'continuous-monitoring-plan',
  'privacy-impact-assessment',
  'rules-of-behavior',
  'user-guide',
  'policy',
  'procedure',
  'interconnection-agreement',
  'penetration-test-report',
  'scan-report',
  'other',
] as const;
export type PackageDocumentType = (typeof PACKAGE_DOCUMENT_TYPES)[number];

/**
 * 3PAO organization information
 */
export interface ThirdPartyAssessor {
  /** Organization name */
  name: string;
  /** A2LA accreditation number */
  a2laNumber: string;
  /** Accreditation expiration date */
  accreditationExpiration: Date;
  /** Lead assessor name */
  leadAssessor: string;
  /** Lead assessor email */
  leadAssessorEmail: string;
  /** Lead assessor phone */
  leadAssessorPhone: string;
  /** Assessment team members */
  teamMembers: Array<{
    name: string;
    role: string;
    certifications: string[];
  }>;
  /** Contract number */
  contractNumber?: string;
  /** Contract expiration */
  contractExpiration?: Date;
}

/**
 * Assessment finding
 */
export interface AssessmentFinding {
  /** Unique identifier */
  id: string;
  /** Finding number (e.g., F-001) */
  findingNumber: string;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Affected control(s) */
  controlIds: string[];
  /** Risk level */
  riskLevel: FindingRiskLevel;
  /** Original risk rating (before remediation consideration) */
  originalRiskRating?: string;
  /** Adjusted risk rating (after remediation consideration) */
  adjustedRiskRating?: string;
  /** Status */
  status: FindingStatus;
  /** Finding type */
  findingType: 'control-gap' | 'documentation' | 'technical' | 'operational' | 'policy';
  /** Identified date */
  identifiedDate: Date;
  /** Identified by */
  identifiedBy: string;
  /** Test method used */
  testMethod: 'interview' | 'examine' | 'test' | 'combination';
  /** Evidence references */
  evidenceReferences: string[];
  /** Recommendation from assessor */
  assessorRecommendation: string;
  /** CSP response */
  cspResponse?: string;
  /** Remediation plan */
  remediationPlan?: string;
  /** Planned remediation date */
  plannedRemediationDate?: Date;
  /** Actual remediation date */
  actualRemediationDate?: Date;
  /** Verification date */
  verificationDate?: Date;
  /** Verified by */
  verifiedBy?: string;
  /** Verification evidence */
  verificationEvidence?: string[];
  /** Associated POA&M ID */
  poamId?: string;
  /** Deviation request ID (if applicable) */
  deviationRequestId?: string;
}

export const assessmentFindingSchema = z.object({
  id: z.string().min(1),
  findingNumber: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  controlIds: z.array(z.string()),
  riskLevel: z.enum(FINDING_RISK_LEVELS),
  originalRiskRating: z.string().optional(),
  adjustedRiskRating: z.string().optional(),
  status: z.enum(FINDING_STATUSES),
  findingType: z.enum(['control-gap', 'documentation', 'technical', 'operational', 'policy']),
  identifiedDate: z.coerce.date(),
  identifiedBy: z.string().min(1),
  testMethod: z.enum(['interview', 'examine', 'test', 'combination']),
  evidenceReferences: z.array(z.string()),
  assessorRecommendation: z.string().min(1),
  cspResponse: z.string().optional(),
  remediationPlan: z.string().optional(),
  plannedRemediationDate: z.coerce.date().optional(),
  actualRemediationDate: z.coerce.date().optional(),
  verificationDate: z.coerce.date().optional(),
  verifiedBy: z.string().optional(),
  verificationEvidence: z.array(z.string()).optional(),
  poamId: z.string().optional(),
  deviationRequestId: z.string().optional(),
});

/**
 * Control test result
 */
export interface ControlTestResult {
  /** Control ID */
  controlId: string;
  /** Control name */
  controlName: string;
  /** Test status */
  status: 'pass' | 'fail' | 'partial' | 'not-tested' | 'not-applicable';
  /** Test method */
  testMethod: 'interview' | 'examine' | 'test' | 'combination';
  /** Tester name */
  testerName: string;
  /** Test date */
  testDate: Date;
  /** Evidence collected */
  evidenceCollected: string[];
  /** Notes */
  notes?: string;
  /** Findings (if any) */
  findingIds: string[];
  /** Interview participants (if applicable) */
  interviewParticipants?: string[];
  /** Documents examined (if applicable) */
  documentsExamined?: string[];
  /** Systems tested (if applicable) */
  systemsTested?: string[];
}

export const controlTestResultSchema = z.object({
  controlId: z.string().min(1),
  controlName: z.string().min(1),
  status: z.enum(['pass', 'fail', 'partial', 'not-tested', 'not-applicable']),
  testMethod: z.enum(['interview', 'examine', 'test', 'combination']),
  testerName: z.string().min(1),
  testDate: z.coerce.date(),
  evidenceCollected: z.array(z.string()),
  notes: z.string().optional(),
  findingIds: z.array(z.string()),
  interviewParticipants: z.array(z.string()).optional(),
  documentsExamined: z.array(z.string()).optional(),
  systemsTested: z.array(z.string()).optional(),
});

/**
 * Security Assessment Report (SAR)
 */
export interface SecurityAssessmentReport {
  /** Unique identifier */
  id: string;
  /** SAR version */
  version: string;
  /** System name */
  systemName: string;
  /** Assessment type */
  assessmentType: AssessmentType;
  /** Assessment status */
  status: AssessmentStatus;
  /** 3PAO information */
  assessor: ThirdPartyAssessor;
  /** Assessment period */
  assessmentPeriod: {
    start: Date;
    end: Date;
  };
  /** SAP (Security Assessment Plan) reference */
  sapReference: string;
  /** Scope description */
  scopeDescription: string;
  /** Controls in scope */
  controlsInScope: string[];
  /** Controls tested */
  controlsTested: number;
  /** Control test results */
  testResults: ControlTestResult[];
  /** Findings */
  findings: AssessmentFinding[];
  /** Finding summary */
  findingSummary: {
    total: number;
    high: number;
    moderate: number;
    low: number;
    remediated: number;
    open: number;
  };
  /** Risk assessment summary */
  riskAssessmentSummary: string;
  /** Security recommendation */
  securityRecommendation: 'authorize' | 'authorize-with-conditions' | 'deny';
  /** Conditions (if authorize-with-conditions) */
  authorizationConditions?: string[];
  /** Created date */
  createdDate: Date;
  /** Last updated */
  lastUpdated: Date;
  /** Approved date */
  approvedDate?: Date;
  /** Approved by */
  approvedBy?: string;
}

/**
 * Authorization package document
 */
export interface PackageDocument {
  /** Unique identifier */
  id: string;
  /** Document type */
  type: PackageDocumentType;
  /** Document name */
  name: string;
  /** Version */
  version: string;
  /** Description */
  description: string;
  /** File reference */
  fileReference: string;
  /** File hash (for integrity) */
  fileHash: string;
  /** Hash algorithm */
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  /** Status */
  status: 'draft' | 'review' | 'approved' | 'superseded';
  /** Owner */
  owner: string;
  /** Created date */
  createdDate: Date;
  /** Last updated */
  lastUpdated: Date;
  /** Reviewed by */
  reviewedBy?: string;
  /** Review date */
  reviewDate?: Date;
  /** Approved by */
  approvedBy?: string;
  /** Approval date */
  approvalDate?: Date;
  /** Expiration date (if applicable) */
  expirationDate?: Date;
  /** Related control IDs */
  relatedControls?: string[];
  /** Change history */
  changeHistory: Array<{
    version: string;
    date: Date;
    author: string;
    description: string;
  }>;
}

export const packageDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PACKAGE_DOCUMENT_TYPES),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  fileReference: z.string().min(1),
  fileHash: z.string().min(1),
  hashAlgorithm: z.enum(['sha256', 'sha384', 'sha512']),
  status: z.enum(['draft', 'review', 'approved', 'superseded']),
  owner: z.string().min(1),
  createdDate: z.coerce.date(),
  lastUpdated: z.coerce.date(),
  reviewedBy: z.string().optional(),
  reviewDate: z.coerce.date().optional(),
  approvedBy: z.string().optional(),
  approvalDate: z.coerce.date().optional(),
  expirationDate: z.coerce.date().optional(),
  relatedControls: z.array(z.string()).optional(),
  changeHistory: z.array(
    z.object({
      version: z.string().min(1),
      date: z.coerce.date(),
      author: z.string().min(1),
      description: z.string().min(1),
    })
  ),
});

/**
 * Assessment preparation checklist item
 */
export interface PreparationChecklistItem {
  /** Unique identifier */
  id: string;
  /** Category */
  category: string;
  /** Item description */
  description: string;
  /** Is required */
  required: boolean;
  /** Status */
  status: 'not-started' | 'in-progress' | 'complete' | 'not-applicable';
  /** Assigned to */
  assignedTo?: string;
  /** Due date */
  dueDate?: Date;
  /** Completion date */
  completedDate?: Date;
  /** Notes */
  notes?: string;
  /** Evidence/artifacts */
  artifacts?: string[];
}

/**
 * Assessment configuration
 */
export interface AssessmentConfig {
  /** System name */
  systemName: string;
  /** Organization name */
  organizationName: string;
  /** FedRAMP package ID */
  fedrampPackageId?: string;
  /** Authorization level */
  authorizationLevel: 'low' | 'moderate' | 'high';
  /** ISSO contact */
  isso: { name: string; email: string };
  /** System owner */
  systemOwner: { name: string; email: string };
}

// =============================================================================
// ASSESSMENT SERVICE
// =============================================================================

/**
 * FedRAMP Assessment Support Service
 */
export class AssessmentService {
  private config: AssessmentConfig;
  private sars: Map<string, SecurityAssessmentReport>;
  private findings: Map<string, AssessmentFinding>;
  private documents: Map<string, PackageDocument>;
  private checklists: Map<string, PreparationChecklistItem[]>;
  private findingCounter: number;

  constructor(config: AssessmentConfig) {
    this.config = config;
    this.sars = new Map();
    this.findings = new Map();
    this.documents = new Map();
    this.checklists = new Map();
    this.findingCounter = 0;

    logger.info(
      { systemName: config.systemName },
      'Assessment service initialized'
    );
  }

  // ===========================================================================
  // SAR MANAGEMENT
  // ===========================================================================

  /**
   * Create a new SAR
   */
  createSAR(
    sar: Omit<SecurityAssessmentReport, 'id' | 'findings' | 'testResults' | 'findingSummary' | 'createdDate' | 'lastUpdated'>
  ): SecurityAssessmentReport {
    const id = `SAR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const newSar: SecurityAssessmentReport = {
      ...sar,
      id,
      findings: [],
      testResults: [],
      findingSummary: {
        total: 0,
        high: 0,
        moderate: 0,
        low: 0,
        remediated: 0,
        open: 0,
      },
      createdDate: new Date(),
      lastUpdated: new Date(),
    };

    this.sars.set(id, newSar);

    // Create default preparation checklist
    this.createPreparationChecklist(id);

    logger.info(
      { sarId: id, assessmentType: sar.assessmentType },
      'Security Assessment Report created'
    );

    return newSar;
  }

  /**
   * Update SAR status
   */
  updateSARStatus(sarId: string, status: AssessmentStatus): SecurityAssessmentReport {
    const sar = this.sars.get(sarId);
    if (!sar) {
      throw new Error(`SAR not found: ${sarId}`);
    }

    sar.status = status;
    sar.lastUpdated = new Date();
    this.sars.set(sarId, sar);

    logger.info({ sarId, status }, 'SAR status updated');

    return sar;
  }

  /**
   * Add control test result
   */
  addTestResult(sarId: string, result: ControlTestResult): void {
    const sar = this.sars.get(sarId);
    if (!sar) {
      throw new Error(`SAR not found: ${sarId}`);
    }

    controlTestResultSchema.parse(result);

    // Check if result for this control already exists
    const existingIndex = sar.testResults.findIndex((r) => r.controlId === result.controlId);
    if (existingIndex >= 0) {
      sar.testResults[existingIndex] = result;
    } else {
      sar.testResults.push(result);
      sar.controlsTested++;
    }

    sar.lastUpdated = new Date();
    this.sars.set(sarId, sar);

    logger.debug({ sarId, controlId: result.controlId, status: result.status }, 'Test result added');
  }

  /**
   * Get SAR by ID
   */
  getSAR(id: string): SecurityAssessmentReport | undefined {
    return this.sars.get(id);
  }

  /**
   * Get all SARs
   */
  getAllSARs(filter?: {
    status?: AssessmentStatus;
    assessmentType?: AssessmentType;
  }): SecurityAssessmentReport[] {
    let sars = Array.from(this.sars.values());

    if (filter?.status) {
      sars = sars.filter((s) => s.status === filter.status);
    }
    if (filter?.assessmentType) {
      sars = sars.filter((s) => s.assessmentType === filter.assessmentType);
    }

    return sars.sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
  }

  // ===========================================================================
  // FINDING MANAGEMENT
  // ===========================================================================

  /**
   * Add a finding
   */
  addFinding(sarId: string, finding: Omit<AssessmentFinding, 'id' | 'findingNumber'>): AssessmentFinding {
    const sar = this.sars.get(sarId);
    if (!sar) {
      throw new Error(`SAR not found: ${sarId}`);
    }

    this.findingCounter++;
    const id = randomUUID();
    const findingNumber = `F-${String(this.findingCounter).padStart(3, '0')}`;

    const newFinding: AssessmentFinding = {
      ...finding,
      id,
      findingNumber,
    };

    assessmentFindingSchema.parse(newFinding);
    this.findings.set(id, newFinding);
    sar.findings.push(newFinding);

    // Update summary
    this.updateFindingSummary(sar);
    sar.lastUpdated = new Date();
    this.sars.set(sarId, sar);

    logger.info(
      { sarId, findingId: id, findingNumber, riskLevel: finding.riskLevel },
      'Assessment finding added'
    );

    return newFinding;
  }

  /**
   * Update finding status
   */
  updateFindingStatus(
    findingId: string,
    status: FindingStatus,
    details?: {
      remediationPlan?: string;
      plannedRemediationDate?: Date;
      actualRemediationDate?: Date;
      cspResponse?: string;
    }
  ): AssessmentFinding {
    const finding = this.findings.get(findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${findingId}`);
    }

    finding.status = status;
    if (details?.remediationPlan) finding.remediationPlan = details.remediationPlan;
    if (details?.plannedRemediationDate) finding.plannedRemediationDate = details.plannedRemediationDate;
    if (details?.actualRemediationDate) finding.actualRemediationDate = details.actualRemediationDate;
    if (details?.cspResponse) finding.cspResponse = details.cspResponse;

    this.findings.set(findingId, finding);

    // Update SAR finding summary
    for (const [sarId, sar] of Array.from(this.sars.entries())) {
      const sarFinding = sar.findings.find((f) => f.id === findingId);
      if (sarFinding) {
        Object.assign(sarFinding, finding);
        this.updateFindingSummary(sar);
        sar.lastUpdated = new Date();
        this.sars.set(sarId, sar);
        break;
      }
    }

    logger.info({ findingId, status }, 'Finding status updated');

    return finding;
  }

  /**
   * Verify finding remediation
   */
  verifyRemediation(
    findingId: string,
    verifiedBy: string,
    verificationEvidence: string[]
  ): AssessmentFinding {
    const finding = this.findings.get(findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${findingId}`);
    }

    finding.status = 'verified-closed';
    finding.verificationDate = new Date();
    finding.verifiedBy = verifiedBy;
    finding.verificationEvidence = verificationEvidence;

    this.findings.set(findingId, finding);

    // Update in SAR
    for (const [sarId, sar] of Array.from(this.sars.entries())) {
      const sarFinding = sar.findings.find((f) => f.id === findingId);
      if (sarFinding) {
        Object.assign(sarFinding, finding);
        this.updateFindingSummary(sar);
        sar.lastUpdated = new Date();
        this.sars.set(sarId, sar);
        break;
      }
    }

    logger.info({ findingId, verifiedBy }, 'Finding remediation verified');

    return finding;
  }

  /**
   * Update finding summary for SAR
   */
  private updateFindingSummary(sar: SecurityAssessmentReport): void {
    const summary = {
      total: sar.findings.length,
      high: sar.findings.filter((f) => f.riskLevel === 'high').length,
      moderate: sar.findings.filter((f) => f.riskLevel === 'moderate').length,
      low: sar.findings.filter((f) => f.riskLevel === 'low').length,
      remediated: sar.findings.filter((f) =>
        ['remediated', 'verified-closed'].includes(f.status)
      ).length,
      open: sar.findings.filter((f) => ['open', 'in-remediation'].includes(f.status)).length,
    };
    sar.findingSummary = summary;
  }

  /**
   * Get all findings
   */
  getAllFindings(filter?: {
    status?: FindingStatus;
    riskLevel?: FindingRiskLevel;
    controlId?: string;
  }): AssessmentFinding[] {
    let findings = Array.from(this.findings.values());

    if (filter?.status) {
      findings = findings.filter((f) => f.status === filter.status);
    }
    if (filter?.riskLevel) {
      findings = findings.filter((f) => f.riskLevel === filter.riskLevel);
    }
    if (filter?.controlId) {
      findings = findings.filter((f) => f.controlIds.includes(filter.controlId!));
    }

    return findings;
  }

  /**
   * Get open findings
   */
  getOpenFindings(): AssessmentFinding[] {
    return this.getAllFindings().filter((f) => ['open', 'in-remediation'].includes(f.status));
  }

  // ===========================================================================
  // DOCUMENT MANAGEMENT
  // ===========================================================================

  /**
   * Add package document
   */
  addDocument(document: Omit<PackageDocument, 'id' | 'changeHistory'>): PackageDocument {
    const id = `DOC-${randomUUID().slice(0, 8).toUpperCase()}`;

    const newDocument: PackageDocument = {
      ...document,
      id,
      changeHistory: [
        {
          version: document.version,
          date: document.createdDate,
          author: document.owner,
          description: 'Initial version',
        },
      ],
    };

    packageDocumentSchema.parse(newDocument);
    this.documents.set(id, newDocument);

    logger.info(
      { documentId: id, type: document.type, name: document.name },
      'Package document added'
    );

    return newDocument;
  }

  /**
   * Update document
   */
  updateDocument(
    documentId: string,
    updates: Partial<PackageDocument>,
    changeDescription: string,
    updatedBy: string
  ): PackageDocument {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const previousVersion = document.version;
    Object.assign(document, updates);
    document.lastUpdated = new Date();

    if (updates.version && updates.version !== previousVersion) {
      document.changeHistory.push({
        version: updates.version,
        date: new Date(),
        author: updatedBy,
        description: changeDescription,
      });
    }

    this.documents.set(documentId, document);

    logger.info({ documentId, version: document.version }, 'Document updated');

    return document;
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): PackageDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Get all documents
   */
  getAllDocuments(filter?: {
    type?: PackageDocumentType;
    status?: PackageDocument['status'];
  }): PackageDocument[] {
    let documents = Array.from(this.documents.values());

    if (filter?.type) {
      documents = documents.filter((d) => d.type === filter.type);
    }
    if (filter?.status) {
      documents = documents.filter((d) => d.status === filter.status);
    }

    return documents;
  }

  /**
   * Get required documents for authorization package
   */
  getRequiredDocuments(): Array<{ type: PackageDocumentType; status: 'present' | 'missing' | 'expired' }> {
    const requiredTypes: PackageDocumentType[] = [
      'ssp',
      'sap',
      'sar',
      'poam',
      'boundary-diagram',
      'data-flow-diagram',
      'network-diagram',
      'incident-response-plan',
      'contingency-plan',
      'configuration-management-plan',
      'continuous-monitoring-plan',
      'rules-of-behavior',
    ];

    const now = new Date();

    return requiredTypes.map((type) => {
      const doc = Array.from(this.documents.values()).find(
        (d) => d.type === type && d.status === 'approved'
      );

      if (!doc) {
        return { type, status: 'missing' as const };
      }

      if (doc.expirationDate && doc.expirationDate < now) {
        return { type, status: 'expired' as const };
      }

      return { type, status: 'present' as const };
    });
  }

  // ===========================================================================
  // PREPARATION CHECKLIST
  // ===========================================================================

  /**
   * Create preparation checklist for assessment
   */
  createPreparationChecklist(sarId: string): PreparationChecklistItem[] {
    const checklist: PreparationChecklistItem[] = [
      // Documentation
      {
        id: randomUUID(),
        category: 'Documentation',
        description: 'Update System Security Plan (SSP) to current version',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Documentation',
        description: 'Complete all policy and procedure documents',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Documentation',
        description: 'Update network diagrams',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Documentation',
        description: 'Update data flow diagrams',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Documentation',
        description: 'Review and update boundary documentation',
        required: true,
        status: 'not-started',
      },
      // Technical Preparation
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Complete vulnerability scanning of all in-scope systems',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Remediate all critical and high vulnerabilities',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Ensure all systems are patched to current levels',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Verify baseline configurations are applied',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Test incident response procedures',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Technical Preparation',
        description: 'Test contingency/DR procedures',
        required: true,
        status: 'not-started',
      },
      // Logistical Preparation
      {
        id: randomUUID(),
        category: 'Logistical',
        description: 'Schedule kickoff meeting with 3PAO',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Logistical',
        description: 'Identify and schedule interview participants',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Logistical',
        description: 'Prepare assessor access credentials',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Logistical',
        description: 'Reserve conference rooms for onsite testing',
        required: false,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'Logistical',
        description: 'Prepare evidence repository with organized artifacts',
        required: true,
        status: 'not-started',
      },
      // POA&M
      {
        id: randomUUID(),
        category: 'POA&M',
        description: 'Update POA&M with current status of all items',
        required: true,
        status: 'not-started',
      },
      {
        id: randomUUID(),
        category: 'POA&M',
        description: 'Address all overdue POA&M items or document delays',
        required: true,
        status: 'not-started',
      },
    ];

    this.checklists.set(sarId, checklist);

    return checklist;
  }

  /**
   * Update checklist item
   */
  updateChecklistItem(
    sarId: string,
    itemId: string,
    updates: Partial<PreparationChecklistItem>
  ): PreparationChecklistItem {
    const checklist = this.checklists.get(sarId);
    if (!checklist) {
      throw new Error(`Checklist not found for SAR: ${sarId}`);
    }

    const item = checklist.find((i) => i.id === itemId);
    if (!item) {
      throw new Error(`Checklist item not found: ${itemId}`);
    }

    Object.assign(item, updates);

    if (updates.status === 'complete') {
      item.completedDate = new Date();
    }

    this.checklists.set(sarId, checklist);

    return item;
  }

  /**
   * Get checklist
   */
  getChecklist(sarId: string): PreparationChecklistItem[] {
    return this.checklists.get(sarId) || [];
  }

  /**
   * Get checklist progress
   */
  getChecklistProgress(sarId: string): {
    total: number;
    complete: number;
    inProgress: number;
    notStarted: number;
    percentage: number;
  } {
    const checklist = this.checklists.get(sarId) || [];
    const requiredItems = checklist.filter((i) => i.required);

    return {
      total: requiredItems.length,
      complete: requiredItems.filter((i) => i.status === 'complete').length,
      inProgress: requiredItems.filter((i) => i.status === 'in-progress').length,
      notStarted: requiredItems.filter((i) => i.status === 'not-started').length,
      percentage: Math.round(
        (requiredItems.filter((i) => i.status === 'complete').length / requiredItems.length) * 100
      ),
    };
  }

  // ===========================================================================
  // AUTHORIZATION PACKAGE
  // ===========================================================================

  /**
   * Generate authorization package status
   */
  generatePackageStatus(): AuthorizationPackageStatus {
    const requiredDocs = this.getRequiredDocuments();
    const openFindings = this.getOpenFindings();
    const latestSar = Array.from(this.sars.values())
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];

    return {
      generatedDate: new Date(),
      systemName: this.config.systemName,
      authorizationLevel: this.config.authorizationLevel,
      packageReadiness: {
        documentsComplete: requiredDocs.filter((d) => d.status === 'present').length,
        documentsRequired: requiredDocs.length,
        documentsMissing: requiredDocs.filter((d) => d.status === 'missing').map((d) => d.type),
        documentsExpired: requiredDocs.filter((d) => d.status === 'expired').map((d) => d.type),
      },
      assessmentStatus: latestSar
        ? {
            sarId: latestSar.id,
            status: latestSar.status,
            recommendation: latestSar.securityRecommendation,
            totalFindings: latestSar.findingSummary.total,
            openFindings: latestSar.findingSummary.open,
            highFindings: latestSar.findingSummary.high,
          }
        : undefined,
      findingSummary: {
        totalOpen: openFindings.length,
        high: openFindings.filter((f) => f.riskLevel === 'high').length,
        moderate: openFindings.filter((f) => f.riskLevel === 'moderate').length,
        low: openFindings.filter((f) => f.riskLevel === 'low').length,
      },
      readyForAuthorization:
        requiredDocs.every((d) => d.status === 'present') &&
        openFindings.filter((f) => f.riskLevel === 'high').length === 0,
      blockers: this.identifyBlockers(requiredDocs, openFindings),
    };
  }

  /**
   * Identify blockers for authorization
   */
  private identifyBlockers(
    requiredDocs: Array<{ type: PackageDocumentType; status: string }>,
    openFindings: AssessmentFinding[]
  ): string[] {
    const blockers: string[] = [];

    const missingDocs = requiredDocs.filter((d) => d.status === 'missing');
    if (missingDocs.length > 0) {
      blockers.push(`Missing required documents: ${missingDocs.map((d) => d.type).join(', ')}`);
    }

    const expiredDocs = requiredDocs.filter((d) => d.status === 'expired');
    if (expiredDocs.length > 0) {
      blockers.push(`Expired documents: ${expiredDocs.map((d) => d.type).join(', ')}`);
    }

    const highFindings = openFindings.filter((f) => f.riskLevel === 'high');
    if (highFindings.length > 0) {
      blockers.push(`${highFindings.length} unresolved high-risk findings`);
    }

    return blockers;
  }
}

// =============================================================================
// TYPES FOR REPORTS
// =============================================================================

export interface AuthorizationPackageStatus {
  generatedDate: Date;
  systemName: string;
  authorizationLevel: 'low' | 'moderate' | 'high';
  packageReadiness: {
    documentsComplete: number;
    documentsRequired: number;
    documentsMissing: PackageDocumentType[];
    documentsExpired: PackageDocumentType[];
  };
  assessmentStatus?: {
    sarId: string;
    status: AssessmentStatus;
    recommendation: 'authorize' | 'authorize-with-conditions' | 'deny';
    totalFindings: number;
    openFindings: number;
    highFindings: number;
  };
  findingSummary: {
    totalOpen: number;
    high: number;
    moderate: number;
    low: number;
  };
  readyForAuthorization: boolean;
  blockers: string[];
}

// =============================================================================
// EXPORTS
// =============================================================================

export default AssessmentService;
