/**
 * Lightweight Prometheus Text Format Exporter
 *
 * Hand-rolled Prometheus exposition format (no prom-client dependency).
 * Supports counters, gauges, and histograms via a simple registry API.
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

/** Supported Prometheus metric types */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Label set for a metric sample */
export type Labels = Record<string, string>;

/** A single metric sample (one line in exposition format) */
export interface MetricSample {
  name: string;
  labels: Labels;
  value: number;
  timestamp?: number;
}

/** Registered metric descriptor */
export interface MetricDescriptor {
  name: string;
  type: MetricType;
  help: string;
  samples: MetricSample[];
}

/** Histogram bucket definition */
export interface HistogramBucket {
  le: number;
  count: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Escape a label value for Prometheus text format.
 * Backslash, double-quote, and newline must be escaped.
 */
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Format labels as `{key="value",...}` or empty string if no labels.
 */
function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return `{${pairs.join(',')}}`;
}

/**
 * Format a numeric value for Prometheus.
 * Special handling for +Inf, -Inf, NaN.
 */
function formatValue(value: number): string {
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  if (Number.isNaN(value)) return 'NaN';
  return String(value);
}

// =============================================================================
// METRICS REGISTRY
// =============================================================================

/**
 * MetricsRegistry
 *
 * Collects counters, gauges, and histogram observations and renders
 * them in the Prometheus text exposition format (version 0.0.4).
 *
 * Usage:
 * ```ts
 * const registry = new MetricsRegistry();
 * registry.counter('http_requests_total', 'Total HTTP requests', 42, { method: 'GET' });
 * registry.gauge('active_agents', 'Number of active agents', 7);
 * const text = registry.toPrometheusText();
 * ```
 */
export class MetricsRegistry {
  private metrics = new Map<string, MetricDescriptor>();

  // ---------------------------------------------------------------------------
  // Registration helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a counter metric (monotonically increasing value).
   */
  counter(name: string, help: string, value: number, labels: Labels = {}): void {
    this.addSample(name, 'counter', help, value, labels);
  }

  /**
   * Register a gauge metric (value that can go up or down).
   */
  gauge(name: string, help: string, value: number, labels: Labels = {}): void {
    this.addSample(name, 'gauge', help, value, labels);
  }

  /**
   * Register a pre-computed histogram.
   *
   * Prometheus histograms are cumulative, so each bucket's count includes
   * all observations <= le.  The caller is responsible for providing
   * cumulative counts.
   */
  histogram(
    name: string,
    help: string,
    buckets: HistogramBucket[],
    sum: number,
    count: number,
    labels: Labels = {},
  ): void {
    const descriptor = this.ensureDescriptor(name, 'histogram', help);

    // Add bucket samples
    for (const bucket of buckets) {
      descriptor.samples.push({
        name: `${name}_bucket`,
        labels: { ...labels, le: bucket.le === Infinity ? '+Inf' : String(bucket.le) },
        value: bucket.count,
      });
    }

    // Ensure +Inf bucket exists
    const hasInf = buckets.some((b) => b.le === Infinity);
    if (!hasInf) {
      descriptor.samples.push({
        name: `${name}_bucket`,
        labels: { ...labels, le: '+Inf' },
        value: count,
      });
    }

    // Sum and count
    descriptor.samples.push({
      name: `${name}_sum`,
      labels,
      value: sum,
    });
    descriptor.samples.push({
      name: `${name}_count`,
      labels,
      value: count,
    });
  }

  // ---------------------------------------------------------------------------
  // General-purpose registration
  // ---------------------------------------------------------------------------

  /**
   * Register a metric with explicit type.
   */
  register(name: string, type: MetricType, help: string, value: number, labels: Labels = {}): void {
    this.addSample(name, type, help, value, labels);
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  /**
   * Render all registered metrics in Prometheus text exposition format.
   */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const descriptor of this.metrics.values()) {
      lines.push(`# HELP ${descriptor.name} ${descriptor.help}`);
      lines.push(`# TYPE ${descriptor.name} ${descriptor.type}`);

      for (const sample of descriptor.samples) {
        const labelStr = formatLabels(sample.labels);
        lines.push(`${sample.name}${labelStr} ${formatValue(sample.value)}`);
      }

      lines.push(''); // Blank line between metric families
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics (useful between scrape cycles in tests).
   */
  reset(): void {
    this.metrics.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private ensureDescriptor(name: string, type: MetricType, help: string): MetricDescriptor {
    let descriptor = this.metrics.get(name);
    if (!descriptor) {
      descriptor = { name, type, help, samples: [] };
      this.metrics.set(name, descriptor);
    }
    return descriptor;
  }

  private addSample(name: string, type: MetricType, help: string, value: number, labels: Labels): void {
    const descriptor = this.ensureDescriptor(name, type, help);
    descriptor.samples.push({ name, labels, value });
  }
}

// =============================================================================
// PROCESS METRICS
// =============================================================================

/**
 * Collect Node.js process-level metrics into the registry.
 * Provides basic runtime observability without external deps.
 */
export function collectProcessMetrics(registry: MetricsRegistry): void {
  const mem = process.memoryUsage();

  registry.gauge(
    'process_resident_memory_bytes',
    'Resident memory size in bytes',
    mem.rss,
  );
  registry.gauge(
    'process_heap_used_bytes',
    'Process heap used in bytes',
    mem.heapUsed,
  );
  registry.gauge(
    'process_heap_total_bytes',
    'Process heap total in bytes',
    mem.heapTotal,
  );
  registry.gauge(
    'nodejs_external_memory_bytes',
    'Node.js external memory size in bytes',
    mem.external,
  );
  registry.gauge(
    'process_uptime_seconds',
    'Process uptime in seconds',
    process.uptime(),
  );
}

// =============================================================================
// SINGLETON & TRACKING COUNTERS
// =============================================================================

/**
 * ServerMetrics
 *
 * Long-lived counters and gauges that accumulate across scrape cycles.
 * The /metrics route reads these and feeds them into a fresh
 * MetricsRegistry on each request.
 */
export class ServerMetrics {
  // HTTP
  httpRequestsTotal = 0;
  httpRequestsByMethod: Record<string, number> = {};
  httpRequestsByStatus: Record<string, number> = {};
  httpRequestDurationSum = 0;
  httpRequestDurationCount = 0;

  // Trust evaluations
  trustEvaluationsTotal = 0;
  trustEvaluationsAllowed = 0;
  trustEvaluationsDenied = 0;

  // Governance decisions
  governanceDecisionsByType: Record<string, number> = {};

  // Proof commits
  proofCommitsTotal = 0;
  proofBatchesTotal = 0;

  // Error tracking
  errorsTotal = 0;
  errorsByType: Record<string, number> = {};

  // ---------------------------------------------------------------------------
  // Recording methods
  // ---------------------------------------------------------------------------

  /** Record an HTTP request completing */
  recordHttpRequest(method: string, statusCode: number, durationMs: number): void {
    this.httpRequestsTotal++;
    this.httpRequestsByMethod[method] = (this.httpRequestsByMethod[method] ?? 0) + 1;

    const statusBucket = `${Math.floor(statusCode / 100)}xx`;
    this.httpRequestsByStatus[statusBucket] = (this.httpRequestsByStatus[statusBucket] ?? 0) + 1;

    this.httpRequestDurationSum += durationMs;
    this.httpRequestDurationCount++;
  }

  /** Record a trust evaluation result */
  recordTrustEvaluation(allowed: boolean): void {
    this.trustEvaluationsTotal++;
    if (allowed) {
      this.trustEvaluationsAllowed++;
    } else {
      this.trustEvaluationsDenied++;
    }
  }

  /** Record a governance decision by type */
  recordGovernanceDecision(decisionType: string): void {
    this.governanceDecisionsByType[decisionType] =
      (this.governanceDecisionsByType[decisionType] ?? 0) + 1;
  }

  /** Record proof commits */
  recordProofCommit(batchSize: number): void {
    this.proofCommitsTotal += batchSize;
    this.proofBatchesTotal++;
  }

  /** Record an error */
  recordError(errorType: string): void {
    this.errorsTotal++;
    this.errorsByType[errorType] = (this.errorsByType[errorType] ?? 0) + 1;
  }
}

/** Singleton server metrics instance */
export const serverMetrics = new ServerMetrics();
