/**
 * Operational Alerts - Alert Definitions and Evaluation
 *
 * Provides a programmatic way to define and evaluate operational alerts
 * that can trigger Prometheus AlertManager notifications.
 *
 * Alert categories:
 * - Infrastructure: Database, Redis, circuit breakers
 * - Performance: Latency, error rates, throughput
 * - Business: Intent approval rates, escalation SLAs
 * - Resource: Memory, CPU, connection pools
 *
 * @packageDocumentation
 * @module @vorion/ops/alerts
 */

import { createLogger } from '../common/logger.js';
import {
  databasePoolUtilization,
  redisConnectionsActive,
  redisConnectionErrorsTotal,
  circuitBreakerStateGauge,
  memoryUsageBytes,
  errorRateGauge,
  requestLatencyPercentiles,
  escalationApprovalRateGauge,
  CIRCUIT_BREAKER_STATES,
} from '../common/metrics.js';
import { vorionRegistry } from '../common/metrics-registry.js';

const logger = createLogger({ component: 'ops-alerts' });

// =============================================================================
// Alert Types and Interfaces
// =============================================================================

/**
 * Alert severity levels following Prometheus conventions
 */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/**
 * Alert categories for grouping and routing
 */
export type AlertCategory =
  | 'infrastructure'
  | 'performance'
  | 'business'
  | 'resource'
  | 'security';

/**
 * Alert state
 */
export type AlertState = 'firing' | 'pending' | 'resolved';

/**
 * Alert definition for operational monitoring
 */
export interface AlertDefinition {
  /** Unique alert name (must match Prometheus naming conventions) */
  name: string;
  /** Human-readable summary */
  summary: string;
  /** Detailed description with recommended actions */
  description: string;
  /** Alert severity level */
  severity: AlertSeverity;
  /** Alert category for routing */
  category: AlertCategory;
  /** PromQL expression for the alert condition */
  expr: string;
  /** Duration the condition must be true before firing (e.g., '5m') */
  for: string;
  /** Additional labels for routing and grouping */
  labels?: Record<string, string>;
  /** Additional annotations for documentation */
  annotations?: Record<string, string>;
  /** Runbook URL for incident response */
  runbookUrl?: string;
  /** Function to evaluate alert locally (for testing/preview) */
  evaluate?: () => Promise<AlertEvaluationResult>;
}

/**
 * Result of local alert evaluation
 */
export interface AlertEvaluationResult {
  /** Whether the alert condition is met */
  firing: boolean;
  /** Current value that triggered the evaluation */
  value?: number | string;
  /** Additional context about the evaluation */
  context?: Record<string, unknown>;
  /** Error message if evaluation failed */
  error?: string;
}

/**
 * Alert instance when an alert fires
 */
export interface AlertInstance {
  /** Alert definition */
  definition: AlertDefinition;
  /** Current state */
  state: AlertState;
  /** When the alert started firing */
  startsAt?: Date;
  /** When the alert was resolved */
  endsAt?: Date;
  /** Labels including dynamic values */
  labels: Record<string, string>;
  /** Annotations including dynamic values */
  annotations: Record<string, string>;
  /** Evaluation result */
  evaluationResult?: AlertEvaluationResult;
}

// =============================================================================
// Infrastructure Alerts
// =============================================================================

/**
 * Database connection pool utilization alert
 * Fires when pool utilization exceeds 80%
 */
export const DatabasePoolHighUtilization: AlertDefinition = {
  name: 'VorionDatabasePoolHighUtilization',
  summary: 'Database connection pool utilization is high',
  description:
    'The database connection pool is more than 80% utilized. ' +
    'This may indicate the need to increase pool size or optimize queries. ' +
    'Consider reviewing slow queries and connection usage patterns.',
  severity: 'warning',
  category: 'infrastructure',
  expr: 'vorion_database_pool_utilization > 80',
  for: '5m',
  labels: {
    team: 'platform',
    component: 'database',
  },
  annotations: {
    dashboard: 'https://grafana.example.com/d/vorion-database',
    summary: 'Database pool at {{ $value | humanize }}% utilization',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/database-pool-high',
  evaluate: async () => {
    try {
      const metrics = await vorionRegistry.getSingleMetricAsString('vorion_database_pool_utilization');
      // Parse the utilization value
      const match = metrics.match(/vorion_database_pool_utilization\s+(\d+(?:\.\d+)?)/);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        return {
          firing: value > 80,
          value,
          context: { threshold: 80, unit: 'percent' },
        };
      }
      return { firing: false, error: 'Could not parse metric value' };
    } catch (error) {
      return {
        firing: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

/**
 * Database connection pool critical alert
 * Fires when pool utilization exceeds 95%
 */
export const DatabasePoolCritical: AlertDefinition = {
  name: 'VorionDatabasePoolCritical',
  summary: 'Database connection pool is critically full',
  description:
    'The database connection pool is more than 95% utilized. ' +
    'New connections may be rejected. Immediate action required.',
  severity: 'critical',
  category: 'infrastructure',
  expr: 'vorion_database_pool_utilization > 95',
  for: '1m',
  labels: {
    team: 'platform',
    component: 'database',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/database-pool-critical',
};

/**
 * Database connection waiting alert
 * Fires when clients are waiting for connections
 */
export const DatabaseConnectionsWaiting: AlertDefinition = {
  name: 'VorionDatabaseConnectionsWaiting',
  summary: 'Clients are waiting for database connections',
  description:
    'Multiple clients are waiting for database connections. ' +
    'This indicates connection starvation and may cause request timeouts.',
  severity: 'warning',
  category: 'infrastructure',
  expr: 'vorion_database_pool_waiting > 5',
  for: '2m',
  labels: {
    team: 'platform',
    component: 'database',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/database-waiting',
};

/**
 * Redis connection failures alert
 */
export const RedisConnectionFailures: AlertDefinition = {
  name: 'VorionRedisConnectionFailures',
  summary: 'Redis connection errors detected',
  description:
    'Redis connection errors are occurring. ' +
    'This may affect caching, rate limiting, and distributed locking. ' +
    'Check Redis server health and network connectivity.',
  severity: 'critical',
  category: 'infrastructure',
  expr: 'increase(vorion_redis_connection_errors_total[5m]) > 5',
  for: '1m',
  labels: {
    team: 'platform',
    component: 'redis',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/redis-connection-failures',
};

/**
 * Redis unhealthy alert
 */
export const RedisUnhealthy: AlertDefinition = {
  name: 'VorionRedisUnhealthy',
  summary: 'Redis is unhealthy or unavailable',
  description:
    'Redis health check is failing. ' +
    'This will cause degraded performance and potential failures in caching, ' +
    'rate limiting, and distributed operations.',
  severity: 'critical',
  category: 'infrastructure',
  expr: 'vorion_redis_connections_active == 0',
  for: '1m',
  labels: {
    team: 'platform',
    component: 'redis',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/redis-unhealthy',
};

/**
 * Circuit breaker open alert
 */
export const CircuitBreakerOpen: AlertDefinition = {
  name: 'VorionCircuitBreakerOpen',
  summary: 'Circuit breaker is open for a service',
  description:
    'A circuit breaker has opened, indicating repeated failures for a downstream service. ' +
    'Requests to this service are being rejected to prevent cascading failures. ' +
    'Investigate the underlying service health.',
  severity: 'warning',
  category: 'infrastructure',
  expr: 'vorion_circuit_breaker_state == 1', // 1 = OPEN
  for: '30s',
  labels: {
    team: 'platform',
    component: 'circuit-breaker',
  },
  annotations: {
    service: '{{ $labels.service }}',
    summary: 'Circuit breaker open for {{ $labels.service }}',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/circuit-breaker-open',
};

/**
 * Circuit breaker stuck open alert
 */
export const CircuitBreakerStuckOpen: AlertDefinition = {
  name: 'VorionCircuitBreakerStuckOpen',
  summary: 'Circuit breaker has been open for extended period',
  description:
    'A circuit breaker has been open for more than 10 minutes. ' +
    'This indicates a persistent issue with the downstream service. ' +
    'Manual intervention may be required.',
  severity: 'critical',
  category: 'infrastructure',
  expr: 'vorion_circuit_breaker_state == 1', // 1 = OPEN
  for: '10m',
  labels: {
    team: 'platform',
    component: 'circuit-breaker',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/circuit-breaker-stuck',
};

// =============================================================================
// Performance Alerts
// =============================================================================

/**
 * High request latency P99 alert
 */
export const HighRequestLatencyP99: AlertDefinition = {
  name: 'VorionHighRequestLatencyP99',
  summary: 'API request latency P99 is high',
  description:
    'The 99th percentile of API request latency exceeds 5 seconds. ' +
    'This indicates potential performance issues affecting user experience. ' +
    'Review slow endpoints, database queries, and external service calls.',
  severity: 'warning',
  category: 'performance',
  expr: 'histogram_quantile(0.99, sum(rate(vorion_api_request_duration_seconds_bucket[5m])) by (le)) > 5',
  for: '5m',
  labels: {
    team: 'platform',
    component: 'api',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/high-latency-p99',
};

/**
 * Critical request latency P99 alert
 */
export const CriticalRequestLatencyP99: AlertDefinition = {
  name: 'VorionCriticalRequestLatencyP99',
  summary: 'API request latency P99 is critically high',
  description:
    'The 99th percentile of API request latency exceeds 10 seconds. ' +
    'Users are experiencing significant delays. Immediate investigation required.',
  severity: 'critical',
  category: 'performance',
  expr: 'histogram_quantile(0.99, sum(rate(vorion_api_request_duration_seconds_bucket[5m])) by (le)) > 10',
  for: '2m',
  labels: {
    team: 'platform',
    component: 'api',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/critical-latency-p99',
};

/**
 * High error rate alert
 */
export const HighErrorRate: AlertDefinition = {
  name: 'VorionHighErrorRate',
  summary: 'API error rate exceeds 1%',
  description:
    'The API error rate (5xx responses) exceeds 1% of total requests. ' +
    'This indicates potential system instability. ' +
    'Review error logs and recent deployments.',
  severity: 'warning',
  category: 'performance',
  expr: `
    (
      sum(rate(vorion_api_requests_total{status_code=~"5.."}[5m]))
      /
      sum(rate(vorion_api_requests_total[5m]))
    ) * 100 > 1
  `,
  for: '5m',
  labels: {
    team: 'platform',
    component: 'api',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/high-error-rate',
};

/**
 * Critical error rate alert
 */
export const CriticalErrorRate: AlertDefinition = {
  name: 'VorionCriticalErrorRate',
  summary: 'API error rate exceeds 5%',
  description:
    'The API error rate (5xx responses) exceeds 5% of total requests. ' +
    'This is a critical situation requiring immediate attention.',
  severity: 'critical',
  category: 'performance',
  expr: `
    (
      sum(rate(vorion_api_requests_total{status_code=~"5.."}[5m]))
      /
      sum(rate(vorion_api_requests_total[5m]))
    ) * 100 > 5
  `,
  for: '2m',
  labels: {
    team: 'platform',
    component: 'api',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/critical-error-rate',
};

/**
 * Intent processing slow alert
 */
export const IntentProcessingSlow: AlertDefinition = {
  name: 'VorionIntentProcessingSlow',
  summary: 'Intent processing is slow',
  description:
    'Intent processing time P95 exceeds 30 seconds. ' +
    'This may affect user experience and SLA compliance.',
  severity: 'warning',
  category: 'performance',
  expr: 'histogram_quantile(0.95, sum(rate(vorion_intent_processing_duration_seconds_bucket[5m])) by (le)) > 30',
  for: '5m',
  labels: {
    team: 'platform',
    component: 'intent',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/intent-processing-slow',
};

// =============================================================================
// Resource Alerts
// =============================================================================

/**
 * High memory usage alert
 */
export const HighMemoryUsage: AlertDefinition = {
  name: 'VorionHighMemoryUsage',
  summary: 'Memory usage exceeds 85%',
  description:
    'Heap memory usage exceeds 85% of total available heap. ' +
    'This may lead to increased garbage collection and potential OOM errors. ' +
    'Consider scaling up or investigating memory leaks.',
  severity: 'warning',
  category: 'resource',
  expr: `
    (vorion_memory_usage_bytes{type="heap_used"} / vorion_memory_usage_bytes{type="heap_total"}) * 100 > 85
  `,
  for: '5m',
  labels: {
    team: 'platform',
    component: 'memory',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/high-memory-usage',
};

/**
 * Critical memory usage alert
 */
export const CriticalMemoryUsage: AlertDefinition = {
  name: 'VorionCriticalMemoryUsage',
  summary: 'Memory usage exceeds 95%',
  description:
    'Heap memory usage exceeds 95% of total available heap. ' +
    'OOM errors are imminent. Immediate action required.',
  severity: 'critical',
  category: 'resource',
  expr: `
    (vorion_memory_usage_bytes{type="heap_used"} / vorion_memory_usage_bytes{type="heap_total"}) * 100 > 95
  `,
  for: '1m',
  labels: {
    team: 'platform',
    component: 'memory',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/critical-memory-usage',
};

// =============================================================================
// Business Alerts
// =============================================================================

/**
 * Intent approval rate drop alert
 */
export const IntentApprovalRateDrop: AlertDefinition = {
  name: 'VorionIntentApprovalRateDrop',
  summary: 'Intent approval rate has dropped significantly',
  description:
    'The intent approval rate has dropped by more than 20% compared to the baseline. ' +
    'This may indicate policy issues, trust score problems, or system malfunction. ' +
    'Review recent policy changes and trust calculations.',
  severity: 'warning',
  category: 'business',
  expr: `
    (
      sum(rate(vorion_intent_submissions_total{status="approved"}[1h]))
      /
      sum(rate(vorion_intent_submissions_total[1h]))
    ) < 0.8 * avg_over_time(
      (
        sum(rate(vorion_intent_submissions_total{status="approved"}[1h]))
        /
        sum(rate(vorion_intent_submissions_total[1h]))
      )[24h:1h]
    )
  `,
  for: '15m',
  labels: {
    team: 'product',
    component: 'intent',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/approval-rate-drop',
};

/**
 * Escalation backlog alert
 */
export const EscalationBacklog: AlertDefinition = {
  name: 'VorionEscalationBacklog',
  summary: 'Escalation backlog is growing',
  description:
    'The number of pending escalations is growing. ' +
    'This may indicate understaffing or process issues.',
  severity: 'warning',
  category: 'business',
  expr: 'vorion_pending_escalations > 50',
  for: '30m',
  labels: {
    team: 'operations',
    component: 'escalation',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/escalation-backlog',
};

/**
 * Escalation SLA breach risk alert
 */
export const EscalationSLABreachRisk: AlertDefinition = {
  name: 'VorionEscalationSLABreachRisk',
  summary: 'Escalations at risk of SLA breach',
  description:
    'Escalations are approaching their SLA timeout. ' +
    'Review and prioritize pending escalations.',
  severity: 'warning',
  category: 'business',
  expr: `
    histogram_quantile(0.95, sum(rate(vorion_escalation_resolution_time_seconds_bucket[1h])) by (le))
    > 3600
  `,
  for: '15m',
  labels: {
    team: 'operations',
    component: 'escalation',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/escalation-sla-risk',
};

/**
 * Low trust score calculations alert
 */
export const LowTrustCalculations: AlertDefinition = {
  name: 'VorionLowTrustCalculations',
  summary: 'Trust score calculations have dropped significantly',
  description:
    'The rate of trust score calculations has dropped. ' +
    'This may indicate issues with the trust engine or upstream data.',
  severity: 'info',
  category: 'business',
  expr: 'rate(vorion_trust_score_calculations_total[5m]) < 0.5 * avg_over_time(rate(vorion_trust_score_calculations_total[5m])[1h:5m])',
  for: '15m',
  labels: {
    team: 'platform',
    component: 'trust-engine',
  },
  runbookUrl: 'https://runbooks.example.com/vorion/low-trust-calculations',
};

// =============================================================================
// Alert Registry
// =============================================================================

/**
 * All defined alerts for easy iteration
 */
export const ALL_ALERTS: AlertDefinition[] = [
  // Infrastructure
  DatabasePoolHighUtilization,
  DatabasePoolCritical,
  DatabaseConnectionsWaiting,
  RedisConnectionFailures,
  RedisUnhealthy,
  CircuitBreakerOpen,
  CircuitBreakerStuckOpen,

  // Performance
  HighRequestLatencyP99,
  CriticalRequestLatencyP99,
  HighErrorRate,
  CriticalErrorRate,
  IntentProcessingSlow,

  // Resource
  HighMemoryUsage,
  CriticalMemoryUsage,

  // Business
  IntentApprovalRateDrop,
  EscalationBacklog,
  EscalationSLABreachRisk,
  LowTrustCalculations,
];

/**
 * Get alerts by severity
 */
export function getAlertsBySeverity(severity: AlertSeverity): AlertDefinition[] {
  return ALL_ALERTS.filter((alert) => alert.severity === severity);
}

/**
 * Get alerts by category
 */
export function getAlertsByCategory(category: AlertCategory): AlertDefinition[] {
  return ALL_ALERTS.filter((alert) => alert.category === category);
}

/**
 * Get alert by name
 */
export function getAlertByName(name: string): AlertDefinition | undefined {
  return ALL_ALERTS.find((alert) => alert.name === name);
}

// =============================================================================
// Alert Evaluation (for local testing)
// =============================================================================

/**
 * Evaluate all alerts locally and return their status
 */
export async function evaluateAllAlerts(): Promise<
  Map<string, AlertEvaluationResult>
> {
  const results = new Map<string, AlertEvaluationResult>();

  for (const alert of ALL_ALERTS) {
    if (alert.evaluate) {
      try {
        const result = await alert.evaluate();
        results.set(alert.name, result);
      } catch (error) {
        results.set(alert.name, {
          firing: false,
          error: error instanceof Error ? error.message : 'Evaluation failed',
        });
      }
    }
  }

  return results;
}

/**
 * Generate Prometheus alert rules YAML from definitions
 */
export function generatePrometheusRules(): string {
  const groups = [
    {
      name: 'vorion.infrastructure',
      rules: ALL_ALERTS.filter((a) => a.category === 'infrastructure'),
    },
    {
      name: 'vorion.performance',
      rules: ALL_ALERTS.filter((a) => a.category === 'performance'),
    },
    {
      name: 'vorion.resources',
      rules: ALL_ALERTS.filter((a) => a.category === 'resource'),
    },
    {
      name: 'vorion.business',
      rules: ALL_ALERTS.filter((a) => a.category === 'business'),
    },
  ];

  const output: string[] = [
    '# Auto-generated Prometheus alert rules for Vorion',
    '# Generated at: ' + new Date().toISOString(),
    '',
    'groups:',
  ];

  for (const group of groups) {
    if (group.rules.length === 0) continue;

    output.push(`  - name: ${group.name}`);
    output.push('    rules:');

    for (const alert of group.rules) {
      output.push(`      - alert: ${alert.name}`);
      output.push(`        expr: ${alert.expr.replace(/\n\s*/g, ' ').trim()}`);
      output.push(`        for: ${alert.for}`);
      output.push('        labels:');
      output.push(`          severity: ${alert.severity}`);
      output.push(`          category: ${alert.category}`);
      if (alert.labels) {
        for (const [key, value] of Object.entries(alert.labels)) {
          output.push(`          ${key}: ${value}`);
        }
      }
      output.push('        annotations:');
      output.push(`          summary: "${alert.summary}"`);
      output.push(`          description: "${alert.description.replace(/"/g, '\\"')}"`);
      if (alert.runbookUrl) {
        output.push(`          runbook_url: "${alert.runbookUrl}"`);
      }
      if (alert.annotations) {
        for (const [key, value] of Object.entries(alert.annotations)) {
          output.push(`          ${key}: "${value}"`);
        }
      }
      output.push('');
    }
  }

  return output.join('\n');
}

logger.info(
  { alertCount: ALL_ALERTS.length },
  'Operational alerts module initialized'
);
