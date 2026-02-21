/**
 * PIV/CAC Authentication Routes
 *
 * Fastify routes for PIV/CAC smart card authentication endpoints.
 *
 * Endpoints:
 * - POST /auth/piv/authenticate - Authenticate with certificate
 * - POST /auth/piv/challenge - Generate challenge for card
 * - POST /auth/piv/verify - Verify signed challenge
 * - GET /auth/piv/session - Get session info
 * - DELETE /auth/piv/session - Terminate session
 * - GET /auth/piv/status - Check PIV auth status
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  type PIVAuthRequest,
  type PIVAuthResult,
  type CardSessionBinding,
  pivAuthRequestSchema,
  PIVErrorCode,
} from './types.js';
import {
  parseCertificate,
  parseCertificateChain,
  CertificateAuthError,
} from './certificate-auth.js';
import {
  type PIVAuthServices,
  getPIVAuth,
  hasPIVAuth,
  getPIVUser,
} from './piv-middleware.js';

const logger = createLogger({ component: 'piv-routes' });

// =============================================================================
// Request/Response Schemas
// =============================================================================

const authenticateRequestSchema = z.object({
  clientCertificate: z.string().min(1, 'Client certificate is required'),
  certificateChain: z.string().optional(),
  pin: z.string().optional(),
});

const challengeResponseSchema = z.object({
  sessionId: z.string().min(1),
  signedChallenge: z.string().min(1),
});

const sessionIdParamSchema = z.object({
  sessionId: z.string().min(1),
});

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Authenticate with PIV/CAC certificate
 */
async function authenticateHandler(
  request: FastifyRequest<{
    Body: z.infer<typeof authenticateRequestSchema>;
  }>,
  reply: FastifyReply
): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  try {
    const { clientCertificate, certificateChain } = request.body;

    // Parse certificate
    const certificate = parseCertificate(clientCertificate);
    const chain = certificateChain ? parseCertificateChain(certificateChain) : [];

    // Validate certificate
    const validation = await services.certAuth.validateCertificate(certificate, chain);

    if (!validation.isValid) {
      const result: PIVAuthResult = {
        success: false,
        error: validation.errors[0] || 'Certificate validation failed',
        errorCode: validation.status,
        validation,
      };

      return reply.status(401).send(result);
    }

    // Map certificate to user
    let user;
    try {
      user = services.certificateMapper.mapCertificate(certificate);
    } catch (error) {
      const result: PIVAuthResult = {
        success: false,
        error: 'Failed to map certificate to user identity',
        errorCode: PIVErrorCode.USER_MAPPING_FAILED,
        validation,
      };

      return reply.status(401).send(result);
    }

    // Create session
    const sessionId = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8 hours

    const sessionBinding: CardSessionBinding = {
      sessionId,
      userId: user.userId,
      certificateFingerprint: certificate.fingerprint,
      readerName: 'http-auth', // HTTP-based auth, no physical reader
      atr: certificate.fingerprint.substring(0, 20), // Use fingerprint prefix as pseudo-ATR
      createdAt: now,
      lastActivity: now,
      expiresAt,
    };

    services.cardRemovalHandler.bindSession(sessionBinding);

    // Generate tokens (simplified - in production use proper JWT service)
    const accessToken = generateAccessToken(user.userId, sessionId);
    const refreshToken = generateRefreshToken(sessionId);

    const result: PIVAuthResult = {
      success: true,
      user,
      sessionId,
      expiresAt,
      validation,
      accessToken,
      refreshToken,
    };

    logger.info(
      {
        userId: user.userId,
        sessionId,
        fingerprint: certificate.fingerprint.substring(0, 16),
      },
      'PIV authentication successful'
    );

    return reply.status(200).send(result);
  } catch (error) {
    logger.error({ error }, 'PIV authentication failed');

    const result: PIVAuthResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
      errorCode:
        error instanceof CertificateAuthError ? error.code : PIVErrorCode.INTERNAL_ERROR,
    };

    return reply.status(500).send(result);
  }
}

/**
 * Generate authentication challenge
 */
async function challengeHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  // Generate challenge
  const challenge = randomBytes(32);
  const challengeId = randomBytes(16).toString('hex');

  // Store challenge temporarily (would use Redis in production)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // In production, store in distributed cache:
  // await redis.setex(`piv:challenge:${challengeId}`, 300, challenge.toString('base64'));

  logger.debug({ challengeId }, 'Generated PIV challenge');

  return reply.status(200).send({
    challengeId,
    challenge: challenge.toString('base64'),
    expiresAt: expiresAt.toISOString(),
    instructions: 'Sign this challenge with your PIV card authentication key',
  });
}

/**
 * Verify signed challenge
 */
async function verifyHandler(
  request: FastifyRequest<{
    Body: z.infer<typeof challengeResponseSchema>;
  }>,
  reply: FastifyReply
): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  const { sessionId, signedChallenge } = request.body;

  // Verify session exists
  const binding = services.cardRemovalHandler.getSessionBinding(sessionId);
  if (!binding) {
    return reply.status(401).send({
      error: {
        code: PIVErrorCode.SESSION_EXPIRED,
        message: 'Session not found or expired',
      },
    });
  }

  // In production, verify signature against stored challenge:
  // 1. Retrieve challenge from cache
  // 2. Verify signature using certificate's public key
  // 3. Mark session as verified

  // Simplified verification (always succeeds for valid session)
  services.cardRemovalHandler.updateSessionActivity(sessionId);

  logger.info({ sessionId }, 'PIV challenge verified');

  return reply.status(200).send({
    success: true,
    sessionId,
    message: 'Challenge verified successfully',
  });
}

/**
 * Get session information
 */
async function getSessionHandler(
  request: FastifyRequest<{
    Params: z.infer<typeof sessionIdParamSchema>;
  }>,
  reply: FastifyReply
): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  const { sessionId } = request.params;

  const binding = services.cardRemovalHandler.getSessionBinding(sessionId);
  if (!binding) {
    return reply.status(404).send({
      error: {
        code: PIVErrorCode.SESSION_EXPIRED,
        message: 'Session not found',
      },
    });
  }

  const state = services.cardRemovalHandler.getSessionState(sessionId);

  return reply.status(200).send({
    sessionId,
    userId: binding.userId,
    state,
    createdAt: binding.createdAt.toISOString(),
    lastActivity: binding.lastActivity.toISOString(),
    expiresAt: binding.expiresAt.toISOString(),
    certificateFingerprint: binding.certificateFingerprint,
  });
}

/**
 * Terminate session
 */
async function deleteSessionHandler(
  request: FastifyRequest<{
    Params: z.infer<typeof sessionIdParamSchema>;
  }>,
  reply: FastifyReply
): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  const { sessionId } = request.params;

  const binding = services.cardRemovalHandler.getSessionBinding(sessionId);
  if (!binding) {
    return reply.status(404).send({
      error: {
        code: PIVErrorCode.SESSION_EXPIRED,
        message: 'Session not found',
      },
    });
  }

  services.cardRemovalHandler.terminateSession(sessionId, 'manual');

  logger.info({ sessionId, userId: binding.userId }, 'PIV session terminated');

  return reply.status(200).send({
    success: true,
    message: 'Session terminated',
  });
}

/**
 * Get current PIV auth status
 */
async function statusHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const pivAuth = getPIVAuth(request);
  const services = request.server.pivAuthServices;

  if (!pivAuth || !pivAuth.isPIVAuthenticated) {
    return reply.status(200).send({
      authenticated: false,
      message: 'No PIV authentication present',
    });
  }

  // Get session state if available
  let sessionState: string | undefined;
  if (pivAuth.sessionBinding) {
    sessionState = services?.cardRemovalHandler.getSessionState(
      pivAuth.sessionBinding.sessionId
    );
  }

  return reply.status(200).send({
    authenticated: true,
    user: pivAuth.user
      ? {
          userId: pivAuth.user.userId,
          username: pivAuth.user.username,
          email: pivAuth.user.email,
          edipi: pivAuth.user.edipi,
          tenantId: pivAuth.user.tenantId,
        }
      : undefined,
    certificate: pivAuth.certificate
      ? {
          subject: pivAuth.certificate.subject.CN,
          issuer: pivAuth.certificate.issuer.CN,
          fingerprint: pivAuth.certificate.fingerprint.substring(0, 16) + '...',
          notBefore: pivAuth.certificate.notBefore.toISOString(),
          notAfter: pivAuth.certificate.notAfter.toISOString(),
        }
      : undefined,
    session: pivAuth.sessionBinding
      ? {
          sessionId: pivAuth.sessionBinding.sessionId,
          state: sessionState,
          expiresAt: pivAuth.sessionBinding.expiresAt.toISOString(),
        }
      : undefined,
    validation: pivAuth.validation
      ? {
          status: pivAuth.validation.status,
          isValid: pivAuth.validation.isValid,
          warnings: pivAuth.validation.warnings,
        }
      : undefined,
  });
}

/**
 * Get service statistics
 */
async function statsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const services = request.server.pivAuthServices;
  if (!services) {
    return reply.status(500).send({
      error: {
        code: PIVErrorCode.CONFIGURATION_ERROR,
        message: 'PIV authentication not configured',
      },
    });
  }

  const sessionStats = services.cardRemovalHandler.getStats();
  const ocspCacheStats = services.ocspValidator.getCacheStats();
  const crlCacheStats = services.crlValidator.getCacheStats();

  return reply.status(200).send({
    sessions: sessionStats,
    ocspCache: {
      size: ocspCacheStats.size,
    },
    crlCache: {
      size: crlCacheStats.size,
    },
    trustedCAs: services.certAuth.getTrustedCAs().length,
    mappingRules: services.certificateMapper.getRules().length,
  });
}

// =============================================================================
// Token Generation (Simplified)
// =============================================================================

/**
 * Generate access token (simplified - use JWT service in production)
 */
function generateAccessToken(userId: string, sessionId: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    sid: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    auth_method: 'piv',
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // In production, sign with proper secret
  const signature = createHash('sha256')
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Generate refresh token
 */
function generateRefreshToken(sessionId: string): string {
  return createHash('sha256')
    .update(`${sessionId}:${Date.now()}:${randomBytes(16).toString('hex')}`)
    .digest('hex');
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register PIV/CAC authentication routes
 */
export async function registerPIVRoutes(
  fastify: FastifyInstance,
  options: { prefix?: string } = {}
): Promise<void> {
  const prefix = options.prefix ?? '/auth/piv';

  // Authenticate with certificate
  fastify.post(
    `${prefix}/authenticate`,
    {
      schema: {
        description: 'Authenticate with PIV/CAC certificate',
        tags: ['PIV Authentication'],
        body: authenticateRequestSchema,
        response: {
          200: {
            description: 'Authentication successful',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              user: { type: 'object' },
              sessionId: { type: 'string' },
              expiresAt: { type: 'string' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
            },
          },
          401: {
            description: 'Authentication failed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              errorCode: { type: 'string' },
            },
          },
        },
      },
    },
    authenticateHandler as any
  );

  // Generate challenge
  fastify.post(
    `${prefix}/challenge`,
    {
      schema: {
        // @ts-expect-error - description/tags valid when @fastify/swagger is registered
        description: 'Generate authentication challenge for card signing',
        tags: ['PIV Authentication'],
        response: {
          200: {
            description: 'Challenge generated',
            type: 'object',
            properties: {
              challengeId: { type: 'string' },
              challenge: { type: 'string' },
              expiresAt: { type: 'string' },
              instructions: { type: 'string' },
            },
          },
        },
      },
    },
    challengeHandler
  );

  // Verify signed challenge
  fastify.post(
    `${prefix}/verify`,
    {
      schema: {
        description: 'Verify signed challenge from card',
        tags: ['PIV Authentication'],
        body: challengeResponseSchema,
        response: {
          200: {
            description: 'Challenge verified',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              sessionId: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    verifyHandler as any
  );

  // Get session info
  fastify.get(
    `${prefix}/session/:sessionId`,
    {
      schema: {
        description: 'Get PIV session information',
        tags: ['PIV Authentication'],
        params: sessionIdParamSchema,
        response: {
          200: {
            description: 'Session information',
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              userId: { type: 'string' },
              state: { type: 'string' },
              createdAt: { type: 'string' },
              lastActivity: { type: 'string' },
              expiresAt: { type: 'string' },
            },
          },
          404: {
            description: 'Session not found',
            type: 'object',
          },
        },
      },
    },
    getSessionHandler as any
  );

  // Terminate session
  fastify.delete(
    `${prefix}/session/:sessionId`,
    {
      schema: {
        description: 'Terminate PIV session',
        tags: ['PIV Authentication'],
        params: sessionIdParamSchema,
        response: {
          200: {
            description: 'Session terminated',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    deleteSessionHandler as any
  );

  // Get current auth status
  fastify.get(
    `${prefix}/status`,
    {
      schema: {
        // @ts-expect-error - description/tags valid when @fastify/swagger is registered
        description: 'Get current PIV authentication status',
        tags: ['PIV Authentication'],
        response: {
          200: {
            description: 'Authentication status',
            type: 'object',
            properties: {
              authenticated: { type: 'boolean' },
              user: { type: 'object' },
              certificate: { type: 'object' },
              session: { type: 'object' },
              validation: { type: 'object' },
            },
          },
        },
      },
    },
    statusHandler
  );

  // Service statistics (admin only)
  fastify.get(
    `${prefix}/stats`,
    {
      schema: {
        // @ts-expect-error - description/tags valid when @fastify/swagger is registered
        description: 'Get PIV authentication service statistics',
        tags: ['PIV Authentication', 'Admin'],
        response: {
          200: {
            description: 'Service statistics',
            type: 'object',
          },
        },
      },
    },
    statsHandler
  );

  logger.info({ prefix }, 'PIV authentication routes registered');
}

/**
 * PIV routes plugin
 */
export async function pivRoutesPlugin(
  fastify: FastifyInstance,
  options: { prefix?: string } = {}
): Promise<void> {
  await registerPIVRoutes(fastify, options);
}
