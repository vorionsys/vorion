/**
 * API v1 Admin Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { retryDeadLetterJob } from '../../intent/queues.js';
import { runCleanupNow } from '../../intent/scheduler.js';
import {
  createTokenRevocationService,
  recordTokenRevocationAudit,
} from '../../common/token-revocation.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../middleware/audit.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';

const adminLogger = createLogger({ component: 'api-v1-admin' });

// Rate limit configurations for admin endpoints
const adminRateLimits = {
  cleanup: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  dlqRetry: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  revokeTokens: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  modifyUser: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
};
const tokenRevocationService = createTokenRevocationService();

const dlqRetryParamsSchema = z.object({
  jobId: z.string(),
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

async function getTenantId(request: FastifyRequest): Promise<string> {
  const payload = await request.jwtVerify<{ tenantId?: string; sub?: string }>();

  if (!payload.tenantId) {
    throw new ForbiddenError('Tenant context missing from token');
  }

  if (!payload.sub) {
    throw new ForbiddenError('User identifier missing from token');
  }

  await requireTenantMembership(payload.sub, payload.tenantId);
  return payload.tenantId;
}

function isAdmin(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('system:admin');
}

/**
 * Register v1 admin routes
 */
export async function registerAdminRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Trigger cleanup job manually
  // Rate limit: 30 requests per minute with per-user tracking
  fastify.post('/admin/cleanup', {
    preHandler: [adminRateLimits.cleanup, rateLimit({ limit: 10, windowSeconds: 60 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles)) {
      adminLogger.warn({ userId: user.sub }, 'Unauthorized cleanup attempt');
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    adminLogger.info({ userId: user.sub }, 'Manual cleanup triggered');
    const result = await runCleanupNow();
    return reply.send(result);
  });

  // Retry a job from DLQ
  // Rate limit: 30 requests per minute with per-user tracking
  fastify.post('/admin/dlq/:jobId/retry', {
    preHandler: [adminRateLimits.dlqRetry, rateLimit({ limit: 10, windowSeconds: 60 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles)) {
      adminLogger.warn({ userId: user.sub }, 'Unauthorized DLQ retry attempt');
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = dlqRetryParamsSchema.parse(request.params ?? {});
    adminLogger.info({ userId: user.sub, jobId: params.jobId }, 'DLQ retry triggered');

    const success = await retryDeadLetterJob(params.jobId);
    if (!success) {
      return reply.status(404).send({
        error: { code: 'JOB_NOT_FOUND', message: 'Dead letter job not found' },
      });
    }

    return reply.send({ message: 'Job retried successfully', jobId: params.jobId });
  });

  // Revoke all tokens for a user
  // Rate limit: 30 requests per minute with per-user tracking
  fastify.post('/admin/users/:userId/revoke-tokens', {
    preHandler: [adminRateLimits.revokeTokens, rateLimit({ limit: 10, windowSeconds: 60 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles) && !roles.includes('security:admin')) {
      adminLogger.warn({ userId: user.sub }, 'Unauthorized token revocation attempt');
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = userIdParamsSchema.parse(request.params ?? {});

    // SECURITY: Validate that target userId belongs to the requesting tenant
    // This prevents cross-tenant token revocation attacks
    try {
      await requireTenantMembership(params.userId, tenantId);
    } catch {
      // Log unauthorized cross-tenant attempt for security audit
      adminLogger.warn(
        {
          adminUserId: user.sub,
          targetUserId: params.userId,
          adminTenantId: tenantId,
          timestamp: new Date().toISOString(),
        },
        'SECURITY_AUDIT: Cross-tenant token revocation attempt blocked'
      );
      return reply.status(403).send({
        error: {
          code: 'CROSS_TENANT_ACCESS_DENIED',
          message: 'Cannot revoke tokens for users outside your tenant',
        },
      });
    }

    const revokeTime = new Date();

    await tokenRevocationService.revokeAllForUser(params.userId, revokeTime);

    await recordTokenRevocationAudit(
      tenantId,
      params.userId,
      'token.user_all_revoked',
      {
        type: 'user',
        id: user.sub ?? 'unknown',
        ip: request.ip,
      },
      {
        targetUserId: params.userId,
        revokedBefore: revokeTime.toISOString(),
        reason: 'admin_revoke_all',
      }
    );

    // Record audit event for token revocation
    await recordAuditEvent(request, {
      eventType: 'admin.token_revoked',
      resourceType: 'user',
      resourceId: params.userId,
      afterState: {
        revokedBefore: revokeTime.toISOString(),
        reason: 'admin_revoke_all',
      },
      metadata: {
        adminUserId: user.sub,
        targetUserId: params.userId,
      },
    });

    adminLogger.info(
      { targetUserId: params.userId, adminUserId: user.sub, revokeTime: revokeTime.toISOString() },
      'All tokens revoked for user'
    );

    return reply.send({
      message: 'All tokens revoked for user',
      userId: params.userId,
      revokedBefore: revokeTime.toISOString(),
    });
  });

  // Modify user settings (placeholder for user modification audit)
  fastify.patch('/admin/users/:userId', {
    preHandler: [adminRateLimits.modifyUser, rateLimit({ limit: 10, windowSeconds: 60 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles)) {
      adminLogger.warn({ userId: user.sub }, 'Unauthorized user modification attempt');
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = userIdParamsSchema.parse(request.params ?? {});
    const body = request.body as Record<string, unknown>;

    // Validate target user belongs to the same tenant
    try {
      await requireTenantMembership(params.userId, tenantId);
    } catch {
      adminLogger.warn(
        {
          adminUserId: user.sub,
          targetUserId: params.userId,
          adminTenantId: tenantId,
        },
        'SECURITY_AUDIT: Cross-tenant user modification attempt blocked'
      );
      return reply.status(403).send({
        error: {
          code: 'CROSS_TENANT_ACCESS_DENIED',
          message: 'Cannot modify users outside your tenant',
        },
      });
    }

    // Record audit event for user modification
    await recordAuditEvent(request, {
      eventType: 'admin.user_modified',
      resourceType: 'user',
      resourceId: params.userId,
      afterState: body,
      metadata: {
        adminUserId: user.sub,
        modifiedFields: Object.keys(body),
      },
    });

    adminLogger.info(
      { targetUserId: params.userId, adminUserId: user.sub, fields: Object.keys(body) },
      'User modified by admin'
    );

    return reply.send({
      message: 'User modified successfully',
      userId: params.userId,
    });
  });

  adminLogger.debug('Admin routes registered');
}
