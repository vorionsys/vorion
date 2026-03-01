/**
 * SLA Tracker
 *
 * Enterprise SLA tracking and monitoring for AI gateway.
 * Tracks latency, availability, throughput, and error rates
 * to ensure service level agreements are met.
 *
 * @packageDocumentation
 */

import type { ProviderId } from './health-checker.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * SLA metric types
 */
export type SlaMetricType =
  | 'latency_p50'
  | 'latency_p90'
  | 'latency_p95'
  | 'latency_p99'
  | 'availability'
  | 'error_rate'
  | 'throughput';

/**
 * SLA target definition
 */
export interface SlaTarget {
  metric: SlaMetricType;
  /** Target value (ms for latency, percentage for others) */
  target: number;
  /** Warning threshold */
  warningThreshold: number;
  /** Evaluation window in ms */
  windowMs: number;
}

/**
 * SLA tier configuration
 */
export interface SlaTier {
  name: string;
  targets: SlaTarget[];
  /** Priority for routing decisions */
  priority: number;
  /** Monthly credit percentage if SLA breached */
  creditPercentage: number;
}

/**
 * SLA measurement
 */
export interface SlaMeasurement {
  timestamp: Date;
  provider: ProviderId;
  model?: string;
  tenantId?: string;
  latencyMs: number;
  success: boolean;
  errorType?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * SLA status for a metric
 */
export interface SlaMetricStatus {
  metric: SlaMetricType;
  current: number;
  target: number;
  warningThreshold: number;
  status: 'healthy' | 'warning' | 'breached';
  percentageOfTarget: number;
  trend: 'improving' | 'stable' | 'degrading';
  lastUpdated: Date;
}

/**
 * SLA report
 */
export interface SlaReport {
  provider: ProviderId;
  model?: string;
  tenantId?: string;
  period: { start: Date; end: Date };
  metrics: SlaMetricStatus[];
  overallStatus: 'healthy' | 'warning' | 'breached';
  breachCount: number;
  uptimePercentage: number;
  totalRequests: number;
  successfulRequests: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p90LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

/**
 * SLA tracker configuration
 */
export interface SlaTrackerConfig {
  /** Default SLA targets */
  defaultTargets: SlaTarget[];
  /** Measurement retention period (ms) */
  retentionMs: number;
  /** Aggregation interval (ms) */
  aggregationIntervalMs: number;
  /** Enable real-time alerting */
  enableAlerts: boolean;
  /** Alert callback */
  onAlert?: (alert: SlaAlert) => void;
}

/**
 * SLA alert
 */
export interface SlaAlert {
  id: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
  provider: ProviderId;
  model?: string;
  tenantId?: string;
  metric: SlaMetricType;
  current: number;
  threshold: number;
  message: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_SLA_TARGETS: SlaTarget[] = [
  {
    metric: 'latency_p50',
    target: 1000, // 1 second
    warningThreshold: 800,
    windowMs: 5 * 60 * 1000, // 5 minutes
  },
  {
    metric: 'latency_p95',
    target: 3000, // 3 seconds
    warningThreshold: 2500,
    windowMs: 5 * 60 * 1000,
  },
  {
    metric: 'latency_p99',
    target: 5000, // 5 seconds
    warningThreshold: 4000,
    windowMs: 5 * 60 * 1000,
  },
  {
    metric: 'availability',
    target: 99.9, // 99.9%
    warningThreshold: 99.5,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  {
    metric: 'error_rate',
    target: 0.1, // 0.1%
    warningThreshold: 0.5,
    windowMs: 5 * 60 * 1000,
  },
];

const ENTERPRISE_SLA_TIERS: Record<string, SlaTier> = {
  standard: {
    name: 'Standard',
    priority: 1,
    creditPercentage: 10,
    targets: [
      { metric: 'latency_p95', target: 5000, warningThreshold: 4000, windowMs: 5 * 60 * 1000 },
      { metric: 'availability', target: 99.5, warningThreshold: 99.0, windowMs: 60 * 60 * 1000 },
      { metric: 'error_rate', target: 1.0, warningThreshold: 0.5, windowMs: 5 * 60 * 1000 },
    ],
  },
  professional: {
    name: 'Professional',
    priority: 2,
    creditPercentage: 25,
    targets: [
      { metric: 'latency_p95', target: 3000, warningThreshold: 2500, windowMs: 5 * 60 * 1000 },
      { metric: 'availability', target: 99.9, warningThreshold: 99.5, windowMs: 60 * 60 * 1000 },
      { metric: 'error_rate', target: 0.5, warningThreshold: 0.25, windowMs: 5 * 60 * 1000 },
    ],
  },
  enterprise: {
    name: 'Enterprise',
    priority: 3,
    creditPercentage: 50,
    targets: [
      { metric: 'latency_p95', target: 2000, warningThreshold: 1500, windowMs: 5 * 60 * 1000 },
      { metric: 'latency_p99', target: 3000, warningThreshold: 2500, windowMs: 5 * 60 * 1000 },
      { metric: 'availability', target: 99.99, warningThreshold: 99.95, windowMs: 60 * 60 * 1000 },
      { metric: 'error_rate', target: 0.1, warningThreshold: 0.05, windowMs: 5 * 60 * 1000 },
    ],
  },
};

const DEFAULT_CONFIG: SlaTrackerConfig = {
  defaultTargets: DEFAULT_SLA_TARGETS,
  retentionMs: 24 * 60 * 60 * 1000, // 24 hours
  aggregationIntervalMs: 60 * 1000, // 1 minute
  enableAlerts: true,
};

// =============================================================================
// SLA TRACKER
// =============================================================================

/**
 * Enterprise SLA Tracker
 *
 * Features:
 * - Real-time latency tracking with percentiles
 * - Availability and error rate monitoring
 * - Configurable SLA targets per provider/model/tenant
 * - Trend analysis for proactive alerting
 * - Historical reporting and analytics
 * - Credit calculation for SLA breaches
 */
export class SlaTracker {
  private config: SlaTrackerConfig;
  private measurements: SlaMeasurement[] = [];
  private aggregatedMetrics = new Map<string, AggregatedMetrics>();
  private alerts: SlaAlert[] = [];
  private alertIdCounter = 0;
  private previousMetrics = new Map<string, number>();

  constructor(config?: Partial<SlaTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start cleanup interval
    setInterval(() => this.cleanup(), this.config.aggregationIntervalMs);
  }

  /**
   * Record a measurement
   */
  record(measurement: SlaMeasurement): void {
    this.measurements.push(measurement);

    // Update aggregated metrics
    const key = this.getMetricKey(measurement.provider, measurement.model, measurement.tenantId);
    let metrics = this.aggregatedMetrics.get(key);

    if (!metrics) {
      metrics = this.createEmptyMetrics();
      this.aggregatedMetrics.set(key, metrics);
    }

    // Update metrics
    metrics.totalRequests++;
    if (measurement.success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
      if (measurement.errorType) {
        metrics.errorCounts[measurement.errorType] =
          (metrics.errorCounts[measurement.errorType] ?? 0) + 1;
      }
    }

    metrics.latencies.push(measurement.latencyMs);
    metrics.lastUpdated = new Date();

    // Keep latencies array manageable
    if (metrics.latencies.length > 10000) {
      metrics.latencies = metrics.latencies.slice(-5000);
    }

    // Check SLA targets and generate alerts if needed
    if (this.config.enableAlerts) {
      this.checkAlerts(measurement.provider, measurement.model, measurement.tenantId);
    }
  }

  /**
   * Get SLA report for a provider/model/tenant
   */
  getReport(
    provider: ProviderId,
    options?: {
      model?: string;
      tenantId?: string;
      startTime?: Date;
      endTime?: Date;
    }
  ): SlaReport {
    const key = this.getMetricKey(provider, options?.model, options?.tenantId);
    const metrics = this.aggregatedMetrics.get(key);
    const targets = this.getTargets(options?.tenantId);

    const now = new Date();
    const startTime = options?.startTime ?? new Date(now.getTime() - 60 * 60 * 1000);
    const endTime = options?.endTime ?? now;

    // Filter measurements by time range
    const relevantMeasurements = this.measurements.filter(
      (m) =>
        m.provider === provider &&
        (options?.model === undefined || m.model === options.model) &&
        (options?.tenantId === undefined || m.tenantId === options.tenantId) &&
        m.timestamp >= startTime &&
        m.timestamp <= endTime
    );

    // Calculate percentiles
    const latencies = relevantMeasurements.map((m) => m.latencyMs).sort((a, b) => a - b);
    const p50 = this.percentile(latencies, 50);
    const p90 = this.percentile(latencies, 90);
    const p95 = this.percentile(latencies, 95);
    const p99 = this.percentile(latencies, 99);
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
        : 0;

    // Calculate availability and error rate
    const totalRequests = relevantMeasurements.length;
    const successfulRequests = relevantMeasurements.filter((m) => m.success).length;
    const availability = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;
    const errorRate = totalRequests > 0 ? ((totalRequests - successfulRequests) / totalRequests) * 100 : 0;

    // Build metric statuses
    const metricStatuses: SlaMetricStatus[] = [];
    let breachCount = 0;
    let overallStatus: 'healthy' | 'warning' | 'breached' = 'healthy';

    for (const target of targets) {
      const current = this.getCurrentMetricValue(target.metric, {
        p50,
        p90,
        p95,
        p99,
        availability,
        errorRate,
        throughput: totalRequests / ((endTime.getTime() - startTime.getTime()) / 1000),
      });

      const status = this.getMetricStatus(current, target);
      const previousKey = `${key}:${target.metric}`;
      const previous = this.previousMetrics.get(previousKey);
      const trend = this.calculateTrend(current, previous, target.metric);

      this.previousMetrics.set(previousKey, current);

      if (status === 'breached') {
        breachCount++;
        overallStatus = 'breached';
      } else if (status === 'warning' && overallStatus !== 'breached') {
        overallStatus = 'warning';
      }

      metricStatuses.push({
        metric: target.metric,
        current,
        target: target.target,
        warningThreshold: target.warningThreshold,
        status,
        percentageOfTarget: target.target > 0 ? (current / target.target) * 100 : 0,
        trend,
        lastUpdated: metrics?.lastUpdated ?? now,
      });
    }

    return {
      provider,
      model: options?.model,
      tenantId: options?.tenantId,
      period: { start: startTime, end: endTime },
      metrics: metricStatuses,
      overallStatus,
      breachCount,
      uptimePercentage: availability,
      totalRequests,
      successfulRequests,
      averageLatencyMs: avgLatency,
      p50LatencyMs: p50,
      p90LatencyMs: p90,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
    };
  }

  /**
   * Get current SLA status for quick health checks
   */
  getStatus(
    provider: ProviderId,
    model?: string
  ): { status: 'healthy' | 'warning' | 'breached'; metrics: Record<string, number> } {
    const report = this.getReport(provider, { model });
    return {
      status: report.overallStatus,
      metrics: {
        availability: report.uptimePercentage,
        errorRate: 100 - report.uptimePercentage,
        p50Latency: report.p50LatencyMs,
        p95Latency: report.p95LatencyMs,
        p99Latency: report.p99LatencyMs,
      },
    };
  }

  /**
   * Get all active alerts
   */
  getAlerts(filter?: {
    provider?: ProviderId;
    severity?: 'warning' | 'critical';
    since?: Date;
  }): SlaAlert[] {
    return this.alerts.filter((alert) => {
      if (filter?.provider && alert.provider !== filter.provider) return false;
      if (filter?.severity && alert.severity !== filter.severity) return false;
      if (filter?.since && alert.timestamp < filter.since) return false;
      return true;
    });
  }

  /**
   * Clear an alert
   */
  clearAlert(alertId: string): boolean {
    const index = this.alerts.findIndex((a) => a.id === alertId);
    if (index !== -1) {
      this.alerts.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get SLA tier
   */
  getTier(tierName: string): SlaTier | undefined {
    return ENTERPRISE_SLA_TIERS[tierName];
  }

  /**
   * Calculate SLA credit for a period
   */
  calculateCredit(
    provider: ProviderId,
    tier: SlaTier,
    periodStart: Date,
    periodEnd: Date
  ): { eligible: boolean; creditPercentage: number; breaches: string[] } {
    const report = this.getReport(provider, { startTime: periodStart, endTime: periodEnd });

    if (report.overallStatus === 'breached') {
      const breaches = report.metrics
        .filter((m) => m.status === 'breached')
        .map((m) => `${m.metric}: ${m.current.toFixed(2)} (target: ${m.target})`);

      return {
        eligible: true,
        creditPercentage: tier.creditPercentage,
        breaches,
      };
    }

    return {
      eligible: false,
      creditPercentage: 0,
      breaches: [],
    };
  }

  /**
   * Get provider ranking by SLA performance
   */
  rankProviders(providers: ProviderId[]): Array<{
    provider: ProviderId;
    score: number;
    status: 'healthy' | 'warning' | 'breached';
  }> {
    const rankings = providers.map((provider) => {
      const report = this.getReport(provider);

      // Calculate score (higher is better)
      // Weight: availability (40%), latency (40%), error rate (20%)
      const availabilityScore = report.uptimePercentage;
      const latencyScore = Math.max(0, 100 - (report.p95LatencyMs / 50)); // Lower is better
      const errorScore = Math.max(0, 100 - report.metrics.find((m) => m.metric === 'error_rate')?.current! * 10);

      const score = availabilityScore * 0.4 + latencyScore * 0.4 + errorScore * 0.2;

      return {
        provider,
        score,
        status: report.overallStatus,
      };
    });

    return rankings.sort((a, b) => b.score - a.score);
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private getMetricKey(provider: ProviderId, model?: string, tenantId?: string): string {
    return `${provider}:${model ?? 'all'}:${tenantId ?? 'global'}`;
  }

  private createEmptyMetrics(): AggregatedMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      latencies: [],
      errorCounts: {},
      lastUpdated: new Date(),
    };
  }

  private getTargets(tenantId?: string): SlaTarget[] {
    // In production, look up tenant-specific targets
    // For now, return default targets
    return this.config.defaultTargets;
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)]!;
  }

  private getCurrentMetricValue(
    metric: SlaMetricType,
    values: {
      p50: number;
      p90: number;
      p95: number;
      p99: number;
      availability: number;
      errorRate: number;
      throughput: number;
    }
  ): number {
    switch (metric) {
      case 'latency_p50':
        return values.p50;
      case 'latency_p90':
        return values.p90;
      case 'latency_p95':
        return values.p95;
      case 'latency_p99':
        return values.p99;
      case 'availability':
        return values.availability;
      case 'error_rate':
        return values.errorRate;
      case 'throughput':
        return values.throughput;
    }
  }

  private getMetricStatus(
    current: number,
    target: SlaTarget
  ): 'healthy' | 'warning' | 'breached' {
    // For latency and error_rate, lower is better
    // For availability and throughput, higher is better
    const isLowerBetter = target.metric.startsWith('latency') || target.metric === 'error_rate';

    if (isLowerBetter) {
      if (current > target.target) return 'breached';
      if (current > target.warningThreshold) return 'warning';
      return 'healthy';
    } else {
      if (current < target.target) return 'breached';
      if (current < target.warningThreshold) return 'warning';
      return 'healthy';
    }
  }

  private calculateTrend(
    current: number,
    previous: number | undefined,
    metric: SlaMetricType
  ): 'improving' | 'stable' | 'degrading' {
    if (previous === undefined) return 'stable';

    const changePercent = ((current - previous) / (previous || 1)) * 100;
    const threshold = 5; // 5% change threshold

    const isLowerBetter = metric.startsWith('latency') || metric === 'error_rate';

    if (Math.abs(changePercent) < threshold) return 'stable';

    if (isLowerBetter) {
      return changePercent < 0 ? 'improving' : 'degrading';
    } else {
      return changePercent > 0 ? 'improving' : 'degrading';
    }
  }

  private checkAlerts(
    provider: ProviderId,
    model?: string,
    tenantId?: string
  ): void {
    const report = this.getReport(provider, { model, tenantId });

    for (const metric of report.metrics) {
      if (metric.status === 'breached' || metric.status === 'warning') {
        // Check if we already have a similar alert
        const existingAlert = this.alerts.find(
          (a) =>
            a.provider === provider &&
            a.model === model &&
            a.tenantId === tenantId &&
            a.metric === metric.metric
        );

        if (!existingAlert) {
          const alert: SlaAlert = {
            id: `alert-${++this.alertIdCounter}`,
            timestamp: new Date(),
            severity: metric.status === 'breached' ? 'critical' : 'warning',
            provider,
            model,
            tenantId,
            metric: metric.metric,
            current: metric.current,
            threshold: metric.status === 'breached' ? metric.target : metric.warningThreshold,
            message: `SLA ${metric.status}: ${metric.metric} is ${metric.current.toFixed(2)} ` +
              `(target: ${metric.target})`,
          };

          this.alerts.push(alert);

          // Trigger callback
          this.config.onAlert?.(alert);
        }
      }
    }

    // Keep alerts list manageable
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-500);
    }
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.config.retentionMs);

    // Remove old measurements
    this.measurements = this.measurements.filter((m) => m.timestamp >= cutoff);

    // Remove old alerts
    this.alerts = this.alerts.filter((a) => a.timestamp >= cutoff);
  }
}

/**
 * Aggregated metrics for a provider/model/tenant
 */
interface AggregatedMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencies: number[];
  errorCounts: Record<string, number>;
  lastUpdated: Date;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create SLA tracker instance
 */
export function createSlaTracker(config?: Partial<SlaTrackerConfig>): SlaTracker {
  return new SlaTracker(config);
}

/**
 * Singleton SLA tracker instance
 */
export const slaTracker = new SlaTracker();

// =============================================================================
// PROMETHEUS METRICS INTEGRATION
// =============================================================================

/**
 * Export SLA metrics in Prometheus format
 */
export function exportSlaMetrics(tracker: SlaTracker, providers: ProviderId[]): string {
  const lines: string[] = [
    '# HELP ai_gateway_sla_availability Provider availability percentage',
    '# TYPE ai_gateway_sla_availability gauge',
  ];

  for (const provider of providers) {
    const report = tracker.getReport(provider);
    lines.push(`ai_gateway_sla_availability{provider="${provider}"} ${report.uptimePercentage}`);
  }

  lines.push('');
  lines.push('# HELP ai_gateway_sla_latency_p95 95th percentile latency in ms');
  lines.push('# TYPE ai_gateway_sla_latency_p95 gauge');

  for (const provider of providers) {
    const report = tracker.getReport(provider);
    lines.push(`ai_gateway_sla_latency_p95{provider="${provider}"} ${report.p95LatencyMs}`);
  }

  lines.push('');
  lines.push('# HELP ai_gateway_sla_error_rate Error rate percentage');
  lines.push('# TYPE ai_gateway_sla_error_rate gauge');

  for (const provider of providers) {
    const report = tracker.getReport(provider);
    const errorRate = report.totalRequests > 0
      ? ((report.totalRequests - report.successfulRequests) / report.totalRequests) * 100
      : 0;
    lines.push(`ai_gateway_sla_error_rate{provider="${provider}"} ${errorRate}`);
  }

  lines.push('');
  lines.push('# HELP ai_gateway_sla_breaches_total Total number of SLA breaches');
  lines.push('# TYPE ai_gateway_sla_breaches_total counter');

  for (const provider of providers) {
    const report = tracker.getReport(provider);
    lines.push(`ai_gateway_sla_breaches_total{provider="${provider}"} ${report.breachCount}`);
  }

  return lines.join('\n');
}
