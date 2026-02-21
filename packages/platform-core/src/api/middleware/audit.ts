/**
 * Audit Middleware
 *
 * Comprehensive audit logging middleware for API endpoints.
 * Records all mutation operations (POST, PUT, PATCH, DELETE) with
 * before/after state tracking for compliance and forensic analysis.
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, FastifyInstance, HookHandlerDoneFunction } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { createAuditService, type AuditService } from '../../audit/service.js';
import type { CreateAuditRecordInput, AuditActor, AuditTarget, AuditStateChange } from '../../audit/types.js';

const auditLogger = createLogger({ component: 'audit-middleware' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported HTTP methods for audit logging
 */
export const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type MutationMethod = (typeof MUTATION_METHODS)[number];

/**
 * Audit event configuration for a specific route
 */
export interface AuditEventConfig {
  /** The event type to record (e.g., 'policy.created', 'escalation.approved') */
  eventType: string;
  /** The type of resource being modified */
  resourceType: AuditTarget['type'];
  /** Function to extract resource ID from request */
  getResourceId?: (request: FastifyRequest) => string | undefined;
  /** Function to extract custom metadata from request */
  getMetadata?: (request: FastifyRequest, reply: FastifyReply) => Record<string, unknown> | undefined;
  /** Function to get the before state for change tracking */
  getBeforeState?: (request: FastifyRequest) => Promise<Record<string, unknown> | undefined>;
  /** Whether to skip logging for this request */
  shouldSkip?: (request: FastifyRequest) => boolean;
}

/**
 * Audit context attached to request for tracking state
 */
export interface AuditContext {
  /** Configured event for this route */
  eventConfig?: AuditEventConfig;
  /** State before the operation (for change tracking) */
  beforeState?: Record<string, unknown>;
  /** Timestamp when request started */
  startTime: number;
  /** Whether audit logging is enabled for this request */
  enabled: boolean;
}

/**
 * Extended request with audit context
 */
interface AuditableRequest extends FastifyRequest {
  auditContext?: AuditContext;
}

/**
 * User payload extracted from JWT token
 */
interface AuthUser {
  sub?: string;
  tenantId?: string;
  roles?: string[];
  groups?: string[];
  name?: string;
  email?: string;
  [key: string]: unknown;
}

// =============================================================================
// AUDIT MIDDLEWARE FACTORY
// =============================================================================

/**
 * Configuration options for the audit middleware
 */
export interface AuditMiddlewareOptions {
  /** Whether to log all mutations automatically (default: false) */
  autoLogMutations?: boolean;
  /** Routes to exclude from automatic logging */
  excludePaths?: string[];
  /** Custom audit service instance (for testing) */
  auditService?: AuditService;
  /** Whether to capture before/after state automatically */
  trackStateChanges?: boolean;
}

/**
 * Create audit middleware hooks for a Fastify instance
 */
export function createAuditMiddleware(options: AuditMiddlewareOptions = {}) {
  const {
    autoLogMutations = false,
    excludePaths = [],
    auditService = createAuditService(),
    trackStateChanges = true,
  } = options;

  /**
   * Pre-handler hook to initialize audit context
   */
  async function auditPreHandler(
    request: AuditableRequest,
    _reply: FastifyReply
  ): Promise<void> {
    // Initialize audit context
    request.auditContext = {
      startTime: Date.now(),
      enabled: false,
    };

    // Check if this is a mutation method
    const method = request.method.toUpperCase();
    if (!MUTATION_METHODS.includes(method as MutationMethod)) {
      return;
    }

    // Check if path is excluded
    const path = request.routeOptions?.url || request.url;
    if (excludePaths.some((p) => path.startsWith(p))) {
      return;
    }

    // Enable audit logging for this request
    request.auditContext.enabled = autoLogMutations;

    // If there's a configured event with beforeState getter, capture it
    const eventConfig = request.auditContext.eventConfig;
    if (eventConfig?.getBeforeState && trackStateChanges) {
      try {
        request.auditContext.beforeState = await eventConfig.getBeforeState(request);
      } catch (error) {
        auditLogger.warn(
          { error, path, method },
          'Failed to capture before state for audit'
        );
      }
    }
  }

  /**
   * On-response hook to record audit event
   */
  async function auditOnResponse(
    request: AuditableRequest,
    reply: FastifyReply
  ): Promise<void> {
    const auditContext = request.auditContext;
    if (!auditContext?.enabled && !auditContext?.eventConfig) {
      return;
    }

    const eventConfig = auditContext.eventConfig;
    if (!eventConfig) {
      return;
    }

    // Check if we should skip this request
    if (eventConfig.shouldSkip?.(request)) {
      return;
    }

    try {
      // Extract user information
      const user = (request as unknown as { user?: AuthUser }).user;
      const tenantId = user?.tenantId;

      if (!tenantId) {
        auditLogger.debug(
          { path: request.url },
          'Skipping audit - no tenant context'
        );
        return;
      }

      // Build actor information
      const actor: AuditActor = {
        type: 'user',
        id: user?.sub ?? 'unknown',
        name: user?.name || user?.email,
        ip: request.ip,
      };

      // Build target information
      const resourceId = eventConfig.getResourceId?.(request);
      const target: AuditTarget = {
        type: eventConfig.resourceType,
        id: resourceId ?? 'unknown',
      };

      // Build state change if we have before state
      let stateChange: AuditStateChange | undefined;
      if (auditContext.beforeState || reply.statusCode < 400) {
        const afterState = getAfterState(request, reply);
        if (auditContext.beforeState || afterState) {
          stateChange = {
            before: auditContext.beforeState,
            after: afterState,
            diff: computeDiff(auditContext.beforeState, afterState),
          };
        }
      }

      // Get custom metadata
      const metadata = eventConfig.getMetadata?.(request, reply);

      // Determine outcome based on status code
      const outcome = reply.statusCode < 400 ? 'success' : 'failure';

      // Build audit record input
      const auditInput: CreateAuditRecordInput = {
        tenantId,
        eventType: eventConfig.eventType,
        actor,
        target,
        action: eventConfig.eventType.split('.').pop() ?? 'unknown',
        outcome,
        stateChange,
        metadata: {
          ...metadata,
          method: request.method,
          path: request.url,
          statusCode: reply.statusCode,
          durationMs: Date.now() - auditContext.startTime,
          userAgent: request.headers['user-agent'],
        },
        requestId: request.id,
      };

      // Record the audit event
      await auditService.record(auditInput);

      auditLogger.debug(
        {
          eventType: eventConfig.eventType,
          resourceId: target.id,
          actorId: actor.id,
          outcome,
        },
        'Audit event recorded'
      );
    } catch (error) {
      auditLogger.error(
        { error, path: request.url, method: request.method },
        'Failed to record audit event'
      );
      // Don't throw - audit failures should not break the API
    }
  }

  return {
    auditPreHandler,
    auditOnResponse,
    auditService,
  };
}

// =============================================================================
// ROUTE DECORATOR
// =============================================================================

/**
 * Decorator to configure audit logging for a specific route handler
 *
 * @example
 * ```typescript
 * fastify.post('/policies', {
 *   preHandler: withAudit({
 *     eventType: 'policy.created',
 *     resourceType: 'policy',
 *     getResourceId: (req) => (req.body as any)?.id,
 *   }),
 * }, handler);
 * ```
 */
export function withAudit(config: AuditEventConfig) {
  return async function auditDecorator(
    request: AuditableRequest,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.auditContext) {
      request.auditContext = {
        startTime: Date.now(),
        enabled: true,
      };
    }
    request.auditContext.eventConfig = config;
    request.auditContext.enabled = true;

    // Capture before state if configured
    if (config.getBeforeState) {
      try {
        request.auditContext.beforeState = await config.getBeforeState(request);
      } catch (error) {
        auditLogger.warn(
          { error, eventType: config.eventType },
          'Failed to capture before state'
        );
      }
    }
  };
}

/**
 * Create a pre-handler that captures before state for a resource
 *
 * @example
 * ```typescript
 * fastify.put('/policies/:id', {
 *   preHandler: [
 *     captureBeforeState(async (req) => policyService.findById(req.params.id)),
 *     withAudit({ eventType: 'policy.updated', resourceType: 'policy' }),
 *   ],
 * }, handler);
 * ```
 */
export function captureBeforeState(
  getter: (request: FastifyRequest) => Promise<Record<string, unknown> | undefined>
) {
  return async function captureStateHandler(
    request: AuditableRequest,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.auditContext) {
      request.auditContext = {
        startTime: Date.now(),
        enabled: true,
      };
    }

    try {
      request.auditContext.beforeState = await getter(request);
    } catch (error) {
      auditLogger.warn({ error }, 'Failed to capture before state');
    }
  };
}

/**
 * Manually record an audit event from within a route handler
 *
 * @example
 * ```typescript
 * async function handler(request, reply) {
 *   const result = await service.create(data);
 *   await recordAuditEvent(request, {
 *     eventType: 'policy.created',
 *     resourceType: 'policy',
 *     resourceId: result.id,
 *     afterState: result,
 *   });
 *   return result;
 * }
 * ```
 */
export async function recordAuditEvent(
  request: FastifyRequest,
  event: {
    eventType: string;
    resourceType: AuditTarget['type'];
    resourceId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    reason?: string;
  },
  auditService?: AuditService
): Promise<void> {
  const service = auditService ?? createAuditService();
  const user = (request as unknown as { user?: AuthUser }).user;
  const tenantId = user?.tenantId;

  if (!tenantId) {
    auditLogger.warn('Cannot record audit event - no tenant context');
    return;
  }

  const actor: AuditActor = {
    type: 'user',
    id: user?.sub ?? 'unknown',
    name: user?.name || user?.email,
    ip: request.ip,
  };

  const target: AuditTarget = {
    type: event.resourceType,
    id: event.resourceId,
  };

  const stateChange: AuditStateChange | undefined =
    event.beforeState || event.afterState
      ? {
          before: event.beforeState,
          after: event.afterState,
          diff: computeDiff(event.beforeState, event.afterState),
        }
      : undefined;

  await service.record({
    tenantId,
    eventType: event.eventType,
    actor,
    target,
    action: event.eventType.split('.').pop() ?? 'unknown',
    outcome: 'success',
    reason: event.reason,
    stateChange,
    metadata: {
      ...event.metadata,
      method: request.method,
      path: request.url,
      userAgent: request.headers['user-agent'],
    },
    requestId: request.id,
  });
}

/**
 * Record an access denied audit event
 */
export async function recordAccessDeniedEvent(
  request: FastifyRequest,
  event: {
    requiredRoles: readonly string[];
    userRoles: string[];
    reason: string;
  },
  auditService?: AuditService
): Promise<void> {
  const service = auditService ?? createAuditService();
  const user = (request as unknown as { user?: AuthUser }).user;
  const tenantId = user?.tenantId;

  if (!tenantId) {
    // For access denied events without tenant, use a default tenant ID for logging
    auditLogger.warn(
      {
        userId: user?.sub,
        path: request.url,
        method: request.method,
      },
      'Access denied - no tenant context for audit'
    );
    return;
  }

  const actor: AuditActor = {
    type: 'user',
    id: user?.sub ?? 'unknown',
    name: user?.name || user?.email,
    ip: request.ip,
  };

  await service.record({
    tenantId,
    eventType: 'access.denied',
    actor,
    target: {
      type: 'system',
      id: request.url,
    },
    action: 'access',
    outcome: 'failure',
    reason: event.reason,
    metadata: {
      method: request.method,
      path: request.url,
      requiredRoles: event.requiredRoles,
      userRoles: event.userRoles,
      userAgent: request.headers['user-agent'],
    },
    requestId: request.id,
  });
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

/**
 * Fastify plugin for automatic audit logging
 */
export const auditMiddlewarePlugin = fp(
  async function auditPlugin(
    fastify: FastifyInstance,
    options: AuditMiddlewareOptions
  ) {
    const { auditPreHandler, auditOnResponse, auditService } = createAuditMiddleware(options);

    // Add audit context to request decorator
    fastify.decorateRequest('auditContext', null);

    // Add audit service to fastify instance
    fastify.decorate('auditService', auditService);

    // Register hooks
    fastify.addHook('preHandler', auditPreHandler);
    fastify.addHook('onResponse', auditOnResponse);

    auditLogger.info('Audit middleware plugin registered');
  },
  {
    name: 'audit-middleware',
    fastify: '>=4.x',
  }
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract response body from request/reply for after state
 */
function getAfterState(
  request: FastifyRequest,
  _reply: FastifyReply
): Record<string, unknown> | undefined {
  // The response body is not directly accessible after send
  // We need to capture it via the serialization hook or from request context
  // For now, return undefined - routes should use recordAuditEvent for full state tracking
  return undefined;
}

/**
 * Compute a simple diff between before and after states
 */
function computeDiff(
  before?: Record<string, unknown>,
  after?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!before && !after) {
    return undefined;
  }

  if (!before) {
    return { _type: 'created', values: after };
  }

  if (!after) {
    return { _type: 'deleted', values: before };
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    const beforeVal = before[key];
    const afterVal = after[key];

    // Skip internal fields
    if (key.startsWith('_') || key === 'updatedAt' || key === 'createdAt') {
      continue;
    }

    // Compare values (simple comparison, not deep)
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diff[key] = { from: beforeVal, to: afterVal };
    }
  }

  if (Object.keys(diff).length === 0) {
    return undefined;
  }

  return { _type: 'modified', changes: diff };
}

// =============================================================================
// TYPE AUGMENTATION
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    auditContext?: AuditContext;
  }

  interface FastifyInstance {
    auditService: AuditService;
  }
}
