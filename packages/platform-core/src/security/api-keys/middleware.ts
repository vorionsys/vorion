/**
 * API Key Middleware for Fastify
 *
 * Provides Fastify middleware for API key authentication:
 * - Extract API key from Authorization header (Bearer) or X-API-Key header
 * - Validate and attach key context to request
 * - Scope enforcement decorator
 * - Rate limit enforcement
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type ApiKey,
  type ApiKeyScope,
  type ApiKeyContext,
  type ApiKeyRateLimitResult,
  ApiKeyValidationErrorCode,
} from './types.js';
import {
  ApiKeyService,
  ApiKeyRateLimitError,
  getApiKeyService,
  createApiKeyService,
} from './service.js';

const logger = createLogger({ component: 'api-key-middleware' });

// =============================================================================
// METRICS
// =============================================================================

const apiKeyValidations = new Counter({
  name: 'vorion_api_key_validations_total',
  help: 'Total API key validation attempts',
  labelNames: ['result'] as const,
  registers: [vorionRegistry],
});

const apiKeyRateLimits = new Counter({
  name: 'vorion_api_key_rate_limits_total',
  help: 'Total API key rate limit hits',
  labelNames: ['exceeded'] as const,
  registers: [vorionRegistry],
});

const apiKeyValidationDuration = new Histogram({
  name: 'vorion_api_key_validation_duration_seconds',
  help: 'Duration of API key validation',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * Middleware options
 */
export interface ApiKeyMiddlewareOptions {
  /** API key service instance */
  service?: ApiKeyService;
  /** Header name for API key (default: X-API-Key) */
  headerName?: string;
  /** Also check Authorization: Bearer header */
  checkBearerHeader?: boolean;
  /** Paths to skip API key validation */
  skipPaths?: string[];
  /** Custom function to skip validation */
  skip?: (request: FastifyRequest) => boolean;
  /** Enforce rate limiting */
  enforceRateLimit?: boolean;
}

/**
 * Scope requirement options
 */
export interface ScopeRequirementOptions {
  /** Require all scopes (AND) or any scope (OR) */
  requireAll?: boolean;
}

/**
 * Fastify middleware function type
 */
export type FastifyMiddleware = preHandlerHookHandler;

// =============================================================================
// REQUEST DECORATION
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    /** API key context (present if authenticated via API key) */
    apiKeyContext?: ApiKeyContext;
  }

  interface FastifyInstance {
    /** API key service */
    apiKeyService?: ApiKeyService;
  }
}

// =============================================================================
// KEY EXTRACTION
// =============================================================================

/**
 * Extract API key from request headers
 *
 * Checks:
 * 1. X-API-Key header (or custom header)
 * 2. Authorization: Bearer header (if enabled)
 *
 * @param request - Fastify request
 * @param options - Middleware options
 * @returns API key string or null
 */
function extractApiKey(
  request: FastifyRequest,
  options: ApiKeyMiddlewareOptions
): string | null {
  const headerName = options.headerName ?? 'x-api-key';

  // Check custom header first
  const customHeader = request.headers[headerName.toLowerCase()];
  if (customHeader) {
    return Array.isArray(customHeader) ? customHeader[0] ?? null : customHeader;
  }

  // Check Authorization: Bearer header
  if (options.checkBearerHeader !== false) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer vak_')) {
      return authHeader.substring(7);
    }
  }

  return null;
}

/**
 * Get client IP address from request
 */
function getClientIp(request: FastifyRequest): string | undefined {
  // Check common proxy headers
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const firstIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0];
    return firstIp?.trim();
  }

  const realIp = request.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return request.ip;
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Create API key authentication middleware
 *
 * Validates API keys and attaches context to requests.
 *
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * // Apply to all routes
 * fastify.addHook('preHandler', apiKeyMiddleware({
 *   skipPaths: ['/health', '/docs'],
 *   enforceRateLimit: true,
 * }));
 *
 * // Or apply to specific routes
 * fastify.route({
 *   method: 'GET',
 *   url: '/api/data',
 *   preHandler: [apiKeyMiddleware()],
 *   handler: handleData,
 * });
 * ```
 */
export function apiKeyMiddleware(options: ApiKeyMiddlewareOptions = {}): FastifyMiddleware {
  const service = options.service ?? getApiKeyService();
  const skipPaths = new Set(options.skipPaths ?? []);
  const enforceRateLimit = options.enforceRateLimit ?? true;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Check skip conditions
    if (skipPaths.has(request.url) || skipPaths.has(request.routeOptions.url ?? '')) {
      return;
    }

    if (options.skip?.(request)) {
      return;
    }

    const startTime = Date.now();

    try {
      // Extract API key
      const rawKey = extractApiKey(request, options);
      if (!rawKey) {
        apiKeyValidations.inc({ result: 'missing' });
        return reply.status(401).send({
          error: {
            code: 'API_KEY_REQUIRED',
            message: 'API key is required',
            hint: 'Provide API key via X-API-Key header or Authorization: Bearer header',
          },
        });
      }

      // Get client IP for whitelist validation
      const clientIp = getClientIp(request);

      // Validate key
      const validationResult = await service.validate(rawKey, clientIp);

      const duration = (Date.now() - startTime) / 1000;
      apiKeyValidationDuration.observe(duration);

      if (!validationResult.valid) {
        apiKeyValidations.inc({ result: validationResult.errorCode ?? 'invalid' });

        const statusCode = getStatusCodeForError(validationResult.errorCode);

        return reply.status(statusCode).send({
          error: {
            code: validationResult.errorCode ?? 'API_KEY_INVALID',
            message: validationResult.error ?? 'Invalid API key',
          },
        });
      }

      const apiKey = validationResult.apiKey!;

      // Check rate limit if enabled
      let rateLimitState: ApiKeyRateLimitResult | undefined;
      if (enforceRateLimit) {
        rateLimitState = await service.checkRateLimit(apiKey);

        // Set rate limit headers
        setRateLimitHeaders(reply, rateLimitState, apiKey.rateLimit);

        if (!rateLimitState.allowed) {
          apiKeyValidations.inc({ result: 'rate_limited' });
          apiKeyRateLimits.inc({ exceeded: 'true' });

          return reply.status(429).send({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'API key rate limit exceeded',
              retryAfter: rateLimitState.retryAfter,
            },
          });
        }

        apiKeyRateLimits.inc({ exceeded: 'false' });
      }

      // Attach context to request
      request.apiKeyContext = {
        apiKey,
        rateLimitState: rateLimitState ?? {
          allowed: true,
          remaining: { minute: -1, hour: -1, burst: -1 },
          resetAt: { minute: 0, hour: 0, burst: 0 },
        },
        validatedAt: new Date(),
      };

      apiKeyValidations.inc({ result: 'success' });

      logger.debug(
        {
          keyId: apiKey.id,
          prefix: apiKey.prefix,
          tenantId: apiKey.tenantId,
          duration,
        },
        'API key validated'
      );

    } catch (error) {
      apiKeyValidations.inc({ result: 'error' });
      logger.error({ error }, 'API key middleware error');

      return reply.status(500).send({
        error: {
          code: 'API_KEY_VALIDATION_ERROR',
          message: 'Failed to validate API key',
        },
      });
    }
  };
}

/**
 * Get HTTP status code for validation error
 */
function getStatusCodeForError(errorCode?: ApiKeyValidationErrorCode): number {
  switch (errorCode) {
    case ApiKeyValidationErrorCode.NOT_FOUND:
    case ApiKeyValidationErrorCode.HASH_MISMATCH:
    case ApiKeyValidationErrorCode.INVALID_FORMAT:
      return 401;
    case ApiKeyValidationErrorCode.REVOKED:
    case ApiKeyValidationErrorCode.EXPIRED:
    case ApiKeyValidationErrorCode.IP_NOT_ALLOWED:
    case ApiKeyValidationErrorCode.INSUFFICIENT_SCOPE:
      return 403;
    case ApiKeyValidationErrorCode.RATE_LIMITED:
      return 429;
    default:
      return 401;
  }
}

/**
 * Set rate limit response headers
 */
function setRateLimitHeaders(
  reply: FastifyReply,
  state: ApiKeyRateLimitResult,
  limits: { requestsPerMinute: number; requestsPerHour: number; burstLimit: number }
): void {
  reply.header('X-RateLimit-Limit-Minute', limits.requestsPerMinute);
  reply.header('X-RateLimit-Remaining-Minute', state.remaining.minute);
  reply.header('X-RateLimit-Reset-Minute', Math.ceil(state.resetAt.minute / 1000));
  reply.header('X-RateLimit-Limit-Hour', limits.requestsPerHour);
  reply.header('X-RateLimit-Remaining-Hour', state.remaining.hour);
  reply.header('X-RateLimit-Reset-Hour', Math.ceil(state.resetAt.hour / 1000));

  if (state.retryAfter !== undefined) {
    reply.header('Retry-After', state.retryAfter);
  }
}

// =============================================================================
// SCOPE ENFORCEMENT
// =============================================================================

/**
 * Create scope requirement middleware
 *
 * Requires one or more API key scopes.
 *
 * @param requiredScopes - Required scope(s)
 * @param options - Scope requirement options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * // Require write scope
 * fastify.route({
 *   method: 'POST',
 *   url: '/api/data',
 *   preHandler: [apiKeyMiddleware(), requireScopes(['write'])],
 *   handler: handleCreate,
 * });
 *
 * // Require admin OR write scope
 * fastify.route({
 *   method: 'DELETE',
 *   url: '/api/data/:id',
 *   preHandler: [apiKeyMiddleware(), requireScopes(['admin', 'write'], { requireAll: false })],
 *   handler: handleDelete,
 * });
 * ```
 */
export function requireScopes(
  requiredScopes: ApiKeyScope[],
  options: ScopeRequirementOptions = {}
): FastifyMiddleware {
  const requireAll = options.requireAll ?? true;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const context = request.apiKeyContext;

    if (!context) {
      return reply.status(401).send({
        error: {
          code: 'API_KEY_REQUIRED',
          message: 'API key authentication required',
        },
      });
    }

    const apiKey = context.apiKey;
    const hasRequiredScopes = requireAll
      ? requiredScopes.every((scope) => apiKey.scopes.includes(scope))
      : requiredScopes.some((scope) => apiKey.scopes.includes(scope));

    if (!hasRequiredScopes) {
      logger.warn(
        {
          keyId: apiKey.id,
          prefix: apiKey.prefix,
          requiredScopes,
          actualScopes: apiKey.scopes,
          requireAll,
        },
        'Insufficient API key scope'
      );

      return reply.status(403).send({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `API key requires ${requireAll ? 'all' : 'one'} of these scopes: ${requiredScopes.join(', ')}`,
          requiredScopes,
          actualScopes: apiKey.scopes,
        },
      });
    }
  };
}

/**
 * Require read scope
 */
export function requireReadScope(): FastifyMiddleware {
  return requireScopes(['read']);
}

/**
 * Require write scope
 */
export function requireWriteScope(): FastifyMiddleware {
  return requireScopes(['write']);
}

/**
 * Require admin scope
 */
export function requireAdminScope(): FastifyMiddleware {
  return requireScopes(['admin']);
}

/**
 * Require webhook scope
 */
export function requireWebhookScope(): FastifyMiddleware {
  return requireScopes(['webhook']);
}

/**
 * Require integration scope
 */
export function requireIntegrationScope(): FastifyMiddleware {
  return requireScopes(['integration']);
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

/**
 * API Key Plugin Options
 */
export interface ApiKeyPluginOptions extends ApiKeyMiddlewareOptions {
  /** Register as global preHandler */
  global?: boolean;
}

/**
 * Fastify plugin for API key authentication
 *
 * @example
 * ```typescript
 * await fastify.register(apiKeyPlugin, {
 *   skipPaths: ['/health', '/docs'],
 *   enforceRateLimit: true,
 *   global: true,
 * });
 * ```
 */
export const apiKeyPlugin = fp(
  async (fastify: FastifyInstance, options: ApiKeyPluginOptions) => {
    const service = options.service ?? createApiKeyService();

    // Decorate fastify with service
    fastify.decorate('apiKeyService', service);

    // Register global middleware if requested
    if (options.global) {
      fastify.addHook('preHandler', apiKeyMiddleware({ ...options, service }));
    }

    logger.info(
      {
        global: options.global,
        skipPaths: options.skipPaths?.length ?? 0,
        enforceRateLimit: options.enforceRateLimit ?? true,
      },
      'API key plugin registered'
    );
  },
  {
    name: 'vorion-api-key',
    fastify: '5.x',
  }
);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get API key from request context
 */
export function getApiKey(request: FastifyRequest): ApiKey | undefined {
  return request.apiKeyContext?.apiKey;
}

/**
 * Get tenant ID from API key context
 */
export function getApiKeyTenantId(request: FastifyRequest): string | undefined {
  return request.apiKeyContext?.apiKey.tenantId;
}

/**
 * Check if request has a valid API key
 */
export function hasApiKey(request: FastifyRequest): boolean {
  return request.apiKeyContext !== undefined;
}

/**
 * Get API key scopes
 */
export function getApiKeyScopes(request: FastifyRequest): ApiKeyScope[] {
  return request.apiKeyContext?.apiKey.scopes ?? [];
}
