/**
 * API v1 Compliance Routes
 *
 * REST API endpoints for compliance management including:
 * - Retention policy status
 * - Litigation hold management
 * - Manual enforcement triggers
 * - Evidence export for external auditors
 * - Scheduled exports
 * - Compliance dashboard data
 *
 * All endpoints require admin authentication.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  sendSuccess,
  sendNotFound,
  sendForbidden,
  sendUnauthorized,
} from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';
import {
  getRetentionEnforcer,
  getRetentionScheduler,
  createLitigationHoldSchema,
  releaseLitigationHoldSchema,
} from '../../compliance/retention/index.js';
import {
  getComplianceExportService,
  EVIDENCE_EVENT_TYPES,
  type ExportRequest,
  type EvidenceEventType,
} from '../../compliance/export/index.js';
import {
  getScheduledExportManager,
  type ExportDestination,
} from '../../compliance/export/scheduled-exports.js';

const logger = createLogger({ component: 'api-v1-compliance' });

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

/**
 * Hold ID parameter schema
 */
const holdIdParamsSchema = z.object({
  id: z.string().uuid('Invalid hold ID format'),
});

/**
 * Enforcement query schema
 */
const enforcementQuerySchema = z.object({
  dryRun: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  categories: z.string().optional().transform((v) => v?.split(',') as Array<'intents' | 'auditLogs' | 'proofs' | 'sessions' | 'apiKeyLogs'> | undefined),
});

// =============================================================================
// EVIDENCE EXPORT SCHEMAS
// =============================================================================

/**
 * Export request schema
 */
const exportRequestSchema = z.object({
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO 8601 datetime' }),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO 8601 datetime' }),
  eventTypes: z.array(z.enum(EVIDENCE_EVENT_TYPES as unknown as [string, ...string[]])).optional(),
  includePayloads: z.boolean().optional().default(false),
  format: z.enum(['json', 'csv', 'pdf']),
});

/**
 * Operation ID parameter schema
 */
const operationIdParamsSchema = z.object({
  operationId: z.string().uuid(),
});

/**
 * Summary query schema
 */
const summaryQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  period: z.enum(['day', 'week', 'month']).optional().default('week'),
});

/**
 * Scheduled export request schema
 */
const scheduledExportRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional().default(true),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  hourUtc: z.number().int().min(0).max(23),
  minuteUtc: z.number().int().min(0).max(59).optional().default(0),
  format: z.enum(['json', 'csv', 'pdf']),
  includePayloads: z.boolean().optional().default(false),
  includeTamperEvidence: z.boolean().optional().default(true),
  eventTypes: z.array(z.string()).optional(),
  destinations: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('s3'),
        bucket: z.string().min(1),
        region: z.string().min(1),
        prefix: z.string().optional(),
        roleArn: z.string().optional(),
        kmsKeyId: z.string().optional(),
      }),
      z.object({
        type: z.literal('email'),
        recipients: z.array(z.string().email()).min(1),
        cc: z.array(z.string().email()).optional(),
        bcc: z.array(z.string().email()).optional(),
        subject: z.string().optional(),
        includeReport: z.boolean().optional().default(true),
      }),
      z.object({
        type: z.literal('webhook'),
        url: z.string().url(),
        method: z.enum(['POST', 'PUT']).optional().default('POST'),
        headers: z.record(z.string()).optional(),
        includeReport: z.boolean().optional().default(false),
        timeout: z.number().int().min(1000).max(60000).optional(),
      }),
    ])
  ).min(1),
});

/**
 * Schedule ID parameter schema
 */
const scheduleIdParamsSchema = z.object({
  scheduleId: z.string().uuid(),
});

/**
 * Schedule update schema
 */
const scheduleUpdateSchema = scheduledExportRequestSchema.partial();

// =============================================================================
// TYPE DECLARATIONS
// =============================================================================

/**
 * Extend FastifyRequest to include JWT methods when JWT plugin is registered
 */
declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify<T = Record<string, unknown>>(): Promise<T>;
  }
}

/**
 * JWT payload structure
 */
interface JwtPayload {
  sub?: string;
  userId?: string;
  tenantId?: string;
  tenant_id?: string;
  roles?: string[];
}

/**
 * Authenticated context with admin verification
 */
interface AdminAuthContext {
  userId: string;
  tenantId: string;
  roles: string[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract authenticated admin context from request
 */
async function getAdminAuthContext(request: FastifyRequest): Promise<AdminAuthContext> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();

    const userId = payload.sub ?? payload.userId;
    const tenantId = payload.tenantId ?? payload.tenant_id;
    const roles = payload.roles ?? [];

    if (!userId) {
      throw new UnauthorizedError('User identifier missing from token');
    }

    if (!tenantId) {
      throw new ForbiddenError('Tenant context missing from token');
    }

    // Verify tenant membership
    await requireTenantMembership(userId, tenantId);

    // Verify admin role
    const isAdmin =
      roles.includes('admin') ||
      roles.includes('tenant:admin') ||
      roles.includes('system:admin') ||
      roles.includes('compliance:admin');

    if (!isAdmin) {
      throw new ForbiddenError('Admin role required for compliance operations');
    }

    return {
      userId,
      tenantId,
      roles,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or missing authentication token');
  }
}

/**
 * Get authenticated context with compliance read access
 */
async function getComplianceAuthContext(request: FastifyRequest): Promise<AdminAuthContext> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();

    const userId = payload.sub ?? payload.userId;
    const tenantId = payload.tenantId ?? payload.tenant_id;
    const roles = payload.roles ?? [];

    if (!userId) {
      throw new UnauthorizedError('User identifier missing from token');
    }

    if (!tenantId) {
      throw new ForbiddenError('Tenant context missing from token');
    }

    // Verify tenant membership
    await requireTenantMembership(userId, tenantId);

    // Check compliance access (admin or compliance roles)
    const allowedRoles = [
      'admin',
      'tenant:admin',
      'system:admin',
      'compliance:admin',
      'compliance:read',
      'auditor',
    ];

    if (!roles.some((r) => allowedRoles.includes(r))) {
      throw new ForbiddenError('Compliance access required');
    }

    return { userId, tenantId, roles };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or missing authentication token');
  }
}

/**
 * Wrap handler with compliance-specific error handling
 */
function withComplianceErrorHandling<T>(
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

      // Handle auth errors
      if (error instanceof UnauthorizedError) {
        return sendUnauthorized(reply, error.message, request);
      }

      if (error instanceof ForbiddenError) {
        return sendForbidden(reply, error.message, request);
      }

      if (error instanceof NotFoundError) {
        return sendNotFound(reply, 'Resource', request);
      }

      if (error instanceof ValidationError) {
        throw error;
      }

      // Re-throw other errors
      throw error;
    }
  };
}

// =============================================================================
// RETENTION ROUTE HANDLERS
// =============================================================================

/**
 * GET /api/v1/compliance/retention - Get retention compliance status
 */
async function handleGetRetentionStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getAdminAuthContext(request);

  logger.debug('Getting retention compliance status');

  const enforcer = getRetentionEnforcer();
  const scheduler = getRetentionScheduler();

  const complianceStatus = await enforcer.getComplianceStatus();
  const schedulerStatus = scheduler.getStatus();

  const response = {
    compliance: complianceStatus,
    scheduler: schedulerStatus,
  };

  logger.info(
    {
      compliant: complianceStatus.compliant,
      overdueCategories: complianceStatus.overdueCategories.length,
      activeLitigationHolds: complianceStatus.activeLitigationHolds.length,
      schedulerLeader: schedulerStatus.isLeader,
    },
    'Retention compliance status retrieved'
  );

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * POST /api/v1/compliance/retention/enforce - Trigger manual retention enforcement
 */
async function handleEnforceRetention(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const query = enforcementQuerySchema.parse(request.query);

  logger.info(
    {
      userId: auth.userId,
      tenantId: auth.tenantId,
      dryRun: query.dryRun,
      categories: query.categories,
    },
    'Manual retention enforcement triggered'
  );

  const scheduler = getRetentionScheduler();
  const report = await scheduler.runEnforcementNow({
    dryRun: query.dryRun,
    categories: query.categories,
  });

  logger.info(
    {
      reportId: report.reportId,
      totalDeleted: report.summary.totalRecordsDeleted,
      totalAnonymized: report.summary.totalRecordsAnonymized,
      success: report.success,
    },
    'Manual retention enforcement completed'
  );

  return sendSuccess(reply, report, HttpStatus.OK, request);
}

/**
 * GET /api/v1/compliance/retention/report - Get last enforcement report
 */
async function handleGetLastReport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getAdminAuthContext(request);

  logger.debug('Getting last retention enforcement report');

  const enforcer = getRetentionEnforcer();
  const report = enforcer.getLastReport();

  if (!report) {
    return sendSuccess(
      reply,
      {
        message: 'No enforcement report available. Enforcement has not been run yet.',
        report: null,
      },
      HttpStatus.OK,
      request
    );
  }

  return sendSuccess(reply, { report }, HttpStatus.OK, request);
}

/**
 * GET /api/v1/compliance/holds - List active litigation holds
 */
async function handleListLitigationHolds(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  logger.debug({ tenantId: auth.tenantId }, 'Listing litigation holds');

  const enforcer = getRetentionEnforcer();
  const holds = enforcer.getActiveLitigationHolds(auth.tenantId);

  logger.info(
    {
      tenantId: auth.tenantId,
      holdCount: holds.length,
    },
    'Litigation holds listed'
  );

  return sendSuccess(
    reply,
    {
      holds,
      total: holds.length,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * POST /api/v1/compliance/holds - Create litigation hold
 */
async function handleCreateLitigationHold(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const body = createLitigationHoldSchema.parse(request.body);

  logger.info(
    {
      userId: auth.userId,
      tenantId: auth.tenantId,
      matterReference: body.matterReference,
      dataType: body.dataType,
    },
    'Creating litigation hold'
  );

  const enforcer = getRetentionEnforcer();
  const hold = await enforcer.createLitigationHold({
    tenantId: auth.tenantId,
    matterReference: body.matterReference,
    description: body.description,
    dataType: body.dataType,
    entityIds: body.entityIds,
    createdBy: auth.userId,
    expiresAt: body.expiresAt,
  });

  logger.info(
    {
      holdId: hold.id,
      tenantId: auth.tenantId,
      matterReference: hold.matterReference,
    },
    'Litigation hold created'
  );

  return sendSuccess(reply, { hold }, HttpStatus.CREATED, request);
}

/**
 * GET /api/v1/compliance/holds/:id - Get litigation hold by ID
 */
async function handleGetLitigationHold(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const params = holdIdParamsSchema.parse(request.params);

  logger.debug({ holdId: params.id, tenantId: auth.tenantId }, 'Getting litigation hold');

  const enforcer = getRetentionEnforcer();
  const hold = enforcer.getLitigationHold(params.id);

  if (!hold) {
    throw new NotFoundError('Litigation hold not found');
  }

  // Verify tenant access
  if (hold.tenantId !== auth.tenantId) {
    throw new ForbiddenError('Cannot access litigation hold from different tenant');
  }

  return sendSuccess(reply, { hold }, HttpStatus.OK, request);
}

/**
 * DELETE /api/v1/compliance/holds/:id - Release litigation hold
 */
async function handleReleaseLitigationHold(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const params = holdIdParamsSchema.parse(request.params);
  const body = releaseLitigationHoldSchema.parse(request.body);

  logger.info(
    {
      holdId: params.id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      releaseReason: body.releaseReason,
    },
    'Releasing litigation hold'
  );

  const enforcer = getRetentionEnforcer();
  const hold = await enforcer.releaseLitigationHold({
    holdId: params.id,
    tenantId: auth.tenantId,
    releasedBy: auth.userId,
    releaseReason: body.releaseReason,
  });

  if (!hold) {
    throw new NotFoundError('Litigation hold not found');
  }

  logger.info(
    {
      holdId: params.id,
      tenantId: auth.tenantId,
      releasedBy: auth.userId,
    },
    'Litigation hold released'
  );

  return sendSuccess(reply, { hold }, HttpStatus.OK, request);
}

/**
 * GET /api/v1/compliance/scheduler - Get scheduler status
 */
async function handleGetSchedulerStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getAdminAuthContext(request);

  logger.debug('Getting retention scheduler status');

  const scheduler = getRetentionScheduler();
  const status = scheduler.getStatus();

  return sendSuccess(reply, { scheduler: status }, HttpStatus.OK, request);
}

// =============================================================================
// EVIDENCE EXPORT ROUTE HANDLERS
// =============================================================================

/**
 * POST /compliance/evidence/export - Start evidence export job
 */
async function handleStartExport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const body = exportRequestSchema.parse(request.body);

  // Validate date range
  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);

  if (startDate >= endDate) {
    throw new ValidationError('startDate must be before endDate');
  }

  // Validate date range is not too large (max 1 year)
  const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
  if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
    throw new ValidationError('Export date range cannot exceed 1 year');
  }

  const exportService = getComplianceExportService();
  await exportService.initialize();

  const exportRequest: ExportRequest = {
    startDate: body.startDate,
    endDate: body.endDate,
    eventTypes: body.eventTypes as EvidenceEventType[] | undefined,
    includePayloads: body.includePayloads,
    format: body.format,
  };

  const operationId = await exportService.startExport(auth.tenantId, exportRequest);

  logger.info(
    { operationId, tenantId: auth.tenantId, format: body.format },
    'Compliance export started'
  );

  return sendSuccess(
    reply,
    {
      operationId,
      status: 'pending',
      message: 'Export job started. Poll the status endpoint for progress.',
      statusUrl: `/api/v1/compliance/evidence/export/${operationId}`,
    },
    HttpStatus.ACCEPTED,
    request
  );
}

/**
 * GET /compliance/evidence/export/:operationId - Get export status
 */
async function handleGetExportStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getComplianceAuthContext(request);

  const params = operationIdParamsSchema.parse(request.params);

  const exportService = getComplianceExportService();
  const result = exportService.getExportStatus(params.operationId);

  if (!result) {
    throw new NotFoundError('Export job not found');
  }

  const response: Record<string, unknown> = {
    operationId: result.operationId,
    status: result.status,
    progress: result.progress,
  };

  if (result.status === 'completed') {
    response['downloadUrl'] = `/api/v1/compliance/evidence/export/${params.operationId}/download`;
    response['summary'] = result.report?.summary;
  }

  if (result.status === 'failed') {
    response['error'] = result.error;
  }

  return sendSuccess(reply, response, HttpStatus.OK, request);
}

/**
 * GET /compliance/evidence/export/:operationId/download - Download export
 */
async function handleDownloadExport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getComplianceAuthContext(request);

  const params = operationIdParamsSchema.parse(request.params);

  const exportService = getComplianceExportService();
  const download = exportService.getExportDownload(params.operationId);

  if (!download) {
    const status = exportService.getExportStatus(params.operationId);
    if (!status) {
      throw new NotFoundError('Export job not found');
    }
    if (status.status !== 'completed') {
      throw new ValidationError(`Export is not ready for download (status: ${status.status})`);
    }
    throw new NotFoundError('Export data not available');
  }

  // For CSV format, return a JSON structure with multiple files
  if (download.format === 'csv' && typeof download.data === 'object') {
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${download.filename.replace('.zip', '.json')}"`)
      .send(download.data);
  }

  return reply
    .header('Content-Type', download.contentType)
    .header('Content-Disposition', `attachment; filename="${download.filename}"`)
    .send(download.data);
}

/**
 * POST /compliance/evidence/export/:operationId/verify - Verify export integrity
 */
async function handleVerifyExport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getComplianceAuthContext(request);

  const params = operationIdParamsSchema.parse(request.params);

  const exportService = getComplianceExportService();
  const result = await exportService.verifyEvidence(params.operationId);

  return sendSuccess(
    reply,
    {
      operationId: params.operationId,
      verified: result.valid,
      errors: result.errors,
      details: result.details,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * GET /compliance/status - Get overall compliance status
 */
async function handleGetComplianceStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const exportService = getComplianceExportService();
  await exportService.initialize();

  const status = await exportService.getComplianceStatus(auth.tenantId);

  return sendSuccess(reply, status, HttpStatus.OK, request);
}

/**
 * GET /compliance/summary - Get compliance event summary
 */
async function handleGetComplianceSummary(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const query = summaryQuerySchema.parse(request.query);

  // Default date range based on period
  let startDate: Date;
  let endDate = new Date();

  if (query.startDate && query.endDate) {
    startDate = new Date(query.startDate);
    endDate = new Date(query.endDate);
  } else {
    switch (query.period) {
      case 'day':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }
  }

  const exportService = getComplianceExportService();
  await exportService.initialize();

  const summary = await exportService.getEventSummary(auth.tenantId, startDate, endDate);

  return sendSuccess(reply, summary, HttpStatus.OK, request);
}

/**
 * GET /compliance/event-types - Get supported event types
 */
async function handleGetEventTypes(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await getComplianceAuthContext(request);

  const exportService = getComplianceExportService();

  return sendSuccess(
    reply,
    {
      eventTypes: exportService.getSupportedEventTypes(),
      formats: exportService.getSupportedFormats(),
    },
    HttpStatus.OK,
    request
  );
}

// =============================================================================
// SCHEDULED EXPORT ROUTE HANDLERS
// =============================================================================

/**
 * POST /compliance/schedules - Create scheduled export
 */
async function handleCreateSchedule(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const body = scheduledExportRequestSchema.parse(request.body);

  // Validate schedule-specific requirements
  if (body.frequency === 'weekly' && !body.dayOfWeek) {
    throw new ValidationError('dayOfWeek is required for weekly schedules');
  }

  if (body.frequency === 'monthly' && !body.dayOfMonth) {
    throw new ValidationError('dayOfMonth is required for monthly schedules');
  }

  const scheduledExportManager = getScheduledExportManager();

  const schedule = scheduledExportManager.createSchedule(auth.tenantId, {
    name: body.name,
    description: body.description,
    enabled: body.enabled,
    frequency: body.frequency,
    dayOfWeek: body.dayOfWeek,
    dayOfMonth: body.dayOfMonth,
    hourUtc: body.hourUtc,
    minuteUtc: body.minuteUtc,
    format: body.format,
    includePayloads: body.includePayloads,
    includeTamperEvidence: body.includeTamperEvidence,
    eventTypes: body.eventTypes,
    destinations: body.destinations as ExportDestination[],
    tenantId: auth.tenantId,
  });

  logger.info(
    { scheduleId: schedule.id, tenantId: auth.tenantId, frequency: body.frequency },
    'Scheduled export created'
  );

  return sendSuccess(reply, schedule, HttpStatus.CREATED, request);
}

/**
 * GET /compliance/schedules - List scheduled exports
 */
async function handleListSchedules(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const scheduledExportManager = getScheduledExportManager();
  const schedules = scheduledExportManager.listSchedules(auth.tenantId);

  return sendSuccess(reply, { schedules }, HttpStatus.OK, request);
}

/**
 * GET /compliance/schedules/:scheduleId - Get scheduled export
 */
async function handleGetSchedule(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const params = scheduleIdParamsSchema.parse(request.params);

  const scheduledExportManager = getScheduledExportManager();
  const schedule = scheduledExportManager.getSchedule(params.scheduleId);

  if (!schedule || schedule.tenantId !== auth.tenantId) {
    throw new NotFoundError('Scheduled export not found');
  }

  // Get recent jobs for this schedule
  const jobs = scheduledExportManager.listJobsForSchedule(params.scheduleId);

  return sendSuccess(
    reply,
    {
      ...schedule,
      recentJobs: jobs.slice(0, 10),
    },
    HttpStatus.OK,
    request
  );
}

/**
 * PATCH /compliance/schedules/:scheduleId - Update scheduled export
 */
async function handleUpdateSchedule(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const params = scheduleIdParamsSchema.parse(request.params);
  const body = scheduleUpdateSchema.parse(request.body);

  const scheduledExportManager = getScheduledExportManager();
  const existing = scheduledExportManager.getSchedule(params.scheduleId);

  if (!existing || existing.tenantId !== auth.tenantId) {
    throw new NotFoundError('Scheduled export not found');
  }

  const updated = scheduledExportManager.updateSchedule(params.scheduleId, body as any);

  if (!updated) {
    throw new NotFoundError('Scheduled export not found');
  }

  logger.info(
    { scheduleId: params.scheduleId, tenantId: auth.tenantId },
    'Scheduled export updated'
  );

  return sendSuccess(reply, updated, HttpStatus.OK, request);
}

/**
 * DELETE /compliance/schedules/:scheduleId - Delete scheduled export
 */
async function handleDeleteSchedule(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const params = scheduleIdParamsSchema.parse(request.params);

  const scheduledExportManager = getScheduledExportManager();
  const existing = scheduledExportManager.getSchedule(params.scheduleId);

  if (!existing || existing.tenantId !== auth.tenantId) {
    throw new NotFoundError('Scheduled export not found');
  }

  scheduledExportManager.deleteSchedule(params.scheduleId);

  logger.info(
    { scheduleId: params.scheduleId, tenantId: auth.tenantId },
    'Scheduled export deleted'
  );

  return reply.status(HttpStatus.NO_CONTENT).send();
}

/**
 * POST /compliance/schedules/:scheduleId/trigger - Manually trigger scheduled export
 */
async function handleTriggerSchedule(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getAdminAuthContext(request);

  const params = scheduleIdParamsSchema.parse(request.params);

  const scheduledExportManager = getScheduledExportManager();
  const existing = scheduledExportManager.getSchedule(params.scheduleId);

  if (!existing || existing.tenantId !== auth.tenantId) {
    throw new NotFoundError('Scheduled export not found');
  }

  const job = await scheduledExportManager.triggerExport(params.scheduleId);

  if (!job) {
    throw new ValidationError('Failed to trigger export');
  }

  logger.info(
    { scheduleId: params.scheduleId, jobId: job.id, tenantId: auth.tenantId },
    'Scheduled export manually triggered'
  );

  return sendSuccess(
    reply,
    {
      jobId: job.id,
      status: job.status,
      message: 'Export triggered. Check job status for progress.',
    },
    HttpStatus.ACCEPTED,
    request
  );
}

/**
 * GET /compliance/schedules/:scheduleId/jobs/:jobId - Get job details
 */
async function handleGetScheduleJob(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await getComplianceAuthContext(request);

  const params = z.object({
    scheduleId: z.string().uuid(),
    jobId: z.string().uuid(),
  }).parse(request.params);

  const scheduledExportManager = getScheduledExportManager();
  const schedule = scheduledExportManager.getSchedule(params.scheduleId);

  if (!schedule || schedule.tenantId !== auth.tenantId) {
    throw new NotFoundError('Scheduled export not found');
  }

  const job = scheduledExportManager.getJob(params.jobId);

  if (!job || job.scheduleId !== params.scheduleId) {
    throw new NotFoundError('Job not found');
  }

  return sendSuccess(reply, job, HttpStatus.OK, request);
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Register compliance API routes
 *
 * Routes:
 * - GET    /compliance/retention               - Get retention compliance status
 * - POST   /compliance/retention/enforce       - Trigger manual enforcement
 * - GET    /compliance/retention/report        - Get last enforcement report
 * - GET    /compliance/holds                   - List active litigation holds
 * - POST   /compliance/holds                   - Create litigation hold
 * - GET    /compliance/holds/:id               - Get litigation hold by ID
 * - DELETE /compliance/holds/:id               - Release litigation hold
 * - GET    /compliance/scheduler               - Get scheduler status
 *
 * Evidence Export Routes:
 * - POST   /compliance/evidence/export                       - Start export job
 * - GET    /compliance/evidence/export/:operationId          - Get export status
 * - GET    /compliance/evidence/export/:operationId/download - Download export
 * - POST   /compliance/evidence/export/:operationId/verify   - Verify export integrity
 *
 * Compliance Dashboard Routes:
 * - GET    /compliance/status                  - Get overall compliance status
 * - GET    /compliance/summary                 - Get event summary by type and period
 * - GET    /compliance/event-types             - Get supported event types
 *
 * Scheduled Export Routes:
 * - POST   /compliance/schedules                             - Create scheduled export
 * - GET    /compliance/schedules                             - List scheduled exports
 * - GET    /compliance/schedules/:scheduleId                 - Get scheduled export
 * - PATCH  /compliance/schedules/:scheduleId                 - Update scheduled export
 * - DELETE /compliance/schedules/:scheduleId                 - Delete scheduled export
 * - POST   /compliance/schedules/:scheduleId/trigger         - Manually trigger export
 * - GET    /compliance/schedules/:scheduleId/jobs/:jobId     - Get job details
 *
 * @param fastify - Fastify instance
 */
export async function registerComplianceRoutesV1(fastify: FastifyInstance): Promise<void> {
  const prefix = '/compliance';

  // Rate limit configuration for admin endpoints
  const adminRateLimit = rateLimit({ limit: 30, windowSeconds: 60 });

  // Rate limit configuration for export endpoints (more restrictive)
  const exportRateLimit = rateLimit({ limit: 10, windowSeconds: 60 });

  // ===========================================================================
  // RETENTION ROUTES
  // ===========================================================================

  // GET /compliance/retention - Get retention compliance status
  fastify.get(
    `${prefix}/retention`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetRetentionStatus(request, reply);
    })
  );

  // POST /compliance/retention/enforce - Trigger manual enforcement
  fastify.post(
    `${prefix}/retention/enforce`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleEnforceRetention(request, reply);
    })
  );

  // GET /compliance/retention/report - Get last enforcement report
  fastify.get(
    `${prefix}/retention/report`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetLastReport(request, reply);
    })
  );

  // ===========================================================================
  // LITIGATION HOLD ROUTES
  // ===========================================================================

  // GET /compliance/holds - List active litigation holds
  fastify.get(
    `${prefix}/holds`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleListLitigationHolds(request, reply);
    })
  );

  // POST /compliance/holds - Create litigation hold
  fastify.post(
    `${prefix}/holds`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleCreateLitigationHold(request, reply);
    })
  );

  // GET /compliance/holds/:id - Get litigation hold by ID
  fastify.get(
    `${prefix}/holds/:id`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetLitigationHold(request, reply);
    })
  );

  // DELETE /compliance/holds/:id - Release litigation hold
  fastify.delete(
    `${prefix}/holds/:id`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleReleaseLitigationHold(request, reply);
    })
  );

  // GET /compliance/scheduler - Get scheduler status
  fastify.get(
    `${prefix}/scheduler`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetSchedulerStatus(request, reply);
    })
  );

  // ===========================================================================
  // EVIDENCE EXPORT ROUTES
  // ===========================================================================

  // POST /compliance/evidence/export - Start export job
  fastify.post(
    `${prefix}/evidence/export`,
    { preHandler: exportRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleStartExport(request, reply);
    })
  );

  // GET /compliance/evidence/export/:operationId - Get export status
  fastify.get(
    `${prefix}/evidence/export/:operationId`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetExportStatus(request, reply);
    })
  );

  // GET /compliance/evidence/export/:operationId/download - Download export
  fastify.get(
    `${prefix}/evidence/export/:operationId/download`,
    { preHandler: exportRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleDownloadExport(request, reply);
    })
  );

  // POST /compliance/evidence/export/:operationId/verify - Verify export integrity
  fastify.post(
    `${prefix}/evidence/export/:operationId/verify`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleVerifyExport(request, reply);
    })
  );

  // ===========================================================================
  // COMPLIANCE DASHBOARD ROUTES
  // ===========================================================================

  // GET /compliance/status - Get overall compliance status
  fastify.get(
    `${prefix}/status`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetComplianceStatus(request, reply);
    })
  );

  // GET /compliance/summary - Get compliance event summary
  fastify.get(
    `${prefix}/summary`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetComplianceSummary(request, reply);
    })
  );

  // GET /compliance/event-types - Get supported event types
  fastify.get(
    `${prefix}/event-types`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetEventTypes(request, reply);
    })
  );

  // ===========================================================================
  // SCHEDULED EXPORT ROUTES
  // ===========================================================================

  // POST /compliance/schedules - Create scheduled export
  fastify.post(
    `${prefix}/schedules`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleCreateSchedule(request, reply);
    })
  );

  // GET /compliance/schedules - List scheduled exports
  fastify.get(
    `${prefix}/schedules`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleListSchedules(request, reply);
    })
  );

  // GET /compliance/schedules/:scheduleId - Get scheduled export
  fastify.get(
    `${prefix}/schedules/:scheduleId`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetSchedule(request, reply);
    })
  );

  // PATCH /compliance/schedules/:scheduleId - Update scheduled export
  fastify.patch(
    `${prefix}/schedules/:scheduleId`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleUpdateSchedule(request, reply);
    })
  );

  // DELETE /compliance/schedules/:scheduleId - Delete scheduled export
  fastify.delete(
    `${prefix}/schedules/:scheduleId`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleDeleteSchedule(request, reply);
    })
  );

  // POST /compliance/schedules/:scheduleId/trigger - Manually trigger export
  fastify.post(
    `${prefix}/schedules/:scheduleId/trigger`,
    { preHandler: exportRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleTriggerSchedule(request, reply);
    })
  );

  // GET /compliance/schedules/:scheduleId/jobs/:jobId - Get job details
  fastify.get(
    `${prefix}/schedules/:scheduleId/jobs/:jobId`,
    { preHandler: adminRateLimit },
    withComplianceErrorHandling(async (request, reply) => {
      return handleGetScheduleJob(request, reply);
    })
  );

  logger.info({ prefix }, 'Compliance routes registered');
}

export default registerComplianceRoutesV1;
