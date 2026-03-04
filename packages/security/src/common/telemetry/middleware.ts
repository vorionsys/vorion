/**
 * Fastify Tracing Middleware
 *
 * Request tracing middleware for Fastify that provides:
 * - Automatic span creation for HTTP requests
 * - Trace ID injection in response headers
 * - Error span recording
 * - Security context propagation
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
  FastifyPluginOptions,
} from 'fastify';
import fp from 'fastify-plugin';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Context,
  type Attributes,
} from '@opentelemetry/api';
import { createLogger } from '../logger.js';
import { getTracer, VorionTracers } from './tracer.js';
import { VorionSpanAttributes } from './spans.js';
import {
  extractContextFromHeaders,
  injectContextToHeaders,
  getTraceContext,
} from './propagation.js';

const logger = createLogger({ component: 'telemetry-middleware' });

/**
 * Tracing middleware configuration options
 */
export interface TracingMiddlewareOptions {
  /** Enable tracing (default: true) */
  enabled?: boolean;
  /** Paths to exclude from tracing */
  excludePaths?: string[];
  /** Include request body in span (default: false, security risk) */
  includeRequestBody?: boolean;
  /** Include response body in span (default: false) */
  includeResponseBody?: boolean;
  /** Maximum body size to include (bytes) */
  maxBodySize?: number;
  /** Add trace headers to response */
  addResponseHeaders?: boolean;
  /** Custom request hook */
  requestHook?: (span: Span, request: FastifyRequest) => void;
  /** Custom response hook */
  responseHook?: (span: Span, request: FastifyRequest, reply: FastifyReply) => void;
  /** Trace context extractor */
  traceContextExtractor?: (request: FastifyRequest) => TracingSecurityContext | null;
}

/**
 * Security context for tracing (separate from Fastify's securityContext)
 */
export interface TracingSecurityContext {
  tenantId?: string;
  entityId?: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  sessionId?: string;
  apiKeyId?: string;
}

/**
 * Extended Fastify request with tracing context
 */
export interface TracedFastifyRequest extends FastifyRequest {
  /** Active tracing span */
  span?: Span;
  /** OpenTelemetry context for tracing (different from request's traceContext) */
  otelContext?: Context;
  /** Trace ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
  /** Tracing security context (separate from FastifyRequest.securityContext) */
  tracingSecurityContext?: TracingSecurityContext;
}

/**
 * Default paths to exclude from tracing
 */
const DEFAULT_EXCLUDE_PATHS = [
  '/health',
  '/ready',
  '/metrics',
  '/favicon.ico',
  '/.well-known',
];

/**
 * Get span name from request
 */
function getSpanName(request: FastifyRequest): string {
  // Use route pattern if available
  const routePattern = (request as FastifyRequest & { routeOptions?: { url?: string } })
    .routeOptions?.url;

  if (routePattern) {
    return `${request.method} ${routePattern}`;
  }

  // Fall back to URL path
  return `${request.method} ${request.url.split('?')[0]}`;
}

/**
 * Get HTTP attributes for span
 */
function getHttpAttributes(
  request: FastifyRequest,
  reply?: FastifyReply
): Attributes {
  const attributes: Attributes = {
    'http.method': request.method,
    'http.url': request.url,
    'http.target': request.url,
    'http.host': request.hostname,
    'http.scheme': request.protocol,
    'http.user_agent': request.headers['user-agent'] ?? 'unknown',
    'net.peer.ip': request.ip,
  };

  // Add route pattern if available
  const routePattern = (request as FastifyRequest & { routeOptions?: { url?: string } })
    .routeOptions?.url;
  if (routePattern) {
    attributes['http.route'] = routePattern;
  }

  // Add response attributes
  if (reply) {
    attributes['http.status_code'] = reply.statusCode;
  }

  // Add request ID
  const requestId = request.headers['x-request-id'];
  if (requestId) {
    attributes['http.request_id'] = Array.isArray(requestId)
      ? requestId[0]
      : requestId;
  }

  return attributes;
}

/**
 * Default security context extractor
 */
function defaultTracingSecurityContextExtractor(
  request: FastifyRequest
): TracingSecurityContext | null {
  // Try to extract from JWT user
  const user = (request as FastifyRequest & { user?: Record<string, unknown> }).user;

  if (user) {
    return {
      tenantId: user.tenantId as string | undefined,
      entityId: user.entityId as string | undefined,
      userId: user.sub as string | undefined,
      roles: user.roles as string[] | undefined,
      sessionId: user.sid as string | undefined,
    };
  }

  // Try to extract from headers
  const tenantId = request.headers['x-tenant-id'];
  if (tenantId) {
    return {
      tenantId: Array.isArray(tenantId) ? tenantId[0] : tenantId,
    };
  }

  return null;
}

/**
 * Tracing middleware plugin
 */
const tracingMiddlewarePlugin: FastifyPluginCallback<TracingMiddlewareOptions> = (
  fastify: FastifyInstance,
  options: TracingMiddlewareOptions,
  done: (err?: Error) => void
) => {
  // Skip if disabled
  if (options.enabled === false) {
    logger.info('Tracing middleware disabled');
    done();
    return;
  }

  const excludePaths = options.excludePaths ?? DEFAULT_EXCLUDE_PATHS;
  const addResponseHeaders = options.addResponseHeaders !== false;
  const traceContextExtractor =
    options.traceContextExtractor ?? defaultTracingSecurityContextExtractor;

  const tracer = getTracer(VorionTracers.API);

  // Track active spans by request
  const activeSpans = new WeakMap<FastifyRequest, Span>();

  // onRequest hook - create span
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip excluded paths
    const urlPath = request.url.split('?')[0];
    if (excludePaths.some((path) => urlPath.startsWith(path))) {
      return;
    }

    // Extract parent context from headers
    const parentContext = extractContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );

    // Create span
    const spanName = getSpanName(request);
    const span = tracer.startSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: getHttpAttributes(request),
      },
      parentContext
    );

    // Store span on request
    activeSpans.set(request, span);

    // Set trace context
    const tracedRequest = request as TracedFastifyRequest;
    tracedRequest.span = span;
    tracedRequest.otelContext = trace.setSpan(parentContext, span);

    // Get span context
    const spanContext = span.spanContext();
    tracedRequest.traceId = spanContext.traceId;
    tracedRequest.spanId = spanContext.spanId;

    // Add trace headers to response
    if (addResponseHeaders) {
      reply.header('X-Trace-ID', spanContext.traceId);
      reply.header('X-Span-ID', spanContext.spanId);
    }

    // Call custom request hook
    options.requestHook?.(span, request);
  });

  // preHandler hook - extract security context
  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const span = activeSpans.get(request);
      if (!span) {
        return;
      }

      // Extract tracing security context
      const tracingCtx = traceContextExtractor(request);
      if (tracingCtx) {
        const tracedRequest = request as TracedFastifyRequest;
        tracedRequest.tracingSecurityContext = tracingCtx;

        // Add security attributes to span
        if (tracingCtx.tenantId) {
          span.setAttribute(VorionSpanAttributes.TENANT_ID, tracingCtx.tenantId);
        }
        if (tracingCtx.entityId) {
          span.setAttribute(VorionSpanAttributes.ENTITY_ID, tracingCtx.entityId);
        }
        if (tracingCtx.userId) {
          span.setAttribute('user.id', tracingCtx.userId);
        }
        if (tracingCtx.roles?.length) {
          span.setAttribute('user.roles', tracingCtx.roles.join(','));
        }
        if (tracingCtx.sessionId) {
          span.setAttribute('session.id', tracingCtx.sessionId);
        }
        if (tracingCtx.apiKeyId) {
          span.setAttribute('api_key.id', tracingCtx.apiKeyId);
        }
      }
    }
  );

  // onResponse hook - end span
  fastify.addHook(
    'onResponse',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const span = activeSpans.get(request);
      if (!span) {
        return;
      }

      // Add response attributes
      span.setAttributes({
        'http.status_code': reply.statusCode,
        'http.response_content_length':
          reply.getHeader('content-length') ?? 0,
      });

      // Set span status based on HTTP status
      if (reply.statusCode >= 500) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${reply.statusCode}`,
        });
      } else if (reply.statusCode >= 400) {
        // Client errors are not span errors
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // Call custom response hook
      options.responseHook?.(span, request, reply);

      // End span
      span.end();
      activeSpans.delete(request);
    }
  );

  // onError hook - record error
  fastify.addHook(
    'onError',
    async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
      const span = activeSpans.get(request);
      if (!span) {
        return;
      }

      // Record exception
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });

      // Add error attributes
      span.setAttributes({
        'error': true,
        'error.type': error.name,
        'error.message': error.message,
      });
    }
  );

  // Decorate Fastify with tracing utilities
  fastify.decorate('getActiveSpan', () => {
    return trace.getActiveSpan();
  });

  fastify.decorate('getTraceContext', () => {
    return getTraceContext();
  });

  fastify.decorate('injectTraceHeaders', (headers: Record<string, string>) => {
    return injectContextToHeaders(headers);
  });

  logger.info(
    { excludePaths, addResponseHeaders },
    'Tracing middleware registered'
  );

  done();
};

/**
 * Fastify tracing plugin
 */
export const tracingMiddleware = fp(tracingMiddlewarePlugin, {
  name: 'vorion-tracing',
  fastify: '>=4.x',
});

/**
 * Create request-scoped tracing context
 *
 * Run async operations within the request's trace context
 */
export function runInRequestContext<T>(
  request: FastifyRequest,
  fn: () => T
): T {
  const tracedRequest = request as TracedFastifyRequest;
  if (!tracedRequest.otelContext) {
    return fn();
  }

  return context.with(tracedRequest.otelContext, fn);
}

/**
 * Create a child span for the current request
 */
export function createRequestChildSpan(
  request: FastifyRequest,
  name: string,
  attributes?: Attributes
): Span {
  const tracedRequest = request as TracedFastifyRequest;
  const tracer = getTracer(VorionTracers.API);

  return tracer.startSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      attributes,
    },
    tracedRequest.otelContext
  );
}

/**
 * Execute a function within a child span of the request
 */
export async function withRequestSpan<T>(
  request: FastifyRequest,
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  const tracedRequest = request as TracedFastifyRequest;
  const tracer = getTracer(VorionTracers.API);
  const ctx = tracedRequest.otelContext ?? context.active();

  return tracer.startActiveSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      attributes,
    },
    ctx,
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Add attributes to the request's span
 */
export function addRequestSpanAttributes(
  request: FastifyRequest,
  attributes: Attributes
): void {
  const tracedRequest = request as TracedFastifyRequest;
  tracedRequest.span?.setAttributes(attributes);
}

/**
 * Add an event to the request's span
 */
export function addRequestSpanEvent(
  request: FastifyRequest,
  name: string,
  attributes?: Attributes
): void {
  const tracedRequest = request as TracedFastifyRequest;
  tracedRequest.span?.addEvent(name, attributes);
}

/**
 * Record an error on the request's span
 */
export function recordRequestError(
  request: FastifyRequest,
  error: Error,
  attributes?: Attributes
): void {
  const tracedRequest = request as TracedFastifyRequest;
  if (!tracedRequest.span) {
    return;
  }

  tracedRequest.span.recordException(error);
  tracedRequest.span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });

  // Add additional context as event if provided
  if (attributes) {
    tracedRequest.span.addEvent('error.context', attributes);
  }
}

/**
 * Get trace ID from request
 */
export function getRequestTraceId(request: FastifyRequest): string | undefined {
  return (request as TracedFastifyRequest).traceId;
}

/**
 * Get span ID from request
 */
export function getRequestSpanId(request: FastifyRequest): string | undefined {
  return (request as TracedFastifyRequest).spanId;
}

/**
 * Get tracing security context from request
 */
export function getRequestTracingSecurityContext(
  request: FastifyRequest
): TracingSecurityContext | undefined {
  return (request as TracedFastifyRequest).tracingSecurityContext;
}

// =============================================================================
// Fastify type augmentations
// =============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    getActiveSpan: () => Span | undefined;
    getTraceContext: () => ReturnType<typeof getTraceContext>;
    injectTraceHeaders: (headers: Record<string, string>) => Record<string, string>;
  }
}
