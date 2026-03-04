/**
 * CAR Extension API Routes
 *
 * Exposes the CAR Extension framework via REST API endpoints.
 * Provides extension listing, details, invocation, and health monitoring.
 *
 * @packageDocumentation
 * @module @vorion/api/routes/extensions
 * @license Apache-2.0
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../common/errors.js';
import { ZodError } from 'zod';
import {
  createExtensionService,
  type ACIExtensionService,
  type ExtensionInfo,
  type AgentIdentity,
  type CapabilityRequest,
  type ActionRequest,
  type TrustTier,
} from '../../car-extensions/index.js';
import {
  cognigateExtension,
  monitoringExtension,
  auditExtension,
} from '../../car-extensions/index.js';
import { sendSuccess, sendError, sendNotFound } from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';

const logger = createLogger({ component: 'api-extensions' });

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

const extensionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const invokeCapabilityBodySchema = z.object({
  type: z.literal('capability'),
  agent: z.object({
    did: z.string().min(1),
    carId: z.string().min(1),
    publisher: z.string().min(1),
    name: z.string().min(1),
    trustTier: z.number().int().min(0).max(7),
    trustScore: z.number().min(0).max(1000),
    domains: z.number().int().min(0),
    level: z.number().int().min(0).max(5),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    metadata: z.record(z.unknown()).optional(),
  }),
  request: z.object({
    domains: z.array(z.string().min(1)),
    level: z.number().int().min(0).max(5),
    context: z.object({
      source: z.string().min(1),
      purpose: z.string().optional(),
      resource: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    ttl: z.number().int().positive().optional(),
  }),
});

const invokeActionBodySchema = z.object({
  type: z.literal('action'),
  agent: z.object({
    did: z.string().min(1),
    carId: z.string().min(1),
    publisher: z.string().min(1),
    name: z.string().min(1),
    trustTier: z.number().int().min(0).max(7),
    trustScore: z.number().min(0).max(1000),
    domains: z.number().int().min(0),
    level: z.number().int().min(0).max(5),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    metadata: z.record(z.unknown()).optional(),
  }),
  request: z.object({
    type: z.string().min(1),
    target: z.object({
      type: z.string().min(1),
      id: z.string().min(1),
      metadata: z.record(z.unknown()).optional(),
    }),
    params: z.record(z.unknown()),
    context: z.object({
      source: z.string().min(1),
      purpose: z.string().optional(),
      resource: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
});

const invokeBehaviorBodySchema = z.object({
  type: z.literal('behavior'),
  agent: z.object({
    did: z.string().min(1),
    carId: z.string().min(1),
    publisher: z.string().min(1),
    name: z.string().min(1),
    trustTier: z.number().int().min(0).max(7),
    trustScore: z.number().min(0).max(1000),
    domains: z.number().int().min(0),
    level: z.number().int().min(0).max(5),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const invokeBodySchema = z.discriminatedUnion('type', [
  invokeCapabilityBodySchema,
  invokeActionBodySchema,
  invokeBehaviorBodySchema,
]);

// =============================================================================
// EXTENSION SERVICE SINGLETON
// =============================================================================

let extensionService: ACIExtensionService | null = null;

/**
 * Get or create the extension service singleton with built-in extensions
 */
async function getExtensionService(): Promise<ACIExtensionService> {
  if (!extensionService) {
    extensionService = createExtensionService({
      defaultTimeout: 5000,
      failFast: false,
      logExecution: true,
      maxConcurrency: 10,
    });

    // Register built-in extensions
    try {
      await extensionService.registerExtension(cognigateExtension);
      logger.info({ extensionId: cognigateExtension.extensionId }, 'Registered governance extension');
    } catch (error) {
      logger.warn({ error, extensionId: cognigateExtension.extensionId }, 'Failed to register governance extension');
    }

    try {
      await extensionService.registerExtension(monitoringExtension);
      logger.info({ extensionId: monitoringExtension.extensionId }, 'Registered monitoring extension');
    } catch (error) {
      logger.warn({ error, extensionId: monitoringExtension.extensionId }, 'Failed to register monitoring extension');
    }

    try {
      await extensionService.registerExtension(auditExtension);
      logger.info({ extensionId: auditExtension.extensionId }, 'Registered audit extension');
    } catch (error) {
      logger.warn({ error, extensionId: auditExtension.extensionId }, 'Failed to register audit extension');
    }
  }

  return extensionService;
}

/**
 * Reset the extension service (for testing)
 */
export function resetExtensionService(): void {
  extensionService = null;
}

/**
 * Set a custom extension service (for testing)
 */
export function setExtensionService(service: ACIExtensionService): void {
  extensionService = service;
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * List all available extensions
 */
async function listExtensions(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const service = await getExtensionService();

  // Access the registry through the service's internal state
  // Since ACIExtensionService doesn't expose registry directly, we list via the service
  const extensions = await listExtensionsFromService(service);

  logger.info({ count: extensions.length }, 'Listed extensions');

  return sendSuccess(reply, { extensions }, HttpStatus.OK, request);
}

/**
 * Helper to list extensions from service
 * The service doesn't expose registry directly, so we use a workaround
 */
async function listExtensionsFromService(service: ACIExtensionService): Promise<ExtensionInfo[]> {
  // We need to access the registry - since it's private, we'll track registered extensions
  // This is a workaround since the service doesn't expose a list method
  const knownExtensions: ExtensionInfo[] = [];

  // Check known built-in extensions
  const builtinExtensions = [cognigateExtension, monitoringExtension, auditExtension];

  for (const ext of builtinExtensions) {
    // Try to load the extension to verify it's registered
    const loaded = service.loadAgentExtensions(`test#${ext.shortcode}`);
    if (loaded.length > 0) {
      knownExtensions.push({
        extensionId: ext.extensionId,
        name: ext.name,
        version: ext.version,
        shortcode: ext.shortcode,
        publisher: ext.publisher,
        description: ext.description,
        registeredAt: new Date(),
        loaded: true,
        hooks: getExtensionHooks(ext),
      });
    }
  }

  return knownExtensions;
}

/**
 * Get hooks available on an extension
 */
function getExtensionHooks(ext: typeof cognigateExtension): string[] {
  const hooks: string[] = [];

  if (ext.hooks?.onLoad) hooks.push('hooks.onLoad');
  if (ext.hooks?.onUnload) hooks.push('hooks.onUnload');
  if (ext.capability?.preCheck) hooks.push('capability.preCheck');
  if (ext.capability?.postGrant) hooks.push('capability.postGrant');
  if (ext.capability?.onExpiry) hooks.push('capability.onExpiry');
  if (ext.action?.preAction) hooks.push('action.preAction');
  if (ext.action?.postAction) hooks.push('action.postAction');
  if (ext.action?.onFailure) hooks.push('action.onFailure');
  if (ext.monitoring?.verifyBehavior) hooks.push('monitoring.verifyBehavior');
  if (ext.monitoring?.collectMetrics) hooks.push('monitoring.collectMetrics');
  if (ext.monitoring?.onAnomaly) hooks.push('monitoring.onAnomaly');
  if (ext.trust?.onRevocation) hooks.push('trust.onRevocation');
  if (ext.trust?.adjustTrust) hooks.push('trust.adjustTrust');
  if (ext.trust?.verifyAttestation) hooks.push('trust.verifyAttestation');
  if (ext.policy?.evaluate) hooks.push('policy.evaluate');
  if (ext.policy?.loadPolicy) hooks.push('policy.loadPolicy');

  return hooks;
}

/**
 * Get extension details by ID
 */
async function getExtension(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const params = extensionIdParamsSchema.parse(request.params);
  const service = await getExtensionService();

  // Find extension by ID or shortcode
  const extensions = await listExtensionsFromService(service);
  const extension = extensions.find(
    (ext) => ext.extensionId === params.id || ext.shortcode === params.id
  );

  if (!extension) {
    return sendNotFound(reply, 'Extension', request);
  }

  logger.info({ extensionId: extension.extensionId }, 'Retrieved extension details');

  return sendSuccess(reply, extension, HttpStatus.OK, request);
}

/**
 * Invoke an extension
 */
async function invokeExtension(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const params = extensionIdParamsSchema.parse(request.params);
  const body = invokeBodySchema.parse(request.body);
  const service = await getExtensionService();

  // Find extension by ID or shortcode
  const extensions = await listExtensionsFromService(service);
  const extension = extensions.find(
    (ext) => ext.extensionId === params.id || ext.shortcode === params.id
  );

  if (!extension) {
    return sendNotFound(reply, 'Extension', request);
  }

  // Prepare agent identity with the extension in CAR ID string
  const agent: AgentIdentity = {
    ...body.agent,
    trustTier: body.agent.trustTier as TrustTier,
    carId: body.agent.carId.includes('#')
      ? body.agent.carId
      : `${body.agent.carId}#${extension.shortcode}`,
  };

  let result: unknown;

  switch (body.type) {
    case 'capability': {
      const capabilityResult = await service.processCapabilityRequest(
        agent,
        body.request as CapabilityRequest
      );
      result = capabilityResult;
      logger.info(
        {
          extensionId: extension.extensionId,
          type: 'capability',
          granted: capabilityResult.granted,
        },
        'Invoked capability request'
      );
      break;
    }

    case 'action': {
      const actionResult = await service.processAction(
        agent,
        body.request as ActionRequest
      );
      result = actionResult;
      logger.info(
        {
          extensionId: extension.extensionId,
          type: 'action',
          proceeded: actionResult.proceeded,
        },
        'Invoked action request'
      );
      break;
    }

    case 'behavior': {
      const behaviorResult = await service.verifyBehavior(agent);
      result = behaviorResult;
      logger.info(
        {
          extensionId: extension.extensionId,
          type: 'behavior',
          inBounds: behaviorResult.inBounds,
        },
        'Invoked behavior verification'
      );
      break;
    }
  }

  return sendSuccess(reply, { result }, HttpStatus.OK, request);
}

/**
 * Get extension health/status
 */
async function getExtensionStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const params = extensionIdParamsSchema.parse(request.params);
  const service = await getExtensionService();

  // Find extension by ID or shortcode
  const extensions = await listExtensionsFromService(service);
  const extension = extensions.find(
    (ext) => ext.extensionId === params.id || ext.shortcode === params.id
  );

  if (!extension) {
    return sendNotFound(reply, 'Extension', request);
  }

  // Build status response
  const status = {
    extensionId: extension.extensionId,
    name: extension.name,
    version: extension.version,
    status: extension.loaded ? 'healthy' : 'unhealthy',
    loaded: extension.loaded,
    registeredAt: extension.registeredAt,
    hooks: {
      total: extension.hooks.length,
      available: extension.hooks,
    },
    capabilities: {
      hasCapabilityHooks: extension.hooks.some((h) => h.startsWith('capability.')),
      hasActionHooks: extension.hooks.some((h) => h.startsWith('action.')),
      hasMonitoringHooks: extension.hooks.some((h) => h.startsWith('monitoring.')),
      hasTrustHooks: extension.hooks.some((h) => h.startsWith('trust.')),
      hasPolicyEngine: extension.hooks.some((h) => h.startsWith('policy.')),
    },
    timestamp: new Date().toISOString(),
  };

  logger.info(
    { extensionId: extension.extensionId, status: status.status },
    'Retrieved extension status'
  );

  return sendSuccess(reply, status, HttpStatus.OK, request);
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Extension routes roles
 */
export const EXTENSION_ROLES = {
  /** Roles that can list and read extensions */
  READ: ['admin', 'tenant:admin', 'extension:admin', 'extension_reader', 'agent:operator'],
  /** Roles that can invoke extensions */
  INVOKE: ['admin', 'tenant:admin', 'extension:admin', 'agent:operator'],
} as const;

/**
 * Check if user has required role
 */
function hasRequiredRole(
  userRoles: string[] | undefined,
  requiredRoles: readonly string[]
): boolean {
  const roles = userRoles ?? [];
  return roles.some((role) => requiredRoles.includes(role));
}

/**
 * Wrap handler with error handling
 */
function withErrorHandling<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
): (request: FastifyRequest, reply: FastifyReply) => Promise<T | void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          path: e.path.join('.') || '(root)',
          message: e.message,
          code: e.code,
        }));
        throw new ValidationError('Request validation failed', { errors });
      }
      throw error;
    }
  };
}

/**
 * Register extension routes
 *
 * @param server - Fastify server instance
 * @param options - Route options
 */
export async function registerExtensionRoutes(
  server: FastifyInstance,
  options?: { prefix?: string }
): Promise<void> {
  const prefix = options?.prefix ?? '/extensions';

  // GET /extensions - List all extensions
  server.get(prefix, withErrorHandling(async (request, reply) => {
    const user = request.user as { roles?: string[] } | undefined;

    if (!hasRequiredRole(user?.roles, EXTENSION_ROLES.READ)) {
      throw new ForbiddenError('Insufficient permissions to list extensions', {
        requiredRoles: EXTENSION_ROLES.READ,
      });
    }

    return listExtensions(request, reply);
  }));

  // GET /extensions/:id - Get extension details
  server.get(`${prefix}/:id`, withErrorHandling(async (request, reply) => {
    const user = request.user as { roles?: string[] } | undefined;

    if (!hasRequiredRole(user?.roles, EXTENSION_ROLES.READ)) {
      throw new ForbiddenError('Insufficient permissions to read extension', {
        requiredRoles: EXTENSION_ROLES.READ,
      });
    }

    return getExtension(
      request as FastifyRequest<{ Params: { id: string } }>,
      reply
    );
  }));

  // POST /extensions/:id/invoke - Invoke extension
  server.post(`${prefix}/:id/invoke`, withErrorHandling(async (request, reply) => {
    const user = request.user as { roles?: string[] } | undefined;

    if (!hasRequiredRole(user?.roles, EXTENSION_ROLES.INVOKE)) {
      throw new ForbiddenError('Insufficient permissions to invoke extension', {
        requiredRoles: EXTENSION_ROLES.INVOKE,
      });
    }

    return invokeExtension(
      request as FastifyRequest<{ Params: { id: string } }>,
      reply
    );
  }));

  // GET /extensions/:id/status - Get extension health/status
  server.get(`${prefix}/:id/status`, withErrorHandling(async (request, reply) => {
    const user = request.user as { roles?: string[] } | undefined;

    if (!hasRequiredRole(user?.roles, EXTENSION_ROLES.READ)) {
      throw new ForbiddenError('Insufficient permissions to read extension status', {
        requiredRoles: EXTENSION_ROLES.READ,
      });
    }

    return getExtensionStatus(
      request as FastifyRequest<{ Params: { id: string } }>,
      reply
    );
  }));

  logger.info({ prefix }, 'Extension routes registered');
}

export default registerExtensionRoutes;
