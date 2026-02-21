/**
 * Context Propagation for Distributed Tracing
 *
 * Implements W3C Trace Context and B3 propagation formats for
 * cross-service trace correlation in the Vorion security platform.
 *
 * Supports:
 * - W3C Trace Context (traceparent, tracestate)
 * - B3 propagation (single and multi-header)
 * - HTTP header injection/extraction
 * - gRPC metadata propagation
 *
 * @packageDocumentation
 */

import {
  trace,
  context,
  propagation,
  type Context,
  type TextMapGetter,
  type TextMapSetter,
  type SpanContext,
  TraceFlags,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import {
  W3CTraceContextPropagator,
  CompositePropagator,
} from '@opentelemetry/core';
import { B3Propagator, B3InjectEncoding } from '@opentelemetry/propagator-b3';
import { createLogger } from '../logger.js';

const logger = createLogger({ component: 'telemetry-propagation' });

/**
 * HTTP headers carrier type
 */
export type HttpHeaders = Record<string, string | string[] | undefined>;

/**
 * gRPC metadata carrier type
 */
export type GrpcMetadata = Map<string, string | string[]>;

/**
 * Carrier type for context propagation
 */
export type PropagationCarrier = HttpHeaders | GrpcMetadata | Record<string, string>;

/**
 * Propagation format options
 */
export type PropagationFormat = 'w3c' | 'b3' | 'b3-multi' | 'composite';

/**
 * HTTP header getter for TextMapPropagator
 */
const httpHeaderGetter: TextMapGetter<HttpHeaders> = {
  keys(carrier: HttpHeaders): string[] {
    return Object.keys(carrier);
  },

  get(carrier: HttpHeaders, key: string): string | undefined {
    const value = carrier[key.toLowerCase()] ?? carrier[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  },
};

/**
 * HTTP header setter for TextMapPropagator
 */
const httpHeaderSetter: TextMapSetter<Record<string, string>> = {
  set(carrier: Record<string, string>, key: string, value: string): void {
    carrier[key] = value;
  },
};

/**
 * gRPC metadata getter for TextMapPropagator
 */
const grpcMetadataGetter: TextMapGetter<GrpcMetadata> = {
  keys(carrier: GrpcMetadata): string[] {
    return Array.from(carrier.keys());
  },

  get(carrier: GrpcMetadata, key: string): string | undefined {
    const value = carrier.get(key.toLowerCase()) ?? carrier.get(key);
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  },
};

/**
 * gRPC metadata setter for TextMapPropagator
 */
const grpcMetadataSetter: TextMapSetter<GrpcMetadata> = {
  set(carrier: GrpcMetadata, key: string, value: string): void {
    carrier.set(key, value);
  },
};

/**
 * Initialize propagation with specified format
 */
let propagatorInitialized = false;

export function initializePropagation(format: PropagationFormat = 'composite'): void {
  if (propagatorInitialized) {
    return;
  }

  let propagator;

  switch (format) {
    case 'w3c':
      propagator = new W3CTraceContextPropagator();
      break;

    case 'b3':
      propagator = new B3Propagator({
        injectEncoding: B3InjectEncoding.SINGLE_HEADER,
      });
      break;

    case 'b3-multi':
      propagator = new B3Propagator({
        injectEncoding: B3InjectEncoding.MULTI_HEADER,
      });
      break;

    case 'composite':
    default:
      // Support both W3C and B3 for maximum compatibility
      propagator = new CompositePropagator({
        propagators: [
          new W3CTraceContextPropagator(),
          new B3Propagator({
            injectEncoding: B3InjectEncoding.MULTI_HEADER,
          }),
        ],
      });
      break;
  }

  propagation.setGlobalPropagator(propagator);
  propagatorInitialized = true;

  logger.debug({ format }, 'Propagation initialized');
}

/**
 * Extract context from HTTP headers
 *
 * @param headers - HTTP headers containing trace context
 * @param parentContext - Parent context (default: ROOT_CONTEXT)
 * @returns Extracted context
 *
 * @example
 * ```typescript
 * // In a Fastify route handler
 * const ctx = extractContextFromHeaders(request.headers);
 * await context.with(ctx, async () => {
 *   await processRequest(request);
 * });
 * ```
 */
export function extractContextFromHeaders(
  headers: HttpHeaders,
  parentContext: Context = ROOT_CONTEXT
): Context {
  return propagation.extract(parentContext, headers, httpHeaderGetter);
}

/**
 * Inject context into HTTP headers
 *
 * @param headers - Headers object to inject into
 * @param ctx - Context to inject (default: active context)
 * @returns Headers with trace context injected
 *
 * @example
 * ```typescript
 * const headers = injectContextToHeaders({
 *   'Content-Type': 'application/json',
 * });
 * await fetch(url, { headers });
 * ```
 */
export function injectContextToHeaders(
  headers: Record<string, string> = {},
  ctx?: Context
): Record<string, string> {
  const contextToInject = ctx ?? context.active();
  propagation.inject(contextToInject, headers, httpHeaderSetter);
  return headers;
}

/**
 * Extract context from gRPC metadata
 *
 * @param metadata - gRPC metadata containing trace context
 * @param parentContext - Parent context (default: ROOT_CONTEXT)
 * @returns Extracted context
 */
export function extractContextFromGrpcMetadata(
  metadata: GrpcMetadata,
  parentContext: Context = ROOT_CONTEXT
): Context {
  return propagation.extract(parentContext, metadata, grpcMetadataGetter);
}

/**
 * Inject context into gRPC metadata
 *
 * @param metadata - Metadata object to inject into
 * @param ctx - Context to inject (default: active context)
 * @returns Metadata with trace context injected
 */
export function injectContextToGrpcMetadata(
  metadata: GrpcMetadata = new Map(),
  ctx?: Context
): GrpcMetadata {
  const contextToInject = ctx ?? context.active();
  propagation.inject(contextToInject, metadata, grpcMetadataSetter);
  return metadata;
}

/**
 * W3C Trace Context header names
 */
export const W3CHeaders = {
  TRACEPARENT: 'traceparent',
  TRACESTATE: 'tracestate',
} as const;

/**
 * B3 header names (single header format)
 */
export const B3SingleHeader = {
  B3: 'b3',
} as const;

/**
 * B3 header names (multi-header format)
 */
export const B3MultiHeaders = {
  TRACE_ID: 'x-b3-traceid',
  SPAN_ID: 'x-b3-spanid',
  PARENT_SPAN_ID: 'x-b3-parentspanid',
  SAMPLED: 'x-b3-sampled',
  FLAGS: 'x-b3-flags',
} as const;

/**
 * Parse W3C traceparent header
 *
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceparent(header: string): SpanContext | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  const parts = header.trim().split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, traceFlags] = parts;

  // Validate version
  if (version !== '00') {
    return null;
  }

  // Validate trace ID (32 hex characters, not all zeros)
  if (!/^[0-9a-f]{32}$/i.test(traceId) || traceId === '0'.repeat(32)) {
    return null;
  }

  // Validate span ID (16 hex characters, not all zeros)
  if (!/^[0-9a-f]{16}$/i.test(spanId) || spanId === '0'.repeat(16)) {
    return null;
  }

  // Validate trace flags (2 hex characters)
  if (!/^[0-9a-f]{2}$/i.test(traceFlags)) {
    return null;
  }

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: parseInt(traceFlags, 16),
    isRemote: true,
  };
}

/**
 * Build W3C traceparent header
 *
 * @param traceId - 32 character hex trace ID
 * @param spanId - 16 character hex span ID
 * @param sampled - Whether the trace is sampled
 * @returns Traceparent header value
 */
export function buildTraceparent(
  traceId: string,
  spanId: string,
  sampled: boolean = true
): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Parse B3 single header
 *
 * Format: {TraceId}-{SpanId}-{SamplingState}-{ParentSpanId}
 * or: {TraceId}-{SpanId}-{SamplingState}
 */
export function parseB3SingleHeader(header: string): SpanContext | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  const parts = header.trim().split('-');
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const [traceId, spanId, samplingState] = parts;

  // Validate trace ID (16 or 32 hex characters)
  if (!/^[0-9a-f]{16}$|^[0-9a-f]{32}$/i.test(traceId)) {
    return null;
  }

  // Validate span ID (16 hex characters)
  if (!/^[0-9a-f]{16}$/i.test(spanId)) {
    return null;
  }

  // Parse sampling state
  const sampled = samplingState === '1' || samplingState === 'd';

  // Pad trace ID to 32 characters if needed
  const fullTraceId = traceId.length === 16 ? '0'.repeat(16) + traceId : traceId;

  return {
    traceId: fullTraceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}

/**
 * Build B3 single header
 *
 * @param traceId - Trace ID
 * @param spanId - Span ID
 * @param sampled - Whether the trace is sampled
 * @param parentSpanId - Optional parent span ID
 * @returns B3 header value
 */
export function buildB3SingleHeader(
  traceId: string,
  spanId: string,
  sampled: boolean = true,
  parentSpanId?: string
): string {
  const samplingState = sampled ? '1' : '0';
  const base = `${traceId}-${spanId}-${samplingState}`;
  return parentSpanId ? `${base}-${parentSpanId}` : base;
}

/**
 * Get trace context from active span
 *
 * @returns Trace context object or null if no active span
 */
export function getTraceContext(): {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  traceparent: string;
} | null {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return null;
  }

  const spanContext = activeSpan.spanContext();
  const parentSpanContext = trace
    .getSpan(context.active())
    ?.spanContext();

  const sampled = (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0;

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    parentSpanId:
      parentSpanContext && parentSpanContext.spanId !== spanContext.spanId
        ? parentSpanContext.spanId
        : undefined,
    sampled,
    traceparent: buildTraceparent(spanContext.traceId, spanContext.spanId, sampled),
  };
}

/**
 * Create a context with a remote span context
 *
 * @param spanContext - Remote span context
 * @param parentContext - Parent context (default: ROOT_CONTEXT)
 * @returns Context with remote span
 */
export function createContextWithRemoteSpan(
  spanContext: SpanContext,
  parentContext: Context = ROOT_CONTEXT
): Context {
  return trace.setSpanContext(parentContext, spanContext);
}

/**
 * Propagation context for queue jobs
 */
export interface QueuePropagationContext {
  traceparent: string;
  tracestate?: string;
  b3?: string;
}

/**
 * Extract propagation context for queue job serialization
 *
 * @returns Propagation context or null if no active span
 */
export function extractQueuePropagationContext(): QueuePropagationContext | null {
  const traceCtx = getTraceContext();
  if (!traceCtx) {
    return null;
  }

  return {
    traceparent: traceCtx.traceparent,
    b3: buildB3SingleHeader(traceCtx.traceId, traceCtx.spanId, traceCtx.sampled),
  };
}

/**
 * Inject propagation context into queue job data
 *
 * @param data - Job data object
 * @returns Job data with propagation context
 */
export function injectPropagationToJobData<T extends Record<string, unknown>>(
  data: T
): T & { _propagation?: QueuePropagationContext } {
  const ctx = extractQueuePropagationContext();
  if (!ctx) {
    return data;
  }

  return {
    ...data,
    _propagation: ctx,
  };
}

/**
 * Extract context from queue job data
 *
 * @param data - Job data object
 * @returns Context or ROOT_CONTEXT if no propagation data
 */
export function extractContextFromJobData(
  data: Record<string, unknown>
): Context {
  const propagationData = data['_propagation'] as QueuePropagationContext | undefined;
  if (!propagationData?.traceparent) {
    return ROOT_CONTEXT;
  }

  const headers: HttpHeaders = {
    [W3CHeaders.TRACEPARENT]: propagationData.traceparent,
  };

  if (propagationData.tracestate) {
    headers[W3CHeaders.TRACESTATE] = propagationData.tracestate;
  }

  if (propagationData.b3) {
    headers[B3SingleHeader.B3] = propagationData.b3;
  }

  return extractContextFromHeaders(headers);
}

/**
 * Run a function with context from job data
 *
 * @param data - Job data containing propagation context
 * @param fn - Function to run within the context
 * @returns Result of the function
 */
export async function runWithJobContext<T>(
  data: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const ctx = extractContextFromJobData(data);
  return context.with(ctx, fn);
}

/**
 * HTTP client request configuration with trace context
 */
export interface TracedRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * Add trace context to HTTP request configuration
 *
 * @param config - Request configuration
 * @returns Configuration with trace headers
 */
export function addTraceToRequest(config: TracedRequestConfig): TracedRequestConfig {
  return {
    ...config,
    headers: injectContextToHeaders(config.headers),
  };
}

/**
 * Vorion-specific baggage keys for context propagation
 */
export const VorionBaggageKeys = {
  TENANT_ID: 'vorion.tenant.id',
  ENTITY_ID: 'vorion.entity.id',
  INTENT_ID: 'vorion.intent.id',
  SECURITY_CONTEXT: 'vorion.security.context',
  REQUEST_ID: 'vorion.request.id',
} as const;
