/**
 * DPoP Enforcement Middleware
 *
 * Fastify plugin that enforces DPoP (Demonstrating Proof-of-Possession) proof
 * validation on protected endpoints. Integrates with the existing DPoP service
 * to provide sender-constrained token validation per RFC 9449.
 *
 * Features:
 * - Per-route DPoP enforcement configuration (required, optional, none)
 * - Access token binding validation
 * - Replay attack prevention via JTI cache
 * - Security monitoring via structured logging
 * - Metrics for validation success/failure rates
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  DPoPService,
  DPoPError,
  createDPoPService,
} from '../../security/dpop.js';
import type {
  DPoPConfig,
  DPoPVerificationResult,
  JTICache,
  TrustTier,
} from '../../security/types.js';

const logger = createLogger({ component: 'dpop-enforcement' });

// =============================================================================
// METRICS
// =============================================================================

const dpopEnforcementAttempts = new Counter({
  name: 'vorion_dpop_enforcement_attempts_total',
  help: 'Total DPoP enforcement attempts by route',
  labelNames: ['enforcement_mode', 'result'] as const,
  registers: [vorionRegistry],
});

const dpopEnforcementDuration = new Histogram({
  name: 'vorion_dpop_enforcement_duration_seconds',
  help: 'Duration of DPoP enforcement checks',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [vorionRegistry],
});

const dpopMissingProofs = new Counter({
  name: 'vorion_dpop_missing_proofs_total',
  help: 'Total requests missing DPoP proofs when required',
  labelNames: ['path', 'method'] as const,
  registers: [vorionRegistry],
});

const dpopValidationFailures = new Counter({
  name: 'vorion_dpop_validation_failures_total',
  help: 'Total DPoP validation failures by error type',
  labelNames: ['error_code', 'path'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * DPoP enforcement mode for a route
 */
export type DPoPEnforcementMode = 'required' | 'optional' | 'none';

/**
 * Route-level DPoP configuration
 */
export interface RouteDPoPConfig {
  /** DPoP enforcement mode */
  dpop: DPoPEnforcementMode;
}

/**
 * Route pattern with DPoP configuration
 */
export interface DPoPRoutePattern {
  /** HTTP method (GET, POST, etc.) or '*' for all methods */
  method: string | '*';
  /** URL pattern (exact match or with wildcards) */
  pattern: string;
  /** DPoP enforcement mode */
  dpop: DPoPEnforcementMode;
}

/**
 * DPoP enforcement plugin options
 */
export interface DPoPEnforcementOptions {
  /** DPoP service instance (optional, will create default if not provided) */
  dpopService?: DPoPService;
  /** DPoP configuration for service creation */
  dpopConfig?: Partial<DPoPConfig>;
  /** JTI cache implementation (optional, defaults to in-memory) */
  jtiCache?: JTICache;
  /** Default enforcement mode for unspecified routes */
  defaultMode?: DPoPEnforcementMode;
  /** Route-specific DPoP configurations */
  routeConfigs?: DPoPRoutePattern[];
  /** Paths to skip DPoP enforcement entirely */
  skipPaths?: string[];
  /** Trust tier to extract from request for tier-based enforcement */
  extractTrustTier?: (request: FastifyRequest) => TrustTier | undefined;
  /** Log all DPoP decisions (for debugging) */
  logDecisions?: boolean;
  /** Base URL for URI validation (defaults to request protocol + host) */
  baseUrl?: string;
}

/**
 * DPoP validation context attached to request
 */
export interface DPoPContext {
  /** Whether DPoP was validated */
  validated: boolean;
  /** DPoP key thumbprint (JWK thumbprint of proof key) */
  keyThumbprint?: string;
  /** Enforcement mode applied */
  enforcementMode: DPoPEnforcementMode;
  /** Validation timestamp */
  validatedAt?: string;
  /** Error if validation failed */
  error?: string;
  /** Error code if validation failed */
  errorCode?: string;
}

/**
 * Extended Fastify request with DPoP context
 */
declare module 'fastify' {
  interface FastifyRequest {
    /** DPoP validation context */
    dpopContext?: DPoPContext;
    /** DPoP key thumbprint (shortcut for dpopContext.keyThumbprint) */
    dpopKeyThumbprint?: string;
  }

  interface FastifyInstance {
    /** DPoP service instance */
    dpopService?: DPoPService;
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** HTTP header name for DPoP proof */
const DPOP_HEADER = 'dpop';

/** HTTP header name for Authorization */
const AUTHORIZATION_HEADER = 'authorization';

/** Bearer token prefix */
const BEARER_PREFIX = 'Bearer ';

/** DPoP token prefix (for DPoP-bound tokens) */
const DPOP_TOKEN_PREFIX = 'DPoP ';

// =============================================================================
// ROUTE MATCHING
// =============================================================================

/**
 * Match a URL pattern against a request URL
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
  configs: DPoPRoutePattern[]
): DPoPEnforcementMode | null {
  const method = request.method.toUpperCase();
  const url = request.url;

  for (const config of configs) {
    // Check method match
    if (config.method !== '*' && config.method.toUpperCase() !== method) {
      continue;
    }

    // Check pattern match
    if (matchPattern(config.pattern, url)) {
      return config.dpop;
    }
  }

  return null;
}

// =============================================================================
// TOKEN EXTRACTION
// =============================================================================

/**
 * Extract access token from Authorization header
 */
function extractAccessToken(request: FastifyRequest): string | null {
  const authHeader = request.headers[AUTHORIZATION_HEADER];
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  // Support both Bearer and DPoP token schemes
  if (authHeader.startsWith(BEARER_PREFIX)) {
    return authHeader.slice(BEARER_PREFIX.length);
  }

  if (authHeader.startsWith(DPOP_TOKEN_PREFIX)) {
    return authHeader.slice(DPOP_TOKEN_PREFIX.length);
  }

  return null;
}

/**
 * Extract DPoP proof from request header
 */
function extractDPoPProof(request: FastifyRequest): string | null {
  const dpopHeader = request.headers[DPOP_HEADER];
  if (!dpopHeader || typeof dpopHeader !== 'string') {
    return null;
  }
  return dpopHeader;
}

/**
 * Build full request URI for DPoP validation
 */
function buildRequestUri(request: FastifyRequest, baseUrl?: string): string {
  if (baseUrl) {
    // Use provided base URL
    const urlPath = request.url.split('?')[0] ?? request.url;
    return `${baseUrl.replace(/\/$/, '')}${urlPath}`;
  }

  // Build from request
  const protocol = request.protocol || 'https';
  const host = request.headers.host || request.hostname;
  const urlPath = request.url.split('?')[0] ?? request.url;

  return `${protocol}://${host}${urlPath}`;
}

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * DPoP error response format
 */
interface DPoPErrorResponse {
  error: {
    code: string;
    message: string;
    hint?: string;
    dpopNonce?: string;
  };
}

/**
 * Send 400 Bad Request for malformed DPoP proof
 */
function sendBadRequest(
  reply: FastifyReply,
  code: string,
  message: string,
  hint?: string
): void {
  const response: DPoPErrorResponse = {
    error: {
      code,
      message,
      ...(hint && { hint }),
    },
  };

  // Set WWW-Authenticate header per RFC 9449
  reply.header('WWW-Authenticate', 'DPoP error="invalid_dpop_proof"');
  reply.status(400).send(response);
}

/**
 * Send 401 Unauthorized for missing or invalid DPoP proof
 */
function sendUnauthorized(
  reply: FastifyReply,
  code: string,
  message: string,
  hint?: string
): void {
  const response: DPoPErrorResponse = {
    error: {
      code,
      message,
      ...(hint && { hint }),
    },
  };

  // Set WWW-Authenticate header per RFC 9449
  reply.header('WWW-Authenticate', 'DPoP error="invalid_token"');
  reply.status(401).send(response);
}

/**
 * Send 403 Forbidden for DPoP proof that doesn't match token
 */
function sendForbidden(
  reply: FastifyReply,
  code: string,
  message: string,
  hint?: string
): void {
  const response: DPoPErrorResponse = {
    error: {
      code,
      message,
      ...(hint && { hint }),
    },
  };

  reply.header('WWW-Authenticate', 'DPoP error="use_dpop_nonce"');
  reply.status(403).send(response);
}

// =============================================================================
// DEFAULT ROUTE CONFIGURATIONS
// =============================================================================

/**
 * Default DPoP route configurations
 *
 * DPoP ENFORCEMENT PER ROUTE TYPE:
 *
 * None (public endpoints):
 * - /health, /ready, /metrics - Health checks
 * - /api/v1/docs/* - API documentation
 *
 * Optional (accept DPoP if provided):
 * - /api/v1/auth/* - Authentication endpoints (token issuance)
 *
 * Required (DPoP must be present and valid):
 * - /api/v1/intents/* - Intent operations (T2+ per ACI spec)
 * - /api/v1/escalations/* - Escalation operations
 * - /api/v1/policies/* - Policy operations
 * - /api/v1/admin/* - Admin operations (high security)
 * - /api/v1/gdpr/* - GDPR operations (high security)
 */
const DEFAULT_DPOP_ROUTE_CONFIGS: DPoPRoutePattern[] = [
  // Public routes - no DPoP required
  { method: '*', pattern: '/health', dpop: 'none' },
  { method: '*', pattern: '/ready', dpop: 'none' },
  { method: '*', pattern: '/metrics', dpop: 'none' },
  { method: '*', pattern: '/scheduler', dpop: 'none' },
  { method: '*', pattern: '/api/v1/docs', dpop: 'none' },
  { method: '*', pattern: '/api/v1/docs/*', dpop: 'none' },
  { method: '*', pattern: '/api/v1/health', dpop: 'none' },
  { method: '*', pattern: '/api/v1/health/*', dpop: 'none' },

  // Auth routes - DPoP optional (for token issuance with DPoP binding)
  { method: '*', pattern: '/api/v1/auth/*', dpop: 'optional' },
  { method: '*', pattern: '/api/v1/sessions/*', dpop: 'optional' },

  // Protected routes - DPoP required
  { method: '*', pattern: '/api/v1/intents', dpop: 'required' },
  { method: '*', pattern: '/api/v1/intents/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/escalations', dpop: 'required' },
  { method: '*', pattern: '/api/v1/escalations/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/policies', dpop: 'required' },
  { method: '*', pattern: '/api/v1/policies/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/audit', dpop: 'required' },
  { method: '*', pattern: '/api/v1/audit/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/proofs/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/trust/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/constraints/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/webhooks', dpop: 'required' },
  { method: '*', pattern: '/api/v1/webhooks/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/admin/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/gdpr/*', dpop: 'required' },
  { method: '*', pattern: '/api/v1/extensions/*', dpop: 'required' },
];

// =============================================================================
// MIDDLEWARE IMPLEMENTATION
// =============================================================================

/**
 * Async hook handler type
 */
type AsyncHookHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Create DPoP enforcement handler for a specific mode
 */
function createDPoPEnforcementHandler(
  dpopService: DPoPService,
  enforcementMode: DPoPEnforcementMode,
  options: DPoPEnforcementOptions
): AsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    const requestId = request.id;

    // Initialize DPoP context
    const dpopContext: DPoPContext = {
      validated: false,
      enforcementMode,
    };

    try {
      // Skip if mode is 'none'
      if (enforcementMode === 'none') {
        dpopContext.validated = true;
        request.dpopContext = dpopContext;
        dpopEnforcementAttempts.inc({ enforcement_mode: 'none', result: 'skipped' });
        return;
      }

      // Extract DPoP proof
      const dpopProof = extractDPoPProof(request);
      const accessToken = extractAccessToken(request);

      // Handle missing DPoP proof
      if (!dpopProof) {
        if (enforcementMode === 'required') {
          // Log security event
          logger.warn(
            {
              requestId,
              method: request.method,
              path: request.url,
              ip: request.ip,
              userAgent: request.headers['user-agent'],
            },
            'DPoP proof missing for protected endpoint'
          );

          dpopMissingProofs.inc({ path: request.url.split('?')[0] ?? request.url, method: request.method });
          dpopEnforcementAttempts.inc({ enforcement_mode: 'required', result: 'missing_proof' });

          dpopContext.error = 'DPoP proof is required';
          dpopContext.errorCode = 'MISSING_DPOP_PROOF';
          request.dpopContext = dpopContext;

          sendUnauthorized(
            reply,
            'DPOP_REQUIRED',
            'DPoP proof is required for this endpoint',
            'Include a DPoP proof JWT in the DPoP header'
          );
          return;
        }

        // Optional mode - proceed without DPoP
        dpopContext.validated = true;
        request.dpopContext = dpopContext;
        dpopEnforcementAttempts.inc({ enforcement_mode: 'optional', result: 'skipped_no_proof' });

        if (options.logDecisions) {
          logger.debug(
            { requestId, method: request.method, path: request.url },
            'DPoP proof not provided (optional mode)'
          );
        }
        return;
      }

      // Handle missing access token when DPoP is provided
      if (!accessToken) {
        logger.warn(
          {
            requestId,
            method: request.method,
            path: request.url,
          },
          'DPoP proof provided without access token'
        );

        dpopEnforcementAttempts.inc({ enforcement_mode: enforcementMode, result: 'missing_token' });

        dpopContext.error = 'Access token missing';
        dpopContext.errorCode = 'MISSING_ACCESS_TOKEN';
        request.dpopContext = dpopContext;

        sendUnauthorized(
          reply,
          'ACCESS_TOKEN_REQUIRED',
          'Access token is required when providing DPoP proof',
          'Include access token in Authorization header'
        );
        return;
      }

      // Build request URI for validation
      const requestUri = buildRequestUri(request, options.baseUrl);

      // Calculate access token hash for binding validation
      const accessTokenHash = await dpopService.generateAccessTokenHash(accessToken);

      // Verify the DPoP proof
      const verificationResult: DPoPVerificationResult = await dpopService.verifyProof(
        dpopProof,
        request.method,
        requestUri,
        accessTokenHash
      );

      if (!verificationResult.valid) {
        // Log security event with details
        logger.warn(
          {
            requestId,
            method: request.method,
            path: request.url,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            error: verificationResult.error,
            errorCode: verificationResult.errorCode,
          },
          'DPoP proof validation failed'
        );

        dpopValidationFailures.inc({
          error_code: verificationResult.errorCode || 'UNKNOWN',
          path: request.url.split('?')[0] ?? request.url,
        });
        dpopEnforcementAttempts.inc({ enforcement_mode: enforcementMode, result: 'validation_failed' });

        dpopContext.error = verificationResult.error;
        dpopContext.errorCode = verificationResult.errorCode;
        request.dpopContext = dpopContext;

        // Choose appropriate error response based on error type
        switch (verificationResult.errorCode) {
          case 'INVALID_FORMAT':
            sendBadRequest(
              reply,
              'DPOP_INVALID_FORMAT',
              verificationResult.error || 'Invalid DPoP proof format',
              'Ensure the DPoP proof is a valid JWT with required claims'
            );
            break;

          case 'EXPIRED':
            sendUnauthorized(
              reply,
              'DPOP_EXPIRED',
              verificationResult.error || 'DPoP proof has expired',
              'Generate a fresh DPoP proof with current timestamp'
            );
            break;

          case 'REPLAY':
            sendForbidden(
              reply,
              'DPOP_REPLAY',
              verificationResult.error || 'DPoP proof replay detected',
              'Each DPoP proof must have a unique jti claim'
            );
            break;

          case 'METHOD_MISMATCH':
            sendBadRequest(
              reply,
              'DPOP_METHOD_MISMATCH',
              verificationResult.error || 'DPoP proof method does not match request',
              'Ensure the htm claim matches the HTTP method'
            );
            break;

          case 'URI_MISMATCH':
            sendBadRequest(
              reply,
              'DPOP_URI_MISMATCH',
              verificationResult.error || 'DPoP proof URI does not match request',
              'Ensure the htu claim matches the request URI'
            );
            break;

          case 'INVALID_SIGNATURE':
            sendUnauthorized(
              reply,
              'DPOP_INVALID_SIGNATURE',
              verificationResult.error || 'DPoP proof signature is invalid',
              'Ensure the proof is signed with the correct key'
            );
            break;

          default:
            sendUnauthorized(
              reply,
              'DPOP_VALIDATION_FAILED',
              verificationResult.error || 'DPoP proof validation failed',
              'Check the DPoP proof format and claims'
            );
        }
        return;
      }

      // Validation successful
      dpopContext.validated = true;
      dpopContext.keyThumbprint = verificationResult.keyThumbprint;
      dpopContext.validatedAt = verificationResult.verifiedAt;
      request.dpopContext = dpopContext;
      request.dpopKeyThumbprint = verificationResult.keyThumbprint;

      dpopEnforcementAttempts.inc({ enforcement_mode: enforcementMode, result: 'success' });

      if (options.logDecisions) {
        logger.debug(
          {
            requestId,
            method: request.method,
            path: request.url,
            keyThumbprint: verificationResult.keyThumbprint,
          },
          'DPoP proof validated successfully'
        );
      }
    } catch (error) {
      // Unexpected error during validation
      logger.error(
        {
          requestId,
          method: request.method,
          path: request.url,
          error: error instanceof Error ? error.message : String(error),
        },
        'DPoP enforcement error'
      );

      dpopEnforcementAttempts.inc({ enforcement_mode: enforcementMode, result: 'error' });

      dpopContext.error = error instanceof Error ? error.message : 'Internal error';
      dpopContext.errorCode = 'INTERNAL_ERROR';
      request.dpopContext = dpopContext;

      if (enforcementMode === 'required') {
        sendUnauthorized(
          reply,
          'DPOP_VALIDATION_ERROR',
          'Failed to validate DPoP proof',
          'An unexpected error occurred during DPoP validation'
        );
        return;
      }

      // Optional mode - proceed despite error
      dpopContext.validated = true;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      dpopEnforcementDuration.observe(duration);
    }
  };
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

/**
 * DPoP Enforcement Plugin
 *
 * Registers DPoP proof validation middleware for protected endpoints.
 * Supports route-level configuration for required, optional, or no enforcement.
 *
 * @example
 * ```typescript
 * await fastify.register(dpopEnforcementPlugin, {
 *   defaultMode: 'required',
 *   routeConfigs: [
 *     { method: '*', pattern: '/public/*', dpop: 'none' },
 *     { method: 'POST', pattern: '/api/v1/auth/token', dpop: 'optional' },
 *   ],
 * });
 * ```
 */
export const dpopEnforcementPlugin = fp(
  async (fastify: FastifyInstance, options: DPoPEnforcementOptions) => {
    // Create or use provided DPoP service
    const dpopService = options.dpopService ?? createDPoPService(
      options.dpopConfig,
      options.jtiCache
    );

    const defaultMode = options.defaultMode ?? 'required';
    const routeConfigs = [...DEFAULT_DPOP_ROUTE_CONFIGS, ...(options.routeConfigs ?? [])];
    const skipPaths = new Set(options.skipPaths ?? ['/health', '/ready', '/metrics']);
    const logDecisions = options.logDecisions ?? false;

    // Decorate fastify with the DPoP service
    if (!fastify.hasDecorator('dpopService')) {
      fastify.decorate('dpopService', dpopService);
    }

    // Decorate request with DPoP context
    fastify.decorateRequest('dpopContext', undefined);
    fastify.decorateRequest('dpopKeyThumbprint', undefined);

    // Add preHandler hook for DPoP enforcement
    fastify.addHook('preHandler', async (request, reply) => {
      // Skip for explicitly excluded paths
      if (skipPaths.has(request.url) || skipPaths.has(request.routeOptions?.url ?? '')) {
        request.dpopContext = {
          validated: true,
          enforcementMode: 'none',
        };
        return;
      }

      // Find matching route config
      const routeMode = findRouteConfig(request, routeConfigs);

      // Determine enforcement mode
      let enforcementMode = routeMode ?? defaultMode;

      // Check trust tier if extractor provided (tier-based enforcement)
      if (options.extractTrustTier) {
        const trustTier = options.extractTrustTier(request);
        if (trustTier !== undefined && dpopService.isRequired(trustTier)) {
          // Upgrade to required if trust tier requires DPoP
          if (enforcementMode === 'optional' || enforcementMode === 'none') {
            enforcementMode = 'required';

            if (logDecisions) {
              logger.debug(
                {
                  requestId: request.id,
                  trustTier,
                  originalMode: routeMode ?? defaultMode,
                },
                'DPoP enforcement upgraded to required based on trust tier'
              );
            }
          }
        }
      }

      // Create and execute enforcement handler
      const enforcer = createDPoPEnforcementHandler(dpopService, enforcementMode, options);
      await enforcer(request, reply);
    });

    logger.info(
      {
        defaultMode,
        routeConfigCount: routeConfigs.length,
        skipPaths: Array.from(skipPaths),
      },
      'DPoP enforcement plugin registered'
    );
  },
  {
    name: 'vorion-dpop-enforcement',
    fastify: '>=4.x',
  }
);

// =============================================================================
// ROUTE DECORATOR UTILITIES
// =============================================================================

/**
 * Create a route-specific DPoP configuration
 *
 * Use this with Fastify route options for per-route DPoP requirements.
 *
 * @example
 * ```typescript
 * fastify.post('/api/v1/sensitive', {
 *   config: { dpop: dpopRequired() },
 * }, handler);
 * ```
 */
export function dpopRequired(): RouteDPoPConfig {
  return { dpop: 'required' };
}

/**
 * Create a route config for optional DPoP
 */
export function dpopOptional(): RouteDPoPConfig {
  return { dpop: 'optional' };
}

/**
 * Create a route config for no DPoP enforcement
 */
export function dpopNone(): RouteDPoPConfig {
  return { dpop: 'none' };
}

// =============================================================================
// PREHANDLER UTILITIES
// =============================================================================

/**
 * Create a preHandler hook that enforces DPoP for a specific route
 *
 * Use this when you need per-route DPoP enforcement outside the plugin.
 *
 * @example
 * ```typescript
 * fastify.post('/api/v1/sensitive', {
 *   preHandler: requireDPoP(),
 * }, handler);
 * ```
 */
export function requireDPoP(
  dpopService?: DPoPService,
  options?: Partial<DPoPEnforcementOptions>
): AsyncHookHandler {
  // Lazy initialization - will use fastify.dpopService if available
  let service: DPoPService | undefined = dpopService;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Try to get service from fastify instance if not provided
    if (!service) {
      const fastifyService = (request.server as FastifyInstance & { dpopService?: DPoPService }).dpopService;
      if (fastifyService) {
        service = fastifyService;
      } else {
        service = createDPoPService(options?.dpopConfig, options?.jtiCache);
      }
    }

    const handler = createDPoPEnforcementHandler(service, 'required', options ?? {});
    await handler(request, reply);
  };
}

/**
 * Create a preHandler that accepts optional DPoP proof
 */
export function optionalDPoP(
  dpopService?: DPoPService,
  options?: Partial<DPoPEnforcementOptions>
): AsyncHookHandler {
  let service: DPoPService | undefined = dpopService;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!service) {
      const fastifyService = (request.server as FastifyInstance & { dpopService?: DPoPService }).dpopService;
      if (fastifyService) {
        service = fastifyService;
      } else {
        service = createDPoPService(options?.dpopConfig, options?.jtiCache);
      }
    }

    const handler = createDPoPEnforcementHandler(service, 'optional', options ?? {});
    await handler(request, reply);
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if request has validated DPoP proof
 */
export function hasDPoPProof(request: FastifyRequest): boolean {
  return request.dpopContext?.validated === true && request.dpopContext?.keyThumbprint !== undefined;
}

/**
 * Get DPoP key thumbprint from request
 */
export function getDPoPKeyThumbprint(request: FastifyRequest): string | undefined {
  return request.dpopContext?.keyThumbprint;
}

/**
 * Get full DPoP context from request
 */
export function getDPoPContext(request: FastifyRequest): DPoPContext | undefined {
  return request.dpopContext;
}

/**
 * Check if DPoP validation failed
 */
export function dpopValidationFailed(request: FastifyRequest): boolean {
  const context = request.dpopContext;
  if (!context) {
    return false;
  }
  return context.enforcementMode !== 'none' && !context.validated;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  DPoPService,
  DPoPError,
  createDPoPService,
};

export type {
  DPoPConfig,
  DPoPVerificationResult,
  JTICache,
  TrustTier,
};

export default dpopEnforcementPlugin;
