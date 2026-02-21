/**
 * MFA Middleware for Fastify
 *
 * Provides middleware to enforce MFA verification on protected routes.
 * Can be used as a preHandler hook or route-level middleware.
 *
 * @packageDocumentation
 */

import type {
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import { createLogger } from '../../common/logger.js';
import { UnauthorizedError, ForbiddenError } from '../../common/errors.js';
import { getMfaService, type MfaService } from './mfa-service.js';
import type { MfaMiddlewareOptions } from './types.js';

const logger = createLogger({ component: 'mfa-middleware' });

// =============================================================================
// Types
// =============================================================================

/**
 * Extended request interface with MFA context
 */
export interface MfaRequestContext {
  /** Whether MFA is required for this user */
  mfaRequired: boolean;
  /** Whether MFA has been verified for this session */
  mfaVerified: boolean;
  /** Whether user is in grace period */
  inGracePeriod: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    mfaContext?: MfaRequestContext;
  }
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create MFA middleware that requires MFA verification
 *
 * This middleware checks if the user has MFA enabled and whether the current
 * session has completed MFA verification. If MFA is required but not verified,
 * it returns a 403 response with MFA challenge information.
 *
 * @param options - Middleware configuration options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * // Apply to specific routes
 * fastify.route({
 *   method: 'POST',
 *   url: '/api/v1/sensitive-action',
 *   preHandler: [requireMfa()],
 *   handler: sensitiveActionHandler,
 * });
 *
 * // Apply globally with skip paths
 * fastify.addHook('preHandler', requireMfa({
 *   skipPaths: ['/health', '/api/v1/mfa/challenge'],
 *   allowGracePeriod: true,
 * }));
 * ```
 */
export function requireMfa(options: MfaMiddlewareOptions = {}): preHandlerHookHandler {
  const {
    allowGracePeriod = true,
    skipPaths = [],
  } = options;

  const skipPathSet = new Set(skipPaths);
  const mfaService = getMfaService();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip configured paths
    const requestPath = request.routeOptions.url ?? request.url;
    if (skipPathSet.has(requestPath) || skipPathSet.has(request.url)) {
      return;
    }

    // Extract user and session information
    const userId = extractUserId(request, options);
    const tenantId = extractTenantId(request, options);
    const sessionId = extractSessionId(request, options);

    // If we can't identify the user, skip MFA check (let auth middleware handle it)
    if (!userId || !tenantId || !sessionId) {
      logger.debug(
        { userId, tenantId, sessionId: !!sessionId },
        'Skipping MFA check: missing context'
      );
      return;
    }

    try {
      // Get MFA status for user
      const status = await mfaService.getMfaStatus(userId, tenantId);

      // Initialize MFA context
      request.mfaContext = {
        mfaRequired: status.enabled,
        mfaVerified: false,
        inGracePeriod: status.inGracePeriod,
      };

      // If MFA is not enabled, proceed
      if (!status.enabled) {
        return;
      }

      // If in grace period and allowed, proceed
      if (status.inGracePeriod && allowGracePeriod) {
        request.mfaContext.inGracePeriod = true;
        logger.debug({ userId }, 'MFA in grace period, allowing request');
        return;
      }

      // Check if MFA is required for this session
      const requiresMfa = await mfaService.requiresMfa(userId, tenantId, sessionId);

      if (!requiresMfa) {
        request.mfaContext.mfaVerified = true;
        return;
      }

      // MFA is required but not verified
      logger.info({ userId, path: request.url }, 'MFA required but not verified');

      return reply.status(403).send({
        success: false,
        error: {
          code: 'MFA_REQUIRED',
          message: 'Multi-factor authentication is required',
          details: {
            mfaEnabled: true,
            mfaVerified: false,
            challengeEndpoint: '/api/v1/mfa/challenge',
          },
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, userId }, 'Error checking MFA status');
      throw error;
    }
  };
}

/**
 * Create MFA context middleware (non-blocking)
 *
 * This middleware decorates the request with MFA context information
 * but does not block the request. Useful for routes that need to know
 * MFA status but don't require it.
 *
 * @param options - Middleware configuration options
 * @returns Fastify preHandler hook
 */
export function mfaContextMiddleware(options: MfaMiddlewareOptions = {}): preHandlerHookHandler {
  const { skipPaths = [] } = options;
  const skipPathSet = new Set(skipPaths);
  const mfaService = getMfaService();

  return async (request: FastifyRequest): Promise<void> => {
    // Skip configured paths
    const requestPath = request.routeOptions.url ?? request.url;
    if (skipPathSet.has(requestPath) || skipPathSet.has(request.url)) {
      return;
    }

    // Extract user and session information
    const userId = extractUserId(request, options);
    const tenantId = extractTenantId(request, options);
    const sessionId = extractSessionId(request, options);

    // Initialize default context
    request.mfaContext = {
      mfaRequired: false,
      mfaVerified: false,
      inGracePeriod: false,
    };

    if (!userId || !tenantId || !sessionId) {
      return;
    }

    try {
      const status = await mfaService.getMfaStatus(userId, tenantId);

      request.mfaContext = {
        mfaRequired: status.enabled,
        mfaVerified: !status.enabled || !(await mfaService.requiresMfa(userId, tenantId, sessionId)),
        inGracePeriod: status.inGracePeriod,
      };
    } catch (error) {
      logger.debug({ error, userId }, 'Error getting MFA context');
    }
  };
}

/**
 * Create middleware that requires MFA to be enabled for the user
 *
 * This is useful for sensitive operations that should only be available
 * to users with MFA enabled, regardless of current verification status.
 */
export function requireMfaEnabled(options: MfaMiddlewareOptions = {}): preHandlerHookHandler {
  const { skipPaths = [] } = options;
  const skipPathSet = new Set(skipPaths);
  const mfaService = getMfaService();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip configured paths
    const requestPath = request.routeOptions.url ?? request.url;
    if (skipPathSet.has(requestPath) || skipPathSet.has(request.url)) {
      return;
    }

    const userId = extractUserId(request, options);
    const tenantId = extractTenantId(request, options);

    if (!userId || !tenantId) {
      throw new UnauthorizedError('Authentication required');
    }

    const status = await mfaService.getMfaStatus(userId, tenantId);

    if (!status.enabled) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'MFA_NOT_ENABLED',
          message: 'Multi-factor authentication must be enabled to access this resource',
          details: {
            enrollmentEndpoint: '/api/v1/mfa/enroll',
          },
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract user ID from request
 */
function extractUserId(
  request: FastifyRequest,
  options: MfaMiddlewareOptions
): string | undefined {
  if (options.extractUserId) {
    return options.extractUserId(request);
  }

  // Try common JWT payload locations
  const user = (request as FastifyRequest & { user?: Record<string, unknown> }).user;
  return (user?.sub ?? user?.userId ?? user?.id) as string | undefined;
}

/**
 * Extract tenant ID from request
 */
function extractTenantId(
  request: FastifyRequest,
  options: MfaMiddlewareOptions
): string | undefined {
  if (options.extractTenantId) {
    return options.extractTenantId(request);
  }

  // Try common JWT payload locations
  const user = (request as FastifyRequest & { user?: Record<string, unknown> }).user;
  return (user?.tenantId ?? user?.tenant_id) as string | undefined;
}

/**
 * Extract session ID from request
 */
function extractSessionId(
  request: FastifyRequest,
  options: MfaMiddlewareOptions
): string | undefined {
  if (options.extractSessionId) {
    return options.extractSessionId(request);
  }

  // Try common locations: JWT jti claim, session cookie, or header
  const user = (request as FastifyRequest & { user?: Record<string, unknown> }).user;
  const jti = user?.jti as string | undefined;

  if (jti) {
    return jti;
  }

  // Try session header
  const sessionHeader = request.headers['x-session-id'];
  if (typeof sessionHeader === 'string') {
    return sessionHeader;
  }

  // Use request ID as fallback (not ideal but ensures uniqueness per request)
  return request.id;
}

// =============================================================================
// Exports
// =============================================================================

export {
  type MfaMiddlewareOptions,
};
