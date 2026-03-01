/**
 * Prometheus Metrics Route
 *
 * Exposes a GET /metrics endpoint returning the standard Prometheus
 * text exposition format (Content-Type: text/plain; version=0.0.4).
 *
 * This endpoint is intentionally unauthenticated -- metrics scraping
 * infrastructure (Prometheus, Grafana Agent, etc.) typically does not
 * carry application-level auth tokens.
 *
 * @packageDocumentation
 */

import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';
import {
  MetricsRegistry,
  collectProcessMetrics,
  serverMetrics,
} from '../metrics/prometheus.js';

/**
 * Collect all subsystem metrics into a fresh registry and return the
 * Prometheus text exposition string.
 */
async function collectAllMetrics(): Promise<string> {
  const registry = new MetricsRegistry();

  // -------------------------------------------------------------------------
  // 1. Process-level metrics
  // -------------------------------------------------------------------------
  collectProcessMetrics(registry);

  // -------------------------------------------------------------------------
  // 2. HTTP request metrics (from ServerMetrics singleton)
  // -------------------------------------------------------------------------
  registry.counter(
    'cognigate_http_requests_total',
    'Total HTTP requests handled by the Cognigate API',
    serverMetrics.httpRequestsTotal,
  );

  for (const [method, count] of Object.entries(serverMetrics.httpRequestsByMethod)) {
    registry.counter(
      'cognigate_http_requests_by_method_total',
      'Total HTTP requests by method',
      count,
      { method },
    );
  }

  for (const [status, count] of Object.entries(serverMetrics.httpRequestsByStatus)) {
    registry.counter(
      'cognigate_http_requests_by_status_total',
      'Total HTTP requests by status code bucket',
      count,
      { status },
    );
  }

  if (serverMetrics.httpRequestDurationCount > 0) {
    registry.gauge(
      'cognigate_http_request_duration_seconds_avg',
      'Average HTTP request duration in seconds',
      serverMetrics.httpRequestDurationSum / serverMetrics.httpRequestDurationCount / 1000,
    );
  }

  registry.counter(
    'cognigate_http_request_duration_seconds_sum',
    'Sum of HTTP request durations in seconds',
    serverMetrics.httpRequestDurationSum / 1000,
  );

  registry.counter(
    'cognigate_http_request_duration_seconds_count',
    'Count of HTTP requests observed for duration',
    serverMetrics.httpRequestDurationCount,
  );

  // -------------------------------------------------------------------------
  // 3. Trust evaluation metrics
  // -------------------------------------------------------------------------
  registry.counter(
    'cognigate_trust_evaluations_total',
    'Total trust evaluations performed',
    serverMetrics.trustEvaluationsTotal,
  );
  registry.counter(
    'cognigate_trust_evaluations_allowed_total',
    'Trust evaluations that resulted in allow',
    serverMetrics.trustEvaluationsAllowed,
  );
  registry.counter(
    'cognigate_trust_evaluations_denied_total',
    'Trust evaluations that resulted in deny',
    serverMetrics.trustEvaluationsDenied,
  );

  // -------------------------------------------------------------------------
  // 4. Governance decisions
  // -------------------------------------------------------------------------
  let governanceTotal = 0;
  for (const [decisionType, count] of Object.entries(serverMetrics.governanceDecisionsByType)) {
    governanceTotal += count;
    registry.counter(
      'cognigate_governance_decisions_total',
      'Total governance decisions by type',
      count,
      { decision: decisionType },
    );
  }
  // Also emit an aggregate counter
  registry.counter(
    'cognigate_governance_decisions_aggregate_total',
    'Aggregate count of all governance decisions',
    governanceTotal,
  );

  // -------------------------------------------------------------------------
  // 5. Proof commit metrics
  // -------------------------------------------------------------------------
  registry.counter(
    'cognigate_proof_commits_total',
    'Total proof commitments created',
    serverMetrics.proofCommitsTotal,
  );
  registry.counter(
    'cognigate_proof_batches_total',
    'Total proof batches flushed',
    serverMetrics.proofBatchesTotal,
  );

  // -------------------------------------------------------------------------
  // 6. Runtime subsystem metrics (from context)
  // -------------------------------------------------------------------------
  try {
    const ctx = getContext();

    // Intent pipeline metrics
    const intentMetrics = ctx.intentPipeline.getMetrics();
    registry.counter(
      'cognigate_intents_total',
      'Total intents processed by the pipeline',
      intentMetrics.totalIntents,
    );
    registry.counter(
      'cognigate_intents_allowed_total',
      'Intents that were allowed',
      intentMetrics.allowedIntents,
    );
    registry.counter(
      'cognigate_intents_denied_total',
      'Intents that were denied',
      intentMetrics.deniedIntents,
    );
    if (intentMetrics.totalIntents > 0) {
      registry.gauge(
        'cognigate_intent_processing_avg_seconds',
        'Average intent processing time in seconds',
        intentMetrics.avgProcessingTimeMs / 1000,
      );
      registry.gauge(
        'cognigate_intent_allow_rate',
        'Ratio of allowed intents (0.0 to 1.0)',
        intentMetrics.allowRate,
      );
    }

    // Proof committer metrics
    const proofMetrics = ctx.proofCommitter.getMetrics();
    registry.counter(
      'cognigate_proof_committer_commitments_total',
      'Total commitments created by proof committer',
      proofMetrics.totalCommitments,
    );
    registry.counter(
      'cognigate_proof_committer_batches_total',
      'Total batches flushed by proof committer',
      proofMetrics.totalBatches,
    );
    registry.gauge(
      'cognigate_proof_committer_buffer_size',
      'Current number of uncommitted proofs in buffer',
      proofMetrics.bufferSize,
    );
    if (proofMetrics.totalBatches > 0) {
      registry.gauge(
        'cognigate_proof_committer_avg_flush_seconds',
        'Average proof batch flush time in seconds',
        proofMetrics.avgFlushTimeMs / 1000,
      );
    }

    // Active agents gauge (from trust store if available)
    if (ctx.trustStore) {
      const agents = await ctx.trustStore.listActiveAgents();
      registry.gauge(
        'cognigate_active_agents',
        'Number of currently active (non-revoked) agents',
        agents.length,
      );
    }
  } catch {
    // Context not initialised -- runtime metrics will be absent.
    // This is fine during startup or in test environments.
  }

  // -------------------------------------------------------------------------
  // 7. Error metrics
  // -------------------------------------------------------------------------
  registry.counter(
    'cognigate_errors_total',
    'Total errors recorded',
    serverMetrics.errorsTotal,
  );

  for (const [errorType, count] of Object.entries(serverMetrics.errorsByType)) {
    registry.counter(
      'cognigate_errors_by_type_total',
      'Errors by type',
      count,
      { type: errorType },
    );
  }

  // Derived error rate (0-1 scale, based on HTTP requests)
  if (serverMetrics.httpRequestsTotal > 0) {
    registry.gauge(
      'cognigate_error_rate',
      'Error rate as a ratio of errors to total HTTP requests',
      serverMetrics.errorsTotal / serverMetrics.httpRequestsTotal,
    );
  }

  return registry.toPrometheusText();
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

export async function metricsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/metrics', {
    schema: {
      description: 'Prometheus metrics endpoint',
      tags: ['metrics'],
      response: {
        200: {
          type: 'string',
          description: 'Prometheus text exposition format',
        },
      },
    },
  }, async (_request, reply) => {
    const text = await collectAllMetrics();

    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(text);
  });
}
