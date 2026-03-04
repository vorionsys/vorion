/**
 * API v1 Audit Routes
 *
 * Comprehensive audit query API with cursor-based pagination,
 * filtering, and admin role requirements for security compliance.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { createAuditService } from '../../audit/service.js';
import type { ChainIntegrityResult, AuditRecord } from '../../audit/types.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimit, rateLimitPerTenant } from '../middleware/rateLimit.js';

const auditLogger = createLogger({ component: 'api-v1-audit' });
const auditService = createAuditService();

// =============================================================================
// ADMIN ROLES
// =============================================================================

const ADMIN_ROLES = ['admin', 'tenant:admin', 'system:admin', 'audit:admin', 'security:admin'] as const;

function isAdmin(roles: string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]));
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

const auditIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Enhanced query schema with cursor-based pagination
 */
const auditQuerySchema = z.object({
  // Filtering
  eventType: z.string().optional(),
  eventCategory: z.enum(['intent', 'policy', 'escalation', 'authentication', 'authorization', 'data', 'system', 'admin']).optional(),
  severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
  actorId: z.string().optional(),
  actor: z.string().optional(), // Alias for actorId - search by actor ID or name
  targetId: z.string().optional(),
  resourceId: z.string().optional(), // Alias for targetId
  targetType: z.enum(['intent', 'policy', 'escalation', 'entity', 'tenant', 'user', 'system']).optional(),
  resourceType: z.enum(['intent', 'policy', 'escalation', 'entity', 'tenant', 'user', 'system']).optional(), // Alias
  outcome: z.enum(['success', 'failure', 'partial']).optional(),

  // Date range
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(), // Alias for startTime
  endDate: z.string().datetime().optional(), // Alias for endTime

  // Cursor-based pagination
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),

  // Legacy offset-based pagination (deprecated but supported)
  offset: z.coerce.number().int().min(0).optional(),
});

const auditTargetParamsSchema = z.object({
  targetType: z.enum(['intent', 'policy', 'escalation', 'entity', 'tenant', 'user', 'system']),
  targetId: z.string().uuid(),
});

const auditTargetQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).optional(),
});

const auditTraceParamsSchema = z.object({
  traceId: z.string(),
});

const auditStatsQuerySchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

const auditVerifyBodySchema = z.object({
  startSequence: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100000).optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

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
 * Parse cursor into sequence number for pagination
 * Cursor format: base64({sequenceNumber, eventTime})
 */
function parseCursor(cursor: string | undefined): { sequenceNumber?: number; eventTime?: string } {
  if (!cursor) {
    return {};
  }

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return {
      sequenceNumber: parsed.sequenceNumber,
      eventTime: parsed.eventTime,
    };
  } catch {
    return {};
  }
}

/**
 * Create cursor from audit record for pagination
 */
function createCursor(record: AuditRecord): string {
  const payload = {
    sequenceNumber: record.sequenceNumber,
    eventTime: record.eventTime,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Response format for cursor-based pagination
 */
interface CursorPaginationResponse<T> {
  data: T[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Register v1 audit routes
 */
export async function registerAuditRoutesV1(fastify: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /audit - Query audit records with cursor-based pagination
  // Requires admin role for security compliance
  // ---------------------------------------------------------------------------
  fastify.get('/audit', {
    preHandler: rateLimitPerTenant({ limit: 100, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    // Require admin role for audit log access
    if (!isAdmin(roles)) {
      auditLogger.warn(
        { userId: user.sub, tenantId, path: request.url },
        'Unauthorized audit log access attempt'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Admin role required to access audit logs',
        },
      });
    }

    const query = auditQuerySchema.parse(request.query ?? {});

    // Handle cursor-based pagination
    const cursorData = parseCursor(query.cursor);

    // Normalize aliases
    const effectiveActorId = query.actorId || query.actor;
    const effectiveTargetId = query.targetId || query.resourceId;
    const effectiveTargetType = query.targetType || query.resourceType;
    const effectiveStartTime = query.startTime || query.startDate;
    const effectiveEndTime = query.endTime || query.endDate;

    // Build query with cursor support
    const result = await auditService.query({
      tenantId,
      eventType: query.eventType,
      eventCategory: query.eventCategory,
      severity: query.severity,
      actorId: effectiveActorId,
      targetId: effectiveTargetId,
      targetType: effectiveTargetType,
      outcome: query.outcome,
      startTime: cursorData.eventTime || effectiveStartTime,
      endTime: effectiveEndTime,
      limit: query.limit + 1, // Fetch one extra to determine hasMore
      offset: query.offset, // Legacy support
      orderBy: 'eventTime',
      orderDirection: 'desc',
    });

    // Determine if there are more results
    const hasMore = result.records.length > query.limit;
    const records = hasMore ? result.records.slice(0, query.limit) : result.records;

    // Create next cursor from last record
    const nextCursor = hasMore && records.length > 0
      ? createCursor(records[records.length - 1]!)
      : null;

    const response: CursorPaginationResponse<AuditRecord> = {
      data: records,
      pagination: {
        cursor: nextCursor,
        hasMore,
        total: result.total,
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    };

    return reply.send(response);
  });

  // ---------------------------------------------------------------------------
  // GET /audit/:id - Get audit record by ID
  // Requires admin role
  // ---------------------------------------------------------------------------
  fastify.get('/audit/:id', {
    preHandler: rateLimit({ limit: 100, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    // Require admin role
    if (!isAdmin(roles)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = auditIdParamsSchema.parse(request.params ?? {});

    const record = await auditService.findById(params.id, tenantId);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'AUDIT_RECORD_NOT_FOUND', message: 'Audit record not found' },
      });
    }

    return reply.send({
      data: record,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /audit/target/:targetType/:targetId - Get audit trail for resource
  // Requires admin role
  // ---------------------------------------------------------------------------
  fastify.get('/audit/target/:targetType/:targetId', {
    preHandler: rateLimitPerTenant({ limit: 50, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    // Require admin role
    if (!isAdmin(roles)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = auditTargetParamsSchema.parse(request.params ?? {});
    const query = auditTargetQuerySchema.parse(request.query ?? {});

    const records = await auditService.getForTarget(
      tenantId,
      params.targetType,
      params.targetId,
      { limit: query.limit, offset: query.offset }
    );

    // Create cursor for pagination
    const nextCursor = records.length === query.limit && records.length > 0
      ? createCursor(records[records.length - 1]!)
      : null;

    return reply.send({
      data: records,
      pagination: {
        cursor: nextCursor,
        hasMore: records.length === query.limit,
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /audit/trace/:traceId - Get audit records by trace
  // Requires admin role
  // ---------------------------------------------------------------------------
  fastify.get('/audit/trace/:traceId', {
    preHandler: rateLimit({ limit: 50, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    // Require admin role
    if (!isAdmin(roles)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const params = auditTraceParamsSchema.parse(request.params ?? {});

    const records = await auditService.getByTrace(tenantId, params.traceId);

    return reply.send({
      data: records,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /audit/stats - Get audit statistics
  // Requires admin role
  // ---------------------------------------------------------------------------
  fastify.get('/audit/stats', {
    preHandler: rateLimitPerTenant({ limit: 30, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    // Require admin role
    if (!isAdmin(roles)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const query = auditStatsQuerySchema.parse(request.query ?? {});

    const stats = await auditService.getStats(tenantId, {
      startTime: query.startTime,
      endTime: query.endTime,
    });

    return reply.send({
      data: stats,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // POST /audit/verify - Verify audit chain integrity
  // Requires admin role (system:admin or audit:admin preferred)
  // ---------------------------------------------------------------------------
  fastify.post('/audit/verify', {
    preHandler: rateLimit({ limit: 5, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles)) {
      auditLogger.warn({ userId: user.sub }, 'Unauthorized audit verify attempt');
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const body = auditVerifyBodySchema.parse(request.body ?? {});

    const result: ChainIntegrityResult = await auditService.verifyChainIntegrity(tenantId, {
      startSequence: body.startSequence,
      limit: body.limit,
    });

    auditLogger.info(
      {
        tenantId,
        userId: user.sub,
        valid: result.valid,
        recordsChecked: result.recordsChecked,
      },
      'Audit chain integrity verified'
    );

    return reply.send({
      data: result,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /audit/retention - Get retention statistics
  // Requires admin role
  // ---------------------------------------------------------------------------
  fastify.get('/audit/retention', {
    preHandler: rateLimit({ limit: 20, windowSeconds: 60 }),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };
    const roles = user.roles ?? [];

    if (!isAdmin(roles)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin role required' },
      });
    }

    const stats = await auditService.getRetentionStats(tenantId);

    return reply.send({
      data: stats,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  auditLogger.debug('Audit routes registered');
}
