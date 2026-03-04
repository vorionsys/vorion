/**
 * GDPR Cross-Border Data Transfer Controls
 * Implements Chapter V GDPR compliance for international data transfers
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface DataTransfer {
  id: string;
  sourceCountry: string;
  sourceRegion?: string;
  destinationCountry: string;
  destinationRegion?: string;
  dataCategories: DataCategory[];
  dataSubjectCount?: number;
  volumeBytes?: number;
  recipientName: string;
  recipientType: RecipientType;
  purpose: string;
  legalBasis?: TransferLegalBasis;
  sccModules?: SCCModule[];
  supplementaryMeasures?: SupplementaryMeasure[];
  encryptionLevel?: EncryptionLevel;
  timestamp: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export type DataCategory =
  | 'personal_data'
  | 'special_category'
  | 'health_data'
  | 'biometric_data'
  | 'genetic_data'
  | 'political_opinions'
  | 'religious_beliefs'
  | 'trade_union_membership'
  | 'sexual_orientation'
  | 'criminal_data'
  | 'financial_data'
  | 'location_data'
  | 'communications_data'
  | 'children_data';

export type RecipientType =
  | 'controller'
  | 'processor'
  | 'sub_processor'
  | 'joint_controller'
  | 'international_organization';

export type TransferLegalBasis =
  | 'adequacy_decision'
  | 'standard_contractual_clauses'
  | 'binding_corporate_rules'
  | 'explicit_consent'
  | 'contract_necessity'
  | 'public_interest'
  | 'legal_claims'
  | 'vital_interests'
  | 'public_register';

export type SCCModule =
  | 'module_1_c2c'    // Controller to Controller
  | 'module_2_c2p'    // Controller to Processor
  | 'module_3_p2p'    // Processor to Processor
  | 'module_4_p2c';   // Processor to Controller

export type SupplementaryMeasure =
  | 'encryption_in_transit'
  | 'encryption_at_rest'
  | 'pseudonymization'
  | 'data_minimization'
  | 'access_controls'
  | 'audit_logging'
  | 'contractual_restrictions'
  | 'split_processing'
  | 'zero_knowledge_encryption';

export type EncryptionLevel = 'none' | 'standard' | 'enhanced' | 'zero_knowledge';

export interface TransferDecision {
  allowed: boolean;
  legalBasis?: TransferLegalBasis;
  requiresSCCs: boolean;
  requiredModules?: SCCModule[];
  requiresTIA: boolean;
  requiredSupplementaryMeasures: SupplementaryMeasure[];
  minimumEncryptionLevel: EncryptionLevel;
  warnings: string[];
  blockers: string[];
  expiresAt?: Date;
  conditions?: string[];
}

export interface TransferFilter {
  sourceCountry?: string;
  destinationCountry?: string;
  dataCategories?: DataCategory[];
  recipientName?: string;
  recipientType?: RecipientType;
  legalBasis?: TransferLegalBasis;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface RiskAssessment {
  country: string;
  overallRisk: RiskLevel;
  governmentAccessRisk: RiskLevel;
  legalFrameworkRisk: RiskLevel;
  enforcementRisk: RiskLevel;
  factors: RiskFactor[];
  mitigations: string[];
  recommendedMeasures: SupplementaryMeasure[];
  lastAssessed: Date;
  source?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  category: string;
  description: string;
  severity: RiskLevel;
  mitigatable: boolean;
}

export interface AdequacyDecision {
  country: string;
  countryCode: string;
  status: 'full' | 'partial' | 'pending' | 'expired';
  scope?: string;
  adoptedDate: Date;
  expiresAt?: Date;
  reviewDate?: Date;
  restrictions?: string[];
  notes?: string;
}

export interface SCCTemplate {
  id: string;
  name: string;
  version: string;
  modules: SCCModule[];
  effectiveDate: Date;
  content: string;
  annexes: SCCAnnex[];
  isLatest: boolean;
}

export interface SCCAnnex {
  id: string;
  title: string;
  content: string;
  required: boolean;
}

export interface SCCAgreement {
  id: string;
  templateId: string;
  modules: SCCModule[];
  dataExporter: PartyInfo;
  dataImporter: PartyInfo;
  signedDate?: Date;
  effectiveDate?: Date;
  expiresAt?: Date;
  supplementaryMeasures: SupplementaryMeasure[];
  status: 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated';
  annexData: Record<string, unknown>;
}

export interface PartyInfo {
  name: string;
  address: string;
  country: string;
  contactName: string;
  contactEmail: string;
  role: 'exporter' | 'importer';
  type: RecipientType;
}

export interface TransferImpactAssessment {
  id: string;
  transferId?: string;
  destinationCountry: string;
  dataCategories: DataCategory[];
  recipientType: RecipientType;
  riskAssessment: RiskAssessment;
  dataTypeSensitivity: SensitivityLevel;
  recipientSafeguards: SafeguardEvaluation;
  supplementaryMeasuresAnalysis: MeasuresAnalysis;
  overallConclusion: TIAConclusion;
  completedAt: Date;
  validUntil: Date;
  assessor?: string;
}

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'very_high';

export interface SafeguardEvaluation {
  technicalMeasures: SafeguardDetail[];
  organizationalMeasures: SafeguardDetail[];
  contractualMeasures: SafeguardDetail[];
  overallScore: number; // 0-100
  gaps: string[];
}

export interface SafeguardDetail {
  name: string;
  implemented: boolean;
  effectiveness: 'low' | 'medium' | 'high';
  notes?: string;
}

export interface MeasuresAnalysis {
  required: SupplementaryMeasure[];
  recommended: SupplementaryMeasure[];
  implemented: SupplementaryMeasure[];
  gaps: SupplementaryMeasure[];
  effectivenessScore: number; // 0-100
}

export type TIAConclusion =
  | 'transfer_permitted'
  | 'transfer_permitted_with_measures'
  | 'transfer_requires_review'
  | 'transfer_not_permitted';

export interface DataLocalizationConfig {
  id: string;
  name: string;
  preferredRegions: string[];
  allowedCountries: string[];
  blockedCountries: string[];
  processingLocationRequired?: string;
  storageLocationRequired?: string;
  replicationAllowed: boolean;
  allowedReplicationRegions?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessingLocation {
  id: string;
  country: string;
  region?: string;
  provider?: string;
  dataCenter?: string;
  purpose: 'processing' | 'storage' | 'backup' | 'replication';
  dataCategories: DataCategory[];
  validatedAt?: Date;
  isCompliant: boolean;
}

export interface TransferLogEntry {
  id: string;
  transfer: DataTransfer;
  decision: TransferDecision;
  tiaId?: string;
  sccAgreementId?: string;
  loggedAt: Date;
  loggedBy?: string;
}

export interface SchremsIIAssessment {
  destinationCountry: string;
  governmentAccessRisk: GovernmentAccessRisk;
  requiredEncryption: EncryptionLevel;
  technicalMeasures: SupplementaryMeasure[];
  isHighRisk: boolean;
  canTransfer: boolean;
  conditions: string[];
  assessedAt: Date;
}

export interface GovernmentAccessRisk {
  hasSecurityLaws: boolean;
  lawsDescription?: string;
  surveillanceCapability: RiskLevel;
  judicialOversight: boolean;
  dataAccessFrequency: 'unknown' | 'rare' | 'occasional' | 'frequent';
  challengeMechanisms: boolean;
  overallRisk: RiskLevel;
}

// ============================================================================
// Adequacy Decision Registry
// ============================================================================

export class AdequacyDecisionRegistry {
  private decisions: Map<string, AdequacyDecision> = new Map();
  private lastUpdated: Date = new Date();
  private updateInterval: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initializeDecisions();
  }

  /**
   * Initialize with current EU adequacy decisions (as of 2024)
   */
  private initializeDecisions(): void {
    const adequateCountries: AdequacyDecision[] = [
      {
        country: 'Andorra',
        countryCode: 'AD',
        status: 'full',
        adoptedDate: new Date('2010-10-21'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Argentina',
        countryCode: 'AR',
        status: 'full',
        adoptedDate: new Date('2003-07-30'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Canada',
        countryCode: 'CA',
        status: 'partial',
        scope: 'Commercial organizations under PIPEDA',
        adoptedDate: new Date('2001-12-20'),
        restrictions: ['Applies only to commercial organizations subject to PIPEDA'],
        notes: 'Partial adequacy - commercial organizations only'
      },
      {
        country: 'Faroe Islands',
        countryCode: 'FO',
        status: 'full',
        adoptedDate: new Date('2010-03-05'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Guernsey',
        countryCode: 'GG',
        status: 'full',
        adoptedDate: new Date('2003-11-21'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Israel',
        countryCode: 'IL',
        status: 'full',
        adoptedDate: new Date('2011-01-31'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Isle of Man',
        countryCode: 'IM',
        status: 'full',
        adoptedDate: new Date('2004-04-28'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Japan',
        countryCode: 'JP',
        status: 'full',
        adoptedDate: new Date('2019-01-23'),
        notes: 'Mutual adequacy with EU'
      },
      {
        country: 'Jersey',
        countryCode: 'JE',
        status: 'full',
        adoptedDate: new Date('2008-05-08'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'New Zealand',
        countryCode: 'NZ',
        status: 'full',
        adoptedDate: new Date('2012-12-19'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Republic of Korea',
        countryCode: 'KR',
        status: 'full',
        adoptedDate: new Date('2022-12-17'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'Switzerland',
        countryCode: 'CH',
        status: 'full',
        adoptedDate: new Date('2000-07-26'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'United Kingdom',
        countryCode: 'GB',
        status: 'full',
        adoptedDate: new Date('2021-06-28'),
        expiresAt: new Date('2025-06-27'),
        reviewDate: new Date('2025-06-27'),
        notes: 'Post-Brexit adequacy decision, subject to review'
      },
      {
        country: 'Uruguay',
        countryCode: 'UY',
        status: 'full',
        adoptedDate: new Date('2012-08-21'),
        notes: 'Full adequacy decision'
      },
      {
        country: 'United States',
        countryCode: 'US',
        status: 'partial',
        scope: 'EU-US Data Privacy Framework certified organizations',
        adoptedDate: new Date('2023-07-10'),
        restrictions: ['Only for organizations certified under the EU-US Data Privacy Framework'],
        notes: 'Partial adequacy under EU-US Data Privacy Framework'
      }
    ];

    for (const decision of adequateCountries) {
      this.decisions.set(decision.countryCode, decision);
    }
  }

  /**
   * Check if a country has an adequacy decision
   */
  hasAdequacyDecision(countryCode: string): boolean {
    const decision = this.decisions.get(countryCode.toUpperCase());
    if (!decision) return false;

    if (decision.expiresAt && decision.expiresAt < new Date()) {
      return false;
    }

    return decision.status === 'full' || decision.status === 'partial';
  }

  /**
   * Get adequacy decision for a country
   */
  getDecision(countryCode: string): AdequacyDecision | undefined {
    return this.decisions.get(countryCode.toUpperCase());
  }

  /**
   * Check if adequacy is partial and get restrictions
   */
  isPartialAdequacy(countryCode: string): { isPartial: boolean; restrictions?: string[] } {
    const decision = this.decisions.get(countryCode.toUpperCase());
    if (!decision) {
      return { isPartial: false };
    }

    return {
      isPartial: decision.status === 'partial',
      restrictions: decision.restrictions
    };
  }

  /**
   * Get all countries with adequacy decisions
   */
  getAllAdequateCountries(): AdequacyDecision[] {
    return Array.from(this.decisions.values()).filter(
      d => d.status === 'full' || d.status === 'partial'
    );
  }

  /**
   * Check if registry needs update
   */
  needsUpdate(): boolean {
    return Date.now() - this.lastUpdated.getTime() > this.updateInterval;
  }

  /**
   * Update adequacy decisions (simulated - would call EU API in production)
   */
  async updateDecisions(): Promise<void> {
    // In production, this would fetch from an official EU data source
    // For now, we just update the timestamp
    this.lastUpdated = new Date();
  }

  /**
   * Add or update an adequacy decision
   */
  setDecision(decision: AdequacyDecision): void {
    this.decisions.set(decision.countryCode.toUpperCase(), decision);
  }

  /**
   * Check if a decision is expiring soon
   */
  isExpiringSoon(countryCode: string, daysThreshold: number = 90): boolean {
    const decision = this.decisions.get(countryCode.toUpperCase());
    if (!decision || !decision.expiresAt) return false;

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return decision.expiresAt <= thresholdDate;
  }

  /**
   * Get all expiring decisions
   */
  getExpiringDecisions(daysThreshold: number = 90): AdequacyDecision[] {
    return Array.from(this.decisions.values()).filter(decision => {
      if (!decision.expiresAt) return false;
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
      return decision.expiresAt <= thresholdDate;
    });
  }
}

// ============================================================================
// SCC Manager
// ============================================================================

export class SCCManager {
  private templates: Map<string, SCCTemplate> = new Map();
  private agreements: Map<string, SCCAgreement> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  /**
   * Initialize with EU standard SCC templates
   */
  private initializeTemplates(): void {
    const template2021: SCCTemplate = {
      id: 'scc-2021-eu',
      name: 'EU Standard Contractual Clauses (2021)',
      version: '2021/914',
      modules: ['module_1_c2c', 'module_2_c2p', 'module_3_p2p', 'module_4_p2c'],
      effectiveDate: new Date('2021-06-27'),
      content: 'EU Commission Decision 2021/914 Standard Contractual Clauses',
      annexes: [
        {
          id: 'annex-i',
          title: 'List of Parties',
          content: 'Identification and details of data exporter and importer',
          required: true
        },
        {
          id: 'annex-ii',
          title: 'Technical and Organisational Measures',
          content: 'Description of security measures implemented',
          required: true
        },
        {
          id: 'annex-iii',
          title: 'List of Sub-processors',
          content: 'Sub-processors authorized by the data importer',
          required: false
        }
      ],
      isLatest: true
    };

    this.templates.set(template2021.id, template2021);
  }

  /**
   * Get appropriate SCC modules based on party types
   */
  getRequiredModules(
    exporterType: RecipientType,
    importerType: RecipientType
  ): SCCModule[] {
    const isExporterController = exporterType === 'controller' || exporterType === 'joint_controller';
    const isImporterController = importerType === 'controller' || importerType === 'joint_controller';

    if (isExporterController && isImporterController) {
      return ['module_1_c2c'];
    } else if (isExporterController && !isImporterController) {
      return ['module_2_c2p'];
    } else if (!isExporterController && !isImporterController) {
      return ['module_3_p2p'];
    } else {
      return ['module_4_p2c'];
    }
  }

  /**
   * Get the latest SCC template
   */
  getLatestTemplate(): SCCTemplate | undefined {
    return Array.from(this.templates.values()).find(t => t.isLatest);
  }

  /**
   * Get a specific template by ID
   */
  getTemplate(templateId: string): SCCTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Create a new SCC agreement
   */
  createAgreement(
    dataExporter: PartyInfo,
    dataImporter: PartyInfo,
    supplementaryMeasures: SupplementaryMeasure[] = []
  ): SCCAgreement {
    const template = this.getLatestTemplate();
    if (!template) {
      throw new Error('No SCC template available');
    }

    const modules = this.getRequiredModules(
      dataExporter.type,
      dataImporter.type
    );

    const agreement: SCCAgreement = {
      id: this.generateAgreementId(),
      templateId: template.id,
      modules,
      dataExporter,
      dataImporter,
      supplementaryMeasures,
      status: 'draft',
      annexData: {}
    };

    this.agreements.set(agreement.id, agreement);
    return agreement;
  }

  /**
   * Sign an SCC agreement
   */
  signAgreement(agreementId: string, signedDate: Date = new Date()): SCCAgreement {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    agreement.signedDate = signedDate;
    agreement.effectiveDate = signedDate;
    agreement.status = 'active';

    return agreement;
  }

  /**
   * Get an agreement by ID
   */
  getAgreement(agreementId: string): SCCAgreement | undefined {
    return this.agreements.get(agreementId);
  }

  /**
   * Get all agreements for a party
   */
  getAgreementsForParty(partyName: string): SCCAgreement[] {
    return Array.from(this.agreements.values()).filter(
      a => a.dataExporter.name === partyName || a.dataImporter.name === partyName
    );
  }

  /**
   * Check if there's an active SCC agreement for a transfer
   */
  hasActiveSCCAgreement(
    exporterName: string,
    importerName: string,
    importerCountry: string
  ): SCCAgreement | undefined {
    return Array.from(this.agreements.values()).find(
      a =>
        a.status === 'active' &&
        a.dataExporter.name === exporterName &&
        a.dataImporter.name === importerName &&
        a.dataImporter.country === importerCountry
    );
  }

  /**
   * Update supplementary measures for an agreement
   */
  updateSupplementaryMeasures(
    agreementId: string,
    measures: SupplementaryMeasure[]
  ): SCCAgreement {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    agreement.supplementaryMeasures = measures;
    return agreement;
  }

  /**
   * Terminate an SCC agreement
   */
  terminateAgreement(agreementId: string): void {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    agreement.status = 'terminated';
  }

  /**
   * Get recommended supplementary measures based on destination risk
   */
  getRecommendedSupplementaryMeasures(
    riskLevel: RiskLevel,
    dataCategories: DataCategory[]
  ): SupplementaryMeasure[] {
    const measures: SupplementaryMeasure[] = [];

    // Always recommend basic measures
    measures.push('encryption_in_transit', 'access_controls', 'audit_logging');

    // Add measures based on risk level
    if (riskLevel === 'medium' || riskLevel === 'high' || riskLevel === 'critical') {
      measures.push('encryption_at_rest', 'pseudonymization');
    }

    if (riskLevel === 'high' || riskLevel === 'critical') {
      measures.push('contractual_restrictions', 'data_minimization');
    }

    if (riskLevel === 'critical') {
      measures.push('zero_knowledge_encryption', 'split_processing');
    }

    // Add measures based on sensitive data categories
    const sensitiveCategories: DataCategory[] = [
      'special_category', 'health_data', 'biometric_data', 'genetic_data',
      'political_opinions', 'religious_beliefs', 'criminal_data', 'children_data'
    ];

    const hasSensitiveData = dataCategories.some(c => sensitiveCategories.includes(c));
    if (hasSensitiveData) {
      if (!measures.includes('encryption_at_rest')) measures.push('encryption_at_rest');
      if (!measures.includes('pseudonymization')) measures.push('pseudonymization');
    }

    return measures;
  }

  private generateAgreementId(): string {
    return `scc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Transfer Impact Assessment Service
// ============================================================================

export class TIAService {
  private assessments: Map<string, TransferImpactAssessment> = new Map();
  private countryRisks: Map<string, RiskAssessment> = new Map();

  constructor() {
    this.initializeCountryRisks();
  }

  /**
   * Initialize country risk data based on Schrems II considerations
   */
  private initializeCountryRisks(): void {
    // High-risk countries (example - based on surveillance laws)
    const highRiskCountries: Array<{ code: string; name: string; factors: RiskFactor[] }> = [
      {
        code: 'CN',
        name: 'China',
        factors: [
          {
            category: 'Government Access',
            description: 'Broad government access powers under national security laws',
            severity: 'critical',
            mitigatable: false
          },
          {
            category: 'Legal Framework',
            description: 'Data localization requirements',
            severity: 'high',
            mitigatable: false
          }
        ]
      },
      {
        code: 'RU',
        name: 'Russia',
        factors: [
          {
            category: 'Government Access',
            description: 'Extensive surveillance capabilities',
            severity: 'critical',
            mitigatable: false
          },
          {
            category: 'Data Localization',
            description: 'Strict data localization requirements',
            severity: 'high',
            mitigatable: false
          }
        ]
      }
    ];

    // Medium-risk countries
    const mediumRiskCountries: Array<{ code: string; name: string; factors: RiskFactor[] }> = [
      {
        code: 'IN',
        name: 'India',
        factors: [
          {
            category: 'Legal Framework',
            description: 'Evolving data protection framework',
            severity: 'medium',
            mitigatable: true
          }
        ]
      },
      {
        code: 'BR',
        name: 'Brazil',
        factors: [
          {
            category: 'Legal Framework',
            description: 'LGPD implementation ongoing',
            severity: 'low',
            mitigatable: true
          }
        ]
      }
    ];

    for (const country of highRiskCountries) {
      this.countryRisks.set(country.code, {
        country: country.name,
        overallRisk: 'critical',
        governmentAccessRisk: 'critical',
        legalFrameworkRisk: 'high',
        enforcementRisk: 'high',
        factors: country.factors,
        mitigations: [],
        recommendedMeasures: ['zero_knowledge_encryption', 'split_processing'],
        lastAssessed: new Date()
      });
    }

    for (const country of mediumRiskCountries) {
      this.countryRisks.set(country.code, {
        country: country.name,
        overallRisk: 'medium',
        governmentAccessRisk: 'medium',
        legalFrameworkRisk: 'medium',
        enforcementRisk: 'medium',
        factors: country.factors,
        mitigations: ['Standard SCCs with supplementary measures'],
        recommendedMeasures: ['encryption_in_transit', 'encryption_at_rest', 'pseudonymization'],
        lastAssessed: new Date()
      });
    }
  }

  /**
   * Perform a Transfer Impact Assessment
   */
  performTIA(
    destinationCountry: string,
    dataCategories: DataCategory[],
    recipientType: RecipientType,
    existingSafeguards: SafeguardDetail[] = []
  ): TransferImpactAssessment {
    const riskAssessment = this.assessCountryRisk(destinationCountry);
    const sensitivity = this.assessDataSensitivity(dataCategories);
    const safeguardEval = this.evaluateSafeguards(existingSafeguards);
    const measuresAnalysis = this.analyzeSupplementaryMeasures(
      riskAssessment,
      sensitivity,
      []
    );

    const conclusion = this.determineConclusion(
      riskAssessment,
      sensitivity,
      safeguardEval,
      measuresAnalysis
    );

    const tia: TransferImpactAssessment = {
      id: this.generateTIAId(),
      destinationCountry,
      dataCategories,
      recipientType,
      riskAssessment,
      dataTypeSensitivity: sensitivity,
      recipientSafeguards: safeguardEval,
      supplementaryMeasuresAnalysis: measuresAnalysis,
      overallConclusion: conclusion,
      completedAt: new Date(),
      validUntil: this.calculateValidityPeriod(riskAssessment.overallRisk)
    };

    this.assessments.set(tia.id, tia);
    return tia;
  }

  /**
   * Assess country risk
   */
  assessCountryRisk(countryCode: string): RiskAssessment {
    const existing = this.countryRisks.get(countryCode.toUpperCase());
    if (existing) {
      return existing;
    }

    // Default assessment for countries without specific data
    return {
      country: countryCode,
      overallRisk: 'medium',
      governmentAccessRisk: 'medium',
      legalFrameworkRisk: 'medium',
      enforcementRisk: 'medium',
      factors: [
        {
          category: 'Unknown',
          description: 'Insufficient data for detailed assessment',
          severity: 'medium',
          mitigatable: true
        }
      ],
      mitigations: ['Perform detailed country-specific assessment'],
      recommendedMeasures: ['encryption_in_transit', 'encryption_at_rest', 'access_controls'],
      lastAssessed: new Date()
    };
  }

  /**
   * Assess data sensitivity based on categories
   */
  assessDataSensitivity(categories: DataCategory[]): SensitivityLevel {
    const veryHighCategories: DataCategory[] = [
      'health_data', 'genetic_data', 'biometric_data', 'children_data', 'criminal_data'
    ];

    const highCategories: DataCategory[] = [
      'special_category', 'political_opinions', 'religious_beliefs',
      'trade_union_membership', 'sexual_orientation'
    ];

    const mediumCategories: DataCategory[] = [
      'financial_data', 'location_data', 'communications_data'
    ];

    if (categories.some(c => veryHighCategories.includes(c))) {
      return 'very_high';
    }

    if (categories.some(c => highCategories.includes(c))) {
      return 'high';
    }

    if (categories.some(c => mediumCategories.includes(c))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Evaluate existing safeguards
   */
  evaluateSafeguards(safeguards: SafeguardDetail[]): SafeguardEvaluation {
    const technical = safeguards.filter(s =>
      ['encryption', 'access_control', 'logging', 'backup'].some(t =>
        s.name.toLowerCase().includes(t)
      )
    );

    const organizational = safeguards.filter(s =>
      ['policy', 'training', 'awareness', 'governance'].some(t =>
        s.name.toLowerCase().includes(t)
      )
    );

    const contractual = safeguards.filter(s =>
      ['contract', 'agreement', 'scc', 'dpa'].some(t =>
        s.name.toLowerCase().includes(t)
      )
    );

    const implementedCount = safeguards.filter(s => s.implemented).length;
    const highEffectivenessCount = safeguards.filter(
      s => s.implemented && s.effectiveness === 'high'
    ).length;

    const overallScore = safeguards.length > 0
      ? Math.round((implementedCount / safeguards.length) * 70 +
                   (highEffectivenessCount / Math.max(implementedCount, 1)) * 30)
      : 0;

    const gaps: string[] = [];
    if (technical.length === 0) gaps.push('Missing technical safeguards');
    if (organizational.length === 0) gaps.push('Missing organizational safeguards');
    if (contractual.length === 0) gaps.push('Missing contractual safeguards');

    return {
      technicalMeasures: technical,
      organizationalMeasures: organizational,
      contractualMeasures: contractual,
      overallScore,
      gaps
    };
  }

  /**
   * Analyze supplementary measures
   */
  analyzeSupplementaryMeasures(
    riskAssessment: RiskAssessment,
    sensitivity: SensitivityLevel,
    implemented: SupplementaryMeasure[]
  ): MeasuresAnalysis {
    const required: SupplementaryMeasure[] = ['encryption_in_transit', 'access_controls'];
    const recommended: SupplementaryMeasure[] = [];

    // Add measures based on risk level
    if (riskAssessment.overallRisk === 'high' || riskAssessment.overallRisk === 'critical') {
      required.push('encryption_at_rest', 'pseudonymization');
      recommended.push('zero_knowledge_encryption', 'split_processing');
    } else if (riskAssessment.overallRisk === 'medium') {
      recommended.push('encryption_at_rest', 'pseudonymization');
    }

    // Add measures based on sensitivity
    if (sensitivity === 'very_high' || sensitivity === 'high') {
      if (!required.includes('encryption_at_rest')) required.push('encryption_at_rest');
      if (!required.includes('pseudonymization')) required.push('pseudonymization');
      recommended.push('data_minimization', 'audit_logging');
    }

    const gaps = required.filter(m => !implemented.includes(m));
    const effectivenessScore = required.length > 0
      ? Math.round(((required.length - gaps.length) / required.length) * 100)
      : 100;

    return {
      required,
      recommended,
      implemented,
      gaps,
      effectivenessScore
    };
  }

  /**
   * Determine TIA conclusion
   */
  private determineConclusion(
    riskAssessment: RiskAssessment,
    sensitivity: SensitivityLevel,
    safeguards: SafeguardEvaluation,
    measures: MeasuresAnalysis
  ): TIAConclusion {
    // Critical risk countries with very high sensitivity data
    if (riskAssessment.overallRisk === 'critical' && sensitivity === 'very_high') {
      return 'transfer_not_permitted';
    }

    // Critical risk with insufficient safeguards
    if (riskAssessment.overallRisk === 'critical' && safeguards.overallScore < 80) {
      return 'transfer_not_permitted';
    }

    // High risk or critical risk with good safeguards
    if (riskAssessment.overallRisk === 'high' || riskAssessment.overallRisk === 'critical') {
      if (measures.gaps.length > 0) {
        return 'transfer_requires_review';
      }
      return 'transfer_permitted_with_measures';
    }

    // Medium risk
    if (riskAssessment.overallRisk === 'medium') {
      if (measures.gaps.length > 2) {
        return 'transfer_requires_review';
      }
      return 'transfer_permitted_with_measures';
    }

    // Low risk
    return 'transfer_permitted';
  }

  /**
   * Calculate validity period based on risk
   */
  private calculateValidityPeriod(riskLevel: RiskLevel): Date {
    const validityMonths = {
      low: 24,
      medium: 12,
      high: 6,
      critical: 3
    };

    const months = validityMonths[riskLevel];
    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + months);
    return validUntil;
  }

  /**
   * Get a TIA by ID
   */
  getTIA(tiaId: string): TransferImpactAssessment | undefined {
    return this.assessments.get(tiaId);
  }

  /**
   * Check if a valid TIA exists for a transfer
   */
  hasValidTIA(destinationCountry: string, dataCategories: DataCategory[]): TransferImpactAssessment | undefined {
    const now = new Date();
    return Array.from(this.assessments.values()).find(tia =>
      tia.destinationCountry === destinationCountry &&
      tia.validUntil > now &&
      dataCategories.every(c => tia.dataCategories.includes(c))
    );
  }

  private generateTIAId(): string {
    return `tia-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Schrems II Compliance Service
// ============================================================================

export class SchremsIIService {
  private governmentAccessData: Map<string, GovernmentAccessRisk> = new Map();

  constructor() {
    this.initializeGovernmentAccessData();
  }

  /**
   * Initialize government access risk data
   */
  private initializeGovernmentAccessData(): void {
    // Countries with known surveillance capabilities
    this.governmentAccessData.set('US', {
      hasSecurityLaws: true,
      lawsDescription: 'FISA 702, Executive Order 12333, CLOUD Act',
      surveillanceCapability: 'high',
      judicialOversight: true,
      dataAccessFrequency: 'frequent',
      challengeMechanisms: true,
      overallRisk: 'high'
    });

    this.governmentAccessData.set('CN', {
      hasSecurityLaws: true,
      lawsDescription: 'National Security Law, Cybersecurity Law, Data Security Law',
      surveillanceCapability: 'critical',
      judicialOversight: false,
      dataAccessFrequency: 'frequent',
      challengeMechanisms: false,
      overallRisk: 'critical'
    });

    this.governmentAccessData.set('RU', {
      hasSecurityLaws: true,
      lawsDescription: 'SORM, Yarovaya Law',
      surveillanceCapability: 'critical',
      judicialOversight: false,
      dataAccessFrequency: 'frequent',
      challengeMechanisms: false,
      overallRisk: 'critical'
    });

    // Low risk countries (EU member states)
    const euCountries = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'SE', 'PL', 'IE'];
    for (const country of euCountries) {
      this.governmentAccessData.set(country, {
        hasSecurityLaws: true,
        lawsDescription: 'Subject to GDPR and EU law restrictions',
        surveillanceCapability: 'medium',
        judicialOversight: true,
        dataAccessFrequency: 'rare',
        challengeMechanisms: true,
        overallRisk: 'low'
      });
    }
  }

  /**
   * Perform Schrems II assessment for a destination country
   */
  assessSchremsIICompliance(
    destinationCountry: string,
    dataCategories: DataCategory[]
  ): SchremsIIAssessment {
    const governmentRisk = this.getGovernmentAccessRisk(destinationCountry);
    const isHighRisk = governmentRisk.overallRisk === 'high' ||
                       governmentRisk.overallRisk === 'critical';

    const sensitiveCategories: DataCategory[] = [
      'special_category', 'health_data', 'biometric_data', 'genetic_data',
      'political_opinions', 'religious_beliefs', 'criminal_data'
    ];
    const hasSensitiveData = dataCategories.some(c => sensitiveCategories.includes(c));

    // Determine required encryption level
    let requiredEncryption: EncryptionLevel = 'standard';
    if (isHighRisk && hasSensitiveData) {
      requiredEncryption = 'zero_knowledge';
    } else if (isHighRisk || hasSensitiveData) {
      requiredEncryption = 'enhanced';
    }

    // Determine technical measures
    const technicalMeasures: SupplementaryMeasure[] = [
      'encryption_in_transit',
      'encryption_at_rest',
      'access_controls'
    ];

    if (isHighRisk) {
      technicalMeasures.push('pseudonymization', 'audit_logging');
    }

    if (governmentRisk.overallRisk === 'critical') {
      technicalMeasures.push('zero_knowledge_encryption', 'split_processing');
    }

    // Determine if transfer can proceed
    const canTransfer = governmentRisk.overallRisk !== 'critical' ||
                       (requiredEncryption === 'zero_knowledge');

    // Build conditions
    const conditions: string[] = [];
    if (isHighRisk) {
      conditions.push('Supplementary technical measures required');
      conditions.push('Transfer Impact Assessment must be documented');
    }
    if (requiredEncryption === 'zero_knowledge') {
      conditions.push('Zero-knowledge encryption required - data must be encrypted before transfer with keys not accessible to importer');
    }
    if (!governmentRisk.judicialOversight) {
      conditions.push('Consider alternative transfer mechanisms or data localization');
    }

    return {
      destinationCountry,
      governmentAccessRisk: governmentRisk,
      requiredEncryption,
      technicalMeasures,
      isHighRisk,
      canTransfer,
      conditions,
      assessedAt: new Date()
    };
  }

  /**
   * Get government access risk for a country
   */
  getGovernmentAccessRisk(countryCode: string): GovernmentAccessRisk {
    const existing = this.governmentAccessData.get(countryCode.toUpperCase());
    if (existing) {
      return existing;
    }

    // Default for unknown countries
    return {
      hasSecurityLaws: true,
      surveillanceCapability: 'medium',
      judicialOversight: true,
      dataAccessFrequency: 'unknown',
      challengeMechanisms: true,
      overallRisk: 'medium'
    };
  }

  /**
   * Check if enhanced encryption is required
   */
  requiresEnhancedEncryption(countryCode: string): boolean {
    const risk = this.getGovernmentAccessRisk(countryCode);
    return risk.overallRisk === 'high' || risk.overallRisk === 'critical';
  }

  /**
   * Get minimum encryption level for a transfer
   */
  getMinimumEncryptionLevel(
    countryCode: string,
    dataCategories: DataCategory[]
  ): EncryptionLevel {
    const assessment = this.assessSchremsIICompliance(countryCode, dataCategories);
    return assessment.requiredEncryption;
  }
}

// ============================================================================
// Data Localization Manager
// ============================================================================

export class DataLocalizationManager {
  private configs: Map<string, DataLocalizationConfig> = new Map();
  private processingLocations: Map<string, ProcessingLocation> = new Map();

  /**
   * Create a data localization configuration
   */
  createConfig(config: Omit<DataLocalizationConfig, 'id' | 'createdAt' | 'updatedAt'>): DataLocalizationConfig {
    const fullConfig: DataLocalizationConfig = {
      ...config,
      id: this.generateConfigId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.configs.set(fullConfig.id, fullConfig);
    return fullConfig;
  }

  /**
   * Get a configuration by ID
   */
  getConfig(configId: string): DataLocalizationConfig | undefined {
    return this.configs.get(configId);
  }

  /**
   * Update a configuration
   */
  updateConfig(
    configId: string,
    updates: Partial<Omit<DataLocalizationConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): DataLocalizationConfig {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error(`Configuration ${configId} not found`);
    }

    const updated: DataLocalizationConfig = {
      ...config,
      ...updates,
      updatedAt: new Date()
    };

    this.configs.set(configId, updated);
    return updated;
  }

  /**
   * Register a processing location
   */
  registerLocation(location: Omit<ProcessingLocation, 'id'>): ProcessingLocation {
    const fullLocation: ProcessingLocation = {
      ...location,
      id: this.generateLocationId()
    };

    this.processingLocations.set(fullLocation.id, fullLocation);
    return fullLocation;
  }

  /**
   * Validate if a location is allowed by a configuration
   */
  validateLocation(configId: string, country: string, region?: string): {
    isValid: boolean;
    reason?: string;
  } {
    const config = this.configs.get(configId);
    if (!config) {
      return { isValid: false, reason: 'Configuration not found' };
    }

    // Check blocked countries
    if (config.blockedCountries.includes(country)) {
      return { isValid: false, reason: `Country ${country} is blocked` };
    }

    // Check allowed countries if specified
    if (config.allowedCountries.length > 0 && !config.allowedCountries.includes(country)) {
      return { isValid: false, reason: `Country ${country} is not in allowed list` };
    }

    // Check preferred regions
    if (region && config.preferredRegions.length > 0) {
      const isPreferred = config.preferredRegions.includes(region);
      if (!isPreferred) {
        return {
          isValid: true,
          reason: `Region ${region} is not preferred but is allowed`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Check if replication is allowed to a region
   */
  isReplicationAllowed(configId: string, targetRegion: string): boolean {
    const config = this.configs.get(configId);
    if (!config) return false;

    if (!config.replicationAllowed) return false;

    if (config.allowedReplicationRegions && config.allowedReplicationRegions.length > 0) {
      return config.allowedReplicationRegions.includes(targetRegion);
    }

    return true;
  }

  /**
   * Get all processing locations for a country
   */
  getLocationsByCountry(country: string): ProcessingLocation[] {
    return Array.from(this.processingLocations.values()).filter(
      loc => loc.country === country
    );
  }

  /**
   * Validate storage location against requirements
   */
  validateStorageLocation(
    configId: string,
    location: ProcessingLocation
  ): { isValid: boolean; violations: string[] } {
    const config = this.configs.get(configId);
    if (!config) {
      return { isValid: false, violations: ['Configuration not found'] };
    }

    const violations: string[] = [];

    // Check storage location requirement
    if (config.storageLocationRequired && location.country !== config.storageLocationRequired) {
      violations.push(
        `Storage must be in ${config.storageLocationRequired}, found ${location.country}`
      );
    }

    // Check blocked countries
    if (config.blockedCountries.includes(location.country)) {
      violations.push(`Storage location ${location.country} is blocked`);
    }

    return {
      isValid: violations.length === 0,
      violations
    };
  }

  private generateConfigId(): string {
    return `dlc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateLocationId(): string {
    return `loc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Main Data Transfer Service
// ============================================================================

export class DataTransferService {
  private transfers: Map<string, DataTransfer> = new Map();
  private transferLog: TransferLogEntry[] = [];

  private adequacyRegistry: AdequacyDecisionRegistry;
  private sccManager: SCCManager;
  private tiaService: TIAService;
  private schremsIIService: SchremsIIService;
  private localizationManager: DataLocalizationManager;

  constructor() {
    this.adequacyRegistry = new AdequacyDecisionRegistry();
    this.sccManager = new SCCManager();
    this.tiaService = new TIAService();
    this.schremsIIService = new SchremsIIService();
    this.localizationManager = new DataLocalizationManager();
  }

  /**
   * Validate a proposed data transfer
   */
  async validateTransfer(transfer: DataTransfer): Promise<TransferDecision> {
    const decision: TransferDecision = {
      allowed: false,
      requiresSCCs: false,
      requiresTIA: false,
      requiredSupplementaryMeasures: [],
      minimumEncryptionLevel: 'standard',
      warnings: [],
      blockers: []
    };

    const destCountry = transfer.destinationCountry.toUpperCase();

    // Check if it's an intra-EU/EEA transfer
    if (this.isEUEEACountry(transfer.sourceCountry) && this.isEUEEACountry(destCountry)) {
      decision.allowed = true;
      decision.legalBasis = 'adequacy_decision';
      return decision;
    }

    // Check adequacy decisions
    if (this.adequacyRegistry.hasAdequacyDecision(destCountry)) {
      const adequacy = this.adequacyRegistry.getDecision(destCountry)!;

      // Check for partial adequacy restrictions
      const partial = this.adequacyRegistry.isPartialAdequacy(destCountry);
      if (partial.isPartial && partial.restrictions) {
        decision.warnings.push(
          `Partial adequacy for ${destCountry}: ${partial.restrictions.join('; ')}`
        );
      }

      // Check for expiring adequacy
      if (this.adequacyRegistry.isExpiringSoon(destCountry)) {
        decision.warnings.push(
          `Adequacy decision for ${destCountry} expires on ${adequacy.expiresAt?.toISOString()}`
        );
      }

      decision.allowed = true;
      decision.legalBasis = 'adequacy_decision';
      decision.expiresAt = adequacy.expiresAt;
    } else {
      // No adequacy - need alternative legal basis
      decision.requiresSCCs = true;
      decision.requiresTIA = true;

      // Check for existing SCC agreement
      const existingSCC = this.sccManager.hasActiveSCCAgreement(
        transfer.recipientName, // This should be the exporter name in real implementation
        transfer.recipientName,
        destCountry
      );

      if (existingSCC) {
        decision.legalBasis = 'standard_contractual_clauses';
        decision.requiredModules = existingSCC.modules;
      } else if (transfer.legalBasis === 'binding_corporate_rules') {
        decision.legalBasis = 'binding_corporate_rules';
        decision.warnings.push('BCR approval must be verified');
      } else if (transfer.legalBasis === 'explicit_consent') {
        decision.legalBasis = 'explicit_consent';
        decision.warnings.push('Consent must be documented and can be withdrawn');
        decision.blockers.push('Explicit consent must be obtained before transfer');
      } else {
        decision.blockers.push(
          `No adequacy decision for ${destCountry}. SCCs or other legal basis required.`
        );
      }
    }

    // Perform Schrems II assessment
    const schremsAssessment = this.schremsIIService.assessSchremsIICompliance(
      destCountry,
      transfer.dataCategories
    );

    if (schremsAssessment.isHighRisk) {
      decision.warnings.push(
        `High government access risk in ${destCountry}. Supplementary measures required.`
      );
      decision.requiredSupplementaryMeasures = schremsAssessment.technicalMeasures;
      decision.minimumEncryptionLevel = schremsAssessment.requiredEncryption;

      if (!schremsAssessment.canTransfer) {
        decision.allowed = false;
        decision.blockers.push(
          'Transfer to this destination is not permitted due to critical government access risks'
        );
      }

      for (const condition of schremsAssessment.conditions) {
        if (!decision.conditions) decision.conditions = [];
        decision.conditions.push(condition);
      }
    }

    // Check for sensitive data categories
    const sensitivityLevel = this.tiaService.assessDataSensitivity(transfer.dataCategories);
    if (sensitivityLevel === 'very_high' || sensitivityLevel === 'high') {
      decision.requiresTIA = true;
      decision.warnings.push(
        `Transfer contains ${sensitivityLevel} sensitivity data. TIA required.`
      );

      if (sensitivityLevel === 'very_high' && !decision.minimumEncryptionLevel.includes('enhanced')) {
        decision.minimumEncryptionLevel = 'enhanced';
      }
    }

    // Validate encryption level if specified
    if (transfer.encryptionLevel) {
      const encryptionOrder: EncryptionLevel[] = ['none', 'standard', 'enhanced', 'zero_knowledge'];
      const currentLevel = encryptionOrder.indexOf(transfer.encryptionLevel);
      const requiredLevel = encryptionOrder.indexOf(decision.minimumEncryptionLevel);

      if (currentLevel < requiredLevel) {
        decision.blockers.push(
          `Encryption level ${transfer.encryptionLevel} insufficient. Minimum required: ${decision.minimumEncryptionLevel}`
        );
      }
    }

    // Final decision
    if (decision.blockers.length === 0 &&
        (decision.legalBasis || this.isEUEEACountry(destCountry))) {
      decision.allowed = true;
    }

    return decision;
  }

  /**
   * Record a completed data transfer
   */
  async recordTransfer(transfer: DataTransfer): Promise<void> {
    // Validate the transfer first
    const decision = await this.validateTransfer(transfer);

    if (!decision.allowed) {
      throw new Error(
        `Transfer not allowed: ${decision.blockers.join('; ')}`
      );
    }

    // Store the transfer
    this.transfers.set(transfer.id, transfer);

    // Create log entry
    const logEntry: TransferLogEntry = {
      id: this.generateLogId(),
      transfer,
      decision,
      loggedAt: new Date()
    };

    this.transferLog.push(logEntry);
  }

  /**
   * Get transfer history based on filters
   */
  async getTransferHistory(filter: TransferFilter): Promise<DataTransfer[]> {
    let results = Array.from(this.transfers.values());

    if (filter.sourceCountry) {
      results = results.filter(t =>
        t.sourceCountry.toUpperCase() === filter.sourceCountry!.toUpperCase()
      );
    }

    if (filter.destinationCountry) {
      results = results.filter(t =>
        t.destinationCountry.toUpperCase() === filter.destinationCountry!.toUpperCase()
      );
    }

    if (filter.dataCategories && filter.dataCategories.length > 0) {
      results = results.filter(t =>
        filter.dataCategories!.some(c => t.dataCategories.includes(c))
      );
    }

    if (filter.recipientName) {
      results = results.filter(t =>
        t.recipientName.toLowerCase().includes(filter.recipientName!.toLowerCase())
      );
    }

    if (filter.recipientType) {
      results = results.filter(t => t.recipientType === filter.recipientType);
    }

    if (filter.legalBasis) {
      results = results.filter(t => t.legalBasis === filter.legalBasis);
    }

    if (filter.fromDate) {
      results = results.filter(t => t.timestamp >= filter.fromDate!);
    }

    if (filter.toDate) {
      results = results.filter(t => t.timestamp <= filter.toDate!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * Assess transfer risk for a destination country
   */
  async assessTransferRisk(destination: string): Promise<RiskAssessment> {
    return this.tiaService.assessCountryRisk(destination);
  }

  /**
   * Get the adequacy registry for direct access
   */
  getAdequacyRegistry(): AdequacyDecisionRegistry {
    return this.adequacyRegistry;
  }

  /**
   * Get the SCC manager for direct access
   */
  getSCCManager(): SCCManager {
    return this.sccManager;
  }

  /**
   * Get the TIA service for direct access
   */
  getTIAService(): TIAService {
    return this.tiaService;
  }

  /**
   * Get the Schrems II service for direct access
   */
  getSchremsIIService(): SchremsIIService {
    return this.schremsIIService;
  }

  /**
   * Get the data localization manager for direct access
   */
  getLocalizationManager(): DataLocalizationManager {
    return this.localizationManager;
  }

  /**
   * Perform a full Transfer Impact Assessment
   */
  async performTIA(
    destinationCountry: string,
    dataCategories: DataCategory[],
    recipientType: RecipientType,
    existingSafeguards: SafeguardDetail[] = []
  ): Promise<TransferImpactAssessment> {
    return this.tiaService.performTIA(
      destinationCountry,
      dataCategories,
      recipientType,
      existingSafeguards
    );
  }

  /**
   * Get transfer log entries
   */
  getTransferLog(fromDate?: Date, toDate?: Date): TransferLogEntry[] {
    let entries = [...this.transferLog];

    if (fromDate) {
      entries = entries.filter(e => e.loggedAt >= fromDate);
    }

    if (toDate) {
      entries = entries.filter(e => e.loggedAt <= toDate);
    }

    return entries;
  }

  /**
   * Check if a country is in EU/EEA
   */
  private isEUEEACountry(countryCode: string): boolean {
    const euEeaCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU
      'IS', 'LI', 'NO' // EEA
    ];
    return euEeaCountries.includes(countryCode.toUpperCase());
  }

  private generateLogId(): string {
    return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a new DataTransferService instance
 */
export function createDataTransferService(): DataTransferService {
  return new DataTransferService();
}
