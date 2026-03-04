/**
 * MFA API Routes
 *
 * REST API endpoints for Multi-Factor Authentication operations including:
 * - MFA enrollment and verification
 * - Challenge creation and verification
 * - Backup code management
 * - MFA status and disabling
 *
 * @packageDocumentation
 * @module api/routes/mfa
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// Extend FastifyRequest to include JWT methods when JWT plugin is registered
declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify<T = Record<string, unknown>>(): Promise<T>;
  }
}
import { createLogger } from '../../common/logger.js';
import { ForbiddenError, ValidationError, NotFoundError, UnauthorizedError } from '../../common/errors.js';
import { ZodError } from 'zod';
import {
  getMfaService,
  type MfaService,
  MfaError,
  EnrollmentExpiredError,
  ChallengeExpiredError,
  TooManyAttemptsError,
  mfaEnrollVerifyRequestSchema,
  mfaChallengeVerifyRequestSchema,
} from '../../security/mfa/index.js';
import { sendSuccess, sendError, sendNotFound } from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';

const logger = createLogger({ component: 'api-mfa' });

// =============================================================================
// Request Schemas
// =============================================================================

const enrollRequestSchema = z.object({
  email: z.string().email().optional(),
});

const challengeRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract authenticated user context from request
 */
async function getAuthContext(request: FastifyRequest): Promise<{
  userId: string;
  tenantId: string;
  email?: string;
  sessionId: string;
}> {
  try {
    const payload = await request.jwtVerify<{
      sub?: string;
      userId?: string;
      tenantId?: string;
      tenant_id?: string;
      email?: string;
      jti?: string;
    }>();

    const userId = payload.sub ?? payload.userId;
    const tenantId = payload.tenantId ?? payload.tenant_id;

    if (!userId) {
      throw new UnauthorizedError('User identifier missing from token');
    }

    if (!tenantId) {
      throw new ForbiddenError('Tenant context missing from token');
    }

    // Use jti as session ID, or generate from request ID
    const sessionId = payload.jti ?? request.id;

    return {
      userId,
      tenantId,
      email: payload.email,
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
function getClientIp(request: FastifyRequest): string | undefined {
  // Check X-Forwarded-For header (for proxied requests)
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  // Fall back to request IP
  return request.ip;
}

/**
 * Wrap handler with MFA-specific error handling
 */
function withMfaErrorHandling<T>(
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

      // Handle MFA-specific errors
      if (error instanceof EnrollmentExpiredError) {
        return sendError(
          reply,
          'MFA_ENROLLMENT_EXPIRED',
          'MFA enrollment has expired. Please start enrollment again.',
          HttpStatus.BAD_REQUEST,
          undefined,
          request
        );
      }

      if (error instanceof ChallengeExpiredError) {
        return sendError(
          reply,
          'MFA_CHALLENGE_EXPIRED',
          'MFA challenge has expired. Please request a new challenge.',
          HttpStatus.BAD_REQUEST,
          undefined,
          request
        );
      }

      if (error instanceof TooManyAttemptsError) {
        return sendError(
          reply,
          'MFA_TOO_MANY_ATTEMPTS',
          'Too many verification attempts. Please request a new challenge.',
          HttpStatus.TOO_MANY_REQUESTS,
          undefined,
          request
        );
      }

      if (error instanceof MfaError) {
        return sendError(
          reply,
          error.code,
          error.message,
          HttpStatus.BAD_REQUEST,
          undefined,
          request
        );
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
 * POST /api/v1/mfa/enroll - Start MFA enrollment
 */
async function handleEnroll(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId, email: tokenEmail } = await getAuthContext(request);
  const body = enrollRequestSchema.parse(request.body ?? {});

  // Use email from body or token
  const email = body.email ?? tokenEmail;
  if (!email) {
    throw new ValidationError('Email is required for MFA enrollment', {
      field: 'email',
      message: 'Please provide an email address',
    });
  }

  logger.info({ userId, tenantId }, 'Starting MFA enrollment');

  const response = await mfaService.enrollUser(userId, tenantId, email);

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * POST /api/v1/mfa/enroll/verify - Verify TOTP during enrollment
 */
async function handleEnrollVerify(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId } = await getAuthContext(request);
  const body = mfaEnrollVerifyRequestSchema.parse(request.body ?? {});

  logger.info({ userId, tenantId }, 'Verifying MFA enrollment');

  const verified = await mfaService.verifyEnrollment(userId, tenantId, body.code);

  if (!verified) {
    return sendError(
      reply,
      'MFA_INVALID_CODE',
      'Invalid verification code. Please check your authenticator app and try again.',
      HttpStatus.BAD_REQUEST,
      undefined,
      request
    );
  }

  return sendSuccess(
    reply,
    { verified: true, message: 'Verification successful. Complete enrollment to activate MFA.' },
    HttpStatus.OK,
    request
  );
}

/**
 * POST /api/v1/mfa/enroll/complete - Complete MFA enrollment
 */
async function handleEnrollComplete(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId } = await getAuthContext(request);

  logger.info({ userId, tenantId }, 'Completing MFA enrollment');

  const response = await mfaService.completeEnrollment(userId, tenantId);

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * POST /api/v1/mfa/challenge - Create MFA challenge
 */
async function handleCreateChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, sessionId: defaultSessionId } = await getAuthContext(request);
  const body = challengeRequestSchema.parse(request.body ?? {});

  const sessionId = body.sessionId ?? defaultSessionId;

  logger.info({ userId, sessionId }, 'Creating MFA challenge');

  const response = await mfaService.createChallenge(userId, sessionId);

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * POST /api/v1/mfa/challenge/verify - Verify MFA challenge
 */
async function handleVerifyChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { tenantId } = await getAuthContext(request);
  const body = mfaChallengeVerifyRequestSchema.parse(request.body ?? {});
  const clientIp = getClientIp(request);

  logger.info({ challengeToken: body.challengeToken.slice(0, 8) }, 'Verifying MFA challenge');

  const response = await mfaService.verifyChallenge(
    body.challengeToken,
    body.code,
    tenantId,
    clientIp
  );

  if (!response.verified) {
    return sendError(
      reply,
      'MFA_VERIFICATION_FAILED',
      response.error ?? 'MFA verification failed',
      HttpStatus.UNAUTHORIZED,
      { attemptsRemaining: response.attemptsRemaining },
      request
    );
  }

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * DELETE /api/v1/mfa - Disable MFA
 */
async function handleDisableMfa(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId } = await getAuthContext(request);

  logger.info({ userId, tenantId }, 'Disabling MFA');

  await mfaService.disableMfa(userId, tenantId);

  return sendSuccess(
    reply,
    { message: 'MFA has been disabled successfully' },
    HttpStatus.OK,
    request
  );
}

/**
 * POST /api/v1/mfa/backup-codes/regenerate - Regenerate backup codes
 */
async function handleRegenerateBackupCodes(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId } = await getAuthContext(request);

  logger.info({ userId, tenantId }, 'Regenerating backup codes');

  const response = await mfaService.regenerateBackupCodes(userId, tenantId);

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * GET /api/v1/mfa/status - Get MFA status
 */
async function handleGetStatus(
  request: FastifyRequest,
  reply: FastifyReply,
  mfaService: MfaService
): Promise<void> {
  const { userId, tenantId } = await getAuthContext(request);

  logger.debug({ userId, tenantId }, 'Getting MFA status');

  const response = await mfaService.getMfaStatus(userId, tenantId);

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * MFA routes roles
 */
export const MFA_ROLES = {
  /** Roles that can manage their own MFA */
  SELF: ['admin', 'tenant:admin', 'user'],
  /** Roles that can view MFA status */
  READ: ['admin', 'tenant:admin', 'user', 'mfa:reader'],
} as const;

/**
 * Register MFA routes
 *
 * @param server - Fastify server instance
 * @param options - Route options
 */
export async function registerMfaRoutes(
  server: FastifyInstance,
  options?: { prefix?: string }
): Promise<void> {
  const prefix = options?.prefix ?? '/mfa';
  const mfaService = getMfaService();

  // POST /mfa/enroll - Start MFA enrollment
  server.post(
    `${prefix}/enroll`,
    withMfaErrorHandling(async (request, reply) => {
      return handleEnroll(request, reply, mfaService);
    })
  );

  // POST /mfa/enroll/verify - Verify TOTP during enrollment
  server.post(
    `${prefix}/enroll/verify`,
    withMfaErrorHandling(async (request, reply) => {
      return handleEnrollVerify(request, reply, mfaService);
    })
  );

  // POST /mfa/enroll/complete - Complete MFA enrollment
  server.post(
    `${prefix}/enroll/complete`,
    withMfaErrorHandling(async (request, reply) => {
      return handleEnrollComplete(request, reply, mfaService);
    })
  );

  // POST /mfa/challenge - Create MFA challenge
  server.post(
    `${prefix}/challenge`,
    withMfaErrorHandling(async (request, reply) => {
      return handleCreateChallenge(request, reply, mfaService);
    })
  );

  // POST /mfa/challenge/verify - Verify MFA challenge
  server.post(
    `${prefix}/challenge/verify`,
    withMfaErrorHandling(async (request, reply) => {
      return handleVerifyChallenge(request, reply, mfaService);
    })
  );

  // DELETE /mfa - Disable MFA
  server.delete(
    prefix,
    withMfaErrorHandling(async (request, reply) => {
      return handleDisableMfa(request, reply, mfaService);
    })
  );

  // POST /mfa/backup-codes/regenerate - Regenerate backup codes
  server.post(
    `${prefix}/backup-codes/regenerate`,
    withMfaErrorHandling(async (request, reply) => {
      return handleRegenerateBackupCodes(request, reply, mfaService);
    })
  );

  // GET /mfa/status - Get MFA status
  server.get(
    `${prefix}/status`,
    withMfaErrorHandling(async (request, reply) => {
      return handleGetStatus(request, reply, mfaService);
    })
  );

  logger.info({ prefix }, 'MFA routes registered');
}

/**
 * Register MFA routes under v1 API prefix
 *
 * @param fastify - Fastify instance
 */
export async function registerMfaRoutesV1(fastify: FastifyInstance): Promise<void> {
  await registerMfaRoutes(fastify);
}

export default registerMfaRoutes;
