/**
 * Compliance Report Generation
 *
 * Generates compliance reports in various formats for SOC 2, NIST 800-53,
 * and other supported frameworks. Supports JSON, PDF, and HTML output.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import type {
  ComplianceReport,
  ControlAssessment,
  Finding,
  Evidence,
  ReportSummary,
  ComplianceFramework,
  ComplianceControl,
  ImplementationStatus,
  FindingSeverity,
} from './types.js';
import {
  complianceReportSchema,
  findingSeveritySchema,
} from './types.js';

const logger = createLogger({ component: 'compliance-reports' });

// =============================================================================
// REPORT GENERATION OPTIONS
// =============================================================================

/**
 * Options for generating compliance reports
 */
export interface ReportGenerationOptions {
  /** Report format */
  format: 'json' | 'pdf' | 'html';
  /** Include raw evidence in report */
  includeRawEvidence?: boolean;
  /** Include automated test results */
  includeTestResults?: boolean;
  /** Include recommendations */
  includeRecommendations?: boolean;
  /** Report preparer name */
  preparedBy?: string;
  /** Report reviewer name */
  reviewedBy?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export const reportGenerationOptionsSchema = z.object({
  format: z.enum(['json', 'pdf', 'html']),
  includeRawEvidence: z.boolean().optional(),
  includeTestResults: z.boolean().optional(),
  includeRecommendations: z.boolean().optional(),
  preparedBy: z.string().optional(),
  reviewedBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// REPORT GENERATOR
// =============================================================================

/**
 * Compliance report generator
 */
export class ReportGenerator {
  /**
   * Generate a compliance report for a framework
   */
  async generateReport(
    framework: ComplianceFramework,
    assessments: ControlAssessment[],
    findings: Finding[],
    period: { start: Date; end: Date },
    options: ReportGenerationOptions
  ): Promise<ComplianceReport> {
    logger.info(
      { frameworkId: framework.id, controlCount: assessments.length },
      'Generating compliance report'
    );

    const summary = this.calculateSummary(assessments);
    const recommendations = options.includeRecommendations
      ? this.generateRecommendations(framework, assessments, findings)
      : [];

    const report: ComplianceReport = {
      id: randomUUID(),
      framework: framework.name,
      frameworkVersion: framework.version,
      generatedAt: new Date(),
      period,
      summary,
      controls: assessments,
      findings: findings.sort(
        (a, b) => this.severityWeight(b.severity) - this.severityWeight(a.severity)
      ),
      recommendations,
      preparedBy: options.preparedBy,
      reviewedBy: options.reviewedBy,
      metadata: {
        ...options.metadata,
        frameworkId: framework.id,
        generationOptions: {
          format: options.format,
          includeRawEvidence: options.includeRawEvidence,
          includeTestResults: options.includeTestResults,
        },
      },
    };

    // Validate report structure
    complianceReportSchema.parse(report);

    logger.info(
      {
        reportId: report.id,
        compliancePercentage: report.summary.compliancePercentage,
        findingsCount: report.findings.length,
      },
      'Compliance report generated'
    );

    return report;
  }

  /**
   * Calculate summary statistics from assessments
   */
  private calculateSummary(assessments: ControlAssessment[]): ReportSummary {
    const statusCounts: Record<ImplementationStatus, number> = {
      implemented: 0,
      'partially-implemented': 0,
      planned: 0,
      'not-applicable': 0,
    };

    let automatedTestsPassed = 0;
    let automatedTestsFailed = 0;

    for (const assessment of assessments) {
      statusCounts[assessment.status]++;

      if (assessment.automatedTestPassed !== undefined) {
        if (assessment.automatedTestPassed) {
          automatedTestsPassed++;
        } else {
          automatedTestsFailed++;
        }
      }
    }

    const totalControls = assessments.length;
    const applicableControls = totalControls - statusCounts['not-applicable'];
    const compliancePercentage =
      applicableControls > 0
        ? Math.round(
            ((statusCounts.implemented + statusCounts['partially-implemented'] * 0.5) /
              applicableControls) *
              100
          )
        : 100;

    return {
      totalControls,
      implemented: statusCounts.implemented,
      partiallyImplemented: statusCounts['partially-implemented'],
      planned: statusCounts.planned,
      notApplicable: statusCounts['not-applicable'],
      automatedTestsPassed,
      automatedTestsFailed,
      compliancePercentage,
    };
  }

  /**
   * Generate recommendations based on assessments and findings
   */
  private generateRecommendations(
    framework: ComplianceFramework,
    assessments: ControlAssessment[],
    findings: Finding[]
  ): string[] {
    const recommendations: string[] = [];

    // Priority 1: Address critical and high severity findings
    const criticalFindings = findings.filter(
      (f) => f.severity === 'critical' && f.status !== 'remediated'
    );
    const highFindings = findings.filter(
      (f) => f.severity === 'high' && f.status !== 'remediated'
    );

    if (criticalFindings.length > 0) {
      recommendations.push(
        `Immediately address ${criticalFindings.length} critical finding(s): ${criticalFindings.map((f) => f.title).join(', ')}`
      );
    }

    if (highFindings.length > 0) {
      recommendations.push(
        `Prioritize remediation of ${highFindings.length} high severity finding(s) within 30 days`
      );
    }

    // Priority 2: Complete partially implemented controls
    const partialControls = assessments.filter(
      (a) => a.status === 'partially-implemented'
    );
    if (partialControls.length > 0) {
      recommendations.push(
        `Complete implementation of ${partialControls.length} partially implemented control(s) to achieve full compliance`
      );
    }

    // Priority 3: Address planned controls
    const plannedControls = assessments.filter((a) => a.status === 'planned');
    if (plannedControls.length > 0) {
      recommendations.push(
        `Accelerate implementation of ${plannedControls.length} planned control(s) according to risk prioritization`
      );
    }

    // Priority 4: Improve automated testing coverage
    const controlsWithoutTests = assessments.filter(
      (a) => a.automatedTestPassed === undefined && a.status !== 'not-applicable'
    );
    if (controlsWithoutTests.length > 5) {
      recommendations.push(
        `Expand automated testing coverage to ${controlsWithoutTests.length} controls currently without automated verification`
      );
    }

    // Priority 5: Evidence gaps
    const controlsWithLowEvidence = assessments.filter(
      (a) => a.evidence.length < 2 && a.status === 'implemented'
    );
    if (controlsWithLowEvidence.length > 0) {
      recommendations.push(
        `Strengthen evidence collection for ${controlsWithLowEvidence.length} implemented control(s) with limited documentation`
      );
    }

    // Priority 6: Failed automated tests
    const failedTests = assessments.filter((a) => a.automatedTestPassed === false);
    if (failedTests.length > 0) {
      recommendations.push(
        `Investigate and remediate ${failedTests.length} control(s) with failing automated tests`
      );
    }

    return recommendations;
  }

  /**
   * Get severity weight for sorting
   */
  private severityWeight(severity: FindingSeverity): number {
    const weights: Record<FindingSeverity, number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      informational: 1,
    };
    return weights[severity];
  }

  /**
   * Format report as JSON string
   */
  formatAsJson(report: ComplianceReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as HTML
   */
  formatAsHtml(report: ComplianceReport): string {
    const statusColors: Record<ImplementationStatus, string> = {
      implemented: '#28a745',
      'partially-implemented': '#ffc107',
      planned: '#17a2b8',
      'not-applicable': '#6c757d',
    };

    const severityColors: Record<FindingSeverity, string> = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#17a2b8',
      informational: '#6c757d',
    };

    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Compliance Report - ${escapeHtml(report.framework)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1, h2, h3 { color: #333; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin: 20px 0; }
    .summary-card { padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; }
    .summary-card .value { font-size: 2em; font-weight: bold; color: #333; }
    .summary-card .label { color: #666; font-size: 0.9em; }
    .compliance-meter { height: 24px; background: #e9ecef; border-radius: 12px; overflow: hidden; margin: 20px 0; }
    .compliance-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.5s; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { background: #f8f9fa; font-weight: 600; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.85em; color: white; }
    .finding { margin: 15px 0; padding: 15px; border-left: 4px solid; background: #f8f9fa; }
    .recommendation { margin: 10px 0; padding: 10px 15px; background: #e7f5ff; border-radius: 4px; }
    .meta-info { color: #666; font-size: 0.9em; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Compliance Report</h1>
    <h2>${escapeHtml(report.framework)} ${escapeHtml(report.frameworkVersion)}</h2>
    <p>Assessment Period: ${report.period.start.toLocaleDateString()} - ${report.period.end.toLocaleDateString()}</p>

    <h3>Summary</h3>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="value">${report.summary.totalControls}</div>
        <div class="label">Total Controls</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: #28a745">${report.summary.implemented}</div>
        <div class="label">Implemented</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: #ffc107">${report.summary.partiallyImplemented}</div>
        <div class="label">Partially Implemented</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: #17a2b8">${report.summary.planned}</div>
        <div class="label">Planned</div>
      </div>
      <div class="summary-card">
        <div class="value">${report.summary.compliancePercentage}%</div>
        <div class="label">Compliance Score</div>
      </div>
    </div>

    <div class="compliance-meter">
      <div class="compliance-fill" style="width: ${report.summary.compliancePercentage}%"></div>
    </div>

    ${
      report.findings.length > 0
        ? `
    <h3>Findings (${report.findings.length})</h3>
    ${report.findings
      .map(
        (f) => `
      <div class="finding" style="border-color: ${severityColors[f.severity]}">
        <strong>${escapeHtml(f.title)}</strong>
        <span class="status-badge" style="background: ${severityColors[f.severity]}; margin-left: 10px;">${f.severity}</span>
        <p>${escapeHtml(f.description)}</p>
        <small>Status: ${f.status} | Related Controls: ${f.relatedControls.join(', ')}</small>
      </div>
    `
      )
      .join('')}
    `
        : ''
    }

    ${
      report.recommendations.length > 0
        ? `
    <h3>Recommendations</h3>
    ${report.recommendations.map((r) => `<div class="recommendation">${escapeHtml(r)}</div>`).join('')}
    `
        : ''
    }

    <h3>Control Assessments</h3>
    <table>
      <thead>
        <tr>
          <th>Control ID</th>
          <th>Control Name</th>
          <th>Status</th>
          <th>Automated Test</th>
          <th>Evidence Count</th>
        </tr>
      </thead>
      <tbody>
        ${report.controls
          .map(
            (c) => `
          <tr>
            <td>${escapeHtml(c.controlId)}</td>
            <td>${escapeHtml(c.controlName)}</td>
            <td><span class="status-badge" style="background: ${statusColors[c.status]}">${c.status}</span></td>
            <td>${c.automatedTestPassed === undefined ? 'N/A' : c.automatedTestPassed ? 'Passed' : 'Failed'}</td>
            <td>${c.evidence.length}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <div class="meta-info">
      <p>Report ID: ${report.id}</p>
      <p>Generated: ${report.generatedAt.toISOString()}</p>
      ${report.preparedBy ? `<p>Prepared by: ${escapeHtml(report.preparedBy)}</p>` : ''}
      ${report.reviewedBy ? `<p>Reviewed by: ${escapeHtml(report.reviewedBy)}</p>` : ''}
    </div>
  </div>
</body>
</html>`;
  }
}

// =============================================================================
// EVIDENCE COLLECTOR
// =============================================================================

/**
 * Evidence collector for automated evidence gathering
 */
export class EvidenceCollector {
  private hashAlgorithm: 'sha256' | 'sha384' | 'sha512';

  constructor(hashAlgorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256') {
    this.hashAlgorithm = hashAlgorithm;
  }

  /**
   * Collect evidence from audit logs
   */
  async collectLogEvidence(
    title: string,
    description: string,
    source: string,
    content: string
  ): Promise<Evidence> {
    logger.debug({ source, title }, 'Collecting log evidence');

    return {
      id: randomUUID(),
      type: 'log',
      title,
      description,
      source,
      collectedAt: new Date(),
      contentHash: this.hashContent(content),
      content,
    };
  }

  /**
   * Collect evidence from configuration
   */
  async collectConfigEvidence(
    title: string,
    description: string,
    source: string,
    content: string
  ): Promise<Evidence> {
    logger.debug({ source, title }, 'Collecting config evidence');

    return {
      id: randomUUID(),
      type: 'config',
      title,
      description,
      source,
      collectedAt: new Date(),
      contentHash: this.hashContent(content),
      content,
    };
  }

  /**
   * Collect evidence from API response
   */
  async collectApiEvidence(
    title: string,
    description: string,
    source: string,
    response: unknown
  ): Promise<Evidence> {
    logger.debug({ source, title }, 'Collecting API evidence');

    const content = JSON.stringify(response, null, 2);

    return {
      id: randomUUID(),
      type: 'api-response',
      title,
      description,
      source,
      collectedAt: new Date(),
      contentHash: this.hashContent(content),
      content,
    };
  }

  /**
   * Collect evidence from test results
   */
  async collectTestEvidence(
    title: string,
    description: string,
    source: string,
    testResult: { passed: boolean; details: string }
  ): Promise<Evidence> {
    logger.debug({ source, title, passed: testResult.passed }, 'Collecting test evidence');

    const content = JSON.stringify(testResult, null, 2);

    return {
      id: randomUUID(),
      type: 'test-result',
      title,
      description,
      source,
      collectedAt: new Date(),
      contentHash: this.hashContent(content),
      content,
      metadata: {
        passed: testResult.passed,
      },
    };
  }

  /**
   * Hash content for integrity verification
   */
  private hashContent(content: string): string {
    return createHash(this.hashAlgorithm).update(content).digest('hex');
  }

  /**
   * Verify evidence integrity
   */
  verifyEvidenceIntegrity(evidence: Evidence): boolean {
    if (!evidence.contentHash || !evidence.content) {
      return true; // No hash to verify
    }

    const expectedHash = this.hashContent(evidence.content);
    return evidence.contentHash === expectedHash;
  }
}

// =============================================================================
// FINDING GENERATOR
// =============================================================================

/**
 * Finding generator for identifying compliance gaps
 */
export class FindingGenerator {
  /**
   * Generate findings from control assessments
   */
  generateFindings(
    assessments: ControlAssessment[],
    framework: ComplianceFramework
  ): Finding[] {
    const findings: Finding[] = [];

    for (const assessment of assessments) {
      // Finding for failed automated tests
      if (assessment.automatedTestPassed === false) {
        findings.push(this.createFinding(
          `Automated test failure for ${assessment.controlId}`,
          `The automated compliance test for control ${assessment.controlId} (${assessment.controlName}) has failed. This indicates a potential control deficiency that requires investigation.`,
          'high',
          [assessment.controlId],
          assessment.gaps
        ));
      }

      // Finding for planned controls that should be implemented
      if (assessment.status === 'planned') {
        const control = framework.controls.find((c) => c.id === assessment.controlId);
        if (control?.priority === 'P1') {
          findings.push(this.createFinding(
            `Priority 1 control not implemented: ${assessment.controlId}`,
            `Control ${assessment.controlId} (${assessment.controlName}) is marked as planned but is a Priority 1 control that should be implemented immediately.`,
            'high',
            [assessment.controlId]
          ));
        }
      }

      // Finding for partially implemented controls
      if (assessment.status === 'partially-implemented' && assessment.gaps) {
        const severity = this.determineSeverityFromGaps(assessment.gaps);
        findings.push(this.createFinding(
          `Partial implementation gaps in ${assessment.controlId}`,
          `Control ${assessment.controlId} (${assessment.controlName}) is only partially implemented. Gaps identified: ${assessment.gaps.join('; ')}`,
          severity,
          [assessment.controlId],
          assessment.gaps
        ));
      }

      // Finding for insufficient evidence
      if (
        assessment.status === 'implemented' &&
        assessment.evidence.length === 0
      ) {
        findings.push(this.createFinding(
          `Missing evidence for ${assessment.controlId}`,
          `Control ${assessment.controlId} (${assessment.controlName}) is marked as implemented but has no supporting evidence documented.`,
          'medium',
          [assessment.controlId]
        ));
      }
    }

    return findings;
  }

  /**
   * Create a finding
   */
  private createFinding(
    title: string,
    description: string,
    severity: FindingSeverity,
    relatedControls: string[],
    gaps?: string[]
  ): Finding {
    return {
      id: randomUUID(),
      title,
      description,
      severity,
      relatedControls,
      identifiedAt: new Date(),
      status: 'open',
      remediationPlan: gaps
        ? `Address the following gaps: ${gaps.join('; ')}`
        : undefined,
    };
  }

  /**
   * Determine severity based on gaps
   */
  private determineSeverityFromGaps(gaps: string[]): FindingSeverity {
    const gapText = gaps.join(' ').toLowerCase();

    if (
      gapText.includes('critical') ||
      gapText.includes('security breach') ||
      gapText.includes('data exposure')
    ) {
      return 'critical';
    }

    if (
      gapText.includes('high risk') ||
      gapText.includes('vulnerability') ||
      gapText.includes('unauthorized')
    ) {
      return 'high';
    }

    if (
      gapText.includes('moderate') ||
      gapText.includes('improvement') ||
      gapText.includes('documentation')
    ) {
      return 'medium';
    }

    return 'low';
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const reportGenerator = new ReportGenerator();
export const evidenceCollector = new EvidenceCollector();
export const findingGenerator = new FindingGenerator();
