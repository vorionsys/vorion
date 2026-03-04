/**
 * API Metrics Middleware
 *
 * Fastify plugin for collecting API request metrics including:
 * - Request duration
 * - Request/response sizes
 * - Error rates
 * - Active requests tracking
 *
 * @packageDocumentation
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  apiRequestDurationSeconds,
  apiRequestsTotal,
  apiRequestSizeBytes,
  apiResponseSizeBytes,
  apiActiveRequestsGauge,
  apiErrorsTotal,
  requestLatencyPercentiles,
  recordApiRequestMetric,
} from '../../common/metrics.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'api-metrics' });

/**
 * Configuration options for the metrics middleware
 */
export interface MetricsMiddlewareOptions {
  /** Routes to exclude from metrics collection (e.g., /health, /metrics) */
  excludeRoutes?: string[];
  /** Whether to collect request body size metrics */
  collectRequestSize?: boolean;
  /** Whether to collect response body size metrics */
  collectResponseSize?: boolean;
  /** Custom route normalizer function to reduce cardinality */
  normalizeRoute?: (request: FastifyRequest) => string;
}

const DEFAULT_EXCLUDE_ROUTES = ['/health', '/ready', '/live', '/metrics'];

/**
 * Normalize a route URL to reduce metric cardinality
 * Replaces UUID and numeric path parameters with placeholders
 */
function defaultNormalizeRoute(request: FastifyRequest): string {
  // Use the route schema URL if available (pre-defined route pattern)
  const routeSchema = request.routeOptions?.url;
  if (routeSchema) {
    return routeSchema;
  }

  // Fallback: normalize the actual URL
  let url = request.url.split('?')[0] || request.url;

  // Replace UUIDs with :id placeholder
  url = url.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id'
  );

  // Replace numeric IDs with :id placeholder
  url = url.replace(/\/\d+(?=\/|$)/g, '/:id');

  return url;
}

/**
 * Fastify plugin for API metrics collection
 */
async function metricsMiddlewarePlugin(
  fastify: FastifyInstance,
  options: MetricsMiddlewareOptions
): Promise<void> {
  const excludeRoutes = new Set([
    ...DEFAULT_EXCLUDE_ROUTES,
    ...(options.excludeRoutes ?? []),
  ]);
  const collectRequestSize = options.collectRequestSize ?? true;
  const collectResponseSize = options.collectResponseSize ?? true;
  const normalizeRoute = options.normalizeRoute ?? defaultNormalizeRoute;

  // Track request start time and active requests
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const route = normalizeRoute(request);

    // Skip excluded routes
    if (excludeRoutes.has(route)) {
      return;
    }

    // Store start time for duration calculation
    (request as unknown as { metricsStartTime: bigint }).metricsStartTime = process.hrtime.bigint();

    // Increment active requests
    apiActiveRequestsGauge.inc({ method: request.method, route });

    // Record request size if available and enabled
    if (collectRequestSize && request.headers['content-length']) {
      const requestSize = parseInt(request.headers['content-length'], 10);
      if (!isNaN(requestSize)) {
        apiRequestSizeBytes.observe({ method: request.method, route }, requestSize);
      }
    }
  });

  // Record metrics on response
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const route = normalizeRoute(request);

    // Skip excluded routes
    if (excludeRoutes.has(route)) {
      return;
    }

    const startTime = (request as unknown as { metricsStartTime?: bigint }).metricsStartTime;
    if (!startTime) {
      return;
    }

    // Calculate duration in seconds
    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    const durationSeconds = durationNs / 1e9;

    const method = request.method;
    const statusCode = reply.statusCode.toString();

    // Record request metrics
    const labels = { method, route, status_code: statusCode };
    apiRequestsTotal.inc(labels);
    apiRequestDurationSeconds.observe(labels, durationSeconds);
    requestLatencyPercentiles.observe({ service: 'api' }, durationSeconds);

    // Decrement active requests
    apiActiveRequestsGauge.dec({ method, route });

    // Record response size if available and enabled
    if (collectResponseSize) {
      const responseSize = reply.getHeader('content-length');
      if (responseSize) {
        const size = typeof responseSize === 'string' ? parseInt(responseSize, 10) : responseSize;
        if (typeof size === 'number' && !isNaN(size)) {
          apiResponseSizeBytes.observe(labels, size);
        }
      }
    }

    // Log slow requests for debugging
    if (durationSeconds > 5) {
      logger.warn(
        {
          method,
          route,
          statusCode,
          durationMs: Math.round(durationSeconds * 1000),
        },
        'Slow API request detected'
      );
    }
  });

  // Record errors
  fastify.addHook('onError', async (request: FastifyRequest, reply: FastifyReply, error: Error) => {
    const route = normalizeRoute(request);

    // Skip excluded routes
    if (excludeRoutes.has(route)) {
      return;
    }

    const errorCode = (error as { code?: string }).code ?? 'UNKNOWN';
    const errorType = error.name ?? 'Error';

    apiErrorsTotal.inc({
      method: request.method,
      route,
      error_code: errorCode,
      error_type: errorType,
    });
  });

  logger.info(
    { excludeRoutes: Array.from(excludeRoutes) },
    'API metrics middleware initialized'
  );
}

/**
 * Export as Fastify plugin
 */
export const metricsMiddleware = fp(metricsMiddlewarePlugin, {
  name: 'vorion-api-metrics',
  fastify: '>=4.x',
});

/**
 * Create metrics tracking timer for manual instrumentation
 */
export function createApiTimer(
  method: string,
  route: string
): { stop: (statusCode: number) => void } {
  const startTime = process.hrtime.bigint();
  apiActiveRequestsGauge.inc({ method, route });

  return {
    stop: (statusCode: number) => {
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);
      const durationSeconds = durationNs / 1e9;

      recordApiRequestMetric(method, route, statusCode, durationSeconds);
      apiActiveRequestsGauge.dec({ method, route });
    },
  };
}
