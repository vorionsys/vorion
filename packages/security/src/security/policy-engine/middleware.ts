/**
 * Fastify Middleware for Security Policy Engine
 *
 * Provides middleware for enforcing security policies in Fastify applications.
 * Supports policy bypass (break-glass), decision injection, and management API.
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
} from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { SecurityPolicyEngine, type SecurityPolicyEngineOptions } from './engine.js';
import type {
  PolicyContext,
  PolicyDecision,
  SecurityPolicy,
  PolicyContextUser,
  PolicyContextResource,
  PolicyContextRisk,
} from './types.js';

const logger = createLogger({ component: 'policy-middleware' });

/**
 * Policy middleware options
 */
export interface PolicyMiddlewareOptions {
  /** Security policy engine options */
  engineOptions?: SecurityPolicyEngineOptions;
  /** Existing engine instance (if not creating new) */
  engine?: SecurityPolicyEngine;
  /** Paths to skip policy enforcement */
  skipPaths?: string[];
  /** Paths to skip (regex patterns) */
  skipPathPatterns?: RegExp[];
  /** Enable break-glass support */
  enableBreakGlass?: boolean;
  /** Break-glass header name */
  breakGlassHeader?: string;
  /** User context extractor */
  extractUser?: (request: FastifyRequest) => PolicyContextUser | undefined;
  /** Resource context extractor */
  extractResource?: (request: FastifyRequest) => PolicyContextResource | undefined;
  /** Risk context extractor */
  extractRisk?: (request: FastifyRequest) => PolicyContextRisk | undefined;
  /** Custom context extractor */
  extractCustom?: (request: FastifyRequest) => Record<string, unknown> | undefined;
  /** Whether to block on policy errors */
  blockOnError?: boolean;
  /** Enable management API */
  enableManagementApi?: boolean;
  /** Management API prefix */
  managementApiPrefix?: string;
  /** Management API authentication */
  managementApiAuth?: (request: FastifyRequest) => Promise<boolean>;
}

/**
 * Extended FastifyRequest with policy decision
 */
declare module 'fastify' {
  interface FastifyRequest {
    policyDecision?: PolicyDecision;
    policyContext?: PolicyContext;
  }
}

/**
 * Default user extractor
 */
function defaultUserExtractor(request: FastifyRequest): PolicyContextUser | undefined {
  const user = (request as FastifyRequest & { user?: Record<string, unknown> }).user;
  if (!user) return undefined;

  return {
    id: (user.id ?? user.sub ?? user.userId) as string,
    email: user.email as string | undefined,
    role: user.role as string | undefined,
    roles: user.roles as string[] | undefined,
    department: user.department as string | undefined,
    tenant: (user.tenant ?? user.tenantId) as string | undefined,
    groups: user.groups as string[] | undefined,
    permissions: user.permissions as string[] | undefined,
    attributes: user,
    riskScore: user.riskScore as number | undefined,
    mfaVerified: user.mfaVerified as boolean | undefined,
    lastMfaAt: user.lastMfaAt as string | undefined,
    sessionStartedAt: user.sessionStartedAt as string | undefined,
  };
}

/**
 * Build policy context from request
 */
function buildPolicyContext(
  request: FastifyRequest,
  options: PolicyMiddlewareOptions
): PolicyContext {
  const now = new Date();

  const context: PolicyContext = {
    user: options.extractUser?.(request) ?? defaultUserExtractor(request),
    request: {
      id: request.id ?? randomUUID(),
      method: request.method,
      path: request.url.split('?')[0]!,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
      referer: request.headers.referer,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[]>,
      body: request.body,
      contentType: request.headers['content-type'],
    },
    resource: options.extractResource?.(request),
    risk: options.extractRisk?.(request),
    environment: {
      timestamp: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
    },
    custom: options.extractCustom?.(request),
  };

  // Add break-glass token if provided
  if (options.enableBreakGlass) {
    const headerName = options.breakGlassHeader ?? 'x-break-glass-token';
    const token = request.headers[headerName];
    if (typeof token === 'string') {
      context.breakGlassToken = token;
    }
  }

  return context;
}

/**
 * Handle policy decision
 */
async function handleDecision(
  decision: PolicyDecision,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  // Attach decision to request
  request.policyDecision = decision;

  // Add decision headers
  reply.header('X-Policy-Decision', decision.outcome);
  reply.header('X-Policy-Decision-Id', decision.id);

  switch (decision.outcome) {
    case 'allow':
      return true;

    case 'deny': {
      const denyAction = decision.actions.find(a => a.type === 'deny');
      const httpStatus = (denyAction as { httpStatus?: number } | undefined)?.httpStatus ?? 403;
      const errorCode = (denyAction as { errorCode?: string } | undefined)?.errorCode ?? 'POLICY_DENIED';
      const retryAfter = (denyAction as { retryAfter?: number } | undefined)?.retryAfter;

      if (retryAfter) {
        reply.header('Retry-After', retryAfter.toString());
      }

      await reply.status(httpStatus).send({
        error: errorCode,
        message: decision.reason,
        decisionId: decision.id,
        retryable: (denyAction as { retryable?: boolean } | undefined)?.retryable ?? false,
      });
      return false;
    }

    case 'challenge': {
      const challengeAction = decision.actions.find(a => a.type === 'challenge');
      const method = (challengeAction as { method?: string } | undefined)?.method ?? 'mfa';
      const redirectUrl = (challengeAction as { redirectUrl?: string } | undefined)?.redirectUrl;

      if (redirectUrl) {
        await reply.redirect(redirectUrl, 302);
        return false;
      }

      await reply.status(401).send({
        error: 'CHALLENGE_REQUIRED',
        message: decision.reason,
        decisionId: decision.id,
        challengeMethod: method,
        challengeTimeout: (challengeAction as { timeout?: number } | undefined)?.timeout,
      });
      return false;
    }

    case 'pending':
      await reply.status(202).send({
        error: 'APPROVAL_PENDING',
        message: decision.reason,
        decisionId: decision.id,
      });
      return false;

    default:
      return true;
  }
}

/**
 * Create policy enforcement middleware
 */
export function createPolicyMiddleware(
  engine: SecurityPolicyEngine,
  options: PolicyMiddlewareOptions = {}
) {
  const skipPaths = new Set(options.skipPaths ?? ['/health', '/ready', '/metrics']);
  const skipPatterns = options.skipPathPatterns ?? [];
  const blockOnError = options.blockOnError ?? false;

  return async function policyMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const path = request.url.split('?')[0]!;

    // Skip configured paths
    if (skipPaths.has(path)) {
      return;
    }

    // Skip pattern matches
    if (skipPatterns.some(p => p.test(path))) {
      return;
    }

    try {
      // Build context
      const context = buildPolicyContext(request, options);
      request.policyContext = context;

      // Evaluate policies
      const decision = await engine.evaluateWithTracing(context);

      // Handle decision
      const allowed = await handleDecision(decision, request, reply);

      if (!allowed) {
        // Reply already sent
        return;
      }

      // Execute additional actions (logging, notifications, etc.)
      for (const action of decision.actions) {
        switch (action.type) {
          case 'log': {
            const logData = {
              message: action.message,
              requestId: context.request.id,
              userId: context.user?.id,
              decisionId: decision.id,
              tags: action.tags,
            };
            switch (action.level) {
              case 'debug':
                logger.debug(logData, 'Policy action log');
                break;
              case 'info':
                logger.info(logData, 'Policy action log');
                break;
              case 'warn':
                logger.warn(logData, 'Policy action log');
                break;
              case 'error':
                logger.error(logData, 'Policy action log');
                break;
            }
            break;
          }

          case 'modify':
            // Add headers
            if (action.addHeaders) {
              for (const [name, value] of Object.entries(action.addHeaders)) {
                reply.header(name, value);
              }
            }
            break;

          // Notify and escalate actions would be handled asynchronously
          // by a separate action processor
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message, path }, 'Policy evaluation failed');

      if (blockOnError) {
        await reply.status(500).send({
          error: 'POLICY_ERROR',
          message: 'Security policy evaluation failed',
        });
        return;
      }

      // Fail open - allow request but log the failure
    }
  };
}

/**
 * Policy engine Fastify plugin
 */
const policyEnginePlugin: FastifyPluginCallback<PolicyMiddlewareOptions> = (
  fastify,
  options,
  done
) => {
  // Create or use provided engine
  const engine = options.engine ?? new SecurityPolicyEngine(options.engineOptions);

  // Create middleware
  const middleware = createPolicyMiddleware(engine, options);

  // Register preHandler hook
  fastify.addHook('preHandler', middleware);

  // Decorate fastify with engine
  fastify.decorate('policyEngine', engine);

  // Register management API if enabled
  if (options.enableManagementApi) {
    registerManagementApi(fastify, engine, options);
  }

  done();
};

/**
 * Register management API routes
 */
function registerManagementApi(
  fastify: FastifyInstance,
  engine: SecurityPolicyEngine,
  options: PolicyMiddlewareOptions
): void {
  const prefix = options.managementApiPrefix ?? '/api/security/policies';
  const authCheck = options.managementApiAuth ?? (async () => true);

  // Auth middleware for management API
  const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
    const authorized = await authCheck(request);
    if (!authorized) {
      await reply.status(403).send({ error: 'UNAUTHORIZED', message: 'Not authorized to manage policies' });
    }
  };

  // List policies
  fastify.get(prefix, { preHandler: authMiddleware }, async (_request, _reply) => {
    const policies = engine.getAllPolicies();
    return {
      policies,
      total: policies.length,
      enabled: policies.filter(p => p.enabled).length,
    };
  });

  // Get policy by ID
  fastify.get<{ Params: { id: string } }>(`${prefix}/:id`, { preHandler: authMiddleware }, async (request, reply) => {
    const policy = engine.getPolicy(request.params.id);
    if (!policy) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy not found' });
    }
    return policy;
  });

  // Create policy
  fastify.post<{ Body: SecurityPolicy }>(prefix, { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const policy = request.body;
      engine.addPolicy(policy);
      return reply.status(201).send(policy);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(400).send({ error: 'INVALID_POLICY', message });
    }
  });

  // Update policy
  fastify.put<{ Params: { id: string }; Body: Partial<SecurityPolicy> }>(
    `${prefix}/:id`,
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        const updated = engine.updatePolicy(request.params.id, request.body);
        return updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('not found')) {
          return reply.status(404).send({ error: 'NOT_FOUND', message });
        }
        return reply.status(400).send({ error: 'UPDATE_FAILED', message });
      }
    }
  );

  // Delete policy
  fastify.delete<{ Params: { id: string } }>(`${prefix}/:id`, { preHandler: authMiddleware }, async (request, reply) => {
    const removed = engine.removePolicy(request.params.id);
    if (!removed) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy not found' });
    }
    return { success: true };
  });

  // Enable policy
  fastify.post<{ Params: { id: string } }>(`${prefix}/:id/enable`, { preHandler: authMiddleware }, async (request, reply) => {
    const success = engine.enablePolicy(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy not found' });
    }
    return { success: true };
  });

  // Disable policy
  fastify.post<{ Params: { id: string } }>(`${prefix}/:id/disable`, { preHandler: authMiddleware }, async (request, reply) => {
    const success = engine.disablePolicy(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy not found' });
    }
    return { success: true };
  });

  // Validate policy
  fastify.post<{ Body: unknown }>(`${prefix}/validate`, { preHandler: authMiddleware }, async (request, _reply) => {
    const result = engine.validatePolicy(request.body);
    return result;
  });

  // Simulate policy evaluation
  fastify.post<{ Body: { context: PolicyContext; policies?: string[]; verbose?: boolean } }>(
    `${prefix}/simulate`,
    { preHandler: authMiddleware },
    async (request, _reply) => {
      const result = await engine.simulate({
        context: request.body.context,
        policies: request.body.policies,
        verbose: request.body.verbose,
      });
      return result;
    }
  );

  // Get policy versions
  fastify.get<{ Params: { id: string } }>(`${prefix}/:id/versions`, { preHandler: authMiddleware }, async (request, reply) => {
    const versions = engine.getPolicyVersions(request.params.id);
    if (versions.length === 0) {
      const policy = engine.getPolicy(request.params.id);
      if (!policy) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy not found' });
      }
    }
    return { versions };
  });

  // Rollback policy
  fastify.post<{ Params: { id: string; versionId: string } }>(
    `${prefix}/:id/rollback/:versionId`,
    { preHandler: authMiddleware },
    async (request, reply) => {
      const policy = engine.rollbackPolicy(request.params.id, request.params.versionId);
      if (!policy) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Policy or version not found' });
      }
      return policy;
    }
  );

  // Get engine stats
  fastify.get(`${prefix}/stats`, { preHandler: authMiddleware }, async (_request, _reply) => {
    return engine.getStats();
  });

  logger.info({ prefix }, 'Policy management API registered');
}

/**
 * Export plugin with fastify-plugin wrapper
 */
export const policyEnginePluginFp = fp(policyEnginePlugin, {
  fastify: '>=4.x',
  name: 'vorion-policy-engine',
});

/**
 * Enforce policies middleware factory
 *
 * Creates a middleware that evaluates and enforces security policies.
 * Can be used standalone or with the full plugin.
 */
export function enforcePolicies(options: PolicyMiddlewareOptions = {}) {
  const engine = options.engine ?? new SecurityPolicyEngine(options.engineOptions);

  return {
    middleware: createPolicyMiddleware(engine, options),
    engine,
  };
}

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    policyEngine?: SecurityPolicyEngine;
  }
}
