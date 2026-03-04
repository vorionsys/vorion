/**
 * API Key Enforcement Middleware
 *
 * Fastify plugin that integrates API key authentication with the existing
 * JWT-based auth flow. Provides configurable route-level authentication
 * strategies and enforces rate limiting from API keys.
 *
 * Authentication Strategies:
 * - JWT only: Traditional token-based auth (default for browser clients)
 * - API key only: Machine-to-machine communication
 * - JWT OR API key: Routes that accept either method
 * - API key with specific scopes: Scope-restricted API key access
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from 'fastify';
import type {} from '@fastify/jwt';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  apiKeyMiddleware,
  requireScopes,
  getApiKey,
  hasApiKey,
  getApiKeyTenantId,
  type ApiKeyMiddlewareOptions,
} from '../../security/api-keys/middleware.js';
import {
  type ApiKeyScope,
  type ApiKeyContext,
} from '../../security/api-keys/types.js';
import {
  getApiKeyService,
  createApiKeyService,
  type ApiKeyService,
} from '../../security/api-keys/service.js';

const logger = createLogger({ component: 'api-key-enforcement' });

// =============================================================================
// METRICS
// =============================================================================

const authAttempts = new Counter({
  name: 'vorion_auth_attempts_total',
  help: 'Total authentication attempts by method',
  labelNames: ['method', 'result'] as const,
  registers: [vorionRegistry],
});

const authDuration = new Histogram({
  name: 'vorion_auth_duration_seconds',
  help: 'Duration of authentication checks',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  labelNames: ['method'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * Authentication method
 */
export type AuthMethod = 'jwt' | 'api_key' | 'jwt_or_api_key' | 'none';

/**
 * Route authentication configuration
 */
export interface RouteAuthConfig {
  /** Authentication method for this route */
  method: AuthMethod;
  /** Required API key scopes (only for api_key or jwt_or_api_key) */
  requiredScopes?: ApiKeyScope[];
  /** Require all scopes (AND) or any scope (OR). Default: true (AND) */
  requireAllScopes?: boolean;
  /** Custom skip condition */
  skip?: (request: FastifyRequest) => boolean;
}

/**
 * Route pattern with auth configuration
 */
export interface RoutePattern {
  /** HTTP method (GET, POST, etc.) or '*' for all methods */
  method: string | '*';
  /** URL pattern (exact match or with wildcards) */
  pattern: string;
  /** Auth configuration */
  auth: RouteAuthConfig;
}

/**
 * API Key Enforcement Plugin Options
 */
export interface ApiKeyEnforcementOptions {
  /** API key service instance */
  apiKeyService?: ApiKeyService;
  /** Default authentication method for unspecified routes */
  defaultAuth?: AuthMethod;
  /** Default required scopes for API key auth */
  defaultScopes?: ApiKeyScope[];
  /** Route-specific auth configurations */
  routeConfigs?: RoutePattern[];
  /** Paths to skip all auth (e.g., /health, /ready) */
  skipPaths?: string[];
  /** Enforce API key rate limits */
  enforceRateLimit?: boolean;
  /** Log authentication decisions */
  logAuthDecisions?: boolean;
}

/**
 * Extended request with auth context
 */
declare module 'fastify' {
  interface FastifyRequest {
    /** Unified auth context (JWT or API key) */
    authMethod?: 'jwt' | 'api_key' | 'none';
    /** Tenant ID from auth (JWT or API key) */
    authTenantId?: string;
    /** User/key ID from auth */
    authSubject?: string;
  }
}

// =============================================================================
// ROUTE MATCHING
// =============================================================================

/**
 * Match a URL pattern against a request URL
 *
 * Supports:
 * - Exact matches: /api/v1/intents
 * - Wildcards: /api/v1/intents/*
 * - Path parameters: /api/v1/intents/:id
 */
function matchPattern(pattern: string, url: string): boolean {
  // Remove query string from URL
  const urlPath = url.split('?')[0] ?? url;

  // Exact match
  if (pattern === urlPath) {
    return true;
  }

  // Wildcard match
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return urlPath.startsWith(prefix);
  }

  // Path parameter match (convert :param to regex)
  const regexPattern = pattern.replace(/:[^/]+/g, '[^/]+');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(urlPath);
}

/**
 * Find matching route config for a request
 */
function findRouteConfig(
  request: FastifyRequest,
  configs: RoutePattern[]
): RouteAuthConfig | null {
  const method = request.method.toUpperCase();
  const url = request.url;

  for (const config of configs) {
    // Check method match
    if (config.method !== '*' && config.method.toUpperCase() !== method) {
      continue;
    }

    // Check pattern match
    if (matchPattern(config.pattern, url)) {
      return config.auth;
    }
  }

  return null;
}

// =============================================================================
// AUTH HANDLERS
// =============================================================================

/**
 * Check if request has valid JWT
 */
async function hasValidJwt(request: FastifyRequest): Promise<boolean> {
  try {
    await request.jwtVerify();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get tenant ID from JWT
 */
async function getJwtTenantId(request: FastifyRequest): Promise<string | null> {
  try {
    const payload = await request.jwtVerify<{ tenantId?: string }>();
    return payload.tenantId ?? null;
  } catch {
    return null;
  }
}

/**
 * Get subject (user ID) from JWT
 */
async function getJwtSubject(request: FastifyRequest): Promise<string | null> {
  try {
    const payload = await request.jwtVerify<{ sub?: string }>();
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Async hook handler type (2 args, returns Promise)
 * This matches the actual implementation of apiKeyMiddleware which is async
 */
type AsyncHookHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Validate API key and attach context
 */
async function validateApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  service: ApiKeyService,
  enforceRateLimit: boolean
): Promise<boolean> {
  // Note: apiKeyMiddleware returns an async function with 2 args, despite the type
  // declaration saying preHandlerHookHandler (which has 3 args with done callback)
  const middleware = apiKeyMiddleware({
    service,
    enforceRateLimit,
  }) as unknown as AsyncHookHandler;

  try {
    await middleware(request, reply);
    // If middleware didn't send a response, API key is valid
    return hasApiKey(request);
  } catch {
    return false;
  }
}

/**
 * Check API key scopes
 */
function checkScopes(
  request: FastifyRequest,
  requiredScopes: ApiKeyScope[],
  requireAll: boolean
): boolean {
  const context = request.apiKeyContext;
  if (!context) {
    return false;
  }

  const apiKey = context.apiKey;

  if (requireAll) {
    return requiredScopes.every((scope) => apiKey.scopes.includes(scope));
  } else {
    return requiredScopes.some((scope) => apiKey.scopes.includes(scope));
  }
}

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * Send 401 Unauthorized response
 */
function sendUnauthorized(
  reply: FastifyReply,
  code: string,
  message: string,
  hint?: string
): void {
  reply.status(401).send({
    error: {
      code,
      message,
      ...(hint && { hint }),
    },
  });
}

/**
 * Send 403 Forbidden response
 */
function sendForbidden(
  reply: FastifyReply,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  reply.status(403).send({
    error: {
      code,
      message,
      ...details,
    },
  });
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Create enforcement middleware for a specific auth configuration
 */
function createEnforcementMiddleware(
  authConfig: RouteAuthConfig,
  service: ApiKeyService,
  enforceRateLimit: boolean,
  logDecisions: boolean
): AsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    const requestId = request.id;

    // Check skip condition
    if (authConfig.skip?.(request)) {
      request.authMethod = 'none';
      return;
    }

    try {
      switch (authConfig.method) {
        case 'none':
          request.authMethod = 'none';
          authAttempts.inc({ method: 'none', result: 'skipped' });
          return;

        case 'jwt': {
          const hasJwt = await hasValidJwt(request);
          if (!hasJwt) {
            authAttempts.inc({ method: 'jwt', result: 'failed' });
            sendUnauthorized(
              reply,
              'JWT_REQUIRED',
              'Valid JWT token is required',
              'Provide a valid JWT token in the Authorization header'
            );
            return;
          }

          request.authMethod = 'jwt';
          request.authTenantId = await getJwtTenantId(request) ?? undefined;
          request.authSubject = await getJwtSubject(request) ?? undefined;
          authAttempts.inc({ method: 'jwt', result: 'success' });

          if (logDecisions) {
            logger.debug(
              { requestId, method: 'jwt', tenantId: request.authTenantId },
              'JWT authentication successful'
            );
          }
          return;
        }

        case 'api_key': {
          const isValid = await validateApiKey(request, reply, service, enforceRateLimit);

          // If reply was already sent (error), return
          if (reply.sent) {
            authAttempts.inc({ method: 'api_key', result: 'failed' });
            return;
          }

          if (!isValid) {
            authAttempts.inc({ method: 'api_key', result: 'failed' });
            sendUnauthorized(
              reply,
              'API_KEY_REQUIRED',
              'Valid API key is required',
              'Provide API key via X-API-Key header or Authorization: Bearer vak_... header'
            );
            return;
          }

          // Check scopes if required
          if (authConfig.requiredScopes && authConfig.requiredScopes.length > 0) {
            const hasScopes = checkScopes(
              request,
              authConfig.requiredScopes,
              authConfig.requireAllScopes ?? true
            );

            if (!hasScopes) {
              authAttempts.inc({ method: 'api_key', result: 'insufficient_scope' });
              sendForbidden(reply, 'INSUFFICIENT_SCOPE', 'API key does not have required scopes', {
                requiredScopes: authConfig.requiredScopes,
                requireAll: authConfig.requireAllScopes ?? true,
              });
              return;
            }
          }

          const apiKey = getApiKey(request);
          request.authMethod = 'api_key';
          request.authTenantId = getApiKeyTenantId(request);
          request.authSubject = apiKey?.id;
          authAttempts.inc({ method: 'api_key', result: 'success' });

          if (logDecisions) {
            logger.debug(
              {
                requestId,
                method: 'api_key',
                tenantId: request.authTenantId,
                keyPrefix: apiKey?.prefix,
              },
              'API key authentication successful'
            );
          }
          return;
        }

        case 'jwt_or_api_key': {
          // Try JWT first
          const hasJwt = await hasValidJwt(request);
          if (hasJwt) {
            request.authMethod = 'jwt';
            request.authTenantId = await getJwtTenantId(request) ?? undefined;
            request.authSubject = await getJwtSubject(request) ?? undefined;
            authAttempts.inc({ method: 'jwt_or_api_key', result: 'jwt_success' });

            if (logDecisions) {
              logger.debug(
                { requestId, method: 'jwt', tenantId: request.authTenantId },
                'JWT authentication successful (jwt_or_api_key)'
              );
            }
            return;
          }

          // Try API key
          const isApiKeyValid = await validateApiKey(request, reply, service, enforceRateLimit);

          // If reply was already sent (error from rate limit, etc.), return
          if (reply.sent) {
            authAttempts.inc({ method: 'jwt_or_api_key', result: 'api_key_error' });
            return;
          }

          if (!isApiKeyValid) {
            authAttempts.inc({ method: 'jwt_or_api_key', result: 'failed' });
            sendUnauthorized(
              reply,
              'AUTH_REQUIRED',
              'Authentication required',
              'Provide either a valid JWT token or API key'
            );
            return;
          }

          // Check scopes if required
          if (authConfig.requiredScopes && authConfig.requiredScopes.length > 0) {
            const hasScopes = checkScopes(
              request,
              authConfig.requiredScopes,
              authConfig.requireAllScopes ?? true
            );

            if (!hasScopes) {
              authAttempts.inc({ method: 'jwt_or_api_key', result: 'insufficient_scope' });
              sendForbidden(reply, 'INSUFFICIENT_SCOPE', 'API key does not have required scopes', {
                requiredScopes: authConfig.requiredScopes,
                requireAll: authConfig.requireAllScopes ?? true,
              });
              return;
            }
          }

          const apiKey = getApiKey(request);
          request.authMethod = 'api_key';
          request.authTenantId = getApiKeyTenantId(request);
          request.authSubject = apiKey?.id;
          authAttempts.inc({ method: 'jwt_or_api_key', result: 'api_key_success' });

          if (logDecisions) {
            logger.debug(
              {
                requestId,
                method: 'api_key',
                tenantId: request.authTenantId,
                keyPrefix: apiKey?.prefix,
              },
              'API key authentication successful (jwt_or_api_key)'
            );
          }
          return;
        }

        default:
          logger.error({ method: authConfig.method }, 'Unknown auth method');
          sendUnauthorized(reply, 'AUTH_CONFIG_ERROR', 'Invalid authentication configuration');
      }
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      authDuration.observe({ method: authConfig.method }, duration);
    }
  };
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

/**
 * Default route configurations for common patterns
 *
 * AUTH STRATEGY PER ROUTE:
 *
 * Public routes (no auth):
 * - /health, /ready, /metrics - Health checks
 * - /api/v1/docs/* - API documentation
 *
 * JWT only routes (browser/user sessions):
 * - /api/v1/auth/* - Authentication endpoints
 * - /api/v1/sessions/* - Session management
 * - /api/v1/mfa/* - MFA operations
 *
 * JWT or API key routes (most API operations):
 * - /api/v1/intents/* - Intent operations (read scope for GET, write for others)
 * - /api/v1/escalations/* - Escalation operations
 * - /api/v1/policies/* - Policy operations (read for GET, write for mutations)
 * - /api/v1/audit/* - Audit log access (read scope)
 * - /api/v1/proofs/* - Proof operations
 * - /api/v1/trust/* - Trust operations
 * - /api/v1/constraints/* - Constraint validation
 *
 * API key with specific scopes:
 * - /api/v1/webhooks/* - Webhook operations (webhook scope)
 * - /api/v1/admin/* - Admin operations (admin scope)
 * - /api/v1/gdpr/* - GDPR operations (admin scope)
 */
const DEFAULT_ROUTE_CONFIGS: RoutePattern[] = [
  // Public routes - no auth required
  { method: '*', pattern: '/health', auth: { method: 'none' } },
  { method: '*', pattern: '/ready', auth: { method: 'none' } },
  { method: '*', pattern: '/metrics', auth: { method: 'none' } },
  { method: '*', pattern: '/scheduler', auth: { method: 'none' } },
  { method: '*', pattern: '/api/v1/docs', auth: { method: 'none' } },
  { method: '*', pattern: '/api/v1/docs/*', auth: { method: 'none' } },
  { method: '*', pattern: '/api/v1/health', auth: { method: 'none' } },
  { method: '*', pattern: '/api/v1/health/*', auth: { method: 'none' } },

  // JWT only routes - user session required
  { method: '*', pattern: '/api/v1/auth/*', auth: { method: 'jwt' } },
  { method: '*', pattern: '/api/v1/sessions/*', auth: { method: 'jwt' } },
  { method: '*', pattern: '/api/v1/mfa/*', auth: { method: 'jwt' } },
  { method: '*', pattern: '/api/v1/security-dashboard/*', auth: { method: 'jwt' } },

  // Intent routes - JWT or API key with scope requirements
  {
    method: 'GET',
    pattern: '/api/v1/intents',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'GET',
    pattern: '/api/v1/intents/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'POST',
    pattern: '/api/v1/intents',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },
  {
    method: 'POST',
    pattern: '/api/v1/intents/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/intents/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },

  // Escalation routes
  {
    method: 'GET',
    pattern: '/api/v1/escalations',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'GET',
    pattern: '/api/v1/escalations/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'POST',
    pattern: '/api/v1/escalations/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },

  // Policy routes
  {
    method: 'GET',
    pattern: '/api/v1/policies',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'GET',
    pattern: '/api/v1/policies/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'POST',
    pattern: '/api/v1/policies',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },
  {
    method: 'PUT',
    pattern: '/api/v1/policies/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/policies/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/policies/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['write'] },
  },

  // Audit routes - read only
  {
    method: 'GET',
    pattern: '/api/v1/audit',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'GET',
    pattern: '/api/v1/audit/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: 'POST',
    pattern: '/api/v1/audit/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },

  // Proof and trust routes
  {
    method: '*',
    pattern: '/api/v1/proofs/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: '*',
    pattern: '/api/v1/trust/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },
  {
    method: '*',
    pattern: '/api/v1/constraints/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['read'] },
  },

  // Webhook routes - require webhook scope
  {
    method: 'GET',
    pattern: '/api/v1/webhooks',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['webhook'], requireAllScopes: false },
  },
  {
    method: 'GET',
    pattern: '/api/v1/webhooks/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['webhook'], requireAllScopes: false },
  },
  {
    method: 'POST',
    pattern: '/api/v1/webhooks',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['webhook'], requireAllScopes: false },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/webhooks/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['webhook'], requireAllScopes: false },
  },

  // Admin routes - require admin scope
  {
    method: '*',
    pattern: '/api/v1/admin/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['admin'] },
  },

  // GDPR routes - require admin scope
  {
    method: '*',
    pattern: '/api/v1/gdpr/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['admin'] },
  },

  // Extension routes - integration scope
  {
    method: '*',
    pattern: '/api/v1/extensions/*',
    auth: { method: 'jwt_or_api_key', requiredScopes: ['integration'], requireAllScopes: false },
  },
];

/**
 * API Key Enforcement Plugin
 *
 * Registers API key authentication alongside existing JWT auth.
 *
 * @example
 * ```typescript
 * await fastify.register(apiKeyEnforcementPlugin, {
 *   defaultAuth: 'jwt_or_api_key',
 *   enforceRateLimit: true,
 *   routeConfigs: [
 *     { method: 'POST', pattern: '/api/v1/webhooks', auth: { method: 'api_key', requiredScopes: ['webhook'] } },
 *   ],
 * });
 * ```
 */
export const apiKeyEnforcementPlugin = fp(
  async (fastify: FastifyInstance, options: ApiKeyEnforcementOptions) => {
    const service = options.apiKeyService ?? createApiKeyService();
    const defaultAuth = options.defaultAuth ?? 'jwt';
    const defaultScopes = options.defaultScopes ?? [];
    const routeConfigs = [...DEFAULT_ROUTE_CONFIGS, ...(options.routeConfigs ?? [])];
    const skipPaths = new Set(options.skipPaths ?? ['/health', '/ready', '/metrics']);
    const enforceRateLimit = options.enforceRateLimit ?? true;
    const logDecisions = options.logAuthDecisions ?? false;

    // Decorate fastify with the API key service
    if (!fastify.hasDecorator('apiKeyService')) {
      fastify.decorate('apiKeyService', service);
    }

    // Decorate request with auth context
    fastify.decorateRequest('authMethod', undefined);
    fastify.decorateRequest('authTenantId', undefined);
    fastify.decorateRequest('authSubject', undefined);

    // Add preHandler hook for auth enforcement
    fastify.addHook('preHandler', async (request, reply) => {
      // Skip for explicitly excluded paths
      if (skipPaths.has(request.url) || skipPaths.has(request.routeOptions.url ?? '')) {
        request.authMethod = 'none';
        return;
      }

      // Find matching route config
      const routeConfig = findRouteConfig(request, routeConfigs);

      // Use route-specific config or default
      const authConfig: RouteAuthConfig = routeConfig ?? {
        method: defaultAuth,
        requiredScopes: defaultScopes.length > 0 ? defaultScopes : undefined,
      };

      // Create and execute enforcement middleware
      const enforcer = createEnforcementMiddleware(
        authConfig,
        service,
        enforceRateLimit,
        logDecisions
      );

      await enforcer(request, reply);
    });

    logger.info(
      {
        defaultAuth,
        routeConfigCount: routeConfigs.length,
        skipPaths: Array.from(skipPaths),
        enforceRateLimit,
      },
      'API key enforcement plugin registered'
    );
  },
  {
    name: 'vorion-api-key-enforcement',
    fastify: '>=4.x',
    dependencies: ['@fastify/jwt'],
  }
);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a route-specific auth config
 */
export function createRouteAuth(
  method: AuthMethod,
  options?: {
    requiredScopes?: ApiKeyScope[];
    requireAllScopes?: boolean;
    skip?: (request: FastifyRequest) => boolean;
  }
): RouteAuthConfig {
  return {
    method,
    ...options,
  };
}

/**
 * Create a preHandler hook for specific auth requirements
 *
 * Use this for per-route auth configuration when registered at the route level.
 *
 * @example
 * ```typescript
 * fastify.post('/api/v1/sensitive', {
 *   preHandler: requireApiKeyAuth(['admin']),
 * }, handler);
 * ```
 */
export function requireApiKeyAuth(
  requiredScopes?: ApiKeyScope[],
  options?: { requireAll?: boolean }
): AsyncHookHandler {
  const service = getApiKeyService();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const middleware = apiKeyMiddleware({
      service,
      enforceRateLimit: true,
    }) as unknown as AsyncHookHandler;

    await middleware(request, reply);

    if (reply.sent) {
      return;
    }

    if (!hasApiKey(request)) {
      sendUnauthorized(
        reply,
        'API_KEY_REQUIRED',
        'Valid API key is required for this endpoint',
        'Provide API key via X-API-Key header or Authorization: Bearer vak_... header'
      );
      return;
    }

    if (requiredScopes && requiredScopes.length > 0) {
      const hasScopes = checkScopes(request, requiredScopes, options?.requireAll ?? true);
      if (!hasScopes) {
        sendForbidden(reply, 'INSUFFICIENT_SCOPE', 'API key does not have required scopes', {
          requiredScopes,
          requireAll: options?.requireAll ?? true,
        });
      }
    }
  };
}

/**
 * Create a preHandler that accepts either JWT or API key
 */
export function requireJwtOrApiKey(
  apiKeyScopes?: ApiKeyScope[]
): AsyncHookHandler {
  const service = getApiKeyService();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Try JWT first
    try {
      await request.jwtVerify();
      request.authMethod = 'jwt';
      return;
    } catch {
      // JWT failed, try API key
    }

    // Try API key
    const middleware = apiKeyMiddleware({
      service,
      enforceRateLimit: true,
    }) as unknown as AsyncHookHandler;

    await middleware(request, reply);

    if (reply.sent) {
      return;
    }

    if (!hasApiKey(request)) {
      sendUnauthorized(
        reply,
        'AUTH_REQUIRED',
        'Authentication required',
        'Provide either a valid JWT token or API key'
      );
      return;
    }

    if (apiKeyScopes && apiKeyScopes.length > 0) {
      const hasScopes = checkScopes(request, apiKeyScopes, true);
      if (!hasScopes) {
        sendForbidden(reply, 'INSUFFICIENT_SCOPE', 'API key does not have required scopes', {
          requiredScopes: apiKeyScopes,
        });
        return;
      }
    }

    request.authMethod = 'api_key';
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  // Re-export from middleware for convenience
  apiKeyMiddleware,
  requireScopes,
  getApiKey,
  hasApiKey,
  getApiKeyTenantId,
};

export default apiKeyEnforcementPlugin;
