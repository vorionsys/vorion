/**
 * Service Accounts API Routes
 *
 * Management API for service-to-service authentication accounts.
 * Provides endpoints for creating, listing, revoking, and rotating service accounts.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import '@fastify/swagger'; // Activates FastifySchema augmentation (description, tags)
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  getServiceAccountManager,
  ServiceAccountManager,
  type ServiceAccount,
  type CreateServiceAccountInput,
  type UpdateServiceAccountInput,
  ServiceAccountNotFoundError,
  ServiceAccountError,
  createServiceAccountInputSchema,
  updateServiceAccountInputSchema,
} from '../../security/service-auth/index.js';

const logger = createLogger({ component: 'api-v1-service-accounts' });

// =============================================================================
// REQUEST/RESPONSE SCHEMAS
// =============================================================================

const createServiceAccountBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  permissions: z.array(z.string()).min(1),
  ipWhitelist: z.array(z.string().ip()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateServiceAccountBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  permissions: z.array(z.string()).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const serviceAccountIdParamsSchema = z.object({
  id: z.string().min(1),
});

const listServiceAccountsQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'suspended']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get tenant ID from JWT and verify membership
 */
async function getTenantIdFromRequest(request: FastifyRequest): Promise<string> {
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
 * Get user info from JWT
 */
async function getUserFromRequest(
  request: FastifyRequest
): Promise<{ sub: string; roles: string[] }> {
  const payload = await request.jwtVerify<{ sub?: string; roles?: string[] }>();

  return {
    sub: payload.sub ?? 'unknown',
    roles: payload.roles ?? [],
  };
}

/**
 * Check if user has admin role
 */
function isAdmin(roles: string[]): boolean {
  return (
    roles.includes('admin') ||
    roles.includes('tenant:admin') ||
    roles.includes('system:admin') ||
    roles.includes('service:admin')
  );
}

/**
 * Sanitize service account for response (remove sensitive fields)
 */
function sanitizeServiceAccount(account: ServiceAccount): Omit<ServiceAccount, 'clientSecret'> & {
  clientSecret?: undefined;
} {
  const { clientSecret: _secret, ...safe } = account;
  return safe;
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * Create a new service account
 * POST /service-accounts
 */
async function createServiceAccount(
  request: FastifyRequest<{ Body: z.infer<typeof createServiceAccountBodySchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    logger.warn({ userId: user.sub }, 'Unauthorized service account creation attempt');
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to create service accounts' },
    });
  }

  const body = createServiceAccountBodySchema.parse(request.body);

  const manager = getServiceAccountManager();

  const input: CreateServiceAccountInput = {
    name: body.name,
    permissions: body.permissions,
    tenantId,
    ipWhitelist: body.ipWhitelist,
    description: body.description,
    metadata: body.metadata as Record<string, unknown>,
  };

  const result = await manager.createAccount(input);

  logger.info(
    {
      clientId: result.account.clientId,
      tenantId,
      name: body.name,
      createdBy: user.sub,
    },
    'Service account created'
  );

  // Return the account with the plaintext secret (only time it's available)
  return reply.status(201).send({
    data: {
      ...sanitizeServiceAccount(result.account),
      clientSecret: result.clientSecretPlaintext,
    },
    message:
      'Service account created. Store the client secret securely - it will not be shown again.',
  });
}

/**
 * List service accounts for tenant
 * GET /service-accounts
 */
async function listServiceAccounts(
  request: FastifyRequest<{ Querystring: z.infer<typeof listServiceAccountsQuerySchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  // Any authenticated user can list accounts for their tenant
  const query = listServiceAccountsQuerySchema.parse(request.query);

  const manager = getServiceAccountManager();
  let accounts = await manager.listAccounts(tenantId);

  // Apply filters
  if (query.status) {
    accounts = accounts.filter((a) => a.status === query.status);
  }

  if (query.search) {
    const searchLower = query.search.toLowerCase();
    accounts = accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(searchLower) ||
        a.clientId.toLowerCase().includes(searchLower) ||
        a.description?.toLowerCase().includes(searchLower)
    );
  }

  // Apply pagination
  const total = accounts.length;
  const paginatedAccounts = accounts.slice(query.offset, query.offset + query.limit);

  logger.debug(
    { tenantId, userId: user.sub, count: paginatedAccounts.length, total },
    'Service accounts listed'
  );

  return reply.send({
    data: paginatedAccounts.map(sanitizeServiceAccount),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + query.limit < total,
    },
  });
}

/**
 * Get a specific service account
 * GET /service-accounts/:id
 */
async function getServiceAccount(
  request: FastifyRequest<{ Params: z.infer<typeof serviceAccountIdParamsSchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const params = serviceAccountIdParamsSchema.parse(request.params);

  const manager = getServiceAccountManager();

  try {
    const account = await manager.getAccount(params.id);

    // Verify account belongs to tenant
    if (account.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    // Check if secret rotation is recommended
    const rotationRecommended = await manager.isSecretRotationRecommended(params.id);

    return reply.send({
      data: {
        ...sanitizeServiceAccount(account),
        rotationRecommended,
      },
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    throw error;
  }
}

/**
 * Update a service account
 * PATCH /service-accounts/:id
 */
async function updateServiceAccount(
  request: FastifyRequest<{
    Params: z.infer<typeof serviceAccountIdParamsSchema>;
    Body: z.infer<typeof updateServiceAccountBodySchema>;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to update service accounts' },
    });
  }

  const params = serviceAccountIdParamsSchema.parse(request.params);
  const body = updateServiceAccountBodySchema.parse(request.body);

  const manager = getServiceAccountManager();

  try {
    // Verify account exists and belongs to tenant
    const existing = await manager.getAccount(params.id);
    if (existing.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    const updates: UpdateServiceAccountInput = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.permissions !== undefined) updates.permissions = body.permissions;
    if (body.ipWhitelist !== undefined) updates.ipWhitelist = body.ipWhitelist;
    if (body.metadata !== undefined) updates.metadata = body.metadata as Record<string, unknown>;

    const updated = await manager.updateAccount(params.id, updates);

    logger.info(
      { clientId: params.id, tenantId, updatedBy: user.sub },
      'Service account updated'
    );

    return reply.send({
      data: sanitizeServiceAccount(updated),
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    throw error;
  }
}

/**
 * Delete (revoke) a service account
 * DELETE /service-accounts/:id
 */
async function deleteServiceAccount(
  request: FastifyRequest<{ Params: z.infer<typeof serviceAccountIdParamsSchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to revoke service accounts' },
    });
  }

  const params = serviceAccountIdParamsSchema.parse(request.params);

  const manager = getServiceAccountManager();

  try {
    // Verify account exists and belongs to tenant
    const existing = await manager.getAccount(params.id);
    if (existing.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    const revoked = await manager.revokeAccount(params.id);

    logger.warn(
      { clientId: params.id, tenantId, revokedBy: user.sub },
      'Service account revoked'
    );

    return reply.send({
      data: sanitizeServiceAccount(revoked),
      message: 'Service account has been revoked and can no longer authenticate.',
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    if (error instanceof ServiceAccountError) {
      return reply.status(400).send({
        error: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Rotate service account secret
 * POST /service-accounts/:id/rotate
 */
async function rotateServiceAccountSecret(
  request: FastifyRequest<{ Params: z.infer<typeof serviceAccountIdParamsSchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to rotate secrets' },
    });
  }

  const params = serviceAccountIdParamsSchema.parse(request.params);

  const manager = getServiceAccountManager();

  try {
    // Verify account exists and belongs to tenant
    const existing = await manager.getAccount(params.id);
    if (existing.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    const result = await manager.rotateSecret(params.id);

    logger.warn(
      { clientId: params.id, tenantId, rotatedBy: user.sub },
      'Service account secret rotated'
    );

    return reply.send({
      data: {
        ...sanitizeServiceAccount(result.account),
        newClientSecret: result.newClientSecretPlaintext,
      },
      message:
        'Secret rotated successfully. Store the new client secret securely - it will not be shown again. The previous secret is now invalid.',
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    if (error instanceof ServiceAccountError) {
      return reply.status(400).send({
        error: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Suspend a service account
 * POST /service-accounts/:id/suspend
 */
async function suspendServiceAccount(
  request: FastifyRequest<{ Params: z.infer<typeof serviceAccountIdParamsSchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to suspend service accounts' },
    });
  }

  const params = serviceAccountIdParamsSchema.parse(request.params);

  const manager = getServiceAccountManager();

  try {
    const existing = await manager.getAccount(params.id);
    if (existing.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    const suspended = await manager.suspendAccount(params.id);

    logger.warn(
      { clientId: params.id, tenantId, suspendedBy: user.sub },
      'Service account suspended'
    );

    return reply.send({
      data: sanitizeServiceAccount(suspended),
      message: 'Service account has been suspended. It can be reactivated later.',
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    if (error instanceof ServiceAccountError) {
      return reply.status(400).send({
        error: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Reactivate a suspended service account
 * POST /service-accounts/:id/reactivate
 */
async function reactivateServiceAccount(
  request: FastifyRequest<{ Params: z.infer<typeof serviceAccountIdParamsSchema> }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const tenantId = await getTenantIdFromRequest(request);
  const user = await getUserFromRequest(request);

  if (!isAdmin(user.roles)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin role required to reactivate service accounts' },
    });
  }

  const params = serviceAccountIdParamsSchema.parse(request.params);

  const manager = getServiceAccountManager();

  try {
    const existing = await manager.getAccount(params.id);
    if (existing.tenantId !== tenantId) {
      throw new NotFoundError('Service account not found');
    }

    const reactivated = await manager.reactivateAccount(params.id);

    logger.info(
      { clientId: params.id, tenantId, reactivatedBy: user.sub },
      'Service account reactivated'
    );

    return reply.send({
      data: sanitizeServiceAccount(reactivated),
      message: 'Service account has been reactivated.',
    });
  } catch (error) {
    if (error instanceof ServiceAccountNotFoundError) {
      throw new NotFoundError('Service account not found');
    }
    if (error instanceof ServiceAccountError) {
      return reply.status(400).send({
        error: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Register service accounts v1 routes
 */
export async function registerServiceAccountsRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Rate limits for different operations
  const createRateLimit = rateLimit({ limit: 10, windowSeconds: 60 });
  const readRateLimit = rateLimit({ limit: 100, windowSeconds: 60 });
  const updateRateLimit = rateLimit({ limit: 20, windowSeconds: 60 });
  const sensitiveRateLimit = rateLimit({ limit: 5, windowSeconds: 60 });

  // Create service account
  fastify.post(
    '/service-accounts',
    {
      preHandler: createRateLimit,
      schema: {
        description: 'Create a new service account for service-to-service authentication',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'permissions'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
            permissions: { type: 'array', items: { type: 'string' }, minItems: 1 },
            ipWhitelist: { type: 'array', items: { type: 'string', format: 'ipv4' } },
            metadata: { type: 'object' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              data: { type: 'object' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    createServiceAccount
  );

  // List service accounts
  fastify.get(
    '/service-accounts',
    {
      preHandler: readRateLimit,
      schema: {
        description: 'List service accounts for the current tenant',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'revoked', 'suspended'] },
            search: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    listServiceAccounts
  );

  // Get service account
  fastify.get(
    '/service-accounts/:id',
    {
      preHandler: readRateLimit,
      schema: {
        description: 'Get a specific service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    getServiceAccount
  );

  // Update service account
  fastify.patch(
    '/service-accounts/:id',
    {
      preHandler: updateRateLimit,
      schema: {
        description: 'Update a service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
            permissions: { type: 'array', items: { type: 'string' } },
            ipWhitelist: { type: 'array', items: { type: 'string', format: 'ipv4' } },
            metadata: { type: 'object' },
          },
        },
      },
    },
    updateServiceAccount
  );

  // Delete (revoke) service account
  fastify.delete(
    '/service-accounts/:id',
    {
      preHandler: sensitiveRateLimit,
      schema: {
        description: 'Revoke a service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    deleteServiceAccount
  );

  // Rotate secret
  fastify.post(
    '/service-accounts/:id/rotate',
    {
      preHandler: sensitiveRateLimit,
      schema: {
        description: 'Rotate the client secret for a service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    rotateServiceAccountSecret
  );

  // Suspend service account
  fastify.post(
    '/service-accounts/:id/suspend',
    {
      preHandler: sensitiveRateLimit,
      schema: {
        description: 'Suspend a service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    suspendServiceAccount
  );

  // Reactivate service account
  fastify.post(
    '/service-accounts/:id/reactivate',
    {
      preHandler: updateRateLimit,
      schema: {
        description: 'Reactivate a suspended service account',
        tags: ['Service Accounts'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    reactivateServiceAccount
  );

  logger.debug('Service accounts routes registered');
}

export default registerServiceAccountsRoutesV1;
