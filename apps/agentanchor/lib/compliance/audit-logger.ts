/**
 * Compliance Audit Logger
 * Immutable audit trail for SOC 2, HIPAA, ISO 27001
 *
 * RETENTION POLICY: All compliance audit records must be retained for a
 * minimum of 7 years per regulatory requirements:
 *   - SOC 2: Trust Services Criteria record-keeping
 *   - HIPAA: 45 CFR 164.530(j) - 6 years minimum, 7 years recommended
 *   - ISO 27001: A.5.33 - Per organizational/regulatory requirements
 * Automated purge policies MUST NOT delete records before their retention
 * expiry. See compliance_audit_logs.created_at + 7 years.
 */

import { createHash } from 'crypto';
import type {
  ComplianceFramework,
  PHIAccessLog,
  ComplianceEvidence,
  EvidenceType,
} from './types';
import { isDatabaseConfigured, getDb } from '../db';
import { complianceAuditLogs } from '../db/schema/compliance-audit-log';
import type { NewComplianceAuditLogRecord } from '../db/schema/compliance-audit-log';
import { createLogger } from '../logger';

// =============================================================================
// Audit Event Types
// =============================================================================

export type ComplianceAuditEventType =
  // Access Events
  | 'access_granted'
  | 'access_denied'
  | 'access_revoked'
  | 'authentication_success'
  | 'authentication_failure'
  | 'mfa_challenge'
  | 'session_start'
  | 'session_end'

  // Data Events
  | 'data_access'
  | 'data_create'
  | 'data_modify'
  | 'data_delete'
  | 'data_export'
  | 'data_encrypt'
  | 'data_decrypt'

  // PHI Events (HIPAA)
  | 'phi_access'
  | 'phi_disclosure'
  | 'phi_amendment'
  | 'phi_restriction'
  | 'consent_granted'
  | 'consent_revoked'

  // Security Events
  | 'security_alert'
  | 'vulnerability_detected'
  | 'incident_detected'
  | 'breach_suspected'
  | 'malware_detected'
  | 'intrusion_attempt'

  // Configuration Events
  | 'config_change'
  | 'policy_change'
  | 'permission_change'
  | 'agent_deployed'
  | 'agent_suspended'

  // Compliance Events
  | 'control_tested'
  | 'evidence_collected'
  | 'finding_created'
  | 'finding_remediated'
  | 'risk_assessed'
  | 'audit_started'
  | 'audit_completed';

export interface ComplianceAuditEvent {
  id: string;
  timestamp: Date;
  eventType: ComplianceAuditEventType;

  // Actor
  userId?: string;
  agentId?: string;
  ipAddress?: string;
  userAgent?: string;

  // Target
  resourceType: string;
  resourceId: string;

  // Action
  action: string;
  outcome: 'success' | 'failure' | 'denied' | 'error';

  // Context
  details: Record<string, unknown>;
  frameworks: ComplianceFramework[];
  controlIds: string[];

  // Integrity
  previousHash?: string;
  hash: string;

  // Classification
  sensitivity: 'low' | 'medium' | 'high' | 'critical';
  phiInvolved: boolean;
}

// =============================================================================
// Audit Logger Service
// =============================================================================

export class ComplianceAuditLogger {
  private static instance: ComplianceAuditLogger;
  private eventQueue: ComplianceAuditEvent[] = [];
  private lastHash: string = '';
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Start periodic flush
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  static getInstance(): ComplianceAuditLogger {
    if (!ComplianceAuditLogger.instance) {
      ComplianceAuditLogger.instance = new ComplianceAuditLogger();
    }
    return ComplianceAuditLogger.instance;
  }

  /**
   * Log a compliance audit event
   */
  async log(event: Omit<ComplianceAuditEvent, 'id' | 'timestamp' | 'hash' | 'previousHash'>): Promise<string> {
    const id = this.generateEventId();
    const timestamp = new Date();

    // Create event with chain hash
    const fullEvent: ComplianceAuditEvent = {
      ...event,
      id,
      timestamp,
      previousHash: this.lastHash,
      hash: '', // Will be calculated
    };

    // Calculate hash for integrity
    fullEvent.hash = this.calculateHash(fullEvent);
    this.lastHash = fullEvent.hash;

    // Add to queue
    this.eventQueue.push(fullEvent);

    // Immediate flush for critical events
    if (event.sensitivity === 'critical' || event.phiInvolved) {
      await this.flush();
    }

    return id;
  }

  /**
   * Log PHI access (HIPAA requirement)
   */
  async logPHIAccess(access: Omit<PHIAccessLog, 'id' | 'timestamp'>): Promise<string> {
    return this.log({
      eventType: 'phi_access',
      userId: access.userId,
      agentId: access.agentId,
      resourceType: 'phi',
      resourceId: access.patientIdentifierHash,
      action: access.action,
      outcome: access.authorized ? 'success' : 'denied',
      details: {
        phiType: access.phiType,
        purpose: access.purpose,
        minimumNecessary: access.minimumNecessary,
      },
      frameworks: ['hipaa'],
      controlIds: ['164.312(b)', '164.308(a)(1)(ii)(D)'],
      sensitivity: 'high',
      phiInvolved: true,
    });
  }

  /**
   * Log authentication event
   */
  async logAuthentication(params: {
    userId: string;
    success: boolean;
    method: 'password' | 'sso' | 'mfa' | 'api_key';
    ipAddress?: string;
    userAgent?: string;
    failureReason?: string;
  }): Promise<string> {
    return this.log({
      eventType: params.success ? 'authentication_success' : 'authentication_failure',
      userId: params.userId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      resourceType: 'auth',
      resourceId: params.userId,
      action: `authenticate_${params.method}`,
      outcome: params.success ? 'success' : 'failure',
      details: {
        method: params.method,
        failureReason: params.failureReason,
      },
      frameworks: ['soc2', 'iso27001'],
      controlIds: ['CC6.1', 'A.8.5'],
      sensitivity: params.success ? 'low' : 'medium',
      phiInvolved: false,
    });
  }

  /**
   * Log access control event
   */
  async logAccessControl(params: {
    userId: string;
    agentId?: string;
    resourceType: string;
    resourceId: string;
    action: 'granted' | 'denied' | 'revoked';
    permission: string;
    reason?: string;
  }): Promise<string> {
    return this.log({
      eventType: `access_${params.action}`,
      userId: params.userId,
      agentId: params.agentId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.permission,
      outcome: params.action === 'denied' ? 'denied' : 'success',
      details: {
        permission: params.permission,
        reason: params.reason,
      },
      frameworks: ['soc2', 'hipaa', 'iso27001'],
      controlIds: ['CC6.2', '164.308(a)(4)', 'A.5.18'],
      sensitivity: 'medium',
      phiInvolved: false,
    });
  }

  /**
   * Log data operation
   */
  async logDataOperation(params: {
    userId?: string;
    agentId?: string;
    operation: 'create' | 'read' | 'update' | 'delete' | 'export';
    resourceType: string;
    resourceId: string;
    dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
    success: boolean;
    error?: string;
  }): Promise<string> {
    const eventTypeMap = {
      create: 'data_create',
      read: 'data_access',
      update: 'data_modify',
      delete: 'data_delete',
      export: 'data_export',
    } as const;

    return this.log({
      eventType: eventTypeMap[params.operation],
      userId: params.userId,
      agentId: params.agentId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.operation,
      outcome: params.success ? 'success' : 'error',
      details: {
        dataClassification: params.dataClassification,
        error: params.error,
      },
      frameworks: ['soc2', 'iso27001'],
      controlIds: ['CC6.1', 'A.8.3'],
      sensitivity: params.dataClassification === 'restricted' ? 'high' : 'medium',
      phiInvolved: false,
    });
  }

  /**
   * Log security event
   */
  async logSecurityEvent(params: {
    eventType: 'security_alert' | 'vulnerability_detected' | 'incident_detected' | 'breach_suspected' | 'intrusion_attempt';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    source?: string;
    affectedResources?: string[];
    indicators?: Record<string, unknown>;
  }): Promise<string> {
    return this.log({
      eventType: params.eventType,
      resourceType: 'security',
      resourceId: params.source || 'system',
      action: params.title,
      outcome: 'success', // Event was logged
      details: {
        description: params.description,
        affectedResources: params.affectedResources,
        indicators: params.indicators,
      },
      frameworks: ['soc2', 'hipaa', 'iso27001'],
      controlIds: ['CC7.2', '164.308(a)(1)', 'A.8.16'],
      sensitivity: params.severity,
      phiInvolved: false,
    });
  }

  /**
   * Log configuration change
   */
  async logConfigChange(params: {
    userId: string;
    configType: 'policy' | 'permission' | 'system' | 'agent';
    resourceId: string;
    changeType: 'create' | 'update' | 'delete';
    previousValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }): Promise<string> {
    return this.log({
      eventType: params.configType === 'policy' ? 'policy_change' :
                 params.configType === 'permission' ? 'permission_change' : 'config_change',
      userId: params.userId,
      resourceType: params.configType,
      resourceId: params.resourceId,
      action: params.changeType,
      outcome: 'success',
      details: {
        previousValue: params.previousValue,
        newValue: params.newValue,
        reason: params.reason,
      },
      frameworks: ['soc2', 'iso27001'],
      controlIds: ['CC8.1', 'A.8.32'],
      sensitivity: 'high',
      phiInvolved: false,
    });
  }

  /**
   * Log compliance activity
   */
  async logComplianceActivity(params: {
    activityType: 'control_tested' | 'evidence_collected' | 'finding_created' | 'finding_remediated' | 'risk_assessed';
    userId: string;
    framework: ComplianceFramework;
    controlId?: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): Promise<string> {
    return this.log({
      eventType: params.activityType,
      userId: params.userId,
      resourceType: 'compliance',
      resourceId: params.resourceId,
      action: params.activityType,
      outcome: 'success',
      details: params.details,
      frameworks: [params.framework],
      controlIds: params.controlId ? [params.controlId] : [],
      sensitivity: 'medium',
      phiInvolved: false,
    });
  }

  /**
   * Collect evidence from audit logs
   */
  async collectEvidence(params: {
    title: string;
    description: string;
    type: EvidenceType;
    frameworks: ComplianceFramework[];
    controlIds: string[];
    startDate: Date;
    endDate: Date;
    filters?: Record<string, unknown>;
  }): Promise<ComplianceEvidence> {
    // In production, this would query the audit log database
    const evidenceId = this.generateEventId();

    const evidence: ComplianceEvidence = {
      id: evidenceId,
      type: params.type,
      title: params.title,
      description: params.description,
      collectedAt: new Date(),
      collectedBy: 'compliance-audit-logger',
      dataHash: this.calculateEvidenceHash(params),
      retentionDate: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000), // 7 years
      frameworks: params.frameworks,
      controlIds: params.controlIds,
    };

    // Log evidence collection
    await this.logComplianceActivity({
      activityType: 'evidence_collected',
      userId: 'system',
      framework: params.frameworks[0],
      controlId: params.controlIds[0],
      resourceId: evidenceId,
      details: {
        title: params.title,
        type: params.type,
        dateRange: { start: params.startDate, end: params.endDate },
      },
    });

    return evidence;
  }

  /**
   * Flush event queue to storage
   *
   * Persists queued audit events to the compliance_audit_logs table
   * asynchronously. Failures are logged but never thrown — audit
   * persistence must not block the main application flow.
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    const log = createLogger({ component: 'ComplianceAuditLogger' });

    try {
      if (process.env.NODE_ENV === 'development') {
        log.debug({ count: events.length }, `Flushing ${events.length} compliance audit events`);
      }

      // Persist to compliance_audit_logs table via Drizzle ORM
      await this.persistEvents(events);
    } catch (error) {
      // Re-queue events on failure so they can be retried on next flush
      this.eventQueue = [...events, ...this.eventQueue];
      log.error(
        { err: error, eventCount: events.length },
        'Failed to persist compliance audit events — events re-queued for retry'
      );
    }
  }

  /**
   * Persist audit events to the compliance_audit_logs table.
   * Fire-and-forget safe: errors are caught and logged, never thrown
   * to callers outside flush().
   */
  private async persistEvents(events: ComplianceAuditEvent[]): Promise<void> {
    if (!isDatabaseConfigured()) {
      // No database available — skip silently in development, warn in production
      if (process.env.NODE_ENV !== 'development') {
        const log = createLogger({ component: 'ComplianceAuditLogger' });
        log.warn('DATABASE_URL not configured — compliance audit events not persisted');
      }
      return;
    }

    const db = getDb();
    const rows: NewComplianceAuditLogRecord[] = events.map((event) =>
      this.mapEventToRow(event)
    );

    // Batch insert all events in a single query
    await db.insert(complianceAuditLogs).values(rows);
  }

  /**
   * Map an in-memory ComplianceAuditEvent to a database row
   */
  private mapEventToRow(event: ComplianceAuditEvent): NewComplianceAuditLogRecord {
    // Determine actor identity and type
    let actorId: string | undefined;
    let actorType: string | undefined;

    if (event.agentId) {
      actorId = event.agentId;
      actorType = 'agent';
    } else if (event.userId) {
      actorId = event.userId;
      actorType = 'user';
    } else {
      actorId = 'system';
      actorType = 'system';
    }

    return {
      id: event.id,
      eventType: event.eventType,
      entityId: event.resourceId,
      entityType: event.resourceType,
      action: event.action,
      details: event.details,
      actorId,
      actorType,
      tenantId: null, // Multi-tenant isolation — populated when tenancy is enabled
      timestamp: event.timestamp,
      metadata: {
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        // Preserve both actor IDs when an agent acts on behalf of a user
        ...(event.agentId && event.userId
          ? { userId: event.userId, agentId: event.agentId }
          : {}),
      },
      outcome: event.outcome,
      sensitivity: event.sensitivity,
      frameworks: event.frameworks,
      controlIds: event.controlIds,
      phiInvolved: event.phiInvolved,
      previousHash: event.previousHash ?? null,
      hash: event.hash,
    };
  }

  /**
   * Query audit logs
   */
  async query(params: {
    startDate?: Date;
    endDate?: Date;
    eventTypes?: ComplianceAuditEventType[];
    userId?: string;
    agentId?: string;
    resourceType?: string;
    frameworks?: ComplianceFramework[];
    phiOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ComplianceAuditEvent[]> {
    // In production, this would query the database
    // For now, return queued events that match filters
    let results = [...this.eventQueue];

    if (params.startDate) {
      results = results.filter(e => e.timestamp >= params.startDate!);
    }
    if (params.endDate) {
      results = results.filter(e => e.timestamp <= params.endDate!);
    }
    if (params.eventTypes?.length) {
      results = results.filter(e => params.eventTypes!.includes(e.eventType));
    }
    if (params.userId) {
      results = results.filter(e => e.userId === params.userId);
    }
    if (params.agentId) {
      results = results.filter(e => e.agentId === params.agentId);
    }
    if (params.resourceType) {
      results = results.filter(e => e.resourceType === params.resourceType);
    }
    if (params.frameworks?.length) {
      results = results.filter(e =>
        e.frameworks.some(f => params.frameworks!.includes(f))
      );
    }
    if (params.phiOnly) {
      results = results.filter(e => e.phiInvolved);
    }

    const offset = params.offset || 0;
    const limit = params.limit || 100;

    return results.slice(offset, offset + limit);
  }

  /**
   * Verify audit log integrity
   */
  async verifyIntegrity(events: ComplianceAuditEvent[]): Promise<{
    valid: boolean;
    invalidEvents: string[];
  }> {
    const invalidEvents: string[] = [];
    let previousHash = '';

    for (const event of events) {
      // Verify chain integrity
      if (event.previousHash !== previousHash) {
        invalidEvents.push(event.id);
        continue;
      }

      // Verify event hash - exclude hash from spread
      const { hash: _, ...eventWithoutHash } = event;
      const calculatedHash = this.calculateHash(eventWithoutHash);

      if (calculatedHash !== event.hash) {
        invalidEvents.push(event.id);
      }

      previousHash = event.hash;
    }

    return {
      valid: invalidEvents.length === 0,
      invalidEvents,
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private generateEventId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateHash(event: Omit<ComplianceAuditEvent, 'hash'>): string {
    const data = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      eventType: event.eventType,
      userId: event.userId,
      agentId: event.agentId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      action: event.action,
      outcome: event.outcome,
      previousHash: event.previousHash,
    });

    return createHash('sha256').update(data).digest('hex');
  }

  private calculateEvidenceHash(params: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(params)).digest('hex');
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}

// Export singleton
export const complianceAuditLogger = ComplianceAuditLogger.getInstance();
