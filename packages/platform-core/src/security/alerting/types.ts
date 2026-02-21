/**
 * Security Alerting System - Type Definitions
 *
 * Comprehensive type definitions for security alerting including:
 * - Alert severity and channel enums
 * - Security alert structures
 * - Alert rules and conditions
 * - Configuration interfaces
 *
 * @packageDocumentation
 * @module security/alerting/types
 */

import { z } from 'zod';

// =============================================================================
// Enums
// =============================================================================

/**
 * Alert severity levels
 */
export const AlertSeverity = {
  CRITICAL: 'critical', // Immediate response required - active breach
  HIGH: 'high',         // Urgent response - high-risk security event
  MEDIUM: 'medium',     // Timely response - security concern
  LOW: 'low',           // Informational - worth noting
  INFO: 'info',         // Debug/audit information
} as const;

export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const alertSeveritySchema = z.nativeEnum(AlertSeverity);

/**
 * Alert delivery channels
 */
export const AlertChannel = {
  SLACK: 'slack',           // Slack webhook integration
  PAGERDUTY: 'pagerduty',   // PagerDuty events API
  EMAIL: 'email',           // Email notification
  WEBHOOK: 'webhook',       // Generic webhook
  SNS: 'sns',               // AWS SNS for scalable delivery
} as const;

export type AlertChannel = (typeof AlertChannel)[keyof typeof AlertChannel];

export const alertChannelSchema = z.nativeEnum(AlertChannel);

/**
 * Types of security events that can trigger alerts
 */
export const SecurityEventType = {
  // Authentication events
  BRUTE_FORCE: 'brute_force',
  CREDENTIAL_STUFFING: 'credential_stuffing',
  ACCOUNT_LOCKOUT: 'account_lockout',
  SUSPICIOUS_LOGIN: 'suspicious_login',
  SESSION_HIJACK: 'session_hijack',
  MFA_BYPASS_ATTEMPT: 'mfa_bypass_attempt',

  // Authorization events
  PRIVILEGE_ESCALATION: 'privilege_escalation',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  PERMISSION_DENIED_SPIKE: 'permission_denied_spike',

  // API security events
  API_KEY_ABUSE: 'api_key_abuse',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_REVOKED: 'token_revoked',

  // Anomaly events
  UNUSUAL_ACCESS_PATTERN: 'unusual_access_pattern',
  IMPOSSIBLE_TRAVEL: 'impossible_travel',
  NEW_DEVICE_LOGIN: 'new_device_login',
  UNUSUAL_TIME_ACCESS: 'unusual_time_access',

  // Configuration events
  SECURITY_CONFIG_CHANGE: 'security_config_change',
  ADMIN_ACTION: 'admin_action',
  KEY_ROTATION: 'key_rotation',
  POLICY_VIOLATION: 'policy_violation',

  // Data security events
  DATA_EXFILTRATION: 'data_exfiltration',
  INJECTION_ATTEMPT: 'injection_attempt',
  XSS_ATTEMPT: 'xss_attempt',

  // System events
  CERTIFICATE_EXPIRY: 'certificate_expiry',
  SECRET_EXPOSED: 'secret_exposed',
  VULNERABILITY_DETECTED: 'vulnerability_detected',

  // Incident events
  INCIDENT_CREATED: 'incident_created',
  INCIDENT_ESCALATED: 'incident_escalated',

  // Custom event type
  CUSTOM: 'custom',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

export const securityEventTypeSchema = z.nativeEnum(SecurityEventType);

// =============================================================================
// Security Alert Interface
// =============================================================================

/**
 * Context information for a security alert
 */
export interface AlertContext {
  /** User ID if associated with a user */
  userId?: string;
  /** Tenant ID for multi-tenant systems */
  tenantId?: string;
  /** IP address of the request */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
  /** Geographic location */
  location?: {
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  /** Affected resource/endpoint */
  resource?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** Additional custom fields */
  metadata?: Record<string, unknown>;
}

export const alertContextSchema = z.object({
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  location: z.object({
    country: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }).optional(),
  resource: z.string().optional(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * A security alert
 */
export interface SecurityAlert {
  /** Unique alert ID */
  id: string;
  /** Alert severity */
  severity: AlertSeverity;
  /** Type of security event */
  type: SecurityEventType;
  /** Human-readable alert message */
  message: string;
  /** Alert title for display */
  title: string;
  /** Detailed context information */
  context: AlertContext;
  /** When the alert was created */
  timestamp: Date;
  /** Fingerprint for deduplication */
  fingerprint: string;
  /** Source system/component */
  source: string;
  /** Suggested remediation actions */
  suggestedActions?: string[];
  /** Related alert IDs */
  relatedAlerts?: string[];
  /** Whether alert has been acknowledged */
  acknowledged: boolean;
  /** Who acknowledged the alert */
  acknowledgedBy?: string;
  /** When the alert was acknowledged */
  acknowledgedAt?: Date;
  /** Whether alert has been resolved */
  resolved: boolean;
  /** Resolution notes */
  resolutionNotes?: string;
  /** Tags for categorization */
  tags?: string[];
}

export const securityAlertSchema = z.object({
  id: z.string().uuid(),
  severity: alertSeveritySchema,
  type: securityEventTypeSchema,
  message: z.string().min(1),
  title: z.string().min(1).max(255),
  context: alertContextSchema,
  timestamp: z.coerce.date(),
  fingerprint: z.string().min(1),
  source: z.string().min(1),
  suggestedActions: z.array(z.string()).optional(),
  relatedAlerts: z.array(z.string().uuid()).optional(),
  acknowledged: z.boolean().default(false),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: z.coerce.date().optional(),
  resolved: z.boolean().default(false),
  resolutionNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Input for creating a security alert
 */
export interface CreateAlertInput {
  severity: AlertSeverity;
  type: SecurityEventType;
  message: string;
  title: string;
  context: AlertContext;
  source: string;
  suggestedActions?: string[];
  tags?: string[];
}

export const createAlertInputSchema = z.object({
  severity: alertSeveritySchema,
  type: securityEventTypeSchema,
  message: z.string().min(1),
  title: z.string().min(1).max(255),
  context: alertContextSchema,
  source: z.string().min(1),
  suggestedActions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

// =============================================================================
// Alert Rule Interface
// =============================================================================

/**
 * Condition operators for alert rules
 */
export const ConditionOperator = {
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  GREATER_THAN: 'greater_than',
  LESS_THAN: 'less_than',
  GREATER_THAN_OR_EQUALS: 'greater_than_or_equals',
  LESS_THAN_OR_EQUALS: 'less_than_or_equals',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  MATCHES: 'matches',           // Regex match
  IN: 'in',                     // Value in array
  NOT_IN: 'not_in',
} as const;

export type ConditionOperator = (typeof ConditionOperator)[keyof typeof ConditionOperator];

export const conditionOperatorSchema = z.nativeEnum(ConditionOperator);

/**
 * A single condition in an alert rule
 */
export interface AlertCondition {
  /** Field to evaluate */
  field: string;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Value to compare against */
  value: unknown;
}

export const alertConditionSchema = z.object({
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.unknown(),
});

/**
 * Threshold configuration for rate-based alerts
 */
export interface AlertThreshold {
  /** Number of events to trigger */
  count: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Field to group by (e.g., 'userId', 'ipAddress') */
  groupBy?: string;
}

export const alertThresholdSchema = z.object({
  count: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
  groupBy: z.string().optional(),
});

/**
 * Channel-specific configuration
 */
export interface ChannelConfig {
  /** Channel type */
  channel: AlertChannel;
  /** Channel-specific settings */
  config: Record<string, unknown>;
  /** Only send alerts of these severities */
  severityFilter?: AlertSeverity[];
  /** Only send alerts during these hours (0-23) */
  activeHours?: { start: number; end: number };
  /** Rate limit for this channel (alerts per minute) */
  rateLimit?: number;
}

export const channelConfigSchema = z.object({
  channel: alertChannelSchema,
  config: z.record(z.unknown()),
  severityFilter: z.array(alertSeveritySchema).optional(),
  activeHours: z.object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(0).max(23),
  }).optional(),
  rateLimit: z.number().int().positive().optional(),
});

/**
 * An alert rule definition
 */
export interface AlertRule {
  /** Unique rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Event types this rule applies to */
  eventTypes: SecurityEventType[];
  /** Conditions that must be met */
  conditions?: AlertCondition[];
  /** Threshold for rate-based rules */
  threshold?: AlertThreshold;
  /** Channels to send alerts to */
  channels: ChannelConfig[];
  /** Cooldown period in seconds (prevent duplicate alerts) */
  cooldownSeconds: number;
  /** Alert severity to assign */
  severity: AlertSeverity;
  /** Tags to add to alerts */
  tags?: string[];
  /** Priority for rule evaluation (higher = first) */
  priority: number;
  /** Whether to stop processing other rules on match */
  stopOnMatch: boolean;
  /** Custom message template */
  messageTemplate?: string;
  /** Custom title template */
  titleTemplate?: string;
}

export const alertRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  eventTypes: z.array(securityEventTypeSchema).min(1),
  conditions: z.array(alertConditionSchema).optional(),
  threshold: alertThresholdSchema.optional(),
  channels: z.array(channelConfigSchema).min(1),
  cooldownSeconds: z.number().int().nonnegative().default(300),
  severity: alertSeveritySchema,
  tags: z.array(z.string()).optional(),
  priority: z.number().int().default(0),
  stopOnMatch: z.boolean().default(false),
  messageTemplate: z.string().optional(),
  titleTemplate: z.string().optional(),
});

// =============================================================================
// Alert Configuration Interface
// =============================================================================

/**
 * Maintenance window configuration
 */
export interface MaintenanceWindow {
  /** Unique window ID */
  id: string;
  /** Window name */
  name: string;
  /** Start time (ISO 8601) */
  startTime: Date;
  /** End time (ISO 8601) */
  endTime: Date;
  /** Event types to suppress */
  suppressedEventTypes?: SecurityEventType[];
  /** Severities to suppress */
  suppressedSeverities?: AlertSeverity[];
  /** Whether to suppress all alerts */
  suppressAll: boolean;
  /** Reason for maintenance */
  reason?: string;
  /** Who created the window */
  createdBy: string;
}

export const maintenanceWindowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  suppressedEventTypes: z.array(securityEventTypeSchema).optional(),
  suppressedSeverities: z.array(alertSeveritySchema).optional(),
  suppressAll: z.boolean().default(false),
  reason: z.string().optional(),
  createdBy: z.string().min(1),
});

/**
 * Escalation policy configuration
 */
export interface EscalationPolicy {
  /** Policy ID */
  id: string;
  /** Policy name */
  name: string;
  /** Severities this policy applies to */
  severities: AlertSeverity[];
  /** Escalation levels */
  levels: Array<{
    /** Minutes after alert to escalate */
    afterMinutes: number;
    /** Channels to notify at this level */
    channels: ChannelConfig[];
    /** Message to include */
    message?: string;
  }>;
  /** Whether to escalate if not acknowledged */
  escalateOnNoAcknowledge: boolean;
  /** Whether to escalate if not resolved */
  escalateOnNoResolve: boolean;
}

export const escalationPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  severities: z.array(alertSeveritySchema).min(1),
  levels: z.array(z.object({
    afterMinutes: z.number().int().positive(),
    channels: z.array(channelConfigSchema).min(1),
    message: z.string().optional(),
  })).min(1),
  escalateOnNoAcknowledge: z.boolean().default(true),
  escalateOnNoResolve: z.boolean().default(true),
});

/**
 * Complete alerting system configuration
 */
export interface AlertConfig {
  /** Whether alerting is enabled */
  enabled: boolean;
  /** Alert rules */
  rules: AlertRule[];
  /** Default channels for alerts without specific rules */
  defaultChannels: ChannelConfig[];
  /** Escalation policies */
  escalationPolicies: EscalationPolicy[];
  /** Active maintenance windows */
  maintenanceWindows: MaintenanceWindow[];
  /** Deduplication window in seconds */
  deduplicationWindowSeconds: number;
  /** Redis key prefix for state storage */
  redisKeyPrefix: string;
  /** Default cooldown for rules without explicit cooldown */
  defaultCooldownSeconds: number;
  /** Channel-specific configurations */
  channelSettings: {
    slack?: {
      webhookUrl: string;
      defaultChannel?: string;
      username?: string;
      iconEmoji?: string;
    };
    pagerduty?: {
      routingKey: string;
      apiUrl?: string;
    };
    email?: {
      from: string;
      host: string;
      port: number;
      secure: boolean;
      auth?: {
        user: string;
        pass: string;
      };
      defaultRecipients?: string[];
    };
    webhook?: {
      defaultUrl?: string;
      headers?: Record<string, string>;
      timeout?: number;
    };
    sns?: {
      region: string;
      topicArn?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    };
  };
}

export const alertConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(alertRuleSchema).default([]),
  defaultChannels: z.array(channelConfigSchema).default([]),
  escalationPolicies: z.array(escalationPolicySchema).default([]),
  maintenanceWindows: z.array(maintenanceWindowSchema).default([]),
  deduplicationWindowSeconds: z.number().int().positive().default(300),
  redisKeyPrefix: z.string().default('vorion:alerting:'),
  defaultCooldownSeconds: z.number().int().nonnegative().default(300),
  channelSettings: z.object({
    slack: z.object({
      webhookUrl: z.string().url(),
      defaultChannel: z.string().optional(),
      username: z.string().optional(),
      iconEmoji: z.string().optional(),
    }).optional(),
    pagerduty: z.object({
      routingKey: z.string().min(1),
      apiUrl: z.string().url().optional(),
    }).optional(),
    email: z.object({
      from: z.string().email(),
      host: z.string().min(1),
      port: z.number().int().positive(),
      secure: z.boolean(),
      auth: z.object({
        user: z.string().min(1),
        pass: z.string().min(1),
      }).optional(),
      defaultRecipients: z.array(z.string().email()).optional(),
    }).optional(),
    webhook: z.object({
      defaultUrl: z.string().url().optional(),
      headers: z.record(z.string()).optional(),
      timeout: z.number().int().positive().optional(),
    }).optional(),
    sns: z.object({
      region: z.string().min(1),
      topicArn: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
    }).optional(),
  }).default({}),
});

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default alerting configuration
 */
export const DEFAULT_ALERT_CONFIG: Partial<AlertConfig> = {
  enabled: true,
  rules: [],
  defaultChannels: [],
  escalationPolicies: [],
  maintenanceWindows: [],
  deduplicationWindowSeconds: 300,
  redisKeyPrefix: 'vorion:alerting:',
  defaultCooldownSeconds: 300,
  channelSettings: {},
};

// =============================================================================
// Event Types for Alert Service
// =============================================================================

/**
 * Alert lifecycle events
 */
export interface AlertEvent {
  type: 'created' | 'sent' | 'acknowledged' | 'resolved' | 'escalated' | 'suppressed' | 'deduplicated';
  alert: SecurityAlert;
  timestamp: Date;
  channel?: AlertChannel;
  metadata?: Record<string, unknown>;
}

export type AlertEventCallback = (event: AlertEvent) => void | Promise<void>;

/**
 * Alert delivery result
 */
export interface AlertDeliveryResult {
  channel: AlertChannel;
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
  retryCount: number;
}

export const alertDeliveryResultSchema = z.object({
  channel: alertChannelSchema,
  success: z.boolean(),
  messageId: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.coerce.date(),
  retryCount: z.number().int().nonnegative(),
});
