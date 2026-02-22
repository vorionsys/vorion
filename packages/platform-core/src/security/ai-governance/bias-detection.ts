/**
 * Bias Detection and Monitoring
 * Monitors AI model outputs for bias and fairness metrics
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  BiasDetectionResult,
  BiasMetrics,
  BiasAlert,
  BiasAlertSeverity,
  DemographicParityMetric,
  EqualOpportunityMetric,
  ResponseConsistencyMetric,
  RepresentationGapMetric,
} from './types.js';

/**
 * Bias detection configuration
 */
export interface BiasDetectionConfig {
  enabled: boolean;
  alertThresholds: BiasThresholds;
  monitoringFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
  protectedAttributes: string[];
  minimumSampleSize: number;
  significanceLevel: number;
  customMetrics: CustomMetricDefinition[];
  alertRecipients: string[];
  retentionDays: number;
}

/**
 * Bias thresholds for alerting
 */
export interface BiasThresholds {
  demographicParity: number;
  equalOpportunity: number;
  responseConsistency: number;
  representationGap: number;
  overallScore: number;
}

/**
 * Custom metric definition
 */
export interface CustomMetricDefinition {
  id: string;
  name: string;
  calculate: (samples: BiasSample[]) => number;
  threshold: number;
  higherIsBetter: boolean;
}

/**
 * Sample for bias analysis
 */
export interface BiasSample {
  id: string;
  modelId: string;
  timestamp: Date;
  input: string;
  output: string;
  attributes: Record<string, string>;
  outcome?: 'positive' | 'negative' | 'neutral';
  confidence?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Group statistics for bias calculation
 */
interface GroupStats {
  count: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  avgConfidence: number;
  responses: string[];
}

/**
 * Bias sample storage interface
 */
export interface BiasSampleStorage {
  save(sample: BiasSample): Promise<void>;
  getSamples(
    modelId: string,
    startDate: Date,
    endDate: Date,
    limit?: number
  ): Promise<BiasSample[]>;
  getSamplesByAttribute(
    modelId: string,
    attribute: string,
    value: string,
    startDate: Date,
    endDate: Date
  ): Promise<BiasSample[]>;
  deleteOlderThan(date: Date): Promise<number>;
}

/**
 * In-memory bias sample storage
 */
export class InMemoryBiasSampleStorage implements BiasSampleStorage {
  private samples: Map<string, BiasSample> = new Map();

  async save(sample: BiasSample): Promise<void> {
    this.samples.set(sample.id, { ...sample });
  }

  async getSamples(
    modelId: string,
    startDate: Date,
    endDate: Date,
    limit?: number
  ): Promise<BiasSample[]> {
    const results = Array.from(this.samples.values())
      .filter(
        (s) =>
          s.modelId === modelId &&
          s.timestamp >= startDate &&
          s.timestamp <= endDate
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return limit ? results.slice(0, limit) : results;
  }

  async getSamplesByAttribute(
    modelId: string,
    attribute: string,
    value: string,
    startDate: Date,
    endDate: Date
  ): Promise<BiasSample[]> {
    return Array.from(this.samples.values()).filter(
      (s) =>
        s.modelId === modelId &&
        s.timestamp >= startDate &&
        s.timestamp <= endDate &&
        s.attributes[attribute] === value
    );
  }

  async deleteOlderThan(date: Date): Promise<number> {
    let deleted = 0;
    for (const [id, sample] of this.samples.entries()) {
      if (sample.timestamp < date) {
        this.samples.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

/**
 * Bias alert storage interface
 */
export interface BiasAlertStorage {
  save(alert: BiasAlert): Promise<void>;
  get(alertId: string): Promise<BiasAlert | null>;
  getUnacknowledged(modelId?: string): Promise<BiasAlert[]>;
  acknowledge(alertId: string): Promise<void>;
  resolve(alertId: string, resolution: string): Promise<void>;
  list(modelId?: string, limit?: number): Promise<BiasAlert[]>;
}

/**
 * In-memory bias alert storage
 */
export class InMemoryBiasAlertStorage implements BiasAlertStorage {
  private alerts: Map<string, BiasAlert> = new Map();

  async save(alert: BiasAlert): Promise<void> {
    this.alerts.set(alert.id, { ...alert });
  }

  async get(alertId: string): Promise<BiasAlert | null> {
    const alert = this.alerts.get(alertId);
    return alert ? { ...alert } : null;
  }

  async getUnacknowledged(modelId?: string): Promise<BiasAlert[]> {
    return Array.from(this.alerts.values()).filter(
      (a) => !a.acknowledged && (!modelId || a.id.includes(modelId))
    );
  }

  async acknowledge(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.alerts.set(alertId, alert);
    }
  }

  async resolve(alertId: string, resolution: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      alert.resolution = resolution;
      this.alerts.set(alertId, alert);
    }
  }

  async list(modelId?: string, limit?: number): Promise<BiasAlert[]> {
    let results = Array.from(this.alerts.values());
    if (modelId) {
      results = results.filter((a) => a.id.includes(modelId));
    }
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return limit ? results.slice(0, limit) : results;
  }
}

/**
 * Bias Detection System
 * Monitors and analyzes AI model outputs for bias
 */
export class BiasDetector extends EventEmitter {
  private config: BiasDetectionConfig;
  private sampleStorage: BiasSampleStorage;
  private alertStorage: BiasAlertStorage;
  private analysisCache: Map<string, BiasDetectionResult> = new Map();

  constructor(
    config?: Partial<BiasDetectionConfig>,
    sampleStorage?: BiasSampleStorage,
    alertStorage?: BiasAlertStorage
  ) {
    super();
    this.config = {
      enabled: true,
      alertThresholds: {
        demographicParity: 0.8,
        equalOpportunity: 0.8,
        responseConsistency: 0.85,
        representationGap: 0.7,
        overallScore: 0.75,
      },
      monitoringFrequency: 'daily',
      protectedAttributes: ['gender', 'age_group', 'ethnicity', 'location'],
      minimumSampleSize: 100,
      significanceLevel: 0.05,
      customMetrics: [],
      alertRecipients: [],
      retentionDays: 90,
      ...config,
    };
    this.sampleStorage = sampleStorage || new InMemoryBiasSampleStorage();
    this.alertStorage = alertStorage || new InMemoryBiasAlertStorage();
  }

  /**
   * Record a sample for bias analysis
   */
  async recordSample(sample: Omit<BiasSample, 'id'>): Promise<BiasSample> {
    const fullSample: BiasSample = {
      ...sample,
      id: `sample-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    };

    await this.sampleStorage.save(fullSample);

    // Trigger realtime analysis if configured
    if (this.config.monitoringFrequency === 'realtime') {
      await this.checkForBiasRealtime(fullSample);
    }

    return fullSample;
  }

  /**
   * Perform bias analysis for a model
   */
  async analyzeModel(
    modelId: string,
    period: { start: Date; end: Date }
  ): Promise<BiasDetectionResult> {
    if (!this.config.enabled) {
      return this.createDisabledResult(modelId);
    }

    const samples = await this.sampleStorage.getSamples(modelId, period.start, period.end);

    if (samples.length < this.config.minimumSampleSize) {
      return this.createInsufficientDataResult(modelId, samples.length);
    }

    // Calculate metrics
    const demographicParity = this.calculateDemographicParity(samples);
    const equalOpportunity = this.calculateEqualOpportunity(samples);
    const responseConsistency = this.calculateResponseConsistency(samples);
    const representationGap = this.calculateRepresentationGap(samples);

    // Calculate custom metrics
    const customMetrics: Record<string, number> = {};
    for (const metric of this.config.customMetrics) {
      customMetrics[metric.id] = metric.calculate(samples);
    }

    const metrics: BiasMetrics = {
      demographicParity,
      equalOpportunity,
      responseConsistency,
      representationGap,
      customMetrics,
    };

    // Generate alerts
    const alerts = this.generateAlerts(modelId, metrics);

    // Save alerts
    for (const alert of alerts) {
      await this.alertStorage.save(alert);
    }

    // Calculate overall score
    const overallScore = this.calculateOverallScore(metrics);
    const passesThreshold = overallScore >= this.config.alertThresholds.overallScore;

    // Generate recommendations
    const recommendations = this.generateRecommendations(metrics, alerts);

    const result: BiasDetectionResult = {
      modelId,
      analysisId: `analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      metrics,
      alerts,
      recommendations,
      overallScore,
      passesThreshold,
    };

    // Cache result
    this.analysisCache.set(`${modelId}:${period.start.toISOString()}:${period.end.toISOString()}`, result);

    if (alerts.length > 0) {
      this.emit('bias:detected', result);
    }

    return result;
  }

  /**
   * Calculate demographic parity metric
   */
  private calculateDemographicParity(samples: BiasSample[]): DemographicParityMetric {
    const groupScores: Record<string, number> = {};
    let maxDisparity = 0;

    for (const attribute of this.config.protectedAttributes) {
      const groups = this.groupSamplesByAttribute(samples, attribute);
      const groupRates: Record<string, number> = {};

      for (const [groupName, groupSamples] of Object.entries(groups)) {
        const positiveRate =
          groupSamples.filter((s) => s.outcome === 'positive').length / groupSamples.length;
        groupRates[`${attribute}:${groupName}`] = positiveRate;
        groupScores[`${attribute}:${groupName}`] = positiveRate;
      }

      // Calculate disparity within this attribute
      const rates = Object.values(groupRates);
      if (rates.length >= 2) {
        const disparity = Math.max(...rates) - Math.min(...rates);
        maxDisparity = Math.max(maxDisparity, disparity);
      }
    }

    const score = Math.max(0, 1 - maxDisparity);
    const passes = score >= this.config.alertThresholds.demographicParity;

    return {
      score,
      threshold: this.config.alertThresholds.demographicParity,
      passes,
      groupScores,
      maxDisparity,
    };
  }

  /**
   * Calculate equal opportunity metric
   */
  private calculateEqualOpportunity(samples: BiasSample[]): EqualOpportunityMetric {
    const truePositiveRates: Record<string, number> = {};
    const falsePositiveRates: Record<string, number> = {};

    for (const attribute of this.config.protectedAttributes) {
      const groups = this.groupSamplesByAttribute(samples, attribute);

      for (const [groupName, groupSamples] of Object.entries(groups)) {
        const key = `${attribute}:${groupName}`;

        // Calculate TPR (assuming outcome is the ground truth)
        const positives = groupSamples.filter((s) => s.outcome === 'positive');
        const tpr = positives.length > 0
          ? positives.filter((s) => (s.confidence || 0) > 0.5).length / positives.length
          : 0;
        truePositiveRates[key] = tpr;

        // Calculate FPR
        const negatives = groupSamples.filter((s) => s.outcome === 'negative');
        const fpr = negatives.length > 0
          ? negatives.filter((s) => (s.confidence || 0) > 0.5).length / negatives.length
          : 0;
        falsePositiveRates[key] = fpr;
      }
    }

    // Calculate score based on TPR disparity
    const tprValues = Object.values(truePositiveRates);
    const tprDisparity = tprValues.length >= 2
      ? Math.max(...tprValues) - Math.min(...tprValues)
      : 0;

    const score = Math.max(0, 1 - tprDisparity);
    const passes = score >= this.config.alertThresholds.equalOpportunity;

    return {
      score,
      threshold: this.config.alertThresholds.equalOpportunity,
      passes,
      truePositiveRates,
      falsePositiveRates,
    };
  }

  /**
   * Calculate response consistency metric
   */
  private calculateResponseConsistency(samples: BiasSample[]): ResponseConsistencyMetric {
    const variationByGroup: Record<string, number> = {};
    let totalSimilarity = 0;
    let comparisons = 0;

    for (const attribute of this.config.protectedAttributes) {
      const groups = this.groupSamplesByAttribute(samples, attribute);
      const groupResponses: string[][] = [];

      for (const [groupName, groupSamples] of Object.entries(groups)) {
        const responses = groupSamples.map((s) => s.output);
        groupResponses.push(responses);

        // Calculate within-group variation
        const variation = this.calculateResponseVariation(responses);
        variationByGroup[`${attribute}:${groupName}`] = variation;
      }

      // Calculate cross-group similarity
      for (let i = 0; i < groupResponses.length; i++) {
        for (let j = i + 1; j < groupResponses.length; j++) {
          const similarity = this.calculateCrossGroupSimilarity(
            groupResponses[i],
            groupResponses[j]
          );
          totalSimilarity += similarity;
          comparisons++;
        }
      }
    }

    const semanticSimilarityScore = comparisons > 0 ? totalSimilarity / comparisons : 1;
    const avgVariation =
      Object.values(variationByGroup).reduce((a, b) => a + b, 0) /
      Object.values(variationByGroup).length || 0;
    const score = (semanticSimilarityScore + (1 - avgVariation)) / 2;
    const passes = score >= this.config.alertThresholds.responseConsistency;

    return {
      score,
      threshold: this.config.alertThresholds.responseConsistency,
      passes,
      variationByGroup,
      semanticSimilarityScore,
    };
  }

  /**
   * Calculate representation gap metric
   */
  private calculateRepresentationGap(samples: BiasSample[]): RepresentationGapMetric {
    const underrepresentedGroups: string[] = [];
    const overrepresentedGroups: string[] = [];
    const expectedProportion = 1 / this.config.protectedAttributes.length;

    for (const attribute of this.config.protectedAttributes) {
      const groups = this.groupSamplesByAttribute(samples, attribute);
      const totalSamples = samples.length;

      for (const [groupName, groupSamples] of Object.entries(groups)) {
        const proportion = groupSamples.length / totalSamples;
        const key = `${attribute}:${groupName}`;

        if (proportion < expectedProportion * 0.5) {
          underrepresentedGroups.push(key);
        } else if (proportion > expectedProportion * 1.5) {
          overrepresentedGroups.push(key);
        }
      }
    }

    const gapCount = underrepresentedGroups.length + overrepresentedGroups.length;
    const totalGroups = this.config.protectedAttributes.length * 2; // Rough estimate
    const score = Math.max(0, 1 - gapCount / totalGroups);
    const passes = score >= this.config.alertThresholds.representationGap;

    return {
      score,
      threshold: this.config.alertThresholds.representationGap,
      passes,
      underrepresentedGroups,
      overrepresentedGroups,
    };
  }

  /**
   * Group samples by attribute value
   */
  private groupSamplesByAttribute(
    samples: BiasSample[],
    attribute: string
  ): Record<string, BiasSample[]> {
    const groups: Record<string, BiasSample[]> = {};

    for (const sample of samples) {
      const value = sample.attributes[attribute];
      if (value) {
        if (!groups[value]) {
          groups[value] = [];
        }
        groups[value].push(sample);
      }
    }

    return groups;
  }

  /**
   * Calculate variation in responses (0 = identical, 1 = completely different)
   */
  private calculateResponseVariation(responses: string[]): number {
    if (responses.length < 2) return 0;

    // Simple length-based variation as a proxy
    const lengths = responses.map((r) => r.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLength, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgLength > 0 ? stdDev / avgLength : 0;

    return Math.min(1, coefficientOfVariation);
  }

  /**
   * Calculate cross-group similarity (0 = different, 1 = similar)
   */
  private calculateCrossGroupSimilarity(group1: string[], group2: string[]): number {
    if (group1.length === 0 || group2.length === 0) return 1;

    // Simple average length comparison as a proxy for similarity
    const avgLength1 = group1.reduce((a, b) => a + b.length, 0) / group1.length;
    const avgLength2 = group2.reduce((a, b) => a + b.length, 0) / group2.length;

    const maxLength = Math.max(avgLength1, avgLength2);
    const minLength = Math.min(avgLength1, avgLength2);

    return maxLength > 0 ? minLength / maxLength : 1;
  }

  /**
   * Generate alerts based on metrics
   */
  private generateAlerts(modelId: string, metrics: BiasMetrics): BiasAlert[] {
    const alerts: BiasAlert[] = [];

    if (!metrics.demographicParity.passes) {
      alerts.push({
        id: `alert-dp-${modelId}-${Date.now()}`,
        severity: this.getSeverity(metrics.demographicParity.score, metrics.demographicParity.threshold),
        metricType: 'demographicParity',
        description: `Demographic parity score (${metrics.demographicParity.score.toFixed(2)}) below threshold (${metrics.demographicParity.threshold})`,
        affectedGroups: Object.keys(metrics.demographicParity.groupScores),
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    if (!metrics.equalOpportunity.passes) {
      alerts.push({
        id: `alert-eo-${modelId}-${Date.now()}`,
        severity: this.getSeverity(metrics.equalOpportunity.score, metrics.equalOpportunity.threshold),
        metricType: 'equalOpportunity',
        description: `Equal opportunity score (${metrics.equalOpportunity.score.toFixed(2)}) below threshold (${metrics.equalOpportunity.threshold})`,
        affectedGroups: Object.keys(metrics.equalOpportunity.truePositiveRates),
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    if (!metrics.responseConsistency.passes) {
      alerts.push({
        id: `alert-rc-${modelId}-${Date.now()}`,
        severity: this.getSeverity(metrics.responseConsistency.score, metrics.responseConsistency.threshold),
        metricType: 'responseConsistency',
        description: `Response consistency score (${metrics.responseConsistency.score.toFixed(2)}) below threshold (${metrics.responseConsistency.threshold})`,
        affectedGroups: Object.keys(metrics.responseConsistency.variationByGroup),
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    if (!metrics.representationGap.passes) {
      alerts.push({
        id: `alert-rg-${modelId}-${Date.now()}`,
        severity: this.getSeverity(metrics.representationGap.score, metrics.representationGap.threshold),
        metricType: 'representationGap',
        description: `Representation gap detected. Underrepresented: ${metrics.representationGap.underrepresentedGroups.length}, Overrepresented: ${metrics.representationGap.overrepresentedGroups.length}`,
        affectedGroups: [
          ...metrics.representationGap.underrepresentedGroups,
          ...metrics.representationGap.overrepresentedGroups,
        ],
        timestamp: new Date(),
        acknowledged: false,
      });
    }

    return alerts;
  }

  /**
   * Get alert severity based on score vs threshold
   */
  private getSeverity(score: number, threshold: number): BiasAlertSeverity {
    const ratio = score / threshold;
    if (ratio < 0.5) return 'critical';
    if (ratio < 0.75) return 'warning';
    return 'info';
  }

  /**
   * Calculate overall bias score
   */
  private calculateOverallScore(metrics: BiasMetrics): number {
    const weights = {
      demographicParity: 0.3,
      equalOpportunity: 0.3,
      responseConsistency: 0.25,
      representationGap: 0.15,
    };

    return (
      metrics.demographicParity.score * weights.demographicParity +
      metrics.equalOpportunity.score * weights.equalOpportunity +
      metrics.responseConsistency.score * weights.responseConsistency +
      metrics.representationGap.score * weights.representationGap
    );
  }

  /**
   * Generate recommendations based on bias analysis
   */
  private generateRecommendations(metrics: BiasMetrics, alerts: BiasAlert[]): string[] {
    const recommendations: string[] = [];

    if (!metrics.demographicParity.passes) {
      recommendations.push(
        'Review model outputs for demographic parity. Consider rebalancing training data or adjusting output post-processing.'
      );
    }

    if (!metrics.equalOpportunity.passes) {
      recommendations.push(
        'Equal opportunity metrics indicate disparate treatment. Audit the model for discriminatory patterns.'
      );
    }

    if (!metrics.responseConsistency.passes) {
      recommendations.push(
        'Response consistency varies across groups. Implement standardized output templates or validation.'
      );
    }

    if (!metrics.representationGap.passes) {
      if (metrics.representationGap.underrepresentedGroups.length > 0) {
        recommendations.push(
          `Increase representation of underrepresented groups: ${metrics.representationGap.underrepresentedGroups.join(', ')}`
        );
      }
    }

    if (alerts.some((a) => a.severity === 'critical')) {
      recommendations.push(
        'Critical bias alerts detected. Consider pausing model deployment until issues are resolved.'
      );
    }

    return recommendations;
  }

  /**
   * Check for bias in realtime
   */
  private async checkForBiasRealtime(sample: BiasSample): Promise<void> {
    // Get recent samples for comparison
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentSamples = await this.sampleStorage.getSamples(
      sample.modelId,
      oneHourAgo,
      new Date(),
      1000
    );

    if (recentSamples.length < 10) return; // Not enough data for realtime analysis

    // Quick demographic parity check
    for (const attribute of this.config.protectedAttributes) {
      const groups = this.groupSamplesByAttribute(recentSamples, attribute);
      const rates: number[] = [];

      for (const groupSamples of Object.values(groups)) {
        if (groupSamples.length < 3) continue;
        const positiveRate =
          groupSamples.filter((s) => s.outcome === 'positive').length / groupSamples.length;
        rates.push(positiveRate);
      }

      if (rates.length >= 2) {
        const disparity = Math.max(...rates) - Math.min(...rates);
        if (disparity > 1 - this.config.alertThresholds.demographicParity) {
          this.emit('bias:realtime-alert', {
            modelId: sample.modelId,
            attribute,
            disparity,
            timestamp: new Date(),
          });
        }
      }
    }
  }

  /**
   * Create result for disabled analysis
   */
  private createDisabledResult(modelId: string): BiasDetectionResult {
    return {
      modelId,
      analysisId: 'disabled',
      timestamp: new Date(),
      metrics: {
        demographicParity: { score: 1, threshold: 0.8, passes: true, groupScores: {}, maxDisparity: 0 },
        equalOpportunity: { score: 1, threshold: 0.8, passes: true, truePositiveRates: {}, falsePositiveRates: {} },
        responseConsistency: { score: 1, threshold: 0.85, passes: true, variationByGroup: {}, semanticSimilarityScore: 1 },
        representationGap: { score: 1, threshold: 0.7, passes: true, underrepresentedGroups: [], overrepresentedGroups: [] },
      },
      alerts: [],
      recommendations: ['Bias detection is disabled'],
      overallScore: 1,
      passesThreshold: true,
    };
  }

  /**
   * Create result for insufficient data
   */
  private createInsufficientDataResult(modelId: string, sampleCount: number): BiasDetectionResult {
    return {
      modelId,
      analysisId: 'insufficient-data',
      timestamp: new Date(),
      metrics: {
        demographicParity: { score: 0, threshold: 0.8, passes: false, groupScores: {}, maxDisparity: 0 },
        equalOpportunity: { score: 0, threshold: 0.8, passes: false, truePositiveRates: {}, falsePositiveRates: {} },
        responseConsistency: { score: 0, threshold: 0.85, passes: false, variationByGroup: {}, semanticSimilarityScore: 0 },
        representationGap: { score: 0, threshold: 0.7, passes: false, underrepresentedGroups: [], overrepresentedGroups: [] },
      },
      alerts: [],
      recommendations: [
        `Insufficient data for bias analysis. Current samples: ${sampleCount}, Required: ${this.config.minimumSampleSize}`,
      ],
      overallScore: 0,
      passesThreshold: false,
    };
  }

  /**
   * Get alerts for a model
   */
  async getAlerts(modelId?: string, limit?: number): Promise<BiasAlert[]> {
    return this.alertStorage.list(modelId, limit);
  }

  /**
   * Get unacknowledged alerts
   */
  async getUnacknowledgedAlerts(modelId?: string): Promise<BiasAlert[]> {
    return this.alertStorage.getUnacknowledged(modelId);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    await this.alertStorage.acknowledge(alertId);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolution: string): Promise<void> {
    await this.alertStorage.resolve(alertId, resolution);
  }

  /**
   * Clean up old samples
   */
  async cleanup(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    return this.sampleStorage.deleteOlderThan(cutoffDate);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<BiasDetectionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): BiasDetectionConfig {
    return { ...this.config };
  }

  /**
   * Get cached analysis result
   */
  getCachedAnalysis(
    modelId: string,
    period: { start: Date; end: Date }
  ): BiasDetectionResult | null {
    const key = `${modelId}:${period.start.toISOString()}:${period.end.toISOString()}`;
    return this.analysisCache.get(key) || null;
  }

  /**
   * Add a custom metric
   */
  addCustomMetric(metric: CustomMetricDefinition): void {
    this.config.customMetrics.push(metric);
  }

  /**
   * Remove a custom metric
   */
  removeCustomMetric(metricId: string): boolean {
    const index = this.config.customMetrics.findIndex((m) => m.id === metricId);
    if (index >= 0) {
      this.config.customMetrics.splice(index, 1);
      return true;
    }
    return false;
  }
}

export default BiasDetector;
