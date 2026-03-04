/**
 * API v1 Operation Status Routes
 *
 * Provides endpoints for tracking async operation status and progress.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { getOperationTracker, type AsyncOperation } from '../../common/operation-tracker.js';

/**
 * Extend FastifyRequest to include JWT methods when JWT plugin is registered
 */
declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify<T = Record<string, unknown>>(): Promise<T>;
  }
}

const operationsLogger = createLogger({ component: 'api-v1-operations' });

const operationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const operationQuerySchema = z.object({
  wait: z.coerce.boolean().optional().default(false),
  timeout: z.coerce.number().int().min(1000).max(30000).optional().default(30000),
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

/**
 * Format operation response
 */
function formatOperationResponse(operation: AsyncOperation, baseUrl: string) {
  return {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    progress: {
      current: operation.progress.current,
      total: operation.progress.total,
      percentage: operation.progress.total > 0
        ? Math.round((operation.progress.current / operation.progress.total) * 100)
        : 0,
    },
    result: operation.result,
    error: operation.error,
    metadata: operation.metadata,
    createdAt: operation.createdAt.toISOString(),
    completedAt: operation.completedAt?.toISOString(),
    _links: {
      self: `${baseUrl}/api/v1/operations/${operation.id}`,
    },
  };
}

/**
 * Register v1 operation status routes
 */
export async function registerOperationRoutesV1(fastify: FastifyInstance): Promise<void> {
  const operationTracker = getOperationTracker();

  /**
   * Get operation status
   *
   * GET /operations/:id
   *
   * Query parameters:
   * - wait: boolean - If true, long-poll until completion or timeout
   * - timeout: number - Max wait time in ms (1000-30000, default 30000)
   *
   * Returns:
   * - 200 OK with operation details
   * - 404 Not Found if operation doesn't exist or belongs to different tenant
   */
  fastify.get('/operations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = operationIdParamsSchema.parse(request.params ?? {});
    const query = operationQuerySchema.parse(request.query ?? {});

    const operation = query.wait
      ? await operationTracker.getOperationWithWait(params.id, tenantId, true, query.timeout)
      : await operationTracker.getOperation(params.id, tenantId);

    if (!operation) {
      return reply.status(404).send({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    // Get the protocol and host from the request
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    return reply.send(formatOperationResponse(operation, baseUrl));
  });

  /**
   * Get operation progress (fast endpoint)
   *
   * GET /operations/:id/progress
   *
   * Returns just the progress information for fast polling.
   */
  fastify.get('/operations/:id/progress', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = operationIdParamsSchema.parse(request.params ?? {});

    // Verify operation belongs to tenant first
    const operation = await operationTracker.getOperation(params.id, tenantId);
    if (!operation) {
      return reply.status(404).send({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    // Get fast progress from Redis
    const progress = await operationTracker.getProgress(params.id);

    if (!progress) {
      return reply.status(404).send({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    return reply.send({
      id: params.id,
      status: progress.status,
      progress: {
        current: progress.current,
        total: progress.total,
        percentage: progress.total > 0
          ? Math.round((progress.current / progress.total) * 100)
          : 0,
      },
    });
  });

  operationsLogger.debug('Operation routes registered');
}
