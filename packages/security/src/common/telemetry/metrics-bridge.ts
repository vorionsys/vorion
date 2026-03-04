/**
 * Metrics Bridge for OpenTelemetry Traces
 *
 * Bridges trace data to Prometheus metrics for observability correlation.
 * Exports span duration histograms, error rates, and operation counts.
 *
 * @packageDocumentation
 */

import {
  Counter,
  Histogram,
  Gauge,
  Registry,
} from 'prom-client';
import { vorionRegistry } from '../metrics-registry.js';
import { createLogger } from '../logger.js';

const logger = createLogger({ component: 'telemetry-metrics-bridge' });

// =============================================================================
// Span Duration Histograms
// =============================================================================

/**
 * Histogram buckets for span durations (milliseconds)
 * Covers range from 1ms to 30s with exponential distribution
 */
const DURATION_BUCKETS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
];

/**
 * Span duration histogram for all operations
 */
export const spanDurationHistogram = new Histogram({
  name: 'vorion_trace_span_duration_ms',
  help: 'Duration of traced spans in milliseconds',
  labelNames: ['service', 'operation', 'span_kind', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

/**
 * Intent processing span duration
 */
export const intentSpanDuration = new Histogram({
  name: 'vorion_trace_intent_span_duration_ms',
  help: 'Duration of intent processing spans in milliseconds',
  labelNames: ['operation', 'intent_type', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

/**
 * Policy evaluation span duration
 */
export const policySpanDuration = new Histogram({
  name: 'vorion_trace_policy_span_duration_ms',
  help: 'Duration of policy evaluation spans in milliseconds',
  labelNames: ['namespace', 'action', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

/**
 * Security operation span duration
 */
export const securitySpanDuration = new Histogram({
  name: 'vorion_trace_security_span_duration_ms',
  help: 'Duration of security operation spans in milliseconds',
  labelNames: ['operation_type', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

/**
 * Database operation span duration
 */
export const dbSpanDuration = new Histogram({
  name: 'vorion_trace_db_span_duration_ms',
  help: 'Duration of database operation spans in milliseconds',
  labelNames: ['operation', 'table', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

/**
 * Cache operation span duration
 */
export const cacheSpanDuration = new Histogram({
  name: 'vorion_trace_cache_span_duration_ms',
  help: 'Duration of cache operation spans in milliseconds',
  labelNames: ['operation', 'hit', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
  registers: [vorionRegistry],
});

/**
 * HTTP request span duration
 */
export const httpSpanDuration = new Histogram({
  name: 'vorion_trace_http_span_duration_ms',
  help: 'Duration of HTTP request spans in milliseconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: DURATION_BUCKETS,
  registers: [vorionRegistry],
});

// =============================================================================
// Error Rate Counters
// =============================================================================

/**
 * Total span count by operation
 */
export const spanCounter = new Counter({
  name: 'vorion_trace_spans_total',
  help: 'Total number of traced spans',
  labelNames: ['service', 'operation', 'span_kind', 'status'] as const,
  registers: [vorionRegistry],
});

/**
 * Span error counter
 */
export const spanErrorCounter = new Counter({
  name: 'vorion_trace_span_errors_total',
  help: 'Total number of span errors',
  labelNames: ['service', 'operation', 'error_type'] as const,
  registers: [vorionRegistry],
});

/**
 * Security event counter
 */
export const securityEventCounter = new Counter({
  name: 'vorion_trace_security_events_total',
  help: 'Total number of security events in traces',
  labelNames: ['event_type', 'risk_level', 'tenant_id'] as const,
  registers: [vorionRegistry],
});

/**
 * Policy decision counter
 */
export const policyDecisionCounter = new Counter({
  name: 'vorion_trace_policy_decisions_total',
  help: 'Total number of policy decisions',
  labelNames: ['namespace', 'action', 'result'] as const,
  registers: [vorionRegistry],
});

/**
 * Trust evaluation counter
 */
export const trustEvalCounter = new Counter({
  name: 'vorion_trace_trust_evaluations_total',
  help: 'Total number of trust evaluations',
  labelNames: ['result', 'trust_level'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Active Span Gauges
// =============================================================================

/**
 * Currently active spans
 */
export const activeSpansGauge = new Gauge({
  name: 'vorion_trace_active_spans',
  help: 'Number of currently active spans',
  labelNames: ['service', 'operation'] as const,
  registers: [vorionRegistry],
});

/**
 * Active HTTP requests
 */
export const activeHttpRequests = new Gauge({
  name: 'vorion_trace_active_http_requests',
  help: 'Number of currently active HTTP requests',
  labelNames: ['method', 'route'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Metric Recording Functions
// =============================================================================

/**
 * Span metric labels
 */
export interface SpanMetricLabels {
  service: string;
  operation: string;
  spanKind: string;
  status: 'ok' | 'error' | 'unset';
}

/**
 * Record span completion metrics
 *
 * @param labels - Span labels
 * @param durationMs - Span duration in milliseconds
 */
export function recordSpanMetrics(
  labels: SpanMetricLabels,
  durationMs: number
): void {
  // Record duration histogram
  spanDurationHistogram.observe(
    {
      service: labels.service,
      operation: labels.operation,
      span_kind: labels.spanKind,
      status: labels.status,
    },
    durationMs
  );

  // Increment span counter
  spanCounter.inc({
    service: labels.service,
    operation: labels.operation,
    span_kind: labels.spanKind,
    status: labels.status,
  });
}

/**
 * Record span error
 *
 * @param service - Service name
 * @param operation - Operation name
 * @param errorType - Error type/name
 */
export function recordSpanError(
  service: string,
  operation: string,
  errorType: string
): void {
  spanErrorCounter.inc({
    service,
    operation,
    error_type: errorType,
  });
}

/**
 * Record intent span metrics
 *
 * @param operation - Operation name
 * @param intentType - Intent type
 * @param status - Span status
 * @param durationMs - Duration in milliseconds
 */
export function recordIntentSpanMetrics(
  operation: string,
  intentType: string,
  status: 'ok' | 'error',
  durationMs: number
): void {
  intentSpanDuration.observe(
    {
      operation,
      intent_type: intentType,
      status,
    },
    durationMs
  );
}

/**
 * Record policy span metrics
 *
 * @param namespace - Policy namespace
 * @param action - Policy action
 * @param status - Span status
 * @param durationMs - Duration in milliseconds
 */
export function recordPolicySpanMetrics(
  namespace: string,
  action: string,
  status: 'ok' | 'error',
  durationMs: number
): void {
  policySpanDuration.observe(
    {
      namespace,
      action,
      status,
    },
    durationMs
  );
}

/**
 * Record security span metrics
 *
 * @param operationType - Security operation type
 * @param status - Span status
 * @param durationMs - Duration in milliseconds
 */
export function recordSecuritySpanMetrics(
  operationType: string,
  status: 'ok' | 'error',
  durationMs: number
): void {
  securitySpanDuration.observe(
    {
      operation_type: operationType,
      status,
    },
    durationMs
  );
}

/**
 * Record database span metrics
 *
 * @param operation - DB operation (select, insert, update, delete)
 * @param table - Table name
 * @param status - Span status
 * @param durationMs - Duration in milliseconds
 */
export function recordDbSpanMetrics(
  operation: string,
  table: string,
  status: 'ok' | 'error',
  durationMs: number
): void {
  dbSpanDuration.observe(
    {
      operation,
      table,
      status,
    },
    durationMs
  );
}

/**
 * Record cache span metrics
 *
 * @param operation - Cache operation (get, set, del)
 * @param hit - Whether cache hit (for get operations)
 * @param status - Span status
 * @param durationMs - Duration in milliseconds
 */
export function recordCacheSpanMetrics(
  operation: string,
  hit: boolean,
  status: 'ok' | 'error',
  durationMs: number
): void {
  cacheSpanDuration.observe(
    {
      operation,
      hit: hit ? 'true' : 'false',
      status,
    },
    durationMs
  );
}

/**
 * Record HTTP span metrics
 *
 * @param method - HTTP method
 * @param route - Route pattern
 * @param statusCode - HTTP status code
 * @param durationMs - Duration in milliseconds
 */
export function recordHttpSpanMetrics(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
): void {
  httpSpanDuration.observe(
    {
      method,
      route,
      status_code: String(statusCode),
    },
    durationMs
  );
}

/**
 * Record security event
 *
 * @param eventType - Security event type
 * @param riskLevel - Risk level (low, medium, high, critical)
 * @param tenantId - Tenant ID (optional)
 */
export function recordSecurityEvent(
  eventType: string,
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
  tenantId?: string
): void {
  securityEventCounter.inc({
    event_type: eventType,
    risk_level: riskLevel,
    tenant_id: tenantId ?? 'unknown',
  });
}

/**
 * Record policy decision
 *
 * @param namespace - Policy namespace
 * @param action - Policy action
 * @param result - Decision result (allow, deny, escalate)
 */
export function recordPolicyDecision(
  namespace: string,
  action: string,
  result: 'allow' | 'deny' | 'escalate'
): void {
  policyDecisionCounter.inc({
    namespace,
    action,
    result,
  });
}

/**
 * Record trust evaluation
 *
 * @param result - Evaluation result (passed, failed, insufficient)
 * @param trustLevel - Required trust level
 */
export function recordTrustEvaluation(
  result: 'passed' | 'failed' | 'insufficient',
  trustLevel: number
): void {
  trustEvalCounter.inc({
    result,
    trust_level: String(trustLevel),
  });
}

/**
 * Increment active span count
 *
 * @param service - Service name
 * @param operation - Operation name
 */
export function incrementActiveSpans(service: string, operation: string): void {
  activeSpansGauge.inc({
    service,
    operation,
  });
}

/**
 * Decrement active span count
 *
 * @param service - Service name
 * @param operation - Operation name
 */
export function decrementActiveSpans(service: string, operation: string): void {
  activeSpansGauge.dec({
    service,
    operation,
  });
}

/**
 * Increment active HTTP requests
 *
 * @param method - HTTP method
 * @param route - Route pattern
 */
export function incrementActiveHttpRequests(method: string, route: string): void {
  activeHttpRequests.inc({
    method,
    route,
  });
}

/**
 * Decrement active HTTP requests
 *
 * @param method - HTTP method
 * @param route - Route pattern
 */
export function decrementActiveHttpRequests(method: string, route: string): void {
  activeHttpRequests.dec({
    method,
    route,
  });
}

// =============================================================================
// Trace-to-Metrics Bridge
// =============================================================================

/**
 * Span processor hook for metrics recording
 *
 * This function should be called when a span ends to record metrics.
 */
export interface SpanEndData {
  name: string;
  service: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  status: 'ok' | 'error' | 'unset';
  durationMs: number;
  attributes: Record<string, string | number | boolean | undefined>;
  error?: Error;
}

/**
 * Process span end for metrics recording
 *
 * Call this from span processor or instrumentation hooks to
 * automatically record metrics for completed spans.
 *
 * @param data - Span end data
 */
export function processSpanForMetrics(data: SpanEndData): void {
  try {
    // Record general span metrics
    recordSpanMetrics(
      {
        service: data.service,
        operation: data.name,
        spanKind: data.kind,
        status: data.status,
      },
      data.durationMs
    );

    // Record error if present
    if (data.error) {
      recordSpanError(data.service, data.name, data.error.name);
    }

    // Route to specific metric handlers based on span attributes
    if (data.attributes['vorion.intent.id']) {
      recordIntentSpanMetrics(
        data.name,
        (data.attributes['vorion.intent.type'] as string) ?? 'default',
        data.status === 'error' ? 'error' : 'ok',
        data.durationMs
      );
    }

    if (data.attributes['vorion.policy.namespace']) {
      recordPolicySpanMetrics(
        data.attributes['vorion.policy.namespace'] as string,
        (data.attributes['vorion.policy.action'] as string) ?? 'evaluate',
        data.status === 'error' ? 'error' : 'ok',
        data.durationMs
      );
    }

    if (data.attributes['vorion.security.event']) {
      recordSecuritySpanMetrics(
        (data.attributes['security.operation_type'] as string) ?? 'unknown',
        data.status === 'error' ? 'error' : 'ok',
        data.durationMs
      );
    }

    if (data.attributes['db.operation']) {
      recordDbSpanMetrics(
        data.attributes['db.operation'] as string,
        (data.attributes['vorion.db.table'] as string) ?? 'unknown',
        data.status === 'error' ? 'error' : 'ok',
        data.durationMs
      );
    }

    if (data.attributes['vorion.cache.key']) {
      recordCacheSpanMetrics(
        (data.attributes['db.operation'] as string) ?? 'unknown',
        data.attributes['vorion.cache.hit'] === true,
        data.status === 'error' ? 'error' : 'ok',
        data.durationMs
      );
    }

    if (data.kind === 'server' && data.attributes['http.method']) {
      recordHttpSpanMetrics(
        data.attributes['http.method'] as string,
        (data.attributes['http.route'] as string) ?? data.name,
        (data.attributes['http.status_code'] as number) ?? 0,
        data.durationMs
      );
    }
  } catch (error) {
    logger.error({ error }, 'Error processing span for metrics');
  }
}

/**
 * Initialize metrics bridge
 *
 * Sets up any required initialization for the metrics bridge.
 */
export function initializeMetricsBridge(): void {
  logger.info('Trace metrics bridge initialized');
}

/**
 * Get all trace-related metrics for debugging
 */
export function getTraceMetrics(): Record<string, number> {
  return {
    spanDurationCount: (spanDurationHistogram as { hashMap?: { length?: number } }).hashMap?.length ?? 0,
    spanTotalCount: (spanCounter as { hashMap?: { length?: number } }).hashMap?.length ?? 0,
    errorCount: (spanErrorCounter as { hashMap?: { length?: number } }).hashMap?.length ?? 0,
  };
}
