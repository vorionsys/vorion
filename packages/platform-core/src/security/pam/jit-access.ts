/**
 * Privileged Access Management (PAM) - Just-In-Time Access
 *
 * Provides time-limited privilege elevation with:
 * - Request-based elevation workflow
 * - Multi-approver support
 * - Automatic session expiration
 * - Full audit trail
 * - Alerting integration
 * - Escalation for SLA breaches
 *
 * @packageDocumentation
 * @module security/pam/jit-access
 */

import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { createLogger } from '../../common/logger.js';
import { getRedis } from '../../common/redis.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../../audit/security-logger.js';
import type { SecurityActor, SecurityResource } from '../../audit/security-events.js';
import {
  SecurityAlertService,
  getSecurityAlertService,
} from '../alerting/service.js';
import { AlertSeverity, SecurityEventType } from '../alerting/types.js';

const logger = createLogger({ component: 'jit-access' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefixes */
const KEY_PREFIX = {
  TICKET: 'vorion:pam:ticket:',
  SESSION: 'vorion:pam:session:',
  USER_TICKETS: 'vorion:pam:user:tickets:',
  USER_SESSIONS: 'vorion:pam:user:sessions:',
  RESOURCE_SESSIONS: 'vorion:pam:resource:sessions:',
  AUDIT: 'vorion:pam:audit:',
  ESCALATION: 'vorion:pam:escalation:',
} as const;

/** Maximum elevation duration in minutes (8 hours) */
const MAX_ELEVATION_DURATION_MINUTES = 480;

/** Pending ticket expiration in seconds (1 hour) */
const PENDING_TICKET_TTL_SECONDS = 3600;

/** Default SLA for approval in minutes by urgency */
const APPROVAL_SLA_MINUTES: Record<ElevationUrgency, number> = {
  low: 60,
  medium: 30,
  high: 15,
  critical: 5,
};

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Elevation urgency levels
 */
export const ElevationUrgencySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ElevationUrgency = z.infer<typeof ElevationUrgencySchema>;

/**
 * Ticket status
 */
export const TicketStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'expired',
  'revoked',
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/**
 * Elevation request schema
 */
export const ElevationRequestSchema = z.object({
  userId: z.string().min(1),
  resource: z.string().min(1),
  permissions: z.array(z.string().min(1)).min(1),
  reason: z.string().min(10).max(1000),
  durationMinutes: z.number().int().positive().max(MAX_ELEVATION_DURATION_MINUTES),
  urgency: ElevationUrgencySchema,
  metadata: z.record(z.unknown()).optional(),
});

export type ElevationRequest = z.infer<typeof ElevationRequestSchema>;

/**
 * Approval record schema
 */
export const ApprovalSchema = z.object({
  approverId: z.string().min(1),
  approvedAt: z.string().datetime(),
  comment: z.string().optional(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

/**
 * Elevation ticket schema
 */
export const ElevationTicketSchema = z.object({
  id: z.string().uuid(),
  status: TicketStatusSchema,
  request: ElevationRequestSchema,
  requiredApprovers: z.array(z.string().min(1)),
  requiredApprovalCount: z.number().int().positive(),
  currentApprovals: z.array(ApprovalSchema),
  deniedBy: z.string().optional(),
  deniedAt: z.string().datetime().optional(),
  denialReason: z.string().optional(),
  revokedBy: z.string().optional(),
  revokedAt: z.string().datetime().optional(),
  revocationReason: z.string().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  escalatedAt: z.string().datetime().optional(),
});

export type ElevationTicket = z.infer<typeof ElevationTicketSchema>;

/**
 * Elevated session schema
 */
export const ElevatedSessionSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  userId: z.string().min(1),
  grantedPermissions: z.array(z.string().min(1)),
  resource: z.string().min(1),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  revokedBy: z.string().optional(),
  revocationReason: z.string().optional(),
});

export type ElevatedSession = z.infer<typeof ElevatedSessionSchema>;

/**
 * Audit action schema
 */
export const AuditActionSchema = z.enum([
  'request_created',
  'approval_granted',
  'approval_denied',
  'session_started',
  'session_activity',
  'session_expired',
  'session_revoked',
  'ticket_expired',
  'ticket_escalated',
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

/**
 * PAM audit entry schema
 */
export const PAMAuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  action: AuditActionSchema,
  ticketId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  userId: z.string().min(1),
  actorId: z.string().min(1),
  resource: z.string().min(1),
  details: z.record(z.unknown()).optional(),
});

export type PAMAuditEntry = z.infer<typeof PAMAuditEntrySchema>;

// =============================================================================
// Interfaces
// =============================================================================

/**
 * JIT Access service configuration
 */
export interface JITAccessConfig {
  /** Redis key prefix override */
  keyPrefix?: string;
  /** Default required approval count */
  defaultApprovalCount?: number;
  /** SLA overrides by urgency (minutes) */
  approvalSLAMinutes?: Partial<Record<ElevationUrgency, number>>;
  /** Enable auto-escalation on SLA breach */
  enableEscalation?: boolean;
  /** Escalation check interval in milliseconds */
  escalationCheckIntervalMs?: number;
  /** Function to determine required approvers for a request */
  getApprovers?: (request: ElevationRequest) => Promise<{
    approvers: string[];
    requiredCount: number;
  }>;
  /** Function to notify approvers of new requests */
  notifyApprovers?: (ticket: ElevationTicket, approvers: string[]) => Promise<void>;
}

/**
 * Service dependencies
 */
export interface JITAccessDependencies {
  redis?: Redis;
  securityLogger?: SecurityAuditLogger;
  alertService?: SecurityAlertService;
}

// =============================================================================
// JITAccessService Class
// =============================================================================

/**
 * Just-In-Time Access Service
 *
 * Manages temporary privilege elevation with full approval workflow,
 * session management, and audit trail.
 */
export class JITAccessService {
  private readonly redis: Redis;
  private readonly securityLogger: SecurityAuditLogger;
  private readonly alertService: SecurityAlertService;
  private readonly config: Required<
    Omit<JITAccessConfig, 'getApprovers' | 'notifyApprovers'>
  > & Pick<JITAccessConfig, 'getApprovers' | 'notifyApprovers'>;

  private escalationCheckInterval: NodeJS.Timeout | null = null;
  private sessionExpirationTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    config: JITAccessConfig = {},
    deps: JITAccessDependencies = {}
  ) {
    this.redis = deps.redis ?? getRedis();
    this.securityLogger = deps.securityLogger ?? getSecurityAuditLogger();
    this.alertService = deps.alertService ?? getSecurityAlertService();

    this.config = {
      keyPrefix: config.keyPrefix ?? 'vorion:pam:',
      defaultApprovalCount: config.defaultApprovalCount ?? 1,
      approvalSLAMinutes: {
        ...APPROVAL_SLA_MINUTES,
        ...config.approvalSLAMinutes,
      },
      enableEscalation: config.enableEscalation ?? true,
      escalationCheckIntervalMs: config.escalationCheckIntervalMs ?? 60000,
      getApprovers: config.getApprovers,
      notifyApprovers: config.notifyApprovers,
    };

    // Start escalation check if enabled
    if (this.config.enableEscalation) {
      this.startEscalationCheck();
    }

    logger.info(
      {
        defaultApprovalCount: this.config.defaultApprovalCount,
        escalationEnabled: this.config.enableEscalation,
      },
      'JITAccessService initialized'
    );
  }

  // ===========================================================================
  // Public API - Elevation Requests
  // ===========================================================================

  /**
   * Request temporary privilege elevation
   *
   * Creates a new elevation ticket that requires approval before
   * privileges are granted.
   *
   * @param request - Elevation request details
   * @returns Created elevation ticket
   */
  async requestElevation(request: ElevationRequest): Promise<ElevationTicket> {
    // Validate request
    const validatedRequest = ElevationRequestSchema.parse(request);

    // Get approvers
    let approvers: string[];
    let requiredCount: number;

    if (this.config.getApprovers) {
      const result = await this.config.getApprovers(validatedRequest);
      approvers = result.approvers;
      requiredCount = result.requiredCount;
    } else {
      // Default: require system admins approval
      approvers = ['admin'];
      requiredCount = this.config.defaultApprovalCount;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PENDING_TICKET_TTL_SECONDS * 1000);

    const ticket: ElevationTicket = {
      id: crypto.randomUUID(),
      status: 'pending',
      request: validatedRequest,
      requiredApprovers: approvers,
      requiredApprovalCount: requiredCount,
      currentApprovals: [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // Store ticket
    await this.storeTicket(ticket);

    // Add to user's tickets index
    await this.redis.sadd(
      `${KEY_PREFIX.USER_TICKETS}${validatedRequest.userId}`,
      ticket.id
    );

    // Create audit entry
    await this.createAuditEntry({
      action: 'request_created',
      ticketId: ticket.id,
      userId: validatedRequest.userId,
      actorId: validatedRequest.userId,
      resource: validatedRequest.resource,
      details: {
        permissions: validatedRequest.permissions,
        durationMinutes: validatedRequest.durationMinutes,
        urgency: validatedRequest.urgency,
        requiredApprovalCount: requiredCount,
      },
    });

    // Security audit log
    const actor = this.buildActor(validatedRequest.userId);
    const resource = this.buildResource(validatedRequest.resource);
    await this.securityLogger.log({
      eventType: 'PRIVILEGE_ESCALATED',
      actor,
      action: 'request_elevation',
      resource,
      outcome: 'success',
      metadata: {
        ticketId: ticket.id,
        permissions: validatedRequest.permissions,
        durationMinutes: validatedRequest.durationMinutes,
        urgency: validatedRequest.urgency,
      },
    });

    // Send alert for elevation request
    await this.alertService.createAlert({
      severity: this.getSeverityForUrgency(validatedRequest.urgency),
      type: SecurityEventType.PRIVILEGE_ESCALATION,
      title: 'Privilege Elevation Requested',
      message: `User ${validatedRequest.userId} requested ${validatedRequest.permissions.join(', ')} access to ${validatedRequest.resource}. Reason: ${validatedRequest.reason}`,
      context: {
        userId: validatedRequest.userId,
        resource: validatedRequest.resource,
        metadata: {
          ticketId: ticket.id,
          urgency: validatedRequest.urgency,
        },
      },
      source: 'pam-jit-access',
      suggestedActions: [
        'Review the elevation request',
        'Verify user identity and need',
        'Approve or deny within SLA',
      ],
      tags: ['pam', 'elevation-request', validatedRequest.urgency],
    });

    // Notify approvers
    if (this.config.notifyApprovers) {
      await this.config.notifyApprovers(ticket, approvers);
    }

    logger.info(
      {
        ticketId: ticket.id,
        userId: validatedRequest.userId,
        resource: validatedRequest.resource,
        urgency: validatedRequest.urgency,
        requiredApprovers: approvers,
      },
      'Elevation request created'
    );

    return ticket;
  }

  /**
   * Approve an elevation request
   *
   * Adds an approval to the ticket. If sufficient approvals are reached,
   * creates an elevated session.
   *
   * @param ticketId - Ticket to approve
   * @param approverId - ID of the approving user
   * @param comment - Optional approval comment
   * @returns Created elevated session if approval threshold met
   */
  async approveElevation(
    ticketId: string,
    approverId: string,
    comment?: string
  ): Promise<ElevatedSession> {
    const ticket = await this.getTicket(ticketId);

    if (!ticket) {
      throw new ElevationError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
    }

    if (ticket.status !== 'pending') {
      throw new ElevationError(
        'INVALID_TICKET_STATUS',
        `Ticket is ${ticket.status}, cannot approve`
      );
    }

    // Check if approver is authorized
    if (!ticket.requiredApprovers.includes(approverId)) {
      throw new ElevationError(
        'UNAUTHORIZED_APPROVER',
        `User ${approverId} is not authorized to approve this ticket`
      );
    }

    // Check if already approved by this user
    if (ticket.currentApprovals.some((a) => a.approverId === approverId)) {
      throw new ElevationError(
        'ALREADY_APPROVED',
        `User ${approverId} has already approved this ticket`
      );
    }

    // Add approval
    const approval: Approval = {
      approverId,
      approvedAt: new Date().toISOString(),
      comment,
    };

    ticket.currentApprovals.push(approval);

    // Create audit entry
    await this.createAuditEntry({
      action: 'approval_granted',
      ticketId: ticket.id,
      userId: ticket.request.userId,
      actorId: approverId,
      resource: ticket.request.resource,
      details: { comment, approvalCount: ticket.currentApprovals.length },
    });

    // Check if we have enough approvals
    if (ticket.currentApprovals.length >= ticket.requiredApprovalCount) {
      ticket.status = 'approved';

      // Create elevated session
      const session = await this.createElevatedSession(ticket);

      // Update ticket
      await this.storeTicket(ticket);

      // Security audit log
      const actor = this.buildActor(approverId);
      const resource = this.buildResource(ticket.request.resource);
      await this.securityLogger.log({
        eventType: 'PRIVILEGE_ESCALATED',
        actor,
        action: 'approve_elevation',
        resource,
        outcome: 'success',
        metadata: {
          ticketId: ticket.id,
          sessionId: session.id,
          grantedPermissions: session.grantedPermissions,
        },
      });

      // Send alert for approved elevation
      await this.alertService.createAlert({
        severity: AlertSeverity.MEDIUM,
        type: SecurityEventType.ADMIN_ACTION,
        title: 'Privilege Elevation Approved',
        message: `Elevation request for ${ticket.request.userId} to access ${ticket.request.resource} has been approved. Session expires at ${session.expiresAt}`,
        context: {
          userId: ticket.request.userId,
          resource: ticket.request.resource,
          metadata: {
            ticketId: ticket.id,
            sessionId: session.id,
            approverId,
          },
        },
        source: 'pam-jit-access',
        tags: ['pam', 'elevation-approved'],
      });

      logger.info(
        {
          ticketId: ticket.id,
          sessionId: session.id,
          userId: ticket.request.userId,
          resource: ticket.request.resource,
          approverId,
        },
        'Elevation approved and session created'
      );

      return session;
    }

    // Not enough approvals yet, just update ticket
    await this.storeTicket(ticket);

    logger.info(
      {
        ticketId: ticket.id,
        approverId,
        currentApprovals: ticket.currentApprovals.length,
        requiredApprovals: ticket.requiredApprovalCount,
      },
      'Approval added, waiting for more approvals'
    );

    // Return a placeholder - in practice caller should check ticket status
    throw new ElevationError(
      'PENDING_APPROVALS',
      `Ticket requires ${ticket.requiredApprovalCount - ticket.currentApprovals.length} more approval(s)`
    );
  }

  /**
   * Deny an elevation request
   *
   * @param ticketId - Ticket to deny
   * @param approverId - ID of the denying user
   * @param reason - Reason for denial
   */
  async denyElevation(
    ticketId: string,
    approverId: string,
    reason: string
  ): Promise<void> {
    const ticket = await this.getTicket(ticketId);

    if (!ticket) {
      throw new ElevationError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
    }

    if (ticket.status !== 'pending') {
      throw new ElevationError(
        'INVALID_TICKET_STATUS',
        `Ticket is ${ticket.status}, cannot deny`
      );
    }

    // Check if approver is authorized
    if (!ticket.requiredApprovers.includes(approverId)) {
      throw new ElevationError(
        'UNAUTHORIZED_APPROVER',
        `User ${approverId} is not authorized to deny this ticket`
      );
    }

    ticket.status = 'denied';
    ticket.deniedBy = approverId;
    ticket.deniedAt = new Date().toISOString();
    ticket.denialReason = reason;

    await this.storeTicket(ticket);

    // Create audit entry
    await this.createAuditEntry({
      action: 'approval_denied',
      ticketId: ticket.id,
      userId: ticket.request.userId,
      actorId: approverId,
      resource: ticket.request.resource,
      details: { reason },
    });

    // Security audit log
    const actor = this.buildActor(approverId);
    const resource = this.buildResource(ticket.request.resource);
    await this.securityLogger.log({
      eventType: 'ACCESS_DENIED',
      actor,
      action: 'deny_elevation',
      resource,
      outcome: 'blocked',
      reason,
      metadata: {
        ticketId: ticket.id,
        requestedBy: ticket.request.userId,
      },
    });

    logger.info(
      {
        ticketId: ticket.id,
        userId: ticket.request.userId,
        approverId,
        reason,
      },
      'Elevation denied'
    );
  }

  /**
   * Revoke an active elevation session
   *
   * @param sessionId - Session to revoke
   * @param reason - Reason for revocation
   * @param revokedBy - ID of the revoking user (default: 'system')
   */
  async revokeElevation(
    sessionId: string,
    reason: string,
    revokedBy: string = 'system'
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new ElevationError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
    }

    if (session.revokedAt) {
      throw new ElevationError(
        'SESSION_ALREADY_REVOKED',
        `Session ${sessionId} is already revoked`
      );
    }

    session.revokedAt = new Date().toISOString();
    session.revokedBy = revokedBy;
    session.revocationReason = reason;

    await this.storeSession(session);

    // Cancel expiration timer
    this.cancelSessionTimer(sessionId);

    // Remove from active sessions indexes
    await this.redis.srem(
      `${KEY_PREFIX.USER_SESSIONS}${session.userId}`,
      sessionId
    );
    await this.redis.srem(
      `${KEY_PREFIX.RESOURCE_SESSIONS}${session.resource}`,
      sessionId
    );

    // Update ticket
    const ticket = await this.getTicket(session.ticketId);
    if (ticket) {
      ticket.status = 'revoked';
      ticket.revokedBy = revokedBy;
      ticket.revokedAt = session.revokedAt;
      ticket.revocationReason = reason;
      await this.storeTicket(ticket);
    }

    // Create audit entry
    await this.createAuditEntry({
      action: 'session_revoked',
      ticketId: session.ticketId,
      sessionId: session.id,
      userId: session.userId,
      actorId: revokedBy,
      resource: session.resource,
      details: { reason },
    });

    // Security audit log
    const actor = this.buildActor(revokedBy);
    const resource = this.buildResource(session.resource);
    await this.securityLogger.logSessionRevoked(
      actor,
      sessionId,
      reason,
      {
        ticketId: session.ticketId,
        userId: session.userId,
        permissions: session.grantedPermissions,
      }
    );

    // Send alert for revocation
    await this.alertService.createAlert({
      severity: AlertSeverity.HIGH,
      type: SecurityEventType.ADMIN_ACTION,
      title: 'Elevated Session Revoked',
      message: `Elevated session for ${session.userId} on ${session.resource} was revoked. Reason: ${reason}`,
      context: {
        userId: session.userId,
        resource: session.resource,
        metadata: {
          sessionId: session.id,
          ticketId: session.ticketId,
          revokedBy,
        },
      },
      source: 'pam-jit-access',
      suggestedActions: [
        'Investigate reason for revocation',
        'Review user activity during session',
      ],
      tags: ['pam', 'session-revoked'],
    });

    logger.info(
      {
        sessionId,
        userId: session.userId,
        resource: session.resource,
        revokedBy,
        reason,
      },
      'Elevated session revoked'
    );
  }

  // ===========================================================================
  // Public API - Query Methods
  // ===========================================================================

  /**
   * Get all active elevation sessions for a user
   *
   * @param userId - User ID to query
   * @returns Array of active elevated sessions
   */
  async getActiveElevations(userId: string): Promise<ElevatedSession[]> {
    const sessionIds = await this.redis.smembers(
      `${KEY_PREFIX.USER_SESSIONS}${userId}`
    );

    const sessions: ElevatedSession[] = [];
    const now = new Date();

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (
        session &&
        !session.revokedAt &&
        new Date(session.expiresAt) > now
      ) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Check if a user has elevation for a specific resource
   *
   * @param userId - User ID to check
   * @param resource - Resource to check access for
   * @param permission - Optional specific permission to check
   * @returns True if user has active elevation
   */
  async checkElevation(
    userId: string,
    resource: string,
    permission?: string
  ): Promise<boolean> {
    const sessions = await this.getActiveElevations(userId);
    const now = new Date();

    for (const session of sessions) {
      // Check resource match
      if (session.resource !== resource) {
        continue;
      }

      // Check not expired
      if (new Date(session.expiresAt) <= now) {
        continue;
      }

      // Check permission if specified
      if (permission && !session.grantedPermissions.includes(permission)) {
        continue;
      }

      // Update last activity
      await this.updateSessionActivity(session.id);

      return true;
    }

    return false;
  }

  /**
   * Get pending tickets for a user
   *
   * @param userId - User ID to query
   * @returns Array of pending tickets
   */
  async getPendingTickets(userId: string): Promise<ElevationTicket[]> {
    const ticketIds = await this.redis.smembers(
      `${KEY_PREFIX.USER_TICKETS}${userId}`
    );

    const tickets: ElevationTicket[] = [];

    for (const ticketId of ticketIds) {
      const ticket = await this.getTicket(ticketId);
      if (ticket && ticket.status === 'pending') {
        tickets.push(ticket);
      }
    }

    return tickets;
  }

  /**
   * Get tickets pending approval for an approver
   *
   * @param approverId - Approver user ID
   * @returns Array of tickets awaiting approval
   */
  async getTicketsForApproval(approverId: string): Promise<ElevationTicket[]> {
    // This is a simplified implementation - in production you'd want
    // an index of tickets by approver
    const keys = await this.redis.keys(`${KEY_PREFIX.TICKET}*`);
    const tickets: ElevationTicket[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      try {
        const ticket = ElevationTicketSchema.parse(JSON.parse(data));
        if (
          ticket.status === 'pending' &&
          ticket.requiredApprovers.includes(approverId) &&
          !ticket.currentApprovals.some((a) => a.approverId === approverId)
        ) {
          tickets.push(ticket);
        }
      } catch {
        // Skip invalid tickets
      }
    }

    return tickets;
  }

  /**
   * Get a specific ticket by ID
   */
  async getTicket(ticketId: string): Promise<ElevationTicket | null> {
    const key = `${KEY_PREFIX.TICKET}${ticketId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      return ElevationTicketSchema.parse(JSON.parse(data));
    } catch (error) {
      logger.warn(
        { ticketId, error },
        'Failed to parse ticket data'
      );
      return null;
    }
  }

  /**
   * Get a specific session by ID
   */
  async getSession(sessionId: string): Promise<ElevatedSession | null> {
    const key = `${KEY_PREFIX.SESSION}${sessionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      return ElevatedSessionSchema.parse(JSON.parse(data));
    } catch (error) {
      logger.warn(
        { sessionId, error },
        'Failed to parse session data'
      );
      return null;
    }
  }

  // ===========================================================================
  // Middleware
  // ===========================================================================

  /**
   * Create middleware to check elevation for a resource
   *
   * @param resource - Resource identifier
   * @param permissions - Required permissions
   * @returns Fastify preHandler hook
   */
  requireElevation(
    resource: string,
    permissions: string[]
  ): preHandlerHookHandler {
    return async (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      // Extract user ID from request
      const user = (request as { user?: { sub?: string; id?: string } }).user;
      const userId = user?.id ?? user?.sub;

      if (!userId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      // Check each required permission
      for (const permission of permissions) {
        const hasElevation = await this.checkElevation(userId, resource, permission);

        if (!hasElevation) {
          // Log access denied
          const actor = this.buildActor(userId);
          const resourceObj = this.buildResource(resource);
          await this.securityLogger.logAccessDenied(
            actor,
            resourceObj,
            `Missing elevation for permission: ${permission}`,
            { requiredPermissions: permissions }
          );

          return reply.status(403).send({
            error: {
              code: 'ELEVATION_REQUIRED',
              message: `Elevated access required for ${resource}`,
              requiredPermissions: permissions,
              missingPermission: permission,
            },
          });
        }
      }

      // Log access granted
      const actor = this.buildActor(userId);
      const resourceObj = this.buildResource(resource);
      await this.securityLogger.logAccessGranted(actor, resourceObj, {
        elevatedAccess: true,
        permissions,
      });
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Stop the service and clean up resources
   */
  async stop(): Promise<void> {
    // Stop escalation check
    if (this.escalationCheckInterval) {
      clearInterval(this.escalationCheckInterval);
      this.escalationCheckInterval = null;
    }

    // Cancel all session timers
    const timers = Array.from(this.sessionExpirationTimers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.sessionExpirationTimers.clear();

    logger.info('JITAccessService stopped');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Store ticket in Redis
   */
  private async storeTicket(ticket: ElevationTicket): Promise<void> {
    const key = `${KEY_PREFIX.TICKET}${ticket.id}`;
    const ttl = Math.max(
      1,
      Math.ceil(
        (new Date(ticket.expiresAt).getTime() - Date.now()) / 1000
      )
    );

    await this.redis.setex(key, ttl + 3600, JSON.stringify(ticket)); // Keep 1hr after expiry
  }

  /**
   * Store session in Redis
   */
  private async storeSession(session: ElevatedSession): Promise<void> {
    const key = `${KEY_PREFIX.SESSION}${session.id}`;
    const ttl = Math.max(
      1,
      Math.ceil(
        (new Date(session.expiresAt).getTime() - Date.now()) / 1000
      )
    );

    await this.redis.setex(key, ttl + 3600, JSON.stringify(session)); // Keep 1hr after expiry
  }

  /**
   * Create an elevated session from an approved ticket
   */
  private async createElevatedSession(
    ticket: ElevationTicket
  ): Promise<ElevatedSession> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + ticket.request.durationMinutes * 60 * 1000
    );

    const session: ElevatedSession = {
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      userId: ticket.request.userId,
      grantedPermissions: ticket.request.permissions,
      resource: ticket.request.resource,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivityAt: now.toISOString(),
    };

    await this.storeSession(session);

    // Add to indexes
    await this.redis.sadd(
      `${KEY_PREFIX.USER_SESSIONS}${session.userId}`,
      session.id
    );
    await this.redis.sadd(
      `${KEY_PREFIX.RESOURCE_SESSIONS}${session.resource}`,
      session.id
    );

    // Set expiration timer
    this.setSessionExpirationTimer(session);

    // Create audit entry
    await this.createAuditEntry({
      action: 'session_started',
      ticketId: ticket.id,
      sessionId: session.id,
      userId: session.userId,
      actorId: 'system',
      resource: session.resource,
      details: {
        permissions: session.grantedPermissions,
        expiresAt: session.expiresAt,
      },
    });

    return session;
  }

  /**
   * Set timer to handle session expiration
   */
  private setSessionExpirationTimer(session: ElevatedSession): void {
    const expiresAt = new Date(session.expiresAt).getTime();
    const delay = expiresAt - Date.now();

    if (delay <= 0) {
      this.handleSessionExpiration(session.id);
      return;
    }

    const timer = setTimeout(
      () => this.handleSessionExpiration(session.id),
      delay
    );

    this.sessionExpirationTimers.set(session.id, timer);
  }

  /**
   * Cancel session expiration timer
   */
  private cancelSessionTimer(sessionId: string): void {
    const timer = this.sessionExpirationTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionExpirationTimers.delete(sessionId);
    }
  }

  /**
   * Handle session expiration
   */
  private async handleSessionExpiration(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session || session.revokedAt) {
      return;
    }

    // Remove from indexes
    await this.redis.srem(
      `${KEY_PREFIX.USER_SESSIONS}${session.userId}`,
      sessionId
    );
    await this.redis.srem(
      `${KEY_PREFIX.RESOURCE_SESSIONS}${session.resource}`,
      sessionId
    );

    // Clean up timer
    this.sessionExpirationTimers.delete(sessionId);

    // Create audit entry
    await this.createAuditEntry({
      action: 'session_expired',
      ticketId: session.ticketId,
      sessionId: session.id,
      userId: session.userId,
      actorId: 'system',
      resource: session.resource,
    });

    logger.info(
      {
        sessionId,
        userId: session.userId,
        resource: session.resource,
      },
      'Elevated session expired'
    );
  }

  /**
   * Update session last activity timestamp
   */
  private async updateSessionActivity(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return;
    }

    session.lastActivityAt = new Date().toISOString();
    await this.storeSession(session);
  }

  /**
   * Start periodic escalation check
   */
  private startEscalationCheck(): void {
    this.escalationCheckInterval = setInterval(
      () => this.checkForEscalations(),
      this.config.escalationCheckIntervalMs
    );

    // Don't prevent process exit
    this.escalationCheckInterval.unref();
  }

  /**
   * Check for tickets that need escalation
   */
  private async checkForEscalations(): Promise<void> {
    const keys = await this.redis.keys(`${KEY_PREFIX.TICKET}*`);
    const now = Date.now();

    for (const key of keys) {
      try {
        const data = await this.redis.get(key);
        if (!data) continue;

        const ticket = ElevationTicketSchema.parse(JSON.parse(data));

        // Skip if not pending or already escalated
        if (ticket.status !== 'pending' || ticket.escalatedAt) {
          continue;
        }

        // Check SLA
        const slaMinutes = this.config.approvalSLAMinutes[ticket.request.urgency] ?? 60;
        const createdAt = new Date(ticket.createdAt).getTime();
        const slaDeadline = createdAt + slaMinutes * 60 * 1000;

        if (now > slaDeadline) {
          await this.escalateTicket(ticket);
        }
      } catch (error) {
        logger.warn({ key, error }, 'Error checking ticket for escalation');
      }
    }
  }

  /**
   * Escalate a ticket that has breached SLA
   */
  private async escalateTicket(ticket: ElevationTicket): Promise<void> {
    ticket.escalatedAt = new Date().toISOString();
    await this.storeTicket(ticket);

    // Create audit entry
    await this.createAuditEntry({
      action: 'ticket_escalated',
      ticketId: ticket.id,
      userId: ticket.request.userId,
      actorId: 'system',
      resource: ticket.request.resource,
      details: {
        urgency: ticket.request.urgency,
        pendingApprovals:
          ticket.requiredApprovalCount - ticket.currentApprovals.length,
      },
    });

    // Send escalation alert
    await this.alertService.createAlert({
      severity: AlertSeverity.HIGH,
      type: SecurityEventType.ADMIN_ACTION,
      title: 'Elevation Request SLA Breached',
      message: `Elevation request for ${ticket.request.userId} to access ${ticket.request.resource} has not been approved within SLA (${ticket.request.urgency} urgency)`,
      context: {
        userId: ticket.request.userId,
        resource: ticket.request.resource,
        metadata: {
          ticketId: ticket.id,
          urgency: ticket.request.urgency,
          pendingApprovals:
            ticket.requiredApprovalCount - ticket.currentApprovals.length,
        },
      },
      source: 'pam-jit-access',
      suggestedActions: [
        'Review and approve/deny the elevation request immediately',
        'Contact approvers if they are unavailable',
      ],
      tags: ['pam', 'sla-breach', 'escalation'],
    });

    logger.warn(
      {
        ticketId: ticket.id,
        userId: ticket.request.userId,
        urgency: ticket.request.urgency,
      },
      'Elevation request escalated due to SLA breach'
    );
  }

  /**
   * Create a PAM audit entry
   */
  private async createAuditEntry(
    params: Omit<PAMAuditEntry, 'id' | 'timestamp'>
  ): Promise<void> {
    const entry: PAMAuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...params,
    };

    const key = `${KEY_PREFIX.AUDIT}${entry.id}`;
    await this.redis.setex(key, 90 * 24 * 60 * 60, JSON.stringify(entry)); // 90 days

    // Add to time-sorted index
    await this.redis.zadd(
      `${this.config.keyPrefix}audit_index`,
      Date.now(),
      entry.id
    );
  }

  /**
   * Build security actor from user ID
   */
  private buildActor(userId: string): SecurityActor {
    return {
      type: userId === 'system' ? 'system' : 'user',
      id: userId,
    };
  }

  /**
   * Build security resource from resource string
   */
  private buildResource(resource: string): SecurityResource {
    return {
      type: 'privileged_resource',
      id: resource,
      name: resource,
    };
  }

  /**
   * Get alert severity for elevation urgency
   */
  private getSeverityForUrgency(urgency: ElevationUrgency): AlertSeverity {
    switch (urgency) {
      case 'critical':
        return AlertSeverity.CRITICAL;
      case 'high':
        return AlertSeverity.HIGH;
      case 'medium':
        return AlertSeverity.MEDIUM;
      case 'low':
        return AlertSeverity.LOW;
      default:
        return AlertSeverity.MEDIUM;
    }
  }
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error codes for elevation operations
 */
export type ElevationErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'INVALID_TICKET_STATUS'
  | 'UNAUTHORIZED_APPROVER'
  | 'ALREADY_APPROVED'
  | 'SESSION_ALREADY_REVOKED'
  | 'PENDING_APPROVALS'
  | 'VALIDATION_ERROR';

/**
 * Custom error for elevation operations
 */
export class ElevationError extends Error {
  constructor(
    public readonly code: ElevationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ElevationError';
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let jitAccessInstance: JITAccessService | null = null;

/**
 * Get the singleton JITAccessService instance
 */
export function getJITAccessService(
  config?: JITAccessConfig,
  deps?: JITAccessDependencies
): JITAccessService {
  if (!jitAccessInstance) {
    jitAccessInstance = new JITAccessService(config, deps);
  }
  return jitAccessInstance;
}

/**
 * Create a new JITAccessService instance
 */
export function createJITAccessService(
  config?: JITAccessConfig,
  deps?: JITAccessDependencies
): JITAccessService {
  return new JITAccessService(config, deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export async function resetJITAccessService(): Promise<void> {
  if (jitAccessInstance) {
    await jitAccessInstance.stop();
    jitAccessInstance = null;
  }
}
