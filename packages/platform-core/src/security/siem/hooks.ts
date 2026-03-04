/**
 * SIEM Integration Hooks
 *
 * Pre-built integration hooks for common use cases:
 * - Auto-forward security alerts
 * - Auto-forward audit logs
 * - Auto-forward anomaly detections
 * - Configurable event filtering
 *
 * @packageDocumentation
 * @module security/siem/hooks
 */

import { createLogger } from '../../common/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type { SIEMService } from './service.js';
import type {
  SecurityEvent,
  EventCategory,
  EventSeverity,
  EventOutcome,
  IntegrationHook,
  EventFilter,
  EventTransformer,
} from './types.js';
import type { SecurityAlert } from '../alerting/types.js';
import type { Anomaly } from '../anomaly/types.js';
import type { AuditRecord } from '../../audit/types.js';

const logger = createLogger({ component: 'siem-hooks' });

// =============================================================================
// Security Alert Hook
// =============================================================================

/**
 * Configuration for security alert hook
 */
export interface SecurityAlertHookConfig {
  /** Only forward alerts with these severities */
  severities?: string[];
  /** Only forward alerts with these types */
  alertTypes?: string[];
  /** Include raw alert data */
  includeRawData?: boolean;
  /** Additional tags to add */
  additionalTags?: string[];
}

/**
 * Create a hook for forwarding security alerts to SIEM
 */
export function createSecurityAlertHook(
  config: SecurityAlertHookConfig = {}
): IntegrationHook {
  const severityFilter = config.severities?.map((s) => s.toLowerCase());
  const typeFilter = config.alertTypes;

  const filter: EventFilter = (event) => {
    // Check severity filter
    if (severityFilter && severityFilter.length > 0) {
      const eventSeverity = getSeverityName(event.severity);
      if (!severityFilter.includes(eventSeverity)) {
        return false;
      }
    }

    return true;
  };

  const transformer: EventTransformer = (event) => {
    // Add additional tags
    if (config.additionalTags && config.additionalTags.length > 0) {
      return {
        ...event,
        tags: [...(event.tags ?? []), ...config.additionalTags],
      };
    }
    return event;
  };

  return {
    name: 'security-alerts',
    eventTypes: typeFilter ?? [],
    filter,
    transformer,
    enabled: true,
  };
}

/**
 * Convert a SecurityAlert to a SecurityEvent for SIEM
 */
export function securityAlertToEvent(alert: SecurityAlert): SecurityEvent {
  return {
    id: alert.id,
    timestamp: alert.timestamp,
    eventType: alert.type,
    category: mapAlertCategory(alert.type),
    severity: mapAlertSeverity(alert.severity),
    outcome: 'success',
    message: alert.message,
    description: alert.title,
    source: alert.source,
    sourceIp: alert.context.ipAddress,
    requestId: alert.context.requestId,
    userAgent: alert.context.userAgent,
    user: {
      userId: alert.context.userId,
      tenantId: alert.context.tenantId,
    },
    geo: alert.context.location
      ? {
          country: alert.context.location.country,
          city: alert.context.location.city,
          latitude: alert.context.location.latitude,
          longitude: alert.context.location.longitude,
        }
      : undefined,
    tags: alert.tags,
    customFields: {
      alert_fingerprint: alert.fingerprint,
      alert_acknowledged: alert.acknowledged,
      alert_resolved: alert.resolved,
      suggested_actions: alert.suggestedActions,
      related_alerts: alert.relatedAlerts,
    },
    rawData: alert.context.metadata as Record<string, unknown> | undefined,
  };
}

// =============================================================================
// Audit Log Hook
// =============================================================================

/**
 * Configuration for audit log hook
 */
export interface AuditLogHookConfig {
  /** Only forward audit logs with these categories */
  categories?: string[];
  /** Only forward audit logs with these severities */
  severities?: string[];
  /** Only forward audit logs with these outcomes */
  outcomes?: string[];
  /** Exclude certain event types */
  excludeEventTypes?: string[];
  /** Include state change data */
  includeStateChange?: boolean;
  /** Additional tags to add */
  additionalTags?: string[];
}

/**
 * Create a hook for forwarding audit logs to SIEM
 */
export function createAuditLogHook(
  config: AuditLogHookConfig = {}
): IntegrationHook {
  const categoryFilter = config.categories?.map((c) => c.toLowerCase());
  const severityFilter = config.severities?.map((s) => s.toLowerCase());
  const outcomeFilter = config.outcomes?.map((o) => o.toLowerCase());
  const excludeTypes = config.excludeEventTypes ?? [];

  const filter: EventFilter = (event) => {
    // Check excluded types
    if (excludeTypes.includes(event.eventType)) {
      return false;
    }

    // Check category filter
    if (categoryFilter && categoryFilter.length > 0) {
      if (!categoryFilter.includes(event.category.toLowerCase())) {
        return false;
      }
    }

    // Check severity filter
    if (severityFilter && severityFilter.length > 0) {
      const eventSeverity = getSeverityName(event.severity);
      if (!severityFilter.includes(eventSeverity)) {
        return false;
      }
    }

    // Check outcome filter
    if (outcomeFilter && outcomeFilter.length > 0) {
      if (!outcomeFilter.includes(event.outcome.toLowerCase())) {
        return false;
      }
    }

    return true;
  };

  const transformer: EventTransformer = (event) => {
    let transformedEvent = event;

    // Remove state change if not included
    if (!config.includeStateChange && event.rawData?.stateChange) {
      const { stateChange, ...rest } = event.rawData;
      transformedEvent = {
        ...event,
        rawData: rest,
      };
    }

    // Add additional tags
    if (config.additionalTags && config.additionalTags.length > 0) {
      transformedEvent = {
        ...transformedEvent,
        tags: [...(transformedEvent.tags ?? []), ...config.additionalTags],
      };
    }

    return transformedEvent;
  };

  return {
    name: 'audit-logs',
    eventTypes: [],
    filter,
    transformer,
    enabled: true,
  };
}

/**
 * Convert an AuditRecord to a SecurityEvent for SIEM
 */
export function auditRecordToEvent(record: AuditRecord): SecurityEvent {
  return {
    id: record.id,
    timestamp: new Date(record.eventTime),
    eventType: record.eventType,
    category: mapAuditCategory(record.eventCategory),
    severity: mapAuditSeverity(record.severity),
    outcome: mapAuditOutcome(record.outcome),
    message: `${record.action} by ${record.actor.type} ${record.actor.id}`,
    description: record.reason ?? undefined,
    source: 'vorion',
    component: 'audit',
    sourceIp: record.actor.ip,
    requestId: record.requestId,
    user: {
      userId: record.actor.id,
      username: record.actor.name,
      tenantId: record.tenantId,
    },
    tags: record.tags ?? undefined,
    customFields: {
      actor_type: record.actor.type,
      target_type: record.target.type,
      target_id: record.target.id,
      target_name: record.target.name,
      sequence_number: record.sequenceNumber,
      record_hash: record.recordHash,
      previous_hash: record.previousHash,
    },
    rawData: {
      stateChange: record.stateChange,
      metadata: record.metadata,
    },
  };
}

// =============================================================================
// Anomaly Detection Hook
// =============================================================================

/**
 * Configuration for anomaly detection hook
 */
export interface AnomalyHookConfig {
  /** Only forward anomalies with these types */
  anomalyTypes?: string[];
  /** Minimum confidence threshold (0-100) */
  minConfidence?: number;
  /** Only forward anomalies with these severities */
  severities?: string[];
  /** Include indicators */
  includeIndicators?: boolean;
  /** Additional tags to add */
  additionalTags?: string[];
}

/**
 * Create a hook for forwarding anomaly detections to SIEM
 */
export function createAnomalyHook(
  config: AnomalyHookConfig = {}
): IntegrationHook {
  const typeFilter = config.anomalyTypes;
  const minConfidence = config.minConfidence ?? 0;
  const severityFilter = config.severities?.map((s) => s.toLowerCase());

  const filter: EventFilter = (event) => {
    // Check confidence threshold
    const confidence = event.customFields?.confidence as number | undefined;
    if (confidence !== undefined && confidence < minConfidence) {
      return false;
    }

    // Check severity filter
    if (severityFilter && severityFilter.length > 0) {
      const eventSeverity = getSeverityName(event.severity);
      if (!severityFilter.includes(eventSeverity)) {
        return false;
      }
    }

    return true;
  };

  const transformer: EventTransformer = (event) => {
    let transformedEvent = event;

    // Remove indicators if not included
    if (!config.includeIndicators && event.customFields?.indicators) {
      const { indicators, ...rest } = event.customFields;
      transformedEvent = {
        ...event,
        customFields: rest,
      };
    }

    // Add additional tags
    if (config.additionalTags && config.additionalTags.length > 0) {
      transformedEvent = {
        ...transformedEvent,
        tags: [...(transformedEvent.tags ?? []), ...config.additionalTags],
      };
    }

    return transformedEvent;
  };

  return {
    name: 'anomaly-detections',
    eventTypes: typeFilter ?? [],
    filter,
    transformer,
    enabled: true,
  };
}

/**
 * Convert an Anomaly to a SecurityEvent for SIEM
 */
export function anomalyToEvent(anomaly: Anomaly): SecurityEvent {
  return {
    id: anomaly.id,
    timestamp: anomaly.timestamp,
    eventType: `anomaly.${anomaly.type}`,
    category: 'anomaly',
    severity: mapAnomalySeverity(anomaly.severity),
    outcome: 'success',
    message: anomaly.description,
    source: 'vorion',
    component: 'anomaly-detector',
    sourceIp: anomaly.ipAddress,
    user: {
      userId: anomaly.userId,
      tenantId: anomaly.tenantId,
    },
    customFields: {
      anomaly_type: anomaly.type,
      confidence: anomaly.confidence,
      indicators: anomaly.indicators,
      suggested_actions: anomaly.suggestedActions,
    },
    rawData: anomaly.metadata as Record<string, unknown> | undefined,
  };
}

// =============================================================================
// SIEM Service Integration Helpers
// =============================================================================

/**
 * Register standard hooks with a SIEM service
 */
export function registerStandardHooks(
  siemService: SIEMService,
  config?: {
    alerts?: SecurityAlertHookConfig | false;
    audit?: AuditLogHookConfig | false;
    anomaly?: AnomalyHookConfig | false;
  }
): void {
  // Security alerts hook
  if (config?.alerts !== false) {
    siemService.addHook(
      createSecurityAlertHook(
        config?.alerts ?? {
          includeRawData: true,
        }
      )
    );
    logger.info('Registered security alerts hook');
  }

  // Audit logs hook
  if (config?.audit !== false) {
    siemService.addHook(
      createAuditLogHook(
        config?.audit ?? {
          includeStateChange: true,
        }
      )
    );
    logger.info('Registered audit logs hook');
  }

  // Anomaly detections hook
  if (config?.anomaly !== false) {
    siemService.addHook(
      createAnomalyHook(
        config?.anomaly ?? {
          minConfidence: 70,
          includeIndicators: true,
        }
      )
    );
    logger.info('Registered anomaly detections hook');
  }
}

/**
 * Forward a security alert to SIEM
 */
export async function forwardSecurityAlert(
  siemService: SIEMService,
  alert: SecurityAlert
): Promise<void> {
  const event = securityAlertToEvent(alert);
  await siemService.send(event);
}

/**
 * Forward an audit record to SIEM
 */
export async function forwardAuditRecord(
  siemService: SIEMService,
  record: AuditRecord
): Promise<void> {
  const event = auditRecordToEvent(record);
  await siemService.send(event);
}

/**
 * Forward an anomaly to SIEM
 */
export async function forwardAnomaly(
  siemService: SIEMService,
  anomaly: Anomaly
): Promise<void> {
  const event = anomalyToEvent(anomaly);
  await siemService.send(event);
}

// =============================================================================
// Mapping Functions
// =============================================================================

/**
 * Map alert type to event category
 */
function mapAlertCategory(alertType: string): EventCategory {
  if (
    alertType.includes('brute_force') ||
    alertType.includes('credential') ||
    alertType.includes('login') ||
    alertType.includes('session') ||
    alertType.includes('mfa')
  ) {
    return 'authentication';
  }

  if (
    alertType.includes('privilege') ||
    alertType.includes('unauthorized') ||
    alertType.includes('permission')
  ) {
    return 'authorization';
  }

  if (
    alertType.includes('api_key') ||
    alertType.includes('rate_limit') ||
    alertType.includes('token')
  ) {
    return 'application';
  }

  if (alertType.includes('data') || alertType.includes('exfiltration')) {
    return 'data';
  }

  if (
    alertType.includes('injection') ||
    alertType.includes('xss') ||
    alertType.includes('vulnerability')
  ) {
    return 'malware';
  }

  if (alertType.includes('policy')) {
    return 'policy';
  }

  if (alertType.includes('unusual') || alertType.includes('impossible')) {
    return 'anomaly';
  }

  return 'system';
}

/**
 * Map alert severity to event severity
 */
function mapAlertSeverity(severity: string): EventSeverity {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 10;
    case 'high':
      return 7;
    case 'medium':
      return 4;
    case 'low':
      return 1;
    case 'info':
    default:
      return 0;
  }
}

/**
 * Map audit category to event category
 */
function mapAuditCategory(category: string): EventCategory {
  switch (category.toLowerCase()) {
    case 'authentication':
      return 'authentication';
    case 'authorization':
      return 'authorization';
    case 'data':
      return 'data';
    case 'policy':
      return 'policy';
    case 'system':
      return 'system';
    case 'admin':
      return 'application';
    default:
      return 'audit';
  }
}

/**
 * Map audit severity to event severity
 */
function mapAuditSeverity(severity: string): EventSeverity {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 10;
    case 'error':
      return 7;
    case 'warning':
      return 4;
    case 'info':
    default:
      return 1;
  }
}

/**
 * Map audit outcome to event outcome
 */
function mapAuditOutcome(outcome: string): EventOutcome {
  switch (outcome.toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'partial':
    default:
      return 'unknown';
  }
}

/**
 * Map anomaly severity to event severity
 */
function mapAnomalySeverity(severity: string): EventSeverity {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 10;
    case 'high':
      return 7;
    case 'medium':
      return 4;
    case 'low':
    default:
      return 1;
  }
}

/**
 * Get severity name from numeric value
 */
function getSeverityName(severity: number): string {
  switch (severity) {
    case 10:
      return 'critical';
    case 7:
      return 'high';
    case 4:
      return 'medium';
    case 1:
      return 'low';
    case 0:
    default:
      return 'info';
  }
}
