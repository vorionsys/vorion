/**
 * Shared Metrics Registry
 *
 * Provides a centralized Prometheus registry that can be used by all modules
 * without creating circular dependencies.
 *
 * This module is designed to be a "leaf" dependency - it should not import
 * from any other Vorion modules to prevent circular dependencies.
 *
 * Usage:
 * - Import `vorionRegistry` to register your metrics
 * - Import `getMetrics` and `getMetricsContentType` for exposing metrics endpoint
 *
 * @packageDocumentation
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Shared Prometheus registry for all Vorion metrics.
 *
 * All modules should register their metrics with this registry to ensure
 * they are collected and exposed through the /metrics endpoint.
 */
export const vorionRegistry = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop)
collectDefaultMetrics({ register: vorionRegistry, prefix: 'vorion_' });

/**
 * Get all metrics as Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return vorionRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return vorionRegistry.contentType;
}

// =============================================================================
// Database Metrics (moved from intent/metrics.ts to break circular dependency)
// =============================================================================

/**
 * Total database query timeouts (statement_timeout exceeded)
 */
export const queryTimeouts = new Counter({
  name: 'vorion_db_query_timeouts_total',
  help: 'Number of database query timeouts (statement_timeout exceeded)',
  labelNames: ['operation'] as const,
  registers: [vorionRegistry],
});

/**
 * Record a database query timeout (statement_timeout exceeded)
 */
export function recordQueryTimeout(operation: string): void {
  queryTimeouts.inc({ operation });
}

// =============================================================================
// Token Revocation Metrics (moved from intent/metrics.ts)
// =============================================================================

/**
 * Tokens revoked total, labeled by revocation type
 */
export const tokensRevokedTotal = new Counter({
  name: 'vorion_tokens_revoked_total',
  help: 'Total number of tokens revoked',
  labelNames: ['type'] as const, // type: single, user_all
  registers: [vorionRegistry],
});

/**
 * Token revocation check results
 */
export const tokenRevocationChecks = new Counter({
  name: 'vorion_token_revocation_checks_total',
  help: 'Total token revocation checks performed',
  labelNames: ['result'] as const, // result: valid, revoked, missing_jti
  registers: [vorionRegistry],
});
