/**
 * Compliance Reporting
 * Vendor risk reports, board summaries, audit trails, and regulatory reports
 */

import {
  VendorRiskReport,
  ReportType,
  ReportSummary,
  ReportSection,
  ReportAttachment,
  ChartData,
  TableData,
  TrustScore,
  RiskAssessment,
  VendorInfo,
  ComplianceCertification,
  Contract,
  Alert,
  HealthEvent,
  AuditLogEntry,
  PaginatedResponse,
  TrustGrade,
  RiskLevel,
  TrustTrend,
} from './types';

// ============================================================================
// Reporting Service Configuration
// ============================================================================

export interface ReportingServiceConfig {
  storage: ReportStorage;
  auditLogger: AuditLogger;
  templateEngine: TemplateEngine;
  exportService: ExportService;
  dataProviders: ReportDataProviders;
}

export interface ReportDataProviders {
  getVendorInfo(vendorId: string): Promise<VendorInfo>;
  getTrustScore(vendorId: string): Promise<TrustScore>;
  getTrustScoreHistory(vendorId: string, days: number): Promise<TrustScore[]>;
  getRiskAssessment(vendorId: string): Promise<RiskAssessment>;
  getCertifications(vendorId: string): Promise<ComplianceCertification[]>;
  getContracts(vendorId: string): Promise<Contract[]>;
  getAlerts(vendorId: string, days: number): Promise<Alert[]>;
  getHealthEvents(vendorId: string, days: number): Promise<HealthEvent[]>;
}

// ============================================================================
// Reporting Service
// ============================================================================

export class ReportingService {
  private readonly config: ReportingServiceConfig;

  constructor(config: ReportingServiceConfig) {
    this.config = config;
  }

  // ============================================================================
  // Report Generation
  // ============================================================================

  async generateVendorAssessmentReport(
    vendorId: string,
    options: ReportOptions = {},
  ): Promise<VendorRiskReport> {
    const vendor = await this.config.dataProviders.getVendorInfo(vendorId);
    const trustScore = await this.config.dataProviders.getTrustScore(vendorId);
    const riskAssessment = await this.config.dataProviders.getRiskAssessment(vendorId);
    const certifications = await this.config.dataProviders.getCertifications(vendorId);
    const contracts = await this.config.dataProviders.getContracts(vendorId);
    const alerts = await this.config.dataProviders.getAlerts(vendorId, 90);
    const healthEvents = await this.config.dataProviders.getHealthEvents(vendorId, 90);

    const now = new Date();
    const periodStart = options.periodStart || new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const periodEnd = options.periodEnd || now;

    const report: VendorRiskReport = {
      id: this.generateReportId(),
      vendorId,
      generatedAt: now,
      periodStart,
      periodEnd,
      generatedBy: options.generatedBy || 'system',
      type: 'vendor_assessment',
      format: options.format || 'json',
      summary: this.generateReportSummary(vendor, trustScore, riskAssessment, alerts),
      sections: [
        this.generateExecutiveSummarySection(vendor, trustScore, riskAssessment),
        this.generateTrustScoreSection(trustScore),
        this.generateRiskAssessmentSection(riskAssessment),
        this.generateComplianceSection(certifications),
        this.generateContractsSection(contracts),
        this.generateSecurityEventsSection(healthEvents, alerts),
        this.generateRecommendationsSection(riskAssessment),
      ],
      attachments: [],
    };

    await this.config.storage.saveReport(report);

    await this.config.auditLogger.log({
      action: 'report.generated',
      actorId: options.generatedBy || 'system',
      resourceType: 'report',
      resourceId: report.id,
      details: { vendorId, reportType: 'vendor_assessment' },
    });

    return report;
  }

  async generatePeriodicReviewReport(
    vendorId: string,
    options: ReportOptions = {},
  ): Promise<VendorRiskReport> {
    const vendor = await this.config.dataProviders.getVendorInfo(vendorId);
    const trustScore = await this.config.dataProviders.getTrustScore(vendorId);
    const trustScoreHistory = await this.config.dataProviders.getTrustScoreHistory(vendorId, 365);
    const riskAssessment = await this.config.dataProviders.getRiskAssessment(vendorId);
    const certifications = await this.config.dataProviders.getCertifications(vendorId);
    const contracts = await this.config.dataProviders.getContracts(vendorId);
    const alerts = await this.config.dataProviders.getAlerts(vendorId, 365);

    const now = new Date();
    const periodStart = options.periodStart || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const periodEnd = options.periodEnd || now;

    const report: VendorRiskReport = {
      id: this.generateReportId(),
      vendorId,
      generatedAt: now,
      periodStart,
      periodEnd,
      generatedBy: options.generatedBy || 'system',
      type: 'periodic_review',
      format: options.format || 'json',
      summary: this.generateReportSummary(vendor, trustScore, riskAssessment, alerts),
      sections: [
        this.generateExecutiveSummarySection(vendor, trustScore, riskAssessment),
        this.generateTrendAnalysisSection(trustScoreHistory),
        this.generateYearOverYearSection(trustScoreHistory, alerts),
        this.generateComplianceTimelineSection(certifications),
        this.generateContractReviewSection(contracts),
        this.generateIncidentSummarySection(alerts),
        this.generateActionItemsSection(riskAssessment, certifications, contracts),
      ],
      attachments: [],
    };

    await this.config.storage.saveReport(report);

    return report;
  }

  async generateBoardSummaryReport(
    vendorIds: string[],
    options: ReportOptions = {},
  ): Promise<VendorRiskReport> {
    const vendorData: BoardVendorData[] = [];

    for (const vendorId of vendorIds) {
      const vendor = await this.config.dataProviders.getVendorInfo(vendorId);
      const trustScore = await this.config.dataProviders.getTrustScore(vendorId);
      const riskAssessment = await this.config.dataProviders.getRiskAssessment(vendorId);
      const alerts = await this.config.dataProviders.getAlerts(vendorId, 90);

      vendorData.push({
        vendor,
        trustScore,
        riskAssessment,
        criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
        openAlerts: alerts.filter(a => a.status === 'open').length,
      });
    }

    const now = new Date();

    const report: VendorRiskReport = {
      id: this.generateReportId(),
      vendorId: 'portfolio',
      generatedAt: now,
      periodStart: options.periodStart || new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      periodEnd: options.periodEnd || now,
      generatedBy: options.generatedBy || 'system',
      type: 'board_summary',
      format: options.format || 'json',
      summary: this.generatePortfolioSummary(vendorData),
      sections: [
        this.generatePortfolioOverviewSection(vendorData),
        this.generateRiskDistributionSection(vendorData),
        this.generateCriticalVendorsSection(vendorData),
        this.generateTrendHighlightsSection(vendorData),
        this.generateKeyMetricsSection(vendorData),
        this.generateStrategicRecommendationsSection(vendorData),
      ],
      attachments: [],
    };

    await this.config.storage.saveReport(report);

    return report;
  }

  async generateRegulatoryReport(
    vendorId: string,
    regulation: string,
    options: ReportOptions = {},
  ): Promise<VendorRiskReport> {
    const vendor = await this.config.dataProviders.getVendorInfo(vendorId);
    const trustScore = await this.config.dataProviders.getTrustScore(vendorId);
    const riskAssessment = await this.config.dataProviders.getRiskAssessment(vendorId);
    const certifications = await this.config.dataProviders.getCertifications(vendorId);
    const contracts = await this.config.dataProviders.getContracts(vendorId);
    const auditTrail = await this.getAuditTrail(vendorId, options.periodStart, options.periodEnd);

    const now = new Date();

    const report: VendorRiskReport = {
      id: this.generateReportId(),
      vendorId,
      generatedAt: now,
      periodStart: options.periodStart || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
      periodEnd: options.periodEnd || now,
      generatedBy: options.generatedBy || 'system',
      type: 'regulatory_submission',
      format: options.format || 'json',
      summary: this.generateRegulatoryReportSummary(vendor, trustScore, regulation),
      sections: this.generateRegulatorySections(
        regulation,
        vendor,
        trustScore,
        riskAssessment,
        certifications,
        contracts,
        auditTrail,
      ),
      attachments: [],
    };

    await this.config.storage.saveReport(report);

    return report;
  }

  async generateIncidentReport(
    vendorId: string,
    incidentId: string,
    options: ReportOptions = {},
  ): Promise<VendorRiskReport> {
    const vendor = await this.config.dataProviders.getVendorInfo(vendorId);
    const healthEvents = await this.config.dataProviders.getHealthEvents(vendorId, 30);
    const alerts = await this.config.dataProviders.getAlerts(vendorId, 30);
    const trustScore = await this.config.dataProviders.getTrustScore(vendorId);

    const incident = healthEvents.find(e => e.id === incidentId);
    if (!incident) {
      throw new ReportingError('INCIDENT_NOT_FOUND', `Incident ${incidentId} not found`);
    }

    const now = new Date();

    const report: VendorRiskReport = {
      id: this.generateReportId(),
      vendorId,
      generatedAt: now,
      periodStart: incident.detectedAt,
      periodEnd: incident.resolvedAt || now,
      generatedBy: options.generatedBy || 'system',
      type: 'incident_report',
      format: options.format || 'json',
      summary: this.generateIncidentSummary(incident, vendor),
      sections: [
        this.generateIncidentOverviewSection(incident),
        this.generateIncidentTimelineSection(incident, alerts),
        this.generateImpactAnalysisSection(incident, trustScore),
        this.generateRemediationSection(incident),
        this.generateLessonsLearnedSection(incident),
      ],
      attachments: [],
    };

    await this.config.storage.saveReport(report);

    return report;
  }

  // ============================================================================
  // Report Export
  // ============================================================================

  async exportReport(
    reportId: string,
    format: 'pdf' | 'csv' | 'excel' | 'json',
  ): Promise<ExportResult> {
    const report = await this.config.storage.getReport(reportId);
    if (!report) {
      throw new ReportingError('REPORT_NOT_FOUND', `Report ${reportId} not found`);
    }

    const exportResult = await this.config.exportService.export(report, format);

    await this.config.auditLogger.log({
      action: 'report.exported',
      actorId: 'system',
      resourceType: 'report',
      resourceId: reportId,
      details: { format },
    });

    return exportResult;
  }

  async scheduleReport(schedule: ReportSchedule): Promise<void> {
    await this.config.storage.saveSchedule(schedule);
  }

  // ============================================================================
  // Audit Trail
  // ============================================================================

  async getAuditTrail(
    vendorId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<AuditLogEntry[]> {
    return this.config.storage.getAuditTrail(vendorId, startDate, endDate);
  }

  async exportAuditTrail(
    vendorId: string,
    startDate: Date,
    endDate: Date,
    format: 'csv' | 'json',
  ): Promise<ExportResult> {
    const auditTrail = await this.getAuditTrail(vendorId, startDate, endDate);

    const exportData = {
      vendorId,
      periodStart: startDate,
      periodEnd: endDate,
      entries: auditTrail,
    };

    return this.config.exportService.exportAuditTrail(exportData, format);
  }

  // ============================================================================
  // Report Queries
  // ============================================================================

  async getReport(reportId: string): Promise<VendorRiskReport | null> {
    return this.config.storage.getReport(reportId);
  }

  async listReports(options: ListReportsOptions): Promise<PaginatedResponse<VendorRiskReport>> {
    return this.config.storage.listReports(options);
  }

  async getVendorReports(vendorId: string): Promise<VendorRiskReport[]> {
    const result = await this.config.storage.listReports({ vendorId });
    return result.data;
  }

  // ============================================================================
  // Summary Generation
  // ============================================================================

  private generateReportSummary(
    vendor: VendorInfo,
    trustScore: TrustScore,
    riskAssessment: RiskAssessment,
    alerts: Alert[],
  ): ReportSummary {
    const criticalIssues = alerts.filter(
      a => a.severity === 'critical' && a.status !== 'resolved',
    ).length;

    const openActions = riskAssessment.requiredActions.filter(
      a => a.status !== 'completed',
    ).length;

    return {
      overallRisk: riskAssessment.overallRisk,
      trustScore: trustScore.score,
      trustGrade: trustScore.grade,
      keyFindings: this.extractKeyFindings(trustScore, riskAssessment),
      criticalIssues,
      openActions,
      trend: trustScore.trend,
    };
  }

  private generatePortfolioSummary(vendorData: BoardVendorData[]): ReportSummary {
    const avgScore = vendorData.reduce((sum, v) => sum + v.trustScore.score, 0) / vendorData.length;
    const avgGrade = this.scoreToGrade(avgScore);

    const criticalCount = vendorData.filter(v => v.riskAssessment.overallRisk === 'critical').length;
    const highCount = vendorData.filter(v => v.riskAssessment.overallRisk === 'high').length;

    const totalCriticalAlerts = vendorData.reduce((sum, v) => sum + v.criticalAlerts, 0);

    const overallRisk: RiskLevel =
      criticalCount > 0 ? 'critical' :
        highCount > vendorData.length * 0.2 ? 'high' :
          avgScore < 60 ? 'medium' : 'low';

    return {
      overallRisk,
      trustScore: Math.round(avgScore * 100) / 100,
      trustGrade: avgGrade,
      keyFindings: [
        `${vendorData.length} vendors in portfolio`,
        `${criticalCount} vendors at critical risk`,
        `${highCount} vendors at high risk`,
        `${totalCriticalAlerts} critical alerts across portfolio`,
      ],
      criticalIssues: totalCriticalAlerts,
      openActions: vendorData.reduce(
        (sum, v) => sum + v.riskAssessment.requiredActions.filter(a => a.status !== 'completed').length,
        0,
      ),
      trend: this.calculatePortfolioTrend(vendorData),
    };
  }

  private generateRegulatoryReportSummary(
    vendor: VendorInfo,
    trustScore: TrustScore,
    regulation: string,
  ): ReportSummary {
    return {
      overallRisk: this.scoreToRisk(trustScore.score),
      trustScore: trustScore.score,
      trustGrade: trustScore.grade,
      keyFindings: [
        `Regulatory report for ${regulation}`,
        `Vendor: ${vendor.name}`,
        `Current trust score: ${trustScore.score}`,
        `Overall grade: ${trustScore.grade}`,
      ],
      criticalIssues: 0,
      openActions: 0,
      trend: trustScore.trend,
    };
  }

  private generateIncidentSummary(incident: HealthEvent, vendor: VendorInfo): ReportSummary {
    return {
      overallRisk: incident.severity === 'critical' ? 'critical' :
        incident.severity === 'error' ? 'high' : 'medium',
      trustScore: 0,
      trustGrade: 'F',
      keyFindings: [
        `Incident: ${incident.title}`,
        `Vendor: ${vendor.name}`,
        `Detected: ${incident.detectedAt.toISOString()}`,
        incident.resolvedAt ? `Resolved: ${incident.resolvedAt.toISOString()}` : 'Status: Active',
      ],
      criticalIssues: incident.severity === 'critical' ? 1 : 0,
      openActions: incident.resolvedAt ? 0 : 1,
      trend: 'declining',
    };
  }

  // ============================================================================
  // Section Generation
  // ============================================================================

  private generateExecutiveSummarySection(
    vendor: VendorInfo,
    trustScore: TrustScore,
    riskAssessment: RiskAssessment,
  ): ReportSection {
    return {
      title: 'Executive Summary',
      order: 1,
      content: `
## Vendor Overview

**Name:** ${vendor.name}
**Category:** ${vendor.category}
**Tier:** ${vendor.tier}
**Status:** ${vendor.status}

## Risk Summary

**Trust Score:** ${trustScore.score}/100 (Grade: ${trustScore.grade})
**Overall Risk Level:** ${riskAssessment.overallRisk}
**Trend:** ${trustScore.trend}
**Confidence:** ${Math.round(trustScore.confidence * 100)}%

## Key Findings

${this.extractKeyFindings(trustScore, riskAssessment).map(f => `- ${f}`).join('\n')}

## Required Actions

${riskAssessment.requiredActions.slice(0, 5).map(a => `- **${a.action}** (Due: ${a.deadline.toISOString().split('T')[0]})`).join('\n')}
      `.trim(),
      charts: [
        this.generateTrustScoreGaugeChart(trustScore),
        this.generateRiskCategoryChart(riskAssessment),
      ],
    };
  }

  private generateTrustScoreSection(trustScore: TrustScore): ReportSection {
    const factorRows = trustScore.factors.map(f => [
      this.formatCategoryName(f.category),
      f.score.toString(),
      `${Math.round(f.weight * 100)}%`,
      f.findings.slice(0, 2).join('; ') || 'No issues',
    ]);

    return {
      title: 'Trust Score Analysis',
      order: 2,
      content: `
## Current Trust Score

**Score:** ${trustScore.score}/100
**Grade:** ${trustScore.grade}
**Calculated:** ${trustScore.calculatedAt.toISOString()}
**Valid Until:** ${trustScore.validUntil.toISOString()}

## Data Quality

- **Completeness:** ${Math.round(trustScore.dataQuality.completeness * 100)}%
- **Freshness:** ${Math.round(trustScore.dataQuality.freshness * 100)}%
- **Source Count:** ${trustScore.dataQuality.sourceCount}

## Factor Breakdown

The trust score is calculated from ${trustScore.factors.length} factors, weighted by their importance.
      `.trim(),
      tables: [{
        title: 'Trust Score Factors',
        headers: ['Factor', 'Score', 'Weight', 'Key Findings'],
        rows: factorRows,
      }],
      charts: [
        this.generateFactorRadarChart(trustScore),
      ],
    };
  }

  private generateRiskAssessmentSection(riskAssessment: RiskAssessment): ReportSection {
    const categoryRows = riskAssessment.categories.map(c => [
      c.name,
      c.risk,
      c.score.toString(),
      c.description,
    ]);

    return {
      title: 'Risk Assessment',
      order: 3,
      content: `
## Overall Risk Level: ${riskAssessment.overallRisk.toUpperCase()}

**Risk Score:** ${riskAssessment.riskScore}/100
**Assessment Date:** ${riskAssessment.assessedAt.toISOString()}
**Valid Until:** ${riskAssessment.validUntil.toISOString()}

## Assessment Methodology

${riskAssessment.assessor.methodology} (v${riskAssessment.assessor.version})

## Risk Categories

${riskAssessment.categories.length} risk categories were evaluated.
      `.trim(),
      tables: [{
        title: 'Risk Categories',
        headers: ['Category', 'Risk Level', 'Score', 'Description'],
        rows: categoryRows,
      }],
    };
  }

  private generateComplianceSection(certifications: ComplianceCertification[]): ReportSection {
    const certRows = certifications.map(c => [
      c.framework,
      c.status,
      c.expirationDate.toISOString().split('T')[0],
      c.certificationBody || 'N/A',
      c.verificationMethod,
    ]);

    const validCerts = certifications.filter(c => c.status === 'valid').length;
    const expiringSoon = certifications.filter(c => c.status === 'expiring_soon').length;
    const expired = certifications.filter(c => c.status === 'expired').length;

    return {
      title: 'Compliance Status',
      order: 4,
      content: `
## Certification Overview

- **Valid Certifications:** ${validCerts}
- **Expiring Soon:** ${expiringSoon}
- **Expired:** ${expired}

## Certification Details
      `.trim(),
      tables: [{
        title: 'Compliance Certifications',
        headers: ['Framework', 'Status', 'Expiration', 'Certification Body', 'Verification'],
        rows: certRows,
      }],
      charts: [
        this.generateComplianceStatusChart(certifications),
      ],
    };
  }

  private generateContractsSection(contracts: Contract[]): ReportSection {
    const contractRows = contracts.map(c => [
      c.type,
      c.status,
      c.startDate.toISOString().split('T')[0],
      c.endDate.toISOString().split('T')[0],
      `${c.value.amount} ${c.value.currency}`,
    ]);

    const activeContracts = contracts.filter(c => c.status === 'active').length;
    const totalValue = contracts
      .filter(c => c.status === 'active')
      .reduce((sum, c) => sum + c.value.amount, 0);

    return {
      title: 'Contract Overview',
      order: 5,
      content: `
## Contract Summary

- **Active Contracts:** ${activeContracts}
- **Total Active Value:** ${totalValue.toLocaleString()} USD

## Contract Details
      `.trim(),
      tables: [{
        title: 'Contracts',
        headers: ['Type', 'Status', 'Start Date', 'End Date', 'Value'],
        rows: contractRows,
      }],
    };
  }

  private generateSecurityEventsSection(events: HealthEvent[], alerts: Alert[]): ReportSection {
    const criticalEvents = events.filter(e => e.severity === 'critical').length;
    const highEvents = events.filter(e => e.severity === 'error').length;
    const openAlerts = alerts.filter(a => a.status === 'open').length;

    const recentEvents = events.slice(0, 10).map(e => [
      e.detectedAt.toISOString().split('T')[0],
      e.type,
      e.severity,
      e.title,
      e.resolvedAt ? 'Resolved' : 'Open',
    ]);

    return {
      title: 'Security Events',
      order: 6,
      content: `
## Event Summary (Last 90 Days)

- **Total Events:** ${events.length}
- **Critical Events:** ${criticalEvents}
- **High Severity Events:** ${highEvents}
- **Open Alerts:** ${openAlerts}

## Recent Events
      `.trim(),
      tables: [{
        title: 'Recent Security Events',
        headers: ['Date', 'Type', 'Severity', 'Title', 'Status'],
        rows: recentEvents,
      }],
      charts: [
        this.generateEventTrendChart(events),
      ],
    };
  }

  private generateRecommendationsSection(riskAssessment: RiskAssessment): ReportSection {
    const recRows = riskAssessment.recommendations.map(r => [
      r.priority,
      r.category,
      r.description,
      r.expectedImpact,
      r.estimatedEffort,
    ]);

    return {
      title: 'Recommendations',
      order: 7,
      content: `
## Priority Recommendations

The following recommendations are based on the risk assessment findings.
      `.trim(),
      tables: [{
        title: 'Recommendations',
        headers: ['Priority', 'Category', 'Description', 'Expected Impact', 'Effort'],
        rows: recRows,
      }],
    };
  }

  private generateTrendAnalysisSection(history: TrustScore[]): ReportSection {
    const scores = history.map(h => ({
      date: h.calculatedAt.toISOString().split('T')[0],
      score: h.score,
      grade: h.grade,
    }));

    const avgScore = history.reduce((sum, h) => sum + h.score, 0) / history.length;
    const minScore = Math.min(...history.map(h => h.score));
    const maxScore = Math.max(...history.map(h => h.score));

    return {
      title: 'Trend Analysis',
      order: 2,
      content: `
## Trust Score Trend

- **Average Score:** ${Math.round(avgScore * 100) / 100}
- **Minimum Score:** ${minScore}
- **Maximum Score:** ${maxScore}
- **Data Points:** ${history.length}

## Analysis

The trust score has ${this.analyzeTrend(history)} over the reporting period.
      `.trim(),
      charts: [
        this.generateTrustScoreTrendChart(history),
      ],
    };
  }

  private generateYearOverYearSection(history: TrustScore[], alerts: Alert[]): ReportSection {
    // Simplified year-over-year comparison
    return {
      title: 'Year-Over-Year Comparison',
      order: 3,
      content: `
## Performance Comparison

This section compares the vendor's performance to the previous period.

### Trust Score
- Current period average vs previous period

### Alert Volume
- ${alerts.length} alerts in current period
      `.trim(),
    };
  }

  private generateComplianceTimelineSection(certifications: ComplianceCertification[]): ReportSection {
    const timeline = certifications
      .sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())
      .map(c => `- **${c.framework}** expires ${c.expirationDate.toISOString().split('T')[0]}`);

    return {
      title: 'Compliance Timeline',
      order: 4,
      content: `
## Upcoming Certification Expirations

${timeline.join('\n')}
      `.trim(),
    };
  }

  private generateContractReviewSection(contracts: Contract[]): ReportSection {
    const upcomingRenewals = contracts
      .filter(c => c.status === 'active' || c.status === 'expiring_soon')
      .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
      .slice(0, 5);

    return {
      title: 'Contract Review',
      order: 5,
      content: `
## Upcoming Contract Actions

${upcomingRenewals.map(c => `- **${c.type}** ends ${c.endDate.toISOString().split('T')[0]} (Auto-renewal: ${c.autoRenewal ? 'Yes' : 'No'})`).join('\n')}
      `.trim(),
    };
  }

  private generateIncidentSummarySection(alerts: Alert[]): ReportSection {
    const alertsByType = alerts.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      title: 'Incident Summary',
      order: 6,
      content: `
## Alert Summary

- **Total Alerts:** ${alerts.length}
- **Critical:** ${alerts.filter(a => a.severity === 'critical').length}
- **Resolved:** ${alerts.filter(a => a.status === 'resolved').length}

## Alerts by Type

${Object.entries(alertsByType).map(([type, count]) => `- ${type}: ${count}`).join('\n')}
      `.trim(),
    };
  }

  private generateActionItemsSection(
    riskAssessment: RiskAssessment,
    certifications: ComplianceCertification[],
    contracts: Contract[],
  ): ReportSection {
    const actions: string[] = [];

    // Required actions from risk assessment
    for (const action of riskAssessment.requiredActions) {
      if (action.status !== 'completed') {
        actions.push(`- **[${action.status.toUpperCase()}]** ${action.action} (Due: ${action.deadline.toISOString().split('T')[0]})`);
      }
    }

    // Expiring certifications
    for (const cert of certifications) {
      if (cert.status === 'expiring_soon') {
        actions.push(`- **[RENEWAL]** Renew ${cert.framework} certification (Expires: ${cert.expirationDate.toISOString().split('T')[0]})`);
      }
    }

    // Expiring contracts
    for (const contract of contracts) {
      if (contract.status === 'expiring_soon') {
        actions.push(`- **[CONTRACT]** Review ${contract.type} contract (Expires: ${contract.endDate.toISOString().split('T')[0]})`);
      }
    }

    return {
      title: 'Action Items',
      order: 7,
      content: `
## Outstanding Action Items

${actions.length > 0 ? actions.join('\n') : 'No outstanding action items.'}
      `.trim(),
    };
  }

  private generatePortfolioOverviewSection(vendorData: BoardVendorData[]): ReportSection {
    const byTier = vendorData.reduce((acc, v) => {
      acc[v.vendor.tier] = (acc[v.vendor.tier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byRisk = vendorData.reduce((acc, v) => {
      acc[v.riskAssessment.overallRisk] = (acc[v.riskAssessment.overallRisk] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      title: 'Portfolio Overview',
      order: 1,
      content: `
## Vendor Portfolio Summary

**Total Vendors:** ${vendorData.length}

### By Tier
${Object.entries(byTier).map(([tier, count]) => `- ${tier}: ${count}`).join('\n')}

### By Risk Level
${Object.entries(byRisk).map(([risk, count]) => `- ${risk}: ${count}`).join('\n')}
      `.trim(),
      charts: [
        this.generatePortfolioDistributionChart(vendorData),
      ],
    };
  }

  private generateRiskDistributionSection(vendorData: BoardVendorData[]): ReportSection {
    const riskMatrix = vendorData.map(v => [
      v.vendor.name,
      v.vendor.tier,
      v.trustScore.score.toString(),
      v.trustScore.grade,
      v.riskAssessment.overallRisk,
    ]);

    return {
      title: 'Risk Distribution',
      order: 2,
      content: `
## Vendor Risk Matrix
      `.trim(),
      tables: [{
        title: 'Vendor Risk Matrix',
        headers: ['Vendor', 'Tier', 'Score', 'Grade', 'Risk Level'],
        rows: riskMatrix,
      }],
    };
  }

  private generateCriticalVendorsSection(vendorData: BoardVendorData[]): ReportSection {
    const criticalVendors = vendorData
      .filter(v => v.riskAssessment.overallRisk === 'critical' || v.riskAssessment.overallRisk === 'high')
      .sort((a, b) => b.trustScore.score - a.trustScore.score);

    return {
      title: 'Critical Vendors',
      order: 3,
      content: `
## Vendors Requiring Attention

${criticalVendors.length} vendors are at critical or high risk level.

${criticalVendors.map(v => `
### ${v.vendor.name}
- **Tier:** ${v.vendor.tier}
- **Trust Score:** ${v.trustScore.score} (${v.trustScore.grade})
- **Risk Level:** ${v.riskAssessment.overallRisk}
- **Critical Alerts:** ${v.criticalAlerts}
`).join('\n')}
      `.trim(),
    };
  }

  private generateTrendHighlightsSection(vendorData: BoardVendorData[]): ReportSection {
    const improving = vendorData.filter(v => v.trustScore.trend === 'improving').length;
    const declining = vendorData.filter(v => v.trustScore.trend === 'declining').length;
    const stable = vendorData.filter(v => v.trustScore.trend === 'stable').length;

    return {
      title: 'Trend Highlights',
      order: 4,
      content: `
## Portfolio Trends

- **Improving:** ${improving} vendors
- **Stable:** ${stable} vendors
- **Declining:** ${declining} vendors

${declining > 0 ? `### Vendors with Declining Scores\n${vendorData.filter(v => v.trustScore.trend === 'declining').map(v => `- ${v.vendor.name}`).join('\n')}` : ''}
      `.trim(),
    };
  }

  private generateKeyMetricsSection(vendorData: BoardVendorData[]): ReportSection {
    const avgScore = vendorData.reduce((sum, v) => sum + v.trustScore.score, 0) / vendorData.length;
    const totalAlerts = vendorData.reduce((sum, v) => sum + v.openAlerts, 0);
    const criticalVendors = vendorData.filter(v => v.vendor.tier === 'critical').length;

    return {
      title: 'Key Metrics',
      order: 5,
      content: `
## Key Performance Indicators

| Metric | Value |
|--------|-------|
| Average Trust Score | ${Math.round(avgScore * 100) / 100} |
| Total Open Alerts | ${totalAlerts} |
| Critical Tier Vendors | ${criticalVendors} |
| High Risk Vendors | ${vendorData.filter(v => v.riskAssessment.overallRisk === 'high' || v.riskAssessment.overallRisk === 'critical').length} |
      `.trim(),
    };
  }

  private generateStrategicRecommendationsSection(vendorData: BoardVendorData[]): ReportSection {
    const recommendations: string[] = [];

    const criticalHighRisk = vendorData.filter(
      v => v.vendor.tier === 'critical' && (v.riskAssessment.overallRisk === 'high' || v.riskAssessment.overallRisk === 'critical'),
    );
    if (criticalHighRisk.length > 0) {
      recommendations.push(`Immediate attention required for ${criticalHighRisk.length} critical-tier vendors with high/critical risk`);
    }

    const declining = vendorData.filter(v => v.trustScore.trend === 'declining');
    if (declining.length > vendorData.length * 0.2) {
      recommendations.push('Portfolio trend is concerning - more than 20% of vendors showing declining scores');
    }

    const avgScore = vendorData.reduce((sum, v) => sum + v.trustScore.score, 0) / vendorData.length;
    if (avgScore < 70) {
      recommendations.push('Consider portfolio optimization - average trust score is below target threshold');
    }

    return {
      title: 'Strategic Recommendations',
      order: 6,
      content: `
## Board-Level Recommendations

${recommendations.length > 0 ? recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') : 'No immediate strategic concerns identified.'}
      `.trim(),
    };
  }

  private generateRegulatorySections(
    regulation: string,
    vendor: VendorInfo,
    trustScore: TrustScore,
    riskAssessment: RiskAssessment,
    certifications: ComplianceCertification[],
    contracts: Contract[],
    auditTrail: AuditLogEntry[],
  ): ReportSection[] {
    // Generate sections based on regulation type
    const sections: ReportSection[] = [
      {
        title: 'Regulatory Submission Summary',
        order: 1,
        content: `
## ${regulation} Compliance Report

**Vendor:** ${vendor.name}
**Report Date:** ${new Date().toISOString().split('T')[0]}
**Regulation:** ${regulation}

This report is generated for regulatory compliance purposes.
        `.trim(),
      },
      this.generateComplianceSection(certifications),
      {
        title: 'Audit Trail',
        order: 10,
        content: `
## Activity Log

${auditTrail.length} activities recorded during the reporting period.

${auditTrail.slice(0, 20).map(a => `- ${a.timestamp.toISOString()}: ${a.action} by ${a.actor.name}`).join('\n')}
        `.trim(),
      },
    ];

    return sections;
  }

  private generateIncidentOverviewSection(incident: HealthEvent): ReportSection {
    return {
      title: 'Incident Overview',
      order: 1,
      content: `
## Incident Details

**ID:** ${incident.id}
**Type:** ${incident.type}
**Severity:** ${incident.severity}
**Detected:** ${incident.detectedAt.toISOString()}
**Status:** ${incident.resolvedAt ? 'Resolved' : 'Active'}

## Description

${incident.description}

## Impact

${incident.impact}
      `.trim(),
    };
  }

  private generateIncidentTimelineSection(incident: HealthEvent, alerts: Alert[]): ReportSection {
    const relatedAlerts = alerts.filter(a => a.relatedEvents.includes(incident.id));

    return {
      title: 'Incident Timeline',
      order: 2,
      content: `
## Timeline

- **${incident.detectedAt.toISOString()}** - Incident detected
${relatedAlerts.map(a => `- **${a.createdAt.toISOString()}** - Alert created: ${a.title}`).join('\n')}
${incident.resolvedAt ? `- **${incident.resolvedAt.toISOString()}** - Incident resolved` : '- Incident still active'}
      `.trim(),
    };
  }

  private generateImpactAnalysisSection(incident: HealthEvent, trustScore: TrustScore): ReportSection {
    return {
      title: 'Impact Analysis',
      order: 3,
      content: `
## Business Impact

${incident.impact}

## Trust Score Impact

Current trust score: ${trustScore.score} (${trustScore.grade})
Trend: ${trustScore.trend}
      `.trim(),
    };
  }

  private generateRemediationSection(incident: HealthEvent): ReportSection {
    return {
      title: 'Remediation',
      order: 4,
      content: `
## Remediation Actions

${incident.resolvedAt ? 'Incident has been resolved.' : 'Remediation in progress.'}

## Next Steps

1. Complete root cause analysis
2. Implement preventive measures
3. Update security controls
4. Document lessons learned
      `.trim(),
    };
  }

  private generateLessonsLearnedSection(incident: HealthEvent): ReportSection {
    return {
      title: 'Lessons Learned',
      order: 5,
      content: `
## Key Takeaways

To be documented after incident closure.

## Preventive Measures

- Review and update monitoring thresholds
- Enhance detection capabilities
- Update incident response procedures
      `.trim(),
    };
  }

  // ============================================================================
  // Chart Generation
  // ============================================================================

  private generateTrustScoreGaugeChart(trustScore: TrustScore): ChartData {
    return {
      type: 'pie',
      title: 'Trust Score',
      data: {
        score: trustScore.score,
        grade: trustScore.grade,
        max: 100,
      },
    };
  }

  private generateRiskCategoryChart(riskAssessment: RiskAssessment): ChartData {
    return {
      type: 'bar',
      title: 'Risk by Category',
      data: {
        categories: riskAssessment.categories.map(c => c.name),
        scores: riskAssessment.categories.map(c => c.score),
      },
    };
  }

  private generateFactorRadarChart(trustScore: TrustScore): ChartData {
    return {
      type: 'radar',
      title: 'Trust Factors',
      data: {
        labels: trustScore.factors.map(f => this.formatCategoryName(f.category)),
        values: trustScore.factors.map(f => f.score),
      },
    };
  }

  private generateComplianceStatusChart(certifications: ComplianceCertification[]): ChartData {
    const statusCounts = certifications.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      type: 'pie',
      title: 'Certification Status',
      data: statusCounts,
    };
  }

  private generateEventTrendChart(events: HealthEvent[]): ChartData {
    // Group events by week
    const weeklyData: Record<string, number> = {};
    for (const event of events) {
      const week = this.getWeekKey(event.detectedAt);
      weeklyData[week] = (weeklyData[week] || 0) + 1;
    }

    return {
      type: 'line',
      title: 'Security Events Over Time',
      data: {
        labels: Object.keys(weeklyData),
        values: Object.values(weeklyData),
      },
    };
  }

  private generateTrustScoreTrendChart(history: TrustScore[]): ChartData {
    return {
      type: 'line',
      title: 'Trust Score Trend',
      data: {
        labels: history.map(h => h.calculatedAt.toISOString().split('T')[0]),
        values: history.map(h => h.score),
      },
    };
  }

  private generatePortfolioDistributionChart(vendorData: BoardVendorData[]): ChartData {
    const riskDistribution = vendorData.reduce((acc, v) => {
      acc[v.riskAssessment.overallRisk] = (acc[v.riskAssessment.overallRisk] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      type: 'pie',
      title: 'Risk Distribution',
      data: riskDistribution,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private generateReportId(): string {
    return `rpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private extractKeyFindings(trustScore: TrustScore, riskAssessment: RiskAssessment): string[] {
    const findings: string[] = [];

    // Low scoring factors
    const lowFactors = trustScore.factors.filter(f => f.score < 60);
    for (const factor of lowFactors.slice(0, 3)) {
      findings.push(`${this.formatCategoryName(factor.category)} score is ${factor.score}/100`);
    }

    // Critical risk categories
    const criticalCategories = riskAssessment.categories.filter(c => c.risk === 'critical');
    for (const cat of criticalCategories) {
      findings.push(`${cat.name} is at critical risk level`);
    }

    // Required actions count
    const pendingActions = riskAssessment.requiredActions.filter(a => a.status === 'pending');
    if (pendingActions.length > 0) {
      findings.push(`${pendingActions.length} required actions pending`);
    }

    return findings.slice(0, 5);
  }

  private formatCategoryName(category: string): string {
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private scoreToGrade(score: number): TrustGrade {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private scoreToRisk(score: number): RiskLevel {
    if (score >= 75) return 'low';
    if (score >= 50) return 'medium';
    if (score >= 25) return 'high';
    return 'critical';
  }

  private calculatePortfolioTrend(vendorData: BoardVendorData[]): TrustTrend {
    const improving = vendorData.filter(v => v.trustScore.trend === 'improving').length;
    const declining = vendorData.filter(v => v.trustScore.trend === 'declining').length;

    if (improving > declining * 2) return 'improving';
    if (declining > improving * 2) return 'declining';
    return 'stable';
  }

  private analyzeTrend(history: TrustScore[]): string {
    if (history.length < 2) return 'remained stable (insufficient data)';

    const firstHalf = history.slice(0, Math.floor(history.length / 2));
    const secondHalf = history.slice(Math.floor(history.length / 2));

    const avgFirst = firstHalf.reduce((sum, h) => sum + h.score, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, h) => sum + h.score, 0) / secondHalf.length;

    const diff = avgSecond - avgFirst;

    if (diff > 5) return 'improved significantly';
    if (diff > 2) return 'shown slight improvement';
    if (diff < -5) return 'declined significantly';
    if (diff < -2) return 'shown slight decline';
    return 'remained stable';
  }

  private getWeekKey(date: Date): string {
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());
    return startOfWeek.toISOString().split('T')[0];
  }
}

// ============================================================================
// Types
// ============================================================================

export interface ReportOptions {
  periodStart?: Date;
  periodEnd?: Date;
  format?: 'json' | 'pdf' | 'csv' | 'excel';
  generatedBy?: string;
  includeAttachments?: boolean;
}

export interface ListReportsOptions {
  vendorId?: string;
  types?: ReportType[];
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface ReportSchedule {
  id: string;
  vendorId: string;
  reportType: ReportType;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  nextRun: Date;
  recipients: string[];
  format: 'pdf' | 'csv' | 'excel';
  enabled: boolean;
}

export interface ExportResult {
  url: string;
  filename: string;
  size: number;
  format: string;
  expiresAt: Date;
}

interface BoardVendorData {
  vendor: VendorInfo;
  trustScore: TrustScore;
  riskAssessment: RiskAssessment;
  criticalAlerts: number;
  openAlerts: number;
}

// ============================================================================
// Storage Interface
// ============================================================================

export interface ReportStorage {
  saveReport(report: VendorRiskReport): Promise<void>;
  getReport(reportId: string): Promise<VendorRiskReport | null>;
  listReports(options: ListReportsOptions): Promise<PaginatedResponse<VendorRiskReport>>;
  saveSchedule(schedule: ReportSchedule): Promise<void>;
  getSchedules(): Promise<ReportSchedule[]>;
  getAuditTrail(vendorId: string, startDate?: Date, endDate?: Date): Promise<AuditLogEntry[]>;
}

// ============================================================================
// Template Engine Interface
// ============================================================================

export interface TemplateEngine {
  render(template: string, data: Record<string, unknown>): Promise<string>;
  getTemplate(name: string): Promise<string>;
}

// ============================================================================
// Export Service Interface
// ============================================================================

export interface ExportService {
  export(report: VendorRiskReport, format: 'pdf' | 'csv' | 'excel' | 'json'): Promise<ExportResult>;
  exportAuditTrail(data: unknown, format: 'csv' | 'json'): Promise<ExportResult>;
}

// ============================================================================
// Audit Logger Interface
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

// ============================================================================
// Error Class
// ============================================================================

export class ReportingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReportingError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createReportingService(config: ReportingServiceConfig): ReportingService {
  return new ReportingService(config);
}
