/**
 * Comprehensive Rate Limit Configuration
 *
 * Provides route-specific rate limiting for sensitive endpoints with:
 * - Per-user rate limiting (tracks by user ID, not just IP)
 * - Different limits for authenticated vs anonymous users
 * - Higher limits for admin users
 * - Internal service bypass capability
 * - Standard rate limit headers (X-RateLimit-*)
 * - Audit logging for bypass usage
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { createLogger } from '../../common/logger.js';
import { getTraceContext } from '../../common/trace.js';
import { createAuditService } from '../../audit/service.js';
import type { VorionErrorResponse } from '../../common/contracts/output.js';

const logger = createLogger({ component: 'rate-limits' });
const tracer = trace.getTracer('vorion-rate-limits');
const auditService = createAuditService();

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Rate limit configuration for an endpoint
 */
export interface EndpointRateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/**
 * User type for rate limiting multipliers
 */
export type UserType = 'anonymous' | 'authenticated' | 'admin' | 'service';

/**
 * Multipliers for different user types
 */
export interface RateLimitMultipliers {
  anonymous: number;
  authenticated: number;
  admin: number;
  service: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitStatus {
  /** Route pattern */
  route: string;
  /** Maximum requests allowed */
  limit: number;
  /** Remaining requests in window */
  remaining: number;
  /** Unix timestamp when window resets */
  resetAt: number;
  /** Seconds until reset */
  resetInSeconds: number;
  /** User type applied */
  userType: UserType;
  /** Whether rate limit was bypassed */
  bypassed: boolean;
}

/**
 * Rate limit window entry
 */
interface WindowEntry {
  count: number;
  resetAt: number;
}

// ============================================================================
// Route Rate Limit Configuration
// ============================================================================

/**
 * Rate limit configuration for sensitive endpoints.
 *
 * Format: 'METHOD /path' -> { max, windowSeconds }
 *
 * These limits are for authenticated users. Anonymous users get 50% of these limits.
 * Admin users get 200% of these limits. Service accounts can bypass if authorized.
 */
export const rateLimitConfig: Record<string, EndpointRateLimitConfig> = {
  // ==========================================================================
  // Auth endpoints - Most restrictive to prevent brute force
  // ==========================================================================
  'POST /auth/login': { max: 5, windowSeconds: 300 }, // 5 per 5 min
  'POST /auth/refresh': { max: 10, windowSeconds: 60 }, // 10 per min
  'POST /auth/logout': { max: 10, windowSeconds: 60 }, // 10 per min
  'POST /auth/revoke-all': { max: 3, windowSeconds: 3600 }, // 3 per hour

  // ==========================================================================
  // Destructive operations - Carefully limited
  // ==========================================================================
  'DELETE /policies/:id': { max: 10, windowSeconds: 3600 }, // 10 per hour
  'DELETE /intents/:id': { max: 20, windowSeconds: 3600 }, // 20 per hour
  'DELETE /escalations/:id': { max: 10, windowSeconds: 3600 }, // 10 per hour
  'DELETE /escalations/:id/assign/:userId': { max: 20, windowSeconds: 3600 }, // 20 per hour

  // ==========================================================================
  // Admin operations - Protected but allow legitimate admin work
  // ==========================================================================
  'POST /admin/cleanup': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /admin/dlq/:jobId/retry': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /admin/users/:userId/revoke-tokens': { max: 30, windowSeconds: 60 }, // 30 per min
  'DELETE /admin/*': { max: 10, windowSeconds: 3600 }, // 10 per hour

  // ==========================================================================
  // Bulk operations - Very restrictive to prevent abuse
  // ==========================================================================
  'POST /intents/bulk': { max: 5, windowSeconds: 60 }, // 5 per min
  'POST /escalations/bulk/approve': { max: 5, windowSeconds: 60 }, // 5 per min
  'POST /escalations/bulk/reject': { max: 5, windowSeconds: 60 }, // 5 per min

  // ==========================================================================
  // GDPR operations - Very restrictive
  // ==========================================================================
  'POST /intent/gdpr/export': { max: 3, windowSeconds: 3600 }, // 3 per hour
  'DELETE /intent/gdpr/data': { max: 1, windowSeconds: 86400 }, // 1 per day

  // ==========================================================================
  // Policy lifecycle operations
  // ==========================================================================
  'POST /policies': { max: 30, windowSeconds: 60 }, // 30 per min
  'PUT /policies/:id': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /policies/:id/publish': { max: 20, windowSeconds: 60 }, // 20 per min
  'POST /policies/:id/deprecate': { max: 20, windowSeconds: 60 }, // 20 per min
  'POST /policies/:id/archive': { max: 20, windowSeconds: 60 }, // 20 per min

  // ==========================================================================
  // Intent operations
  // ==========================================================================
  'POST /intents': { max: 100, windowSeconds: 60 }, // 100 per min
  'POST /intents/:id/cancel': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /intents/:id/replay': { max: 10, windowSeconds: 60 }, // 10 per min

  // ==========================================================================
  // Escalation operations
  // ==========================================================================
  'POST /escalations/:id/acknowledge': { max: 60, windowSeconds: 60 }, // 60 per min
  'POST /escalations/:id/approve': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /escalations/:id/reject': { max: 30, windowSeconds: 60 }, // 30 per min
  'POST /escalations/:id/assign': { max: 30, windowSeconds: 60 }, // 30 per min
};

/**
 * Default rate limit multipliers for different user types
 */
export const defaultMultipliers: RateLimitMultipliers = {
  anonymous: 0.5, // 50% of base limit
  authenticated: 1.0, // 100% of base limit (base)
  admin: 2.0, // 200% of base limit
  service: Infinity, // Unlimited (but still logged)
};

/**
 * Permission required to bypass rate limits
 */
export const RATE_LIMIT_BYPASS_PERMISSION = 'rate_limit:bypass';

// ============================================================================
// In-Memory Rate Limit Store
// ============================================================================

/**
 * In-memory rate limit store for per-user tracking
 */
class UserRateLimitStore {
  private windows: Map<string, WindowEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxSize: number = 100000;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref();
  }

  /**
   * Generate a unique key for user + route
   */
  private generateKey(userId: string, route: string): string {
    return `${userId}:${route}`;
  }

  /**
   * Check rate limit for a user on a specific route
   */
  check(
    userId: string,
    route: string,
    limit: number,
    windowSeconds: number
  ): {
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
    resetAt: number;
    resetInSeconds: number;
  } {
    const key = this.generateKey(userId, route);
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    let entry = this.windows.get(key);

    // Check if window has expired
    if (!entry || now >= entry.resetAt) {
      // Create new window
      entry = { count: 0, resetAt: now + windowMs };

      // Check max size before adding
      if (this.windows.size >= this.maxSize) {
        this.evictOldestEntries(Math.floor(this.maxSize * 0.1));
      }

      this.windows.set(key, entry);
    }

    const current = entry.count;
    const allowed = current < limit;

    if (allowed) {
      entry.count++;
    }

    const remaining = Math.max(0, limit - entry.count);
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

    return {
      allowed,
      current: entry.count,
      limit,
      remaining,
      resetAt: Math.ceil(entry.resetAt / 1000),
      resetInSeconds: Math.max(0, resetInSeconds),
    };
  }

  /**
   * Peek at current state without incrementing
   */
  peek(
    userId: string,
    route: string,
    limit: number
  ): {
    current: number;
    limit: number;
    remaining: number;
    resetAt: number;
    resetInSeconds: number;
  } | null {
    const key = this.generateKey(userId, route);
    const entry = this.windows.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now >= entry.resetAt) {
      return null;
    }

    const remaining = Math.max(0, limit - entry.count);
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

    return {
      current: entry.count,
      limit,
      remaining,
      resetAt: Math.ceil(entry.resetAt / 1000),
      resetInSeconds: Math.max(0, resetInSeconds),
    };
  }

  /**
   * Get all rate limit statuses for a user
   */
  getUserStatuses(userId: string): Map<string, WindowEntry> {
    const statuses = new Map<string, WindowEntry>();
    const prefix = `${userId}:`;

    for (const [key, entry] of this.windows.entries()) {
      if (key.startsWith(prefix)) {
        const route = key.slice(prefix.length);
        statuses.set(route, entry);
      }
    }

    return statuses;
  }

  /**
   * Evict oldest entries (LRU-style)
   */
  private evictOldestEntries(count: number): void {
    const entries = Array.from(this.windows.entries())
      .sort((a, b) => a[1].resetAt - b[1].resetAt);

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.windows.delete(entries[i]![0]);
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows.entries()) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): { activeKeys: number; maxSize: number } {
    return {
      activeKeys: this.windows.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * Stop cleanup timer
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
  }
}

// Global rate limit store instance
let globalStore: UserRateLimitStore | null = null;

/**
 * Get the global user rate limit store
 */
export function getUserRateLimitStore(): UserRateLimitStore {
  if (!globalStore) {
    globalStore = new UserRateLimitStore();
  }
  return globalStore;
}

/**
 * Reset the global store (for testing)
 */
export function resetUserRateLimitStore(): void {
  if (globalStore) {
    globalStore.stop();
    globalStore = null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract user information from request
 */
function extractUserInfo(request: FastifyRequest): {
  userId: string;
  userType: UserType;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
} {
  const auth = request.auth as {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
    type?: string;
  } | undefined;

  const user = request.user as {
    sub?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
  } | undefined;

  // Get user ID (fallback to IP for anonymous)
  const userId = auth?.userId ?? user?.sub ?? `ip:${extractClientIp(request)}`;

  // Get tenant ID
  const tenantId = auth?.tenantId ?? user?.tenantId ?? null;

  // Get roles
  const roles = auth?.roles ?? user?.roles ?? [];

  // Get permissions
  const permissions = auth?.permissions ?? user?.permissions ?? [];

  // Determine user type
  let userType: UserType = 'anonymous';

  if (auth?.type === 'service' || permissions.includes('service:internal')) {
    userType = 'service';
  } else if (
    roles.includes('admin') ||
    roles.includes('tenant:admin') ||
    roles.includes('system:admin')
  ) {
    userType = 'admin';
  } else if (auth?.userId || user?.sub) {
    userType = 'authenticated';
  }

  return { userId, userType, tenantId, roles, permissions };
}

/**
 * Extract client IP from request
 */
function extractClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string') return realIp;

  return request.ip ?? 'unknown';
}

/**
 * Match route pattern against request
 */
function matchRoute(
  method: string,
  url: string,
  pattern: string
): boolean {
  const [patternMethod, patternPath] = pattern.split(' ');

  if (patternMethod !== method) {
    return false;
  }

  // Handle wildcard patterns
  if (patternPath?.endsWith('/*')) {
    const prefix = patternPath.slice(0, -2);
    return url.startsWith(prefix);
  }

  // Handle parameter patterns like :id
  const patternParts = patternPath?.split('/') ?? [];
  const urlParts = url.split('?')[0]?.split('/') ?? [];

  if (patternParts.length !== urlParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]!;
    const urlPart = urlParts[i]!;

    if (patternPart.startsWith(':')) {
      // Parameter - matches any value
      continue;
    }

    if (patternPart !== urlPart) {
      return false;
    }
  }

  return true;
}

/**
 * Find matching rate limit config for a request
 */
function findRateLimitConfig(
  method: string,
  url: string
): { pattern: string; config: EndpointRateLimitConfig } | null {
  // Strip API version prefix
  const normalizedUrl = url.replace(/^\/api\/v\d+/, '');

  for (const [pattern, config] of Object.entries(rateLimitConfig)) {
    if (matchRoute(method, normalizedUrl, pattern)) {
      return { pattern, config };
    }
  }

  return null;
}

/**
 * Calculate effective limit based on user type
 */
function calculateEffectiveLimit(
  baseLimit: number,
  userType: UserType,
  multipliers: RateLimitMultipliers = defaultMultipliers
): number {
  const multiplier = multipliers[userType];

  if (multiplier === Infinity) {
    return Infinity;
  }

  return Math.ceil(baseLimit * multiplier);
}

/**
 * Check if user can bypass rate limits
 */
function canBypassRateLimit(permissions: string[]): boolean {
  return permissions.includes(RATE_LIMIT_BYPASS_PERMISSION);
}

/**
 * Set rate limit headers on response
 */
function setRateLimitHeaders(
  reply: FastifyReply,
  limit: number,
  remaining: number,
  resetAt: number,
  retryAfter?: number
): void {
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', resetAt);

  if (retryAfter !== undefined) {
    reply.header('Retry-After', retryAfter);
  }
}

/**
 * Create rate limit error response
 */
function createRateLimitErrorResponse(
  limit: number,
  remaining: number,
  resetAt: number,
  retryAfter: number,
  requestId: string
): VorionErrorResponse {
  return {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry later.',
      details: {
        limit,
        remaining,
        resetAt: new Date(resetAt * 1000).toISOString(),
        retryAfter,
      },
      retryAfter,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Record rate limit bypass in audit log
 */
async function recordRateLimitBypass(
  tenantId: string,
  userId: string,
  route: string,
  ip: string
): Promise<void> {
  try {
    await auditService.record({
      tenantId,
      eventType: 'security.rate_limit.bypassed',
      actor: {
        type: 'service',
        id: userId,
        ip,
      },
      target: {
        type: 'system',
        id: route,
      },
      action: 'bypass_rate_limit',
      outcome: 'success',
      metadata: {
        route,
        bypassReason: 'service_permission',
      },
    });
  } catch (error) {
    logger.error({ error, userId, route }, 'Failed to record rate limit bypass audit');
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create comprehensive rate limiting middleware
 *
 * This middleware:
 * 1. Looks up route-specific rate limits from configuration
 * 2. Applies user-type multipliers (anonymous, authenticated, admin)
 * 3. Checks for bypass permissions (service accounts)
 * 4. Sets standard rate limit headers
 * 5. Returns 429 with Retry-After on limit exceeded
 *
 * @example
 * ```typescript
 * server.post('/api/v1/intents', {
 *   preHandler: comprehensiveRateLimit(),
 * }, handler);
 * ```
 */
export function comprehensiveRateLimit(options?: {
  /** Custom rate limit config (overrides default) */
  config?: Record<string, EndpointRateLimitConfig>;
  /** Custom multipliers (overrides default) */
  multipliers?: Partial<RateLimitMultipliers>;
  /** Skip rate limiting for certain conditions */
  skip?: (request: FastifyRequest) => boolean;
}): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const store = getUserRateLimitStore();
  const config = options?.config ?? rateLimitConfig;
  const multipliers = { ...defaultMultipliers, ...options?.multipliers };

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id ?? 'unknown';
    const traceContext = getTraceContext();

    // Check skip condition
    if (options?.skip?.(request)) {
      return;
    }

    // Find matching rate limit config
    const match = findRateLimitConfig(request.method, request.url);
    if (!match) {
      // No rate limit configured for this route
      return;
    }

    const { pattern, config: routeConfig } = match;

    // Extract user info
    const { userId, userType, tenantId, permissions } = extractUserInfo(request);

    // Check for bypass permission
    const canBypass = canBypassRateLimit(permissions);

    return tracer.startActiveSpan(
      'rateLimit.comprehensive',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'rateLimit.route': pattern,
          'rateLimit.userId': userId,
          'rateLimit.userType': userType,
          'rateLimit.canBypass': canBypass,
          'request.id': requestId,
          ...(traceContext && { 'trace.id': traceContext.traceId }),
        },
      },
      async (span) => {
        try {
          // If user can bypass, log it and allow
          if (canBypass) {
            span.setAttribute('rateLimit.bypassed', true);

            // Record bypass in audit log
            if (tenantId) {
              await recordRateLimitBypass(
                tenantId,
                userId,
                pattern,
                extractClientIp(request)
              );
            }

            logger.info(
              { userId, route: pattern, requestId },
              'Rate limit bypassed by service account'
            );

            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return;
          }

          // Calculate effective limit based on user type
          const effectiveLimit = calculateEffectiveLimit(
            routeConfig.max,
            userType,
            multipliers
          );

          // Check rate limit
          const result = store.check(
            userId,
            pattern,
            effectiveLimit,
            routeConfig.windowSeconds
          );

          span.setAttribute('rateLimit.limit', effectiveLimit);
          span.setAttribute('rateLimit.current', result.current);
          span.setAttribute('rateLimit.remaining', result.remaining);
          span.setAttribute('rateLimit.allowed', result.allowed);

          // Set rate limit headers
          setRateLimitHeaders(
            reply,
            result.limit,
            result.remaining,
            result.resetAt,
            result.allowed ? undefined : result.resetInSeconds
          );

          if (!result.allowed) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit exceeded' });
            span.end();

            logger.warn(
              {
                requestId,
                userId,
                userType,
                route: pattern,
                limit: effectiveLimit,
                current: result.current,
                retryAfter: result.resetInSeconds,
              },
              'Rate limit exceeded'
            );

            const response = createRateLimitErrorResponse(
              result.limit,
              result.remaining,
              result.resetAt,
              result.resetInSeconds,
              requestId
            );

            reply.status(429).send(response);
            return;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit check failed' });
          span.recordException(error as Error);
          span.end();

          logger.error({ error, requestId, userId }, 'Rate limit check failed');

          // Graceful degradation: allow request on error
          logger.warn({ requestId }, 'Rate limiter failed, allowing request (graceful degradation)');
        }
      }
    );
  };
}

/**
 * Create rate limit preHandler for a specific endpoint configuration
 *
 * @example
 * ```typescript
 * server.post('/custom-endpoint', {
 *   preHandler: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
 * }, handler);
 * ```
 */
export function createEndpointRateLimit(
  config: EndpointRateLimitConfig,
  options?: {
    /** Custom multipliers */
    multipliers?: Partial<RateLimitMultipliers>;
    /** Route pattern for tracking (defaults to request URL) */
    routePattern?: string;
  }
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const store = getUserRateLimitStore();
  const multipliers = { ...defaultMultipliers, ...options?.multipliers };

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id ?? 'unknown';
    const routePattern = options?.routePattern ?? `${request.method} ${request.routeOptions?.url ?? request.url}`;

    const { userId, userType, tenantId, permissions } = extractUserInfo(request);
    const canBypass = canBypassRateLimit(permissions);

    if (canBypass) {
      if (tenantId) {
        await recordRateLimitBypass(tenantId, userId, routePattern, extractClientIp(request));
      }
      return;
    }

    const effectiveLimit = calculateEffectiveLimit(config.max, userType, multipliers);
    const result = store.check(userId, routePattern, effectiveLimit, config.windowSeconds);

    setRateLimitHeaders(
      reply,
      result.limit,
      result.remaining,
      result.resetAt,
      result.allowed ? undefined : result.resetInSeconds
    );

    if (!result.allowed) {
      logger.warn(
        { requestId, userId, userType, route: routePattern, limit: effectiveLimit },
        'Rate limit exceeded'
      );

      reply.status(429).send(
        createRateLimitErrorResponse(
          result.limit,
          result.remaining,
          result.resetAt,
          result.resetInSeconds,
          requestId
        )
      );
    }
  };
}

// ============================================================================
// Rate Limit Status Endpoint Handler
// ============================================================================

/**
 * Get current user's rate limit status across all configured endpoints
 */
export async function getRateLimitStatus(
  request: FastifyRequest
): Promise<{
  user: {
    id: string;
    type: UserType;
    canBypass: boolean;
  };
  limits: RateLimitStatus[];
  storeStats: { activeKeys: number; maxSize: number };
}> {
  const { userId, userType, permissions } = extractUserInfo(request);
  const canBypass = canBypassRateLimit(permissions);
  const store = getUserRateLimitStore();

  const limits: RateLimitStatus[] = [];

  // Get current status for all configured routes
  for (const [pattern, config] of Object.entries(rateLimitConfig)) {
    const effectiveLimit = calculateEffectiveLimit(config.max, userType, defaultMultipliers);
    const status = store.peek(userId, pattern, effectiveLimit);

    if (status) {
      limits.push({
        route: pattern,
        limit: status.limit,
        remaining: status.remaining,
        resetAt: status.resetAt,
        resetInSeconds: status.resetInSeconds,
        userType,
        bypassed: canBypass,
      });
    } else {
      // No current window - show full limit
      limits.push({
        route: pattern,
        limit: effectiveLimit,
        remaining: effectiveLimit,
        resetAt: 0,
        resetInSeconds: 0,
        userType,
        bypassed: canBypass,
      });
    }
  }

  return {
    user: {
      id: userId,
      type: userType,
      canBypass,
    },
    limits,
    storeStats: store.getStats(),
  };
}

// ============================================================================
// Fastify Plugin
// ============================================================================

/**
 * Plugin options
 */
export interface RateLimitsPluginOptions {
  /** Skip rate limiting for certain paths */
  skipPaths?: string[];
  /** Custom rate limit config */
  config?: Record<string, EndpointRateLimitConfig>;
  /** Custom multipliers */
  multipliers?: Partial<RateLimitMultipliers>;
}

/**
 * Register comprehensive rate limits plugin
 *
 * This plugin:
 * 1. Adds global preHandler for route-specific rate limiting
 * 2. Decorates server with rate limit utilities
 * 3. Registers rate limit status endpoint
 *
 * @example
 * ```typescript
 * await server.register(rateLimitsPlugin, {
 *   skipPaths: ['/health', '/ready', '/metrics'],
 * });
 * ```
 */
const rateLimitsPluginAsync: FastifyPluginAsync<RateLimitsPluginOptions> = async (
  server: FastifyInstance,
  options: RateLimitsPluginOptions
) => {
  const skipPaths = new Set(options.skipPaths ?? ['/health', '/ready', '/metrics', '/docs']);

  const skip = (request: FastifyRequest): boolean => {
    // Skip health/metrics endpoints
    const normalizedUrl = request.url.split('?')[0] ?? request.url;
    if (skipPaths.has(normalizedUrl)) {
      return true;
    }

    // Skip GET requests (read-only)
    if (request.method === 'GET') {
      return true;
    }

    return false;
  };

  // Create the middleware
  const rateLimitMiddleware = comprehensiveRateLimit({
    config: options.config,
    multipliers: options.multipliers,
    skip,
  });

  // Decorate server with utilities
  server.decorate('vorionComprehensiveRateLimit', rateLimitMiddleware);
  server.decorate('vorionCreateEndpointRateLimit', createEndpointRateLimit);
  server.decorate('vorionGetRateLimitStatus', getRateLimitStatus);

  // Add global hook
  server.addHook('preHandler', rateLimitMiddleware);

  // Register rate limit status endpoint
  server.get('/rate-limits', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await getRateLimitStatus(request);
      return reply.send(status);
    } catch (error) {
      logger.error({ error }, 'Failed to get rate limit status');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve rate limit status',
        },
      });
    }
  });

  // Cleanup on server close
  server.addHook('onClose', async () => {
    resetUserRateLimitStore();
  });

  logger.info(
    {
      configuredRoutes: Object.keys(options.config ?? rateLimitConfig).length,
      skipPaths: Array.from(skipPaths),
    },
    'Comprehensive rate limits plugin registered'
  );
};

/**
 * Comprehensive Rate Limits Plugin
 */
export const rateLimitsPlugin = fp(rateLimitsPluginAsync, {
  name: 'vorion-rate-limits',
  fastify: '>=4.x',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    vorionComprehensiveRateLimit: ReturnType<typeof comprehensiveRateLimit>;
    vorionCreateEndpointRateLimit: typeof createEndpointRateLimit;
    vorionGetRateLimitStatus: typeof getRateLimitStatus;
  }
}

export default rateLimitsPlugin;
