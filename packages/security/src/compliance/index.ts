/**
 * Compliance Engine
 *
 * Central engine for managing compliance frameworks, running assessments,
 * collecting evidence, and generating compliance reports.
 *
 * Supported frameworks:
 * - SOC 2 Type II (Trust Services Criteria)
 * - NIST 800-53 Rev. 5 (Security and Privacy Controls)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import {
  type ComplianceFramework,
  type ComplianceControl,
  type ComplianceReport,
  type ControlAssessment,
  type Finding,
  type Evidence,
  type MonitoringStatus,
  type ControlMapping,
  type AssessmentOptions,
  type ComplianceEngineConfig,
  DEFAULT_COMPLIANCE_ENGINE_CONFIG,
  assessmentOptionsSchema,
  complianceEngineConfigSchema,
} from './types.js';
import { soc2Framework } from './frameworks/soc2.js';
import { nist80053Framework } from './frameworks/nist-800-53.js';
import {
  ReportGenerator,
  EvidenceCollector,
  FindingGenerator,
  type ReportGenerationOptions,
} from './reports.js';

const logger = createLogger({ component: 'compliance' });

// =============================================================================
// CONTROL MAPPINGS BETWEEN FRAMEWORKS
// =============================================================================

/**
 * Pre-defined mappings between SOC 2 and NIST 800-53 controls
 */
const frameworkMappings: ControlMapping[] = [
  // CC6.1 - Logical Access Security
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.1', targetFramework: 'nist-800-53', targetControlIds: ['AC-2', 'AC-3', 'SC-7'], mappingType: 'exact' },
  // CC6.2 - User Registration
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.2', targetFramework: 'nist-800-53', targetControlIds: ['AC-2', 'IA-2', 'IA-4'], mappingType: 'exact' },
  // CC6.3 - Access Authorization
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.3', targetFramework: 'nist-800-53', targetControlIds: ['AC-2', 'AC-6'], mappingType: 'exact' },
  // CC6.6 - Threat Protection
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.6', targetFramework: 'nist-800-53', targetControlIds: ['SC-7', 'SI-3', 'SI-4'], mappingType: 'partial' },
  // CC6.7 - Transmission Encryption
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.7', targetFramework: 'nist-800-53', targetControlIds: ['SC-8', 'SC-13'], mappingType: 'exact' },
  // CC6.8 - Unauthorized Access Prevention
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC6.8', targetFramework: 'nist-800-53', targetControlIds: ['SI-7', 'CM-3'], mappingType: 'partial' },
  // CC2.1 - Information Quality
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC2.1', targetFramework: 'nist-800-53', targetControlIds: ['AU-1', 'AU-3'], mappingType: 'partial' },
  // CC4.1 - Monitoring
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC4.1', targetFramework: 'nist-800-53', targetControlIds: ['CA-7', 'AU-6'], mappingType: 'partial' },
  // CC7.1 - Vulnerability Detection
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC7.1', targetFramework: 'nist-800-53', targetControlIds: ['RA-5', 'SI-2'], mappingType: 'exact' },
  // CC7.2 - Anomaly Detection
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC7.2', targetFramework: 'nist-800-53', targetControlIds: ['SI-4', 'IR-4'], mappingType: 'exact' },
  // CC8.1 - Change Management
  { sourceFramework: 'soc2-type2', sourceControlId: 'CC8.1', targetFramework: 'nist-800-53', targetControlIds: ['CM-1', 'CM-2', 'CM-3'], mappingType: 'exact' },
];

// =============================================================================
// COMPLIANCE ENGINE
// =============================================================================

/**
 * Main compliance engine for managing frameworks and assessments
 */
export class ComplianceEngine {
  private config: ComplianceEngineConfig;
  private frameworks: Map<string, ComplianceFramework>;
  private monitoringStatus: Map<string, MonitoringStatus>;
  private reportGenerator: ReportGenerator;
  private evidenceCollector: EvidenceCollector;
  private findingGenerator: FindingGenerator;
  private assessmentHistory: Map<string, ControlAssessment[]>;
  private findingsHistory: Map<string, Finding[]>;

  constructor(config: Partial<ComplianceEngineConfig> = {}) {
    this.config = {
      ...DEFAULT_COMPLIANCE_ENGINE_CONFIG,
      ...config,
      monitoring: {
        ...DEFAULT_COMPLIANCE_ENGINE_CONFIG.monitoring,
        ...config.monitoring,
      },
      evidence: {
        ...DEFAULT_COMPLIANCE_ENGINE_CONFIG.evidence,
        ...config.evidence,
      },
      reporting: {
        ...DEFAULT_COMPLIANCE_ENGINE_CONFIG.reporting,
        ...config.reporting,
      },
    };

    this.frameworks = new Map();
    this.monitoringStatus = new Map();
    this.assessmentHistory = new Map();
    this.findingsHistory = new Map();

    this.reportGenerator = new ReportGenerator();
    this.evidenceCollector = new EvidenceCollector(this.config.evidence.hashAlgorithm);
    this.findingGenerator = new FindingGenerator();

    // Register built-in frameworks
    this.registerFramework(soc2Framework);
    this.registerFramework(nist80053Framework);

    logger.info(
      { enabledFrameworks: this.config.enabledFrameworks },
      'Compliance engine initialized'
    );
  }

  // ===========================================================================
  // FRAMEWORK MANAGEMENT
  // ===========================================================================

  /**
   * Register a compliance framework
   */
  registerFramework(framework: ComplianceFramework): void {
    logger.info(
      { frameworkId: framework.id, controlCount: framework.controls.length },
      'Registering compliance framework'
    );

    this.frameworks.set(framework.id, framework);

    // Initialize monitoring status for all controls
    if (this.config.monitoring.enabled) {
      for (const control of framework.controls) {
        const statusKey = `${framework.id}:${control.id}`;
        this.monitoringStatus.set(statusKey, {
          controlId: control.id,
          enabled: control.automatedTest !== undefined,
          checkFrequency: this.config.monitoring.defaultCheckFrequency,
          consecutiveFailures: 0,
          alertThreshold: this.config.monitoring.defaultAlertThreshold,
          alertTriggered: false,
        });
      }
    }
  }

  /**
   * Get a registered framework by ID
   */
  getFramework(frameworkId: string): ComplianceFramework | undefined {
    return this.frameworks.get(frameworkId);
  }

  /**
   * Get all registered frameworks
   */
  getAllFrameworks(): ComplianceFramework[] {
    return Array.from(this.frameworks.values());
  }

  /**
   * Get enabled frameworks
   */
  getEnabledFrameworks(): ComplianceFramework[] {
    return this.config.enabledFrameworks
      .map((id) => this.frameworks.get(id))
      .filter((f): f is ComplianceFramework => f !== undefined);
  }

  // ===========================================================================
  // CONTROL MANAGEMENT
  // ===========================================================================

  /**
   * Get a specific control from a framework
   */
  getControl(frameworkId: string, controlId: string): ComplianceControl | undefined {
    const framework = this.frameworks.get(frameworkId);
    return framework?.controls.find((c) => c.id === controlId);
  }

  /**
   * Get controls by family
   */
  getControlsByFamily(frameworkId: string, family: string): ComplianceControl[] {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) return [];
    return framework.controls.filter((c) => c.family.startsWith(family));
  }

  /**
   * Update control implementation status
   */
  updateControlStatus(
    frameworkId: string,
    controlId: string,
    status: ComplianceControl['implementation'],
    notes?: string
  ): void {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error(`Framework not found: ${frameworkId}`);
    }

    const control = framework.controls.find((c) => c.id === controlId);
    if (!control) {
      throw new Error(`Control not found: ${controlId}`);
    }

    logger.info(
      { frameworkId, controlId, oldStatus: control.implementation, newStatus: status },
      'Updating control status'
    );

    control.implementation = status;
    control.lastAssessed = new Date();
    if (notes) {
      control.notes = notes;
    }
  }

  /**
   * Add evidence to a control
   */
  addEvidence(frameworkId: string, controlId: string, evidence: Evidence): void {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error(`Framework not found: ${frameworkId}`);
    }

    const control = framework.controls.find((c) => c.id === controlId);
    if (!control) {
      throw new Error(`Control not found: ${controlId}`);
    }

    logger.debug(
      { frameworkId, controlId, evidenceType: evidence.type },
      'Adding evidence to control'
    );

    control.evidence.push(evidence);
  }

  // ===========================================================================
  // ASSESSMENT
  // ===========================================================================

  /**
   * Run a compliance assessment
   */
  async runAssessment(options: AssessmentOptions): Promise<{
    assessments: ControlAssessment[];
    findings: Finding[];
  }> {
    const validatedOptions = assessmentOptionsSchema.parse(options);

    logger.info(
      { frameworkId: validatedOptions.frameworkId },
      'Starting compliance assessment'
    );

    const framework = this.frameworks.get(validatedOptions.frameworkId);
    if (!framework) {
      throw new Error(`Framework not found: ${validatedOptions.frameworkId}`);
    }

    const controlsToAssess = validatedOptions.controlIds
      ? framework.controls.filter((c) => validatedOptions.controlIds?.includes(c.id))
      : framework.controls;

    const assessments: ControlAssessment[] = [];

    for (const control of controlsToAssess) {
      const assessment = await this.assessControl(
        framework,
        control,
        validatedOptions.runAutomatedTests ?? true,
        validatedOptions.collectEvidence ?? true
      );
      assessments.push(assessment);
    }

    // Generate findings
    const findings = this.findingGenerator.generateFindings(assessments, framework);

    // Store in history
    const historyKey = `${validatedOptions.frameworkId}:${new Date().toISOString()}`;
    this.assessmentHistory.set(historyKey, assessments);
    this.findingsHistory.set(historyKey, findings);

    logger.info(
      {
        frameworkId: validatedOptions.frameworkId,
        controlsAssessed: assessments.length,
        findingsGenerated: findings.length,
      },
      'Compliance assessment completed'
    );

    return { assessments, findings };
  }

  /**
   * Assess a single control
   */
  private async assessControl(
    framework: ComplianceFramework,
    control: ComplianceControl,
    runAutomatedTest: boolean,
    collectEvidence: boolean
  ): Promise<ControlAssessment> {
    logger.debug(
      { frameworkId: framework.id, controlId: control.id },
      'Assessing control'
    );

    let automatedTestPassed: boolean | undefined;

    // Run automated test if available and requested
    if (runAutomatedTest && control.automatedTest) {
      try {
        automatedTestPassed = await control.automatedTest();
        this.updateMonitoringStatus(framework.id, control.id, automatedTestPassed);
      } catch (error) {
        logger.error(
          { frameworkId: framework.id, controlId: control.id, error },
          'Automated test failed with error'
        );
        automatedTestPassed = false;
        this.updateMonitoringStatus(framework.id, control.id, false);
      }
    }

    // Collect evidence if requested
    let evidence = [...control.evidence];
    if (collectEvidence && this.config.evidence.autoCollect) {
      // Auto-collect system evidence (placeholder for actual implementation)
      // In a real implementation, this would gather logs, configs, etc.
    }

    // Identify gaps
    const gaps = this.identifyGaps(control, automatedTestPassed);

    return {
      controlId: control.id,
      controlName: control.name,
      status: control.implementation,
      automatedTestPassed,
      assessedAt: new Date(),
      evidence,
      notes: control.notes,
      gaps: gaps.length > 0 ? gaps : undefined,
      riskScore: this.calculateRiskScore(control, automatedTestPassed, gaps),
    };
  }

  /**
   * Identify gaps in control implementation
   */
  private identifyGaps(
    control: ComplianceControl,
    testPassed?: boolean
  ): string[] {
    const gaps: string[] = [];

    if (control.implementation === 'planned') {
      gaps.push('Control implementation not yet started');
    }

    if (control.implementation === 'partially-implemented') {
      gaps.push('Control only partially implemented - review for completeness');
    }

    if (testPassed === false) {
      gaps.push('Automated compliance test failed');
    }

    if (control.evidence.length === 0 && control.implementation === 'implemented') {
      gaps.push('No evidence documented for implemented control');
    }

    if (control.evidence.length === 1 && control.implementation === 'implemented') {
      gaps.push('Limited evidence - consider collecting additional documentation');
    }

    return gaps;
  }

  /**
   * Calculate risk score for a control (0-100)
   */
  private calculateRiskScore(
    control: ComplianceControl,
    testPassed?: boolean,
    gaps?: string[]
  ): number {
    let score = 0;

    // Base score from implementation status
    const statusScores: Record<ComplianceControl['implementation'], number> = {
      'not-applicable': 0,
      implemented: 0,
      'partially-implemented': 30,
      planned: 60,
    };
    score += statusScores[control.implementation];

    // Priority modifier
    const priorityModifiers: Record<ComplianceControl['priority'], number> = {
      P1: 20,
      P2: 10,
      P3: 5,
    };
    if (control.implementation !== 'implemented') {
      score += priorityModifiers[control.priority];
    }

    // Test failure penalty
    if (testPassed === false) {
      score += 25;
    }

    // Gap penalties
    if (gaps) {
      score += Math.min(gaps.length * 5, 20);
    }

    return Math.min(score, 100);
  }

  /**
   * Update monitoring status after a test
   */
  private updateMonitoringStatus(
    frameworkId: string,
    controlId: string,
    testPassed: boolean
  ): void {
    const statusKey = `${frameworkId}:${controlId}`;
    const status = this.monitoringStatus.get(statusKey);

    if (!status) return;

    status.lastCheck = new Date();
    status.lastResult = testPassed;

    if (testPassed) {
      status.consecutiveFailures = 0;
      status.alertTriggered = false;
    } else {
      status.consecutiveFailures++;
      if (status.consecutiveFailures >= status.alertThreshold && !status.alertTriggered) {
        status.alertTriggered = true;
        logger.warn(
          { frameworkId, controlId, consecutiveFailures: status.consecutiveFailures },
          'Control monitoring alert triggered'
        );
      }
    }

    this.monitoringStatus.set(statusKey, status);
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate a compliance report
   */
  async generateReport(
    frameworkId: string,
    period: { start: Date; end: Date },
    options: ReportGenerationOptions
  ): Promise<ComplianceReport> {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error(`Framework not found: ${frameworkId}`);
    }

    logger.info({ frameworkId, period }, 'Generating compliance report');

    // Run assessment
    const { assessments, findings } = await this.runAssessment({
      frameworkId,
      periodStart: period.start,
      periodEnd: period.end,
      runAutomatedTests: true,
      collectEvidence: true,
    });

    // Generate report
    return this.reportGenerator.generateReport(
      framework,
      assessments,
      findings,
      period,
      options
    );
  }

  /**
   * Export report in specified format
   */
  exportReport(report: ComplianceReport, format: 'json' | 'html'): string {
    switch (format) {
      case 'json':
        return this.reportGenerator.formatAsJson(report);
      case 'html':
        return this.reportGenerator.formatAsHtml(report);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  // ===========================================================================
  // FRAMEWORK MAPPING
  // ===========================================================================

  /**
   * Get control mappings between frameworks
   */
  getControlMappings(
    sourceFramework: string,
    targetFramework: string
  ): ControlMapping[] {
    return frameworkMappings.filter(
      (m) =>
        m.sourceFramework === sourceFramework &&
        m.targetFramework === targetFramework
    );
  }

  /**
   * Get mapped controls for a specific control
   */
  getMappedControls(
    frameworkId: string,
    controlId: string
  ): { framework: string; controlIds: string[]; mappingType: string }[] {
    const mappings = frameworkMappings.filter(
      (m) =>
        (m.sourceFramework === frameworkId && m.sourceControlId === controlId) ||
        (m.targetFramework === frameworkId && m.targetControlIds.includes(controlId))
    );

    return mappings.map((m) => {
      if (m.sourceFramework === frameworkId) {
        return {
          framework: m.targetFramework,
          controlIds: m.targetControlIds,
          mappingType: m.mappingType,
        };
      } else {
        return {
          framework: m.sourceFramework,
          controlIds: [m.sourceControlId],
          mappingType: m.mappingType,
        };
      }
    });
  }

  // ===========================================================================
  // CONTINUOUS MONITORING
  // ===========================================================================

  /**
   * Get monitoring status for all controls
   */
  getMonitoringStatus(frameworkId?: string): MonitoringStatus[] {
    const statuses = Array.from(this.monitoringStatus.entries());

    if (frameworkId) {
      return statuses
        .filter(([key]) => key.startsWith(`${frameworkId}:`))
        .map(([, status]) => status);
    }

    return statuses.map(([, status]) => status);
  }

  /**
   * Enable/disable monitoring for a control
   */
  setMonitoringEnabled(
    frameworkId: string,
    controlId: string,
    enabled: boolean
  ): void {
    const statusKey = `${frameworkId}:${controlId}`;
    const status = this.monitoringStatus.get(statusKey);

    if (status) {
      status.enabled = enabled;
      this.monitoringStatus.set(statusKey, status);
      logger.info({ frameworkId, controlId, enabled }, 'Monitoring status updated');
    }
  }

  /**
   * Run continuous monitoring checks
   */
  async runMonitoringChecks(): Promise<{
    checked: number;
    passed: number;
    failed: number;
    alerts: string[];
  }> {
    const now = new Date();
    let checked = 0;
    let passed = 0;
    let failed = 0;
    const alerts: string[] = [];

    for (const [key, status] of Array.from(this.monitoringStatus.entries())) {
      if (!status.enabled) continue;

      // Check if due for check
      if (status.lastCheck) {
        const timeSinceCheck = now.getTime() - status.lastCheck.getTime();
        if (timeSinceCheck < status.checkFrequency * 1000) continue;
      }

      const [frameworkId, controlId] = key.split(':');
      const control = this.getControl(frameworkId!, controlId!);

      if (control?.automatedTest) {
        checked++;
        try {
          const result = await control.automatedTest();
          this.updateMonitoringStatus(frameworkId!, controlId!, result);

          if (result) {
            passed++;
          } else {
            failed++;
            const currentStatus = this.monitoringStatus.get(key);
            if (currentStatus?.alertTriggered) {
              alerts.push(`Control ${frameworkId}:${controlId} - ${currentStatus.consecutiveFailures} consecutive failures`);
            }
          }
        } catch (error) {
          failed++;
          this.updateMonitoringStatus(frameworkId!, controlId!, false);
        }
      }
    }

    logger.info(
      { checked, passed, failed, alertCount: alerts.length },
      'Monitoring checks completed'
    );

    return { checked, passed, failed, alerts };
  }

  // ===========================================================================
  // EVIDENCE MANAGEMENT
  // ===========================================================================

  /**
   * Collect log evidence
   */
  async collectLogEvidence(
    frameworkId: string,
    controlId: string,
    title: string,
    description: string,
    source: string,
    content: string
  ): Promise<Evidence> {
    const evidence = await this.evidenceCollector.collectLogEvidence(
      title,
      description,
      source,
      content
    );

    this.addEvidence(frameworkId, controlId, evidence);
    return evidence;
  }

  /**
   * Collect config evidence
   */
  async collectConfigEvidence(
    frameworkId: string,
    controlId: string,
    title: string,
    description: string,
    source: string,
    content: string
  ): Promise<Evidence> {
    const evidence = await this.evidenceCollector.collectConfigEvidence(
      title,
      description,
      source,
      content
    );

    this.addEvidence(frameworkId, controlId, evidence);
    return evidence;
  }

  /**
   * Verify evidence integrity
   */
  verifyEvidenceIntegrity(evidence: Evidence): boolean {
    return this.evidenceCollector.verifyEvidenceIntegrity(evidence);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let complianceEngineInstance: ComplianceEngine | null = null;

/**
 * Get or create the compliance engine singleton
 */
export function getComplianceEngine(
  config?: Partial<ComplianceEngineConfig>
): ComplianceEngine {
  if (!complianceEngineInstance) {
    complianceEngineInstance = new ComplianceEngine(config);
  }
  return complianceEngineInstance;
}

/**
 * Reset the compliance engine (useful for testing)
 */
export function resetComplianceEngine(): void {
  complianceEngineInstance = null;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { soc2Framework } from './frameworks/soc2.js';
export { nist80053Framework } from './frameworks/nist-800-53.js';
export * from './types.js';
export * from './reports.js';
