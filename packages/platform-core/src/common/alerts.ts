/**
 * Critical Alert Definitions
 *
 * Defines alerting rules for trust-critical operations across all Vorion services.
 * These alerts are consumed by monitoring backends (Grafana, PagerDuty, etc.)
 * and exported as OpenTelemetry metric-based alerts.
 *
 * Priority levels:
 *   P0 — Immediate: Data integrity at risk (proof chain, signatures)
 *   P1 — Urgent: Security/trust degradation (auth failures, scoring latency)
 *   P2 — Important: Service health (error rates, circuit breakers)
 *   P3 — Warning: Performance (latency budgets, queue depth)
 */

import { createLogger } from './logger.js';

const logger = createLogger({ component: 'alerts' });

// ============================================================================
// Alert Definitions
// ============================================================================

export interface AlertRule {
  /** Unique alert identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Priority level (P0-P3) */
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  /** Description of what this alert detects */
  description: string;
  /** Metric name to evaluate */
  metric: string;
  /** Condition operator */
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  /** Threshold value */
  threshold: number;
  /** Evaluation window in seconds */
  windowSeconds: number;
  /** Notification channels */
  channels: ('pagerduty' | 'slack' | 'email' | 'webhook')[];
  /** Tags for routing and filtering */
  tags: string[];
}

/**
 * Critical alert rules for the Vorion ecosystem.
 */
export const ALERT_RULES: AlertRule[] = [
  // ==========================================================================
  // P0 — Immediate: Data Integrity
  // ==========================================================================
  {
    id: 'proof-chain-hash-mismatch',
    name: 'Proof Chain Hash Mismatch',
    priority: 'P0',
    description: 'Cryptographic proof chain integrity violation detected. Possible tampering or corruption.',
    metric: 'vorion.proof.hash_mismatch_total',
    operator: 'gt',
    threshold: 0,
    windowSeconds: 60,
    channels: ['pagerduty', 'slack'],
    tags: ['security', 'proof', 'integrity'],
  },
  {
    id: 'signature-verification-failure',
    name: 'Signature Verification Failure Spike',
    priority: 'P0',
    description: 'Ed25519 signature verification failures exceed threshold. Key compromise possible.',
    metric: 'vorion.signatures.verification_failure_rate',
    operator: 'gt',
    threshold: 0.01, // >1% failure rate
    windowSeconds: 300,
    channels: ['pagerduty', 'slack'],
    tags: ['security', 'signatures', 'crypto'],
  },

  // ==========================================================================
  // P1 — Urgent: Security & Trust
  // ==========================================================================
  {
    id: 'auth-failure-rate-high',
    name: 'Authentication Failure Rate High',
    priority: 'P1',
    description: 'API authentication failure rate exceeds 5%. Possible credential stuffing or misconfiguration.',
    metric: 'vorion.auth.failure_rate',
    operator: 'gt',
    threshold: 0.05,
    windowSeconds: 300,
    channels: ['pagerduty', 'slack'],
    tags: ['security', 'auth'],
  },
  {
    id: 'trust-scoring-latency-high',
    name: 'Trust Scoring Latency High',
    priority: 'P1',
    description: 'Trust score computation P95 latency exceeds 1 second. May cause governance decision timeouts.',
    metric: 'vorion.trust.scoring_latency_p95',
    operator: 'gt',
    threshold: 1000, // 1 second in ms
    windowSeconds: 300,
    channels: ['slack', 'email'],
    tags: ['performance', 'trust'],
  },
  {
    id: 'circuit-breaker-open',
    name: 'Circuit Breaker Opened',
    priority: 'P1',
    description: 'A critical circuit breaker has entered OPEN state. Dependent service is unavailable.',
    metric: 'vorion.circuit_breaker.open_total',
    operator: 'gt',
    threshold: 0,
    windowSeconds: 60,
    channels: ['slack'],
    tags: ['reliability', 'circuit-breaker'],
  },
  {
    id: 'tripwire-cascade-detected',
    name: 'Tripwire Cascade Detected',
    priority: 'P1',
    description: 'Multiple tripwire violations from a single entity. Possible coordinated attack.',
    metric: 'vorion.tripwires.cascade_count',
    operator: 'gte',
    threshold: 3,
    windowSeconds: 300,
    channels: ['pagerduty', 'slack'],
    tags: ['security', 'tripwires'],
  },

  // ==========================================================================
  // P2 — Important: Service Health
  // ==========================================================================
  {
    id: 'api-error-rate-elevated',
    name: 'API Error Rate Elevated',
    priority: 'P2',
    description: 'API 5xx error rate exceeds 1%. Service may be partially degraded.',
    metric: 'vorion.api.error_rate_5xx',
    operator: 'gt',
    threshold: 0.01,
    windowSeconds: 300,
    channels: ['slack'],
    tags: ['reliability', 'api'],
  },
  {
    id: 'database-connection-pool-exhaustion',
    name: 'Database Connection Pool Near Exhaustion',
    priority: 'P2',
    description: 'Database connection pool utilization exceeds 90%.',
    metric: 'vorion.db.pool_utilization',
    operator: 'gt',
    threshold: 0.9,
    windowSeconds: 120,
    channels: ['slack'],
    tags: ['database', 'reliability'],
  },
  {
    id: 'redis-connection-failure',
    name: 'Redis Connection Failures',
    priority: 'P2',
    description: 'Redis connection failures detected. Cache may be degrading to no-op mode.',
    metric: 'vorion.redis.connection_failure_total',
    operator: 'gt',
    threshold: 5,
    windowSeconds: 300,
    channels: ['slack'],
    tags: ['cache', 'redis'],
  },

  // ==========================================================================
  // P3 — Warning: Performance
  // ==========================================================================
  {
    id: 'api-latency-budget-exceeded',
    name: 'API Latency Budget Exceeded',
    priority: 'P3',
    description: 'API P95 latency exceeds 500ms budget for read operations.',
    metric: 'vorion.api.latency_p95',
    operator: 'gt',
    threshold: 500,
    windowSeconds: 600,
    channels: ['slack'],
    tags: ['performance', 'api'],
  },
  {
    id: 'velocity-throttle-rate-high',
    name: 'Velocity Throttle Rate High',
    priority: 'P3',
    description: 'More than 10% of requests are being throttled by velocity limiter.',
    metric: 'vorion.velocity.throttle_rate',
    operator: 'gt',
    threshold: 0.10,
    windowSeconds: 600,
    channels: ['slack'],
    tags: ['performance', 'velocity'],
  },
];

// ============================================================================
// Alert Evaluation
// ============================================================================

export type AlertCallback = (rule: AlertRule, currentValue: number) => void;

let _callbacks: AlertCallback[] = [];

/**
 * Register a callback for when an alert fires.
 */
export function onAlert(callback: AlertCallback): void {
  _callbacks.push(callback);
}

/**
 * Evaluate a metric value against all matching alert rules.
 */
export function evaluateAlerts(metricName: string, value: number): void {
  const matching = ALERT_RULES.filter((r) => r.metric === metricName);

  for (const rule of matching) {
    let fired = false;
    switch (rule.operator) {
      case 'gt': fired = value > rule.threshold; break;
      case 'lt': fired = value < rule.threshold; break;
      case 'gte': fired = value >= rule.threshold; break;
      case 'lte': fired = value <= rule.threshold; break;
      case 'eq': fired = value === rule.threshold; break;
    }

    if (fired) {
      logger.warn(
        { alertId: rule.id, priority: rule.priority, value, threshold: rule.threshold },
        `Alert fired: ${rule.name}`,
      );
      for (const cb of _callbacks) {
        cb(rule, value);
      }
    }
  }
}

/**
 * Get all alert rules for a specific priority.
 */
export function getAlertsByPriority(priority: AlertRule['priority']): AlertRule[] {
  return ALERT_RULES.filter((r) => r.priority === priority);
}

/**
 * Get all alert rules tagged with a specific tag.
 */
export function getAlertsByTag(tag: string): AlertRule[] {
  return ALERT_RULES.filter((r) => r.tags.includes(tag));
}
