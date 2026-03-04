/**
 * Break-Glass Emergency Access System
 *
 * Provides emergency privileged access for critical situations when normal
 * authorization cannot be obtained in time. Implements strict controls including:
 * - Multi-factor authentication verification
 * - Real-time notifications to all security admins
 * - SMS/phone alerts to CISO
 * - Comprehensive audit trail
 * - Automatic expiration and post-incident review requirements
 * - Usage limits to prevent abuse
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import type {
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';

const logger = createLogger({ component: 'break-glass' });

// =============================================================================
// Constants
// =============================================================================

/** Maximum duration of a break-glass session (4 hours) */
const MAX_SESSION_DURATION_MS = 4 * 60 * 60 * 1000;

/** Maximum number of break-glass uses per user per month */
const MAX_USES_PER_MONTH = 3;

/** Review deadline after session ends (24 hours) */
const REVIEW_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** Renewal extension (4 hours, can only be used once) */
const RENEWAL_DURATION_MS = 4 * 60 * 60 * 1000;

// =============================================================================
// Metrics
// =============================================================================

const breakGlassActivations = new Counter({
  name: 'vorion_break_glass_activations_total',
  help: 'Total break-glass activations',
  labelNames: ['scope', 'outcome'] as const,
  registers: [vorionRegistry],
});

const breakGlassRevocations = new Counter({
  name: 'vorion_break_glass_revocations_total',
  help: 'Total break-glass revocations',
  labelNames: ['reason'] as const,
  registers: [vorionRegistry],
});

const activeBreakGlassSessions = new Gauge({
  name: 'vorion_break_glass_active_sessions',
  help: 'Number of currently active break-glass sessions',
  registers: [vorionRegistry],
});

const breakGlassActionsDuringSession = new Counter({
  name: 'vorion_break_glass_actions_total',
  help: 'Total actions performed during break-glass sessions',
  labelNames: ['action_type'] as const,
  registers: [vorionRegistry],
});

const breakGlassSessionDuration = new Histogram({
  name: 'vorion_break_glass_session_duration_seconds',
  help: 'Duration of break-glass sessions',
  buckets: [300, 600, 1800, 3600, 7200, 14400], // 5m, 10m, 30m, 1h, 2h, 4h
  registers: [vorionRegistry],
});

// =============================================================================
// Types & Schemas
// =============================================================================

/**
 * Scope of break-glass access
 */
export const BreakGlassScope = {
  FULL: 'full',
  LIMITED: 'limited',
} as const;

export type BreakGlassScope = (typeof BreakGlassScope)[keyof typeof BreakGlassScope];

export const breakGlassScopeSchema = z.nativeEnum(BreakGlassScope);

/**
 * Status of a break-glass session
 */
export const BreakGlassStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  REVIEW_PENDING: 'review_pending',
  REVIEWED: 'reviewed',
} as const;

export type BreakGlassStatus = (typeof BreakGlassStatus)[keyof typeof BreakGlassStatus];

export const breakGlassStatusSchema = z.nativeEnum(BreakGlassStatus);

/**
 * Verification method used for break-glass
 */
export const VerificationMethod = {
  MFA_TOTP: 'mfa_totp',
  MFA_BACKUP_CODE: 'mfa_backup_code',
  PHONE_CALLBACK: 'phone_callback',
  HARDWARE_TOKEN: 'hardware_token',
} as const;

export type VerificationMethod = (typeof VerificationMethod)[keyof typeof VerificationMethod];

export const verificationMethodSchema = z.nativeEnum(VerificationMethod);

/**
 * Break-glass request input
 */
export interface BreakGlassRequest {
  /** User ID of the requester */
  userId: string;
  /** Mandatory justification for the emergency access */
  reason: string;
  /** Optional linked incident ID */
  incidentId?: string;
  /** Scope of access requested */
  scope: BreakGlassScope;
  /** Specific resources if scope is 'limited' */
  resources?: string[];
  /** IP address of the requester */
  ipAddress?: string;
  /** Device fingerprint for verification */
  deviceFingerprint?: string;
  /** User agent string */
  userAgent?: string;
}

export const breakGlassRequestSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  incidentId: z.string().optional(),
  scope: breakGlassScopeSchema,
  resources: z.array(z.string()).optional(),
  ipAddress: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  userAgent: z.string().optional(),
}).refine(
  (data) => data.scope !== 'limited' || (data.resources && data.resources.length > 0),
  { message: 'Resources must be specified for limited scope' }
);

/**
 * Action performed during a break-glass session
 */
export interface BreakGlassAction {
  /** Unique action ID */
  id: string;
  /** Timestamp of the action */
  timestamp: Date;
  /** Type of action */
  type: string;
  /** HTTP method if applicable */
  method?: string;
  /** Resource path */
  path?: string;
  /** Resource ID */
  resourceId?: string;
  /** IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Request body hash (for audit, not actual content) */
  requestBodyHash?: string;
  /** Response status code */
  responseStatus?: number;
  /** Duration of the action in milliseconds */
  durationMs?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const breakGlassActionSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.date(),
  type: z.string(),
  method: z.string().optional(),
  path: z.string().optional(),
  resourceId: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  requestBodyHash: z.string().optional(),
  responseStatus: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Break-glass session
 */
export interface BreakGlassSession {
  /** Unique session ID */
  id: string;
  /** User ID of the requester */
  userId: string;
  /** Justification reason */
  reason: string;
  /** Linked incident ID */
  incidentId?: string;
  /** Access scope */
  scope: BreakGlassScope;
  /** Specific resources if limited scope */
  resources?: string[];
  /** Session status */
  status: BreakGlassStatus;
  /** When the session started */
  startedAt: Date;
  /** When the session expires */
  expiresAt: Date;
  /** When the session ended (revoked or expired) */
  endedAt?: Date;
  /** Who revoked the session */
  revokedBy?: string;
  /** Reason for revocation */
  revocationReason?: string;
  /** Whether the session has been renewed */
  renewed: boolean;
  /** Actions performed during the session */
  actions: BreakGlassAction[];
  /** Always requires post-incident review */
  requiresPostReview: true;
  /** Verification methods used */
  verificationMethods: VerificationMethod[];
  /** IP address at activation */
  activationIp?: string;
  /** Device fingerprint at activation */
  deviceFingerprint?: string;
  /** Notifications sent */
  notificationsSent: BreakGlassNotification[];
  /** Post-incident review details */
  review?: BreakGlassReview;
}

export const breakGlassSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  reason: z.string(),
  incidentId: z.string().optional(),
  scope: breakGlassScopeSchema,
  resources: z.array(z.string()).optional(),
  status: breakGlassStatusSchema,
  startedAt: z.date(),
  expiresAt: z.date(),
  endedAt: z.date().optional(),
  revokedBy: z.string().optional(),
  revocationReason: z.string().optional(),
  renewed: z.boolean(),
  actions: z.array(breakGlassActionSchema),
  requiresPostReview: z.literal(true),
  verificationMethods: z.array(verificationMethodSchema),
  activationIp: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  notificationsSent: z.array(z.object({
    id: z.string(),
    channel: z.string(),
    target: z.string(),
    sentAt: z.date(),
    success: z.boolean(),
    error: z.string().optional(),
  })),
  review: z.object({
    reviewedAt: z.date(),
    reviewedBy: z.string(),
    approved: z.boolean(),
    findings: z.string(),
    recommendedActions: z.array(z.string()),
  }).optional(),
});

/**
 * Notification record
 */
export interface BreakGlassNotification {
  id: string;
  channel: 'email' | 'slack' | 'sms' | 'phone' | 'pagerduty';
  target: string;
  sentAt: Date;
  success: boolean;
  error?: string;
}

/**
 * Post-incident review
 */
export interface BreakGlassReview {
  reviewedAt: Date;
  reviewedBy: string;
  approved: boolean;
  findings: string;
  recommendedActions: string[];
}

/**
 * Full audit trail for a break-glass session
 */
export interface BreakGlassAudit {
  /** The session details */
  session: BreakGlassSession;
  /** User's break-glass usage this month */
  monthlyUsageCount: number;
  /** Timeline of all events */
  timeline: BreakGlassAuditEvent[];
  /** Compliance export data */
  complianceExport: BreakGlassComplianceExport;
}

/**
 * Audit event
 */
export interface BreakGlassAuditEvent {
  timestamp: Date;
  eventType: string;
  actor: string;
  details: Record<string, unknown>;
}

/**
 * Compliance export format
 */
export interface BreakGlassComplianceExport {
  exportedAt: Date;
  sessionId: string;
  userId: string;
  reason: string;
  scope: BreakGlassScope;
  startTime: string;
  endTime: string;
  duration: number;
  actionsCount: number;
  resourcesAccessed: string[];
  incidentId?: string;
  reviewStatus: string;
  reviewFindings?: string;
  hashChain: string;
}

/**
 * MFA verification input
 */
export interface MfaVerificationInput {
  method: VerificationMethod;
  code?: string;
  challengeId?: string;
}

/**
 * Phone callback verification
 */
export interface PhoneCallbackInput {
  phoneNumber: string;
  callbackCode: string;
}

/**
 * Service dependencies
 */
export interface BreakGlassServiceDependencies {
  /** Notification service for alerts */
  notificationService?: NotificationServiceInterface;
  /** MFA service for verification */
  mfaService?: MfaServiceInterface;
  /** Incident management service */
  incidentService?: IncidentServiceInterface;
  /** Audit logger */
  auditLogger?: AuditLoggerInterface;
  /** Compliance export service */
  complianceExporter?: ComplianceExporterInterface;
}

/**
 * Service configuration
 */
export interface BreakGlassServiceConfig {
  /** Maximum session duration in milliseconds */
  maxSessionDurationMs?: number;
  /** Maximum uses per user per month */
  maxUsesPerMonth?: number;
  /** Review deadline in milliseconds */
  reviewDeadlineMs?: number;
  /** Require phone callback for full scope */
  requirePhoneCallbackForFullScope?: boolean;
  /** Security admin user IDs for notifications */
  securityAdminIds?: string[];
  /** CISO contact for SMS/phone alerts */
  cisoContact?: {
    userId: string;
    phone: string;
    email: string;
  };
  /** Slack webhook for alerts */
  slackWebhookUrl?: string;
  /** PagerDuty routing key */
  pagerDutyRoutingKey?: string;
}

// =============================================================================
// Interfaces for Dependencies
// =============================================================================

interface NotificationServiceInterface {
  sendSlack(webhookUrl: string, message: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  sendEmail(to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }>;
  sendSms(phone: string, message: string): Promise<{ success: boolean; error?: string }>;
  sendPagerDuty(routingKey: string, payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  initiatePhoneCallback(phone: string, code: string): Promise<{ success: boolean; error?: string }>;
}

interface MfaServiceInterface {
  verifyTotp(userId: string, code: string): Promise<boolean>;
  verifyBackupCode(userId: string, code: string): Promise<boolean>;
  verifyHardwareToken(userId: string, assertion: string): Promise<boolean>;
}

interface IncidentServiceInterface {
  createIncident(input: {
    title: string;
    description: string;
    severity: string;
    type: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  linkToIncident(incidentId: string, sessionId: string): Promise<void>;
}

interface AuditLoggerInterface {
  log(event: {
    eventType: string;
    actor: { type: string; id: string; ip?: string };
    action: string;
    resource: { type: string; id: string };
    outcome: 'success' | 'failure' | 'blocked';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

interface ComplianceExporterInterface {
  export(data: BreakGlassComplianceExport): Promise<void>;
}

// =============================================================================
// Break-Glass Service
// =============================================================================

/**
 * Break-Glass Emergency Access Service
 *
 * Provides controlled emergency access for critical situations with
 * comprehensive auditing and safety controls.
 */
export class BreakGlassService {
  private sessions: Map<string, BreakGlassSession> = new Map();
  private userMonthlyUsage: Map<string, { month: string; count: number }> = new Map();
  private pendingVerifications: Map<string, {
    sessionId: string;
    phoneCallbackCode?: string;
    expiresAt: Date;
  }> = new Map();
  private expirationTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly config: Required<BreakGlassServiceConfig>;
  private readonly notificationService?: NotificationServiceInterface;
  private readonly mfaService?: MfaServiceInterface;
  private readonly incidentService?: IncidentServiceInterface;
  private readonly auditLogger?: AuditLoggerInterface;
  private readonly complianceExporter?: ComplianceExporterInterface;

  constructor(
    config: BreakGlassServiceConfig = {},
    deps: BreakGlassServiceDependencies = {}
  ) {
    this.config = {
      maxSessionDurationMs: config.maxSessionDurationMs ?? MAX_SESSION_DURATION_MS,
      maxUsesPerMonth: config.maxUsesPerMonth ?? MAX_USES_PER_MONTH,
      reviewDeadlineMs: config.reviewDeadlineMs ?? REVIEW_DEADLINE_MS,
      requirePhoneCallbackForFullScope: config.requirePhoneCallbackForFullScope ?? true,
      securityAdminIds: config.securityAdminIds ?? [],
      cisoContact: config.cisoContact ?? { userId: '', phone: '', email: '' },
      slackWebhookUrl: config.slackWebhookUrl ?? '',
      pagerDutyRoutingKey: config.pagerDutyRoutingKey ?? '',
    };

    this.notificationService = deps.notificationService;
    this.mfaService = deps.mfaService;
    this.incidentService = deps.incidentService;
    this.auditLogger = deps.auditLogger;
    this.complianceExporter = deps.complianceExporter;

    logger.info('BreakGlassService initialized', {
      maxSessionDuration: this.config.maxSessionDurationMs,
      maxUsesPerMonth: this.config.maxUsesPerMonth,
      requirePhoneCallbackForFullScope: this.config.requirePhoneCallbackForFullScope,
    });
  }

  // ===========================================================================
  // Core Methods
  // ===========================================================================

  /**
   * Initiate a break-glass emergency access request
   *
   * This creates a pending session that requires verification before activation.
   * All security admins are immediately notified.
   */
  async initiateBreakGlass(request: BreakGlassRequest): Promise<BreakGlassSession> {
    // Validate request
    const validated = breakGlassRequestSchema.parse(request);

    // Check monthly usage limit
    const monthlyUsage = this.getMonthlyUsage(validated.userId);
    if (monthlyUsage >= this.config.maxUsesPerMonth) {
      breakGlassActivations.inc({ scope: validated.scope, outcome: 'limit_exceeded' });
      await this.auditLog('BREAK_GLASS_LIMIT_EXCEEDED', validated.userId, {
        monthlyUsage,
        maxAllowed: this.config.maxUsesPerMonth,
      });
      throw new BreakGlassError(
        'MONTHLY_LIMIT_EXCEEDED',
        `User has exceeded the maximum ${this.config.maxUsesPerMonth} break-glass uses this month`
      );
    }

    // Create session in pending state
    const now = new Date();
    const sessionId = uuidv4();
    const session: BreakGlassSession = {
      id: sessionId,
      userId: validated.userId,
      reason: validated.reason,
      incidentId: validated.incidentId,
      scope: validated.scope,
      resources: validated.resources,
      status: BreakGlassStatus.PENDING_VERIFICATION,
      startedAt: now,
      expiresAt: new Date(now.getTime() + this.config.maxSessionDurationMs),
      renewed: false,
      actions: [],
      requiresPostReview: true,
      verificationMethods: [],
      activationIp: validated.ipAddress,
      deviceFingerprint: validated.deviceFingerprint,
      notificationsSent: [],
    };

    this.sessions.set(sessionId, session);

    // Generate phone callback code if needed
    if (validated.scope === 'full' && this.config.requirePhoneCallbackForFullScope) {
      const callbackCode = this.generateCallbackCode();
      this.pendingVerifications.set(sessionId, {
        sessionId,
        phoneCallbackCode: callbackCode,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 minutes
      });
    }

    // Immediately notify all security admins
    await this.notifyAllSecurityAdmins(session, 'initiated');

    // Alert CISO via SMS/phone for critical access
    if (validated.scope === 'full') {
      await this.alertCiso(session);
    }

    // Auto-create incident if none linked
    if (!validated.incidentId && this.incidentService) {
      try {
        const incident = await this.incidentService.createIncident({
          title: `Break-Glass Access: ${validated.userId}`,
          description: validated.reason,
          severity: validated.scope === 'full' ? 'P1' : 'P2',
          type: 'unauthorized_access',
          metadata: { breakGlassSessionId: sessionId },
        });
        session.incidentId = incident.id;
        logger.info('Auto-created incident for break-glass', { sessionId, incidentId: incident.id });
      } catch (error) {
        logger.error('Failed to auto-create incident', { sessionId, error });
      }
    }

    await this.auditLog('BREAK_GLASS_INITIATED', validated.userId, {
      sessionId,
      scope: validated.scope,
      reason: validated.reason,
      incidentId: session.incidentId,
      ipAddress: validated.ipAddress,
    });

    logger.warn('Break-glass access initiated', {
      sessionId,
      userId: validated.userId,
      scope: validated.scope,
      reason: validated.reason,
    });

    return session;
  }

  /**
   * Verify MFA for break-glass activation
   */
  async verifyMfa(
    sessionId: string,
    verification: MfaVerificationInput
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.PENDING_VERIFICATION) {
      throw new BreakGlassError('INVALID_STATE', 'Session is not pending verification');
    }

    if (!this.mfaService) {
      logger.warn('MFA service not configured, skipping verification');
      session.verificationMethods.push(verification.method);
      return true;
    }

    let verified = false;

    switch (verification.method) {
      case VerificationMethod.MFA_TOTP:
        verified = await this.mfaService.verifyTotp(session.userId, verification.code ?? '');
        break;
      case VerificationMethod.MFA_BACKUP_CODE:
        verified = await this.mfaService.verifyBackupCode(session.userId, verification.code ?? '');
        break;
      case VerificationMethod.HARDWARE_TOKEN:
        verified = await this.mfaService.verifyHardwareToken(session.userId, verification.code ?? '');
        break;
      case VerificationMethod.PHONE_CALLBACK:
        const pending = this.pendingVerifications.get(sessionId);
        if (pending && pending.phoneCallbackCode === verification.code) {
          verified = true;
          this.pendingVerifications.delete(sessionId);
        }
        break;
    }

    if (verified) {
      session.verificationMethods.push(verification.method);
      await this.auditLog('BREAK_GLASS_MFA_VERIFIED', session.userId, {
        sessionId,
        method: verification.method,
      });
    } else {
      await this.auditLog('BREAK_GLASS_MFA_FAILED', session.userId, {
        sessionId,
        method: verification.method,
      });
    }

    return verified;
  }

  /**
   * Activate a break-glass session after verification
   */
  async activateSession(sessionId: string): Promise<BreakGlassSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.PENDING_VERIFICATION) {
      throw new BreakGlassError('INVALID_STATE', 'Session is not pending verification');
    }

    // Verify that required verification methods are completed
    if (session.verificationMethods.length === 0) {
      throw new BreakGlassError('MFA_REQUIRED', 'At least one MFA verification is required');
    }

    // For full scope, require phone callback if configured
    if (
      session.scope === 'full' &&
      this.config.requirePhoneCallbackForFullScope &&
      !session.verificationMethods.includes(VerificationMethod.PHONE_CALLBACK)
    ) {
      throw new BreakGlassError(
        'PHONE_CALLBACK_REQUIRED',
        'Phone callback verification required for full scope access'
      );
    }

    // Activate the session
    const now = new Date();
    session.status = BreakGlassStatus.ACTIVE;
    session.startedAt = now;
    session.expiresAt = new Date(now.getTime() + this.config.maxSessionDurationMs);

    // Increment monthly usage
    this.incrementMonthlyUsage(session.userId);

    // Set up expiration timer
    this.setExpirationTimer(session);

    // Update active sessions metric
    activeBreakGlassSessions.inc();
    breakGlassActivations.inc({ scope: session.scope, outcome: 'success' });

    // Notify all security admins of activation
    await this.notifyAllSecurityAdmins(session, 'activated');

    await this.auditLog('BREAK_GLASS_ACTIVATED', session.userId, {
      sessionId,
      scope: session.scope,
      expiresAt: session.expiresAt.toISOString(),
      verificationMethods: session.verificationMethods,
    });

    logger.warn('Break-glass session activated', {
      sessionId,
      userId: session.userId,
      scope: session.scope,
      expiresAt: session.expiresAt,
    });

    return session;
  }

  /**
   * Validate if a break-glass session is currently valid
   */
  async validateBreakGlass(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check if active
    if (session.status !== BreakGlassStatus.ACTIVE) {
      return false;
    }

    // Check if expired
    if (new Date() >= session.expiresAt) {
      await this.expireSession(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Revoke a break-glass session
   */
  async revokeBreakGlass(sessionId: string, revokedBy: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.ACTIVE && session.status !== BreakGlassStatus.PENDING_VERIFICATION) {
      throw new BreakGlassError('INVALID_STATE', 'Session cannot be revoked in current state');
    }

    const now = new Date();
    const wasActive = session.status === BreakGlassStatus.ACTIVE;

    session.status = BreakGlassStatus.REVOKED;
    session.endedAt = now;
    session.revokedBy = revokedBy;
    session.revocationReason = reason;

    // Clear expiration timer
    this.clearExpirationTimer(sessionId);

    // Update metrics
    if (wasActive) {
      activeBreakGlassSessions.dec();
      const durationSeconds = (now.getTime() - session.startedAt.getTime()) / 1000;
      breakGlassSessionDuration.observe(durationSeconds);
    }
    breakGlassRevocations.inc({ reason: reason ? 'manual' : 'unspecified' });

    // Transition to review pending
    session.status = BreakGlassStatus.REVIEW_PENDING;

    // Notify all security admins
    await this.notifyAllSecurityAdmins(session, 'revoked');

    // Export to compliance
    await this.exportToCompliance(session);

    await this.auditLog('BREAK_GLASS_REVOKED', revokedBy, {
      sessionId,
      userId: session.userId,
      reason,
      duration: wasActive ? now.getTime() - session.startedAt.getTime() : 0,
      actionsCount: session.actions.length,
    });

    logger.warn('Break-glass session revoked', {
      sessionId,
      userId: session.userId,
      revokedBy,
      reason,
    });
  }

  /**
   * Get all currently active break-glass sessions
   */
  async getActiveBreakGlass(): Promise<BreakGlassSession[]> {
    const activeSessions: BreakGlassSession[] = [];
    const sessions = Array.from(this.sessions.values());

    for (const session of sessions) {
      if (session.status === BreakGlassStatus.ACTIVE) {
        // Verify it hasn't expired
        if (new Date() < session.expiresAt) {
          activeSessions.push(session);
        } else {
          await this.expireSession(session.id);
        }
      }
    }

    return activeSessions;
  }

  /**
   * Get full audit trail for a break-glass session
   */
  async auditBreakGlass(sessionId: string): Promise<BreakGlassAudit> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    // Build timeline from session events
    const timeline: BreakGlassAuditEvent[] = [
      {
        timestamp: session.startedAt,
        eventType: 'SESSION_INITIATED',
        actor: session.userId,
        details: {
          scope: session.scope,
          reason: session.reason,
          resources: session.resources,
        },
      },
    ];

    // Add verification events
    for (const method of session.verificationMethods) {
      timeline.push({
        timestamp: session.startedAt,
        eventType: 'MFA_VERIFIED',
        actor: session.userId,
        details: { method },
      });
    }

    // Add notification events
    for (const notification of session.notificationsSent) {
      timeline.push({
        timestamp: notification.sentAt,
        eventType: 'NOTIFICATION_SENT',
        actor: 'system',
        details: {
          channel: notification.channel,
          target: notification.target,
          success: notification.success,
        },
      });
    }

    // Add action events
    for (const action of session.actions) {
      timeline.push({
        timestamp: action.timestamp,
        eventType: 'ACTION_PERFORMED',
        actor: session.userId,
        details: {
          type: action.type,
          method: action.method,
          path: action.path,
          resourceId: action.resourceId,
        },
      });
    }

    // Add end event if session ended
    if (session.endedAt) {
      timeline.push({
        timestamp: session.endedAt,
        eventType: session.status === BreakGlassStatus.REVOKED ? 'SESSION_REVOKED' : 'SESSION_EXPIRED',
        actor: session.revokedBy ?? 'system',
        details: {
          reason: session.revocationReason,
        },
      });
    }

    // Sort timeline by timestamp
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Build compliance export
    const complianceExport = this.buildComplianceExport(session);

    return {
      session,
      monthlyUsageCount: this.getMonthlyUsage(session.userId),
      timeline,
      complianceExport,
    };
  }

  /**
   * Record an action performed during a break-glass session
   */
  async recordAction(sessionId: string, action: Omit<BreakGlassAction, 'id' | 'timestamp'>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.ACTIVE) {
      throw new BreakGlassError('SESSION_NOT_ACTIVE', 'Break-glass session is not active');
    }

    const fullAction: BreakGlassAction = {
      ...action,
      id: uuidv4(),
      timestamp: new Date(),
    };

    session.actions.push(fullAction);
    breakGlassActionsDuringSession.inc({ action_type: action.type });

    await this.auditLog('BREAK_GLASS_ACTION', session.userId, {
      sessionId,
      actionId: fullAction.id,
      type: action.type,
      method: action.method,
      path: action.path,
      resourceId: action.resourceId,
    });
  }

  /**
   * Renew a break-glass session (can only be done once)
   */
  async renewSession(sessionId: string, reason: string): Promise<BreakGlassSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.ACTIVE) {
      throw new BreakGlassError('SESSION_NOT_ACTIVE', 'Session is not active');
    }

    if (session.renewed) {
      throw new BreakGlassError('ALREADY_RENEWED', 'Session has already been renewed once');
    }

    // Extend expiration
    session.expiresAt = new Date(session.expiresAt.getTime() + RENEWAL_DURATION_MS);
    session.renewed = true;

    // Reset expiration timer
    this.clearExpirationTimer(sessionId);
    this.setExpirationTimer(session);

    // Notify security admins
    await this.notifyAllSecurityAdmins(session, 'renewed');

    await this.auditLog('BREAK_GLASS_RENEWED', session.userId, {
      sessionId,
      reason,
      newExpiresAt: session.expiresAt.toISOString(),
    });

    logger.warn('Break-glass session renewed', {
      sessionId,
      userId: session.userId,
      reason,
      newExpiresAt: session.expiresAt,
    });

    return session;
  }

  /**
   * Submit post-incident review for a break-glass session
   */
  async submitReview(
    sessionId: string,
    reviewedBy: string,
    review: Omit<BreakGlassReview, 'reviewedAt' | 'reviewedBy'>
  ): Promise<BreakGlassSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BreakGlassError('SESSION_NOT_FOUND', 'Break-glass session not found');
    }

    if (session.status !== BreakGlassStatus.REVIEW_PENDING) {
      throw new BreakGlassError('INVALID_STATE', 'Session is not pending review');
    }

    session.review = {
      ...review,
      reviewedAt: new Date(),
      reviewedBy,
    };
    session.status = BreakGlassStatus.REVIEWED;

    // Export final compliance record
    await this.exportToCompliance(session);

    await this.auditLog('BREAK_GLASS_REVIEWED', reviewedBy, {
      sessionId,
      approved: review.approved,
      findings: review.findings,
      recommendedActions: review.recommendedActions,
    });

    logger.info('Break-glass review submitted', {
      sessionId,
      reviewedBy,
      approved: review.approved,
    });

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): BreakGlassSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get sessions pending review
   */
  getPendingReviews(): BreakGlassSession[] {
    const pending: BreakGlassSession[] = [];
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      if (session.status === BreakGlassStatus.REVIEW_PENDING) {
        pending.push(session);
      }
    }
    return pending;
  }

  /**
   * Check if a resource is accessible under a break-glass session
   */
  isResourceAccessible(sessionId: string, resourceId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== BreakGlassStatus.ACTIVE) {
      return false;
    }

    // Full scope grants access to all resources
    if (session.scope === 'full') {
      return true;
    }

    // Limited scope - check if resource is in allowed list
    return session.resources?.includes(resourceId) ?? false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async expireSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== BreakGlassStatus.ACTIVE) {
      return;
    }

    const now = new Date();
    session.status = BreakGlassStatus.EXPIRED;
    session.endedAt = now;

    // Clear expiration timer
    this.clearExpirationTimer(sessionId);

    // Update metrics
    activeBreakGlassSessions.dec();
    const durationSeconds = (now.getTime() - session.startedAt.getTime()) / 1000;
    breakGlassSessionDuration.observe(durationSeconds);
    breakGlassRevocations.inc({ reason: 'expired' });

    // Transition to review pending
    session.status = BreakGlassStatus.REVIEW_PENDING;

    // Notify security admins
    await this.notifyAllSecurityAdmins(session, 'expired');

    // Export to compliance
    await this.exportToCompliance(session);

    await this.auditLog('BREAK_GLASS_EXPIRED', 'system', {
      sessionId,
      userId: session.userId,
      duration: now.getTime() - session.startedAt.getTime(),
      actionsCount: session.actions.length,
    });

    logger.warn('Break-glass session expired', {
      sessionId,
      userId: session.userId,
    });
  }

  private setExpirationTimer(session: BreakGlassSession): void {
    const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
    if (timeUntilExpiry > 0) {
      const timer = setTimeout(() => {
        this.expireSession(session.id).catch((error) => {
          logger.error('Error expiring session', { sessionId: session.id, error });
        });
      }, timeUntilExpiry);
      this.expirationTimers.set(session.id, timer);
    }
  }

  private clearExpirationTimer(sessionId: string): void {
    const timer = this.expirationTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.expirationTimers.delete(sessionId);
    }
  }

  private getMonthlyUsage(userId: string): number {
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    const usage = this.userMonthlyUsage.get(userId);
    if (usage && usage.month === currentMonth) {
      return usage.count;
    }
    return 0;
  }

  private incrementMonthlyUsage(userId: string): void {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const usage = this.userMonthlyUsage.get(userId);
    if (usage && usage.month === currentMonth) {
      usage.count++;
    } else {
      this.userMonthlyUsage.set(userId, { month: currentMonth, count: 1 });
    }
  }

  private generateCallbackCode(): string {
    // Generate a 6-digit numeric code
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async notifyAllSecurityAdmins(
    session: BreakGlassSession,
    event: 'initiated' | 'activated' | 'revoked' | 'expired' | 'renewed'
  ): Promise<void> {
    const eventMessages: Record<string, string> = {
      initiated: 'BREAK-GLASS ACCESS INITIATED',
      activated: 'BREAK-GLASS ACCESS ACTIVATED',
      revoked: 'BREAK-GLASS ACCESS REVOKED',
      expired: 'BREAK-GLASS ACCESS EXPIRED',
      renewed: 'BREAK-GLASS ACCESS RENEWED',
    };

    const message = {
      event: eventMessages[event],
      sessionId: session.id,
      userId: session.userId,
      scope: session.scope,
      reason: session.reason,
      incidentId: session.incidentId,
      timestamp: new Date().toISOString(),
      resources: session.resources,
      actionsCount: session.actions.length,
    };

    // Send Slack notification
    if (this.notificationService && this.config.slackWebhookUrl) {
      try {
        const result = await this.notificationService.sendSlack(this.config.slackWebhookUrl, {
          text: `[${event.toUpperCase()}] Break-Glass Access`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: eventMessages[event] },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*User:*\n${session.userId}` },
                { type: 'mrkdwn', text: `*Scope:*\n${session.scope}` },
                { type: 'mrkdwn', text: `*Session ID:*\n${session.id}` },
                { type: 'mrkdwn', text: `*Incident:*\n${session.incidentId ?? 'N/A'}` },
              ],
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Reason:*\n${session.reason}` },
            },
          ],
        });
        session.notificationsSent.push({
          id: uuidv4(),
          channel: 'slack',
          target: this.config.slackWebhookUrl,
          sentAt: new Date(),
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        logger.error('Failed to send Slack notification', { sessionId: session.id, error });
      }
    }

    // Send PagerDuty alert
    if (this.notificationService && this.config.pagerDutyRoutingKey && event === 'activated') {
      try {
        const result = await this.notificationService.sendPagerDuty(this.config.pagerDutyRoutingKey, {
          routing_key: this.config.pagerDutyRoutingKey,
          event_action: 'trigger',
          dedup_key: `break-glass-${session.id}`,
          payload: {
            summary: `Break-Glass Access Activated: ${session.userId}`,
            source: 'vorion-break-glass',
            severity: session.scope === 'full' ? 'critical' : 'warning',
            custom_details: message,
          },
        });
        session.notificationsSent.push({
          id: uuidv4(),
          channel: 'pagerduty',
          target: 'pagerduty',
          sentAt: new Date(),
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        logger.error('Failed to send PagerDuty alert', { sessionId: session.id, error });
      }
    }

    // Email security admins
    if (this.notificationService) {
      for (const adminId of this.config.securityAdminIds) {
        try {
          const result = await this.notificationService.sendEmail(
            adminId,
            `[ALERT] ${eventMessages[event]} - ${session.userId}`,
            JSON.stringify(message, null, 2)
          );
          session.notificationsSent.push({
            id: uuidv4(),
            channel: 'email',
            target: adminId,
            sentAt: new Date(),
            success: result.success,
            error: result.error,
          });
        } catch (error) {
          logger.error('Failed to email security admin', { sessionId: session.id, adminId, error });
        }
      }
    }
  }

  private async alertCiso(session: BreakGlassSession): Promise<void> {
    if (!this.notificationService || !this.config.cisoContact.phone) {
      return;
    }

    // Send SMS
    try {
      const message = `BREAK-GLASS ALERT: ${session.userId} initiated ${session.scope} scope access. Session: ${session.id}. Reason: ${session.reason.substring(0, 100)}`;
      const result = await this.notificationService.sendSms(this.config.cisoContact.phone, message);
      session.notificationsSent.push({
        id: uuidv4(),
        channel: 'sms',
        target: this.config.cisoContact.phone,
        sentAt: new Date(),
        success: result.success,
        error: result.error,
      });
    } catch (error) {
      logger.error('Failed to send SMS to CISO', { sessionId: session.id, error });
    }

    // Initiate phone callback if full scope
    if (session.scope === 'full') {
      const pending = this.pendingVerifications.get(session.id);
      if (pending?.phoneCallbackCode) {
        try {
          const result = await this.notificationService.initiatePhoneCallback(
            this.config.cisoContact.phone,
            pending.phoneCallbackCode
          );
          session.notificationsSent.push({
            id: uuidv4(),
            channel: 'phone',
            target: this.config.cisoContact.phone,
            sentAt: new Date(),
            success: result.success,
            error: result.error,
          });
        } catch (error) {
          logger.error('Failed to initiate phone callback', { sessionId: session.id, error });
        }
      }
    }
  }

  private async auditLog(
    eventType: string,
    actor: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (this.auditLogger) {
      try {
        await this.auditLogger.log({
          eventType,
          actor: { type: 'user', id: actor },
          action: eventType.toLowerCase(),
          resource: { type: 'break_glass', id: metadata.sessionId as string ?? 'unknown' },
          outcome: 'success',
          metadata,
        });
      } catch (error) {
        logger.error('Failed to write audit log', { eventType, error });
      }
    }

    // Always log to console for break-glass events
    logger.warn(`Audit: ${eventType}`, { actor, ...metadata });
  }

  private buildComplianceExport(session: BreakGlassSession): BreakGlassComplianceExport {
    const resourcesAccessed = new Set<string>();
    for (const action of session.actions) {
      if (action.resourceId) {
        resourcesAccessed.add(action.resourceId);
      }
      if (action.path) {
        resourcesAccessed.add(action.path);
      }
    }

    // Build hash chain from actions
    const hashChain = this.computeHashChain(session);

    return {
      exportedAt: new Date(),
      sessionId: session.id,
      userId: session.userId,
      reason: session.reason,
      scope: session.scope,
      startTime: session.startedAt.toISOString(),
      endTime: (session.endedAt ?? session.expiresAt).toISOString(),
      duration: (session.endedAt ?? new Date()).getTime() - session.startedAt.getTime(),
      actionsCount: session.actions.length,
      resourcesAccessed: Array.from(resourcesAccessed),
      incidentId: session.incidentId,
      reviewStatus: session.review ? (session.review.approved ? 'approved' : 'flagged') : 'pending',
      reviewFindings: session.review?.findings,
      hashChain,
    };
  }

  private computeHashChain(session: BreakGlassSession): string {
    const crypto = require('crypto');
    let hash = crypto.createHash('sha256')
      .update(`${session.id}:${session.startedAt.toISOString()}:${session.userId}`)
      .digest('hex');

    for (const action of session.actions) {
      hash = crypto.createHash('sha256')
        .update(`${hash}:${action.id}:${action.timestamp.toISOString()}:${action.type}`)
        .digest('hex');
    }

    return hash;
  }

  private async exportToCompliance(session: BreakGlassSession): Promise<void> {
    if (this.complianceExporter) {
      const exportData = this.buildComplianceExport(session);
      try {
        await this.complianceExporter.export(exportData);
        logger.info('Exported break-glass session to compliance', { sessionId: session.id });
      } catch (error) {
        logger.error('Failed to export to compliance', { sessionId: session.id, error });
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear all expiration timers
    const timers = Array.from(this.expirationTimers.entries());
    for (const [_sessionId, timer] of timers) {
      clearTimeout(timer);
    }
    this.expirationTimers.clear();
    logger.info('BreakGlassService destroyed');
  }
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Break-glass specific error
 */
export class BreakGlassError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BreakGlassError';
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Middleware options for break-glass route protection
 */
export interface AllowBreakGlassOptions {
  /** Break-glass service instance */
  service: BreakGlassService;
  /** Header name for session ID (default: 'x-break-glass-session') */
  sessionHeader?: string;
  /** Require specific scope for this route */
  requiredScope?: BreakGlassScope;
  /** Specific resource ID for limited scope validation */
  resourceId?: string | ((request: FastifyRequest) => string);
}

/**
 * Create middleware that allows break-glass sessions to override normal authorization
 *
 * This middleware should be added to protected routes that need to support
 * emergency access. It checks for a valid break-glass session and records
 * all actions performed during the session.
 *
 * @example
 * ```typescript
 * fastify.route({
 *   method: 'POST',
 *   url: '/admin/critical-action',
 *   preHandler: [
 *     normalAuthMiddleware,
 *     allowBreakGlass({ service: breakGlassService }),
 *   ],
 *   handler: handleCriticalAction,
 * });
 * ```
 */
export function allowBreakGlass(options: AllowBreakGlassOptions): preHandlerHookHandler {
  const sessionHeader = options.sessionHeader ?? 'x-break-glass-session';

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sessionId = request.headers[sessionHeader] as string | undefined;

    if (!sessionId) {
      // No break-glass session, proceed with normal authorization
      return;
    }

    const startTime = Date.now();

    // Validate the session
    const isValid = await options.service.validateBreakGlass(sessionId);
    if (!isValid) {
      logger.warn('Invalid break-glass session attempted', {
        sessionId,
        ip: request.ip,
        path: request.url,
      });
      return reply.status(403).send({
        error: {
          code: 'INVALID_BREAK_GLASS_SESSION',
          message: 'Break-glass session is invalid or expired',
        },
      });
    }

    const session = options.service.getSession(sessionId);
    if (!session) {
      return reply.status(403).send({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Break-glass session not found',
        },
      });
    }

    // Check scope if required
    if (options.requiredScope && session.scope !== 'full' && session.scope !== options.requiredScope) {
      logger.warn('Break-glass session scope insufficient', {
        sessionId,
        required: options.requiredScope,
        actual: session.scope,
      });
      return reply.status(403).send({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `Break-glass session requires ${options.requiredScope} scope`,
        },
      });
    }

    // Check resource access for limited scope
    if (options.resourceId && session.scope === 'limited') {
      const resourceId = typeof options.resourceId === 'function'
        ? options.resourceId(request)
        : options.resourceId;

      if (!options.service.isResourceAccessible(sessionId, resourceId)) {
        logger.warn('Break-glass session does not have access to resource', {
          sessionId,
          resourceId,
        });
        return reply.status(403).send({
          error: {
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message: 'Break-glass session does not have access to this resource',
          },
        });
      }
    }

    // Compute request body hash for audit
    let requestBodyHash: string | undefined;
    if (request.body) {
      const crypto = require('crypto');
      requestBodyHash = crypto.createHash('sha256')
        .update(JSON.stringify(request.body))
        .digest('hex')
        .substring(0, 16);
    }

    // Decorate request with break-glass context
    (request as FastifyRequest & { breakGlassSession?: BreakGlassSession }).breakGlassSession = session;

    // Record the action - we do this synchronously in the preHandler
    // since Fastify reply hooks have different signatures
    const recordActionAsync = async (): Promise<void> => {
      const durationMs = Date.now() - startTime;

      await options.service.recordAction(sessionId, {
        type: 'http_request',
        method: request.method,
        path: request.url,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestBodyHash,
        responseStatus: reply.statusCode,
        durationMs,
        metadata: {
          routeOptions: request.routeOptions?.url,
          params: request.params,
          query: request.query,
        },
      });
    };

    // Use reply.then to record after response is sent
    reply.then(recordActionAsync, (error: Error) => {
      logger.error('Error recording break-glass action', { sessionId, error });
    });

    logger.info('Break-glass access granted', {
      sessionId,
      userId: session.userId,
      method: request.method,
      path: request.url,
    });

    // Skip normal authorization - break-glass grants access
    // This is indicated by not returning a 4xx error
  };
}

// =============================================================================
// Factory & Exports
// =============================================================================

/**
 * Create a new break-glass service instance
 */
export function createBreakGlassService(
  config?: BreakGlassServiceConfig,
  deps?: BreakGlassServiceDependencies
): BreakGlassService {
  return new BreakGlassService(config, deps);
}

// Extend FastifyRequest type
declare module 'fastify' {
  interface FastifyRequest {
    breakGlassSession?: BreakGlassSession;
  }
}
