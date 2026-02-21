/**
 * OpenTelemetry Distributed Tracing Module
 *
 * Comprehensive tracing infrastructure for the Vorion security platform.
 *
 * Features:
 * - SDK initialization with configurable exporters (OTLP/Jaeger)
 * - Sampling strategies (always, probability, rate-limiting, security-aware)
 * - Span utilities with automatic context propagation
 * - W3C Trace Context and B3 propagation support
 * - Auto-instrumentation for HTTP, Redis, PostgreSQL
 * - Custom instrumentation for security operations
 * - Fastify middleware for request tracing
 * - Prometheus metrics bridge for observability correlation
 *
 * @example
 * ```typescript
 * import {
 *   initializeTracer,
 *   withSpan,
 *   getIntentTracer,
 *   tracingMiddleware,
 * } from '@/common/telemetry';
 *
 * // Initialize tracer at application startup
 * initializeTracer({
 *   serviceName: 'vorion-api',
 *   environment: 'production',
 *   samplingStrategy: 'probability',
 *   samplingRate: 0.1,
 * });
 *
 * // Register Fastify middleware
 * await fastify.register(tracingMiddleware);
 *
 * // Use span utilities
 * const result = await withSpan(
 *   getIntentTracer(),
 *   'process-intent',
 *   async (span) => {
 *     span.setAttribute('intent.id', intentId);
 *     return await processIntent(intent);
 *   }
 * );
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Tracer Configuration
// =============================================================================

export {
  // Initialization
  initializeTracer,
  shutdownTracer,
  isTracerInitialized,
  getDefaultTelemetryConfig,
  // Tracer getters
  getTracer,
  getTracerProvider,
  getIntentTracer,
  getPolicyTracer,
  getSecurityTracer,
  getApiTracer,
  // Tracer names
  VorionTracers,
  // Samplers
  RateLimitingSampler,
  SecurityAwareSampler,
  // Types
  type TelemetryConfig,
  type SamplingStrategy,
} from './tracer.js';

// =============================================================================
// Span Utilities
// =============================================================================

export {
  // Span creation
  createSpan,
  withSpan,
  withSpanSync,
  // Attributes
  addSpanAttributes,
  addSpanAttribute,
  // Error recording
  recordException,
  // Events
  addSpanEvent,
  // Links
  createSpanLink,
  createSpanLinks,
  // Context
  getActiveSpan,
  getSpanContext,
  runWithContext,
  getActiveContext,
  // Vorion-specific helpers
  withIntentSpan,
  withSecuritySpan,
  withPolicySpan,
  withDatabaseSpan,
  withCacheSpan,
  // Constants
  VorionSpanAttributes,
  VorionSpanEvents,
  // Types
  type CreateSpanOptions,
} from './spans.js';

// =============================================================================
// Context Propagation
// =============================================================================

export {
  // Initialization
  initializePropagation,
  // HTTP propagation
  extractContextFromHeaders,
  injectContextToHeaders,
  // gRPC propagation
  extractContextFromGrpcMetadata,
  injectContextToGrpcMetadata,
  // W3C Trace Context
  parseTraceparent,
  buildTraceparent,
  W3CHeaders,
  // B3 propagation
  parseB3SingleHeader,
  buildB3SingleHeader,
  B3SingleHeader,
  B3MultiHeaders,
  // Context utilities
  getTraceContext,
  createContextWithRemoteSpan,
  // Queue propagation
  extractQueuePropagationContext,
  injectPropagationToJobData,
  extractContextFromJobData,
  runWithJobContext,
  // HTTP client helpers
  addTraceToRequest,
  // Baggage keys
  VorionBaggageKeys,
  // Types
  type HttpHeaders,
  type GrpcMetadata,
  type PropagationCarrier,
  type PropagationFormat,
  type QueuePropagationContext,
  type TracedRequestConfig,
} from './propagation.js';

// =============================================================================
// Auto-Instrumentation
// =============================================================================

export {
  // Instrumentation getters
  getInstrumentations,
  getNodeInstrumentations,
  // Security operation instrumentation
  instrumentSecurityOperation,
  instrumentAuth,
  instrumentAuthz,
  instrumentPolicyEval,
  instrumentTrustEval,
  instrumentEscalation,
  instrumentTokenValidation,
  instrumentMfaVerification,
  // Security event recording
  recordSecurityEvent,
  recordAuthSuccess,
  recordAuthFailure,
  recordPolicyDenial,
  recordSecurityViolation,
  // Database instrumentation
  instrumentDbQuery,
  instrumentCacheOp,
  // Queue instrumentation
  instrumentQueueProduce,
  instrumentQueueConsume,
  // Types
  type InstrumentationConfig,
  type HttpInstrumentationConfig,
  type FastifyInstrumentationConfig,
  type RedisInstrumentationConfig,
  type PostgresInstrumentationConfig,
  type SecurityOperationType,
  type SecurityOperationContext,
} from './instrumentation.js';

// =============================================================================
// Fastify Middleware
// =============================================================================

export {
  // Plugin
  tracingMiddleware,
  // Request utilities
  runInRequestContext,
  createRequestChildSpan,
  withRequestSpan,
  addRequestSpanAttributes,
  addRequestSpanEvent,
  recordRequestError,
  // Request getters
  getRequestTraceId,
  getRequestSpanId,
  getRequestTracingSecurityContext,
  // Types
  type TracingMiddlewareOptions,
  type TracingSecurityContext,
  type TracedFastifyRequest,
} from './middleware.js';

// =============================================================================
// Metrics Bridge
// =============================================================================

export {
  // Initialization
  initializeMetricsBridge,
  // Span metrics recording
  recordSpanMetrics,
  recordSpanError,
  recordIntentSpanMetrics,
  recordPolicySpanMetrics,
  recordSecuritySpanMetrics,
  recordDbSpanMetrics,
  recordCacheSpanMetrics,
  recordHttpSpanMetrics,
  // Event recording
  recordSecurityEvent as recordSecurityEventMetric,
  recordPolicyDecision,
  recordTrustEvaluation,
  // Active span tracking
  incrementActiveSpans,
  decrementActiveSpans,
  incrementActiveHttpRequests,
  decrementActiveHttpRequests,
  // Bridge processing
  processSpanForMetrics,
  getTraceMetrics,
  // Histograms
  spanDurationHistogram,
  intentSpanDuration,
  policySpanDuration,
  securitySpanDuration,
  dbSpanDuration,
  cacheSpanDuration,
  httpSpanDuration,
  // Counters
  spanCounter,
  spanErrorCounter,
  securityEventCounter,
  policyDecisionCounter,
  trustEvalCounter,
  // Gauges
  activeSpansGauge,
  activeHttpRequests,
  // Types
  type SpanMetricLabels,
  type SpanEndData,
} from './metrics-bridge.js';

// =============================================================================
// Convenience Functions
// =============================================================================

import { initializeTracer, type TelemetryConfig } from './tracer.js';
import { initializePropagation, type PropagationFormat } from './propagation.js';
import { initializeMetricsBridge } from './metrics-bridge.js';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger({ component: 'telemetry' });

/**
 * Initialize all telemetry components
 *
 * Convenience function that initializes the tracer, propagation,
 * and metrics bridge in one call.
 *
 * @param config - Optional telemetry configuration overrides
 * @param propagationFormat - Propagation format (default: composite)
 *
 * @example
 * ```typescript
 * await initializeTelemetry({
 *   samplingRate: 0.1,
 *   enableConsoleExporter: false,
 * });
 * ```
 */
export function initializeTelemetry(
  config?: Partial<TelemetryConfig>,
  propagationFormat: PropagationFormat = 'composite'
): void {
  const appConfig = getConfig();

  if (!appConfig.telemetry.enabled) {
    logger.info('Telemetry disabled by configuration');
    return;
  }

  // Initialize tracer
  initializeTracer(config);

  // Initialize propagation
  initializePropagation(propagationFormat);

  // Initialize metrics bridge
  initializeMetricsBridge();

  logger.info('All telemetry components initialized');
}

/**
 * Shutdown all telemetry components
 *
 * Should be called during application shutdown to ensure
 * all pending traces are exported.
 */
export async function shutdownTelemetry(): Promise<void> {
  const { shutdownTracer } = await import('./tracer.js');
  await shutdownTracer();
  logger.info('Telemetry shutdown complete');
}
