/**
 * Compliance Report Generator
 *
 * Generates formatted compliance evidence reports for external auditors.
 * Supports JSON, CSV, and PDF output formats.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type { ID, Timestamp } from '../../common/types.js';
import type {
  EvidenceCollection,
  CollectedAuditEvent,
  CollectedPolicyChange,
  CollectedAccessDecision,
  CollectedTrustScoreChange,
  CollectedEscalationDecision,
  CollectedDataRetentionLog,
} from './evidence-collector.js';
import type { TamperEvidentPackage } from './hash-verifier.js';

const logger = createLogger({ component: 'report-generator' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported export formats
 */
export type ExportFormat = 'json' | 'csv' | 'pdf';

/**
 * Report generation options
 */
export interface ReportGenerationOptions {
  /** Output format */
  format: ExportFormat;
  /** Include tamper-evident hashes */
  includeTamperEvidence: boolean;
  /** Include raw evidence payloads */
  includePayloads: boolean;
  /** Report title */
  title?: string;
  /** Prepared by */
  preparedBy?: string;
  /** Organization name */
  organizationName?: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Report header information
 */
export interface ReportHeader {
  /** Report title */
  title: string;
  /** Report ID */
  reportId: string;
  /** Generation timestamp */
  generatedAt: Timestamp;
  /** Report period */
  period: {
    start: Timestamp;
    end: Timestamp;
  };
  /** Organization */
  organization?: string;
  /** Prepared by */
  preparedBy?: string;
  /** Format */
  format: ExportFormat;
  /** Report version */
  version: string;
}

/**
 * Executive summary
 */
export interface ExecutiveSummary {
  /** Overview paragraph */
  overview: string;
  /** Key statistics */
  statistics: {
    totalEvents: number;
    auditEvents: number;
    policyChanges: number;
    accessDecisions: number;
    trustScoreChanges: number;
    escalations: number;
    dataRetentionOps: number;
  };
  /** Compliance highlights */
  highlights: string[];
  /** Areas of concern */
  concerns: string[];
}

/**
 * Complete compliance evidence report
 */
export interface ComplianceEvidenceReport {
  /** Report header */
  header: ReportHeader;
  /** Executive summary */
  summary: ExecutiveSummary;
  /** Detailed evidence sections */
  sections: {
    auditEvents: ReportSection<CollectedAuditEvent>;
    policyChanges: ReportSection<CollectedPolicyChange>;
    accessDecisions: ReportSection<CollectedAccessDecision>;
    trustScoreChanges: ReportSection<CollectedTrustScoreChange>;
    escalationDecisions: ReportSection<CollectedEscalationDecision>;
    dataRetentionLogs: ReportSection<CollectedDataRetentionLog>;
  };
  /** Tamper evidence (if included) */
  tamperEvidence?: TamperEvidentPackage;
  /** Additional notes */
  notes?: string;
  /** Appendix */
  appendix?: {
    methodology: string;
    definitions: Record<string, string>;
    contactInfo?: string;
  };
}

/**
 * Report section with records and summary
 */
export interface ReportSection<T> {
  /** Section title */
  title: string;
  /** Section description */
  description: string;
  /** Number of records */
  recordCount: number;
  /** Summary statistics for this section */
  statistics: Record<string, number | string>;
  /** The actual records */
  records: T[];
}

/**
 * Export job status
 */
export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Export job record
 */
export interface ExportJob {
  /** Job ID (operation ID) */
  operationId: string;
  /** Tenant ID */
  tenantId: ID;
  /** Current status */
  status: ExportJobStatus;
  /** Job creation time */
  createdAt: Timestamp;
  /** Job start time */
  startedAt?: Timestamp;
  /** Job completion time */
  completedAt?: Timestamp;
  /** Export parameters */
  parameters: {
    startDate: string;
    endDate: string;
    eventTypes?: string[];
    includePayloads: boolean;
    format: ExportFormat;
  };
  /** Progress (0-100) */
  progress: number;
  /** Result file path or URL (when completed) */
  resultUrl?: string;
  /** Result file size in bytes */
  resultSize?: number;
  /** Error message (if failed) */
  error?: string;
}

// =============================================================================
// REPORT GENERATOR
// =============================================================================

/**
 * Generates compliance evidence reports
 */
export class ReportGenerator {
  private readonly version = '1.0.0';
  private jobs: Map<string, ExportJob> = new Map();

  constructor() {
    logger.info('Report generator initialized');
  }

  /**
   * Generate a complete compliance evidence report
   */
  async generateReport(
    collection: EvidenceCollection,
    tamperEvidence: TamperEvidentPackage | undefined,
    options: ReportGenerationOptions
  ): Promise<ComplianceEvidenceReport> {
    const reportId = crypto.randomUUID();

    logger.info(
      {
        reportId,
        collectionId: collection.metadata.collectionId,
        format: options.format,
      },
      'Generating compliance evidence report'
    );

    const startTime = Date.now();

    // Generate report header
    const header = this.generateHeader(collection, options, reportId);

    // Generate executive summary
    const summary = this.generateExecutiveSummary(collection);

    // Generate report sections
    const sections = {
      auditEvents: this.generateAuditEventsSection(collection.auditEvents),
      policyChanges: this.generatePolicyChangesSection(collection.policyChanges),
      accessDecisions: this.generateAccessDecisionsSection(collection.accessDecisions),
      trustScoreChanges: this.generateTrustScoreChangesSection(collection.trustScoreChanges),
      escalationDecisions: this.generateEscalationDecisionsSection(collection.escalationDecisions),
      dataRetentionLogs: this.generateDataRetentionLogsSection(collection.dataRetentionLogs),
    };

    // Generate appendix
    const appendix = this.generateAppendix();

    const report: ComplianceEvidenceReport = {
      header,
      summary,
      sections,
      tamperEvidence: options.includeTamperEvidence ? tamperEvidence : undefined,
      notes: options.notes,
      appendix,
    };

    const duration = Date.now() - startTime;

    logger.info(
      {
        reportId,
        durationMs: duration,
        totalRecords: collection.summary.totalRecords,
      },
      'Compliance evidence report generated'
    );

    return report;
  }

  /**
   * Generate report header
   */
  private generateHeader(
    collection: EvidenceCollection,
    options: ReportGenerationOptions,
    reportId: string
  ): ReportHeader {
    return {
      title: options.title ?? 'Compliance Evidence Export Report',
      reportId,
      generatedAt: new Date().toISOString(),
      period: {
        start: collection.metadata.periodStart,
        end: collection.metadata.periodEnd,
      },
      organization: options.organizationName,
      preparedBy: options.preparedBy,
      format: options.format,
      version: this.version,
    };
  }

  /**
   * Generate executive summary
   */
  private generateExecutiveSummary(collection: EvidenceCollection): ExecutiveSummary {
    const { summary } = collection;

    // Generate highlights
    const highlights: string[] = [];

    if (summary.byOutcome['success'] > 0) {
      const successRate =
        ((summary.byOutcome['success'] ?? 0) / summary.totalRecords) * 100;
      if (successRate >= 95) {
        highlights.push(`High success rate: ${successRate.toFixed(1)}% of operations completed successfully`);
      }
    }

    if (summary.byEventType.access_decision > 0) {
      const grantedCount = summary.byOutcome['granted'] ?? 0;
      const deniedCount = summary.byOutcome['denied'] ?? 0;
      const total = grantedCount + deniedCount;
      if (total > 0) {
        highlights.push(
          `Access control: ${grantedCount} grants, ${deniedCount} denials (${((deniedCount / total) * 100).toFixed(1)}% denial rate)`
        );
      }
    }

    if (summary.byEventType.policy_change > 0) {
      highlights.push(
        `Policy governance: ${summary.byEventType.policy_change} policy changes tracked`
      );
    }

    if (summary.byEventType.escalation_decision > 0) {
      highlights.push(
        `Escalation handling: ${summary.byEventType.escalation_decision} escalation decisions recorded`
      );
    }

    // Generate concerns
    const concerns: string[] = [];

    if ((summary.bySeverity['critical'] ?? 0) > 0) {
      concerns.push(
        `${summary.bySeverity['critical']} critical severity events detected`
      );
    }

    if ((summary.bySeverity['high'] ?? 0) > 0) {
      concerns.push(`${summary.bySeverity['high']} high severity events detected`);
    }

    if ((summary.byOutcome['failure'] ?? 0) > 0) {
      const failureRate =
        ((summary.byOutcome['failure'] ?? 0) / summary.totalRecords) * 100;
      if (failureRate > 5) {
        concerns.push(
          `Elevated failure rate: ${failureRate.toFixed(1)}% of operations failed`
        );
      }
    }

    if ((summary.byOutcome['escalation_timeout'] ?? 0) > 0) {
      concerns.push(
        `${summary.byOutcome['escalation_timeout']} escalations timed out`
      );
    }

    // Generate overview
    const periodStart = new Date(collection.metadata.periodStart);
    const periodEnd = new Date(collection.metadata.periodEnd);
    const durationDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    const overview = `This compliance evidence report covers ${durationDays} days of system activity ` +
      `from ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}. ` +
      `During this period, ${summary.totalRecords} compliance-relevant events were recorded across ` +
      `${Object.keys(summary.byEventType).filter(k => summary.byEventType[k as keyof typeof summary.byEventType] > 0).length} categories. ` +
      `The evidence has been collected and hashed to ensure tamper-evidence for audit purposes.`;

    return {
      overview,
      statistics: {
        totalEvents: summary.totalRecords,
        auditEvents: summary.byEventType.audit,
        policyChanges: summary.byEventType.policy_change,
        accessDecisions: summary.byEventType.access_decision,
        trustScoreChanges: summary.byEventType.trust_score_change,
        escalations: summary.byEventType.escalation_decision,
        dataRetentionOps: summary.byEventType.data_retention,
      },
      highlights,
      concerns,
    };
  }

  /**
   * Generate audit events section
   */
  private generateAuditEventsSection(
    events: CollectedAuditEvent[]
  ): ReportSection<CollectedAuditEvent> {
    const statistics: Record<string, number | string> = {
      totalEvents: events.length,
    };

    // Count by category
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};

    for (const event of events) {
      byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
    }

    statistics['categoryCounts'] = JSON.stringify(byCategory);
    statistics['severityCounts'] = JSON.stringify(bySeverity);
    statistics['outcomeCounts'] = JSON.stringify(byOutcome);

    return {
      title: 'Audit Events',
      description:
        'Complete audit trail of system events including authentication, authorization, ' +
        'data access, and administrative actions.',
      recordCount: events.length,
      statistics,
      records: events,
    };
  }

  /**
   * Generate policy changes section
   */
  private generatePolicyChangesSection(
    changes: CollectedPolicyChange[]
  ): ReportSection<CollectedPolicyChange> {
    const statistics: Record<string, number | string> = {
      totalChanges: changes.length,
    };

    // Count by change type
    const byChangeType: Record<string, number> = {};
    for (const change of changes) {
      byChangeType[change.changeType] = (byChangeType[change.changeType] ?? 0) + 1;
    }

    statistics['changeTypeCounts'] = JSON.stringify(byChangeType);

    // Count unique policies changed
    const uniquePolicies = new Set(changes.map((c) => c.policyId));
    statistics['uniquePoliciesChanged'] = uniquePolicies.size;

    return {
      title: 'Policy Changes',
      description:
        'Record of all policy modifications including creation, updates, publication, ' +
        'and deprecation with version tracking.',
      recordCount: changes.length,
      statistics,
      records: changes,
    };
  }

  /**
   * Generate access decisions section
   */
  private generateAccessDecisionsSection(
    decisions: CollectedAccessDecision[]
  ): ReportSection<CollectedAccessDecision> {
    const statistics: Record<string, number | string> = {
      totalDecisions: decisions.length,
    };

    // Count grants vs denials
    const granted = decisions.filter((d) => d.decision === 'granted').length;
    const denied = decisions.filter((d) => d.decision === 'denied').length;

    statistics['granted'] = granted;
    statistics['denied'] = denied;
    statistics['denialRate'] =
      decisions.length > 0
        ? `${((denied / decisions.length) * 100).toFixed(2)}%`
        : '0%';

    // Count unique entities
    const uniqueEntities = new Set(decisions.map((d) => d.entityId));
    statistics['uniqueEntities'] = uniqueEntities.size;

    // Average trust score for decisions
    const withTrustScore = decisions.filter((d) => d.trustScore !== undefined);
    if (withTrustScore.length > 0) {
      const avgTrustScore =
        withTrustScore.reduce((sum, d) => sum + (d.trustScore ?? 0), 0) /
        withTrustScore.length;
      statistics['avgTrustScore'] = avgTrustScore.toFixed(2);
    }

    return {
      title: 'Access Control Decisions',
      description:
        'Record of all access control decisions including grants and denials, ' +
        'with associated trust scores and policy evaluations.',
      recordCount: decisions.length,
      statistics,
      records: decisions,
    };
  }

  /**
   * Generate trust score changes section
   */
  private generateTrustScoreChangesSection(
    changes: CollectedTrustScoreChange[]
  ): ReportSection<CollectedTrustScoreChange> {
    const statistics: Record<string, number | string> = {
      totalChanges: changes.length,
    };

    // Count increases vs decreases
    const increases = changes.filter((c) => c.newScore > c.previousScore).length;
    const decreases = changes.filter((c) => c.newScore < c.previousScore).length;

    statistics['trustIncreases'] = increases;
    statistics['trustDecreases'] = decreases;

    // Count level changes
    const levelChanges = changes.filter((c) => c.newLevel !== c.previousLevel).length;
    statistics['levelChanges'] = levelChanges;

    // Average score change
    if (changes.length > 0) {
      const avgChange =
        changes.reduce((sum, c) => sum + (c.newScore - c.previousScore), 0) /
        changes.length;
      statistics['avgScoreChange'] = avgChange.toFixed(2);
    }

    return {
      title: 'Trust Score Changes',
      description:
        'Record of trust score modifications for entities including the reason for change ' +
        'and resulting trust level adjustments.',
      recordCount: changes.length,
      statistics,
      records: changes,
    };
  }

  /**
   * Generate escalation decisions section
   */
  private generateEscalationDecisionsSection(
    decisions: CollectedEscalationDecision[]
  ): ReportSection<CollectedEscalationDecision> {
    const statistics: Record<string, number | string> = {
      totalEscalations: decisions.length,
    };

    // Count by status
    const byStatus: Record<string, number> = {};
    for (const decision of decisions) {
      byStatus[decision.status] = (byStatus[decision.status] ?? 0) + 1;
    }

    statistics['statusCounts'] = JSON.stringify(byStatus);

    // Calculate average resolution time
    const withResolutionTime = decisions.filter((d) => d.timeToResolution !== undefined);
    if (withResolutionTime.length > 0) {
      const avgResolutionTime =
        withResolutionTime.reduce((sum, d) => sum + (d.timeToResolution ?? 0), 0) /
        withResolutionTime.length;
      statistics['avgResolutionTimeMs'] = avgResolutionTime.toFixed(0);
      statistics['avgResolutionTimeMinutes'] = (avgResolutionTime / 60000).toFixed(2);
    }

    // Resolution rate
    const resolved = decisions.filter(
      (d) => d.status === 'approved' || d.status === 'rejected'
    ).length;
    statistics['resolutionRate'] =
      decisions.length > 0
        ? `${((resolved / decisions.length) * 100).toFixed(2)}%`
        : '0%';

    return {
      title: 'Escalation Decisions',
      description:
        'Record of escalation requests and their resolutions including approval, ' +
        'rejection, and timeout outcomes.',
      recordCount: decisions.length,
      statistics,
      records: decisions,
    };
  }

  /**
   * Generate data retention logs section
   */
  private generateDataRetentionLogsSection(
    logs: CollectedDataRetentionLog[]
  ): ReportSection<CollectedDataRetentionLog> {
    const statistics: Record<string, number | string> = {
      totalOperations: logs.length,
    };

    // Count by operation type
    const byOperation: Record<string, number> = {};
    for (const log of logs) {
      byOperation[log.operation] = (byOperation[log.operation] ?? 0) + 1;
    }

    statistics['operationCounts'] = JSON.stringify(byOperation);

    // Count by trigger type
    const byTrigger: Record<string, number> = {};
    for (const log of logs) {
      byTrigger[log.triggeredBy] = (byTrigger[log.triggeredBy] ?? 0) + 1;
    }

    statistics['triggerCounts'] = JSON.stringify(byTrigger);

    // Total records affected
    const totalRecordsAffected = logs.reduce((sum, l) => sum + l.recordCount, 0);
    statistics['totalRecordsAffected'] = totalRecordsAffected;

    // Success rate
    const successful = logs.filter((l) => l.success).length;
    statistics['successRate'] =
      logs.length > 0
        ? `${((successful / logs.length) * 100).toFixed(2)}%`
        : '0%';

    return {
      title: 'Data Retention Enforcement Logs',
      description:
        'Record of data retention operations including archival, purging, and deletion ' +
        'activities with compliance policy references.',
      recordCount: logs.length,
      statistics,
      records: logs,
    };
  }

  /**
   * Generate report appendix
   */
  private generateAppendix(): ComplianceEvidenceReport['appendix'] {
    return {
      methodology: `
Evidence Collection Methodology:
1. All compliance-relevant events are captured in real-time as they occur in the system.
2. Events are stored with immutable timestamps and actor information.
3. Audit trails maintain chain integrity using cryptographic hashes.
4. Evidence is collected from the audit database using tenant-isolated queries.
5. SHA-256 hashes are computed for each evidence item to enable tamper detection.
6. A Merkle tree is built from individual hashes to provide efficient verification.
7. The complete evidence package may be digitally signed with the platform key.

Verification Process:
1. Recompute SHA-256 hash for each evidence record.
2. Compare computed hashes against the provided hash manifest.
3. Rebuild the Merkle tree and verify the root hash matches.
4. If signed, verify the digital signature using the platform's public key.
`.trim(),
      definitions: {
        'Audit Event':
          'A recorded occurrence of a system action including the actor, action, target, and outcome.',
        'Policy Change':
          'A modification to a governance policy including creation, updates, or deprecation.',
        'Access Decision':
          'The outcome of an access control evaluation - either grant or denial of access.',
        'Trust Score':
          'A numerical measure (0-1000) of an entity\'s trustworthiness based on behavioral signals.',
        'Trust Level':
          'A categorical trust classification (0-5) derived from the trust score.',
        Escalation:
          'A request for human review when automated decision-making is insufficient.',
        'Data Retention':
          'The enforcement of data lifecycle policies including archival and deletion.',
        'Merkle Root':
          'A cryptographic hash summarizing all evidence items, enabling efficient integrity verification.',
        'Tamper Evidence':
          'Cryptographic proofs that allow detection of any modification to the evidence.',
      },
      contactInfo:
        'For questions about this report or verification assistance, ' +
        'contact compliance@agentanchorai.com or your account representative.',
    };
  }

  /**
   * Format report as JSON
   */
  formatAsJson(report: ComplianceEvidenceReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as CSV (multiple files in a zip-like structure)
   */
  formatAsCsv(report: ComplianceEvidenceReport): Record<string, string> {
    const csvFiles: Record<string, string> = {};

    // Header CSV - flatten the header object for CSV
    const headerFlat = {
      ...report.header,
      periodStart: report.header.period.start,
      periodEnd: report.header.period.end,
      period: undefined,
    };
    csvFiles['header.csv'] = this.objectToCsv([headerFlat as Record<string, unknown>]);

    // Summary CSV
    csvFiles['summary.csv'] = this.objectToCsv([
      {
        ...report.summary.statistics,
        highlights: report.summary.highlights.join('; '),
        concerns: report.summary.concerns.join('; '),
      } as Record<string, unknown>,
    ]);

    // Section CSVs
    if (report.sections.auditEvents.records.length > 0) {
      csvFiles['audit_events.csv'] = this.objectToCsv(
        report.sections.auditEvents.records as unknown as Record<string, unknown>[]
      );
    }

    if (report.sections.policyChanges.records.length > 0) {
      csvFiles['policy_changes.csv'] = this.objectToCsv(
        report.sections.policyChanges.records as unknown as Record<string, unknown>[]
      );
    }

    if (report.sections.accessDecisions.records.length > 0) {
      csvFiles['access_decisions.csv'] = this.objectToCsv(
        report.sections.accessDecisions.records as unknown as Record<string, unknown>[]
      );
    }

    if (report.sections.trustScoreChanges.records.length > 0) {
      csvFiles['trust_score_changes.csv'] = this.objectToCsv(
        report.sections.trustScoreChanges.records as unknown as Record<string, unknown>[]
      );
    }

    if (report.sections.escalationDecisions.records.length > 0) {
      csvFiles['escalation_decisions.csv'] = this.objectToCsv(
        report.sections.escalationDecisions.records as unknown as Record<string, unknown>[]
      );
    }

    if (report.sections.dataRetentionLogs.records.length > 0) {
      csvFiles['data_retention_logs.csv'] = this.objectToCsv(
        report.sections.dataRetentionLogs.records as unknown as Record<string, unknown>[]
      );
    }

    // Tamper evidence CSV (hashes only)
    if (report.tamperEvidence) {
      csvFiles['evidence_hashes.csv'] = this.objectToCsv(
        report.tamperEvidence.evidenceHashes as unknown as Record<string, unknown>[]
      );
    }

    return csvFiles;
  }

  /**
   * Convert array of objects to CSV
   */
  private objectToCsv(objects: Record<string, unknown>[]): string {
    if (objects.length === 0) return '';

    // Get all unique keys
    const keys = new Set<string>();
    for (const obj of objects) {
      for (const key of Object.keys(obj)) {
        keys.add(key);
      }
    }

    const headers = Array.from(keys);

    // CSV header row
    const csvRows = [headers.map((h) => `"${h}"`).join(',')];

    // Data rows
    for (const obj of objects) {
      const values = headers.map((h) => {
        const value = obj[h];
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Format report as PDF-ready HTML
   */
  formatAsPdfHtml(report: ComplianceEvidenceReport): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(report.header.title)}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #1e40af;
      margin-bottom: 10px;
    }
    .header-meta {
      color: #666;
      font-size: 0.9em;
    }
    .summary {
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      padding: 20px;
      margin-bottom: 30px;
    }
    .summary h2 {
      color: #1e40af;
      margin-top: 0;
    }
    .statistics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .stat-card .value {
      font-size: 2em;
      font-weight: bold;
      color: #2563eb;
    }
    .stat-card .label {
      color: #64748b;
      font-size: 0.85em;
    }
    .highlights {
      background: #f0fdf4;
      border-left: 4px solid #22c55e;
      padding: 15px;
      margin: 15px 0;
    }
    .concerns {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 15px;
      margin: 15px 0;
    }
    .section {
      margin-bottom: 40px;
      page-break-inside: avoid;
    }
    .section h2 {
      color: #1e40af;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 10px;
    }
    .section-meta {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 15px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85em;
      margin-top: 15px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f8fafc;
      font-weight: 600;
      color: #475569;
    }
    tr:nth-child(even) {
      background: #fafafa;
    }
    .tamper-evidence {
      background: #fffbeb;
      border: 2px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
    }
    .tamper-evidence h3 {
      color: #b45309;
      margin-top: 0;
    }
    .hash {
      font-family: 'Courier New', monospace;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.85em;
      word-break: break-all;
    }
    .appendix {
      margin-top: 50px;
      padding-top: 30px;
      border-top: 2px solid #e2e8f0;
    }
    .appendix h2 {
      color: #64748b;
    }
    .definitions dt {
      font-weight: 600;
      color: #1e40af;
      margin-top: 10px;
    }
    .definitions dd {
      margin-left: 20px;
      color: #475569;
    }
    @media print {
      body {
        font-size: 11pt;
      }
      .section {
        page-break-inside: avoid;
      }
      table {
        font-size: 9pt;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${this.escapeHtml(report.header.title)}</h1>
    <div class="header-meta">
      <p><strong>Report ID:</strong> ${this.escapeHtml(report.header.reportId)}</p>
      <p><strong>Period:</strong> ${report.header.period.start.split('T')[0]} to ${report.header.period.end.split('T')[0]}</p>
      <p><strong>Generated:</strong> ${report.header.generatedAt}</p>
      ${report.header.organization ? `<p><strong>Organization:</strong> ${this.escapeHtml(report.header.organization)}</p>` : ''}
      ${report.header.preparedBy ? `<p><strong>Prepared By:</strong> ${this.escapeHtml(report.header.preparedBy)}</p>` : ''}
    </div>
  </div>

  <div class="summary">
    <h2>Executive Summary</h2>
    <p>${this.escapeHtml(report.summary.overview)}</p>

    <div class="statistics">
      <div class="stat-card">
        <div class="value">${report.summary.statistics.totalEvents.toLocaleString()}</div>
        <div class="label">Total Events</div>
      </div>
      <div class="stat-card">
        <div class="value">${report.summary.statistics.auditEvents.toLocaleString()}</div>
        <div class="label">Audit Events</div>
      </div>
      <div class="stat-card">
        <div class="value">${report.summary.statistics.policyChanges.toLocaleString()}</div>
        <div class="label">Policy Changes</div>
      </div>
      <div class="stat-card">
        <div class="value">${report.summary.statistics.accessDecisions.toLocaleString()}</div>
        <div class="label">Access Decisions</div>
      </div>
      <div class="stat-card">
        <div class="value">${report.summary.statistics.escalations.toLocaleString()}</div>
        <div class="label">Escalations</div>
      </div>
    </div>

    ${report.summary.highlights.length > 0 ? `
    <div class="highlights">
      <strong>Highlights:</strong>
      <ul>
        ${report.summary.highlights.map((h) => `<li>${this.escapeHtml(h)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${report.summary.concerns.length > 0 ? `
    <div class="concerns">
      <strong>Areas of Concern:</strong>
      <ul>
        ${report.summary.concerns.map((c) => `<li>${this.escapeHtml(c)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}
  </div>

  ${this.generateSectionHtml('Audit Events', report.sections.auditEvents)}
  ${this.generateSectionHtml('Policy Changes', report.sections.policyChanges)}
  ${this.generateSectionHtml('Access Decisions', report.sections.accessDecisions)}
  ${this.generateSectionHtml('Trust Score Changes', report.sections.trustScoreChanges)}
  ${this.generateSectionHtml('Escalation Decisions', report.sections.escalationDecisions)}
  ${this.generateSectionHtml('Data Retention Logs', report.sections.dataRetentionLogs)}

  ${report.tamperEvidence ? `
  <div class="tamper-evidence">
    <h3>Tamper-Evident Verification</h3>
    <p>This report includes cryptographic verification data to ensure evidence integrity.</p>
    <p><strong>Merkle Root:</strong> <span class="hash">${this.escapeHtml(report.tamperEvidence.merkleProof.root)}</span></p>
    <p><strong>Total Evidence Items:</strong> ${report.tamperEvidence.merkleProof.leafCount}</p>
    <p><strong>Package ID:</strong> ${this.escapeHtml(report.tamperEvidence.packageId)}</p>
    ${report.tamperEvidence.signature ? `
    <p><strong>Signed:</strong> Yes (Algorithm: ${this.escapeHtml(report.tamperEvidence.signature.algorithm)})</p>
    <p><strong>Key ID:</strong> ${this.escapeHtml(report.tamperEvidence.signature.keyId)}</p>
    ` : ''}
    <h4>Verification Instructions</h4>
    <ol>
      ${report.tamperEvidence.verificationInstructions.steps.filter(s => s.trim()).map((s) => `<li>${this.escapeHtml(s)}</li>`).join('')}
    </ol>
  </div>
  ` : ''}

  ${report.appendix ? `
  <div class="appendix">
    <h2>Appendix</h2>

    <h3>Methodology</h3>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 15px; border-radius: 5px;">${this.escapeHtml(report.appendix.methodology)}</pre>

    <h3>Definitions</h3>
    <dl class="definitions">
      ${Object.entries(report.appendix.definitions).map(([term, def]) => `
        <dt>${this.escapeHtml(term)}</dt>
        <dd>${this.escapeHtml(def)}</dd>
      `).join('')}
    </dl>

    ${report.appendix.contactInfo ? `
    <h3>Contact Information</h3>
    <p>${this.escapeHtml(report.appendix.contactInfo)}</p>
    ` : ''}
  </div>
  ` : ''}

  <footer style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 0.85em;">
    <p>Generated by Vorion Compliance Export System v${this.version}</p>
    <p>Report ID: ${this.escapeHtml(report.header.reportId)}</p>
  </footer>
</body>
</html>
`.trim();
  }

  /**
   * Generate HTML for a report section
   */
  private generateSectionHtml<T>(
    title: string,
    section: ReportSection<T>
  ): string {
    if (section.records.length === 0) {
      return `
        <div class="section">
          <h2>${this.escapeHtml(title)}</h2>
          <p class="section-meta">${this.escapeHtml(section.description)}</p>
          <p><em>No records in this category during the report period.</em></p>
        </div>
      `;
    }

    // Get column headers from first record (cast to indexable type)
    const firstRecord = section.records[0] as Record<string, unknown> | undefined;
    const headers = Object.keys(firstRecord ?? {}).filter(
      (h) => !['metadata', 'diff'].includes(h)
    );

    // Limit records shown in HTML (full data in CSV/JSON)
    const displayRecords = section.records.slice(0, 100) as unknown as Record<string, unknown>[];
    const truncated = section.records.length > 100;

    return `
      <div class="section">
        <h2>${this.escapeHtml(title)}</h2>
        <p class="section-meta">${this.escapeHtml(section.description)}</p>
        <p><strong>Total Records:</strong> ${section.recordCount.toLocaleString()}</p>

        ${truncated ? `<p><em>Showing first 100 of ${section.recordCount.toLocaleString()} records. See CSV/JSON export for complete data.</em></p>` : ''}

        <table>
          <thead>
            <tr>
              ${headers.slice(0, 8).map((h) => `<th>${this.escapeHtml(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${displayRecords.map((record) => `
              <tr>
                ${headers.slice(0, 8).map((h) => {
                  const value = record[h];
                  const displayValue = this.formatCellValue(value);
                  return `<td>${displayValue}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Format a cell value for HTML display
   */
  private formatCellValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      return `<span class="hash">${this.escapeHtml(JSON.stringify(value).slice(0, 50))}...</span>`;
    }
    const str = String(value);
    if (str.length > 50) {
      return this.escapeHtml(str.slice(0, 50)) + '...';
    }
    return this.escapeHtml(str);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===========================================================================
  // EXPORT JOB MANAGEMENT
  // ===========================================================================

  /**
   * Create a new export job
   */
  createJob(
    tenantId: ID,
    parameters: ExportJob['parameters']
  ): ExportJob {
    const operationId = crypto.randomUUID();

    const job: ExportJob = {
      operationId,
      tenantId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      parameters,
      progress: 0,
    };

    this.jobs.set(operationId, job);

    logger.info(
      { operationId, tenantId, format: parameters.format },
      'Export job created'
    );

    return job;
  }

  /**
   * Get an export job by ID
   */
  getJob(operationId: string): ExportJob | undefined {
    return this.jobs.get(operationId);
  }

  /**
   * Update job status
   */
  updateJobStatus(
    operationId: string,
    updates: Partial<ExportJob>
  ): ExportJob | undefined {
    const job = this.jobs.get(operationId);
    if (!job) return undefined;

    Object.assign(job, updates);
    this.jobs.set(operationId, job);

    return job;
  }

  /**
   * List jobs for a tenant
   */
  listJobs(tenantId: ID): ExportJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => j.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Clean up old completed jobs
   */
  cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        job.status === 'completed' &&
        job.completedAt &&
        new Date(job.completedAt).getTime() < cutoff
      ) {
        this.jobs.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old export jobs');
    }

    return cleaned;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let reportGeneratorInstance: ReportGenerator | null = null;

/**
 * Get the singleton report generator instance
 */
export function getReportGenerator(): ReportGenerator {
  if (!reportGeneratorInstance) {
    reportGeneratorInstance = new ReportGenerator();
  }
  return reportGeneratorInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetReportGenerator(): void {
  reportGeneratorInstance = null;
}
