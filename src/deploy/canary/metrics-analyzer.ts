/**
 * Vorion Security Platform - Canary Metrics Analyzer
 * Compares canary vs baseline metrics with statistical analysis
 */

import {
  MetricsComparison,
  MetricsSummary,
  StatisticalSummary,
  StatisticalComparison,
  ComparisonResult,
  HealthAssessment,
  MetricHealthAssessment,
  Anomaly,
  TimeSeriesData,
  MetricThreshold,
  CollectedMetrics,
  LatencyMetrics,
  Logger,
} from './types';

// ============================================================================
// Statistical Utilities
// ============================================================================

/**
 * Calculate mean of an array of numbers
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate median of an array of numbers
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate variance of an array of numbers
 */
function calculateVariance(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const avg = mean ?? calculateMean(values);
  return values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (values.length - 1);
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean?: number): number {
  return Math.sqrt(calculateVariance(values, mean));
}

/**
 * Calculate statistical summary for a set of values
 */
function calculateStatisticalSummary(values: number[]): StatisticalSummary {
  if (values.length === 0) {
    return {
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      variance: 0,
    };
  }

  const mean = calculateMean(values);
  const variance = calculateVariance(values, mean);

  return {
    mean,
    median: calculateMedian(values),
    stdDev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    variance,
  };
}

/**
 * Welch's t-test for comparing two independent samples
 * Returns p-value
 */
function welchTTest(sample1: number[], sample2: number[]): number {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 < 2 || n2 < 2) return 1; // Not enough samples

  const mean1 = calculateMean(sample1);
  const mean2 = calculateMean(sample2);
  const var1 = calculateVariance(sample1, mean1);
  const var2 = calculateVariance(sample2, mean2);

  // Welch's t-statistic
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) return 1;

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const v1 = var1 / n1;
  const v2 = var2 / n2;
  const df = Math.pow(v1 + v2, 2) / (Math.pow(v1, 2) / (n1 - 1) + Math.pow(v2, 2) / (n2 - 1));

  // Approximate p-value using t-distribution
  return approximatePValue(Math.abs(t), df);
}

/**
 * Approximate p-value for t-distribution
 * Uses approximation formula for two-tailed test
 */
function approximatePValue(t: number, df: number): number {
  // Use a simple approximation based on the t-distribution
  // For more accuracy, consider using a proper statistical library
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;

  // Incomplete beta function approximation
  const beta = incompleteBeta(x, a, b);
  return beta;
}

/**
 * Simple incomplete beta function approximation
 */
function incompleteBeta(x: number, a: number, b: number): number {
  // Using continued fraction approximation
  const maxIterations = 100;
  const epsilon = 1e-10;

  if (x === 0) return 0;
  if (x === 1) return 1;

  let result = 0;
  let term = 1;

  for (let i = 0; i < maxIterations; i++) {
    term *= (a + i) * x / (a + b + i);
    result += term / (a + i + 1);
    if (Math.abs(term) < epsilon) break;
  }

  return Math.min(1, Math.max(0, result * Math.pow(x, a) * Math.pow(1 - x, b) / a));
}

/**
 * Calculate confidence interval for the difference between two means
 */
function calculateConfidenceInterval(
  sample1: number[],
  sample2: number[],
  confidence: number = 0.95
): { lower: number; upper: number } {
  const mean1 = calculateMean(sample1);
  const mean2 = calculateMean(sample2);
  const diff = mean1 - mean2;

  const n1 = sample1.length;
  const n2 = sample2.length;
  const var1 = calculateVariance(sample1, mean1);
  const var2 = calculateVariance(sample2, mean2);

  const se = Math.sqrt(var1 / n1 + var2 / n2);

  // Z-score for confidence level (approximation)
  const zScores: Record<number, number> = {
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  };
  const z = zScores[confidence] || 1.96;

  return {
    lower: diff - z * se,
    upper: diff + z * se,
  };
}

// ============================================================================
// Anomaly Detection
// ============================================================================

/**
 * Detect anomalies using Z-score method
 */
function detectZScoreAnomalies(
  values: TimeSeriesData[],
  metric: string,
  threshold: number = 3
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const numericValues = values.map(v => v.value);
  const mean = calculateMean(numericValues);
  const stdDev = calculateStdDev(numericValues, mean);

  if (stdDev === 0) return anomalies;

  for (const point of values) {
    const zScore = Math.abs((point.value - mean) / stdDev);
    if (zScore > threshold) {
      const severity = zScore > 5 ? 'critical' : zScore > 4 ? 'high' : zScore > 3 ? 'medium' : 'low';
      anomalies.push({
        type: point.value > mean ? 'spike' : 'drop',
        metric,
        severity,
        timestamp: point.timestamp,
        description: `${metric} value ${point.value.toFixed(2)} is ${zScore.toFixed(1)} standard deviations from mean`,
        expected: mean,
        actual: point.value,
      });
    }
  }

  return anomalies;
}

/**
 * Detect trend anomalies using linear regression
 */
function detectTrendAnomalies(
  values: TimeSeriesData[],
  metric: string,
  slopeThreshold: number = 0.1
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (values.length < 10) return anomalies;

  // Simple linear regression
  const n = values.length;
  const xValues = values.map((_, i) => i);
  const yValues = values.map(v => v.value);

  const xMean = calculateMean(xValues);
  const yMean = calculateMean(yValues);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
    denominator += Math.pow(xValues[i] - xMean, 2);
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const normalizedSlope = slope / (yMean || 1);

  if (Math.abs(normalizedSlope) > slopeThreshold) {
    const direction = slope > 0 ? 'increasing' : 'decreasing';
    anomalies.push({
      type: 'trend',
      metric,
      severity: Math.abs(normalizedSlope) > 0.5 ? 'high' : 'medium',
      timestamp: values[values.length - 1].timestamp,
      description: `${metric} shows significant ${direction} trend (${(normalizedSlope * 100).toFixed(1)}% change rate)`,
    });
  }

  return anomalies;
}

/**
 * Detect outliers using IQR method
 */
function detectIQROutliers(
  values: TimeSeriesData[],
  metric: string,
  multiplier: number = 1.5
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const n = sorted.length;

  if (n < 4) return anomalies;

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = sorted[q1Index].value;
  const q3 = sorted[q3Index].value;
  const iqr = q3 - q1;

  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  for (const point of values) {
    if (point.value < lowerBound || point.value > upperBound) {
      anomalies.push({
        type: 'outlier',
        metric,
        severity: 'medium',
        timestamp: point.timestamp,
        description: `${metric} value ${point.value.toFixed(2)} is outside IQR bounds [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`,
        expected: (q1 + q3) / 2,
        actual: point.value,
      });
    }
  }

  return anomalies;
}

// ============================================================================
// Metrics Analyzer Class
// ============================================================================

export interface MetricsAnalyzerConfig {
  /** Significance level for statistical tests (default: 0.05) */
  significanceLevel?: number;
  /** Z-score threshold for anomaly detection (default: 3) */
  anomalyZScoreThreshold?: number;
  /** Minimum samples required for analysis (default: 30) */
  minSamples?: number;
  /** Enable trend detection (default: true) */
  enableTrendDetection?: boolean;
  /** Logger instance */
  logger?: Logger;
}

export class MetricsAnalyzer {
  private readonly significanceLevel: number;
  private readonly anomalyZScoreThreshold: number;
  private readonly minSamples: number;
  private readonly enableTrendDetection: boolean;
  private readonly logger?: Logger;

  constructor(config: MetricsAnalyzerConfig = {}) {
    this.significanceLevel = config.significanceLevel ?? 0.05;
    this.anomalyZScoreThreshold = config.anomalyZScoreThreshold ?? 3;
    this.minSamples = config.minSamples ?? 30;
    this.enableTrendDetection = config.enableTrendDetection ?? true;
    this.logger = config.logger;
  }

  /**
   * Compare canary metrics against baseline metrics
   */
  async compare(
    baselineMetrics: CollectedMetrics,
    canaryMetrics: CollectedMetrics,
    thresholds: MetricThreshold[]
  ): Promise<MetricsComparison> {
    this.logger?.info('Starting metrics comparison');

    const baseline = this.summarizeMetrics(baselineMetrics, 'baseline');
    const canary = this.summarizeMetrics(canaryMetrics, 'canary');
    const comparison = this.performStatisticalComparison(baselineMetrics, canaryMetrics);
    const anomalies = this.detectAnomalies(canaryMetrics);
    const health = this.assessHealth(baseline, canary, comparison, thresholds, anomalies);

    this.logger?.info(`Metrics comparison complete. Health status: ${health.status}`);

    return {
      baseline,
      canary,
      comparison,
      health,
      anomalies,
    };
  }

  /**
   * Summarize collected metrics into statistical summaries
   */
  private summarizeMetrics(metrics: CollectedMetrics, label: string): MetricsSummary {
    const errorRateValues = metrics.errorRate.map(d => d.value);
    const requestCountValues = metrics.requestCount.map(d => d.value);

    const timestamps = [
      ...metrics.errorRate.map(d => d.timestamp),
      ...metrics.requestCount.map(d => d.timestamp),
    ];

    const timeRange = {
      start: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : new Date(),
      end: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : new Date(),
    };

    this.logger?.debug(`Summarizing ${label} metrics: ${errorRateValues.length} error rate samples`);

    return {
      sampleCount: errorRateValues.length,
      timeRange,
      errorRate: calculateStatisticalSummary(errorRateValues),
      latency: {
        p50: calculateStatisticalSummary(metrics.latency.p50.map(d => d.value)),
        p95: calculateStatisticalSummary(metrics.latency.p95.map(d => d.value)),
        p99: calculateStatisticalSummary(metrics.latency.p99.map(d => d.value)),
      },
      requestRate: calculateStatisticalSummary(requestCountValues),
    };
  }

  /**
   * Perform statistical comparison between baseline and canary
   */
  private performStatisticalComparison(
    baseline: CollectedMetrics,
    canary: CollectedMetrics
  ): StatisticalComparison {
    return {
      errorRateDiff: this.compareMetric(
        baseline.errorRate.map(d => d.value),
        canary.errorRate.map(d => d.value)
      ),
      latencyDiff: {
        p50: this.compareMetric(
          baseline.latency.p50.map(d => d.value),
          canary.latency.p50.map(d => d.value)
        ),
        p95: this.compareMetric(
          baseline.latency.p95.map(d => d.value),
          canary.latency.p95.map(d => d.value)
        ),
        p99: this.compareMetric(
          baseline.latency.p99.map(d => d.value),
          canary.latency.p99.map(d => d.value)
        ),
      },
      requestRateDiff: this.compareMetric(
        baseline.requestCount.map(d => d.value),
        canary.requestCount.map(d => d.value)
      ),
    };
  }

  /**
   * Compare a single metric between baseline and canary
   */
  private compareMetric(baseline: number[], canary: number[]): ComparisonResult {
    const baselineMean = calculateMean(baseline);
    const canaryMean = calculateMean(canary);

    const absoluteDiff = canaryMean - baselineMean;
    const relativeDiff = baselineMean !== 0 ? (absoluteDiff / baselineMean) * 100 : 0;
    const pValue = welchTTest(baseline, canary);
    const confidenceInterval = calculateConfidenceInterval(canary, baseline);

    return {
      absoluteDiff,
      relativeDiff,
      pValue,
      significant: pValue < this.significanceLevel,
      confidenceInterval,
    };
  }

  /**
   * Detect anomalies in canary metrics
   */
  detectAnomalies(metrics: CollectedMetrics): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Error rate anomalies
    anomalies.push(...detectZScoreAnomalies(metrics.errorRate, 'error_rate', this.anomalyZScoreThreshold));
    anomalies.push(...detectIQROutliers(metrics.errorRate, 'error_rate'));

    // Latency anomalies
    const latencyMetrics: Array<{ data: TimeSeriesData[]; name: string }> = [
      { data: metrics.latency.p50, name: 'latency_p50' },
      { data: metrics.latency.p95, name: 'latency_p95' },
      { data: metrics.latency.p99, name: 'latency_p99' },
    ];

    for (const { data, name } of latencyMetrics) {
      anomalies.push(...detectZScoreAnomalies(data, name, this.anomalyZScoreThreshold));
      if (this.enableTrendDetection) {
        anomalies.push(...detectTrendAnomalies(data, name));
      }
    }

    // Request count anomalies
    anomalies.push(...detectZScoreAnomalies(metrics.requestCount, 'request_count', this.anomalyZScoreThreshold));

    // Custom metrics anomalies
    for (const [name, data] of Object.entries(metrics.custom)) {
      anomalies.push(...detectZScoreAnomalies(data, name, this.anomalyZScoreThreshold));
    }

    // Sort by severity and timestamp
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    anomalies.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    this.logger?.info(`Detected ${anomalies.length} anomalies`);
    return anomalies;
  }

  /**
   * Assess overall health based on metrics and thresholds
   */
  private assessHealth(
    baseline: MetricsSummary,
    canary: MetricsSummary,
    comparison: StatisticalComparison,
    thresholds: MetricThreshold[],
    anomalies: Anomaly[]
  ): HealthAssessment {
    const metricAssessments: MetricHealthAssessment[] = [];
    let totalScore = 100;
    const recommendations: string[] = [];

    // Evaluate each threshold
    for (const threshold of thresholds) {
      const assessment = this.evaluateThreshold(threshold, canary, comparison);
      metricAssessments.push(assessment);

      if (assessment.status === 'fail') {
        totalScore -= threshold.critical ? 50 : 20;
        recommendations.push(`Address ${threshold.metric}: ${assessment.message}`);
      } else if (assessment.status === 'warn') {
        totalScore -= 10;
      }
    }

    // Penalize for anomalies
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical').length;
    const highAnomalies = anomalies.filter(a => a.severity === 'high').length;
    totalScore -= criticalAnomalies * 20 + highAnomalies * 10;

    if (criticalAnomalies > 0) {
      recommendations.push(`Investigate ${criticalAnomalies} critical anomalies`);
    }

    // Check for significant statistical differences
    if (comparison.errorRateDiff.significant && comparison.errorRateDiff.relativeDiff > 10) {
      totalScore -= 15;
      recommendations.push('Error rate shows significant increase compared to baseline');
    }

    if (comparison.latencyDiff.p99.significant && comparison.latencyDiff.p99.relativeDiff > 20) {
      totalScore -= 10;
      recommendations.push('P99 latency shows significant increase');
    }

    // Ensure score is within bounds
    totalScore = Math.max(0, Math.min(100, totalScore));

    // Determine status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (totalScore >= 80) {
      status = 'healthy';
    } else if (totalScore >= 50) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      score: totalScore,
      metrics: metricAssessments,
      recommendations,
    };
  }

  /**
   * Evaluate a single threshold against canary metrics
   */
  private evaluateThreshold(
    threshold: MetricThreshold,
    canary: MetricsSummary,
    comparison: StatisticalComparison
  ): MetricHealthAssessment {
    let value: number;

    // Get the current value for the metric
    switch (threshold.metric) {
      case 'error_rate':
        value = canary.errorRate.mean;
        break;
      case 'latency_p50':
        value = canary.latency.p50.mean;
        break;
      case 'latency_p95':
        value = canary.latency.p95.mean;
        break;
      case 'latency_p99':
        value = canary.latency.p99.mean;
        break;
      case 'request_rate':
        value = canary.requestRate.mean;
        break;
      default:
        // For custom metrics, default to 0
        value = 0;
    }

    // Evaluate against threshold
    let pass: boolean;
    switch (threshold.operator) {
      case 'lt':
        pass = value < threshold.threshold;
        break;
      case 'lte':
        pass = value <= threshold.threshold;
        break;
      case 'gt':
        pass = value > threshold.threshold;
        break;
      case 'gte':
        pass = value >= threshold.threshold;
        break;
      case 'eq':
        pass = value === threshold.threshold;
        break;
      case 'ne':
        pass = value !== threshold.threshold;
        break;
      default:
        pass = true;
    }

    // Determine status and message
    let status: 'pass' | 'warn' | 'fail';
    let message: string;

    if (pass) {
      status = 'pass';
      message = `${threshold.metric} (${value.toFixed(2)}) meets threshold (${threshold.operator} ${threshold.threshold})`;
    } else {
      status = threshold.critical ? 'fail' : 'warn';
      message = `${threshold.metric} (${value.toFixed(2)}) violates threshold (${threshold.operator} ${threshold.threshold})`;
    }

    return {
      metric: threshold.metric,
      status,
      value,
      threshold: threshold.threshold,
      message,
    };
  }

  /**
   * Check if canary should be promoted based on metrics
   */
  async shouldPromote(
    comparison: MetricsComparison,
    requiredSuccessRate: number
  ): Promise<{ shouldPromote: boolean; reason: string }> {
    // Check health status
    if (comparison.health.status === 'unhealthy') {
      return {
        shouldPromote: false,
        reason: `Health status is unhealthy (score: ${comparison.health.score})`,
      };
    }

    // Check for critical anomalies
    const criticalAnomalies = comparison.anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      return {
        shouldPromote: false,
        reason: `${criticalAnomalies.length} critical anomalies detected`,
      };
    }

    // Check for significant error rate increase
    if (comparison.comparison.errorRateDiff.significant &&
        comparison.comparison.errorRateDiff.relativeDiff > 10) {
      return {
        shouldPromote: false,
        reason: `Error rate increased by ${comparison.comparison.errorRateDiff.relativeDiff.toFixed(1)}% (statistically significant)`,
      };
    }

    // Check health score against required success rate
    const effectiveSuccessRate = comparison.health.score / 100;
    if (effectiveSuccessRate < requiredSuccessRate) {
      return {
        shouldPromote: false,
        reason: `Success rate ${(effectiveSuccessRate * 100).toFixed(1)}% is below required ${(requiredSuccessRate * 100).toFixed(1)}%`,
      };
    }

    return {
      shouldPromote: true,
      reason: `All checks passed. Health score: ${comparison.health.score}, no critical issues detected`,
    };
  }

  /**
   * Check if canary should be rolled back based on metrics
   */
  async shouldRollback(
    comparison: MetricsComparison,
    failureThreshold: number
  ): Promise<{ shouldRollback: boolean; reason: string }> {
    // Immediate rollback on critical failures
    const criticalFailures = comparison.health.metrics.filter(m => m.status === 'fail').length;
    if (criticalFailures >= failureThreshold) {
      return {
        shouldRollback: true,
        reason: `${criticalFailures} critical metric failures detected`,
      };
    }

    // Rollback on severe health degradation
    if (comparison.health.status === 'unhealthy' && comparison.health.score < 30) {
      return {
        shouldRollback: true,
        reason: `Severe health degradation (score: ${comparison.health.score})`,
      };
    }

    // Rollback on multiple high-severity anomalies
    const highSeverityAnomalies = comparison.anomalies.filter(
      a => a.severity === 'critical' || a.severity === 'high'
    );
    if (highSeverityAnomalies.length >= 5) {
      return {
        shouldRollback: true,
        reason: `${highSeverityAnomalies.length} high-severity anomalies detected`,
      };
    }

    return {
      shouldRollback: false,
      reason: 'No rollback conditions met',
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new metrics analyzer instance
 */
export function createMetricsAnalyzer(config?: MetricsAnalyzerConfig): MetricsAnalyzer {
  return new MetricsAnalyzer(config);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create empty collected metrics structure
 */
export function createEmptyMetrics(): CollectedMetrics {
  return {
    errorRate: [],
    latency: {
      p50: [],
      p75: [],
      p90: [],
      p95: [],
      p99: [],
    },
    requestCount: [],
    custom: {},
  };
}

/**
 * Merge multiple metrics collections
 */
export function mergeMetrics(...collections: CollectedMetrics[]): CollectedMetrics {
  const merged = createEmptyMetrics();

  for (const collection of collections) {
    merged.errorRate.push(...collection.errorRate);
    merged.latency.p50.push(...collection.latency.p50);
    merged.latency.p75.push(...collection.latency.p75);
    merged.latency.p90.push(...collection.latency.p90);
    merged.latency.p95.push(...collection.latency.p95);
    merged.latency.p99.push(...collection.latency.p99);
    merged.requestCount.push(...collection.requestCount);

    for (const [key, data] of Object.entries(collection.custom)) {
      if (!merged.custom[key]) {
        merged.custom[key] = [];
      }
      merged.custom[key].push(...data);
    }
  }

  // Sort all arrays by timestamp
  const sortByTimestamp = (a: TimeSeriesData, b: TimeSeriesData) =>
    a.timestamp.getTime() - b.timestamp.getTime();

  merged.errorRate.sort(sortByTimestamp);
  merged.latency.p50.sort(sortByTimestamp);
  merged.latency.p75.sort(sortByTimestamp);
  merged.latency.p90.sort(sortByTimestamp);
  merged.latency.p95.sort(sortByTimestamp);
  merged.latency.p99.sort(sortByTimestamp);
  merged.requestCount.sort(sortByTimestamp);

  for (const key of Object.keys(merged.custom)) {
    merged.custom[key].sort(sortByTimestamp);
  }

  return merged;
}
