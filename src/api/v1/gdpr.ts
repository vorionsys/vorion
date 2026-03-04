/**
 * API v1 GDPR Routes
 *
 * These routes implement GDPR data rights with mandatory authorization checks
 * at the service layer. Authorization context is constructed from the JWT token
 * and passed to all GDPR operations.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import {
  createGdprService,
  enqueueGdprExport,
  type GdprAuthorizationContext,
  type GdprRole,
} from '../../intent/gdpr.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { getOperationTracker } from '../../common/operation-tracker.js';
import { getGdprRateLimiter } from '../../intent/gdpr-rate-limiter.js';

const gdprLogger = createLogger({ component: 'api-v1-gdpr' });

const gdprService = createGdprService();
const rateLimiter = getGdprRateLimiter();

const gdprExportBodySchema = z.object({
  userId: z.string().uuid(),
});

const gdprErasureBodySchema = z.object({
  userId: z.string().uuid(),
  /** Required for non-self erasure by admins */
  confirmConsent: z.boolean().optional(),
});

const gdprRequestIdParamsSchema = z.object({
  requestId: z.string().uuid(),
});

/**
 * JWT payload type for GDPR operations
 */
interface GdprJwtPayload {
  tenantId?: string;
  sub?: string;
  roles?: string[];
}

/**
 * Map JWT roles to GdprRole type.
 * Only recognized roles are included; unknown roles are filtered out.
 */
function mapJwtRolesToGdprRoles(jwtRoles: string[] | undefined): GdprRole[] {
  if (!jwtRoles || !Array.isArray(jwtRoles)) {
    return ['user'];
  }

  const validRoles: GdprRole[] = ['admin', 'tenant:admin', 'dpo', 'gdpr:admin', 'user'];
  const mappedRoles = jwtRoles.filter((role): role is GdprRole =>
    validRoles.includes(role as GdprRole)
  );

  // Always include 'user' as base role
  if (!mappedRoles.includes('user')) {
    mappedRoles.push('user');
  }

  return mappedRoles;
}

/**
 * Extract client IP address from request.
 * Handles X-Forwarded-For and other proxy headers.
 */
function getClientIp(request: FastifyRequest): string | undefined {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be a comma-separated list; take the first (client) IP
    const firstIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0];
    return firstIp?.trim();
  }

  const realIp = request.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return request.ip;
}

/**
 * Build GdprAuthorizationContext from the request JWT token.
 * This extracts all necessary authorization information from the JWT
 * and request context to be passed to GDPR service operations.
 *
 * @param request - The Fastify request
 * @param options - Additional options for the context
 * @returns GdprAuthorizationContext for use with GDPR service methods
 * @throws ForbiddenError if tenant or user context is missing
 */
async function buildAuthorizationContext(
  request: FastifyRequest,
  options: { hasExplicitConsent?: boolean } = {}
): Promise<GdprAuthorizationContext> {
  const payload = await request.jwtVerify<GdprJwtPayload>();

  if (!payload.tenantId) {
    throw new ForbiddenError('Tenant context missing from token');
  }

  if (!payload.sub) {
    throw new ForbiddenError('User identifier missing from token');
  }

  // Verify tenant membership
  await requireTenantMembership(payload.sub, payload.tenantId);

  // Generate or extract request ID for correlation
  const requestId = (request.headers['x-request-id'] as string) ?? randomUUID();

  const authContext: GdprAuthorizationContext = {
    requestingUserId: payload.sub,
    requestingUserTenantId: payload.tenantId,
    roles: mapJwtRolesToGdprRoles(payload.roles),
    ipAddress: getClientIp(request),
    requestId,
    hasExplicitConsent: options.hasExplicitConsent,
  };

  gdprLogger.debug(
    {
      requestingUserId: authContext.requestingUserId,
      tenantId: authContext.requestingUserTenantId,
      roles: authContext.roles,
      requestId: authContext.requestId,
    },
    'Built GDPR authorization context from JWT'
  );

  return authContext;
}

/**
 * Set rate limit headers on response
 */
function setRateLimitHeaders(
  reply: FastifyReply,
  retryAfter?: number,
  limit?: number,
  remaining?: number
): void {
  if (limit !== undefined) {
    reply.header('X-RateLimit-Limit', limit);
  }
  if (remaining !== undefined) {
    reply.header('X-RateLimit-Remaining', Math.max(0, remaining));
  }
  if (retryAfter !== undefined) {
    reply.header('Retry-After', retryAfter);
  }
}

/**
 * Create a rate limit error response
 */
function createRateLimitResponse(
  code: string,
  message: string,
  retryAfter: number,
  details?: Record<string, unknown>
): {
  error: {
    code: string;
    message: string;
    retryAfter: number;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      code,
      message,
      retryAfter,
      details,
    },
  };
}

/**
 * Register v1 GDPR routes
 */
export async function registerGdprRoutesV1(fastify: FastifyInstance): Promise<void> {
  const operationTracker = getOperationTracker();

  // Initiate GDPR data export
  // Rate limits (distributed via Redis):
  // - 3 requests per hour per user
  // - Request deduplication (returns existing job if pending)
  // - Max 100 pending jobs per tenant
  // Authorization is enforced at the service layer via GdprAuthorizationContext
  fastify.post('/intent/gdpr/export', async (request: FastifyRequest, reply: FastifyReply) => {
    // Build authorization context from JWT - this includes user, tenant, and roles
    const authContext = await buildAuthorizationContext(request);
    const body = gdprExportBodySchema.parse(request.body ?? {});
    const targetUserId = body.userId;
    const tenantId = authContext.requestingUserTenantId;

    // Check for pending export for this user (deduplication)
    const pendingJobId = await rateLimiter.getPendingJob(targetUserId, 'export');
    if (pendingJobId) {
      gdprLogger.info(
        { userId: targetUserId, tenantId, pendingJobId },
        'Returning existing pending export job'
      );

      // Try to get the existing export request
      try {
        const existingRequest = await gdprService.getExportRequest(
          authContext,
          pendingJobId,
          tenantId
        );

        if (existingRequest) {
          const protocol = request.headers['x-forwarded-proto'] ?? 'http';
          const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
          const baseUrl = `${protocol}://${host}`;

          return reply.code(200).send({
            requestId: existingRequest.id,
            status: existingRequest.status,
            message: 'An export request is already in progress for this user.',
            expiresAt: existingRequest.expiresAt,
            _links: {
              exportStatus: `${baseUrl}/api/v1/intent/gdpr/export/${existingRequest.id}`,
            },
          });
        }
      } catch {
        // If we can't get the existing request, continue with new request
        gdprLogger.debug(
          { userId: targetUserId, pendingJobId },
          'Could not retrieve pending job, creating new request'
        );
      }
    }

    // Check rate limit (distributed via Redis)
    const rateLimitResult = await rateLimiter.checkExportLimit(targetUserId, tenantId);
    if (!rateLimitResult.allowed) {
      setRateLimitHeaders(reply, rateLimitResult.retryAfter, rateLimitResult.limit);

      gdprLogger.warn(
        {
          userId: targetUserId,
          tenantId,
          requestedBy: authContext.requestingUserId,
          retryAfter: rateLimitResult.retryAfter,
          currentCount: rateLimitResult.currentCount,
        },
        'GDPR export rate limit exceeded'
      );

      return reply.status(429).send(
        createRateLimitResponse(
          'GDPR_EXPORT_RATE_LIMIT_EXCEEDED',
          'Too many export requests. GDPR allows up to 3 export requests per hour.',
          rateLimitResult.retryAfter ?? 3600,
          {
            currentCount: rateLimitResult.currentCount,
            limit: rateLimitResult.limit,
          }
        )
      );
    }

    // Check tenant queue depth
    const queueDepthResult = await rateLimiter.checkQueueDepth(tenantId);
    if (!queueDepthResult.allowed) {
      setRateLimitHeaders(reply, queueDepthResult.retryAfter);

      gdprLogger.warn(
        {
          tenantId,
          currentDepth: queueDepthResult.currentDepth,
          maxDepth: queueDepthResult.maxDepth,
        },
        'GDPR queue depth limit exceeded'
      );

      return reply.status(429).send(
        createRateLimitResponse(
          'GDPR_QUEUE_DEPTH_EXCEEDED',
          'Too many pending GDPR jobs for this tenant. Please wait for some jobs to complete.',
          queueDepthResult.retryAfter ?? 60,
          {
            currentDepth: queueDepthResult.currentDepth,
            maxDepth: queueDepthResult.maxDepth,
          }
        )
      );
    }

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'gdpr_export',
      tenantId,
      createdBy: authContext.requestingUserId,
      metadata: {
        targetUserId,
        initiatedBy: authContext.requestingUserId,
        requestingUserRoles: authContext.roles,
      },
    });

    // createExportRequest enforces authorization at the service layer
    // Throws ForbiddenError if user cannot export this data
    const exportRequest = await gdprService.createExportRequest(
      authContext,
      targetUserId,
      tenantId
    );

    // Record the request for rate limiting and deduplication
    await rateLimiter.recordRequest(targetUserId, 'export', exportRequest.id);

    // Enqueue the export job with authorization context for audit trails
    await enqueueGdprExport(
      exportRequest.id,
      targetUserId,
      tenantId,
      authContext
    );

    // Update operation with export request ID
    await operationTracker.updateProgress(operationId, 0, 1);

    gdprLogger.info(
      {
        operationId,
        requestId: exportRequest.id,
        userId: targetUserId,
        tenantId,
        requestedBy: authContext.requestingUserId,
      },
      'GDPR export initiated'
    );

    // Get base URL for status endpoint
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    // Set rate limit headers for successful response
    setRateLimitHeaders(
      reply,
      undefined,
      rateLimitResult.limit,
      rateLimitResult.limit !== undefined && rateLimitResult.currentCount !== undefined
        ? rateLimitResult.limit - rateLimitResult.currentCount - 1
        : undefined
    );

    return reply.code(202).send({
      operationId,
      requestId: exportRequest.id,
      status: exportRequest.status,
      message: 'Export request queued. Use the operationId or requestId to check status.',
      expiresAt: exportRequest.expiresAt,
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
      _links: {
        operationStatus: `${baseUrl}/api/v1/operations/${operationId}`,
        exportStatus: `${baseUrl}/api/v1/intent/gdpr/export/${exportRequest.id}`,
      },
    });
  });

  // Get GDPR export status
  // Authorization is enforced at the service layer - user must own the export or have elevated privileges
  fastify.get('/intent/gdpr/export/:requestId', async (request: FastifyRequest, reply: FastifyReply) => {
    const authContext = await buildAuthorizationContext(request);
    const params = gdprRequestIdParamsSchema.parse(request.params ?? {});

    // getExportRequest enforces authorization at the service layer
    // Throws ForbiddenError if user cannot view this export
    const exportRequest = await gdprService.getExportRequest(
      authContext,
      params.requestId,
      authContext.requestingUserTenantId
    );
    if (!exportRequest) {
      return reply.status(404).send({
        error: {
          code: 'EXPORT_REQUEST_NOT_FOUND',
          message: 'Export request not found or expired',
        },
      });
    }

    return reply.send({
      requestId: exportRequest.id,
      userId: exportRequest.userId,
      status: exportRequest.status,
      requestedAt: exportRequest.requestedAt,
      completedAt: exportRequest.completedAt,
      expiresAt: exportRequest.expiresAt,
      downloadUrl: exportRequest.downloadUrl,
      error: exportRequest.error,
    });
  });

  // Download GDPR export data
  // Authorization is enforced at the service layer - user must own the export or have elevated privileges
  fastify.get('/intent/gdpr/export/:requestId/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const authContext = await buildAuthorizationContext(request);
    const params = gdprRequestIdParamsSchema.parse(request.params ?? {});

    // getExportData enforces authorization at the service layer
    // Throws ForbiddenError if user cannot download this export
    const exportData = await gdprService.getExportData(
      authContext,
      params.requestId,
      authContext.requestingUserTenantId
    );
    if (!exportData) {
      return reply.status(404).send({
        error: {
          code: 'EXPORT_DATA_NOT_FOUND',
          message: 'Export data not found, not ready, or expired',
        },
      });
    }

    return reply
      .header('Content-Type', 'application/json')
      .header(
        'Content-Disposition',
        `attachment; filename="gdpr-export-${exportData.userId}-${exportData.exportTimestamp.split('T')[0]}.json"`
      )
      .send(exportData);
  });

  // GDPR right to erasure (async)
  // Rate limits (distributed via Redis):
  // - 1 request per 24 hours per user
  // - Request deduplication (rejects if pending)
  // - Max 100 pending jobs per tenant
  // Authorization is enforced at the service layer via GdprAuthorizationContext
  // For non-self erasure, confirmConsent must be true in the request body
  fastify.post('/intent/gdpr/erase', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = gdprErasureBodySchema.parse(request.body ?? {});
    const targetUserId = body.userId;

    // Build authorization context with explicit consent flag
    // hasExplicitConsent is required for admin/DPO to erase non-self data
    const authContext = await buildAuthorizationContext(request, {
      hasExplicitConsent: body.confirmConsent === true,
    });
    const tenantId = authContext.requestingUserTenantId;
    const isSelfRequest = authContext.requestingUserId === targetUserId;

    // Check for pending erasure for this user (deduplication)
    const pendingJobId = await rateLimiter.getPendingJob(targetUserId, 'erasure');
    if (pendingJobId) {
      gdprLogger.info(
        { userId: targetUserId, tenantId, pendingJobId },
        'Erasure already in progress for user'
      );

      return reply.status(409).send({
        error: {
          code: 'ERASURE_IN_PROGRESS',
          message: 'An erasure request is already in progress for this user.',
          details: {
            existingJobId: pendingJobId,
          },
        },
      });
    }

    // Check rate limit (distributed via Redis)
    const rateLimitResult = await rateLimiter.checkErasureLimit(targetUserId, tenantId);
    if (!rateLimitResult.allowed) {
      setRateLimitHeaders(reply, rateLimitResult.retryAfter, rateLimitResult.limit);

      gdprLogger.warn(
        {
          userId: targetUserId,
          tenantId,
          requestedBy: authContext.requestingUserId,
          retryAfter: rateLimitResult.retryAfter,
        },
        'GDPR erasure rate limit exceeded'
      );

      return reply.status(429).send(
        createRateLimitResponse(
          'GDPR_ERASURE_RATE_LIMIT_EXCEEDED',
          'Too many erasure requests. GDPR allows up to 1 erasure request per 24 hours.',
          rateLimitResult.retryAfter ?? 86400,
          {
            currentCount: rateLimitResult.currentCount,
            limit: rateLimitResult.limit,
          }
        )
      );
    }

    // Check tenant queue depth
    const queueDepthResult = await rateLimiter.checkQueueDepth(tenantId);
    if (!queueDepthResult.allowed) {
      setRateLimitHeaders(reply, queueDepthResult.retryAfter);

      return reply.status(429).send(
        createRateLimitResponse(
          'GDPR_QUEUE_DEPTH_EXCEEDED',
          'Too many pending GDPR jobs for this tenant. Please wait for some jobs to complete.',
          queueDepthResult.retryAfter ?? 60,
          {
            currentDepth: queueDepthResult.currentDepth,
            maxDepth: queueDepthResult.maxDepth,
          }
        )
      );
    }

    // Generate job ID for tracking
    const jobId = randomUUID();

    // Record the request for rate limiting and deduplication
    await rateLimiter.recordRequest(targetUserId, 'erasure', jobId);

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'gdpr_erase',
      tenantId,
      createdBy: authContext.requestingUserId,
      metadata: {
        targetUserId,
        initiatedBy: authContext.requestingUserId,
        isSelfRequest,
        requestingUserRoles: authContext.roles,
        hasExplicitConsent: authContext.hasExplicitConsent,
        jobId,
      },
    });

    gdprLogger.info(
      {
        operationId,
        jobId,
        userId: targetUserId,
        tenantId,
        erasedBy: authContext.requestingUserId,
        isSelfRequest,
        hasExplicitConsent: authContext.hasExplicitConsent,
      },
      'GDPR erasure operation started'
    );

    // Process erasure asynchronously
    // Authorization is enforced inside eraseUserData
    setImmediate(async () => {
      try {
        await operationTracker.updateProgress(operationId, 0, 1);

        // eraseUserData enforces authorization at the service layer
        // Throws ForbiddenError if user cannot erase this data
        const result = await gdprService.eraseUserData(
          authContext,
          targetUserId,
          tenantId
        );

        // Mark job as completed
        await rateLimiter.completeJob(targetUserId, 'erasure', jobId, tenantId);

        await operationTracker.completeOperation(operationId, {
          message: 'User data has been erased in compliance with GDPR Article 17',
          userId: result.userId,
          erasedAt: result.erasedAt,
          counts: result.counts,
        });

        gdprLogger.info(
          {
            operationId,
            jobId,
            userId: targetUserId,
            tenantId,
            erasedBy: authContext.requestingUserId,
            counts: result.counts,
          },
          'GDPR data erasure completed'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Mark job as failed
        await rateLimiter.failJob(targetUserId, 'erasure', jobId, tenantId);

        await operationTracker.failOperation(operationId, errorMessage);
        gdprLogger.error(
          {
            operationId,
            jobId,
            userId: targetUserId,
            tenantId,
            error: errorMessage,
          },
          'GDPR data erasure failed'
        );
      }
    });

    // Get base URL for status endpoint
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    // Set rate limit headers for successful response
    setRateLimitHeaders(reply, undefined, rateLimitResult.limit, 0);

    return reply.status(202).send({
      operationId,
      jobId,
      status: 'pending',
      message: 'Erasure request accepted. Use the operationId to check status.',
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
      _links: {
        status: `${baseUrl}/api/v1/operations/${operationId}`,
        progress: `${baseUrl}/api/v1/operations/${operationId}/progress`,
      },
    });
  });

  // Keep backwards-compatible DELETE endpoint
  // GDPR right to erasure (legacy sync endpoint)
  // Rate limits: 1 request per 24 hours per user (distributed via Redis)
  // Authorization is enforced at the service layer via GdprAuthorizationContext
  fastify.delete('/intent/gdpr/data', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = gdprErasureBodySchema.parse(request.body ?? {});
    const targetUserId = body.userId;

    // Build authorization context with explicit consent flag
    const authContext = await buildAuthorizationContext(request, {
      hasExplicitConsent: body.confirmConsent === true,
    });
    const tenantId = authContext.requestingUserTenantId;

    // Check for pending erasure for this user (deduplication)
    const pendingJobId = await rateLimiter.getPendingJob(targetUserId, 'erasure');
    if (pendingJobId) {
      return reply.status(409).send({
        error: {
          code: 'ERASURE_IN_PROGRESS',
          message: 'An erasure request is already in progress for this user.',
          details: {
            existingJobId: pendingJobId,
          },
        },
      });
    }

    // Check rate limit (distributed via Redis)
    const rateLimitResult = await rateLimiter.checkErasureLimit(targetUserId, tenantId);
    if (!rateLimitResult.allowed) {
      setRateLimitHeaders(reply, rateLimitResult.retryAfter, rateLimitResult.limit);

      return reply.status(429).send(
        createRateLimitResponse(
          'GDPR_ERASURE_RATE_LIMIT_EXCEEDED',
          'Too many erasure requests. GDPR allows up to 1 erasure request per 24 hours.',
          rateLimitResult.retryAfter ?? 86400,
          {
            currentCount: rateLimitResult.currentCount,
            limit: rateLimitResult.limit,
          }
        )
      );
    }

    // Generate job ID for tracking
    const jobId = randomUUID();

    // Record the request
    await rateLimiter.recordRequest(targetUserId, 'erasure', jobId);

    try {
      // eraseUserData enforces authorization at the service layer
      // Throws ForbiddenError if user cannot erase this data
      const result = await gdprService.eraseUserData(
        authContext,
        targetUserId,
        tenantId
      );

      // Mark job as completed
      await rateLimiter.completeJob(targetUserId, 'erasure', jobId, tenantId);

      gdprLogger.info(
        {
          jobId,
          userId: targetUserId,
          tenantId,
          erasedBy: authContext.requestingUserId,
          counts: result.counts,
        },
        'GDPR data erasure completed (sync)'
      );

      // Set rate limit headers
      setRateLimitHeaders(reply, undefined, rateLimitResult.limit, 0);

      return reply.send({
        message: 'User data has been erased in compliance with GDPR Article 17',
        userId: result.userId,
        erasedAt: result.erasedAt,
        counts: result.counts,
      });
    } catch (error) {
      // Mark job as failed
      await rateLimiter.failJob(targetUserId, 'erasure', jobId, tenantId);
      throw error;
    }
  });

  gdprLogger.debug('GDPR routes registered with distributed rate limiting');
}
