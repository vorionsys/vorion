/**
 * API v1 Escalation Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { getConfig } from '../../common/config.js';
import { createIntentService } from '../../intent/index.js';
import { createEscalationService, type EscalationStatus } from '../../intent/escalation.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import {
  type TenantContext,
  createTenantContext,
  extractTenantId,
  type ValidatedJwtPayload,
} from '../../common/tenant-context.js';
import {
  verifyGroupMembership,
  isAssignedApprover,
  assignApprover,
  removeApprover,
  listApprovers,
} from '../../common/group-membership.js';
import { withRateLimit } from '../rate-limit.js';
import { recordAuditEvent } from '../middleware/audit.js';
import { getOperationTracker } from '../../common/operation-tracker.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';

const escalationLogger = createLogger({ component: 'api-v1-escalations' });

// Rate limit configurations for escalation endpoints
const escalationRateLimits = {
  acknowledge: createEndpointRateLimit({ max: 60, windowSeconds: 60 }),
  approve: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  reject: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  assign: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  removeAssign: createEndpointRateLimit({ max: 20, windowSeconds: 3600 }),
  bulkApprove: createEndpointRateLimit({ max: 5, windowSeconds: 60 }),
  bulkReject: createEndpointRateLimit({ max: 5, windowSeconds: 60 }),
};
const intentService = createIntentService();
const escalationService = createEscalationService();
const config = getConfig();

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

const escalationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const intentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const escalationResolveBodySchema = z.object({
  notes: z.string().max(1000).optional(),
});

const assignApproverBodySchema = z.object({
  userId: z.string().min(1).max(255),
});

/** Valid escalation statuses for filtering */
const escalationStatusSchema = z.enum(['pending', 'acknowledged', 'approved', 'rejected', 'timeout', 'cancelled']);

/** Query schema for listing escalations with cursor-based pagination */
const listEscalationsQuerySchema = z.object({
  status: escalationStatusSchema.optional(),
  escalatedTo: z.string().min(1).max(255).optional(),
  slaBreached: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Schema for bulk operations request body */
const bulkEscalationIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  notes: z.string().max(1000).optional(),
});

/** Schema for filter-based bulk operations */
const bulkEscalationFilterSchema = z.object({
  filter: z.object({
    status: z.enum(['pending', 'acknowledged']).optional(),
    escalatedTo: z.string().min(1).max(255).optional(),
    olderThanMinutes: z.number().int().min(1).optional(),
    olderThanHours: z.number().int().min(1).optional(),
    slaBreached: z.boolean().optional(),
    maxCount: z.number().int().min(1).max(1000).optional().default(100),
  }),
  notes: z.string().max(1000).optional(),
});

/** Schema for SLA metrics query */
const slaMetricsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
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

async function canResolveEscalation(
  user: { sub?: string; roles?: string[]; groups?: string[] },
  escalation: { id: string; escalatedTo: string; tenantId: string },
  userTenantId: string
): Promise<{ allowed: boolean; reason?: string; authMethod?: string }> {
  const userId = user.sub;
  const escalationId = escalation.id;

  if (userTenantId !== escalation.tenantId) {
    escalationLogger.warn(
      { userId, escalationId, userTenantId, escalationTenantId: escalation.tenantId },
      'Authorization denied: tenant mismatch'
    );
    return { allowed: false, reason: 'Escalation belongs to different tenant' };
  }

  const roles = user.roles ?? [];
  if (roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('escalation:admin')) {
    escalationLogger.info(
      { userId, escalationId, authMethod: 'admin_role' },
      'Authorization granted: admin role'
    );
    return { allowed: true, authMethod: 'admin_role' };
  }

  const escalatedTo = escalation.escalatedTo;

  if (userId && escalatedTo === userId) {
    escalationLogger.info(
      { userId, escalationId, authMethod: 'direct_assignment' },
      'Authorization granted: direct user assignment'
    );
    return { allowed: true, authMethod: 'direct_assignment' };
  }

  if (userId) {
    try {
      const approverResult = await isAssignedApprover(escalationId, userId, userTenantId);
      if (approverResult.isApprover) {
        escalationLogger.info(
          { userId, escalationId, authMethod: 'explicit_approver', assignedAt: approverResult.assignedAt },
          'Authorization granted: explicitly assigned approver'
        );
        return { allowed: true, authMethod: 'explicit_approver' };
      }
    } catch (error) {
      escalationLogger.error(
        { error, userId, escalationId },
        'Error checking explicit approver assignment'
      );
    }
  }

  if (userId) {
    try {
      const groupResult = await verifyGroupMembership(userId, escalatedTo, userTenantId);
      if (groupResult.isMember) {
        escalationLogger.info(
          { userId, escalationId, groupName: escalatedTo, authMethod: 'verified_group_membership', source: groupResult.source },
          'Authorization granted: verified group membership'
        );
        return { allowed: true, authMethod: 'verified_group_membership' };
      }
    } catch (error) {
      escalationLogger.error(
        { error, userId, escalationId, groupName: escalatedTo },
        'Error verifying group membership'
      );
    }
  }

  escalationLogger.warn(
    { userId, escalationId, escalatedTo },
    'Authorization denied: no valid authorization method found'
  );

  return {
    allowed: false,
    reason: `User not authorized to resolve escalation (escalatedTo: ${escalatedTo}). Authorization requires: admin role, explicit approver assignment, or verified group membership.`,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if user has admin role
 */
function isAdmin(user: { roles?: string[] }): boolean {
  const roles = user.roles ?? [];
  return roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('escalation:admin');
}

/**
 * Standardized cursor-based pagination response
 */
interface CursorPaginationResponse<T> {
  data: T[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
}

/**
 * Register v1 escalation routes
 */
export async function registerEscalationRoutesV1(fastify: FastifyInstance): Promise<void> {
  // =============================================================================
  // LIST ESCALATIONS - Cursor-based pagination with filters
  // =============================================================================
  fastify.get('/escalations', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const query = listEscalationsQuerySchema.parse(request.query ?? {});
    const { status, escalatedTo, slaBreached, cursor, limit } = query;

    // Build filter options for the escalation service
    const filterOptions: {
      status?: EscalationStatus;
      escalatedTo?: string;
      limit: number;
      cursor?: string;
      includeSlaBreached?: boolean;
    } = {
      limit: limit + 1, // Fetch one extra to determine hasMore
    };

    if (status) {
      filterOptions.status = status;
    }
    if (escalatedTo) {
      filterOptions.escalatedTo = escalatedTo;
    }
    if (cursor) {
      filterOptions.cursor = cursor;
    }
    if (slaBreached !== undefined) {
      filterOptions.includeSlaBreached = slaBreached;
    }

    const escalationsList = await escalationService.list(ctx, filterOptions);

    // Determine if there are more results
    const hasMore = escalationsList.length > limit;
    const items = hasMore ? escalationsList.slice(0, limit) : escalationsList;

    // Get next cursor from last item
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

    // Get total count for the filtered query
    const slaStats = await escalationService.getSlaStats(ctx);
    const total = slaStats.total;

    const response: CursorPaginationResponse<typeof items[0]> = {
      data: items,
      pagination: {
        cursor: nextCursor,
        hasMore,
        total,
      },
    };

    return reply.send(response);
  });

  // Get escalation by ID
  fastify.get('/escalations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = escalationIdParamsSchema.parse(request.params ?? {});
    const escalation = await escalationService.get(params.id, ctx);
    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }
    return reply.send(escalation);
  });

  // Get escalation for intent
  fastify.get('/intents/:id/escalation', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = intentIdParamsSchema.parse(request.params ?? {});

    const intent = await intentService.get(ctx, params.id);
    if (!intent) {
      return reply.status(404).send({
        error: { code: 'INTENT_NOT_FOUND', message: 'Intent not found' },
      });
    }

    const escalation = await escalationService.getByIntentId(params.id, ctx);
    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'No escalation for this intent' },
      });
    }
    return reply.send(escalation);
  });

  // Acknowledge escalation
  fastify.post('/escalations/:id/acknowledge', {
    preHandler: escalationRateLimits.acknowledge,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const params = escalationIdParamsSchema.parse(request.params ?? {});
    const user = request.user as { sub?: string };

    const escalation = await escalationService.acknowledge(params.id, ctx);

    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    return reply.send(escalation);
  });

  // Approve escalation
  fastify.post('/escalations/:id/approve', {
    preHandler: escalationRateLimits.approve,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = escalationIdParamsSchema.parse(request.params ?? {});
    const body = escalationResolveBodySchema.parse(request.body ?? {});
    const user = request.user as { sub?: string; roles?: string[]; groups?: string[] };

    const escalationToCheck = await escalationService.get(params.id, ctx);
    if (!escalationToCheck) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    const authResult = await canResolveEscalation(user, escalationToCheck, tenantId);
    if (!authResult.allowed) {
      escalationLogger.warn(
        { escalationId: params.id, userId: user.sub, reason: authResult.reason },
        'Unauthorized escalation approval attempt'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: authResult.reason ?? 'Not authorized to approve this escalation',
        },
      });
    }

    const resolveOptions = body.notes ? { notes: body.notes } : undefined;
    const escalation = await escalationService.approve(params.id, ctx, resolveOptions);

    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    if (escalation.status === 'approved') {
      await intentService.updateStatus(ctx, escalation.intentId, 'approved', 'escalated');
    }

    // Record audit event for escalation approval
    await recordAuditEvent(request, {
      eventType: 'escalation.approved',
      resourceType: 'escalation',
      resourceId: escalation.id,
      beforeState: escalationToCheck as unknown as Record<string, unknown>,
      afterState: escalation as unknown as Record<string, unknown>,
      metadata: {
        intentId: escalation.intentId,
        escalatedTo: escalation.escalatedTo,
        authMethod: authResult.authMethod,
        notes: body.notes,
      },
    });

    return reply.send(escalation);
  });

  // Reject escalation
  fastify.post('/escalations/:id/reject', {
    preHandler: escalationRateLimits.reject,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = escalationIdParamsSchema.parse(request.params ?? {});
    const body = escalationResolveBodySchema.parse(request.body ?? {});
    const user = request.user as { sub?: string; roles?: string[]; groups?: string[] };

    const escalationToCheck = await escalationService.get(params.id, ctx);
    if (!escalationToCheck) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    const authResult = await canResolveEscalation(user, escalationToCheck, tenantId);
    if (!authResult.allowed) {
      escalationLogger.warn(
        { escalationId: params.id, userId: user.sub, reason: authResult.reason },
        'Unauthorized escalation rejection attempt'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: authResult.reason ?? 'Not authorized to reject this escalation',
        },
      });
    }

    const rejectOptions = body.notes ? { notes: body.notes } : undefined;
    const escalation = await escalationService.reject(params.id, ctx, rejectOptions);

    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    if (escalation.status === 'rejected') {
      await intentService.updateStatus(ctx, escalation.intentId, 'denied', 'escalated');
    }

    // Record audit event for escalation rejection
    await recordAuditEvent(request, {
      eventType: 'escalation.rejected',
      resourceType: 'escalation',
      resourceId: escalation.id,
      beforeState: escalationToCheck as unknown as Record<string, unknown>,
      afterState: escalation as unknown as Record<string, unknown>,
      metadata: {
        intentId: escalation.intentId,
        escalatedTo: escalation.escalatedTo,
        authMethod: authResult.authMethod,
        notes: body.notes,
      },
    });

    return reply.send(escalation);
  });

  // Assign approver
  fastify.post('/escalations/:id/assign', {
    preHandler: escalationRateLimits.assign,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = escalationIdParamsSchema.parse(request.params ?? {});
    const body = assignApproverBodySchema.parse(request.body ?? {});
    const user = request.user as { sub?: string; roles?: string[] };

    const roles = user.roles ?? [];
    const isAdminUser = roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('escalation:admin');

    if (!isAdminUser) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators can assign approvers to escalations',
        },
      });
    }

    const escalation = await escalationService.get(params.id, ctx);
    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    if (!['pending', 'acknowledged'].includes(escalation.status)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_STATE',
          message: `Cannot assign approvers to escalation in ${escalation.status} status`,
        },
      });
    }

    try {
      const assignment = await assignApprover({
        escalationId: params.id,
        userId: body.userId,
        tenantId,
        assignedBy: user.sub ?? 'unknown',
      });

      // Record audit event for approver assignment
      await recordAuditEvent(request, {
        eventType: 'escalation.assigned',
        resourceType: 'escalation',
        resourceId: params.id,
        afterState: {
          assignmentId: assignment.id,
          escalationId: params.id,
          userId: body.userId,
          assignedAt: assignment.assignedAt,
        } as Record<string, unknown>,
        metadata: {
          intentId: escalation.intentId,
          assignedUserId: body.userId,
        },
      });

      escalationLogger.info(
        { escalationId: params.id, assignedUserId: body.userId, assignedBy: user.sub },
        'Approver assigned to escalation'
      );

      return reply.status(201).send({
        id: assignment.id,
        escalationId: params.id,
        userId: body.userId,
        assignedAt: assignment.assignedAt,
        assignedBy: user.sub,
      });
    } catch (error) {
      escalationLogger.error(
        { error, escalationId: params.id, userId: body.userId },
        'Failed to assign approver'
      );
      throw error;
    }
  });

  // Remove approver
  fastify.delete('/escalations/:id/assign/:userId', {
    preHandler: escalationRateLimits.removeAssign,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = z.object({
      id: z.string().uuid(),
      userId: z.string().min(1),
    }).parse(request.params ?? {});
    const user = request.user as { sub?: string; roles?: string[] };

    const roles = user.roles ?? [];
    const isAdminUser = roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('escalation:admin');

    if (!isAdminUser) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators can remove approvers from escalations',
        },
      });
    }

    const escalation = await escalationService.get(params.id, ctx);
    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    const removed = await removeApprover(params.id, params.userId, tenantId);

    if (!removed) {
      return reply.status(404).send({
        error: { code: 'APPROVER_NOT_FOUND', message: 'Approver assignment not found' },
      });
    }

    escalationLogger.info(
      { escalationId: params.id, removedUserId: params.userId, removedBy: user.sub },
      'Approver removed from escalation'
    );

    return reply.status(204).send();
  });

  // List approvers
  fastify.get('/escalations/:id/approvers', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const params = escalationIdParamsSchema.parse(request.params ?? {});

    const escalation = await escalationService.get(params.id, ctx);
    if (!escalation) {
      return reply.status(404).send({
        error: { code: 'ESCALATION_NOT_FOUND', message: 'Escalation not found' },
      });
    }

    const approvers = await listApprovers(params.id, tenantId);

    return reply.send({
      data: approvers,
      escalationId: params.id,
    });
  });

  // =============================================================================
  // BULK OPERATIONS - Admin only, rate limited
  // =============================================================================

  /**
   * Bulk approve multiple escalations
   * Requires admin role
   */
  fastify.post('/escalations/bulk/approve', {
    preHandler: [escalationRateLimits.bulkApprove, withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const user = request.user as { sub?: string; roles?: string[] };

    // Require admin role for bulk operations
    if (!isAdmin(user)) {
      escalationLogger.warn(
        { userId: user.sub, tenantId },
        'Unauthorized bulk approve attempt - admin role required'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Bulk operations require administrator role',
        },
      });
    }

    const body = bulkEscalationIdsSchema.parse(request.body ?? {});
    const { ids, notes } = body;

    escalationLogger.info(
      { userId: user.sub, tenantId, escalationCount: ids.length },
      'Processing bulk approve request'
    );

    const results: Array<{
      id: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const escalationId of ids) {
      try {
        const escalation = await escalationService.get(escalationId, ctx);

        if (!escalation) {
          results.push({ id: escalationId, success: false, error: 'Escalation not found' });
          continue;
        }

        if (!['pending', 'acknowledged'].includes(escalation.status)) {
          results.push({
            id: escalationId,
            success: false,
            error: `Cannot approve escalation in ${escalation.status} status`,
          });
          continue;
        }

        const resolveOptions = notes ? { notes } : undefined;

        const approved = await escalationService.approve(escalationId, ctx, resolveOptions);

        if (approved && approved.status === 'approved') {
          await intentService.updateStatus(ctx, approved.intentId, 'approved', 'escalated');
          results.push({ id: escalationId, success: true });
        } else {
          results.push({ id: escalationId, success: false, error: 'Failed to approve escalation' });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        escalationLogger.error(
          { error, escalationId, userId: user.sub },
          'Error during bulk approve'
        );
        results.push({ id: escalationId, success: false, error: errorMessage });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    escalationLogger.info(
      { userId: user.sub, tenantId, succeeded, failed, total: ids.length },
      'Bulk approve completed'
    );

    // Return 207 Multi-Status if partial success
    const status = failed === 0 ? 200 : succeeded === 0 ? 400 : 207;

    return reply.status(status).send({
      results,
      summary: {
        total: ids.length,
        succeeded,
        failed,
      },
    });
  });

  /**
   * Bulk reject multiple escalations
   * Requires admin role
   */
  fastify.post('/escalations/bulk/reject', {
    preHandler: [escalationRateLimits.bulkReject, withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const user = request.user as { sub?: string; roles?: string[] };

    // Require admin role for bulk operations
    if (!isAdmin(user)) {
      escalationLogger.warn(
        { userId: user.sub, tenantId },
        'Unauthorized bulk reject attempt - admin role required'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Bulk operations require administrator role',
        },
      });
    }

    const body = bulkEscalationIdsSchema.parse(request.body ?? {});
    const { ids, notes } = body;

    escalationLogger.info(
      { userId: user.sub, tenantId, escalationCount: ids.length },
      'Processing bulk reject request'
    );

    const results: Array<{
      id: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const escalationId of ids) {
      try {
        const escalation = await escalationService.get(escalationId, ctx);

        if (!escalation) {
          results.push({ id: escalationId, success: false, error: 'Escalation not found' });
          continue;
        }

        if (!['pending', 'acknowledged'].includes(escalation.status)) {
          results.push({
            id: escalationId,
            success: false,
            error: `Cannot reject escalation in ${escalation.status} status`,
          });
          continue;
        }

        const rejectOptions = notes ? { notes } : undefined;

        const rejected = await escalationService.reject(escalationId, ctx, rejectOptions);

        if (rejected && rejected.status === 'rejected') {
          await intentService.updateStatus(ctx, rejected.intentId, 'denied', 'escalated');
          results.push({ id: escalationId, success: true });
        } else {
          results.push({ id: escalationId, success: false, error: 'Failed to reject escalation' });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        escalationLogger.error(
          { error, escalationId, userId: user.sub },
          'Error during bulk reject'
        );
        results.push({ id: escalationId, success: false, error: errorMessage });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    escalationLogger.info(
      { userId: user.sub, tenantId, succeeded, failed, total: ids.length },
      'Bulk reject completed'
    );

    // Return 207 Multi-Status if partial success
    const status = failed === 0 ? 200 : succeeded === 0 ? 400 : 207;

    return reply.status(status).send({
      results,
      summary: {
        total: ids.length,
        succeeded,
        failed,
      },
    });
  });

  // =============================================================================
  // FILTER-BASED BULK OPERATIONS WITH ASYNC TRACKING
  // =============================================================================

  const operationTracker = getOperationTracker();

  /**
   * Bulk approve escalations by filter
   * POST /escalations/bulk-approve
   *
   * Supports filter-based selection (e.g., approve all pending older than X minutes)
   * Returns 202 Accepted with operation ID for tracking progress.
   */
  fastify.post('/escalations/bulk-approve', {
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const user = request.user as { sub?: string; roles?: string[] };

    if (!isAdmin(user)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Bulk operations require administrator role' },
      });
    }

    const body = bulkEscalationFilterSchema.parse(request.body ?? {});
    const { filter, notes } = body;

    const listFilter: Parameters<typeof escalationService.list>[1] = {
      status: filter.status ?? 'pending',
      limit: filter.maxCount ?? 100,
    };
    if (filter.escalatedTo) listFilter.escalatedTo = filter.escalatedTo;
    if (filter.slaBreached !== undefined) listFilter.includeSlaBreached = filter.slaBreached;

    let escalationsToProcess = await escalationService.list(ctx, listFilter);

    if (filter.olderThanMinutes || filter.olderThanHours) {
      const cutoffMs = (filter.olderThanHours ?? 0) * 3600000 + (filter.olderThanMinutes ?? 0) * 60000;
      const cutoffTime = Date.now() - cutoffMs;
      escalationsToProcess = escalationsToProcess.filter((e) => new Date(e.createdAt).getTime() < cutoffTime);
    }

    if (escalationsToProcess.length === 0) {
      return reply.status(200).send({ message: 'No escalations match the specified filter', filter, matched: 0 });
    }

    const operationId = await operationTracker.createOperation({
      type: 'bulk_approve',
      tenantId,
      createdBy: user.sub,
      totalItems: escalationsToProcess.length,
      metadata: { filter, escalationCount: escalationsToProcess.length, initiatedBy: user.sub },
    });

    const escalationIds = escalationsToProcess.map((e) => e.id);
    setImmediate(async () => {
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      try {
        for (let i = 0; i < escalationIds.length; i++) {
          const escalationId = escalationIds[i]!;
          try {
            const resolveOptions = notes ? { notes } : undefined;
            const approved = await escalationService.approve(escalationId, ctx, resolveOptions);
            if (approved?.status === 'approved') {
              await intentService.updateStatus(ctx, approved.intentId, 'approved', 'escalated');
              results.push({ id: escalationId, success: true });
            } else {
              results.push({ id: escalationId, success: false, error: 'Failed to approve' });
            }
          } catch (error) {
            results.push({ id: escalationId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
          }
          await operationTracker.updateProgress(operationId, i + 1, escalationIds.length);
        }
        const succeeded = results.filter((r) => r.success).length;
        await operationTracker.completeOperation(operationId, { results, summary: { total: escalationIds.length, succeeded, failed: results.length - succeeded } });
      } catch (error) {
        await operationTracker.failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
      }
    });

    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    return reply.status(202).send({
      operationId,
      status: 'pending',
      message: 'Bulk approve operation started. Use the operationId to track progress.',
      matched: escalationsToProcess.length,
      filter,
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
    });
  });

  /**
   * Bulk reject escalations by filter
   * POST /escalations/bulk-reject
   */
  fastify.post('/escalations/bulk-reject', {
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const user = request.user as { sub?: string; roles?: string[] };

    if (!isAdmin(user)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Bulk operations require administrator role' },
      });
    }

    const body = bulkEscalationFilterSchema.parse(request.body ?? {});
    const { filter, notes } = body;

    const listFilter: Parameters<typeof escalationService.list>[1] = {
      status: filter.status ?? 'pending',
      limit: filter.maxCount ?? 100,
    };
    if (filter.escalatedTo) listFilter.escalatedTo = filter.escalatedTo;
    if (filter.slaBreached !== undefined) listFilter.includeSlaBreached = filter.slaBreached;

    let escalationsToProcess = await escalationService.list(ctx, listFilter);

    if (filter.olderThanMinutes || filter.olderThanHours) {
      const cutoffMs = (filter.olderThanHours ?? 0) * 3600000 + (filter.olderThanMinutes ?? 0) * 60000;
      const cutoffTime = Date.now() - cutoffMs;
      escalationsToProcess = escalationsToProcess.filter((e) => new Date(e.createdAt).getTime() < cutoffTime);
    }

    if (escalationsToProcess.length === 0) {
      return reply.status(200).send({ message: 'No escalations match the specified filter', filter, matched: 0 });
    }

    const operationId = await operationTracker.createOperation({
      type: 'bulk_reject',
      tenantId,
      createdBy: user.sub,
      totalItems: escalationsToProcess.length,
      metadata: { filter, escalationCount: escalationsToProcess.length, initiatedBy: user.sub },
    });

    const escalationIds = escalationsToProcess.map((e) => e.id);
    setImmediate(async () => {
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      try {
        for (let i = 0; i < escalationIds.length; i++) {
          const escalationId = escalationIds[i]!;
          try {
            const resolveOptions = notes ? { notes } : undefined;
            const rejected = await escalationService.reject(escalationId, ctx, resolveOptions);
            if (rejected?.status === 'rejected') {
              await intentService.updateStatus(ctx, rejected.intentId, 'denied', 'escalated');
              results.push({ id: escalationId, success: true });
            } else {
              results.push({ id: escalationId, success: false, error: 'Failed to reject' });
            }
          } catch (error) {
            results.push({ id: escalationId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
          }
          await operationTracker.updateProgress(operationId, i + 1, escalationIds.length);
        }
        const succeeded = results.filter((r) => r.success).length;
        await operationTracker.completeOperation(operationId, { results, summary: { total: escalationIds.length, succeeded, failed: results.length - succeeded } });
      } catch (error) {
        await operationTracker.failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
      }
    });

    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const baseUrl = `${protocol}://${host}`;

    return reply.status(202).send({
      operationId,
      status: 'pending',
      message: 'Bulk reject operation started. Use the operationId to track progress.',
      matched: escalationsToProcess.length,
      filter,
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
    });
  });

  // =============================================================================
  // SLA METRICS ENDPOINT
  // =============================================================================

  /**
   * Get SLA metrics for escalations
   * Includes: total count, breached count, average response time
   * Supports filtering by time range
   */
  fastify.get('/escalations/metrics/sla', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await getSecureTenantContext(request);
    const tenantId = extractTenantId(ctx);
    const query = slaMetricsQuerySchema.parse(request.query ?? {});

    // Calculate time range
    let sinceDate: Date | undefined;
    if (query.startDate) {
      sinceDate = new Date(query.startDate);
    }

    // Get SLA statistics from the escalation service
    const stats = await escalationService.getSlaStats(ctx, sinceDate);

    // Format response
    const response = {
      metrics: {
        total: stats.total,
        breached: stats.breached,
        breachRate: Math.round(stats.breachRate * 10000) / 100, // Convert to percentage with 2 decimal places
        averageResponseTime: {
          seconds: Math.round(stats.avgResolutionTime),
          formatted: formatDuration(stats.avgResolutionTime),
        },
      },
      timeRange: {
        start: query.startDate ?? null,
        end: query.endDate ?? new Date().toISOString(),
      },
      tenantId,
      generatedAt: new Date().toISOString(),
    };

    return reply.send(response);
  });

  escalationLogger.debug('Escalation routes registered');
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
