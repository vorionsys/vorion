/**
 * Privileged Access Management (PAM) Module
 *
 * Comprehensive PAM system providing:
 * - Just-In-Time (JIT) access for temporary privilege elevation
 * - Break-Glass emergency access for critical situations
 * - Session recording for audit and compliance
 *
 * Key features:
 * - Request-based elevation workflow with approvals
 * - Multi-approver support with configurable thresholds
 * - Time-limited sessions with automatic expiration
 * - Full audit trail for compliance
 * - Alert integration for security monitoring
 * - SLA-based escalation for pending requests
 * - Emergency access with strict controls and notifications
 * - Comprehensive session recording
 *
 * @example
 * ```typescript
 * import { getJITAccessService, requireElevation } from './security/pam';
 *
 * // Request elevation
 * const service = getJITAccessService();
 * const ticket = await service.requestElevation({
 *   userId: 'user-123',
 *   resource: 'production-database',
 *   permissions: ['read', 'write'],
 *   reason: 'Need to fix critical data issue',
 *   durationMinutes: 60,
 *   urgency: 'high',
 * });
 *
 * // Approve elevation
 * const session = await service.approveElevation(ticket.id, 'admin-456');
 *
 * // Use middleware to protect routes
 * fastify.route({
 *   method: 'POST',
 *   url: '/api/production-database',
 *   preHandler: [service.requireElevation('production-database', ['write'])],
 *   handler: handleRequest,
 * });
 * ```
 *
 * @packageDocumentation
 * @module security/pam
 */

// =============================================================================
// JIT Access - Types & Schemas
// =============================================================================

export {
  // Urgency
  ElevationUrgencySchema,
  type ElevationUrgency,

  // Ticket Status
  TicketStatusSchema,
  type TicketStatus,

  // Request
  ElevationRequestSchema,
  type ElevationRequest,

  // Approval
  ApprovalSchema,
  type Approval,

  // Ticket
  ElevationTicketSchema,
  type ElevationTicket,

  // Session
  ElevatedSessionSchema,
  type ElevatedSession,

  // Audit
  AuditActionSchema,
  type AuditAction,
  PAMAuditEntrySchema,
  type PAMAuditEntry,
} from './jit-access.js';

// =============================================================================
// JIT Access - Service
// =============================================================================

export {
  // Service class
  JITAccessService,

  // Configuration
  type JITAccessConfig,
  type JITAccessDependencies,

  // Error handling
  ElevationError,
  type ElevationErrorCode,

  // Factory functions
  getJITAccessService,
  createJITAccessService,
  resetJITAccessService,
} from './jit-access.js';

// =============================================================================
// Break-Glass Emergency Access
// =============================================================================

export {
  // Enums and schemas
  BreakGlassScope,
  breakGlassScopeSchema,
  BreakGlassStatus,
  breakGlassStatusSchema,
  VerificationMethod,
  verificationMethodSchema,
  breakGlassRequestSchema,
  breakGlassActionSchema,
  breakGlassSessionSchema,

  // Types
  type BreakGlassRequest,
  type BreakGlassAction,
  type BreakGlassSession,
  type BreakGlassNotification,
  type BreakGlassReview,
  type BreakGlassAudit,
  type BreakGlassAuditEvent,
  type BreakGlassComplianceExport,
  type MfaVerificationInput,
  type PhoneCallbackInput,
  type BreakGlassServiceDependencies,
  type BreakGlassServiceConfig,
  type AllowBreakGlassOptions,

  // Service and helpers
  BreakGlassService,
  BreakGlassError,
  allowBreakGlass,
  createBreakGlassService,
} from './break-glass.js';

// =============================================================================
// Session Recording
// =============================================================================

export {
  // Event types
  SessionEventType,
  sessionEventTypeSchema,
  sessionEventSchema,

  // Types
  type ApiCallEvent,
  type DataAccessEvent,
  type PermissionUsageEvent,
  type ConfigChangeEvent,
  type AuthEventDetails,
  type ErrorEvent,
  type CustomEvent,
  type SessionEventDetails,
  type SessionEvent,

  // Recording types
  recordingMetadataSchema,
  type RecordingMetadata,
  recordingSummarySchema,
  type RecordingSummary,
  RecordingStatus,
  recordingStatusSchema,
  recordingSchema,
  type Recording,
  recordingFilterSchema,
  type RecordingFilter,
  type PrivacyConfig,

  // Storage
  type RecordingStorage,
  InMemoryRecordingStorage,

  // Errors
  SessionRecordingError,
  RecordingNotFoundError,
  RecordingDeletionDeniedError,
} from './session-recording.js';

// =============================================================================
// Convenience Functions
// =============================================================================

import {
  getJITAccessService,
  type ElevationRequest,
  type ElevationTicket,
  type ElevatedSession,
} from './jit-access.js';

/**
 * Quick elevation request helper
 *
 * @param request - Elevation request parameters
 * @returns Created elevation ticket
 */
export async function requestElevation(
  request: ElevationRequest
): Promise<ElevationTicket> {
  return getJITAccessService().requestElevation(request);
}

/**
 * Quick approval helper
 *
 * @param ticketId - Ticket to approve
 * @param approverId - Approver user ID
 * @param comment - Optional comment
 * @returns Elevated session if approval threshold met
 */
export async function approveElevation(
  ticketId: string,
  approverId: string,
  comment?: string
): Promise<ElevatedSession> {
  return getJITAccessService().approveElevation(ticketId, approverId, comment);
}

/**
 * Quick denial helper
 *
 * @param ticketId - Ticket to deny
 * @param approverId - Approver user ID
 * @param reason - Reason for denial
 */
export async function denyElevation(
  ticketId: string,
  approverId: string,
  reason: string
): Promise<void> {
  return getJITAccessService().denyElevation(ticketId, approverId, reason);
}

/**
 * Quick revocation helper
 *
 * @param sessionId - Session to revoke
 * @param reason - Reason for revocation
 * @param revokedBy - Revoking user ID (default: 'system')
 */
export async function revokeElevation(
  sessionId: string,
  reason: string,
  revokedBy?: string
): Promise<void> {
  return getJITAccessService().revokeElevation(sessionId, reason, revokedBy);
}

/**
 * Check if user has elevation
 *
 * @param userId - User to check
 * @param resource - Resource to check access for
 * @param permission - Optional specific permission
 * @returns True if user has active elevation
 */
export async function checkElevation(
  userId: string,
  resource: string,
  permission?: string
): Promise<boolean> {
  return getJITAccessService().checkElevation(userId, resource, permission);
}

/**
 * Get active elevations for user
 *
 * @param userId - User to query
 * @returns Array of active elevated sessions
 */
export async function getActiveElevations(
  userId: string
): Promise<ElevatedSession[]> {
  return getJITAccessService().getActiveElevations(userId);
}

/**
 * Create middleware to require elevation
 *
 * @param resource - Resource identifier
 * @param permissions - Required permissions
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * fastify.route({
 *   method: 'DELETE',
 *   url: '/api/users/:id',
 *   preHandler: [requireElevation('user-management', ['delete'])],
 *   handler: deleteUser,
 * });
 * ```
 */
export function requireElevation(resource: string, permissions: string[]) {
  return getJITAccessService().requireElevation(resource, permissions);
}
