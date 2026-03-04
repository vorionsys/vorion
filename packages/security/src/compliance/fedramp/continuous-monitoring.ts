/**
 * FedRAMP Continuous Monitoring (ConMon) Service
 *
 * Implements FedRAMP continuous monitoring requirements including:
 * - Vulnerability scanning integration
 * - POA&M tracking
 * - Monthly OS scan tracking
 * - Annual penetration test tracking
 * - Continuous assessment scheduling
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import type { Evidence, FindingSeverity } from '../types.js';

const logger = createLogger({ component: 'fedramp-conmon' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Vulnerability severity levels per FedRAMP
 */
export const VULNERABILITY_SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const;
export type VulnerabilitySeverity = (typeof VULNERABILITY_SEVERITIES)[number];

/**
 * Scan types supported by ConMon
 */
export const SCAN_TYPES = [
  'vulnerability',
  'configuration',
  'container',
  'web-application',
  'database',
  'operating-system',
] as const;
export type ScanType = (typeof SCAN_TYPES)[number];

/**
 * Assessment types
 */
export const ASSESSMENT_TYPES = [
  'monthly-scan',
  'quarterly-assessment',
  'annual-assessment',
  'penetration-test',
  'incident-triggered',
  'significant-change',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/**
 * Vulnerability finding from scans
 */
export interface VulnerabilityFinding {
  /** Unique identifier */
  id: string;
  /** Scanner that detected this */
  scannerId: string;
  /** Scanner finding ID */
  scannerFindingId: string;
  /** CVE ID if applicable */
  cveId?: string;
  /** CWE ID if applicable */
  cweId?: string;
  /** Title of the vulnerability */
  title: string;
  /** Detailed description */
  description: string;
  /** Severity level */
  severity: VulnerabilitySeverity;
  /** CVSS score (0-10) */
  cvssScore?: number;
  /** CVSS vector */
  cvssVector?: string;
  /** Affected asset */
  affectedAsset: string;
  /** Affected component */
  affectedComponent?: string;
  /** First detected date */
  firstDetected: Date;
  /** Last detected date */
  lastDetected: Date;
  /** Remediation status */
  status: 'open' | 'in-progress' | 'remediated' | 'false-positive' | 'risk-accepted';
  /** Remediation deadline based on FedRAMP requirements */
  remediationDeadline: Date;
  /** Days overdue (negative if not yet due) */
  daysOverdue: number;
  /** Associated POA&M ID if tracked */
  poamId?: string;
  /** Related control IDs */
  relatedControls: string[];
  /** Remediation guidance */
  remediationGuidance?: string;
  /** Plugin/check ID from scanner */
  pluginId?: string;
  /** Port if network vulnerability */
  port?: number;
  /** Protocol if network vulnerability */
  protocol?: string;
}

export const vulnerabilityFindingSchema = z.object({
  id: z.string().min(1),
  scannerId: z.string().min(1),
  scannerFindingId: z.string().min(1),
  cveId: z.string().optional(),
  cweId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(VULNERABILITY_SEVERITIES),
  cvssScore: z.number().min(0).max(10).optional(),
  cvssVector: z.string().optional(),
  affectedAsset: z.string().min(1),
  affectedComponent: z.string().optional(),
  firstDetected: z.coerce.date(),
  lastDetected: z.coerce.date(),
  status: z.enum(['open', 'in-progress', 'remediated', 'false-positive', 'risk-accepted']),
  remediationDeadline: z.coerce.date(),
  daysOverdue: z.number(),
  poamId: z.string().optional(),
  relatedControls: z.array(z.string()),
  remediationGuidance: z.string().optional(),
  pluginId: z.string().optional(),
  port: z.number().optional(),
  protocol: z.string().optional(),
});

/**
 * Vulnerability scan result
 */
export interface ScanResult {
  /** Unique scan ID */
  id: string;
  /** Type of scan */
  scanType: ScanType;
  /** Scanner used */
  scannerId: string;
  /** Scanner name */
  scannerName: string;
  /** Scanner version */
  scannerVersion: string;
  /** Scan start time */
  startTime: Date;
  /** Scan end time */
  endTime: Date;
  /** Duration in seconds */
  durationSeconds: number;
  /** Scan scope/targets */
  targets: string[];
  /** Total hosts/assets scanned */
  totalTargets: number;
  /** Findings from scan */
  findings: VulnerabilityFinding[];
  /** Finding counts by severity */
  findingCounts: Record<VulnerabilitySeverity, number>;
  /** Scan status */
  status: 'completed' | 'failed' | 'partial';
  /** Error message if failed */
  errorMessage?: string;
  /** Credentials used (obfuscated) */
  credentialType?: string;
  /** Scan policy/profile used */
  scanPolicy?: string;
  /** Raw scan report reference */
  rawReportRef?: string;
}

export const scanResultSchema = z.object({
  id: z.string().min(1),
  scanType: z.enum(SCAN_TYPES),
  scannerId: z.string().min(1),
  scannerName: z.string().min(1),
  scannerVersion: z.string().min(1),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  durationSeconds: z.number().nonnegative(),
  targets: z.array(z.string()),
  totalTargets: z.number().nonnegative(),
  findings: z.array(vulnerabilityFindingSchema),
  findingCounts: z.object({
    critical: z.number().nonnegative(),
    high: z.number().nonnegative(),
    moderate: z.number().nonnegative(),
    low: z.number().nonnegative(),
  }),
  status: z.enum(['completed', 'failed', 'partial']),
  errorMessage: z.string().optional(),
  credentialType: z.string().optional(),
  scanPolicy: z.string().optional(),
  rawReportRef: z.string().optional(),
});

/**
 * Scheduled assessment
 */
export interface ScheduledAssessment {
  /** Unique ID */
  id: string;
  /** Assessment type */
  type: AssessmentType;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Scheduled date */
  scheduledDate: Date;
  /** Actual completion date */
  completedDate?: Date;
  /** Status */
  status: 'scheduled' | 'in-progress' | 'completed' | 'overdue' | 'cancelled';
  /** Responsible party */
  responsibleParty: string;
  /** 3PAO involvement required */
  requires3PAO: boolean;
  /** 3PAO organization if applicable */
  thirdPartyAssessor?: string;
  /** Controls to assess */
  controlsInScope: string[];
  /** Deliverables expected */
  deliverables: string[];
  /** Associated documents */
  documents: string[];
  /** Notes */
  notes?: string;
  /** Recurrence pattern */
  recurrence?: {
    frequency: 'monthly' | 'quarterly' | 'annually';
    dayOfMonth?: number;
    monthOfYear?: number;
  };
}

export const scheduledAssessmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ASSESSMENT_TYPES),
  title: z.string().min(1),
  description: z.string().min(1),
  scheduledDate: z.coerce.date(),
  completedDate: z.coerce.date().optional(),
  status: z.enum(['scheduled', 'in-progress', 'completed', 'overdue', 'cancelled']),
  responsibleParty: z.string().min(1),
  requires3PAO: z.boolean(),
  thirdPartyAssessor: z.string().optional(),
  controlsInScope: z.array(z.string()),
  deliverables: z.array(z.string()),
  documents: z.array(z.string()),
  notes: z.string().optional(),
  recurrence: z
    .object({
      frequency: z.enum(['monthly', 'quarterly', 'annually']),
      dayOfMonth: z.number().min(1).max(31).optional(),
      monthOfYear: z.number().min(1).max(12).optional(),
    })
    .optional(),
});

/**
 * ConMon configuration
 */
export interface ConMonConfig {
  /** Organization name */
  organizationName: string;
  /** System name */
  systemName: string;
  /** FedRAMP authorization level */
  authorizationLevel: 'low' | 'moderate' | 'high';
  /** ATO date */
  atoDate: Date;
  /** ATO expiration date */
  atoExpirationDate: Date;
  /** Remediation timeframes (days) */
  remediationTimeframes: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
  /** Scanner configurations */
  scanners: ScannerConfig[];
  /** Notification settings */
  notifications: {
    enabled: boolean;
    emailRecipients: string[];
    slackWebhook?: string;
    scanCompletionNotify: boolean;
    overdueNotify: boolean;
    overdueDaysThreshold: number;
  };
}

/**
 * Scanner configuration
 */
export interface ScannerConfig {
  /** Scanner ID */
  id: string;
  /** Scanner name */
  name: string;
  /** Scanner type */
  type: 'nessus' | 'qualys' | 'rapid7' | 'tenable' | 'openvas' | 'custom';
  /** API endpoint */
  apiEndpoint?: string;
  /** Scan types this scanner handles */
  scanTypes: ScanType[];
  /** Scan schedule */
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    hour: number;
    minute: number;
  };
  /** Is scanner active */
  active: boolean;
}

// =============================================================================
// FEDRAMP REMEDIATION TIMEFRAMES
// =============================================================================

/**
 * FedRAMP required remediation timeframes (in days)
 */
export const FEDRAMP_REMEDIATION_TIMEFRAMES = {
  low: {
    critical: 30,
    high: 30,
    moderate: 90,
    low: 180,
  },
  moderate: {
    critical: 30,
    high: 30,
    moderate: 90,
    low: 180,
  },
  high: {
    critical: 15,
    high: 30,
    moderate: 90,
    low: 180,
  },
} as const;

// =============================================================================
// CONTINUOUS MONITORING SERVICE
// =============================================================================

/**
 * FedRAMP Continuous Monitoring Service
 */
export class ContinuousMonitoringService {
  private config: ConMonConfig;
  private scanResults: Map<string, ScanResult>;
  private vulnerabilities: Map<string, VulnerabilityFinding>;
  private assessments: Map<string, ScheduledAssessment>;
  private scanHistory: ScanResult[];

  constructor(config: ConMonConfig) {
    this.config = config;
    this.scanResults = new Map();
    this.vulnerabilities = new Map();
    this.assessments = new Map();
    this.scanHistory = [];

    logger.info(
      {
        systemName: config.systemName,
        authorizationLevel: config.authorizationLevel,
      },
      'Continuous monitoring service initialized'
    );
  }

  // ===========================================================================
  // VULNERABILITY SCANNING
  // ===========================================================================

  /**
   * Import scan results from a scanner
   */
  importScanResults(scanResult: ScanResult): void {
    scanResultSchema.parse(scanResult);

    logger.info(
      {
        scanId: scanResult.id,
        scanType: scanResult.scanType,
        findingCount: scanResult.findings.length,
      },
      'Importing scan results'
    );

    // Store scan result
    this.scanResults.set(scanResult.id, scanResult);
    this.scanHistory.push(scanResult);

    // Process findings
    for (const finding of scanResult.findings) {
      this.processVulnerabilityFinding(finding);
    }

    // Update status of previously detected vulnerabilities not in this scan
    this.updateRemediatedVulnerabilities(scanResult);
  }

  /**
   * Process a vulnerability finding
   */
  private processVulnerabilityFinding(finding: VulnerabilityFinding): void {
    // Check if this vulnerability was previously detected
    const existingKey = this.findExistingVulnerability(finding);

    if (existingKey) {
      // Update existing vulnerability
      const existing = this.vulnerabilities.get(existingKey)!;
      existing.lastDetected = finding.lastDetected;
      existing.status = finding.status === 'remediated' ? existing.status : finding.status;
      this.vulnerabilities.set(existingKey, existing);
    } else {
      // Calculate remediation deadline
      const deadline = this.calculateRemediationDeadline(finding.severity, finding.firstDetected);
      finding.remediationDeadline = deadline;
      finding.daysOverdue = this.calculateDaysOverdue(deadline);

      this.vulnerabilities.set(finding.id, finding);
    }
  }

  /**
   * Find an existing vulnerability that matches this finding
   */
  private findExistingVulnerability(finding: VulnerabilityFinding): string | undefined {
    for (const [key, existing] of Array.from(this.vulnerabilities.entries())) {
      if (
        existing.cveId &&
        existing.cveId === finding.cveId &&
        existing.affectedAsset === finding.affectedAsset
      ) {
        return key;
      }
      if (
        existing.pluginId === finding.pluginId &&
        existing.affectedAsset === finding.affectedAsset &&
        existing.port === finding.port
      ) {
        return key;
      }
    }
    return undefined;
  }

  /**
   * Update status of vulnerabilities not found in latest scan (potentially remediated)
   */
  private updateRemediatedVulnerabilities(scanResult: ScanResult): void {
    const scannedAssets = new Set(scanResult.targets);
    const currentFindingKeys = new Set(scanResult.findings.map((f) => f.id));

    for (const [key, vuln] of Array.from(this.vulnerabilities.entries())) {
      if (
        scannedAssets.has(vuln.affectedAsset) &&
        !currentFindingKeys.has(key) &&
        vuln.status === 'open'
      ) {
        // Vulnerability was in scope but not found - may be remediated
        // Mark as requiring verification
        logger.info(
          { vulnId: key, asset: vuln.affectedAsset },
          'Vulnerability not detected in scan - may be remediated'
        );
      }
    }
  }

  /**
   * Calculate remediation deadline based on severity and FedRAMP requirements
   */
  calculateRemediationDeadline(severity: VulnerabilitySeverity, detectedDate: Date): Date {
    const timeframes =
      this.config.remediationTimeframes ||
      FEDRAMP_REMEDIATION_TIMEFRAMES[this.config.authorizationLevel];
    const days = timeframes[severity];

    const deadline = new Date(detectedDate);
    deadline.setDate(deadline.getDate() + days);
    return deadline;
  }

  /**
   * Calculate days overdue (negative if not yet due)
   */
  calculateDaysOverdue(deadline: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - deadline.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Get all vulnerabilities
   */
  getVulnerabilities(filter?: {
    severity?: VulnerabilitySeverity;
    status?: VulnerabilityFinding['status'];
    overdue?: boolean;
    asset?: string;
  }): VulnerabilityFinding[] {
    let vulns = Array.from(this.vulnerabilities.values());

    if (filter?.severity) {
      vulns = vulns.filter((v) => v.severity === filter.severity);
    }
    if (filter?.status) {
      vulns = vulns.filter((v) => v.status === filter.status);
    }
    if (filter?.overdue !== undefined) {
      vulns = vulns.filter((v) => (filter.overdue ? v.daysOverdue > 0 : v.daysOverdue <= 0));
    }
    if (filter?.asset) {
      vulns = vulns.filter((v) => v.affectedAsset === filter.asset);
    }

    return vulns;
  }

  /**
   * Get overdue vulnerabilities
   */
  getOverdueVulnerabilities(): VulnerabilityFinding[] {
    return this.getVulnerabilities({ overdue: true, status: 'open' });
  }

  /**
   * Update vulnerability status
   */
  updateVulnerabilityStatus(
    vulnId: string,
    status: VulnerabilityFinding['status'],
    poamId?: string
  ): void {
    const vuln = this.vulnerabilities.get(vulnId);
    if (!vuln) {
      throw new Error(`Vulnerability not found: ${vulnId}`);
    }

    vuln.status = status;
    if (poamId) {
      vuln.poamId = poamId;
    }

    logger.info({ vulnId, status, poamId }, 'Vulnerability status updated');
    this.vulnerabilities.set(vulnId, vuln);
  }

  // ===========================================================================
  // ASSESSMENT SCHEDULING
  // ===========================================================================

  /**
   * Schedule an assessment
   */
  scheduleAssessment(assessment: Omit<ScheduledAssessment, 'id'>): ScheduledAssessment {
    const id = randomUUID();
    const scheduled: ScheduledAssessment = {
      id,
      ...assessment,
    };

    scheduledAssessmentSchema.parse(scheduled);
    this.assessments.set(id, scheduled);

    logger.info(
      { assessmentId: id, type: assessment.type, scheduledDate: assessment.scheduledDate },
      'Assessment scheduled'
    );

    return scheduled;
  }

  /**
   * Get scheduled assessments
   */
  getScheduledAssessments(filter?: {
    type?: AssessmentType;
    status?: ScheduledAssessment['status'];
    startDate?: Date;
    endDate?: Date;
  }): ScheduledAssessment[] {
    let assessments = Array.from(this.assessments.values());

    if (filter?.type) {
      assessments = assessments.filter((a) => a.type === filter.type);
    }
    if (filter?.status) {
      assessments = assessments.filter((a) => a.status === filter.status);
    }
    if (filter?.startDate) {
      assessments = assessments.filter((a) => a.scheduledDate >= filter.startDate!);
    }
    if (filter?.endDate) {
      assessments = assessments.filter((a) => a.scheduledDate <= filter.endDate!);
    }

    return assessments.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  }

  /**
   * Update assessment status
   */
  updateAssessmentStatus(
    assessmentId: string,
    status: ScheduledAssessment['status'],
    completedDate?: Date
  ): void {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error(`Assessment not found: ${assessmentId}`);
    }

    assessment.status = status;
    if (completedDate) {
      assessment.completedDate = completedDate;
    }

    logger.info({ assessmentId, status }, 'Assessment status updated');
    this.assessments.set(assessmentId, assessment);

    // Schedule next occurrence if recurring
    if (status === 'completed' && assessment.recurrence) {
      this.scheduleNextOccurrence(assessment);
    }
  }

  /**
   * Schedule the next occurrence of a recurring assessment
   */
  private scheduleNextOccurrence(assessment: ScheduledAssessment): void {
    if (!assessment.recurrence) return;

    const nextDate = new Date(assessment.scheduledDate);

    switch (assessment.recurrence.frequency) {
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'annually':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    this.scheduleAssessment({
      type: assessment.type,
      title: assessment.title,
      description: assessment.description,
      scheduledDate: nextDate,
      status: 'scheduled',
      responsibleParty: assessment.responsibleParty,
      requires3PAO: assessment.requires3PAO,
      thirdPartyAssessor: assessment.thirdPartyAssessor,
      controlsInScope: assessment.controlsInScope,
      deliverables: assessment.deliverables,
      documents: [],
      recurrence: assessment.recurrence,
    });
  }

  /**
   * Create standard FedRAMP assessment schedule
   */
  createStandardSchedule(): void {
    const now = new Date();

    // Monthly vulnerability scans
    this.scheduleAssessment({
      type: 'monthly-scan',
      title: 'Monthly Vulnerability Scan',
      description: 'FedRAMP required monthly vulnerability scanning of all system components',
      scheduledDate: this.getNextMonthlyDate(now),
      status: 'scheduled',
      responsibleParty: 'Security Operations',
      requires3PAO: false,
      controlsInScope: ['RA-5', 'SI-2'],
      deliverables: ['Vulnerability scan report', 'POA&M updates'],
      documents: [],
      recurrence: { frequency: 'monthly', dayOfMonth: 15 },
    });

    // Quarterly security assessments
    this.scheduleAssessment({
      type: 'quarterly-assessment',
      title: 'Quarterly Security Assessment',
      description: 'Quarterly assessment of security controls subset',
      scheduledDate: this.getNextQuarterlyDate(now),
      status: 'scheduled',
      responsibleParty: 'Security Team',
      requires3PAO: false,
      controlsInScope: [], // Will be determined by assessment plan
      deliverables: ['Security assessment report', 'Control test results'],
      documents: [],
      recurrence: { frequency: 'quarterly' },
    });

    // Annual penetration test
    this.scheduleAssessment({
      type: 'penetration-test',
      title: 'Annual Penetration Test',
      description: 'Annual penetration testing by qualified assessor',
      scheduledDate: this.getNextAnnualDate(now),
      status: 'scheduled',
      responsibleParty: 'CISO',
      requires3PAO: true,
      controlsInScope: ['CA-8', 'RA-5'],
      deliverables: ['Penetration test report', 'Finding remediation plan'],
      documents: [],
      recurrence: { frequency: 'annually' },
    });

    // Annual assessment
    this.scheduleAssessment({
      type: 'annual-assessment',
      title: 'Annual Security Assessment',
      description: 'Comprehensive annual security assessment of all controls',
      scheduledDate: this.getNextAnnualDate(now),
      status: 'scheduled',
      responsibleParty: 'CISO',
      requires3PAO: true,
      controlsInScope: [], // All controls
      deliverables: ['Security Assessment Report (SAR)', 'POA&M', 'Updated SSP'],
      documents: [],
      recurrence: { frequency: 'annually' },
    });

    logger.info('Standard FedRAMP assessment schedule created');
  }

  private getNextMonthlyDate(from: Date): Date {
    const next = new Date(from);
    next.setMonth(next.getMonth() + 1);
    next.setDate(15);
    return next;
  }

  private getNextQuarterlyDate(from: Date): Date {
    const next = new Date(from);
    const currentQuarter = Math.floor(next.getMonth() / 3);
    next.setMonth((currentQuarter + 1) * 3);
    next.setDate(1);
    return next;
  }

  private getNextAnnualDate(from: Date): Date {
    const next = new Date(from);
    next.setFullYear(next.getFullYear() + 1);
    next.setMonth(0);
    next.setDate(15);
    return next;
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate ConMon status report
   */
  generateStatusReport(): ConMonStatusReport {
    const vulns = Array.from(this.vulnerabilities.values());
    const openVulns = vulns.filter((v) => v.status === 'open' || v.status === 'in-progress');
    const overdueVulns = vulns.filter((v) => v.status === 'open' && v.daysOverdue > 0);

    const vulnsBySeverity = {
      critical: openVulns.filter((v) => v.severity === 'critical').length,
      high: openVulns.filter((v) => v.severity === 'high').length,
      moderate: openVulns.filter((v) => v.severity === 'moderate').length,
      low: openVulns.filter((v) => v.severity === 'low').length,
    };

    const assessments = Array.from(this.assessments.values());
    const overdueAssessments = assessments.filter((a) => a.status === 'overdue');
    const upcomingAssessments = assessments
      .filter((a) => a.status === 'scheduled')
      .slice(0, 5);

    const lastScan = this.scanHistory.length > 0
      ? this.scanHistory[this.scanHistory.length - 1]
      : undefined;

    return {
      generatedAt: new Date(),
      systemName: this.config.systemName,
      authorizationLevel: this.config.authorizationLevel,
      atoStatus: this.getATOStatus(),
      vulnerabilitySummary: {
        total: openVulns.length,
        bySeverity: vulnsBySeverity,
        overdue: overdueVulns.length,
        averageAge: this.calculateAverageVulnerabilityAge(openVulns),
      },
      scanCompliance: {
        lastScanDate: lastScan?.endTime,
        lastScanType: lastScan?.scanType,
        dayssinceLastScan: lastScan
          ? Math.floor((Date.now() - lastScan.endTime.getTime()) / (1000 * 60 * 60 * 24))
          : undefined,
        monthlyScansCompleted: this.getMonthlyScansCompleted(),
        scanComplianceRate: this.calculateScanComplianceRate(),
      },
      assessmentStatus: {
        overdueCount: overdueAssessments.length,
        upcomingAssessments: upcomingAssessments.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          scheduledDate: a.scheduledDate,
        })),
      },
      recommendations: this.generateRecommendations(openVulns, overdueVulns, overdueAssessments),
    };
  }

  private getATOStatus(): 'active' | 'expiring-soon' | 'expired' {
    const now = new Date();
    const expiration = this.config.atoExpirationDate;
    const daysUntilExpiration = Math.floor(
      (expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiration < 0) return 'expired';
    if (daysUntilExpiration < 90) return 'expiring-soon';
    return 'active';
  }

  private calculateAverageVulnerabilityAge(vulns: VulnerabilityFinding[]): number {
    if (vulns.length === 0) return 0;

    const now = new Date();
    const totalAge = vulns.reduce((sum, v) => {
      const age = Math.floor(
        (now.getTime() - v.firstDetected.getTime()) / (1000 * 60 * 60 * 24)
      );
      return sum + age;
    }, 0);

    return Math.round(totalAge / vulns.length);
  }

  private getMonthlyScansCompleted(): number {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    return this.scanHistory.filter(
      (s) => s.endTime >= oneYearAgo && s.scanType === 'vulnerability'
    ).length;
  }

  private calculateScanComplianceRate(): number {
    const monthlyScans = this.getMonthlyScansCompleted();
    return Math.round((monthlyScans / 12) * 100);
  }

  private generateRecommendations(
    openVulns: VulnerabilityFinding[],
    overdueVulns: VulnerabilityFinding[],
    overdueAssessments: ScheduledAssessment[]
  ): string[] {
    const recommendations: string[] = [];

    if (overdueVulns.length > 0) {
      recommendations.push(
        `Address ${overdueVulns.length} overdue vulnerabilities immediately to maintain FedRAMP compliance`
      );
    }

    const criticalVulns = openVulns.filter((v) => v.severity === 'critical');
    if (criticalVulns.length > 0) {
      recommendations.push(
        `Prioritize remediation of ${criticalVulns.length} critical vulnerabilities within 30 days`
      );
    }

    if (overdueAssessments.length > 0) {
      recommendations.push(
        `Complete ${overdueAssessments.length} overdue assessments and submit required ConMon deliverables`
      );
    }

    if (this.getATOStatus() === 'expiring-soon') {
      recommendations.push('Initiate ATO reauthorization process - authorization expiring within 90 days');
    }

    const scanCompliance = this.calculateScanComplianceRate();
    if (scanCompliance < 100) {
      recommendations.push(`Improve scan compliance rate (currently ${scanCompliance}%) to meet monthly scanning requirements`);
    }

    return recommendations;
  }

  // ===========================================================================
  // EVIDENCE COLLECTION
  // ===========================================================================

  /**
   * Collect evidence from scan results
   */
  collectScanEvidence(scanId: string): Evidence[] {
    const scan = this.scanResults.get(scanId);
    if (!scan) {
      throw new Error(`Scan not found: ${scanId}`);
    }

    const evidence: Evidence[] = [
      {
        id: `${scanId}-summary`,
        type: 'test-result',
        title: `${scan.scannerName} Vulnerability Scan - ${scan.endTime.toISOString().split('T')[0]}`,
        description: `Vulnerability scan results: ${scan.findings.length} findings (${scan.findingCounts.critical} critical, ${scan.findingCounts.high} high, ${scan.findingCounts.moderate} moderate, ${scan.findingCounts.low} low)`,
        source: scan.scannerName,
        collectedAt: scan.endTime,
        reference: scan.rawReportRef,
        metadata: {
          scanId: scan.id,
          scanType: scan.scanType,
          totalTargets: scan.totalTargets,
          duration: scan.durationSeconds,
        },
      },
    ];

    return evidence;
  }
}

// =============================================================================
// TYPES FOR STATUS REPORT
// =============================================================================

export interface ConMonStatusReport {
  generatedAt: Date;
  systemName: string;
  authorizationLevel: 'low' | 'moderate' | 'high';
  atoStatus: 'active' | 'expiring-soon' | 'expired';
  vulnerabilitySummary: {
    total: number;
    bySeverity: Record<VulnerabilitySeverity, number>;
    overdue: number;
    averageAge: number;
  };
  scanCompliance: {
    lastScanDate?: Date;
    lastScanType?: ScanType;
    dayssinceLastScan?: number;
    monthlyScansCompleted: number;
    scanComplianceRate: number;
  };
  assessmentStatus: {
    overdueCount: number;
    upcomingAssessments: Array<{
      id: string;
      title: string;
      type: AssessmentType;
      scheduledDate: Date;
    }>;
  };
  recommendations: string[];
}

// =============================================================================
// EXPORTS
// =============================================================================

export default ContinuousMonitoringService;
