/**
 * Compliance Reporter
 *
 * Generates audit reports for SOC 2 controls and compliance requirements.
 * Supports export in JSON and CSV formats for auditors.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { ID, Timestamp } from '../common/types.js';
import { AuditService, createAuditService } from './service.js';
import type { AuditRecord, AuditCategory, AuditSeverity, AuditQueryFilters } from './types.js';
import {
  type SecurityEventCategory,
  type SecuritySeverity,
  type SecurityEventType,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_CATEGORIES,
  getSecurityEventsByCategory,
} from './security-events.js';

const logger = createLogger({ component: 'compliance-reporter' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * SOC 2 Control mapping
 */
export interface Soc2Control {
  /** Control ID (e.g., CC6.1) */
  id: string;
  /** Control name */
  name: string;
  /** Control description */
  description: string;
  /** Trust Services Category */
  category: 'security' | 'availability' | 'processing_integrity' | 'confidentiality' | 'privacy';
  /** Related event types */
  eventTypes: string[];
}

/**
 * SOC 2 Controls mapping
 */
export const SOC2_CONTROLS: Record<string, Soc2Control> = {
  'CC6.1': {
    id: 'CC6.1',
    name: 'Logical and Physical Access Controls',
    description: 'The entity implements logical access security software, infrastructure, and architectures.',
    category: 'security',
    eventTypes: [
      'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'LOGIN_LOCKED',
      'SESSION_CREATED', 'SESSION_VALIDATED', 'SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REVOKED',
      'TOKEN_ISSUED', 'TOKEN_REFRESHED', 'TOKEN_REVOKED', 'TOKEN_VALIDATION_FAILED',
      'API_KEY_CREATED', 'API_KEY_VALIDATED', 'API_KEY_VALIDATION_FAILED', 'API_KEY_REVOKED', 'API_KEY_ROTATED',
      'MFA_ENROLLED', 'MFA_VERIFICATION_SUCCESS', 'MFA_VERIFICATION_FAILED', 'MFA_DISABLED',
      'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED',
    ],
  },
  'CC6.2': {
    id: 'CC6.2',
    name: 'Restriction of Access',
    description: 'Prior to issuing system credentials and granting system access, the entity registers and authorizes new internal and external users.',
    category: 'security',
    eventTypes: [
      'ACCESS_GRANTED', 'ACCESS_DENIED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED',
      'ROLE_ASSIGNED', 'ROLE_REMOVED', 'PRIVILEGE_ESCALATED', 'TRUST_TIER_CHANGED',
      'POLICY_EVALUATED', 'POLICY_VIOLATION', 'SCOPE_CHECK_PASSED', 'SCOPE_CHECK_FAILED',
      'DPOP_VERIFIED', 'DPOP_FAILED', 'AGENT_REVOKED',
    ],
  },
  'CC6.5': {
    id: 'CC6.5',
    name: 'Data Protection',
    description: 'The entity restricts access to nonpublic information and protects the confidentiality of data.',
    category: 'security',
    eventTypes: [
      'DATA_READ', 'DATA_CREATED', 'DATA_UPDATED', 'DATA_DELETED', 'DATA_EXPORTED',
      'BULK_DATA_ACCESS', 'SENSITIVE_DATA_ACCESS', 'PII_ACCESSED',
      'AUDIT_LOG_ACCESSED', 'AUDIT_LOG_EXPORTED',
    ],
  },
  'CC7.2': {
    id: 'CC7.2',
    name: 'Security Monitoring',
    description: 'The entity monitors system components and the operation of those components for anomalies.',
    category: 'security',
    eventTypes: [
      'BRUTE_FORCE_DETECTED', 'INJECTION_ATTEMPT', 'ANOMALY_DETECTED',
      'RATE_LIMIT_EXCEEDED', 'IP_BLOCKED', 'IP_UNBLOCKED', 'SUSPICIOUS_ACTIVITY',
      'SECURITY_ALERT', 'GEOGRAPHIC_ANOMALY', 'TEMPORAL_ANOMALY', 'VOLUME_ANOMALY',
      'CERTIFICATE_INVALID', 'INTEGRITY_VIOLATION',
    ],
  },
  'CC7.3': {
    id: 'CC7.3',
    name: 'Incident Response',
    description: 'The entity responds to identified security incidents by executing a defined incident response program.',
    category: 'security',
    eventTypes: [
      'INCIDENT_CREATED', 'INCIDENT_UPDATED', 'INCIDENT_RESOLVED',
    ],
  },
  'CC8.1': {
    id: 'CC8.1',
    name: 'Change Management',
    description: 'The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes.',
    category: 'security',
    eventTypes: [
      'CONFIG_CHANGED', 'SECURITY_SETTING_CHANGED',
      'KEY_CREATED', 'KEY_ROTATED', 'KEY_REVOKED', 'KEY_ACCESSED',
      'SECRET_ROTATED', 'SECRET_ACCESSED',
      'POLICY_CREATED', 'POLICY_UPDATED', 'POLICY_DELETED',
      'TENANT_CREATED', 'TENANT_UPDATED',
      'USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'USER_DISABLED', 'USER_ENABLED',
    ],
  },
};

/**
 * Report filter options
 */
export interface ReportFilters {
  /** Start time for the report period */
  startTime: Timestamp;
  /** End time for the report period */
  endTime: Timestamp;
  /** Tenant ID to filter by */
  tenantId: ID;
  /** Filter by specific event types */
  eventTypes?: string[];
  /** Filter by event categories */
  categories?: SecurityEventCategory[];
  /** Filter by severities */
  severities?: SecuritySeverity[];
  /** Filter by SOC 2 control IDs */
  soc2Controls?: string[];
  /** Filter by actor IDs */
  actorIds?: string[];
  /** Filter by outcome */
  outcomes?: ('success' | 'failure' | 'blocked' | 'escalated')[];
}

/**
 * Report summary statistics
 */
export interface ReportSummary {
  /** Total number of events in the report */
  totalEvents: number;
  /** Events by category */
  byCategory: Record<string, number>;
  /** Events by severity */
  bySeverity: Record<string, number>;
  /** Events by outcome */
  byOutcome: Record<string, number>;
  /** Events by SOC 2 control */
  bySoc2Control: Record<string, number>;
  /** Events by event type (top 20) */
  topEventTypes: Array<{ type: string; count: number }>;
  /** Unique actors */
  uniqueActors: number;
  /** Report time range */
  timeRange: {
    start: Timestamp;
    end: Timestamp;
    durationHours: number;
  };
}

/**
 * Compliance report
 */
export interface ComplianceReport {
  /** Report metadata */
  metadata: {
    /** Report ID */
    id: string;
    /** Report generation timestamp */
    generatedAt: Timestamp;
    /** Report version */
    version: string;
    /** Filters applied */
    filters: ReportFilters;
    /** Generator information */
    generator: string;
  };
  /** Report summary */
  summary: ReportSummary;
  /** SOC 2 control coverage */
  soc2Coverage: Soc2ControlCoverage[];
  /** Detailed events (if includeEvents is true) */
  events?: AuditEventRecord[];
}

/**
 * SOC 2 control coverage in report
 */
export interface Soc2ControlCoverage {
  /** Control definition */
  control: Soc2Control;
  /** Number of events for this control */
  eventCount: number;
  /** Breakdown by outcome */
  byOutcome: Record<string, number>;
  /** Breakdown by severity */
  bySeverity: Record<string, number>;
  /** Sample events (first 5) */
  sampleEvents: AuditEventRecord[];
  /** Assessment */
  assessment: {
    /** Whether control has adequate logging */
    adequateCoverage: boolean;
    /** Coverage percentage (based on expected event types) */
    coveragePercent: number;
    /** Missing event types */
    missingEventTypes: string[];
    /** Recommendations */
    recommendations: string[];
  };
}

/**
 * Simplified audit event for reports
 */
export interface AuditEventRecord {
  /** Event ID */
  id: string;
  /** Event timestamp */
  timestamp: Timestamp;
  /** Event type */
  eventType: string;
  /** Event category */
  category: string;
  /** Event severity */
  severity: string;
  /** Actor ID */
  actorId: string;
  /** Actor type */
  actorType: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Action performed */
  action: string;
  /** Outcome */
  outcome: string;
  /** Reason (if failure) */
  reason?: string;
  /** Request ID */
  requestId: string;
  /** SOC 2 control */
  soc2Control?: string;
}

/**
 * Export format
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Report generation options
 */
export interface ReportOptions {
  /** Include individual events in report (default: false for summary only) */
  includeEvents?: boolean;
  /** Maximum events to include (default: 10000) */
  maxEvents?: number;
  /** Export format (default: json) */
  format?: ExportFormat;
  /** Include SOC 2 control assessment (default: true) */
  includeSoc2Assessment?: boolean;
}

// =============================================================================
// COMPLIANCE REPORTER CLASS
// =============================================================================

/**
 * Compliance Reporter
 *
 * Generates audit reports for SOC 2 controls and compliance requirements.
 */
export class ComplianceReporter {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? createAuditService();
  }

  /**
   * Generate a compliance report
   */
  async generateReport(
    filters: ReportFilters,
    options: ReportOptions = {}
  ): Promise<ComplianceReport> {
    const startTime = Date.now();
    const {
      includeEvents = false,
      maxEvents = 10000,
      includeSoc2Assessment = true,
    } = options;

    logger.info(
      { filters: { ...filters, tenantId: filters.tenantId }, options },
      'Generating compliance report'
    );

    // Build audit query filters
    const queryFilters: AuditQueryFilters = {
      tenantId: filters.tenantId,
      startTime: filters.startTime,
      endTime: filters.endTime,
      limit: maxEvents,
    };

    if (filters.eventTypes?.length) {
      // We'll filter in-memory for multiple event types
    }

    if (filters.categories?.length === 1) {
      queryFilters.eventCategory = this.mapCategory(filters.categories[0]!);
    }

    if (filters.severities?.length === 1) {
      queryFilters.severity = this.mapSeverity(filters.severities[0]!);
    }

    if (filters.outcomes?.length === 1) {
      queryFilters.outcome = this.mapOutcome(filters.outcomes[0]!);
    }

    if (filters.actorIds?.length === 1) {
      queryFilters.actorId = filters.actorIds[0];
    }

    // Fetch events
    const result = await this.auditService.query(queryFilters);
    let records = result.records;

    // Apply additional filters in memory
    records = this.applyFilters(records, filters);

    // Build summary
    const summary = this.buildSummary(records, filters);

    // Build SOC 2 coverage
    const soc2Coverage = includeSoc2Assessment
      ? this.buildSoc2Coverage(records, filters)
      : [];

    // Build events array if requested
    const events = includeEvents
      ? records.slice(0, maxEvents).map(this.toEventRecord)
      : undefined;

    const report: ComplianceReport = {
      metadata: {
        id: crypto.randomUUID(),
        generatedAt: new Date().toISOString(),
        version: '1.0.0',
        filters,
        generator: 'vorion-compliance-reporter',
      },
      summary,
      soc2Coverage,
      events,
    };

    const duration = Date.now() - startTime;
    logger.info(
      { reportId: report.metadata.id, eventCount: records.length, durationMs: duration },
      'Compliance report generated'
    );

    return report;
  }

  /**
   * Export report to specified format
   */
  async exportReport(
    report: ComplianceReport,
    format: ExportFormat
  ): Promise<string> {
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'csv':
        return this.toCsv(report);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Generate report for specific SOC 2 control
   */
  async generateSoc2ControlReport(
    controlId: string,
    filters: Omit<ReportFilters, 'soc2Controls'>,
    options: ReportOptions = {}
  ): Promise<ComplianceReport> {
    const control = SOC2_CONTROLS[controlId];
    if (!control) {
      throw new Error(`Unknown SOC 2 control: ${controlId}`);
    }

    return this.generateReport(
      {
        ...filters,
        soc2Controls: [controlId],
        eventTypes: control.eventTypes,
      },
      options
    );
  }

  /**
   * Generate summary report for all SOC 2 controls
   */
  async generateSoc2SummaryReport(
    tenantId: ID,
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<{
    controls: Array<{
      control: Soc2Control;
      eventCount: number;
      failureCount: number;
      coveragePercent: number;
      status: 'compliant' | 'needs_attention' | 'non_compliant';
    }>;
    overallStatus: 'compliant' | 'needs_attention' | 'non_compliant';
    recommendations: string[];
  }> {
    const controls: Array<{
      control: Soc2Control;
      eventCount: number;
      failureCount: number;
      coveragePercent: number;
      status: 'compliant' | 'needs_attention' | 'non_compliant';
    }> = [];

    const recommendations: string[] = [];

    for (const control of Object.values(SOC2_CONTROLS)) {
      const result = await this.auditService.query({
        tenantId,
        startTime,
        endTime,
        limit: 10000,
      });

      const controlEvents = result.records.filter((r) =>
        control.eventTypes.includes(r.eventType)
      );

      const eventCount = controlEvents.length;
      const failureCount = controlEvents.filter(
        (e) => e.outcome === 'failure'
      ).length;

      // Calculate coverage based on which event types are present
      const presentEventTypes = new Set(controlEvents.map((e) => e.eventType));
      const coveragePercent = Math.round(
        (presentEventTypes.size / control.eventTypes.length) * 100
      );

      let status: 'compliant' | 'needs_attention' | 'non_compliant';
      if (coveragePercent >= 80 && failureCount / Math.max(eventCount, 1) < 0.1) {
        status = 'compliant';
      } else if (coveragePercent >= 50) {
        status = 'needs_attention';
      } else {
        status = 'non_compliant';
      }

      if (status !== 'compliant') {
        const missingTypes = control.eventTypes.filter(
          (t) => !presentEventTypes.has(t)
        );
        if (missingTypes.length > 0) {
          recommendations.push(
            `${control.id}: Add logging for ${missingTypes.slice(0, 3).join(', ')}${missingTypes.length > 3 ? ` and ${missingTypes.length - 3} more` : ''}`
          );
        }
      }

      controls.push({
        control,
        eventCount,
        failureCount,
        coveragePercent,
        status,
      });
    }

    // Determine overall status
    const nonCompliantCount = controls.filter(
      (c) => c.status === 'non_compliant'
    ).length;
    const needsAttentionCount = controls.filter(
      (c) => c.status === 'needs_attention'
    ).length;

    let overallStatus: 'compliant' | 'needs_attention' | 'non_compliant';
    if (nonCompliantCount > 0) {
      overallStatus = 'non_compliant';
    } else if (needsAttentionCount > 0) {
      overallStatus = 'needs_attention';
    } else {
      overallStatus = 'compliant';
    }

    return {
      controls,
      overallStatus,
      recommendations,
    };
  }

  /**
   * Get event counts by time period
   */
  async getEventTimeline(
    tenantId: ID,
    startTime: Timestamp,
    endTime: Timestamp,
    intervalHours: number = 24
  ): Promise<Array<{
    periodStart: Timestamp;
    periodEnd: Timestamp;
    eventCount: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  }>> {
    const result = await this.auditService.query({
      tenantId,
      startTime,
      endTime,
      limit: 100000,
    });

    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const periods: Array<{
      periodStart: Timestamp;
      periodEnd: Timestamp;
      eventCount: number;
      byCategory: Record<string, number>;
      bySeverity: Record<string, number>;
    }> = [];

    for (let periodStart = start; periodStart < end; periodStart += intervalMs) {
      const periodEnd = Math.min(periodStart + intervalMs, end);
      const periodStartStr = new Date(periodStart).toISOString();
      const periodEndStr = new Date(periodEnd).toISOString();

      const periodEvents = result.records.filter((r) => {
        const eventTime = new Date(r.eventTime).getTime();
        return eventTime >= periodStart && eventTime < periodEnd;
      });

      const byCategory: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};

      for (const event of periodEvents) {
        byCategory[event.eventCategory] = (byCategory[event.eventCategory] ?? 0) + 1;
        bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      }

      periods.push({
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        eventCount: periodEvents.length,
        byCategory,
        bySeverity,
      });
    }

    return periods;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Apply additional filters in memory
   */
  private applyFilters(
    records: AuditRecord[],
    filters: ReportFilters
  ): AuditRecord[] {
    let filtered = records;

    if (filters.eventTypes?.length) {
      const eventTypeSet = new Set(filters.eventTypes);
      filtered = filtered.filter((r) => eventTypeSet.has(r.eventType));
    }

    if (filters.categories?.length) {
      const categorySet = new Set(filters.categories.map(this.mapCategory));
      filtered = filtered.filter((r) => categorySet.has(r.eventCategory));
    }

    if (filters.severities?.length) {
      const severitySet = new Set(filters.severities.map(this.mapSeverity));
      filtered = filtered.filter((r) => severitySet.has(r.severity));
    }

    if (filters.outcomes?.length) {
      const outcomeSet = new Set(filters.outcomes.map(this.mapOutcome));
      filtered = filtered.filter((r) => outcomeSet.has(r.outcome));
    }

    if (filters.actorIds?.length) {
      const actorIdSet = new Set(filters.actorIds);
      filtered = filtered.filter((r) => actorIdSet.has(r.actor.id));
    }

    if (filters.soc2Controls?.length) {
      const controlEventTypes = new Set<string>();
      for (const controlId of filters.soc2Controls) {
        const control = SOC2_CONTROLS[controlId];
        if (control) {
          for (const eventType of control.eventTypes) {
            controlEventTypes.add(eventType);
          }
        }
      }
      filtered = filtered.filter((r) => controlEventTypes.has(r.eventType));
    }

    return filtered;
  }

  /**
   * Build report summary
   */
  private buildSummary(records: AuditRecord[], filters: ReportFilters): ReportSummary {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    const bySoc2Control: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};
    const uniqueActors = new Set<string>();

    for (const record of records) {
      byCategory[record.eventCategory] = (byCategory[record.eventCategory] ?? 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] ?? 0) + 1;
      byOutcome[record.outcome] = (byOutcome[record.outcome] ?? 0) + 1;
      eventTypeCounts[record.eventType] = (eventTypeCounts[record.eventType] ?? 0) + 1;
      uniqueActors.add(record.actor.id);

      // Map to SOC 2 controls
      for (const [controlId, control] of Object.entries(SOC2_CONTROLS)) {
        if (control.eventTypes.includes(record.eventType)) {
          bySoc2Control[controlId] = (bySoc2Control[controlId] ?? 0) + 1;
        }
      }
    }

    // Get top event types
    const topEventTypes = Object.entries(eventTypeCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([type, count]) => ({ type, count }));

    const startMs = new Date(filters.startTime).getTime();
    const endMs = new Date(filters.endTime).getTime();
    const durationHours = Math.round((endMs - startMs) / (1000 * 60 * 60));

    return {
      totalEvents: records.length,
      byCategory,
      bySeverity,
      byOutcome,
      bySoc2Control,
      topEventTypes,
      uniqueActors: uniqueActors.size,
      timeRange: {
        start: filters.startTime,
        end: filters.endTime,
        durationHours,
      },
    };
  }

  /**
   * Build SOC 2 coverage analysis
   */
  private buildSoc2Coverage(
    records: AuditRecord[],
    filters: ReportFilters
  ): Soc2ControlCoverage[] {
    const coverage: Soc2ControlCoverage[] = [];
    const controlsToAnalyze = filters.soc2Controls?.length
      ? filters.soc2Controls.map((id) => SOC2_CONTROLS[id]).filter(Boolean)
      : Object.values(SOC2_CONTROLS);

    for (const control of controlsToAnalyze) {
      if (!control) continue;

      const controlEvents = records.filter((r) =>
        control.eventTypes.includes(r.eventType)
      );

      const byOutcome: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};

      for (const event of controlEvents) {
        byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
        bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      }

      // Get sample events
      const sampleEvents = controlEvents.slice(0, 5).map(this.toEventRecord);

      // Calculate coverage
      const presentEventTypes = new Set(controlEvents.map((e) => e.eventType));
      const missingEventTypes = control.eventTypes.filter(
        (t) => !presentEventTypes.has(t)
      );
      const coveragePercent = Math.round(
        (presentEventTypes.size / control.eventTypes.length) * 100
      );

      // Generate recommendations
      const recommendations: string[] = [];
      if (missingEventTypes.length > 0) {
        recommendations.push(
          `Enable logging for: ${missingEventTypes.slice(0, 5).join(', ')}`
        );
      }
      if ((byOutcome['failure'] ?? 0) > controlEvents.length * 0.1) {
        recommendations.push('High failure rate detected - investigate root causes');
      }
      if (controlEvents.length === 0) {
        recommendations.push('No events logged - verify logging is enabled');
      }

      coverage.push({
        control,
        eventCount: controlEvents.length,
        byOutcome,
        bySeverity,
        sampleEvents,
        assessment: {
          adequateCoverage: coveragePercent >= 80,
          coveragePercent,
          missingEventTypes,
          recommendations,
        },
      });
    }

    return coverage;
  }

  /**
   * Convert audit record to event record
   */
  private toEventRecord = (record: AuditRecord): AuditEventRecord => {
    // Get SOC 2 control if available
    let soc2Control: string | undefined;
    for (const [controlId, control] of Object.entries(SOC2_CONTROLS)) {
      if (control.eventTypes.includes(record.eventType)) {
        soc2Control = controlId;
        break;
      }
    }

    return {
      id: record.id,
      timestamp: record.eventTime,
      eventType: record.eventType,
      category: record.eventCategory,
      severity: record.severity,
      actorId: record.actor.id,
      actorType: record.actor.type,
      resourceType: record.target.type,
      resourceId: record.target.id,
      action: record.action,
      outcome: record.outcome,
      reason: record.reason ?? undefined,
      requestId: record.requestId,
      soc2Control,
    };
  };

  /**
   * Convert report to CSV format
   */
  private toCsv(report: ComplianceReport): string {
    const lines: string[] = [];

    // Header section
    lines.push('# Compliance Report');
    lines.push(`# Generated: ${report.metadata.generatedAt}`);
    lines.push(`# Report ID: ${report.metadata.id}`);
    lines.push(`# Time Range: ${report.summary.timeRange.start} to ${report.summary.timeRange.end}`);
    lines.push('');

    // Summary section
    lines.push('# Summary');
    lines.push(`Total Events,${report.summary.totalEvents}`);
    lines.push(`Unique Actors,${report.summary.uniqueActors}`);
    lines.push(`Duration (hours),${report.summary.timeRange.durationHours}`);
    lines.push('');

    // Events by category
    lines.push('# Events by Category');
    lines.push('Category,Count');
    for (const [category, count] of Object.entries(report.summary.byCategory)) {
      lines.push(`${category},${count}`);
    }
    lines.push('');

    // Events by severity
    lines.push('# Events by Severity');
    lines.push('Severity,Count');
    for (const [severity, count] of Object.entries(report.summary.bySeverity)) {
      lines.push(`${severity},${count}`);
    }
    lines.push('');

    // Events by outcome
    lines.push('# Events by Outcome');
    lines.push('Outcome,Count');
    for (const [outcome, count] of Object.entries(report.summary.byOutcome)) {
      lines.push(`${outcome},${count}`);
    }
    lines.push('');

    // SOC 2 coverage
    if (report.soc2Coverage.length > 0) {
      lines.push('# SOC 2 Control Coverage');
      lines.push('Control ID,Control Name,Event Count,Coverage %,Adequate');
      for (const coverage of report.soc2Coverage) {
        lines.push(
          `${coverage.control.id},"${coverage.control.name}",${coverage.eventCount},${coverage.assessment.coveragePercent},${coverage.assessment.adequateCoverage}`
        );
      }
      lines.push('');
    }

    // Events (if included)
    if (report.events && report.events.length > 0) {
      lines.push('# Events');
      lines.push(
        'ID,Timestamp,Event Type,Category,Severity,Actor ID,Actor Type,Resource Type,Resource ID,Action,Outcome,Reason,Request ID,SOC 2 Control'
      );
      for (const event of report.events) {
        lines.push(
          [
            event.id,
            event.timestamp,
            event.eventType,
            event.category,
            event.severity,
            event.actorId,
            event.actorType,
            event.resourceType,
            event.resourceId,
            event.action,
            event.outcome,
            `"${event.reason ?? ''}"`,
            event.requestId,
            event.soc2Control ?? '',
          ].join(',')
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Map security category to audit category
   */
  private mapCategory(category: SecurityEventCategory): AuditCategory {
    const mapping: Record<SecurityEventCategory, AuditCategory> = {
      authentication: 'authentication',
      authorization: 'authorization',
      data_access: 'data',
      configuration: 'admin',
      incident: 'system',
    };
    return mapping[category];
  }

  /**
   * Map security severity to audit severity
   */
  private mapSeverity(severity: SecuritySeverity): AuditSeverity {
    const mapping: Record<SecuritySeverity, AuditSeverity> = {
      info: 'info',
      low: 'info',
      medium: 'warning',
      high: 'error',
      critical: 'critical',
    };
    return mapping[severity];
  }

  /**
   * Map security outcome to audit outcome
   */
  private mapOutcome(outcome: string): 'success' | 'failure' | 'partial' {
    if (outcome === 'success') return 'success';
    if (outcome === 'failure' || outcome === 'blocked') return 'failure';
    return 'partial';
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a compliance reporter instance
 */
export function createComplianceReporter(auditService?: AuditService): ComplianceReporter {
  return new ComplianceReporter(auditService);
}

/**
 * Get all SOC 2 controls
 */
export function getSoc2Controls(): Soc2Control[] {
  return Object.values(SOC2_CONTROLS);
}

/**
 * Get SOC 2 control by ID
 */
export function getSoc2Control(controlId: string): Soc2Control | undefined {
  return SOC2_CONTROLS[controlId];
}
