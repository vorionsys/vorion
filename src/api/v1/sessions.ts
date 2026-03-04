/**
 * API v1 Session Routes
 *
 * REST API endpoints for session management including:
 * - List active sessions for current user
 * - Get current session info
 * - Revoke specific sessions
 * - Revoke all sessions except current
 * - Refresh session token
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors.js';
import {
  getSessionManager,
  type Session,
} from '../../security/session-manager.js';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendForbidden,
  sendUnauthorized,
} from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';

const logger = createLogger({ component: 'api-v1-sessions' });

// =============================================================================
// Request/Response Schemas
// =============================================================================

/**
 * Session ID parameter schema
 */
const sessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

/**
 * Revoke all sessions query schema
 */
const revokeAllQuerySchema = z.object({
  reason: z.string().optional(),
});

/**
 * Refresh session request body schema
 */
const refreshSessionBodySchema = z.object({
  /** Optional reason for refresh */
  reason: z.string().optional(),
});

/**
 * Session response schema (for documentation)
 */
const sessionResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tenantId: z.string(),
  ipAddress: z.string(),
  userAgent: z.string(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});

// =============================================================================
// Type Declarations
// =============================================================================

/**
 * Extend FastifyRequest to include JWT methods when JWT plugin is registered
 */
declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify<T = Record<string, unknown>>(): Promise<T>;
  }
}

/**
 * JWT payload structure
 */
interface JwtPayload {
  sub?: string;
  userId?: string;
  tenantId?: string;
  tenant_id?: string;
  jti?: string;
  sessionId?: string;
  exp?: number;
}

/**
 * Authenticated context
 */
interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract authenticated user context from request
 */
async function getAuthContext(request: FastifyRequest): Promise<AuthContext> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();

    const userId = payload.sub ?? payload.userId;
    const tenantId = payload.tenantId ?? payload.tenant_id;
    const sessionId = payload.jti ?? payload.sessionId;

    if (!userId) {
      throw new UnauthorizedError('User identifier missing from token');
    }

    if (!tenantId) {
      throw new ForbiddenError('Tenant context missing from token');
    }

    if (!sessionId) {
      throw new UnauthorizedError('Session identifier missing from token');
    }

    return {
      userId,
      tenantId,
      sessionId,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or missing authentication token');
  }
}

/**
 * Get client IP address
 */
function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return request.ip || 'unknown';
}

/**
 * Get client user agent
 */
function getUserAgent(request: FastifyRequest): string {
  return (request.headers['user-agent'] as string) || 'unknown';
}

/**
 * Sanitize session data for API response
 * Removes sensitive fields and adds isCurrent flag
 */
function sanitizeSession(
  session: Session,
  currentSessionId: string
): z.infer<typeof sessionResponseSchema> {
  return {
    id: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  };
}

/**
 * Wrap handler with session-specific error handling
 */
function withSessionErrorHandling<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
): (request: FastifyRequest, reply: FastifyReply) => Promise<T | void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    try {
      return await handler(request, reply);
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          path: e.path.join('.') || '(root)',
          message: e.message,
          code: e.code,
        }));
        throw new ValidationError('Request validation failed', { errors });
      }

      // Handle auth errors
      if (error instanceof UnauthorizedError) {
        return sendUnauthorized(reply, error.message, request);
      }

      if (error instanceof ForbiddenError) {
        return sendForbidden(reply, error.message, request);
      }

      if (error instanceof NotFoundError) {
        return sendNotFound(reply, 'Session', request);
      }

      // Re-throw other errors to be handled by global error handler
      throw error;
    }
  };
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * GET /api/v1/sessions - List active sessions for current user
 */
async function handleListSessions(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { userId, sessionId: currentSessionId } = await getAuthContext(request);
  const sessionManager = getSessionManager();

  logger.debug({ userId }, 'Listing user sessions');

  const sessions = await sessionManager.getUserSessions(userId);

  // Sort sessions by lastActivityAt, most recent first
  sessions.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

  const sanitizedSessions = sessions.map((session) =>
    sanitizeSession(session, currentSessionId)
  );

  logger.info(
    { userId, sessionCount: sessions.length },
    'Sessions listed successfully'
  );

  return sendSuccess(
    reply,
    {
      sessions: sanitizedSessions,
      total: sanitizedSessions.length,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * GET /api/v1/sessions/current - Get current session info
 */
async function handleGetCurrentSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { userId, sessionId } = await getAuthContext(request);
  const sessionManager = getSessionManager();

  logger.debug({ userId, sessionId }, 'Getting current session');

  const validationResult = await sessionManager.validateSession(sessionId, {
    ipAddress: getClientIp(request),
  });

  if (!validationResult.valid || !validationResult.session) {
    throw new NotFoundError('Current session not found or invalid');
  }

  const session = validationResult.session;

  // Verify the session belongs to the authenticated user
  if (session.userId !== userId) {
    throw new ForbiddenError('Session does not belong to authenticated user');
  }

  logger.info({ userId, sessionId }, 'Current session retrieved');

  return sendSuccess(
    reply,
    {
      session: sanitizeSession(session, sessionId),
      securityWarnings: validationResult.securityWarnings,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * DELETE /api/v1/sessions/:id - Revoke a specific session
 */
async function handleRevokeSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { userId, sessionId: currentSessionId } = await getAuthContext(request);
  const sessionManager = getSessionManager();

  const params = sessionIdParamsSchema.parse(request.params);
  const targetSessionId = params.id;

  logger.debug({ userId, targetSessionId }, 'Revoking session');

  // Get the target session to verify ownership
  const sessions = await sessionManager.getUserSessions(userId);
  const targetSession = sessions.find((s) => s.id === targetSessionId);

  if (!targetSession) {
    // Check if session exists but belongs to another user
    // We don't want to leak information about other users' sessions
    throw new NotFoundError('Session not found');
  }

  // Verify the session belongs to the authenticated user
  if (targetSession.userId !== userId) {
    logger.warn(
      {
        userId,
        targetSessionId,
        targetUserId: targetSession.userId,
      },
      'Attempted to revoke another user\'s session'
    );
    throw new ForbiddenError('Cannot revoke sessions belonging to other users');
  }

  // Check if trying to revoke current session
  const isCurrentSession = targetSessionId === currentSessionId;

  const revoked = await sessionManager.revokeSession(
    targetSessionId,
    isCurrentSession ? 'User logged out' : 'User revoked session',
    userId
  );

  if (!revoked) {
    throw new NotFoundError('Session not found or already revoked');
  }

  logger.info(
    { userId, targetSessionId, isCurrentSession },
    'Session revoked successfully'
  );

  return sendSuccess(
    reply,
    {
      message: isCurrentSession
        ? 'Current session has been revoked. You will need to log in again.'
        : 'Session has been revoked successfully.',
      sessionId: targetSessionId,
      wasCurrentSession: isCurrentSession,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * DELETE /api/v1/sessions - Revoke all sessions except current
 */
async function handleRevokeAllSessions(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { userId, sessionId: currentSessionId } = await getAuthContext(request);
  const sessionManager = getSessionManager();

  const query = revokeAllQuerySchema.parse(request.query);
  const reason = query.reason ?? 'User revoked all other sessions';

  logger.debug({ userId, currentSessionId }, 'Revoking all other sessions');

  const revokedCount = await sessionManager.revokeOtherSessions(
    userId,
    currentSessionId,
    reason
  );

  logger.info(
    { userId, currentSessionId, revokedCount },
    'All other sessions revoked'
  );

  return sendSuccess(
    reply,
    {
      message:
        revokedCount > 0
          ? `Successfully revoked ${revokedCount} session(s). Your current session remains active.`
          : 'No other active sessions to revoke.',
      revokedCount,
      currentSessionPreserved: true,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * POST /api/v1/sessions/refresh - Refresh session token
 */
async function handleRefreshSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { userId, sessionId: currentSessionId } = await getAuthContext(request);
  const sessionManager = getSessionManager();

  const body = refreshSessionBodySchema.parse(request.body ?? {});
  const reason = body.reason ?? 'Session token refresh';

  logger.debug({ userId, currentSessionId }, 'Refreshing session');

  // Regenerate the session with new ID
  const newSession = await sessionManager.regenerateSession(currentSessionId, {
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    reason,
  });

  if (!newSession) {
    throw new NotFoundError('Current session not found or invalid');
  }

  logger.info(
    {
      userId,
      oldSessionId: currentSessionId,
      newSessionId: newSession.id,
    },
    'Session refreshed successfully'
  );

  // Note: The client will need to obtain a new JWT token with the new session ID
  // This endpoint just rotates the session on the server side
  return sendSuccess(
    reply,
    {
      message: 'Session has been refreshed. Please obtain a new authentication token.',
      session: sanitizeSession(newSession, newSession.id),
      oldSessionId: currentSessionId,
      newSessionId: newSession.id,
    },
    HttpStatus.OK,
    request
  );
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register session management routes
 *
 * Routes:
 * - GET    /sessions           - List active sessions for current user
 * - GET    /sessions/current   - Get current session info
 * - DELETE /sessions/:id       - Revoke a specific session
 * - DELETE /sessions           - Revoke all sessions except current
 * - POST   /sessions/refresh   - Refresh session token
 *
 * @param fastify - Fastify instance
 */
export async function registerSessionRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/sessions';

  // GET /sessions - List active sessions for current user
  fastify.get(
    prefix,
    withSessionErrorHandling(async (request, reply) => {
      return handleListSessions(request, reply);
    })
  );

  // GET /sessions/current - Get current session info
  fastify.get(
    `${prefix}/current`,
    withSessionErrorHandling(async (request, reply) => {
      return handleGetCurrentSession(request, reply);
    })
  );

  // DELETE /sessions/:id - Revoke a specific session
  fastify.delete(
    `${prefix}/:id`,
    withSessionErrorHandling(async (request, reply) => {
      return handleRevokeSession(request, reply);
    })
  );

  // DELETE /sessions - Revoke all sessions except current
  fastify.delete(
    prefix,
    withSessionErrorHandling(async (request, reply) => {
      return handleRevokeAllSessions(request, reply);
    })
  );

  // POST /sessions/refresh - Refresh session token
  fastify.post(
    `${prefix}/refresh`,
    withSessionErrorHandling(async (request, reply) => {
      return handleRefreshSession(request, reply);
    })
  );

  logger.info({ prefix }, 'Session routes registered');
}

export default registerSessionRoutes;
