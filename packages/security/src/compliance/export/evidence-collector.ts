/**
 * Evidence Collector
 *
 * Collects audit events, policy changes, access logs, and other compliance
 * evidence for external auditor export.
 *
 * @packageDocumentation
 */

import { eq, and, gte, lte, desc, inArray, sql } from 'drizzle-orm';
import { createLogger } from '../../common/logger.js';
import { getDatabase, type Database } from '../../common/db.js';
import type { ID, Timestamp } from '../../common/types.js';
import {
  auditEntries,
  type AuditEntry,
  type AuditQueryFilter,
} from '../../audit/db-store.js';
import type { AuditRecord, AuditEventType, AuditCategory } from '../../audit/types.js';

const logger = createLogger({ component: 'evidence-collector' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Evidence types that can be collected
 */
export const EVIDENCE_EVENT_TYPES = [
  'audit',
  'policy_change',
  'access_decision',
  'trust_score_change',
  'escalation_decision',
  'data_retention',
] as const;

export type EvidenceEventType = (typeof EVIDENCE_EVENT_TYPES)[number];

/**
 * Filter options for evidence collection
 */
export interface EvidenceCollectionFilter {
  /** Tenant ID (required) */
  tenantId: ID;
  /** Start date for collection period */
  startDate: Date;
  /** End date for collection period */
  endDate: Date;
  /** Event types to include (defaults to all) */
  eventTypes?: EvidenceEventType[];
  /** Include full payloads (defaults to false for summary data) */
  includePayloads?: boolean;
  /** Maximum records per event type */
  limit?: number;
}

/**
 * Collected audit event
 */
export interface CollectedAuditEvent {
  id: string;
  timestamp: Timestamp;
  eventType: string;
  category: string;
  severity: string;
  actorId: string;
  actorType: string;
  actorName?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  outcome: string;
  reason?: string;
  tenantId: ID;
  requestId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Collected policy change record
 */
export interface CollectedPolicyChange {
  id: string;
  timestamp: Timestamp;
  policyId: string;
  policyName: string;
  version: string;
  previousVersion?: string;
  changeType: 'created' | 'updated' | 'published' | 'deprecated' | 'archived';
  changedBy: string;
  changedByType: string;
  changeDescription?: string;
  diff?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}

/**
 * Collected access decision
 */
export interface CollectedAccessDecision {
  id: string;
  timestamp: Timestamp;
  intentId: string;
  entityId: string;
  entityType: string;
  action: string;
  resource: string;
  decision: 'granted' | 'denied';
  reason?: string;
  trustScore?: number;
  trustLevel?: number;
  policyEvaluated?: string[];
  constraintsApplied?: string[];
}

/**
 * Collected trust score change
 */
export interface CollectedTrustScoreChange {
  id: string;
  timestamp: Timestamp;
  entityId: string;
  entityType: string;
  previousScore: number;
  newScore: number;
  previousLevel: number;
  newLevel: number;
  changeReason: string;
  signalType?: string;
  signalSource?: string;
}

/**
 * Collected escalation decision
 */
export interface CollectedEscalationDecision {
  id: string;
  timestamp: Timestamp;
  escalationId: string;
  intentId: string;
  reason: string;
  escalatedTo: string;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  resolvedBy?: string;
  resolvedAt?: Timestamp;
  resolutionNotes?: string;
  timeToResolution?: number; // milliseconds
}

/**
 * Collected data retention log
 */
export interface CollectedDataRetentionLog {
  id: string;
  timestamp: Timestamp;
  operation: 'archive' | 'purge' | 'delete' | 'anonymize';
  dataType: string;
  recordCount: number;
  retentionPolicy: string;
  triggeredBy: 'scheduled' | 'manual' | 'gdpr_request';
  requestId?: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Complete evidence collection result
 */
export interface EvidenceCollection {
  /** Collection metadata */
  metadata: {
    collectionId: string;
    tenantId: ID;
    collectedAt: Timestamp;
    periodStart: Timestamp;
    periodEnd: Timestamp;
    collectorVersion: string;
    eventTypesIncluded: EvidenceEventType[];
    includePayloads: boolean;
  };

  /** Collected evidence by type */
  auditEvents: CollectedAuditEvent[];
  policyChanges: CollectedPolicyChange[];
  accessDecisions: CollectedAccessDecision[];
  trustScoreChanges: CollectedTrustScoreChange[];
  escalationDecisions: CollectedEscalationDecision[];
  dataRetentionLogs: CollectedDataRetentionLog[];

  /** Summary statistics */
  summary: {
    totalRecords: number;
    byEventType: Record<EvidenceEventType, number>;
    byOutcome: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

// =============================================================================
// EVIDENCE COLLECTOR
// =============================================================================

/**
 * Collector for compliance evidence
 *
 * Aggregates audit events, policy changes, access decisions, and other
 * compliance-relevant data for export to external auditors.
 */
export class EvidenceCollector {
  private db: Database | null = null;
  private initialized: boolean = false;
  private readonly collectorVersion = '1.0.0';

  constructor() {}

  /**
   * Initialize the collector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = getDatabase();
    this.initialized = true;

    logger.info('Evidence collector initialized');
  }

  /**
   * Ensure collector is initialized
   */
  private async ensureInitialized(): Promise<Database> {
    if (!this.initialized || !this.db) {
      await this.initialize();
    }
    return this.db!;
  }

  /**
   * Collect all evidence based on filters
   */
  async collectEvidence(filter: EvidenceCollectionFilter): Promise<EvidenceCollection> {
    const db = await this.ensureInitialized();

    const collectionId = crypto.randomUUID();
    const eventTypes = filter.eventTypes ?? [...EVIDENCE_EVENT_TYPES];

    logger.info(
      {
        collectionId,
        tenantId: filter.tenantId,
        startDate: filter.startDate.toISOString(),
        endDate: filter.endDate.toISOString(),
        eventTypes,
      },
      'Starting evidence collection'
    );

    const startTime = Date.now();

    // Collect evidence for each requested type
    const [
      auditEvents,
      policyChanges,
      accessDecisions,
      trustScoreChanges,
      escalationDecisions,
      dataRetentionLogs,
    ] = await Promise.all([
      eventTypes.includes('audit')
        ? this.collectAuditEvents(db, filter)
        : Promise.resolve([]),
      eventTypes.includes('policy_change')
        ? this.collectPolicyChanges(db, filter)
        : Promise.resolve([]),
      eventTypes.includes('access_decision')
        ? this.collectAccessDecisions(db, filter)
        : Promise.resolve([]),
      eventTypes.includes('trust_score_change')
        ? this.collectTrustScoreChanges(db, filter)
        : Promise.resolve([]),
      eventTypes.includes('escalation_decision')
        ? this.collectEscalationDecisions(db, filter)
        : Promise.resolve([]),
      eventTypes.includes('data_retention')
        ? this.collectDataRetentionLogs(db, filter)
        : Promise.resolve([]),
    ]);

    // Calculate summary statistics
    const summary = this.calculateSummary(
      auditEvents,
      policyChanges,
      accessDecisions,
      trustScoreChanges,
      escalationDecisions,
      dataRetentionLogs
    );

    const collection: EvidenceCollection = {
      metadata: {
        collectionId,
        tenantId: filter.tenantId,
        collectedAt: new Date().toISOString(),
        periodStart: filter.startDate.toISOString(),
        periodEnd: filter.endDate.toISOString(),
        collectorVersion: this.collectorVersion,
        eventTypesIncluded: eventTypes,
        includePayloads: filter.includePayloads ?? false,
      },
      auditEvents,
      policyChanges,
      accessDecisions,
      trustScoreChanges,
      escalationDecisions,
      dataRetentionLogs,
      summary,
    };

    const duration = Date.now() - startTime;

    logger.info(
      {
        collectionId,
        totalRecords: summary.totalRecords,
        durationMs: duration,
      },
      'Evidence collection completed'
    );

    return collection;
  }

  /**
   * Collect audit events from the audit log
   */
  private async collectAuditEvents(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedAuditEvent[]> {
    const limit = filter.limit ?? 10000;

    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate)
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => ({
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      eventType: record.eventType,
      category: record.category,
      severity: record.severity ?? 'info',
      actorId: record.actorId,
      actorType: record.actorType,
      actorName: record.actorName ?? undefined,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      resourceName: record.resourceName ?? undefined,
      outcome: record.outcome ?? 'success',
      reason: record.reason ?? undefined,
      tenantId: record.tenantId,
      requestId: record.requestId ?? undefined,
      traceId: record.traceId ?? undefined,
      metadata: filter.includePayloads ? (record.metadata ?? undefined) : undefined,
    }));
  }

  /**
   * Collect policy change events
   */
  private async collectPolicyChanges(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedPolicyChange[]> {
    const limit = filter.limit ?? 10000;

    // Query audit entries for policy events
    const policyEventTypes = [
      'policy.created',
      'policy.updated',
      'policy.published',
      'policy.deprecated',
      'policy.archived',
    ];

    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate),
          inArray(auditEntries.eventType, policyEventTypes)
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => {
      const metadata = record.metadata as Record<string, unknown> | null;
      const changeType = this.mapPolicyEventToChangeType(record.eventType);

      return {
        id: record.id,
        timestamp: record.timestamp.toISOString(),
        policyId: record.resourceId,
        policyName: record.resourceName ?? 'Unknown Policy',
        version: (metadata?.['version'] as string) ?? '1.0',
        previousVersion: metadata?.['previousVersion'] as string | undefined,
        changeType,
        changedBy: record.actorId,
        changedByType: record.actorType,
        changeDescription: record.reason ?? undefined,
        diff: filter.includePayloads
          ? {
              before: metadata?.['before'] as Record<string, unknown> | undefined,
              after: metadata?.['after'] as Record<string, unknown> | undefined,
            }
          : undefined,
      };
    });
  }

  /**
   * Map policy event type to change type
   */
  private mapPolicyEventToChangeType(
    eventType: string
  ): CollectedPolicyChange['changeType'] {
    switch (eventType) {
      case 'policy.created':
        return 'created';
      case 'policy.updated':
        return 'updated';
      case 'policy.published':
        return 'published';
      case 'policy.deprecated':
        return 'deprecated';
      case 'policy.archived':
        return 'archived';
      default:
        return 'updated';
    }
  }

  /**
   * Collect access control decisions
   */
  private async collectAccessDecisions(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedAccessDecision[]> {
    const limit = filter.limit ?? 10000;

    // Query audit entries for access decisions
    const accessEventTypes = ['authz.granted', 'authz.denied', 'authz.elevated'];

    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate),
          inArray(auditEntries.eventType, accessEventTypes)
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => {
      const metadata = record.metadata as Record<string, unknown> | null;

      return {
        id: record.id,
        timestamp: record.timestamp.toISOString(),
        intentId: (metadata?.['intentId'] as string) ?? record.resourceId,
        entityId: record.actorId,
        entityType: record.actorType,
        action: record.action,
        resource: `${record.resourceType}:${record.resourceId}`,
        decision: record.eventType === 'authz.denied' ? 'denied' : 'granted',
        reason: record.reason ?? undefined,
        trustScore: metadata?.['trustScore'] as number | undefined,
        trustLevel: metadata?.['trustLevel'] as number | undefined,
        policyEvaluated: metadata?.['policiesEvaluated'] as string[] | undefined,
        constraintsApplied: metadata?.['constraintsApplied'] as string[] | undefined,
      };
    });
  }

  /**
   * Collect trust score change events
   */
  private async collectTrustScoreChanges(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedTrustScoreChange[]> {
    const limit = filter.limit ?? 10000;

    // Query audit entries for trust score changes
    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate),
          eq(auditEntries.category, 'system'),
          sql`${auditEntries.eventType} LIKE 'trust.%'`
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => {
      const metadata = record.metadata as Record<string, unknown> | null;

      return {
        id: record.id,
        timestamp: record.timestamp.toISOString(),
        entityId: record.resourceId,
        entityType: record.resourceType,
        previousScore: (metadata?.['previousScore'] as number) ?? 0,
        newScore: (metadata?.['newScore'] as number) ?? 0,
        previousLevel: (metadata?.['previousLevel'] as number) ?? 0,
        newLevel: (metadata?.['newLevel'] as number) ?? 0,
        changeReason: record.reason ?? 'Score update',
        signalType: metadata?.['signalType'] as string | undefined,
        signalSource: metadata?.['signalSource'] as string | undefined,
      };
    });
  }

  /**
   * Collect escalation decision events
   */
  private async collectEscalationDecisions(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedEscalationDecision[]> {
    const limit = filter.limit ?? 10000;

    // Query audit entries for escalation events
    const escalationEventTypes = [
      'escalation.created',
      'escalation.acknowledged',
      'escalation.approved',
      'escalation.rejected',
      'escalation.timeout',
      'escalation.cancelled',
    ];

    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate),
          inArray(auditEntries.eventType, escalationEventTypes)
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => {
      const metadata = record.metadata as Record<string, unknown> | null;
      const status = this.mapEscalationEventToStatus(record.eventType);

      return {
        id: record.id,
        timestamp: record.timestamp.toISOString(),
        escalationId: record.resourceId,
        intentId: (metadata?.['intentId'] as string) ?? '',
        reason: record.reason ?? 'Escalation required',
        escalatedTo: (metadata?.['escalatedTo'] as string) ?? '',
        status,
        resolvedBy: metadata?.['resolvedBy'] as string | undefined,
        resolvedAt: metadata?.['resolvedAt'] as string | undefined,
        resolutionNotes: metadata?.['resolutionNotes'] as string | undefined,
        timeToResolution: metadata?.['timeToResolution'] as number | undefined,
      };
    });
  }

  /**
   * Map escalation event type to status
   */
  private mapEscalationEventToStatus(
    eventType: string
  ): CollectedEscalationDecision['status'] {
    switch (eventType) {
      case 'escalation.created':
      case 'escalation.acknowledged':
        return 'pending';
      case 'escalation.approved':
        return 'approved';
      case 'escalation.rejected':
      case 'escalation.cancelled':
        return 'rejected';
      case 'escalation.timeout':
        return 'timeout';
      default:
        return 'pending';
    }
  }

  /**
   * Collect data retention enforcement logs
   */
  private async collectDataRetentionLogs(
    db: Database,
    filter: EvidenceCollectionFilter
  ): Promise<CollectedDataRetentionLog[]> {
    const limit = filter.limit ?? 10000;

    // Query audit entries for data retention events
    const dataRetentionEventTypes = [
      'data.deleted',
      'data.exported',
      'system.config.changed',
    ];

    const results = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, filter.tenantId),
          gte(auditEntries.timestamp, filter.startDate),
          lte(auditEntries.timestamp, filter.endDate),
          inArray(auditEntries.eventType, dataRetentionEventTypes)
        )
      )
      .orderBy(desc(auditEntries.timestamp))
      .limit(limit);

    return results.map((record) => {
      const metadata = record.metadata as Record<string, unknown> | null;

      return {
        id: record.id,
        timestamp: record.timestamp.toISOString(),
        operation: this.mapDataEventToOperation(record.eventType),
        dataType: record.resourceType,
        recordCount: (metadata?.['recordCount'] as number) ?? 1,
        retentionPolicy: (metadata?.['retentionPolicy'] as string) ?? 'default',
        triggeredBy: (metadata?.['triggeredBy'] as 'scheduled' | 'manual' | 'gdpr_request') ?? 'manual',
        requestId: record.requestId ?? undefined,
        success: record.outcome === 'success',
        errorMessage: record.outcome !== 'success' ? record.reason ?? undefined : undefined,
      };
    });
  }

  /**
   * Map data event type to operation
   */
  private mapDataEventToOperation(eventType: string): CollectedDataRetentionLog['operation'] {
    switch (eventType) {
      case 'data.deleted':
        return 'delete';
      case 'data.exported':
        return 'archive';
      default:
        return 'purge';
    }
  }

  /**
   * Calculate summary statistics for the collection
   */
  private calculateSummary(
    auditEvents: CollectedAuditEvent[],
    policyChanges: CollectedPolicyChange[],
    accessDecisions: CollectedAccessDecision[],
    trustScoreChanges: CollectedTrustScoreChange[],
    escalationDecisions: CollectedEscalationDecision[],
    dataRetentionLogs: CollectedDataRetentionLog[]
  ): EvidenceCollection['summary'] {
    const byEventType: Record<EvidenceEventType, number> = {
      audit: auditEvents.length,
      policy_change: policyChanges.length,
      access_decision: accessDecisions.length,
      trust_score_change: trustScoreChanges.length,
      escalation_decision: escalationDecisions.length,
      data_retention: dataRetentionLogs.length,
    };

    const byOutcome: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    // Count outcomes from audit events
    for (const event of auditEvents) {
      byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
    }

    // Count access decisions
    for (const decision of accessDecisions) {
      byOutcome[decision.decision] = (byOutcome[decision.decision] ?? 0) + 1;
    }

    // Count escalation outcomes
    for (const escalation of escalationDecisions) {
      byOutcome[`escalation_${escalation.status}`] =
        (byOutcome[`escalation_${escalation.status}`] ?? 0) + 1;
    }

    // Count data retention outcomes
    for (const log of dataRetentionLogs) {
      byOutcome[log.success ? 'success' : 'failure'] =
        (byOutcome[log.success ? 'success' : 'failure'] ?? 0) + 1;
    }

    const totalRecords =
      auditEvents.length +
      policyChanges.length +
      accessDecisions.length +
      trustScoreChanges.length +
      escalationDecisions.length +
      dataRetentionLogs.length;

    return {
      totalRecords,
      byEventType,
      byOutcome,
      bySeverity,
    };
  }

  /**
   * Get event counts by category for a time period
   */
  async getEventCounts(
    tenantId: ID,
    startDate: Date,
    endDate: Date
  ): Promise<Record<string, number>> {
    const db = await this.ensureInitialized();

    const results = await db
      .select({
        category: auditEntries.category,
        count: sql<number>`count(*)::int`,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, tenantId),
          gte(auditEntries.timestamp, startDate),
          lte(auditEntries.timestamp, endDate)
        )
      )
      .groupBy(auditEntries.category);

    return Object.fromEntries(results.map((r) => [r.category, r.count]));
  }

  /**
   * Get event counts by time period (hourly, daily, weekly)
   */
  async getEventCountsByPeriod(
    tenantId: ID,
    startDate: Date,
    endDate: Date,
    period: 'hour' | 'day' | 'week'
  ): Promise<Array<{ period: string; count: number }>> {
    const db = await this.ensureInitialized();

    const truncExpr =
      period === 'hour'
        ? sql`date_trunc('hour', ${auditEntries.timestamp})`
        : period === 'day'
          ? sql`date_trunc('day', ${auditEntries.timestamp})`
          : sql`date_trunc('week', ${auditEntries.timestamp})`;

    const results = await db
      .select({
        period: truncExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, tenantId),
          gte(auditEntries.timestamp, startDate),
          lte(auditEntries.timestamp, endDate)
        )
      )
      .groupBy(truncExpr)
      .orderBy(truncExpr);

    return results.map((r) => ({
      period: (r.period as Date).toISOString(),
      count: r.count,
    }));
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let evidenceCollectorInstance: EvidenceCollector | null = null;

/**
 * Get the singleton evidence collector instance
 */
export function getEvidenceCollector(): EvidenceCollector {
  if (!evidenceCollectorInstance) {
    evidenceCollectorInstance = new EvidenceCollector();
  }
  return evidenceCollectorInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetEvidenceCollector(): void {
  evidenceCollectorInstance = null;
}
