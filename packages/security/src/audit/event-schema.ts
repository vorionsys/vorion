/**
 * Audit Event Schema
 *
 * Comprehensive audit event schema with 30+ event types for SIEM integration.
 * Defines event types, categories, and metadata for security monitoring.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// EVENT TYPE DEFINITIONS
// =============================================================================

/**
 * Audit event type definitions with metadata.
 * Each event type includes category and default severity.
 */
export const AUDIT_EVENT_DEFINITIONS = {
  // =========================================================================
  // AUTHENTICATION EVENTS (8 types)
  // =========================================================================
  USER_LOGIN: {
    category: 'authentication',
    severity: 'info',
    description: 'User successfully authenticated',
  },
  USER_LOGOUT: {
    category: 'authentication',
    severity: 'info',
    description: 'User logged out',
  },
  USER_LOGIN_FAILED: {
    category: 'authentication',
    severity: 'warning',
    description: 'Authentication attempt failed',
  },
  SESSION_CREATED: {
    category: 'authentication',
    severity: 'info',
    description: 'New session established',
  },
  SESSION_EXPIRED: {
    category: 'authentication',
    severity: 'info',
    description: 'Session expired naturally',
  },
  SESSION_REVOKED: {
    category: 'authentication',
    severity: 'warning',
    description: 'Session forcibly terminated',
  },
  TOKEN_ISSUED: {
    category: 'authentication',
    severity: 'info',
    description: 'Access/refresh token issued',
  },
  TOKEN_REVOKED: {
    category: 'authentication',
    severity: 'warning',
    description: 'Token manually revoked',
  },

  // =========================================================================
  // MFA EVENTS (4 types)
  // =========================================================================
  MFA_CHALLENGE: {
    category: 'authentication',
    severity: 'info',
    description: 'MFA challenge initiated',
  },
  MFA_SUCCESS: {
    category: 'authentication',
    severity: 'info',
    description: 'MFA verification successful',
  },
  MFA_FAILURE: {
    category: 'authentication',
    severity: 'warning',
    description: 'MFA verification failed',
  },
  MFA_BYPASS_ATTEMPTED: {
    category: 'security',
    severity: 'critical',
    description: 'Attempt to bypass MFA detected',
  },

  // =========================================================================
  // PASSWORD EVENTS (3 types)
  // =========================================================================
  PASSWORD_CHANGE: {
    category: 'authentication',
    severity: 'info',
    description: 'User changed their password',
  },
  PASSWORD_RESET_REQUESTED: {
    category: 'authentication',
    severity: 'info',
    description: 'Password reset requested',
  },
  PASSWORD_RESET_COMPLETED: {
    category: 'authentication',
    severity: 'info',
    description: 'Password reset completed',
  },

  // =========================================================================
  // AUTHORIZATION EVENTS (4 types)
  // =========================================================================
  PERMISSION_GRANTED: {
    category: 'authorization',
    severity: 'info',
    description: 'Permission or access granted',
  },
  PERMISSION_DENIED: {
    category: 'authorization',
    severity: 'warning',
    description: 'Permission or access denied',
  },
  PERMISSION_REVOKED: {
    category: 'authorization',
    severity: 'warning',
    description: 'Previously granted permission revoked',
  },
  ROLE_CHANGED: {
    category: 'authorization',
    severity: 'warning',
    description: 'User role assignment changed',
  },

  // =========================================================================
  // RESOURCE LIFECYCLE EVENTS (5 types)
  // =========================================================================
  RESOURCE_CREATE: {
    category: 'data-access',
    severity: 'info',
    description: 'Resource created',
  },
  RESOURCE_READ: {
    category: 'data-access',
    severity: 'info',
    description: 'Resource accessed/read',
  },
  RESOURCE_UPDATE: {
    category: 'data-access',
    severity: 'info',
    description: 'Resource modified',
  },
  RESOURCE_DELETE: {
    category: 'data-access',
    severity: 'warning',
    description: 'Resource deleted',
  },
  RESOURCE_EXPORT: {
    category: 'data-access',
    severity: 'warning',
    description: 'Resource data exported',
  },

  // =========================================================================
  // CONFIGURATION EVENTS (4 types)
  // =========================================================================
  CONFIG_CHANGE: {
    category: 'configuration',
    severity: 'warning',
    description: 'System configuration changed',
  },
  KEY_ROTATION: {
    category: 'configuration',
    severity: 'info',
    description: 'Encryption key rotated',
  },
  SECRET_ACCESSED: {
    category: 'configuration',
    severity: 'warning',
    description: 'Secret or sensitive config accessed',
  },
  POLICY_UPDATE: {
    category: 'configuration',
    severity: 'warning',
    description: 'Security or governance policy updated',
  },

  // =========================================================================
  // SECURITY EVENTS (6 types)
  // =========================================================================
  RATE_LIMIT_EXCEEDED: {
    category: 'security',
    severity: 'warning',
    description: 'Rate limit threshold exceeded',
  },
  INJECTION_ATTEMPT: {
    category: 'security',
    severity: 'critical',
    description: 'Potential injection attack detected',
  },
  ANOMALY_DETECTED: {
    category: 'security',
    severity: 'warning',
    description: 'Anomalous behavior detected',
  },
  BRUTE_FORCE_DETECTED: {
    category: 'security',
    severity: 'critical',
    description: 'Brute force attack pattern detected',
  },
  IP_BLOCKED: {
    category: 'security',
    severity: 'warning',
    description: 'IP address blocked',
  },
  SUSPICIOUS_ACTIVITY: {
    category: 'security',
    severity: 'warning',
    description: 'Suspicious activity flagged for review',
  },

  // =========================================================================
  // SYSTEM EVENTS (4 types)
  // =========================================================================
  SYSTEM_STARTUP: {
    category: 'system',
    severity: 'info',
    description: 'System or service started',
  },
  SYSTEM_SHUTDOWN: {
    category: 'system',
    severity: 'info',
    description: 'System or service shutdown',
  },
  HEALTH_CHECK_FAILED: {
    category: 'system',
    severity: 'error',
    description: 'Health check returned unhealthy',
  },
  SERVICE_DEGRADED: {
    category: 'system',
    severity: 'warning',
    description: 'Service operating in degraded mode',
  },

  // =========================================================================
  // COMPLIANCE EVENTS (3 types)
  // =========================================================================
  DATA_RETENTION_CLEANUP: {
    category: 'compliance',
    severity: 'info',
    description: 'Data retention cleanup executed',
  },
  GDPR_REQUEST_RECEIVED: {
    category: 'compliance',
    severity: 'info',
    description: 'GDPR data request received',
  },
  AUDIT_LOG_EXPORTED: {
    category: 'compliance',
    severity: 'info',
    description: 'Audit log exported for compliance',
  },

  // =========================================================================
  // TRUST/GOVERNANCE EVENTS (3 types)
  // =========================================================================
  TRUST_LEVEL_CHANGED: {
    category: 'authorization',
    severity: 'warning',
    description: 'Entity trust level changed',
  },
  ESCALATION_TRIGGERED: {
    category: 'authorization',
    severity: 'warning',
    description: 'Escalation workflow triggered',
  },
  INTENT_EVALUATED: {
    category: 'authorization',
    severity: 'info',
    description: 'Intent governance evaluation completed',
  },
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENT_DEFINITIONS;

// =============================================================================
// EVENT CATEGORIES
// =============================================================================

export const EVENT_CATEGORIES = [
  'authentication',
  'authorization',
  'data-access',
  'configuration',
  'system',
  'security',
  'compliance',
  'network',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// =============================================================================
// EVENT SEVERITIES
// =============================================================================

export const EVENT_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

// =============================================================================
// EVENT OUTCOMES
// =============================================================================

export const EVENT_OUTCOMES = ['success', 'failure', 'unknown'] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/**
 * Actor schema - who performed the action
 */
export const ActorSchema = z.object({
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
  /** Agent/service ID if not a user */
  agentId: z.string().optional(),
  /** Actor type */
  actorType: z.enum(['user', 'agent', 'service', 'system']).default('user'),
});

export type Actor = z.infer<typeof ActorSchema>;

/**
 * Resource schema - what was acted upon
 */
export const ResourceSchema = z.object({
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

export type Resource = z.infer<typeof ResourceSchema>;

/**
 * Metadata schema - correlation and tracing information
 */
export const MetadataSchema = z.object({
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

export type Metadata = z.infer<typeof MetadataSchema>;

/**
 * Full audit event schema
 */
export const AuditEventSchemaFull = z.object({
  /** Unique event identifier (UUID) */
  id: z.string().uuid(),
  /** Event timestamp */
  timestamp: z.date(),
  /** Event type from AUDIT_EVENT_DEFINITIONS */
  type: z.string(),
  /** Event category */
  category: z.enum(EVENT_CATEGORIES),
  /** Event severity */
  severity: z.enum(EVENT_SEVERITIES),
  /** Actor information */
  actor: ActorSchema,
  /** Resource information */
  resource: ResourceSchema,
  /** Action performed */
  action: z.string(),
  /** Outcome of the action */
  outcome: z.enum(EVENT_OUTCOMES),
  /** Additional event details */
  details: z.record(z.unknown()).default({}),
  /** Event metadata for correlation */
  metadata: MetadataSchema,
});

export type AuditEventFull = z.infer<typeof AuditEventSchemaFull>;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get event definition by type
 */
export function getEventDefinition(type: string): {
  category: EventCategory;
  severity: EventSeverity;
  description: string;
} | null {
  const def = AUDIT_EVENT_DEFINITIONS[type as AuditEventType];
  if (!def) {
    return null;
  }
  return {
    category: def.category as EventCategory,
    severity: def.severity as EventSeverity,
    description: def.description,
  };
}

/**
 * Get all event types for a category
 */
export function getEventTypesByCategory(category: EventCategory): AuditEventType[] {
  const types: AuditEventType[] = [];
  for (const [type, def] of Object.entries(AUDIT_EVENT_DEFINITIONS)) {
    if (def.category === category) {
      types.push(type as AuditEventType);
    }
  }
  return types;
}

/**
 * Get all event types for a severity level
 */
export function getEventTypesBySeverity(severity: EventSeverity): AuditEventType[] {
  const types: AuditEventType[] = [];
  for (const [type, def] of Object.entries(AUDIT_EVENT_DEFINITIONS)) {
    if (def.severity === severity) {
      types.push(type as AuditEventType);
    }
  }
  return types;
}

/**
 * Validate that a string is a valid event type
 */
export function isValidEventType(type: string): type is AuditEventType {
  return type in AUDIT_EVENT_DEFINITIONS;
}

/**
 * Get all defined event types as an array
 */
export function getAllEventTypes(): AuditEventType[] {
  return Object.keys(AUDIT_EVENT_DEFINITIONS) as AuditEventType[];
}

/**
 * Count events by category
 */
export function countEventsByCategory(): Record<EventCategory, number> {
  const counts: Record<EventCategory, number> = {
    authentication: 0,
    authorization: 0,
    'data-access': 0,
    configuration: 0,
    system: 0,
    security: 0,
    compliance: 0,
    network: 0,
  };

  for (const def of Object.values(AUDIT_EVENT_DEFINITIONS)) {
    counts[def.category as EventCategory]++;
  }

  return counts;
}

// =============================================================================
// EVENT BUILDER
// =============================================================================

/**
 * Builder for creating audit events with validation
 */
export class AuditEventBuilder {
  private event: Partial<AuditEventFull> = {};

  constructor() {
    this.event.details = {};
  }

  /**
   * Set the event ID (auto-generated if not provided)
   */
  withId(id: string): this {
    this.event.id = id;
    return this;
  }

  /**
   * Set the event timestamp (defaults to now)
   */
  withTimestamp(timestamp: Date): this {
    this.event.timestamp = timestamp;
    return this;
  }

  /**
   * Set the event type and auto-populate category/severity
   */
  withType(type: AuditEventType): this {
    const def = AUDIT_EVENT_DEFINITIONS[type];
    this.event.type = type;
    this.event.category = def.category as EventCategory;
    this.event.severity = def.severity as EventSeverity;
    return this;
  }

  /**
   * Override the category
   */
  withCategory(category: EventCategory): this {
    this.event.category = category;
    return this;
  }

  /**
   * Override the severity
   */
  withSeverity(severity: EventSeverity): this {
    this.event.severity = severity;
    return this;
  }

  /**
   * Set the actor information
   */
  withActor(actor: Actor): this {
    this.event.actor = actor;
    return this;
  }

  /**
   * Set the resource information
   */
  withResource(resource: Resource): this {
    this.event.resource = resource;
    return this;
  }

  /**
   * Set the action string
   */
  withAction(action: string): this {
    this.event.action = action;
    return this;
  }

  /**
   * Set the outcome
   */
  withOutcome(outcome: EventOutcome): this {
    this.event.outcome = outcome;
    return this;
  }

  /**
   * Set event details
   */
  withDetails(details: Record<string, unknown>): this {
    this.event.details = details;
    return this;
  }

  /**
   * Add a detail field
   */
  addDetail(key: string, value: unknown): this {
    if (!this.event.details) {
      this.event.details = {};
    }
    this.event.details[key] = value;
    return this;
  }

  /**
   * Set the metadata
   */
  withMetadata(metadata: Metadata): this {
    this.event.metadata = metadata;
    return this;
  }

  /**
   * Build and validate the event
   */
  build(): AuditEventFull {
    // Generate ID if not provided
    if (!this.event.id) {
      this.event.id = crypto.randomUUID();
    }

    // Set timestamp if not provided
    if (!this.event.timestamp) {
      this.event.timestamp = new Date();
    }

    // Validate and return
    return AuditEventSchemaFull.parse(this.event);
  }
}

/**
 * Create a new audit event builder
 */
export function createAuditEvent(): AuditEventBuilder {
  return new AuditEventBuilder();
}
