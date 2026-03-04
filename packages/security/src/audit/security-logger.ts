/**
 * Security Audit Logger
 *
 * Comprehensive security audit logging service for SOC 2 compliance.
 * Wraps the existing audit service with specialized methods for security events.
 * Provides automatic context enrichment, severity classification, and immutable
 * log format with hash chain continuation.
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { createLogger } from '../common/logger.js';
import { getTraceContext } from '../common/trace.js';
import { secureRandomString } from '../common/random.js';
import type { ID, Timestamp } from '../common/types.js';
import { AuditService, createAuditService } from './service.js';
import {
  type SecurityEventType,
  type SecurityEventCategory,
  type SecuritySeverity,
  type SecurityOutcome,
  type SecurityActor,
  type SecurityResource,
  type SecurityEvent,
  type CreateSecurityEventInput,
  SECURITY_EVENT_TYPES,
  getSecurityEventDefinition,
} from './security-events.js';

const logger = createLogger({ component: 'security-audit-logger' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Request context for automatic enrichment
 */
export interface SecurityRequestContext {
  /** Client IP address */
  ip?: string;
  /** User agent string */
  userAgent?: string;
  /** Session ID */
  sessionId?: string;
  /** Tenant ID */
  tenantId: ID;
  /** Request ID */
  requestId?: ID;
  /** Trace ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
}

/**
 * Security logger configuration
 */
export interface SecurityLoggerConfig {
  /** Enable hash chain for immutability (default: true) */
  enableHashChain?: boolean;
  /** Enable console logging of security events (default: false) */
  consoleLogging?: boolean;
  /** Minimum severity to log (default: 'info') */
  minSeverity?: SecuritySeverity;
  /** Additional metadata to include in all events */
  defaultMetadata?: Record<string, unknown>;
}

/**
 * Security logger dependencies
 */
export interface SecurityLoggerDependencies {
  /** Audit service for persistence */
  auditService?: AuditService;
}

// Severity ordering for filtering
const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// =============================================================================
// SECURITY AUDIT LOGGER CLASS
// =============================================================================

/**
 * Security Audit Logger
 *
 * Provides comprehensive security event logging with automatic context enrichment,
 * severity classification, and immutable hash chain for SOC 2 compliance.
 */
export class SecurityAuditLogger {
  private auditService: AuditService;
  private config: Required<SecurityLoggerConfig>;
  private lastHash: string | null = null;
  private sequenceNumber: number = 0;
  private requestContext: SecurityRequestContext | null = null;

  constructor(
    config: SecurityLoggerConfig = {},
    deps: SecurityLoggerDependencies = {}
  ) {
    this.auditService = deps.auditService ?? createAuditService();
    this.config = {
      enableHashChain: config.enableHashChain ?? true,
      consoleLogging: config.consoleLogging ?? false,
      minSeverity: config.minSeverity ?? 'info',
      defaultMetadata: config.defaultMetadata ?? {},
    };
  }

  // ===========================================================================
  // CONTEXT MANAGEMENT
  // ===========================================================================

  /**
   * Set request context for automatic enrichment
   * Call this at the start of each request to enrich all security events
   */
  setRequestContext(context: SecurityRequestContext): void {
    this.requestContext = context;
  }

  /**
   * Clear request context
   * Call this at the end of each request
   */
  clearRequestContext(): void {
    this.requestContext = null;
  }

  /**
   * Create a scoped logger with preset context
   */
  withContext(context: SecurityRequestContext): ScopedSecurityLogger {
    return new ScopedSecurityLogger(this, context);
  }

  // ===========================================================================
  // CORE LOGGING METHOD
  // ===========================================================================

  /**
   * Log a security event
   */
  async log(input: CreateSecurityEventInput): Promise<SecurityEvent> {
    // Get event definition
    const def = getSecurityEventDefinition(input.eventType);

    // Check severity filter
    if (SEVERITY_ORDER[def.severity] < SEVERITY_ORDER[this.config.minSeverity]) {
      throw new Error(`Event severity ${def.severity} below minimum ${this.config.minSeverity}`);
    }

    // Get trace context
    const traceContext = getTraceContext();

    // Build enriched actor
    const enrichedActor: SecurityActor = {
      ...input.actor,
      ip: input.actor.ip ?? this.requestContext?.ip,
      userAgent: input.actor.userAgent ?? this.requestContext?.userAgent,
      sessionId: input.actor.sessionId ?? this.requestContext?.sessionId,
      tenantId: input.actor.tenantId ?? this.requestContext?.tenantId,
    };

    // Generate event ID and timestamp
    const eventId = crypto.randomUUID();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const requestId = input.requestId ?? this.requestContext?.requestId ?? traceContext?.traceId ?? this.generateRequestId();
    const traceId = input.traceId ?? this.requestContext?.traceId ?? traceContext?.traceId;

    // Build the event
    const event: SecurityEvent = {
      id: eventId,
      timestamp,
      eventType: input.eventType,
      category: def.category,
      severity: def.severity,
      actor: enrichedActor,
      action: input.action,
      resource: input.resource,
      outcome: input.outcome,
      metadata: {
        ...this.config.defaultMetadata,
        ...input.metadata,
      },
      requestId,
      traceId,
      reason: input.reason,
      soc2Control: def.soc2Control,
    };

    // Add hash chain if enabled
    if (this.config.enableHashChain) {
      this.sequenceNumber++;
      event.sequenceNumber = this.sequenceNumber;
      event.previousHash = this.lastHash ?? undefined;
      event.recordHash = this.computeHash(event);
      this.lastHash = event.recordHash;
    }

    // Persist to audit service
    const tenantId = enrichedActor.tenantId ?? this.requestContext?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required for security audit logging');
    }

    await this.auditService.record({
      tenantId,
      eventType: input.eventType,
      actor: {
        type: enrichedActor.type,
        id: enrichedActor.id,
        name: enrichedActor.name,
        ip: enrichedActor.ip,
      },
      target: {
        type: input.resource.type as 'intent' | 'policy' | 'escalation' | 'entity' | 'tenant' | 'user' | 'system',
        id: input.resource.id,
        name: input.resource.name,
      },
      action: input.action,
      outcome: input.outcome === 'blocked' ? 'failure' : input.outcome === 'escalated' ? 'partial' : input.outcome,
      reason: input.reason,
      metadata: {
        ...event.metadata,
        category: event.category,
        severity: event.severity,
        soc2Control: event.soc2Control,
        recordHash: event.recordHash,
        previousHash: event.previousHash,
        sequenceNumber: event.sequenceNumber,
        resourcePath: input.resource.path,
        resourceAttributes: input.resource.attributes,
      },
      requestId,
      traceId,
    });

    // Console logging if enabled
    if (this.config.consoleLogging) {
      this.logToConsole(event);
    }

    return event;
  }

  // ===========================================================================
  // AUTHENTICATION EVENTS
  // ===========================================================================

  /**
   * Log authentication attempt
   */
  async logAuthAttempt(
    actor: SecurityActor,
    success: boolean,
    resource: SecurityResource,
    metadata?: Record<string, unknown>,
    reason?: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
      actor,
      action: 'authenticate',
      resource,
      outcome: success ? 'success' : 'failure',
      metadata,
      reason: success ? undefined : reason,
    });
  }

  /**
   * Log session creation
   */
  async logSessionCreated(
    actor: SecurityActor,
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SESSION_CREATED',
      actor,
      action: 'create_session',
      resource: { type: 'session', id: sessionId },
      outcome: 'success',
      metadata,
    });
  }

  /**
   * Log session validation
   */
  async logSessionValidation(
    actor: SecurityActor,
    sessionId: string,
    valid: boolean,
    reason?: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: valid ? 'SESSION_VALIDATED' : 'SESSION_INVALID',
      actor,
      action: 'validate_session',
      resource: { type: 'session', id: sessionId },
      outcome: valid ? 'success' : 'failure',
      reason,
    });
  }

  /**
   * Log session revocation
   */
  async logSessionRevoked(
    actor: SecurityActor,
    sessionId: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SESSION_REVOKED',
      actor,
      action: 'revoke_session',
      resource: { type: 'session', id: sessionId },
      outcome: 'success',
      reason,
      metadata,
    });
  }

  /**
   * Log bulk session revocation
   */
  async logSessionsBulkRevoked(
    actor: SecurityActor,
    userId: string,
    count: number,
    reason: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SESSIONS_BULK_REVOKED',
      actor,
      action: 'bulk_revoke_sessions',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      reason,
      metadata: { sessionsRevoked: count },
    });
  }

  // ===========================================================================
  // API KEY EVENTS
  // ===========================================================================

  /**
   * Log API key creation
   */
  async logApiKeyCreated(
    actor: SecurityActor,
    keyId: string,
    keyName: string,
    scopes: string[],
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'API_KEY_CREATED',
      actor,
      action: 'create_api_key',
      resource: { type: 'api_key', id: keyId, name: keyName },
      outcome: 'success',
      metadata: { ...metadata, scopes },
    });
  }

  /**
   * Log API key validation
   */
  async logApiKeyValidation(
    actor: SecurityActor,
    keyId: string,
    keyName: string,
    valid: boolean,
    reason?: string,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: valid ? 'API_KEY_VALIDATED' : 'API_KEY_VALIDATION_FAILED',
      actor,
      action: 'validate_api_key',
      resource: { type: 'api_key', id: keyId, name: keyName },
      outcome: valid ? 'success' : 'failure',
      reason,
      metadata,
    });
  }

  /**
   * Log API key revocation
   */
  async logApiKeyRevoked(
    actor: SecurityActor,
    keyId: string,
    keyName: string,
    reason: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'API_KEY_REVOKED',
      actor,
      action: 'revoke_api_key',
      resource: { type: 'api_key', id: keyId, name: keyName },
      outcome: 'success',
      reason,
    });
  }

  /**
   * Log API key rotation
   */
  async logApiKeyRotated(
    actor: SecurityActor,
    oldKeyId: string,
    newKeyId: string,
    keyName: string,
    gracePeriodMinutes?: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'API_KEY_ROTATED',
      actor,
      action: 'rotate_api_key',
      resource: { type: 'api_key', id: newKeyId, name: keyName },
      outcome: 'success',
      metadata: { oldKeyId, gracePeriodMinutes },
    });
  }

  /**
   * Log API key rate limit exceeded
   */
  async logApiKeyRateLimited(
    actor: SecurityActor,
    keyId: string,
    keyName: string,
    retryAfter: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'API_KEY_RATE_LIMITED',
      actor,
      action: 'rate_limit_exceeded',
      resource: { type: 'api_key', id: keyId, name: keyName },
      outcome: 'blocked',
      metadata: { retryAfter },
    });
  }

  // ===========================================================================
  // MFA EVENTS
  // ===========================================================================

  /**
   * Log MFA enrollment started
   */
  async logMfaEnrollmentStarted(
    actor: SecurityActor,
    userId: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_ENROLLMENT_STARTED',
      actor,
      action: 'start_mfa_enrollment',
      resource: { type: 'user', id: userId },
      outcome: 'success',
    });
  }

  /**
   * Log MFA enrollment verification
   */
  async logMfaEnrollmentVerified(
    actor: SecurityActor,
    userId: string,
    success: boolean
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: success ? 'MFA_ENROLLMENT_VERIFIED' : 'MFA_ENROLLMENT_FAILED',
      actor,
      action: 'verify_mfa_enrollment',
      resource: { type: 'user', id: userId },
      outcome: success ? 'success' : 'failure',
    });
  }

  /**
   * Log MFA enrollment completed
   */
  async logMfaEnrolled(
    actor: SecurityActor,
    userId: string,
    backupCodeCount: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_ENROLLED',
      actor,
      action: 'complete_mfa_enrollment',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      metadata: { backupCodeCount },
    });
  }

  /**
   * Log MFA disabled
   */
  async logMfaDisabled(
    actor: SecurityActor,
    userId: string,
    reason?: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_DISABLED',
      actor,
      action: 'disable_mfa',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      reason,
    });
  }

  /**
   * Log MFA challenge created
   */
  async logMfaChallengeCreated(
    actor: SecurityActor,
    userId: string,
    challengeId: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_CHALLENGE_CREATED',
      actor,
      action: 'create_mfa_challenge',
      resource: { type: 'mfa_challenge', id: challengeId },
      outcome: 'success',
      metadata: { userId },
    });
  }

  /**
   * Log MFA verification
   */
  async logMfaVerification(
    actor: SecurityActor,
    userId: string,
    success: boolean,
    method: string,
    attemptsRemaining?: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: success ? 'MFA_VERIFICATION_SUCCESS' : 'MFA_VERIFICATION_FAILED',
      actor,
      action: 'verify_mfa',
      resource: { type: 'user', id: userId },
      outcome: success ? 'success' : 'failure',
      metadata: { method, attemptsRemaining },
    });
  }

  /**
   * Log MFA backup code used
   */
  async logMfaBackupCodeUsed(
    actor: SecurityActor,
    userId: string,
    codesRemaining: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_BACKUP_CODE_USED',
      actor,
      action: 'use_backup_code',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      metadata: { codesRemaining },
    });
  }

  /**
   * Log MFA backup codes regenerated
   */
  async logMfaBackupCodesRegenerated(
    actor: SecurityActor,
    userId: string,
    count: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_BACKUP_CODES_REGENERATED',
      actor,
      action: 'regenerate_backup_codes',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      metadata: { codeCount: count },
    });
  }

  /**
   * Log MFA too many attempts
   */
  async logMfaTooManyAttempts(
    actor: SecurityActor,
    userId: string,
    attemptCount: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'MFA_TOO_MANY_ATTEMPTS',
      actor,
      action: 'mfa_lockout',
      resource: { type: 'user', id: userId },
      outcome: 'blocked',
      metadata: { attemptCount },
    });
  }

  // ===========================================================================
  // AUTHORIZATION EVENTS
  // ===========================================================================

  /**
   * Log access denied
   */
  async logAccessDenied(
    actor: SecurityActor,
    resource: SecurityResource,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'ACCESS_DENIED',
      actor,
      action: 'access',
      resource,
      outcome: 'blocked',
      reason,
      metadata,
    });
  }

  /**
   * Log access granted
   */
  async logAccessGranted(
    actor: SecurityActor,
    resource: SecurityResource,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'ACCESS_GRANTED',
      actor,
      action: 'access',
      resource,
      outcome: 'success',
      metadata,
    });
  }

  /**
   * Log privilege escalation
   */
  async logPrivilegeEscalated(
    actor: SecurityActor,
    userId: string,
    fromLevel: number,
    toLevel: number,
    reason: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'PRIVILEGE_ESCALATED',
      actor,
      action: 'escalate_privilege',
      resource: { type: 'user', id: userId },
      outcome: 'success',
      reason,
      metadata: { fromLevel, toLevel },
    });
  }

  /**
   * Log DPoP verification
   */
  async logDpopVerification(
    actor: SecurityActor,
    success: boolean,
    keyThumbprint?: string,
    error?: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: success ? 'DPOP_VERIFIED' : 'DPOP_FAILED',
      actor,
      action: 'verify_dpop',
      resource: { type: 'dpop_proof', id: keyThumbprint ?? 'unknown' },
      outcome: success ? 'success' : 'failure',
      reason: error,
      metadata: { keyThumbprint },
    });
  }

  /**
   * Log agent revocation
   */
  async logAgentRevoked(
    actor: SecurityActor,
    agentDid: string,
    reason: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'AGENT_REVOKED',
      actor,
      action: 'revoke_agent',
      resource: { type: 'agent', id: agentDid },
      outcome: 'success',
      reason,
    });
  }

  // ===========================================================================
  // CONFIGURATION EVENTS
  // ===========================================================================

  /**
   * Log key rotation
   */
  async logKeyRotation(
    actor: SecurityActor,
    keyId: string,
    keyType: string,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'KEY_ROTATED',
      actor,
      action: 'rotate_key',
      resource: { type: keyType, id: keyId },
      outcome: 'success',
      metadata,
    });
  }

  /**
   * Log secret rotation
   */
  async logSecretRotation(
    actor: SecurityActor,
    secretId: string,
    secretType: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SECRET_ROTATED',
      actor,
      action: 'rotate_secret',
      resource: { type: secretType, id: secretId },
      outcome: 'success',
    });
  }

  /**
   * Log configuration change
   */
  async logConfigChange(
    actor: SecurityActor,
    configKey: string,
    resource: SecurityResource,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'CONFIG_CHANGED',
      actor,
      action: 'change_config',
      resource,
      outcome: 'success',
      metadata: { ...metadata, configKey },
    });
  }

  /**
   * Log security setting change
   */
  async logSecuritySettingChange(
    actor: SecurityActor,
    settingName: string,
    oldValue: unknown,
    newValue: unknown
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SECURITY_SETTING_CHANGED',
      actor,
      action: 'change_security_setting',
      resource: { type: 'security_setting', id: settingName },
      outcome: 'success',
      metadata: { settingName, oldValue: String(oldValue), newValue: String(newValue) },
    });
  }

  // ===========================================================================
  // INCIDENT EVENTS
  // ===========================================================================

  /**
   * Log brute force detection
   */
  async logBruteForceDetected(
    actor: SecurityActor,
    targetResource: SecurityResource,
    attemptCount: number,
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'BRUTE_FORCE_DETECTED',
      actor,
      action: 'brute_force_attack',
      resource: targetResource,
      outcome: 'blocked',
      metadata: { ...metadata, attemptCount },
    });
  }

  /**
   * Log injection attempt
   */
  async logInjectionAttempt(
    actor: SecurityActor,
    resource: SecurityResource,
    injectionType: string,
    payload: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'INJECTION_ATTEMPT',
      actor,
      action: 'injection_attack',
      resource,
      outcome: 'blocked',
      metadata: { injectionType, payloadHash: this.hashPayload(payload) },
    });
  }

  /**
   * Log anomaly detection
   */
  async logAnomalyDetected(
    actor: SecurityActor,
    anomalyType: string,
    resource: SecurityResource,
    details: Record<string, unknown>
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'ANOMALY_DETECTED',
      actor,
      action: 'anomaly_detection',
      resource,
      outcome: 'escalated',
      metadata: { anomalyType, ...details },
    });
  }

  /**
   * Log rate limit exceeded
   */
  async logRateLimitExceeded(
    actor: SecurityActor,
    resource: SecurityResource,
    limitType: string,
    retryAfter: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'RATE_LIMIT_EXCEEDED',
      actor,
      action: 'rate_limit',
      resource,
      outcome: 'blocked',
      metadata: { limitType, retryAfter },
    });
  }

  /**
   * Log IP blocked
   */
  async logIpBlocked(
    actor: SecurityActor,
    ip: string,
    reason: string,
    duration?: number
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'IP_BLOCKED',
      actor,
      action: 'block_ip',
      resource: { type: 'ip_address', id: ip },
      outcome: 'success',
      reason,
      metadata: { duration },
    });
  }

  /**
   * Log security incident created
   */
  async logIncidentCreated(
    actor: SecurityActor,
    incidentId: string,
    incidentType: string,
    severity: string,
    description: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'INCIDENT_CREATED',
      actor,
      action: 'create_incident',
      resource: { type: 'incident', id: incidentId, name: incidentType },
      outcome: 'success',
      metadata: { incidentType, incidentSeverity: severity, description },
    });
  }

  /**
   * Log data access
   */
  async logDataAccess(
    actor: SecurityActor,
    resource: SecurityResource,
    operation: 'read' | 'create' | 'update' | 'delete' | 'export',
    metadata?: Record<string, unknown>
  ): Promise<SecurityEvent> {
    const eventTypeMap: Record<string, SecurityEventType> = {
      read: 'DATA_READ',
      create: 'DATA_CREATED',
      update: 'DATA_UPDATED',
      delete: 'DATA_DELETED',
      export: 'DATA_EXPORTED',
    };

    return this.log({
      eventType: eventTypeMap[operation]!,
      actor,
      action: operation,
      resource,
      outcome: 'success',
      metadata,
    });
  }

  /**
   * Log sensitive data access
   */
  async logSensitiveDataAccess(
    actor: SecurityActor,
    resource: SecurityResource,
    dataClassification: string,
    reason?: string
  ): Promise<SecurityEvent> {
    return this.log({
      eventType: 'SENSITIVE_DATA_ACCESS',
      actor,
      action: 'access_sensitive_data',
      resource,
      outcome: 'success',
      reason,
      metadata: { dataClassification },
    });
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `sreq-${Date.now()}-${secureRandomString(8)}`;
  }

  /**
   * Compute hash for an event
   */
  private computeHash(event: SecurityEvent): string {
    const payload = {
      id: event.id,
      timestamp: event.timestamp,
      eventType: event.eventType,
      actor: event.actor,
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
      requestId: event.requestId,
      previousHash: event.previousHash,
      sequenceNumber: event.sequenceNumber,
    };

    return createHash('sha256')
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest('hex');
  }

  /**
   * Hash a potentially sensitive payload
   */
  private hashPayload(payload: string): string {
    return createHash('sha256').update(payload).digest('hex').substring(0, 16);
  }

  /**
   * Log event to console
   */
  private logToConsole(event: SecurityEvent): void {
    const logMethod =
      event.severity === 'critical' || event.severity === 'high'
        ? 'warn'
        : event.severity === 'medium'
        ? 'info'
        : 'debug';

    logger[logMethod](
      {
        eventType: event.eventType,
        category: event.category,
        severity: event.severity,
        actorId: event.actor.id,
        actorType: event.actor.type,
        resourceType: event.resource.type,
        resourceId: event.resource.id,
        outcome: event.outcome,
        requestId: event.requestId,
      },
      `Security event: ${event.eventType}`
    );
  }
}

// =============================================================================
// SCOPED SECURITY LOGGER
// =============================================================================

/**
 * Scoped security logger with preset context
 */
export class ScopedSecurityLogger {
  constructor(
    private parent: SecurityAuditLogger,
    private context: SecurityRequestContext
  ) {}

  /**
   * Log a security event with scoped context
   */
  async log(input: CreateSecurityEventInput): Promise<SecurityEvent> {
    // Merge context into actor
    const enrichedInput: CreateSecurityEventInput = {
      ...input,
      actor: {
        ...input.actor,
        ip: input.actor.ip ?? this.context.ip,
        userAgent: input.actor.userAgent ?? this.context.userAgent,
        sessionId: input.actor.sessionId ?? this.context.sessionId,
        tenantId: input.actor.tenantId ?? this.context.tenantId,
      },
      requestId: input.requestId ?? this.context.requestId,
      traceId: input.traceId ?? this.context.traceId,
    };

    this.parent.setRequestContext(this.context);
    try {
      return await this.parent.log(enrichedInput);
    } finally {
      this.parent.clearRequestContext();
    }
  }

  // Delegate all typed methods to parent with context
  logAuthAttempt = (...args: Parameters<SecurityAuditLogger['logAuthAttempt']>) =>
    this.withScope(() => this.parent.logAuthAttempt(...args));
  logSessionCreated = (...args: Parameters<SecurityAuditLogger['logSessionCreated']>) =>
    this.withScope(() => this.parent.logSessionCreated(...args));
  logSessionValidation = (...args: Parameters<SecurityAuditLogger['logSessionValidation']>) =>
    this.withScope(() => this.parent.logSessionValidation(...args));
  logSessionRevoked = (...args: Parameters<SecurityAuditLogger['logSessionRevoked']>) =>
    this.withScope(() => this.parent.logSessionRevoked(...args));
  logApiKeyCreated = (...args: Parameters<SecurityAuditLogger['logApiKeyCreated']>) =>
    this.withScope(() => this.parent.logApiKeyCreated(...args));
  logApiKeyValidation = (...args: Parameters<SecurityAuditLogger['logApiKeyValidation']>) =>
    this.withScope(() => this.parent.logApiKeyValidation(...args));
  logApiKeyRevoked = (...args: Parameters<SecurityAuditLogger['logApiKeyRevoked']>) =>
    this.withScope(() => this.parent.logApiKeyRevoked(...args));
  logApiKeyRotated = (...args: Parameters<SecurityAuditLogger['logApiKeyRotated']>) =>
    this.withScope(() => this.parent.logApiKeyRotated(...args));
  logMfaEnrollmentStarted = (...args: Parameters<SecurityAuditLogger['logMfaEnrollmentStarted']>) =>
    this.withScope(() => this.parent.logMfaEnrollmentStarted(...args));
  logMfaEnrolled = (...args: Parameters<SecurityAuditLogger['logMfaEnrolled']>) =>
    this.withScope(() => this.parent.logMfaEnrolled(...args));
  logMfaVerification = (...args: Parameters<SecurityAuditLogger['logMfaVerification']>) =>
    this.withScope(() => this.parent.logMfaVerification(...args));
  logAccessDenied = (...args: Parameters<SecurityAuditLogger['logAccessDenied']>) =>
    this.withScope(() => this.parent.logAccessDenied(...args));
  logAccessGranted = (...args: Parameters<SecurityAuditLogger['logAccessGranted']>) =>
    this.withScope(() => this.parent.logAccessGranted(...args));
  logKeyRotation = (...args: Parameters<SecurityAuditLogger['logKeyRotation']>) =>
    this.withScope(() => this.parent.logKeyRotation(...args));
  logBruteForceDetected = (...args: Parameters<SecurityAuditLogger['logBruteForceDetected']>) =>
    this.withScope(() => this.parent.logBruteForceDetected(...args));
  logInjectionAttempt = (...args: Parameters<SecurityAuditLogger['logInjectionAttempt']>) =>
    this.withScope(() => this.parent.logInjectionAttempt(...args));
  logAnomalyDetected = (...args: Parameters<SecurityAuditLogger['logAnomalyDetected']>) =>
    this.withScope(() => this.parent.logAnomalyDetected(...args));
  logDataAccess = (...args: Parameters<SecurityAuditLogger['logDataAccess']>) =>
    this.withScope(() => this.parent.logDataAccess(...args));

  private async withScope<T>(fn: () => Promise<T>): Promise<T> {
    this.parent.setRequestContext(this.context);
    try {
      return await fn();
    } finally {
      this.parent.clearRequestContext();
    }
  }
}

// =============================================================================
// FACTORY & SINGLETON
// =============================================================================

let securityLogger: SecurityAuditLogger | null = null;

/**
 * Get the singleton security audit logger
 */
export function getSecurityAuditLogger(config?: SecurityLoggerConfig): SecurityAuditLogger {
  if (!securityLogger) {
    securityLogger = new SecurityAuditLogger(config);
    logger.info('Security audit logger initialized');
  }
  return securityLogger;
}

/**
 * Create a new security audit logger instance
 */
export function createSecurityAuditLogger(
  config?: SecurityLoggerConfig,
  deps?: SecurityLoggerDependencies
): SecurityAuditLogger {
  return new SecurityAuditLogger(config, deps);
}

/**
 * Reset the singleton (for testing)
 */
export function resetSecurityAuditLogger(): void {
  securityLogger = null;
}
