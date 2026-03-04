/**
 * API v1 Policy Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  createPolicyService,
  getPolicyLoader,
  POLICY_STATUSES,
} from '../../policy/index.js';
import { PolicyValidationException } from '../../policy/service.js';
import type { PolicyStatus, PolicyDefinition } from '../../policy/index.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { POLICY_ROLES, checkAuthorization } from '../../common/authorization.js';
import { recordAuditEvent } from '../middleware/audit.js';
import { getOperationTracker } from '../../common/operation-tracker.js';
import { withRateLimit } from '../rate-limit.js';
import { getConfig } from '../../common/config.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';

// Rate limit configurations for policy endpoints
const policyRateLimits = {
  create: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  update: createEndpointRateLimit({ max: 30, windowSeconds: 60 }),
  delete: createEndpointRateLimit({ max: 10, windowSeconds: 3600 }),
  publish: createEndpointRateLimit({ max: 20, windowSeconds: 60 }),
  deprecate: createEndpointRateLimit({ max: 20, windowSeconds: 60 }),
  archive: createEndpointRateLimit({ max: 20, windowSeconds: 60 }),
  rollback: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
};

const policyLogger = createLogger({ component: 'api-v1-policies' });
const policyService = createPolicyService();
const policyLoader = getPolicyLoader();
const config = getConfig();

const policyIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const policyVersionParamsSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().min(1),
});

const policyDiffBodySchema = z.object({
  version1: z.number().int().min(1),
  version2: z.number().int().min(1),
});

const policyListQuerySchema = z.object({
  namespace: z.string().optional(),
  status: z
    .string()
    .refine((value): value is PolicyStatus => POLICY_STATUSES.includes(value as PolicyStatus), {
      message: 'Invalid policy status',
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const policyCreateBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  namespace: z.string().min(1).max(100).optional(),
  definition: z.object({
    version: z.literal('1.0'),
    target: z.object({
      intentTypes: z.array(z.string()).optional(),
      entityTypes: z.array(z.string()).optional(),
      trustLevels: z.array(z.number().int().min(0).max(4)).optional(),
      namespaces: z.array(z.string()).optional(),
    }).optional(),
    rules: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      priority: z.number().int(),
      enabled: z.boolean(),
      when: z.any(),
      then: z.object({
        action: z.enum(['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate']),
        reason: z.string().optional(),
        escalation: z.object({
          to: z.string(),
          timeout: z.string(),
          requireJustification: z.boolean().optional(),
          autoDenyOnTimeout: z.boolean().optional(),
        }).optional(),
        constraints: z.record(z.unknown()).optional(),
      }),
    })),
    defaultAction: z.enum(['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate']),
    defaultReason: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  metadata: z.record(z.unknown()).optional(),
});

const policyUpdateBodySchema = z.object({
  description: z.string().max(1000).optional(),
  definition: policyCreateBodySchema.shape.definition.optional(),
  changeSummary: z.string().max(500).optional(),
});

/** Schema for bulk create request */
const bulkCreatePoliciesBodySchema = z.object({
  policies: z.array(policyCreateBodySchema).min(1).max(100),
});

/** Schema for bulk archive request */
const bulkArchivePoliciesBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * Check if user has admin role
 */
function isAdmin(user: { roles?: string[] }): boolean {
  const roles = user.roles ?? [];
  return roles.includes('admin') || roles.includes('tenant:admin') || roles.includes('policy:admin');
}

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
 * Register v1 policy routes
 */
export async function registerPolicyRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Create policy
  fastify.post('/policies', {
    preHandler: policyRateLimits.create,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string };
    const body = policyCreateBodySchema.parse(request.body ?? {});

    try {
      const createInput: Parameters<typeof policyService.create>[1] = {
        name: body.name,
        definition: body.definition as PolicyDefinition,
      };
      if (body.description !== undefined) createInput.description = body.description;
      if (body.namespace !== undefined) createInput.namespace = body.namespace;
      if (user.sub !== undefined) createInput.createdBy = user.sub;

      const policy = await policyService.create(tenantId, createInput);

      // Record audit event for policy creation
      await recordAuditEvent(request, {
        eventType: 'policy.created',
        resourceType: 'policy',
        resourceId: policy.id,
        afterState: policy as unknown as Record<string, unknown>,
        metadata: {
          policyName: policy.name,
          namespace: policy.namespace,
        },
      });

      policyLogger.info(
        { policyId: policy.id, name: policy.name, tenantId },
        'Policy created'
      );

      return reply.code(201).send(policy);
    } catch (error) {
      if (error instanceof PolicyValidationException) {
        return reply.status(400).send({
          error: {
            code: 'POLICY_VALIDATION_ERROR',
            message: error.message,
            details: error.errors,
          },
        });
      }
      throw error;
    }
  });

  // List policies
  fastify.get('/policies', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.READ)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const query = policyListQuerySchema.parse(request.query ?? {});

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const listFilters: Parameters<typeof policyService.list>[0] = {
      tenantId,
      limit: limit + 1,
      offset,
    };
    if (query.namespace) listFilters.namespace = query.namespace;
    if (query.status) listFilters.status = query.status;

    const policies = await policyService.list(listFilters);

    const hasMore = policies.length > limit;
    const data = hasMore ? policies.slice(0, limit) : policies;

    return reply.send({
      data,
      pagination: {
        total: data.length + offset,
        hasMore,
      },
    });
  });

  // Get policy by ID
  fastify.get('/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.READ)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const policy = await policyService.findById(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    return reply.send(policy);
  });

  // Update policy
  fastify.put('/policies/:id', {
    preHandler: policyRateLimits.update,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string };
    const params = policyIdParamsSchema.parse(request.params ?? {});
    const body = policyUpdateBodySchema.parse(request.body ?? {});

    // Capture before state for audit logging
    const beforePolicy = await policyService.findById(params.id, tenantId);

    try {
      const updateInput: Parameters<typeof policyService.update>[2] = {};
      if (body.description !== undefined) updateInput.description = body.description;
      if (body.definition !== undefined) updateInput.definition = body.definition as PolicyDefinition;
      if (body.changeSummary !== undefined) updateInput.changeSummary = body.changeSummary;
      if (user.sub !== undefined) updateInput.updatedBy = user.sub;

      const policy = await policyService.update(params.id, tenantId, updateInput);

      if (!policy) {
        return reply.status(404).send({
          error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
        });
      }

      await policyLoader.invalidateCache(tenantId, policy.namespace);

      // Record audit event for policy update
      await recordAuditEvent(request, {
        eventType: 'policy.updated',
        resourceType: 'policy',
        resourceId: policy.id,
        beforeState: beforePolicy as unknown as Record<string, unknown>,
        afterState: policy as unknown as Record<string, unknown>,
        metadata: {
          policyName: policy.name,
          version: policy.version,
          changeSummary: body.changeSummary,
        },
      });

      policyLogger.info(
        { policyId: policy.id, version: policy.version, tenantId },
        'Policy updated'
      );

      return reply.send(policy);
    } catch (error) {
      if (error instanceof PolicyValidationException) {
        return reply.status(400).send({
          error: {
            code: 'POLICY_VALIDATION_ERROR',
            message: error.message,
            details: error.errors,
          },
        });
      }
      throw error;
    }
  });

  // Publish policy
  fastify.post('/policies/:id/publish', {
    preHandler: policyRateLimits.publish,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const policy = await policyService.publish(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    await policyLoader.invalidateCache(tenantId, policy.namespace);

    policyLogger.info(
      { policyId: policy.id, name: policy.name, tenantId },
      'Policy published'
    );

    return reply.send(policy);
  });

  // Deprecate policy
  fastify.post('/policies/:id/deprecate', {
    preHandler: policyRateLimits.deprecate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const policy = await policyService.deprecate(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    await policyLoader.invalidateCache(tenantId, policy.namespace);

    policyLogger.info(
      { policyId: policy.id, name: policy.name, tenantId },
      'Policy deprecated'
    );

    return reply.send(policy);
  });

  // Archive policy
  fastify.post('/policies/:id/archive', {
    preHandler: policyRateLimits.archive,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const policy = await policyService.archive(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    await policyLoader.invalidateCache(tenantId, policy.namespace);

    policyLogger.info(
      { policyId: policy.id, name: policy.name, tenantId },
      'Policy archived'
    );

    return reply.send(policy);
  });

  // Delete policy (draft only)
  fastify.delete('/policies/:id', {
    preHandler: policyRateLimits.delete,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.DELETE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const policy = await policyService.findById(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    if (policy.status !== 'draft') {
      return reply.status(400).send({
        error: {
          code: 'POLICY_NOT_DRAFT',
          message: 'Only draft policies can be deleted. Use archive for published policies.',
        },
      });
    }

    const deleted = await policyService.delete(params.id, tenantId);
    if (!deleted) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    await policyLoader.invalidateCache(tenantId, policy.namespace);

    // Record audit event for policy deletion
    await recordAuditEvent(request, {
      eventType: 'policy.deleted',
      resourceType: 'policy',
      resourceId: params.id,
      beforeState: policy as unknown as Record<string, unknown>,
      metadata: {
        policyName: policy.name,
        namespace: policy.namespace,
      },
    });

    policyLogger.info(
      { policyId: params.id, tenantId },
      'Policy deleted'
    );

    return reply.status(204).send();
  });

  // =============================================================================
  // BULK OPERATIONS
  // =============================================================================

  const operationTracker = getOperationTracker();

  /**
   * Bulk create multiple policies
   * POST /policies/bulk-create
   *
   * Returns 202 Accepted with operation ID for tracking progress.
   */
  fastify.post('/policies/bulk-create', {
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };

    // Require admin role for bulk operations
    if (!isAdmin(user)) {
      policyLogger.warn(
        { userId: user.sub, tenantId },
        'Unauthorized bulk create attempt - admin role required'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Bulk operations require administrator role',
        },
      });
    }

    const body = bulkCreatePoliciesBodySchema.parse(request.body ?? {});
    const { policies: policyInputs } = body;

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'bulk_create',
      tenantId,
      createdBy: user.sub,
      totalItems: policyInputs.length,
      metadata: {
        policyCount: policyInputs.length,
        initiatedBy: user.sub,
      },
    });

    policyLogger.info(
      { operationId, userId: user.sub, tenantId, policyCount: policyInputs.length },
      'Bulk create operation started'
    );

    // Process policies asynchronously
    // Note: In production, this should be moved to a worker queue
    setImmediate(async () => {
      const results: Array<{
        index: number;
        name: string;
        success: boolean;
        policyId?: string;
        error?: string;
      }> = [];

      try {
        for (let i = 0; i < policyInputs.length; i++) {
          const input = policyInputs[i]!;
          try {
            const createInput: Parameters<typeof policyService.create>[1] = {
              name: input.name,
              definition: input.definition as PolicyDefinition,
            };
            if (input.description !== undefined) createInput.description = input.description;
            if (input.namespace !== undefined) createInput.namespace = input.namespace;
            if (user.sub !== undefined) createInput.createdBy = user.sub;

            const policy = await policyService.create(tenantId, createInput);

            results.push({
              index: i,
              name: input.name,
              success: true,
              policyId: policy.id,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            results.push({
              index: i,
              name: input.name,
              success: false,
              error: errorMessage,
            });
          }

          // Update progress
          await operationTracker.updateProgress(operationId, i + 1, policyInputs.length);
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        await operationTracker.completeOperation(operationId, {
          results,
          summary: {
            total: policyInputs.length,
            succeeded,
            failed,
          },
        });

        policyLogger.info(
          { operationId, succeeded, failed, total: policyInputs.length },
          'Bulk create operation completed'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await operationTracker.failOperation(operationId, errorMessage);
        policyLogger.error(
          { operationId, error: errorMessage },
          'Bulk create operation failed'
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
      message: 'Bulk create operation started. Use the operationId to track progress.',
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
      _links: {
        status: `${baseUrl}/api/v1/operations/${operationId}`,
        progress: `${baseUrl}/api/v1/operations/${operationId}/progress`,
      },
    });
  });

  /**
   * Bulk archive multiple policies
   * POST /policies/bulk-archive
   *
   * Returns 202 Accepted with operation ID for tracking progress.
   */
  fastify.post('/policies/bulk-archive', {
    config: {
      rateLimit: {
        max: config.api.bulkRateLimit ?? 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [withRateLimit({ requestsPerMinute: 10, burstLimit: 5 })],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string; roles?: string[] };

    // Require admin role for bulk operations
    if (!isAdmin(user)) {
      policyLogger.warn(
        { userId: user.sub, tenantId },
        'Unauthorized bulk archive attempt - admin role required'
      );
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Bulk operations require administrator role',
        },
      });
    }

    const body = bulkArchivePoliciesBodySchema.parse(request.body ?? {});
    const { ids } = body;

    // Create operation for tracking
    const operationId = await operationTracker.createOperation({
      type: 'bulk_archive',
      tenantId,
      createdBy: user.sub,
      totalItems: ids.length,
      metadata: {
        policyCount: ids.length,
        initiatedBy: user.sub,
      },
    });

    policyLogger.info(
      { operationId, userId: user.sub, tenantId, policyCount: ids.length },
      'Bulk archive operation started'
    );

    // Process archives asynchronously
    setImmediate(async () => {
      const results: Array<{
        id: string;
        success: boolean;
        error?: string;
      }> = [];

      try {
        for (let i = 0; i < ids.length; i++) {
          const policyId = ids[i]!;
          try {
            const policy = await policyService.archive(policyId, tenantId);

            if (!policy) {
              results.push({
                id: policyId,
                success: false,
                error: 'Policy not found',
              });
            } else {
              await policyLoader.invalidateCache(tenantId, policy.namespace);
              results.push({
                id: policyId,
                success: true,
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            results.push({
              id: policyId,
              success: false,
              error: errorMessage,
            });
          }

          // Update progress
          await operationTracker.updateProgress(operationId, i + 1, ids.length);
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        await operationTracker.completeOperation(operationId, {
          results,
          summary: {
            total: ids.length,
            succeeded,
            failed,
          },
        });

        policyLogger.info(
          { operationId, succeeded, failed, total: ids.length },
          'Bulk archive operation completed'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await operationTracker.failOperation(operationId, errorMessage);
        policyLogger.error(
          { operationId, error: errorMessage },
          'Bulk archive operation failed'
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
      message: 'Bulk archive operation started. Use the operationId to track progress.',
      statusUrl: `${baseUrl}/api/v1/operations/${operationId}`,
      _links: {
        status: `${baseUrl}/api/v1/operations/${operationId}`,
        progress: `${baseUrl}/api/v1/operations/${operationId}/progress`,
      },
    });
  });

  // =============================================================================
  // VERSION MANAGEMENT ROUTES
  // =============================================================================

  /**
   * GET /policies/:id/versions - List all versions of a policy
   * Returns version history including current version
   */
  fastify.get('/policies/:id/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.READ)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});

    const versions = await policyService.getVersionHistory(params.id, tenantId);

    if (versions.length === 0) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    return reply.send({
      data: versions,
      pagination: {
        total: versions.length,
      },
    });
  });

  /**
   * GET /policies/:id/versions/:version - Get a specific version of a policy
   */
  fastify.get('/policies/:id/versions/:version', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.READ)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyVersionParamsSchema.parse(request.params ?? {});

    const version = await policyService.getVersion(params.id, params.version, tenantId);

    if (!version) {
      return reply.status(404).send({
        error: { code: 'VERSION_NOT_FOUND', message: 'Policy version not found' },
      });
    }

    return reply.send(version);
  });

  /**
   * POST /policies/:id/rollback/:version - Rollback policy to a previous version
   * Creates a new version with the definition from the target version
   */
  fastify.post('/policies/:id/rollback/:version', {
    preHandler: policyRateLimits.rollback,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.WRITE)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const user = request.user as { sub?: string };
    const params = policyVersionParamsSchema.parse(request.params ?? {});

    // Get current policy for audit logging
    const beforePolicy = await policyService.findById(params.id, tenantId);
    if (!beforePolicy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    try {
      const policy = await policyService.rollbackToVersion(
        params.id,
        params.version,
        tenantId,
        user.sub
      );

      if (!policy) {
        return reply.status(404).send({
          error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
        });
      }

      await policyLoader.invalidateCache(tenantId, policy.namespace);

      // Record audit event for rollback
      await recordAuditEvent(request, {
        eventType: 'policy.rolled_back',
        resourceType: 'policy',
        resourceId: policy.id,
        beforeState: beforePolicy as unknown as Record<string, unknown>,
        afterState: policy as unknown as Record<string, unknown>,
        metadata: {
          policyName: policy.name,
          previousVersion: beforePolicy.version,
          targetVersion: params.version,
          newVersion: policy.version,
        },
      });

      policyLogger.info(
        {
          policyId: policy.id,
          previousVersion: beforePolicy.version,
          targetVersion: params.version,
          newVersion: policy.version,
          tenantId,
        },
        'Policy rolled back'
      );

      return reply.send(policy);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot rollback')) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ROLLBACK',
            message: error.message,
          },
        });
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({
          error: {
            code: 'VERSION_NOT_FOUND',
            message: 'Target version not found',
          },
        });
      }
      throw error;
    }
  });

  /**
   * POST /policies/:id/diff - Compare two versions of a policy
   * Returns detailed diff between the versions
   */
  fastify.post('/policies/:id/diff', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await checkAuthorization(request, reply, POLICY_ROLES.READ)) {
      return;
    }

    const tenantId = await getTenantId(request);
    const params = policyIdParamsSchema.parse(request.params ?? {});
    const body = policyDiffBodySchema.parse(request.body ?? {});

    // Verify policy exists
    const policy = await policyService.findById(params.id, tenantId);
    if (!policy) {
      return reply.status(404).send({
        error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' },
      });
    }

    const comparison = await policyService.compareVersions(
      params.id,
      body.version1,
      body.version2,
      tenantId
    );

    if (!comparison) {
      return reply.status(404).send({
        error: {
          code: 'VERSION_NOT_FOUND',
          message: 'One or both versions not found',
        },
      });
    }

    return reply.send({
      policyId: comparison.policyId,
      version1: comparison.version1,
      version2: comparison.version2,
      hasChanges: comparison.diff.hasChanges,
      changeCount: comparison.diff.changeCount,
      summary: comparison.diff.summary,
      changes: comparison.diff.changes,
      categorized: comparison.diff.categorized,
    });
  });

  policyLogger.debug('Policy routes registered');
}
