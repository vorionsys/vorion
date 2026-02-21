/**
 * Security Event Type Definitions
 *
 * Comprehensive security event types for SOC 2 compliance audit logging.
 * Every security-relevant action must be categorized and logged with full context.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ID, Timestamp } from '../common/types.js';

// =============================================================================
// SECURITY EVENT CATEGORIES
// =============================================================================

/**
 * Security event categories for SOC 2 compliance
 */
export const SECURITY_EVENT_CATEGORIES = [
  'authentication',
  'authorization',
  'data_access',
  'configuration',
  'incident',
] as const;

export type SecurityEventCategory = (typeof SECURITY_EVENT_CATEGORIES)[number];

// =============================================================================
// SECURITY EVENT SEVERITY
// =============================================================================

/**
 * Security event severity levels aligned with SOC 2 requirements
 */
export const SECURITY_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

// =============================================================================
// SECURITY EVENT OUTCOMES
// =============================================================================

/**
 * Security event outcomes for decision tracking
 */
export const SECURITY_OUTCOMES = ['success', 'failure', 'blocked', 'escalated'] as const;
export type SecurityOutcome = (typeof SECURITY_OUTCOMES)[number];

// =============================================================================
// AUTHENTICATION EVENT TYPES
// =============================================================================

/**
 * Authentication event types
 */
export const AUTHENTICATION_EVENT_TYPES = {
  // Login/Logout
  LOGIN_SUCCESS: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'User successfully authenticated',
    soc2Control: 'CC6.1',
  },
  LOGIN_FAILURE: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Authentication attempt failed',
    soc2Control: 'CC6.1',
  },
  LOGOUT: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'User logged out',
    soc2Control: 'CC6.1',
  },
  LOGIN_LOCKED: {
    category: 'authentication' as const,
    severity: 'high' as const,
    description: 'Account locked due to failed attempts',
    soc2Control: 'CC6.1',
  },

  // Session events
  SESSION_CREATED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'New session established',
    soc2Control: 'CC6.1',
  },
  SESSION_VALIDATED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'Session validated successfully',
    soc2Control: 'CC6.1',
  },
  SESSION_INVALID: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Session validation failed',
    soc2Control: 'CC6.1',
  },
  SESSION_EXPIRED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'Session expired naturally',
    soc2Control: 'CC6.1',
  },
  SESSION_REVOKED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Session forcibly terminated',
    soc2Control: 'CC6.1',
  },
  SESSIONS_BULK_REVOKED: {
    category: 'authentication' as const,
    severity: 'high' as const,
    description: 'Multiple sessions revoked for user',
    soc2Control: 'CC6.1',
  },

  // Token events
  TOKEN_ISSUED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'Access token issued',
    soc2Control: 'CC6.1',
  },
  TOKEN_REFRESHED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'Access token refreshed',
    soc2Control: 'CC6.1',
  },
  TOKEN_REVOKED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Token manually revoked',
    soc2Control: 'CC6.1',
  },
  TOKEN_VALIDATION_FAILED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Token validation failed',
    soc2Control: 'CC6.1',
  },

  // API Key events
  API_KEY_CREATED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key created',
    soc2Control: 'CC6.1',
  },
  API_KEY_VALIDATED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'API key validated successfully',
    soc2Control: 'CC6.1',
  },
  API_KEY_VALIDATION_FAILED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key validation failed',
    soc2Control: 'CC6.1',
  },
  API_KEY_REVOKED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key revoked',
    soc2Control: 'CC6.1',
  },
  API_KEY_ROTATED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key rotated',
    soc2Control: 'CC6.1',
  },
  API_KEY_EXPIRED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'API key expired',
    soc2Control: 'CC6.1',
  },
  API_KEY_DELETED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key permanently deleted',
    soc2Control: 'CC6.1',
  },
  API_KEY_RATE_LIMITED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'API key rate limit exceeded',
    soc2Control: 'CC6.1',
  },

  // MFA events
  MFA_ENROLLED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'MFA enrollment completed',
    soc2Control: 'CC6.1',
  },
  MFA_ENROLLMENT_STARTED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'MFA enrollment initiated',
    soc2Control: 'CC6.1',
  },
  MFA_ENROLLMENT_VERIFIED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'MFA enrollment code verified',
    soc2Control: 'CC6.1',
  },
  MFA_ENROLLMENT_FAILED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'MFA enrollment verification failed',
    soc2Control: 'CC6.1',
  },
  MFA_DISABLED: {
    category: 'authentication' as const,
    severity: 'high' as const,
    description: 'MFA disabled for user',
    soc2Control: 'CC6.1',
  },
  MFA_CHALLENGE_CREATED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'MFA challenge initiated',
    soc2Control: 'CC6.1',
  },
  MFA_VERIFICATION_SUCCESS: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'MFA verification successful',
    soc2Control: 'CC6.1',
  },
  MFA_VERIFICATION_FAILED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'MFA verification failed',
    soc2Control: 'CC6.1',
  },
  MFA_BACKUP_CODE_USED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'MFA backup code used',
    soc2Control: 'CC6.1',
  },
  MFA_BACKUP_CODES_REGENERATED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'MFA backup codes regenerated',
    soc2Control: 'CC6.1',
  },
  MFA_TOO_MANY_ATTEMPTS: {
    category: 'authentication' as const,
    severity: 'high' as const,
    description: 'MFA verification exceeded maximum attempts',
    soc2Control: 'CC6.1',
  },

  // Password events
  PASSWORD_CHANGED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Password changed',
    soc2Control: 'CC6.1',
  },
  PASSWORD_RESET_REQUESTED: {
    category: 'authentication' as const,
    severity: 'info' as const,
    description: 'Password reset requested',
    soc2Control: 'CC6.1',
  },
  PASSWORD_RESET_COMPLETED: {
    category: 'authentication' as const,
    severity: 'medium' as const,
    description: 'Password reset completed',
    soc2Control: 'CC6.1',
  },
} as const;

// =============================================================================
// AUTHORIZATION EVENT TYPES
// =============================================================================

/**
 * Authorization event types
 */
export const AUTHORIZATION_EVENT_TYPES = {
  ACCESS_GRANTED: {
    category: 'authorization' as const,
    severity: 'info' as const,
    description: 'Access granted to resource',
    soc2Control: 'CC6.2',
  },
  ACCESS_DENIED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Access denied to resource',
    soc2Control: 'CC6.2',
  },
  PERMISSION_GRANTED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Permission granted to user',
    soc2Control: 'CC6.2',
  },
  PERMISSION_REVOKED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Permission revoked from user',
    soc2Control: 'CC6.2',
  },
  ROLE_ASSIGNED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Role assigned to user',
    soc2Control: 'CC6.2',
  },
  ROLE_REMOVED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Role removed from user',
    soc2Control: 'CC6.2',
  },
  PRIVILEGE_ESCALATED: {
    category: 'authorization' as const,
    severity: 'high' as const,
    description: 'Privilege escalation occurred',
    soc2Control: 'CC6.2',
  },
  TRUST_TIER_CHANGED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Entity trust tier changed',
    soc2Control: 'CC6.2',
  },
  POLICY_EVALUATED: {
    category: 'authorization' as const,
    severity: 'info' as const,
    description: 'Authorization policy evaluated',
    soc2Control: 'CC6.2',
  },
  POLICY_VIOLATION: {
    category: 'authorization' as const,
    severity: 'high' as const,
    description: 'Policy violation detected',
    soc2Control: 'CC6.2',
  },
  SCOPE_CHECK_PASSED: {
    category: 'authorization' as const,
    severity: 'info' as const,
    description: 'Scope check passed',
    soc2Control: 'CC6.2',
  },
  SCOPE_CHECK_FAILED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'Scope check failed',
    soc2Control: 'CC6.2',
  },
  DPOP_VERIFIED: {
    category: 'authorization' as const,
    severity: 'info' as const,
    description: 'DPoP proof verified successfully',
    soc2Control: 'CC6.2',
  },
  DPOP_FAILED: {
    category: 'authorization' as const,
    severity: 'medium' as const,
    description: 'DPoP proof verification failed',
    soc2Control: 'CC6.2',
  },
  AGENT_REVOKED: {
    category: 'authorization' as const,
    severity: 'high' as const,
    description: 'Agent access revoked',
    soc2Control: 'CC6.2',
  },
} as const;

// =============================================================================
// DATA ACCESS EVENT TYPES
// =============================================================================

/**
 * Data access event types
 */
export const DATA_ACCESS_EVENT_TYPES = {
  DATA_READ: {
    category: 'data_access' as const,
    severity: 'info' as const,
    description: 'Data read operation',
    soc2Control: 'CC6.5',
  },
  DATA_CREATED: {
    category: 'data_access' as const,
    severity: 'info' as const,
    description: 'Data created',
    soc2Control: 'CC6.5',
  },
  DATA_UPDATED: {
    category: 'data_access' as const,
    severity: 'info' as const,
    description: 'Data updated',
    soc2Control: 'CC6.5',
  },
  DATA_DELETED: {
    category: 'data_access' as const,
    severity: 'medium' as const,
    description: 'Data deleted',
    soc2Control: 'CC6.5',
  },
  DATA_EXPORTED: {
    category: 'data_access' as const,
    severity: 'high' as const,
    description: 'Data exported',
    soc2Control: 'CC6.5',
  },
  BULK_DATA_ACCESS: {
    category: 'data_access' as const,
    severity: 'high' as const,
    description: 'Bulk data access operation',
    soc2Control: 'CC6.5',
  },
  SENSITIVE_DATA_ACCESS: {
    category: 'data_access' as const,
    severity: 'high' as const,
    description: 'Sensitive data accessed',
    soc2Control: 'CC6.5',
  },
  PII_ACCESSED: {
    category: 'data_access' as const,
    severity: 'high' as const,
    description: 'Personally identifiable information accessed',
    soc2Control: 'CC6.5',
  },
  AUDIT_LOG_ACCESSED: {
    category: 'data_access' as const,
    severity: 'medium' as const,
    description: 'Audit log accessed',
    soc2Control: 'CC6.5',
  },
  AUDIT_LOG_EXPORTED: {
    category: 'data_access' as const,
    severity: 'high' as const,
    description: 'Audit log exported',
    soc2Control: 'CC6.5',
  },
} as const;

// =============================================================================
// CONFIGURATION EVENT TYPES
// =============================================================================

/**
 * Configuration event types
 */
export const CONFIGURATION_EVENT_TYPES = {
  CONFIG_CHANGED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'System configuration changed',
    soc2Control: 'CC8.1',
  },
  SECURITY_SETTING_CHANGED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Security setting modified',
    soc2Control: 'CC8.1',
  },
  KEY_CREATED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Encryption key created',
    soc2Control: 'CC8.1',
  },
  KEY_ROTATED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Encryption key rotated',
    soc2Control: 'CC8.1',
  },
  KEY_REVOKED: {
    category: 'configuration' as const,
    severity: 'critical' as const,
    description: 'Encryption key revoked',
    soc2Control: 'CC8.1',
  },
  KEY_ACCESSED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'Encryption key accessed',
    soc2Control: 'CC8.1',
  },
  SECRET_ROTATED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Secret rotated',
    soc2Control: 'CC8.1',
  },
  SECRET_ACCESSED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'Secret accessed',
    soc2Control: 'CC8.1',
  },
  POLICY_CREATED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'Security policy created',
    soc2Control: 'CC8.1',
  },
  POLICY_UPDATED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Security policy updated',
    soc2Control: 'CC8.1',
  },
  POLICY_DELETED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'Security policy deleted',
    soc2Control: 'CC8.1',
  },
  TENANT_CREATED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'Tenant created',
    soc2Control: 'CC8.1',
  },
  TENANT_UPDATED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'Tenant configuration updated',
    soc2Control: 'CC8.1',
  },
  USER_CREATED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'User account created',
    soc2Control: 'CC8.1',
  },
  USER_UPDATED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'User account updated',
    soc2Control: 'CC8.1',
  },
  USER_DELETED: {
    category: 'configuration' as const,
    severity: 'high' as const,
    description: 'User account deleted',
    soc2Control: 'CC8.1',
  },
  USER_DISABLED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'User account disabled',
    soc2Control: 'CC8.1',
  },
  USER_ENABLED: {
    category: 'configuration' as const,
    severity: 'medium' as const,
    description: 'User account enabled',
    soc2Control: 'CC8.1',
  },
} as const;

// =============================================================================
// INCIDENT EVENT TYPES
// =============================================================================

/**
 * Incident and security alert event types
 */
export const INCIDENT_EVENT_TYPES = {
  BRUTE_FORCE_DETECTED: {
    category: 'incident' as const,
    severity: 'critical' as const,
    description: 'Brute force attack detected',
    soc2Control: 'CC7.2',
  },
  INJECTION_ATTEMPT: {
    category: 'incident' as const,
    severity: 'critical' as const,
    description: 'Injection attack attempt detected',
    soc2Control: 'CC7.2',
  },
  ANOMALY_DETECTED: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Anomalous behavior detected',
    soc2Control: 'CC7.2',
  },
  RATE_LIMIT_EXCEEDED: {
    category: 'incident' as const,
    severity: 'medium' as const,
    description: 'Rate limit exceeded',
    soc2Control: 'CC7.2',
  },
  IP_BLOCKED: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'IP address blocked',
    soc2Control: 'CC7.2',
  },
  IP_UNBLOCKED: {
    category: 'incident' as const,
    severity: 'medium' as const,
    description: 'IP address unblocked',
    soc2Control: 'CC7.2',
  },
  SUSPICIOUS_ACTIVITY: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Suspicious activity flagged',
    soc2Control: 'CC7.2',
  },
  SECURITY_ALERT: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Security alert triggered',
    soc2Control: 'CC7.2',
  },
  INCIDENT_CREATED: {
    category: 'incident' as const,
    severity: 'critical' as const,
    description: 'Security incident created',
    soc2Control: 'CC7.3',
  },
  INCIDENT_UPDATED: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Security incident updated',
    soc2Control: 'CC7.3',
  },
  INCIDENT_RESOLVED: {
    category: 'incident' as const,
    severity: 'medium' as const,
    description: 'Security incident resolved',
    soc2Control: 'CC7.3',
  },
  GEOGRAPHIC_ANOMALY: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Geographic access anomaly detected',
    soc2Control: 'CC7.2',
  },
  TEMPORAL_ANOMALY: {
    category: 'incident' as const,
    severity: 'medium' as const,
    description: 'Temporal access anomaly detected',
    soc2Control: 'CC7.2',
  },
  VOLUME_ANOMALY: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Access volume anomaly detected',
    soc2Control: 'CC7.2',
  },
  CERTIFICATE_INVALID: {
    category: 'incident' as const,
    severity: 'high' as const,
    description: 'Invalid certificate detected',
    soc2Control: 'CC7.2',
  },
  INTEGRITY_VIOLATION: {
    category: 'incident' as const,
    severity: 'critical' as const,
    description: 'Data integrity violation detected',
    soc2Control: 'CC7.2',
  },
} as const;

// =============================================================================
// ALL SECURITY EVENT TYPES
// =============================================================================

/**
 * Combined security event types for comprehensive logging
 */
export const SECURITY_EVENT_TYPES = {
  ...AUTHENTICATION_EVENT_TYPES,
  ...AUTHORIZATION_EVENT_TYPES,
  ...DATA_ACCESS_EVENT_TYPES,
  ...CONFIGURATION_EVENT_TYPES,
  ...INCIDENT_EVENT_TYPES,
} as const;

export type SecurityEventType = keyof typeof SECURITY_EVENT_TYPES;

// =============================================================================
// SECURITY ACTOR
// =============================================================================

/**
 * Actor performing the security action
 */
export interface SecurityActor {
  /** Actor type (user, agent, service, or system) */
  type: 'user' | 'agent' | 'service' | 'system';
  /** Actor's unique identifier */
  id: ID;
  /** Actor's display name */
  name?: string;
  /** Actor's email (if applicable) */
  email?: string;
  /** IP address of the actor */
  ip?: string;
  /** User agent string */
  userAgent?: string;
  /** Session ID (if authenticated) */
  sessionId?: string;
  /** Tenant context */
  tenantId?: ID;
}

/**
 * Zod schema for SecurityActor
 */
export const securityActorSchema = z.object({
  type: z.enum(['user', 'agent', 'service', 'system']),
  id: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  sessionId: z.string().optional(),
  tenantId: z.string().optional(),
});

// =============================================================================
// SECURITY RESOURCE
// =============================================================================

/**
 * Resource affected by the security event
 */
export interface SecurityResource {
  /** Resource type */
  type: string;
  /** Resource identifier */
  id: ID;
  /** Resource name (human readable) */
  name?: string;
  /** Resource path or location */
  path?: string;
  /** Additional resource attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Zod schema for SecurityResource
 */
export const securityResourceSchema = z.object({
  type: z.string(),
  id: z.string(),
  name: z.string().optional(),
  path: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});

// =============================================================================
// SECURITY EVENT
// =============================================================================

/**
 * Complete security event for audit logging
 */
export interface SecurityEvent {
  /** Unique event identifier */
  id: ID;
  /** Event timestamp (ISO 8601) */
  timestamp: Timestamp;
  /** Event type from SECURITY_EVENT_TYPES */
  eventType: SecurityEventType;
  /** Event category */
  category: SecurityEventCategory;
  /** Event severity */
  severity: SecuritySeverity;
  /** Actor who performed the action */
  actor: SecurityActor;
  /** Action performed */
  action: string;
  /** Resource affected */
  resource: SecurityResource;
  /** Outcome of the action */
  outcome: SecurityOutcome;
  /** Additional event metadata */
  metadata: Record<string, unknown>;
  /** Unique request identifier */
  requestId: ID;
  /** W3C TraceContext trace ID */
  traceId?: string;
  /** Reason for the outcome (especially for failures) */
  reason?: string;
  /** SOC 2 control identifier */
  soc2Control?: string;
  /** Hash of this record for chain integrity */
  recordHash?: string;
  /** Hash of previous record in chain */
  previousHash?: string;
  /** Sequence number in audit chain */
  sequenceNumber?: number;
}

/**
 * Zod schema for SecurityEvent
 */
export const securityEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  eventType: z.string(),
  category: z.enum(SECURITY_EVENT_CATEGORIES),
  severity: z.enum(SECURITY_SEVERITIES),
  actor: securityActorSchema,
  action: z.string(),
  resource: securityResourceSchema,
  outcome: z.enum(SECURITY_OUTCOMES),
  metadata: z.record(z.unknown()).default({}),
  requestId: z.string(),
  traceId: z.string().optional(),
  reason: z.string().optional(),
  soc2Control: z.string().optional(),
  recordHash: z.string().optional(),
  previousHash: z.string().optional(),
  sequenceNumber: z.number().int().optional(),
});

// =============================================================================
// SECURITY EVENT INPUT
// =============================================================================

/**
 * Input for creating a security event (without auto-generated fields)
 */
export interface CreateSecurityEventInput {
  /** Event type from SECURITY_EVENT_TYPES */
  eventType: SecurityEventType;
  /** Actor who performed the action */
  actor: SecurityActor;
  /** Action performed */
  action: string;
  /** Resource affected */
  resource: SecurityResource;
  /** Outcome of the action */
  outcome: SecurityOutcome;
  /** Additional event metadata */
  metadata?: Record<string, unknown>;
  /** Reason for the outcome */
  reason?: string;
  /** Override timestamp (defaults to now) */
  timestamp?: Timestamp;
  /** Override request ID (auto-populated from trace context) */
  requestId?: ID;
  /** Override trace ID (auto-populated from trace context) */
  traceId?: string;
}

/**
 * Zod schema for CreateSecurityEventInput
 */
export const createSecurityEventInputSchema = z.object({
  eventType: z.string(),
  actor: securityActorSchema,
  action: z.string(),
  resource: securityResourceSchema,
  outcome: z.enum(SECURITY_OUTCOMES),
  metadata: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get event definition by type
 */
export function getSecurityEventDefinition(
  eventType: SecurityEventType
): {
  category: SecurityEventCategory;
  severity: SecuritySeverity;
  description: string;
  soc2Control: string;
} {
  const def = SECURITY_EVENT_TYPES[eventType];
  return {
    category: def.category,
    severity: def.severity,
    description: def.description,
    soc2Control: def.soc2Control,
  };
}

/**
 * Get all event types for a category
 */
export function getSecurityEventsByCategory(category: SecurityEventCategory): SecurityEventType[] {
  return Object.entries(SECURITY_EVENT_TYPES)
    .filter(([_, def]) => def.category === category)
    .map(([type]) => type as SecurityEventType);
}

/**
 * Get all event types for a severity level
 */
export function getSecurityEventsBySeverity(severity: SecuritySeverity): SecurityEventType[] {
  return Object.entries(SECURITY_EVENT_TYPES)
    .filter(([_, def]) => def.severity === severity)
    .map(([type]) => type as SecurityEventType);
}

/**
 * Validate that a string is a valid security event type
 */
export function isValidSecurityEventType(type: string): type is SecurityEventType {
  return type in SECURITY_EVENT_TYPES;
}

/**
 * Get all security event types
 */
export function getAllSecurityEventTypes(): SecurityEventType[] {
  return Object.keys(SECURITY_EVENT_TYPES) as SecurityEventType[];
}

/**
 * Get SOC 2 control for an event type
 */
export function getSoc2Control(eventType: SecurityEventType): string {
  return SECURITY_EVENT_TYPES[eventType].soc2Control;
}
