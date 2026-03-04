/**
 * API v1 GDPR Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  createGdprService,
  enqueueGdprExport,
} from '../../intent/gdpr.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';
import { getOperationTracker } from '../../common/operation-tracker.js';

const gdprLogger = createLogger({ component: 'api-v1-gdpr' });

// Rate limit configurations for GDPR endpoints - very restrictive
const gdprRateLimits = {
  export: createEndpointRateLimit({ max: 3, windowSeconds: 3600 }), // 3 per hour
  erasure: createEndpointRateLimit({ max: 1, windowSeconds: 86400 }), // 1 per day
};
const gdprService = createGdprService();

const gdprExportBodySchema = z.object({
  userId: z.string().uuid(),
});

const gdprRequestIdParamsSchema = z.object({
  requestId: z.string().uuid(),
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
 * Register v1 GDPR routes
 */
export async function registerGdprRoutesV1(fastify: FastifyInstance): Promise<void> {
  const operationTracker = getOperationTracker();

  // Initiate GDPR data export
  // Rate limit: 3 per hour - GDPR exports are resource intensive
  fastify.post('/intent/gdpr/export', {
    preHandler: gdprRateLimits.export,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string };
    const body = gdprExportBodySchema.parse(request.body ?? {});

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'gdpr_export',
      tenantId,
      createdBy: user.sub,
      metadata: {
        targetUserId: body.userId,
        initiatedBy: user.sub,
      },
    });

    const exportRequest = await gdprService.createExportRequest(
      body.userId,
      tenantId,
      user.sub ?? 'unknown'
    );

    await enqueueGdprExport(exportRequest.id, body.userId, tenantId);

    // Update operation with export request ID
    await operationTracker.updateProgress(operationId, 0, 1);

    gdprLogger.info(
      { operationId, requestId: exportRequest.id, userId: body.userId, tenantId },
      'GDPR export initiated'
    );

    // Get base URL for status endpoint
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

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
  fastify.get('/intent/gdpr/export/:requestId', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = gdprRequestIdParamsSchema.parse(request.params ?? {});

    const exportRequest = await gdprService.getExportRequest(params.requestId, tenantId);
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
  fastify.get('/intent/gdpr/export/:requestId/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = gdprRequestIdParamsSchema.parse(request.params ?? {});

    const exportData = await gdprService.getExportData(params.requestId, tenantId);
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

  // GDPR right to erasure
  // Rate limit: 1 per day - irreversible operation
  // Now uses async operation tracking for consistency
  fastify.post('/intent/gdpr/erase', {
    preHandler: gdprRateLimits.erasure,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const body = gdprExportBodySchema.parse(request.body ?? {});

    const roles = user.roles ?? [];
    const isAdmin = roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('gdpr:admin');
    const isSelfRequest = user.sub === body.userId;

    if (!isAdmin && !isSelfRequest) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators or the data subject can request data erasure',
        },
      });
    }

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'gdpr_erase',
      tenantId,
      createdBy: user.sub,
      metadata: {
        targetUserId: body.userId,
        initiatedBy: user.sub,
        isSelfRequest,
      },
    });

    gdprLogger.info(
      { operationId, userId: body.userId, tenantId, erasedBy: user.sub },
      'GDPR erasure operation started'
    );

    // Process erasure asynchronously
    setImmediate(async () => {
      try {
        await operationTracker.updateProgress(operationId, 0, 1);

        const result = await gdprService.eraseUserData(
          body.userId,
          tenantId,
          user.sub ?? 'unknown'
        );

        await operationTracker.completeOperation(operationId, {
          message: 'User data has been erased in compliance with GDPR Article 17',
          userId: result.userId,
          erasedAt: result.erasedAt,
          counts: result.counts,
        });

        gdprLogger.info(
          { operationId, userId: body.userId, tenantId, erasedBy: user.sub, counts: result.counts },
          'GDPR data erasure completed'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await operationTracker.failOperation(operationId, errorMessage);
        gdprLogger.error(
          { operationId, userId: body.userId, tenantId, error: errorMessage },
          'GDPR data erasure failed'
        );
      }
    });

    // Get base URL for status endpoint
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    return reply.status(202).send({
      operationId,
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
  fastify.delete('/intent/gdpr/data', {
    preHandler: gdprRateLimits.erasure,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const body = gdprExportBodySchema.parse(request.body ?? {});

    const roles = user.roles ?? [];
    const isAdmin = roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('gdpr:admin');
    const isSelfRequest = user.sub === body.userId;

    if (!isAdmin && !isSelfRequest) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators or the data subject can request data erasure',
        },
      });
    }

    const result = await gdprService.eraseUserData(
      body.userId,
      tenantId,
      user.sub ?? 'unknown'
    );

    gdprLogger.info(
      { userId: body.userId, tenantId, erasedBy: user.sub, counts: result.counts },
      'GDPR data erasure completed'
    );

    return reply.send({
      message: 'User data has been erased in compliance with GDPR Article 17',
      userId: result.userId,
      erasedAt: result.erasedAt,
      counts: result.counts,
    });
  });

  gdprLogger.debug('GDPR routes registered');
}
