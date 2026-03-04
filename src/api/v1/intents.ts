/**
 * API v1 Intent Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { getConfig } from '../../common/config.js';
import {
  createIntentService,
  intentSubmissionSchema,
  bulkIntentSubmissionSchema,
} from '../../intent/index.js';
import { enqueueIntentSubmission } from '../../intent/queues.js';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendCursorPaginated,
} from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';
import type { IntentStatus } from '../../common/types.js';
import { INTENT_STATUSES } from '../../common/types.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { recordAuditEvent } from '../middleware/audit.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';
import {
  type TenantContext,
  getTenantContext,
  requireTenantContext,
  createTenantContext,
  type ValidatedJwtPayload,
} from '../../common/tenant-context.js';

// Rate limit configurations for intent endpoints
const intentRateLimits = {
  create: createEndpointRateLimit({ max: 100, windowSeconds: 60 }),
  bulkCreate: createEndpointRateLimit({ max: 5, windowSeconds: 60 }),
  cancel: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  delete: createEndpointRateLimit({ max: 20, windowSeconds: 3600 }),
  replay: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
};

const intentLogger = createLogger({ component: 'api-v1-intents' });
const intentService = createIntentService();
const config = getConfig();

const intentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const intentListQuerySchema = z.object({
  entityId: z.string().uuid().optional(),
  status: z
    .string()
    .refine((value): value is IntentStatus => INTENT_STATUSES.includes(value as IntentStatus), {
      message: 'Invalid status',
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
});

const intentCancelBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * Get secure tenant context from request.
 * SECURITY: Tenant ID is extracted ONLY from the validated JWT token.
 */
async function getSecureTenantContext(request: FastifyRequest): Promise<TenantContext> {
  const payload = await request.jwtVerify<ValidatedJwtPayload>();

  if (!payload.tid) {
    throw new ForbiddenError('Tenant context missing from token');
  }

  if (!payload.sub) {
    throw new ForbiddenError('User identifier missing from token');
  }

  await requireTenantMembership(payload.sub, payload.tid);

  return createTenantContext(payload, { traceId: request.id });
}

/**
 * Register v1 intent routes
 */
export async function registerIntentRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Create intent
  fastify.post('/intents', {
    preHandler: intentRateLimits.create,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const body = intentSubmissionSchema.parse(request.body ?? {});
    const intent = await intentService.submit(body, { ctx });

    // Record audit event for intent creation
    await recordAuditEvent(request, {
      eventType: 'intent.created',
      resourceType: 'intent',
      resourceId: intent.id,
      afterState: intent as unknown as Record<string, unknown>,
      metadata: {
        intentType: intent.intentType,
        entityId: intent.entityId,
      },
    });

    return sendSuccess(reply, intent, HttpStatus.ACCEPTED, request);
  });

  // Bulk create intents
  fastify.post('/intents/bulk', {
    preHandler: intentRateLimits.bulkCreate,
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const body = bulkIntentSubmissionSchema.parse(request.body ?? {});

    const result = await intentService.submitBulk(body.intents, {
      ctx,
      stopOnError: body.options?.stopOnError ?? false,
    });

    let status: number;
    if (result.stats.failed === 0) {
      status = HttpStatus.ACCEPTED;
    } else if (result.stats.succeeded > 0) {
      status = 207;
    } else {
      status = HttpStatus.BAD_REQUEST;
    }

    return reply.status(status).send({
      data: result,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Get intent by ID
  fastify.get('/intents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = intentIdParamsSchema.parse(request.params ?? {});
    const result = await intentService.getWithEvents(ctx, params.id);
    if (!result) {
      return sendNotFound(reply, 'Intent', request);
    }
    return sendSuccess(reply, {
      ...result.intent,
      events: result.events,
      evaluations: result.evaluations ?? [],
    }, HttpStatus.OK, request);
  });

  // List intents
  fastify.get('/intents', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const query = intentListQuerySchema.parse(request.query ?? {});
    const listOptions: Parameters<typeof intentService.list>[0] = { ctx };
    if (query.entityId) listOptions.entityId = query.entityId;
    if (query.status) listOptions.status = query.status as IntentStatus;
    if (query.limit) listOptions.limit = query.limit;
    if (query.cursor) listOptions.cursor = query.cursor;
    const result = await intentService.list(listOptions);

    return sendCursorPaginated(reply, result.items, {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    }, request);
  });

  // Cancel intent
  fastify.post('/intents/:id/cancel', {
    preHandler: intentRateLimits.cancel,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = intentIdParamsSchema.parse(request.params ?? {});
    const body = intentCancelBodySchema.parse(request.body ?? {});

    // Capture before state for audit logging
    const beforeIntent = await intentService.get(ctx, params.id);

    const cancelledBy = (request.user as { sub?: string })?.sub;
    const intent = await intentService.cancel(params.id, cancelledBy
      ? { ctx, reason: body.reason, cancelledBy }
      : { ctx, reason: body.reason }
    );

    if (!intent) {
      return sendError(
        reply,
        'INTENT_NOT_FOUND_OR_NOT_CANCELLABLE',
        'Intent not found or cannot be cancelled in current state',
        HttpStatus.NOT_FOUND,
        undefined,
        request
      );
    }

    // Record audit event for intent cancellation
    await recordAuditEvent(request, {
      eventType: 'intent.cancelled',
      resourceType: 'intent',
      resourceId: intent.id,
      beforeState: beforeIntent as unknown as Record<string, unknown>,
      afterState: intent as unknown as Record<string, unknown>,
      reason: body.reason,
      metadata: {
        intentType: intent.intentType,
        entityId: intent.entityId,
        previousStatus: beforeIntent?.status,
      },
    });

    return sendSuccess(reply, intent, HttpStatus.OK, request);
  });

  // Delete intent (GDPR soft delete)
  fastify.delete('/intents/:id', {
    preHandler: intentRateLimits.delete,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = intentIdParamsSchema.parse(request.params ?? {});

    const intent = await intentService.delete(ctx, params.id);

    if (!intent) {
      return reply.status(404).send({
        error: { code: 'INTENT_NOT_FOUND', message: 'Intent not found' },
      });
    }

    return reply.status(204).send();
  });

  // Verify event chain integrity
  fastify.get('/intents/:id/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = intentIdParamsSchema.parse(request.params ?? {});

    const intent = await intentService.get(ctx, params.id);
    if (!intent) {
      return reply.status(404).send({
        error: { code: 'INTENT_NOT_FOUND', message: 'Intent not found' },
      });
    }

    const verification = await intentService.verifyEventChain(params.id);
    return reply.send(verification);
  });

  // Replay intent
  fastify.post('/intents/:id/replay', {
    preHandler: intentRateLimits.replay,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = intentIdParamsSchema.parse(request.params ?? {});

    const intent = await intentService.get(ctx, params.id);
    if (!intent) {
      return reply.status(404).send({
        error: { code: 'INTENT_NOT_FOUND', message: 'Intent not found' },
      });
    }

    if (!['failed', 'denied'].includes(intent.status)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_STATE',
          message: `Cannot replay intent in ${intent.status} status`,
        },
      });
    }

    await intentService.updateStatus(ctx, params.id, 'pending', intent.status);
    const enqueueOptions = intent.intentType
      ? { namespace: intent.intentType }
      : {};
    await enqueueIntentSubmission(intent, enqueueOptions);

    return reply.send({
      message: 'Intent queued for replay',
      intentId: params.id,
    });
  });

  intentLogger.debug('Intent routes registered');
}
