/**
 * Vendor Registry
 * Manages vendor onboarding, metadata, contracts, and compliance certifications
 */

import {
  VendorInfo,
  VendorCategory,
  VendorTier,
  VendorStatus,
  VendorContact,
  VendorMetadata,
  Contract,
  ContractType,
  ContractStatus,
  ContractValue,
  SLA,
  DataProcessingTerms,
  SecurityRequirement,
  ContractDocument,
  ComplianceCertification,
  ComplianceFramework,
  CertificationStatus,
  CertificationDocument,
  AuditLogEntry,
  PaginatedResponse,
} from './types';

// ============================================================================
// Vendor Registry Service
// ============================================================================

export interface VendorRegistryConfig {
  storage: VendorStorage;
  auditLogger: AuditLogger;
  notificationService: NotificationService;
  workflowEngine: WorkflowEngine;
}

export class VendorRegistry {
  private storage: VendorStorage;
  private auditLogger: AuditLogger;
  private notificationService: NotificationService;
  private workflowEngine: WorkflowEngine;

  constructor(config: VendorRegistryConfig) {
    this.storage = config.storage;
    this.auditLogger = config.auditLogger;
    this.notificationService = config.notificationService;
    this.workflowEngine = config.workflowEngine;
  }

  // ============================================================================
  // Vendor Management
  // ============================================================================

  async createVendor(input: CreateVendorInput, actorId: string): Promise<VendorInfo> {
    // Validate input
    this.validateVendorInput(input);

    // Check for duplicates
    const existingVendor = await this.storage.findVendorByDomain(input.domain);
    if (existingVendor) {
      throw new VendorRegistryError(
        'DUPLICATE_VENDOR',
        `Vendor with domain ${input.domain} already exists`,
      );
    }

    const now = new Date();
    const vendor: VendorInfo = {
      id: this.generateVendorId(),
      name: input.name,
      legalName: input.legalName || input.name,
      domain: input.domain,
      industry: input.industry,
      category: input.category,
      tier: input.tier || 'medium',
      status: 'prospective',
      contactInfo: input.contactInfo,
      metadata: {
        headquarters: input.metadata?.headquarters || '',
        yearFounded: input.metadata?.yearFounded,
        employeeCount: input.metadata?.employeeCount,
        annualRevenue: input.metadata?.annualRevenue,
        publiclyTraded: input.metadata?.publiclyTraded || false,
        stockSymbol: input.metadata?.stockSymbol,
        parentCompany: input.metadata?.parentCompany,
        subsidiaries: input.metadata?.subsidiaries || [],
        dataLocations: input.metadata?.dataLocations || [],
        certifications: input.metadata?.certifications || [],
        tags: input.metadata?.tags || [],
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveVendor(vendor);

    await this.auditLogger.log({
      action: 'vendor.created',
      actorId,
      resourceType: 'vendor',
      resourceId: vendor.id,
      details: { vendorName: vendor.name, domain: vendor.domain },
    });

    return vendor;
  }

  async updateVendor(
    vendorId: string,
    updates: UpdateVendorInput,
    actorId: string,
  ): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    const updatedVendor = {
      ...vendor,
      ...updates,
      id: vendor.id, // Prevent ID modification
      createdAt: vendor.createdAt, // Prevent creation date modification
      updatedAt: new Date(),
    } as VendorInfo;

    await this.storage.saveVendor(updatedVendor);

    await this.auditLogger.log({
      action: 'vendor.updated',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: { updates },
    });

    return updatedVendor;
  }

  async getVendor(vendorId: string): Promise<VendorInfo> {
    const vendor = await this.storage.getVendor(vendorId);
    if (!vendor) {
      throw new VendorRegistryError('VENDOR_NOT_FOUND', `Vendor ${vendorId} not found`);
    }
    return vendor;
  }

  async listVendors(options: ListVendorsOptions): Promise<PaginatedResponse<VendorInfo>> {
    return this.storage.listVendors(options);
  }

  async searchVendors(query: string): Promise<VendorInfo[]> {
    return this.storage.searchVendors(query);
  }

  async deleteVendor(vendorId: string, actorId: string): Promise<void> {
    const vendor = await this.getVendor(vendorId);

    // Check for active contracts
    const contracts = await this.storage.getVendorContracts(vendorId);
    const activeContracts = contracts.filter(c => c.status === 'active');
    if (activeContracts.length > 0) {
      throw new VendorRegistryError(
        'ACTIVE_CONTRACTS_EXIST',
        `Cannot delete vendor with ${activeContracts.length} active contracts`,
      );
    }

    await this.storage.deleteVendor(vendorId);

    await this.auditLogger.log({
      action: 'vendor.deleted',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: { vendorName: vendor.name },
    });
  }

  // ============================================================================
  // Vendor Onboarding Workflow
  // ============================================================================

  async initiateOnboarding(vendorId: string, actorId: string): Promise<OnboardingWorkflow> {
    const vendor = await this.getVendor(vendorId);

    if (vendor.status !== 'prospective') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Vendor must be in 'prospective' status to initiate onboarding`,
      );
    }

    const workflow = await this.workflowEngine.createWorkflow({
      type: 'vendor_onboarding',
      vendorId,
      steps: this.getOnboardingSteps(vendor.tier),
      initiatedBy: actorId,
    });

    await this.updateVendor(vendorId, { status: 'onboarding' }, actorId);

    await this.notificationService.notify({
      type: 'onboarding_initiated',
      vendorId,
      workflowId: workflow.id,
      recipients: [actorId],
    });

    return workflow;
  }

  async completeOnboardingStep(
    workflowId: string,
    stepId: string,
    data: Record<string, unknown>,
    actorId: string,
  ): Promise<OnboardingWorkflow> {
    const workflow = await this.workflowEngine.getWorkflow(workflowId);

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      throw new VendorRegistryError('STEP_NOT_FOUND', `Step ${stepId} not found in workflow`);
    }

    // Validate step completion
    const validation = await this.validateOnboardingStep(step.type, data);
    if (!validation.valid) {
      throw new VendorRegistryError('VALIDATION_FAILED', validation.errors.join(', '));
    }

    const updatedWorkflow = await this.workflowEngine.completeStep(workflowId, stepId, data, actorId);

    // Check if all steps are complete
    if (updatedWorkflow.steps.every(s => s.status === 'completed')) {
      await this.completeOnboarding(updatedWorkflow.vendorId, actorId);
    }

    return updatedWorkflow;
  }

  async completeOnboarding(vendorId: string, actorId: string): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    if (vendor.status !== 'onboarding') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Vendor must be in 'onboarding' status to complete onboarding`,
      );
    }

    const updatedVendor = await this.updateVendor(vendorId, { status: 'active' }, actorId);

    await this.notificationService.notify({
      type: 'onboarding_completed',
      vendorId,
      recipients: this.getStakeholders(vendor),
    });

    await this.auditLogger.log({
      action: 'vendor.onboarding_completed',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: { vendorName: vendor.name },
    });

    return updatedVendor;
  }

  private getOnboardingSteps(tier: VendorTier): OnboardingStep[] {
    const baseSteps: OnboardingStep[] = [
      { id: 'basic_info', type: 'basic_info', name: 'Basic Information', required: true, status: 'pending' },
      { id: 'security_questionnaire', type: 'security_questionnaire', name: 'Security Questionnaire', required: true, status: 'pending' },
      { id: 'compliance_verification', type: 'compliance_verification', name: 'Compliance Verification', required: true, status: 'pending' },
      { id: 'contract_review', type: 'contract_review', name: 'Contract Review', required: true, status: 'pending' },
    ];

    if (tier === 'critical' || tier === 'high') {
      baseSteps.push(
        { id: 'penetration_test', type: 'penetration_test', name: 'Penetration Test Review', required: true, status: 'pending' },
        { id: 'architecture_review', type: 'architecture_review', name: 'Architecture Review', required: true, status: 'pending' },
        { id: 'incident_response', type: 'incident_response', name: 'Incident Response Verification', required: true, status: 'pending' },
      );
    }

    if (tier === 'critical') {
      baseSteps.push(
        { id: 'onsite_audit', type: 'onsite_audit', name: 'On-site Security Audit', required: true, status: 'pending' },
        { id: 'executive_approval', type: 'executive_approval', name: 'Executive Approval', required: true, status: 'pending' },
      );
    }

    return baseSteps;
  }

  private async validateOnboardingStep(
    stepType: string,
    data: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const validators: Record<string, (data: Record<string, unknown>) => ValidationResult> = {
      basic_info: (d) => this.validateBasicInfo(d),
      security_questionnaire: (d) => this.validateSecurityQuestionnaire(d),
      compliance_verification: (d) => this.validateComplianceVerification(d),
      contract_review: (d) => this.validateContractReview(d),
      penetration_test: (d) => this.validatePenetrationTest(d),
      architecture_review: (d) => this.validateArchitectureReview(d),
      incident_response: (d) => this.validateIncidentResponse(d),
      onsite_audit: (d) => this.validateOnsiteAudit(d),
      executive_approval: (d) => this.validateExecutiveApproval(d),
    };

    const validator = validators[stepType];
    if (!validator) {
      return { valid: true, errors: [] };
    }

    return validator(data);
  }

  private validateBasicInfo(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.legalName) errors.push('Legal name is required');
    if (!data.headquarters) errors.push('Headquarters location is required');
    if (!data.primaryContact) errors.push('Primary contact is required');
    return { valid: errors.length === 0, errors };
  }

  private validateSecurityQuestionnaire(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.completedAt) errors.push('Questionnaire completion date is required');
    if (!data.responses) errors.push('Questionnaire responses are required');
    if (typeof data.score === 'number' && data.score < 60) {
      errors.push('Security questionnaire score is below minimum threshold (60)');
    }
    return { valid: errors.length === 0, errors };
  }

  private validateComplianceVerification(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.certificationsVerified) errors.push('Certifications must be verified');
    return { valid: errors.length === 0, errors };
  }

  private validateContractReview(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.contractId) errors.push('Contract ID is required');
    if (!data.legalApproval) errors.push('Legal approval is required');
    return { valid: errors.length === 0, errors };
  }

  private validatePenetrationTest(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.reportDate) errors.push('Penetration test report date is required');
    if (!data.criticalFindings !== undefined && Number(data.criticalFindings) > 0) {
      errors.push('Critical findings must be remediated');
    }
    return { valid: errors.length === 0, errors };
  }

  private validateArchitectureReview(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.reviewedBy) errors.push('Architecture reviewer is required');
    if (!data.approvalStatus) errors.push('Approval status is required');
    return { valid: errors.length === 0, errors };
  }

  private validateIncidentResponse(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.planVerified) errors.push('Incident response plan must be verified');
    if (!data.contactsVerified) errors.push('Emergency contacts must be verified');
    return { valid: errors.length === 0, errors };
  }

  private validateOnsiteAudit(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.auditDate) errors.push('Audit date is required');
    if (!data.auditorName) errors.push('Auditor name is required');
    if (!data.findings) errors.push('Audit findings are required');
    return { valid: errors.length === 0, errors };
  }

  private validateExecutiveApproval(data: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!data.approverId) errors.push('Approver ID is required');
    if (!data.approvalDate) errors.push('Approval date is required');
    return { valid: errors.length === 0, errors };
  }

  private getStakeholders(vendor: VendorInfo): string[] {
    const stakeholders: string[] = [];
    if (vendor.contactInfo.primaryContact?.email) {
      stakeholders.push(vendor.contactInfo.primaryContact.email);
    }
    return stakeholders;
  }

  // ============================================================================
  // Contract Management
  // ============================================================================

  async createContract(input: CreateContractInput, actorId: string): Promise<Contract> {
    const vendor = await this.getVendor(input.vendorId);

    const now = new Date();
    const contract: Contract = {
      id: this.generateContractId(),
      vendorId: input.vendorId,
      type: input.type,
      status: 'draft',
      startDate: input.startDate,
      endDate: input.endDate,
      renewalDate: input.renewalDate,
      autoRenewal: input.autoRenewal || false,
      value: input.value,
      slas: input.slas || [],
      dataProcessingTerms: input.dataProcessingTerms,
      securityRequirements: input.securityRequirements || [],
      documents: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveContract(contract);

    await this.auditLogger.log({
      action: 'contract.created',
      actorId,
      resourceType: 'contract',
      resourceId: contract.id,
      details: { vendorId: input.vendorId, vendorName: vendor.name, contractType: input.type },
    });

    return contract;
  }

  async updateContract(
    contractId: string,
    updates: UpdateContractInput,
    actorId: string,
  ): Promise<Contract> {
    const contract = await this.getContract(contractId);

    const updatedContract: Contract = {
      ...contract,
      ...updates,
      id: contract.id,
      vendorId: contract.vendorId,
      createdAt: contract.createdAt,
      updatedAt: new Date(),
    };

    // Update status based on dates
    updatedContract.status = this.calculateContractStatus(updatedContract);

    await this.storage.saveContract(updatedContract);

    await this.auditLogger.log({
      action: 'contract.updated',
      actorId,
      resourceType: 'contract',
      resourceId: contractId,
      details: { updates },
    });

    return updatedContract;
  }

  async getContract(contractId: string): Promise<Contract> {
    const contract = await this.storage.getContract(contractId);
    if (!contract) {
      throw new VendorRegistryError('CONTRACT_NOT_FOUND', `Contract ${contractId} not found`);
    }
    return contract;
  }

  async getVendorContracts(vendorId: string): Promise<Contract[]> {
    return this.storage.getVendorContracts(vendorId);
  }

  async activateContract(contractId: string, actorId: string): Promise<Contract> {
    const contract = await this.getContract(contractId);

    if (contract.status !== 'draft' && contract.status !== 'pending_review') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Contract must be in 'draft' or 'pending_review' status to activate`,
      );
    }

    return this.updateContract(contractId, { status: 'active' }, actorId);
  }

  async terminateContract(
    contractId: string,
    reason: string,
    actorId: string,
  ): Promise<Contract> {
    const contract = await this.getContract(contractId);

    const updatedContract = await this.updateContract(
      contractId,
      { status: 'terminated' },
      actorId,
    );

    await this.auditLogger.log({
      action: 'contract.terminated',
      actorId,
      resourceType: 'contract',
      resourceId: contractId,
      details: { reason },
    });

    await this.notificationService.notify({
      type: 'contract_terminated',
      vendorId: contract.vendorId,
      contractId,
      recipients: this.getContractStakeholders(contract),
    });

    return updatedContract;
  }

  async addContractDocument(
    contractId: string,
    document: ContractDocument,
    actorId: string,
  ): Promise<Contract> {
    const contract = await this.getContract(contractId);

    const updatedContract: Contract = {
      ...contract,
      documents: [...contract.documents, document],
      updatedAt: new Date(),
    };

    await this.storage.saveContract(updatedContract);

    await this.auditLogger.log({
      action: 'contract.document_added',
      actorId,
      resourceType: 'contract',
      resourceId: contractId,
      details: { documentName: document.name, documentType: document.type },
    });

    return updatedContract;
  }

  async updateSLA(
    contractId: string,
    slaId: string,
    updates: Partial<SLA>,
    actorId: string,
  ): Promise<Contract> {
    const contract = await this.getContract(contractId);

    const slaIndex = contract.slas.findIndex(s => s.id === slaId);
    if (slaIndex === -1) {
      throw new VendorRegistryError('SLA_NOT_FOUND', `SLA ${slaId} not found in contract`);
    }

    const updatedSLAs = [...contract.slas];
    updatedSLAs[slaIndex] = { ...updatedSLAs[slaIndex], ...updates };

    const updatedContract: Contract = {
      ...contract,
      slas: updatedSLAs,
      updatedAt: new Date(),
    };

    await this.storage.saveContract(updatedContract);

    await this.auditLogger.log({
      action: 'contract.sla_updated',
      actorId,
      resourceType: 'contract',
      resourceId: contractId,
      details: { slaId, updates },
    });

    return updatedContract;
  }

  async recordSLABreach(
    contractId: string,
    slaId: string,
    breach: SLABreachRecord,
    actorId: string,
  ): Promise<void> {
    const contract = await this.getContract(contractId);

    const slaIndex = contract.slas.findIndex(s => s.id === slaId);
    if (slaIndex === -1) {
      throw new VendorRegistryError('SLA_NOT_FOUND', `SLA ${slaId} not found in contract`);
    }

    const sla = contract.slas[slaIndex];
    sla.breachCount++;
    sla.currentPerformance = breach.actualValue;

    await this.storage.saveContract(contract);
    await this.storage.saveSLABreach(contractId, slaId, breach);

    await this.notificationService.notify({
      type: 'sla_breach',
      vendorId: contract.vendorId,
      contractId,
      slaId,
      breach,
      recipients: this.getContractStakeholders(contract),
    });

    await this.auditLogger.log({
      action: 'contract.sla_breach',
      actorId,
      resourceType: 'contract',
      resourceId: contractId,
      details: { slaId, breach },
    });
  }

  private calculateContractStatus(contract: Contract): ContractStatus {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (contract.status === 'terminated') return 'terminated';
    if (contract.status === 'draft') return 'draft';
    if (contract.status === 'pending_review') return 'pending_review';

    if (contract.endDate < now) return 'expired';
    if (contract.endDate < thirtyDaysFromNow) return 'expiring_soon';

    return 'active';
  }

  private getContractStakeholders(contract: Contract): string[] {
    // Return appropriate stakeholders based on contract
    return [];
  }

  // ============================================================================
  // Compliance Certification Management
  // ============================================================================

  async addCertification(
    input: CreateCertificationInput,
    actorId: string,
  ): Promise<ComplianceCertification> {
    const vendor = await this.getVendor(input.vendorId);

    const now = new Date();
    const certification: ComplianceCertification = {
      id: this.generateCertificationId(),
      vendorId: input.vendorId,
      framework: input.framework,
      status: this.calculateCertificationStatus(input.expirationDate),
      certificationBody: input.certificationBody,
      certificateNumber: input.certificateNumber,
      issueDate: input.issueDate,
      expirationDate: input.expirationDate,
      scope: input.scope,
      documents: input.documents || [],
      lastVerified: now,
      verificationMethod: input.verificationMethod || 'manual',
    };

    await this.storage.saveCertification(certification);

    // Update vendor metadata
    const certifications = new Set(vendor.metadata.certifications);
    certifications.add(input.framework);
    await this.updateVendor(
      input.vendorId,
      { metadata: { ...vendor.metadata, certifications: Array.from(certifications) } },
      actorId,
    );

    await this.auditLogger.log({
      action: 'certification.added',
      actorId,
      resourceType: 'certification',
      resourceId: certification.id,
      details: { vendorId: input.vendorId, framework: input.framework },
    });

    return certification;
  }

  async updateCertification(
    certificationId: string,
    updates: UpdateCertificationInput,
    actorId: string,
  ): Promise<ComplianceCertification> {
    const certification = await this.getCertification(certificationId);

    const updatedCertification: ComplianceCertification = {
      ...certification,
      ...updates,
      id: certification.id,
      vendorId: certification.vendorId,
      status: updates.expirationDate
        ? this.calculateCertificationStatus(updates.expirationDate)
        : certification.status,
      lastVerified: new Date(),
    };

    await this.storage.saveCertification(updatedCertification);

    await this.auditLogger.log({
      action: 'certification.updated',
      actorId,
      resourceType: 'certification',
      resourceId: certificationId,
      details: { updates },
    });

    return updatedCertification;
  }

  async getCertification(certificationId: string): Promise<ComplianceCertification> {
    const certification = await this.storage.getCertification(certificationId);
    if (!certification) {
      throw new VendorRegistryError(
        'CERTIFICATION_NOT_FOUND',
        `Certification ${certificationId} not found`,
      );
    }
    return certification;
  }

  async getVendorCertifications(vendorId: string): Promise<ComplianceCertification[]> {
    return this.storage.getVendorCertifications(vendorId);
  }

  async verifyCertification(
    certificationId: string,
    verificationResult: CertificationVerificationResult,
    actorId: string,
  ): Promise<ComplianceCertification> {
    const certification = await this.getCertification(certificationId);

    const status = verificationResult.valid
      ? this.calculateCertificationStatus(certification.expirationDate)
      : 'revoked';

    const updatedCertification: ComplianceCertification = {
      ...certification,
      status,
      lastVerified: new Date(),
      verificationMethod: verificationResult.method,
    };

    await this.storage.saveCertification(updatedCertification);

    if (!verificationResult.valid) {
      await this.notificationService.notify({
        type: 'certification_invalid',
        vendorId: certification.vendorId,
        certificationId,
        framework: certification.framework,
        reason: verificationResult.reason,
        recipients: [], // Add appropriate recipients
      });
    }

    await this.auditLogger.log({
      action: 'certification.verified',
      actorId,
      resourceType: 'certification',
      resourceId: certificationId,
      details: { verificationResult },
    });

    return updatedCertification;
  }

  async addCertificationDocument(
    certificationId: string,
    document: CertificationDocument,
    actorId: string,
  ): Promise<ComplianceCertification> {
    const certification = await this.getCertification(certificationId);

    const updatedCertification: ComplianceCertification = {
      ...certification,
      documents: [...certification.documents, document],
      lastVerified: new Date(),
    };

    await this.storage.saveCertification(updatedCertification);

    await this.auditLogger.log({
      action: 'certification.document_added',
      actorId,
      resourceType: 'certification',
      resourceId: certificationId,
      details: { documentName: document.name, documentType: document.type },
    });

    return updatedCertification;
  }

  async getExpiringCertifications(daysAhead: number): Promise<ComplianceCertification[]> {
    return this.storage.getExpiringCertifications(daysAhead);
  }

  private calculateCertificationStatus(expirationDate: Date): CertificationStatus {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (expirationDate < now) return 'expired';
    if (expirationDate < thirtyDaysFromNow) return 'expiring_soon';
    return 'valid';
  }

  // ============================================================================
  // Vendor Status Management
  // ============================================================================

  async suspendVendor(vendorId: string, reason: string, actorId: string): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    if (vendor.status === 'terminated') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Cannot suspend a terminated vendor`,
      );
    }

    const updatedVendor = await this.updateVendor(vendorId, { status: 'suspended' }, actorId);

    await this.notificationService.notify({
      type: 'vendor_suspended',
      vendorId,
      reason,
      recipients: this.getStakeholders(vendor),
    });

    await this.auditLogger.log({
      action: 'vendor.suspended',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: { reason },
    });

    return updatedVendor;
  }

  async reinstateVendor(vendorId: string, actorId: string): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    if (vendor.status !== 'suspended') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Vendor must be in 'suspended' status to reinstate`,
      );
    }

    const updatedVendor = await this.updateVendor(vendorId, { status: 'active' }, actorId);

    await this.auditLogger.log({
      action: 'vendor.reinstated',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: {},
    });

    return updatedVendor;
  }

  async initiateOffboarding(vendorId: string, reason: string, actorId: string): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    const updatedVendor = await this.updateVendor(vendorId, { status: 'offboarding' }, actorId);

    // Create offboarding workflow
    await this.workflowEngine.createWorkflow({
      type: 'vendor_offboarding',
      vendorId,
      steps: this.getOffboardingSteps(),
      initiatedBy: actorId,
      metadata: { reason },
    });

    await this.notificationService.notify({
      type: 'offboarding_initiated',
      vendorId,
      reason,
      recipients: this.getStakeholders(vendor),
    });

    return updatedVendor;
  }

  async terminateVendor(vendorId: string, actorId: string): Promise<VendorInfo> {
    const vendor = await this.getVendor(vendorId);

    if (vendor.status !== 'offboarding') {
      throw new VendorRegistryError(
        'INVALID_STATUS',
        `Vendor must be in 'offboarding' status to terminate`,
      );
    }

    // Terminate all active contracts
    const contracts = await this.storage.getVendorContracts(vendorId);
    for (const contract of contracts) {
      if (contract.status === 'active') {
        await this.terminateContract(contract.id, 'Vendor termination', actorId);
      }
    }

    const updatedVendor = await this.updateVendor(vendorId, { status: 'terminated' }, actorId);

    await this.auditLogger.log({
      action: 'vendor.terminated',
      actorId,
      resourceType: 'vendor',
      resourceId: vendorId,
      details: {},
    });

    return updatedVendor;
  }

  private getOffboardingSteps(): OnboardingStep[] {
    return [
      { id: 'data_deletion', type: 'data_deletion', name: 'Data Deletion Verification', required: true, status: 'pending' },
      { id: 'access_revocation', type: 'access_revocation', name: 'Access Revocation', required: true, status: 'pending' },
      { id: 'contract_termination', type: 'contract_termination', name: 'Contract Termination', required: true, status: 'pending' },
      { id: 'final_audit', type: 'final_audit', name: 'Final Security Audit', required: true, status: 'pending' },
    ];
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateVendorId(): string {
    return `vnd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateContractId(): string {
    return `ctr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateCertificationId(): string {
    return `cert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private validateVendorInput(input: CreateVendorInput): void {
    if (!input.name || input.name.trim().length === 0) {
      throw new VendorRegistryError('VALIDATION_ERROR', 'Vendor name is required');
    }
    if (!input.domain || !this.isValidDomain(input.domain)) {
      throw new VendorRegistryError('VALIDATION_ERROR', 'Valid domain is required');
    }
    if (!input.industry) {
      throw new VendorRegistryError('VALIDATION_ERROR', 'Industry is required');
    }
    if (!input.category) {
      throw new VendorRegistryError('VALIDATION_ERROR', 'Vendor category is required');
    }
    if (!input.contactInfo?.primaryContact) {
      throw new VendorRegistryError('VALIDATION_ERROR', 'Primary contact is required');
    }
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
    return domainRegex.test(domain);
  }
}

// ============================================================================
// Input/Output Types
// ============================================================================

export interface CreateVendorInput {
  name: string;
  legalName?: string;
  domain: string;
  industry: string;
  category: VendorCategory;
  tier?: VendorTier;
  contactInfo: VendorContact;
  metadata?: Partial<VendorMetadata>;
}

export interface UpdateVendorInput {
  name?: string;
  legalName?: string;
  domain?: string;
  industry?: string;
  category?: VendorCategory;
  tier?: VendorTier;
  status?: VendorStatus;
  contactInfo?: VendorContact;
  metadata?: Partial<VendorMetadata>;
}

export interface ListVendorsOptions {
  page?: number;
  pageSize?: number;
  status?: VendorStatus;
  tier?: VendorTier;
  category?: VendorCategory;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateContractInput {
  vendorId: string;
  type: ContractType;
  startDate: Date;
  endDate: Date;
  renewalDate?: Date;
  autoRenewal?: boolean;
  value: ContractValue;
  slas?: SLA[];
  dataProcessingTerms?: DataProcessingTerms;
  securityRequirements?: SecurityRequirement[];
}

export interface UpdateContractInput {
  type?: ContractType;
  status?: ContractStatus;
  startDate?: Date;
  endDate?: Date;
  renewalDate?: Date;
  autoRenewal?: boolean;
  value?: ContractValue;
  slas?: SLA[];
  dataProcessingTerms?: DataProcessingTerms;
  securityRequirements?: SecurityRequirement[];
}

export interface CreateCertificationInput {
  vendorId: string;
  framework: ComplianceFramework;
  certificationBody?: string;
  certificateNumber?: string;
  issueDate: Date;
  expirationDate: Date;
  scope: string;
  documents?: CertificationDocument[];
  verificationMethod?: 'api' | 'manual' | 'attestation';
}

export interface UpdateCertificationInput {
  certificationBody?: string;
  certificateNumber?: string;
  issueDate?: Date;
  expirationDate?: Date;
  scope?: string;
}

export interface CertificationVerificationResult {
  valid: boolean;
  method: 'api' | 'manual' | 'attestation';
  reason?: string;
  verifiedAt: Date;
}

export interface SLABreachRecord {
  timestamp: Date;
  metric: string;
  expectedValue: number;
  actualValue: number;
  description: string;
}

export interface OnboardingWorkflow {
  id: string;
  vendorId: string;
  type: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  steps: OnboardingStep[];
  initiatedBy: string;
  initiatedAt: Date;
  completedAt?: Date;
}

export interface OnboardingStep {
  id: string;
  type: string;
  name: string;
  required: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  data?: Record<string, unknown>;
  completedBy?: string;
  completedAt?: Date;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Storage Interface
// ============================================================================

export interface VendorStorage {
  // Vendor operations
  saveVendor(vendor: VendorInfo): Promise<void>;
  getVendor(vendorId: string): Promise<VendorInfo | null>;
  findVendorByDomain(domain: string): Promise<VendorInfo | null>;
  listVendors(options: ListVendorsOptions): Promise<PaginatedResponse<VendorInfo>>;
  searchVendors(query: string): Promise<VendorInfo[]>;
  deleteVendor(vendorId: string): Promise<void>;

  // Contract operations
  saveContract(contract: Contract): Promise<void>;
  getContract(contractId: string): Promise<Contract | null>;
  getVendorContracts(vendorId: string): Promise<Contract[]>;
  saveSLABreach(contractId: string, slaId: string, breach: SLABreachRecord): Promise<void>;

  // Certification operations
  saveCertification(certification: ComplianceCertification): Promise<void>;
  getCertification(certificationId: string): Promise<ComplianceCertification | null>;
  getVendorCertifications(vendorId: string): Promise<ComplianceCertification[]>;
  getExpiringCertifications(daysAhead: number): Promise<ComplianceCertification[]>;
}

// ============================================================================
// Supporting Interfaces
// ============================================================================

export interface AuditLogger {
  log(entry: {
    action: string;
    actorId: string;
    resourceType: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): Promise<void>;
}

export interface NotificationService {
  notify(notification: {
    type: string;
    vendorId?: string;
    contractId?: string;
    certificationId?: string;
    workflowId?: string;
    slaId?: string;
    framework?: string;
    reason?: string;
    breach?: SLABreachRecord;
    recipients: string[];
  }): Promise<void>;
}

export interface WorkflowEngine {
  createWorkflow(input: {
    type: string;
    vendorId: string;
    steps: OnboardingStep[];
    initiatedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<OnboardingWorkflow>;

  getWorkflow(workflowId: string): Promise<OnboardingWorkflow>;

  completeStep(
    workflowId: string,
    stepId: string,
    data: Record<string, unknown>,
    actorId: string,
  ): Promise<OnboardingWorkflow>;
}

// ============================================================================
// Error Class
// ============================================================================

export class VendorRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VendorRegistryError';
  }
}
