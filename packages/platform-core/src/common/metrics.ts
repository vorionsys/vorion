/**
 * Vorion Platform Metrics - Comprehensive Prometheus Observability
 *
 * Provides centralized metrics for monitoring all Vorion subsystems including:
 * - Intent processing pipeline
 * - Trust score calculations
 * - Policy evaluations
 * - API request latency
 * - Database and Redis connections
 * - Circuit breaker states
 *
 * All metrics are registered with the shared vorionRegistry for unified collection.
 *
 * @packageDocumentation
 * @module @vorion/common/metrics
 */

import { Counter, Histogram, Gauge, Summary } from "prom-client";

import {
  vorionRegistry,
  getMetrics,
  getMetricsContentType,
} from "./metrics-registry.js";

// Re-export registry functions for convenience
export { vorionRegistry, getMetrics, getMetricsContentType };

// =============================================================================
// Intent Submission Metrics
// =============================================================================

/**
 * Total intent submissions by status
 * Labels: status (approved, denied, escalated, pending, cancelled, error)
 */
export const intentSubmissionsTotal = new Counter({
  name: "vorion_intent_submissions_total",
  help: "Total number of intent submissions by final status",
  labelNames: ["status", "tenant_id", "intent_type"] as const,
  registers: [vorionRegistry],
});

/**
 * Intent processing duration from submission to terminal state
 */
export const intentProcessingDurationSeconds = new Histogram({
  name: "vorion_intent_processing_duration_seconds",
  help: "Duration of intent processing from submission to terminal state in seconds",
  labelNames: ["status", "tenant_id", "intent_type"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [vorionRegistry],
});

/**
 * Currently active intents being processed
 */
export const activeIntentsGauge = new Gauge({
  name: "vorion_active_intents",
  help: "Number of intents currently being processed",
  labelNames: ["tenant_id", "status"] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Trust Score Metrics
// =============================================================================

/**
 * Total trust score calculations
 */
export const trustScoreCalculationsTotal = new Counter({
  name: "vorion_trust_score_calculations_total",
  help: "Total number of trust score calculations performed",
  labelNames: ["tenant_id", "entity_type"] as const,
  registers: [vorionRegistry],
});

/**
 * Trust score calculation duration
 */
export const trustScoreCalculationDurationSeconds = new Histogram({
  name: "vorion_trust_score_calculation_duration_seconds",
  help: "Duration of trust score calculations in seconds",
  labelNames: ["tenant_id"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [vorionRegistry],
});

/**
 * Trust signals recorded
 */
export const trustSignalsRecordedTotal = new Counter({
  name: "vorion_trust_signals_recorded_total",
  help: "Total number of trust signals recorded",
  labelNames: ["signal_type", "tenant_id"] as const,
  registers: [vorionRegistry],
});

/**
 * Current trust score distribution
 */
export const trustScoreDistribution = new Histogram({
  name: "vorion_trust_score_distribution",
  help: "Distribution of current trust scores",
  labelNames: ["tenant_id", "trust_level"] as const,
  buckets: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  registers: [vorionRegistry],
});

// =============================================================================
// Policy Evaluation Metrics
// =============================================================================

/**
 * Total policy evaluations by result
 */
export const policyEvaluationsTotal = new Counter({
  name: "vorion_policy_evaluations_total",
  help: "Total number of policy evaluations by result",
  labelNames: ["result", "tenant_id", "namespace", "policy_name"] as const,
  registers: [vorionRegistry],
});

/**
 * Policy evaluation duration
 */
export const policyEvaluationDurationSeconds = new Histogram({
  name: "vorion_policy_evaluation_duration_seconds",
  help: "Duration of policy evaluations in seconds",
  labelNames: ["tenant_id", "namespace"] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [vorionRegistry],
});

/**
 * Number of rules evaluated per policy evaluation
 */
export const rulesEvaluatedPerRequest = new Histogram({
  name: "vorion_rules_evaluated_per_request",
  help: "Number of policy rules evaluated per request",
  labelNames: ["tenant_id", "namespace"] as const,
  buckets: [1, 2, 5, 10, 20, 50, 100, 200],
  registers: [vorionRegistry],
});

/**
 * Policy cache hit/miss ratio
 */
export const policyCacheOperationsTotal = new Counter({
  name: "vorion_policy_cache_operations_total",
  help: "Total policy cache operations",
  labelNames: ["operation", "tenant_id"] as const, // operation: hit, miss, eviction
  registers: [vorionRegistry],
});

// =============================================================================
// API Request Metrics
// =============================================================================

/**
 * API request duration by endpoint
 */
export const apiRequestDurationSeconds = new Histogram({
  name: "vorion_api_request_duration_seconds",
  help: "Duration of API requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [vorionRegistry],
});

/**
 * API requests total
 */
export const apiRequestsTotal = new Counter({
  name: "vorion_api_requests_total",
  help: "Total number of API requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [vorionRegistry],
});

/**
 * API request size in bytes
 */
export const apiRequestSizeBytes = new Histogram({
  name: "vorion_api_request_size_bytes",
  help: "Size of API request bodies in bytes",
  labelNames: ["method", "route"] as const,
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [vorionRegistry],
});

/**
 * API response size in bytes
 */
export const apiResponseSizeBytes = new Histogram({
  name: "vorion_api_response_size_bytes",
  help: "Size of API response bodies in bytes",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [vorionRegistry],
});

/**
 * Currently active API requests
 */
export const apiActiveRequestsGauge = new Gauge({
  name: "vorion_api_active_requests",
  help: "Number of currently active API requests",
  labelNames: ["method", "route"] as const,
  registers: [vorionRegistry],
});

/**
 * API errors total
 */
export const apiErrorsTotal = new Counter({
  name: "vorion_api_errors_total",
  help: "Total number of API errors",
  labelNames: ["method", "route", "error_code", "error_type"] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Database Metrics
// =============================================================================

/**
 * Database pool active connections
 */
export const databasePoolActive = new Gauge({
  name: "vorion_database_pool_active",
  help: "Number of active database connections in the pool",
  registers: [vorionRegistry],
});

/**
 * Database pool waiting clients
 */
export const databasePoolWaiting = new Gauge({
  name: "vorion_database_pool_waiting",
  help: "Number of clients waiting for a database connection",
  registers: [vorionRegistry],
});

/**
 * Database pool idle connections
 */
export const databasePoolIdle = new Gauge({
  name: "vorion_database_pool_idle",
  help: "Number of idle database connections in the pool",
  registers: [vorionRegistry],
});

/**
 * Database pool total size
 */
export const databasePoolTotal = new Gauge({
  name: "vorion_database_pool_total",
  help: "Total number of connections in the database pool",
  registers: [vorionRegistry],
});

/**
 * Database pool utilization percentage
 */
export const databasePoolUtilization = new Gauge({
  name: "vorion_database_pool_utilization",
  help: "Database pool utilization as a percentage (0-100)",
  registers: [vorionRegistry],
});

/**
 * Database connection errors
 */
export const databaseConnectionErrorsTotal = new Counter({
  name: "vorion_database_connection_errors_total",
  help: "Total number of database connection errors",
  labelNames: ["error_type"] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Redis Metrics
// =============================================================================

/**
 * Redis active connections
 */
export const redisConnectionsActive = new Gauge({
  name: "vorion_redis_connections_active",
  help: "Number of active Redis connections",
  registers: [vorionRegistry],
});

/**
 * Redis connection errors
 */
export const redisConnectionErrorsTotal = new Counter({
  name: "vorion_redis_connection_errors_total",
  help: "Total number of Redis connection errors",
  labelNames: ["error_type"] as const,
  registers: [vorionRegistry],
});

/**
 * Redis operations latency
 */
export const redisOperationDurationSeconds = new Histogram({
  name: "vorion_redis_operation_duration_seconds",
  help: "Duration of Redis operations in seconds",
  labelNames: ["operation"] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [vorionRegistry],
});

/**
 * Redis operations total
 */
export const redisOperationsTotal = new Counter({
  name: "vorion_redis_operations_total",
  help: "Total number of Redis operations",
  labelNames: ["operation", "result"] as const, // result: success, error, timeout
  registers: [vorionRegistry],
});

/**
 * Redis memory usage
 */
export const redisMemoryUsageBytes = new Gauge({
  name: "vorion_redis_memory_usage_bytes",
  help: "Redis memory usage in bytes",
  registers: [vorionRegistry],
});

// =============================================================================
// Circuit Breaker Metrics
// =============================================================================

// Note: circuitBreakerState gauge is defined in intent/metrics.ts as the canonical
// source (with label 'name'). Removed from here to avoid duplicate Prometheus
// metric registration. Use intent/metrics.ts circuitBreakerState instead.

/**
 * Circuit breaker trips total
 */
export const circuitBreakerTripsTotal = new Counter({
  name: "vorion_circuit_breaker_trips_total",
  help: "Total number of times circuit breaker has opened",
  labelNames: ["service"] as const,
  registers: [vorionRegistry],
});

/**
 * Circuit breaker recoveries total
 */
export const circuitBreakerRecoveriesTotal = new Counter({
  name: "vorion_circuit_breaker_recoveries_total",
  help: "Total number of times circuit breaker has recovered (closed)",
  labelNames: ["service"] as const,
  registers: [vorionRegistry],
});

/**
 * Circuit breaker rejected requests total
 */
export const circuitBreakerRejectedTotal = new Counter({
  name: "vorion_circuit_breaker_rejected_total",
  help: "Total number of requests rejected by open circuit breaker",
  labelNames: ["service"] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Operational Health Metrics
// =============================================================================

/**
 * Memory usage gauge
 */
export const memoryUsageBytes = new Gauge({
  name: "vorion_memory_usage_bytes",
  help: "Current memory usage in bytes",
  labelNames: ["type"] as const, // type: heap_used, heap_total, rss, external
  registers: [vorionRegistry],
});

/**
 * Error rate over time (rolling window)
 */
export const errorRateGauge = new Gauge({
  name: "vorion_error_rate",
  help: "Current error rate as a percentage over the last 5 minutes",
  labelNames: ["service"] as const,
  registers: [vorionRegistry],
});

/**
 * Request latency percentiles (P50, P90, P95, P99)
 */
export const requestLatencyPercentiles = new Summary({
  name: "vorion_request_latency_percentiles",
  help: "Request latency percentiles",
  labelNames: ["service"] as const,
  percentiles: [0.5, 0.9, 0.95, 0.99],
  registers: [vorionRegistry],
});

// =============================================================================
// Escalation Metrics
// =============================================================================

// Note: escalationsCreatedTotal and escalationApprovalRateGauge are defined in
// intent/metrics.ts as the canonical source (with different label sets).
// Removed from here to avoid duplicate Prometheus metric registration.

/**
 * Escalation resolution time
 */
export const escalationResolutionTimeSeconds = new Histogram({
  name: "vorion_escalation_resolution_time_seconds",
  help: "Time taken to resolve escalations in seconds",
  labelNames: ["tenant_id", "resolution"] as const, // resolution: approved, denied, timeout
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400, 28800, 86400],
  registers: [vorionRegistry],
});

/**
 * Pending escalations count
 */
export const pendingEscalationsGauge = new Gauge({
  name: "vorion_pending_escalations",
  help: "Current number of pending escalations",
  labelNames: ["tenant_id"] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Circuit breaker state enum values
 */
export const CIRCUIT_BREAKER_STATES = {
  CLOSED: 0,
  OPEN: 1,
  HALF_OPEN: 2,
} as const;

export type CircuitBreakerState = keyof typeof CIRCUIT_BREAKER_STATES;

/**
 * Record intent submission with all relevant metrics
 */
export function recordIntentSubmissionMetric(
  status: string,
  tenantId: string,
  intentType: string,
  durationSeconds?: number,
): void {
  intentSubmissionsTotal.inc({
    status,
    tenant_id: tenantId,
    intent_type: intentType,
  });
  if (durationSeconds !== undefined) {
    intentProcessingDurationSeconds.observe(
      { status, tenant_id: tenantId, intent_type: intentType },
      durationSeconds,
    );
  }
}

/**
 * Record trust score calculation
 */
export function recordTrustCalculationMetric(
  tenantId: string,
  entityType: string,
  durationSeconds: number,
): void {
  trustScoreCalculationsTotal.inc({
    tenant_id: tenantId,
    entity_type: entityType,
  });
  trustScoreCalculationDurationSeconds.observe(
    { tenant_id: tenantId },
    durationSeconds,
  );
}

/**
 * Record policy evaluation
 */
export function recordPolicyEvaluationMetric(
  result: "allow" | "deny" | "escalate",
  tenantId: string,
  namespace: string,
  policyName: string,
  durationSeconds: number,
  rulesEvaluated: number,
): void {
  policyEvaluationsTotal.inc({
    result,
    tenant_id: tenantId,
    namespace,
    policy_name: policyName,
  });
  policyEvaluationDurationSeconds.observe(
    { tenant_id: tenantId, namespace },
    durationSeconds,
  );
  rulesEvaluatedPerRequest.observe(
    { tenant_id: tenantId, namespace },
    rulesEvaluated,
  );
}

/**
 * Record API request metrics
 */
export function recordApiRequestMetric(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
  requestSizeBytes?: number,
  responseSizeBytes?: number,
): void {
  const labels = { method, route, status_code: statusCode.toString() };
  apiRequestsTotal.inc(labels);
  apiRequestDurationSeconds.observe(labels, durationSeconds);

  if (requestSizeBytes !== undefined) {
    apiRequestSizeBytes.observe({ method, route }, requestSizeBytes);
  }
  if (responseSizeBytes !== undefined) {
    apiResponseSizeBytes.observe(labels, responseSizeBytes);
  }
}

/**
 * Update database pool metrics
 */
export function updateDatabasePoolMetrics(
  active: number,
  idle: number,
  waiting: number,
  total: number,
  maxPoolSize: number,
): void {
  databasePoolActive.set(active);
  databasePoolIdle.set(idle);
  databasePoolWaiting.set(waiting);
  databasePoolTotal.set(total);
  databasePoolUtilization.set((active / maxPoolSize) * 100);
}

/**
 * Update Redis connection metrics
 */
export function updateRedisMetrics(
  activeConnections: number,
  memoryBytes?: number,
): void {
  redisConnectionsActive.set(activeConnections);
  if (memoryBytes !== undefined) {
    redisMemoryUsageBytes.set(memoryBytes);
  }
}

// Note: updateCircuitBreakerStateMetric and recordCircuitBreakerStateChangeMetric
// removed. Use intent/metrics.ts updateCircuitBreakerState and
// recordCircuitBreakerStateChange instead.

/**
 * Update memory usage metrics
 */
export function updateMemoryMetrics(): void {
  const memUsage = process.memoryUsage();
  memoryUsageBytes.set({ type: "heap_used" }, memUsage.heapUsed);
  memoryUsageBytes.set({ type: "heap_total" }, memUsage.heapTotal);
  memoryUsageBytes.set({ type: "rss" }, memUsage.rss);
  memoryUsageBytes.set({ type: "external" }, memUsage.external);
}

/**
 * Start periodic memory metrics collection
 */
let memoryMetricsInterval: NodeJS.Timeout | null = null;

export function startMemoryMetricsCollection(intervalMs: number = 10000): void {
  if (memoryMetricsInterval) return;

  memoryMetricsInterval = setInterval(() => {
    updateMemoryMetrics();
  }, intervalMs);

  // Don't keep process alive just for metrics
  memoryMetricsInterval.unref();

  // Collect immediately
  updateMemoryMetrics();
}

export function stopMemoryMetricsCollection(): void {
  if (memoryMetricsInterval) {
    clearInterval(memoryMetricsInterval);
    memoryMetricsInterval = null;
  }
}
