/**
 * SIEM Integration Types
 *
 * TypeScript interfaces and Zod schemas for SIEM integration.
 * Supports Loki (primary, free/self-hosted), Splunk, and Elastic.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// SIEM PROVIDER TYPES
// =============================================================================

export const SIEM_PROVIDERS = ['loki', 'splunk', 'elastic'] as const;
export type SIEMProvider = (typeof SIEM_PROVIDERS)[number];

// =============================================================================
// AUTHENTICATION TYPES
// =============================================================================

export const AUTH_TYPES = ['none', 'basic', 'bearer', 'api-key'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

// =============================================================================
// SIEM CONFIGURATION SCHEMA
// =============================================================================

export const SIEMAuthenticationSchema = z.object({
  type: z.enum(AUTH_TYPES).default('none'),
  username: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  apiKey: z.string().optional(),
}).refine(
  (auth) => {
    if (auth.type === 'basic' && (!auth.username || !auth.password)) {
      return false;
    }
    if (auth.type === 'bearer' && !auth.token) {
      return false;
    }
    if (auth.type === 'api-key' && !auth.apiKey) {
      return false;
    }
    return true;
  },
  {
    message: 'Authentication credentials required for selected auth type',
  }
);

export type SIEMAuthentication = z.infer<typeof SIEMAuthenticationSchema>;

export const SIEMConfigSchema = z.object({
  /** Whether SIEM integration is enabled */
  enabled: z.boolean().default(false),
  /** SIEM provider type */
  provider: z.enum(SIEM_PROVIDERS).default('loki'),
  /** SIEM endpoint URL */
  endpoint: z.string().url(),
  /** Authentication configuration */
  authentication: SIEMAuthenticationSchema.default({ type: 'none' }),
  /** Number of events to batch before sending (default: 100) */
  batchSize: z.number().int().min(1).max(10000).default(100),
  /** Flush interval in milliseconds (default: 5000) */
  flushIntervalMs: z.number().int().min(100).max(60000).default(5000),
  /** Number of retry attempts on failure (default: 3) */
  retryAttempts: z.number().int().min(0).max(10).default(3),
  /** Retry delay in milliseconds (default: 1000) */
  retryDelayMs: z.number().int().min(100).max(30000).default(1000),
  /** Filter which event types to send (empty = all events) */
  eventTypes: z.array(z.string()).default([]),
  /** Application label for log categorization */
  appLabel: z.string().default('vorion'),
  /** Environment label (development, staging, production) */
  environmentLabel: z.string().default('development'),
  /** HTTP request timeout in milliseconds */
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  /** Maximum queue size before dropping events */
  maxQueueSize: z.number().int().min(100).max(100000).default(10000),
  /** Enable gzip compression for payloads */
  compression: z.boolean().default(true),
});

export type SIEMConfig = z.infer<typeof SIEMConfigSchema>;

// =============================================================================
// AUDIT EVENT CATEGORIES
// =============================================================================

export const SIEM_EVENT_CATEGORIES = [
  'authentication',
  'authorization',
  'data-access',
  'configuration',
  'system',
  'security',
  'compliance',
  'network',
] as const;

export type SIEMEventCategory = (typeof SIEM_EVENT_CATEGORIES)[number];

// =============================================================================
// AUDIT EVENT SEVERITIES
// =============================================================================

export const SIEM_EVENT_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type SIEMEventSeverity = (typeof SIEM_EVENT_SEVERITIES)[number];

// =============================================================================
// AUDIT EVENT OUTCOMES
// =============================================================================

export const SIEM_EVENT_OUTCOMES = ['success', 'failure', 'unknown'] as const;
export type SIEMEventOutcome = (typeof SIEM_EVENT_OUTCOMES)[number];

// =============================================================================
// AUDIT EVENT TYPES (30+ event types)
// =============================================================================

export const SIEM_EVENT_TYPES = [
  // Authentication events (8)
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'SESSION_CREATED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'TOKEN_ISSUED',
  'TOKEN_REVOKED',

  // MFA events (4)
  'MFA_CHALLENGE',
  'MFA_SUCCESS',
  'MFA_FAILURE',
  'MFA_BYPASS_ATTEMPTED',

  // Password events (3)
  'PASSWORD_CHANGE',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',

  // Authorization events (4)
  'PERMISSION_GRANTED',
  'PERMISSION_DENIED',
  'PERMISSION_REVOKED',
  'ROLE_CHANGED',

  // Resource lifecycle events (5)
  'RESOURCE_CREATE',
  'RESOURCE_READ',
  'RESOURCE_UPDATE',
  'RESOURCE_DELETE',
  'RESOURCE_EXPORT',

  // Configuration events (4)
  'CONFIG_CHANGE',
  'KEY_ROTATION',
  'SECRET_ACCESSED',
  'POLICY_UPDATE',

  // Security events (6)
  'RATE_LIMIT_EXCEEDED',
  'INJECTION_ATTEMPT',
  'ANOMALY_DETECTED',
  'BRUTE_FORCE_DETECTED',
  'IP_BLOCKED',
  'SUSPICIOUS_ACTIVITY',

  // System events (4)
  'SYSTEM_STARTUP',
  'SYSTEM_SHUTDOWN',
  'HEALTH_CHECK_FAILED',
  'SERVICE_DEGRADED',

  // Compliance events (3)
  'DATA_RETENTION_CLEANUP',
  'GDPR_REQUEST_RECEIVED',
  'AUDIT_LOG_EXPORTED',

  // Trust/Governance events (3)
  'TRUST_LEVEL_CHANGED',
  'ESCALATION_TRIGGERED',
  'INTENT_EVALUATED',
] as const;

export type SIEMAuditEventType = (typeof SIEM_EVENT_TYPES)[number];

// =============================================================================
// AUDIT EVENT ACTOR
// =============================================================================

export const AuditEventActorSchema = z.object({
  /** User ID if authenticated */
  userId: z.string().optional(),
  /** Tenant ID for multi-tenant systems */
  tenantId: z.string().optional(),
  /** Client IP address */
  ipAddress: z.string(),
  /** User agent string */
  userAgent: z.string().optional(),
  /** Session ID if applicable */
  sessionId: z.string().optional(),
  /** Agent/service name if not a user */
  agentId: z.string().optional(),
  /** Actor type: user, agent, service, system */
  actorType: z.enum(['user', 'agent', 'service', 'system']).default('user'),
});

export type AuditEventActor = z.infer<typeof AuditEventActorSchema>;

// =============================================================================
// AUDIT EVENT RESOURCE
// =============================================================================

export const AuditEventResourceSchema = z.object({
  /** Resource type (e.g., 'user', 'intent', 'policy') */
  type: z.string(),
  /** Resource identifier */
  id: z.string(),
  /** Human-readable resource name */
  name: z.string().optional(),
  /** Parent resource ID if hierarchical */
  parentId: z.string().optional(),
  /** Additional resource attributes */
  attributes: z.record(z.unknown()).optional(),
});

export type AuditEventResource = z.infer<typeof AuditEventResourceSchema>;

// =============================================================================
// AUDIT EVENT METADATA
// =============================================================================

export const AuditEventMetadataSchema = z.object({
  /** Unique request identifier */
  requestId: z.string(),
  /** Distributed trace ID (W3C TraceContext) */
  traceId: z.string().optional(),
  /** Span ID for trace correlation */
  spanId: z.string().optional(),
  /** Correlation ID for multi-step operations */
  correlationId: z.string().optional(),
  /** Source service/component name */
  source: z.string().optional(),
  /** Additional tags for filtering */
  tags: z.array(z.string()).optional(),
});

export type AuditEventMetadata = z.infer<typeof AuditEventMetadataSchema>;

// =============================================================================
// MAIN AUDIT EVENT SCHEMA
// =============================================================================

export const AuditEventSchema = z.object({
  /** Unique event identifier */
  id: z.string().uuid(),
  /** Event timestamp */
  timestamp: z.date(),
  /** Event type */
  type: z.string(),
  /** Event category */
  category: z.enum(SIEM_EVENT_CATEGORIES),
  /** Event severity */
  severity: z.enum(SIEM_EVENT_SEVERITIES),
  /** Actor information */
  actor: AuditEventActorSchema,
  /** Resource information */
  resource: AuditEventResourceSchema,
  /** Action performed */
  action: z.string(),
  /** Outcome of the action */
  outcome: z.enum(SIEM_EVENT_OUTCOMES),
  /** Additional event details */
  details: z.record(z.unknown()).default({}),
  /** Event metadata for correlation */
  metadata: AuditEventMetadataSchema,
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

// =============================================================================
// SIEM CONNECTOR INTERFACE
// =============================================================================

/**
 * Interface for SIEM provider connectors
 */
export interface ISIEMConnector {
  /** Provider name */
  readonly provider: SIEMProvider;

  /** Check if the connector is healthy */
  healthCheck(): Promise<boolean>;

  /** Send a single event */
  sendEvent(event: AuditEvent): Promise<void>;

  /** Send a batch of events */
  sendBatch(events: AuditEvent[]): Promise<void>;

  /** Flush any buffered events */
  flush(): Promise<void>;

  /** Gracefully shutdown the connector */
  shutdown(): Promise<void>;

  /** Get connector statistics */
  getStats(): SIEMConnectorStats;
}

// =============================================================================
// CONNECTOR STATISTICS
// =============================================================================

export interface SIEMConnectorStats {
  /** Total events sent successfully */
  eventsSent: number;
  /** Total events failed to send */
  eventsFailed: number;
  /** Total batches sent */
  batchesSent: number;
  /** Current queue size */
  queueSize: number;
  /** Last successful send timestamp */
  lastSuccessAt?: Date;
  /** Last error timestamp */
  lastErrorAt?: Date;
  /** Last error message */
  lastError?: string;
  /** Average batch latency in ms */
  avgLatencyMs: number;
  /** Events dropped due to queue overflow */
  eventsDropped: number;
  /** Total retry attempts */
  retryAttempts: number;
}

// =============================================================================
// LOKI-SPECIFIC TYPES
// =============================================================================

/**
 * Loki push API request format
 * See: https://grafana.com/docs/loki/latest/api/#push-log-entries-to-loki
 */
export interface LokiPushRequest {
  streams: LokiStream[];
}

export interface LokiStream {
  stream: Record<string, string>;
  values: LokiLogEntry[];
}

/** [timestamp_ns, log_line] */
export type LokiLogEntry = [string, string];

// =============================================================================
// SPLUNK-SPECIFIC TYPES
// =============================================================================

/**
 * Splunk HEC (HTTP Event Collector) event format
 * See: https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector
 */
export interface SplunkHECEvent {
  /** Event timestamp (epoch seconds or milliseconds) */
  time?: number;
  /** Event host */
  host?: string;
  /** Event source */
  source?: string;
  /** Event sourcetype */
  sourcetype?: string;
  /** Index to store the event */
  index?: string;
  /** Event data */
  event: Record<string, unknown>;
  /** Additional fields */
  fields?: Record<string, unknown>;
}

// =============================================================================
// ELASTIC-SPECIFIC TYPES
// =============================================================================

/**
 * Elasticsearch bulk API action
 */
export interface ElasticBulkAction {
  index: {
    _index: string;
    _id?: string;
  };
}

/**
 * Elasticsearch document format for audit events
 */
export interface ElasticAuditDocument {
  '@timestamp': string;
  event: {
    id: string;
    type: string;
    category: string;
    severity: string;
    outcome: string;
    action: string;
  };
  user?: {
    id?: string;
    name?: string;
  };
  source: {
    ip: string;
    user_agent?: string;
  };
  resource: {
    type: string;
    id: string;
    name?: string;
  };
  metadata: Record<string, unknown>;
  details: Record<string, unknown>;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class SIEMConnectionError extends Error {
  constructor(
    message: string,
    public readonly provider: SIEMProvider,
    public readonly endpoint: string,
    public readonly statusCode?: number,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'SIEMConnectionError';
  }
}

export class SIEMConfigurationError extends Error {
  constructor(
    message: string,
    public readonly provider: SIEMProvider,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'SIEMConfigurationError';
  }
}

export class SIEMBatchError extends Error {
  constructor(
    message: string,
    public readonly provider: SIEMProvider,
    public readonly failedCount: number,
    public readonly totalCount: number,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'SIEMBatchError';
  }
}
