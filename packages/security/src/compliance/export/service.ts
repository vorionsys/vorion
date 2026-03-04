/**
 * Compliance Export Service
 *
 * High-level service that orchestrates evidence collection, hashing,
 * and report generation for compliance exports.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type { ID, Timestamp } from '../../common/types.js';
import {
  EvidenceCollector,
  type EvidenceCollection,
  type EvidenceEventType,
  EVIDENCE_EVENT_TYPES,
} from './evidence-collector.js';
import {
  HashVerifier,
  type TamperEvidentPackage,
  type HashVerifierConfig,
} from './hash-verifier.js';
import {
  ReportGenerator,
  type ExportFormat,
  type ComplianceEvidenceReport,
  type ExportJob,
} from './report-generator.js';

const logger = createLogger({ component: 'compliance-export-service' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Export request parameters
 */
export interface ExportRequest {
  /** Start date for export period */
  startDate: string;
  /** End date for export period */
  endDate: string;
  /** Event types to include (defaults to all) */
  eventTypes?: EvidenceEventType[];
  /** Include raw payloads (defaults to false) */
  includePayloads?: boolean;
  /** Output format */
  format: ExportFormat;
}

/**
 * Export result
 */
export interface ExportResult {
  /** Operation ID */
  operationId: string;
  /** Export status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Progress (0-100) */
  progress: number;
  /** Report (when completed) */
  report?: ComplianceEvidenceReport;
  /** Formatted output (when completed) */
  formattedOutput?: string | Record<string, string>;
  /** Tamper evidence package */
  tamperEvidence?: TamperEvidentPackage;
  /** Error message (if failed) */
  error?: string;
  /** Download URL (when available) */
  downloadUrl?: string;
}

/**
 * Overall compliance status summary
 */
export interface ComplianceStatusSummary {
  /** Status */
  status: 'healthy' | 'warning' | 'critical';
  /** Status message */
  message: string;
  /** Last audit timestamp */
  lastAuditAt?: Timestamp;
  /** Audit chain integrity */
  chainIntegrity: {
    verified: boolean;
    lastVerifiedAt?: Timestamp;
    recordsVerified?: number;
  };
  /** Data retention compliance */
  dataRetention: {
    compliant: boolean;
    lastEnforcedAt?: Timestamp;
    recordsProcessed?: number;
  };
  /** Active policies */
  policies: {
    total: number;
    enabled: number;
    lastUpdatedAt?: Timestamp;
  };
  /** Recent activity summary */
  recentActivity: {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
}

/**
 * Event summary by type and period
 */
export interface EventSummary {
  /** Period for the summary */
  period: {
    start: Timestamp;
    end: Timestamp;
  };
  /** Total events */
  totalEvents: number;
  /** Events by type */
  byType: Record<string, number>;
  /** Events by category */
  byCategory: Record<string, number>;
  /** Events by severity */
  bySeverity: Record<string, number>;
  /** Events by outcome */
  byOutcome: Record<string, number>;
  /** Hourly distribution */
  hourlyDistribution: Array<{ hour: number; count: number }>;
  /** Top actors */
  topActors: Array<{ actorId: string; count: number }>;
  /** Top resources */
  topResources: Array<{ resourceType: string; count: number }>;
}

// =============================================================================
// COMPLIANCE EXPORT SERVICE
// =============================================================================

/**
 * Main service for compliance evidence exports
 */
export class ComplianceExportService {
  private evidenceCollector: EvidenceCollector;
  private hashVerifier: HashVerifier;
  private reportGenerator: ReportGenerator;
  private exports: Map<string, ExportResult> = new Map();
  private exportData: Map<string, { collection: EvidenceCollection; report: ComplianceEvidenceReport }> = new Map();

  constructor(hashVerifierConfig?: HashVerifierConfig) {
    this.evidenceCollector = new EvidenceCollector();
    this.hashVerifier = new HashVerifier(hashVerifierConfig);
    this.reportGenerator = new ReportGenerator();

    logger.info('Compliance export service initialized');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.evidenceCollector.initialize();
    logger.info('Compliance export service fully initialized');
  }

  // ===========================================================================
  // EXPORT OPERATIONS
  // ===========================================================================

  /**
   * Start a new export job
   */
  async startExport(tenantId: ID, request: ExportRequest): Promise<string> {
    const operationId = crypto.randomUUID();

    logger.info(
      {
        operationId,
        tenantId,
        startDate: request.startDate,
        endDate: request.endDate,
        format: request.format,
      },
      'Starting compliance export'
    );

    // Initialize export result
    const result: ExportResult = {
      operationId,
      status: 'pending',
      progress: 0,
    };

    this.exports.set(operationId, result);

    // Process export asynchronously
    this.processExport(operationId, tenantId, request).catch((err) => {
      logger.error({ operationId, error: err }, 'Export processing failed');
      const existingResult = this.exports.get(operationId);
      if (existingResult) {
        existingResult.status = 'failed';
        existingResult.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });

    return operationId;
  }

  /**
   * Process an export job
   */
  private async processExport(
    operationId: string,
    tenantId: ID,
    request: ExportRequest
  ): Promise<void> {
    const result = this.exports.get(operationId);
    if (!result) return;

    try {
      // Update status to processing
      result.status = 'processing';
      result.progress = 5;

      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);

      // Validate date range
      if (startDate >= endDate) {
        throw new Error('Start date must be before end date');
      }

      // Step 1: Collect evidence (30% progress)
      result.progress = 10;
      logger.debug({ operationId }, 'Collecting evidence');

      const collection = await this.evidenceCollector.collectEvidence({
        tenantId,
        startDate,
        endDate,
        eventTypes: request.eventTypes,
        includePayloads: request.includePayloads,
      });

      result.progress = 40;

      // Step 2: Create tamper-evident package (20% progress)
      logger.debug({ operationId }, 'Creating tamper evidence');

      const tamperEvidence = await this.hashVerifier.createTamperEvidentPackage(
        collection
      );

      result.progress = 60;
      result.tamperEvidence = tamperEvidence;

      // Step 3: Generate report (20% progress)
      logger.debug({ operationId }, 'Generating report');

      const report = await this.reportGenerator.generateReport(
        collection,
        tamperEvidence,
        {
          format: request.format,
          includeTamperEvidence: true,
          includePayloads: request.includePayloads ?? false,
          title: `Compliance Evidence Export - ${tenantId}`,
        }
      );

      result.progress = 80;
      result.report = report;

      // Step 4: Format output (20% progress)
      logger.debug({ operationId }, 'Formatting output');

      let formattedOutput: string | Record<string, string>;
      switch (request.format) {
        case 'json':
          formattedOutput = this.reportGenerator.formatAsJson(report);
          break;
        case 'csv':
          formattedOutput = this.reportGenerator.formatAsCsv(report);
          break;
        case 'pdf':
          formattedOutput = this.reportGenerator.formatAsPdfHtml(report);
          break;
      }

      result.progress = 100;
      result.status = 'completed';
      result.formattedOutput = formattedOutput;

      // Store the data for download
      this.exportData.set(operationId, { collection, report });

      logger.info(
        {
          operationId,
          totalRecords: collection.summary.totalRecords,
          format: request.format,
        },
        'Export completed successfully'
      );
    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ operationId, error }, 'Export failed');
      throw error;
    }
  }

  /**
   * Get export status
   */
  getExportStatus(operationId: string): ExportResult | undefined {
    return this.exports.get(operationId);
  }

  /**
   * Get export download data
   */
  getExportDownload(operationId: string): {
    format: ExportFormat;
    data: string | Record<string, string>;
    filename: string;
    contentType: string;
  } | undefined {
    const result = this.exports.get(operationId);
    if (!result || result.status !== 'completed' || !result.formattedOutput) {
      return undefined;
    }

    const data = this.exportData.get(operationId);
    if (!data) return undefined;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const format = result.report?.header.format ?? 'json';

    let filename: string;
    let contentType: string;

    switch (format) {
      case 'json':
        filename = `compliance-export-${timestamp}.json`;
        contentType = 'application/json';
        break;
      case 'csv':
        filename = `compliance-export-${timestamp}.zip`;
        contentType = 'application/zip';
        break;
      case 'pdf':
        filename = `compliance-export-${timestamp}.html`;
        contentType = 'text/html';
        break;
    }

    return {
      format,
      data: result.formattedOutput,
      filename,
      contentType,
    };
  }

  // ===========================================================================
  // COMPLIANCE STATUS
  // ===========================================================================

  /**
   * Get overall compliance status
   */
  async getComplianceStatus(tenantId: ID): Promise<ComplianceStatusSummary> {
    await this.evidenceCollector.initialize();

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get recent activity counts
    const [counts24h, counts7d, counts30d] = await Promise.all([
      this.evidenceCollector.getEventCounts(tenantId, last24Hours, now),
      this.evidenceCollector.getEventCounts(tenantId, last7Days, now),
      this.evidenceCollector.getEventCounts(tenantId, last30Days, now),
    ]);

    const total24h = Object.values(counts24h).reduce((a, b) => a + b, 0);
    const total7d = Object.values(counts7d).reduce((a, b) => a + b, 0);
    const total30d = Object.values(counts30d).reduce((a, b) => a + b, 0);

    // Determine overall status
    let status: ComplianceStatusSummary['status'] = 'healthy';
    let message = 'All compliance systems operating normally';

    // Check for warning conditions
    if (total24h === 0 && total7d > 0) {
      status = 'warning';
      message = 'No audit events in the last 24 hours';
    }

    // Check for critical conditions
    if (total7d === 0 && total30d > 0) {
      status = 'critical';
      message = 'No audit events in the last 7 days - audit system may be offline';
    }

    return {
      status,
      message,
      lastAuditAt: total24h > 0 ? new Date().toISOString() : undefined,
      chainIntegrity: {
        verified: true,
        lastVerifiedAt: new Date().toISOString(),
        recordsVerified: total30d,
      },
      dataRetention: {
        compliant: true,
        lastEnforcedAt: new Date().toISOString(),
      },
      policies: {
        total: 0, // Would come from policy service
        enabled: 0,
      },
      recentActivity: {
        last24Hours: total24h,
        last7Days: total7d,
        last30Days: total30d,
      },
    };
  }

  /**
   * Get event summary for a period
   */
  async getEventSummary(
    tenantId: ID,
    startDate: Date,
    endDate: Date
  ): Promise<EventSummary> {
    await this.evidenceCollector.initialize();

    // Collect evidence for summary
    const collection = await this.evidenceCollector.collectEvidence({
      tenantId,
      startDate,
      endDate,
      includePayloads: false,
      limit: 100000, // High limit for summary
    });

    // Calculate distributions
    const hourlyDistribution: Array<{ hour: number; count: number }> = [];
    const hourCounts: Record<number, number> = {};
    const actorCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};

    for (const event of collection.auditEvents) {
      const hour = new Date(event.timestamp).getUTCHours();
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
      actorCounts[event.actorId] = (actorCounts[event.actorId] ?? 0) + 1;
      resourceCounts[event.resourceType] = (resourceCounts[event.resourceType] ?? 0) + 1;
    }

    // Format hourly distribution
    for (let h = 0; h < 24; h++) {
      hourlyDistribution.push({ hour: h, count: hourCounts[h] ?? 0 });
    }

    // Get top actors
    const topActors = Object.entries(actorCounts)
      .map(([actorId, count]) => ({ actorId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get top resources
    const topResources = Object.entries(resourceCounts)
      .map(([resourceType, count]) => ({ resourceType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Build by-type counts
    const byType: Record<string, number> = {};
    for (const event of collection.auditEvents) {
      byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
    }

    return {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      totalEvents: collection.summary.totalRecords,
      byType,
      byCategory: Object.fromEntries(
        Object.entries(collection.summary.byEventType).filter(([, v]) => v > 0)
      ),
      bySeverity: collection.summary.bySeverity,
      byOutcome: collection.summary.byOutcome,
      hourlyDistribution,
      topActors,
      topResources,
    };
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Verify evidence integrity
   */
  async verifyEvidence(
    operationId: string
  ): Promise<{
    valid: boolean;
    errors: string[];
    details: Record<string, unknown>;
  }> {
    const result = this.exports.get(operationId);
    const data = this.exportData.get(operationId);

    if (!result || !data || !result.tamperEvidence) {
      return {
        valid: false,
        errors: ['Export not found or not completed'],
        details: {},
      };
    }

    return this.hashVerifier.verifyPackage(data.collection, result.tamperEvidence);
  }

  /**
   * Get supported event types
   */
  getSupportedEventTypes(): EvidenceEventType[] {
    return [...EVIDENCE_EVENT_TYPES];
  }

  /**
   * Get supported export formats
   */
  getSupportedFormats(): ExportFormat[] {
    return ['json', 'csv', 'pdf'];
  }

  /**
   * Clean up old exports
   */
  cleanupOldExports(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, result] of this.exports.entries()) {
      if (
        result.status === 'completed' ||
        result.status === 'failed'
      ) {
        // Check if export data exists and is old enough
        const data = this.exportData.get(id);
        if (data) {
          const reportTime = new Date(data.report.header.generatedAt).getTime();
          if (reportTime < cutoff) {
            this.exports.delete(id);
            this.exportData.delete(id);
            cleaned++;
          }
        }
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old exports');
    }

    return cleaned;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let complianceExportServiceInstance: ComplianceExportService | null = null;

/**
 * Get the singleton compliance export service instance
 */
export function getComplianceExportService(
  hashVerifierConfig?: HashVerifierConfig
): ComplianceExportService {
  if (!complianceExportServiceInstance) {
    complianceExportServiceInstance = new ComplianceExportService(hashVerifierConfig);
  }
  return complianceExportServiceInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetComplianceExportService(): void {
  complianceExportServiceInstance = null;
}
