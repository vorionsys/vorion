/**
 * Data Exfiltration Detector
 *
 * Detects suspicious data exfiltration patterns by analyzing:
 * - Bulk data exports
 * - Unusual download volumes
 * - Rapid access to many records in short time
 * - Access outside normal data scope
 *
 * Uses behavioral baselines to score based on volume, velocity,
 * and data sensitivity.
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/data-exfiltration
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../../common/logger.js';
import { getRedis } from '../../../common/redis.js';
import type {
  Detector,
  DetectionResult,
  SecurityEvent,
  Indicator,
  AnomalySeverity,
} from '../types.js';
import { AnomalySeverity as Severity } from '../types.js';

const logger = createLogger({ component: 'data-exfiltration-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for data access baselines */
const DATA_BASELINE_PREFIX = 'vorion:anomaly:exfil:baseline:';

/** Redis key prefix for access velocity tracking */
const VELOCITY_PREFIX = 'vorion:anomaly:exfil:velocity:';

/** Redis key prefix for data scope tracking */
const SCOPE_PREFIX = 'vorion:anomaly:exfil:scope:';

/** Time-to-live for baselines in seconds (30 days) */
const BASELINE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Time window for velocity tracking in seconds (15 minutes) */
const VELOCITY_WINDOW_SECONDS = 15 * 60;

/** Minimum events to establish baseline */
const MIN_EVENTS_FOR_BASELINE = 20;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for data exfiltration detection
 */
export interface DataExfiltrationDetectorConfig {
  /** Maximum records accessed per 15 minutes before alerting */
  maxRecordsPerWindow: number;
  /** Maximum download volume in bytes per hour */
  maxDownloadBytesPerHour: number;
  /** Maximum bulk export size in records */
  maxBulkExportRecords: number;
  /** Data sensitivity classifications */
  dataSensitivity: Record<string, number>;
  /** High-risk export formats */
  riskyExportFormats: string[];
  /** Velocity threshold multiplier vs baseline */
  velocityThresholdMultiplier: number;
  /** Enable scope analysis (access outside normal data scope) */
  enableScopeAnalysis: boolean;
}

export const DEFAULT_DATA_EXFILTRATION_CONFIG: DataExfiltrationDetectorConfig = {
  maxRecordsPerWindow: 1000,
  maxDownloadBytesPerHour: 100 * 1024 * 1024, // 100 MB
  maxBulkExportRecords: 5000,
  dataSensitivity: {
    'pii': 90,
    'phi': 95,
    'financial': 85,
    'credentials': 100,
    'customer': 80,
    'employee': 75,
    'internal': 50,
    'public': 10,
    'default': 40,
  },
  riskyExportFormats: ['csv', 'xlsx', 'json', 'xml', 'sql', 'dump', 'backup'],
  velocityThresholdMultiplier: 5,
  enableScopeAnalysis: true,
};

// =============================================================================
// Baseline Types
// =============================================================================

/**
 * User's data access baseline
 */
interface DataAccessBaseline {
  userId: string;
  /** Average records accessed per hour */
  avgRecordsPerHour: number;
  /** Standard deviation of records per hour */
  stdDevRecordsPerHour: number;
  /** Average download bytes per hour */
  avgBytesPerHour: number;
  /** Standard deviation of bytes per hour */
  stdDevBytesPerHour: number;
  /** Normal data scopes accessed */
  normalScopes: string[];
  /** Normal data types accessed */
  normalDataTypes: string[];
  /** Export frequency (per day) */
  avgExportsPerDay: number;
  /** Total events tracked */
  totalEvents: number;
  /** Rolling sample count */
  sampleCount: number;
  /** Last updated */
  lastUpdated: string;
}

/**
 * Current velocity tracking
 */
interface VelocityWindow {
  userId: string;
  windowStart: number;
  recordCount: number;
  byteCount: number;
  uniqueRecords: Set<string>;
  dataTypes: Set<string>;
  scopes: Set<string>;
}

// =============================================================================
// Data Exfiltration Detector Implementation
// =============================================================================

/**
 * Data exfiltration anomaly detector
 */
export class DataExfiltrationDetector implements Detector {
  public readonly name = 'data-exfiltration';
  public readonly description =
    'Detects bulk data exports, unusual download volumes, and access outside normal scope';

  private readonly config: DataExfiltrationDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<DataExfiltrationDetectorConfig> = {},
    keyPrefix: string = DATA_BASELINE_PREFIX
  ) {
    this.config = { ...DEFAULT_DATA_EXFILTRATION_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for data exfiltration anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      // Only analyze data access events
      if (!this.isDataAccessEvent(event)) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      const userId = event.userId;
      if (!userId) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      // Get user's baseline
      const baseline = await this.getBaseline(userId);

      // Update velocity tracking and check current window
      const velocity = await this.updateVelocityTracking(event);

      // Check for bulk data exports
      const bulkResult = this.checkBulkExport(event);
      if (bulkResult.detected) {
        indicators.push(...bulkResult.indicators);
        suggestedActions.push(
          'Review export request for business justification',
          'Verify user has authorization for bulk data access'
        );
      }

      // Check for unusual download volumes
      const volumeResult = await this.checkVolumeAnomaly(event, baseline, velocity);
      if (volumeResult.detected) {
        indicators.push(...volumeResult.indicators);
        suggestedActions.push(
          'Investigate recent data access patterns',
          'Consider temporary data access restrictions'
        );
      }

      // Check for high-velocity access
      const velocityResult = this.checkVelocityAnomaly(event, baseline, velocity);
      if (velocityResult.detected) {
        indicators.push(...velocityResult.indicators);
        suggestedActions.push(
          'Review automated access patterns',
          'Check for compromised API keys or credentials'
        );
      }

      // Check for access outside normal scope
      if (this.config.enableScopeAnalysis) {
        const scopeResult = await this.checkScopeAnomaly(event, baseline);
        if (scopeResult.detected) {
          indicators.push(...scopeResult.indicators);
          suggestedActions.push(
            'Verify access is within authorized scope',
            'Review data access permissions'
          );
        }
      }

      // Check data sensitivity
      const sensitivityResult = this.checkDataSensitivity(event);
      if (sensitivityResult.detected) {
        indicators.push(...sensitivityResult.indicators);
        suggestedActions.push(
          'Apply additional monitoring for sensitive data access',
          'Ensure proper data handling procedures are followed'
        );
      }

      // Calculate overall result
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const { score, calculatedSeverity } = this.calculateRiskScore(indicators, event);
        confidence = score;
        severity = calculatedSeverity;
        description = this.generateDescription(event, indicators);
      }

      return {
        detectorName: this.name,
        anomalyDetected: hasAnomaly,
        confidence,
        severity,
        description,
        indicators,
        suggestedActions,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, eventId: event.eventId }, 'Data exfiltration detection failed');

      return {
        detectorName: this.name,
        anomalyDetected: false,
        indicators: [],
        suggestedActions: [],
        durationMs: performance.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Learn from an event by updating baselines
   */
  async learn(event: SecurityEvent): Promise<void> {
    if (!this.isDataAccessEvent(event) || !event.userId) {
      return;
    }

    try {
      await Promise.all([
        this.updateBaseline(event),
        this.updateScopeTracking(event),
      ]);

      logger.debug(
        { userId: event.userId, eventType: event.eventType },
        'Updated data exfiltration baselines'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to update data exfiltration baselines');
    }
  }

  /**
   * Reset all learned baselines
   */
  async reset(): Promise<void> {
    try {
      const patterns = [
        `${this.keyPrefix}*`,
        `${VELOCITY_PREFIX}*`,
        `${SCOPE_PREFIX}*`,
      ];

      for (const pattern of patterns) {
        await this.deleteKeysByPattern(pattern);
      }

      logger.info('Data exfiltration detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset data exfiltration detector');
      throw error;
    }
  }

  /**
   * Get baseline for a specific user
   */
  async getBaseline(userId: string): Promise<DataAccessBaseline> {
    const key = `${this.keyPrefix}${userId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return this.createEmptyBaseline(userId);
    }

    try {
      return JSON.parse(data) as DataAccessBaseline;
    } catch {
      return this.createEmptyBaseline(userId);
    }
  }

  // ===========================================================================
  // Private Detection Methods
  // ===========================================================================

  /**
   * Check if event is data access related
   */
  private isDataAccessEvent(event: SecurityEvent): boolean {
    const dataEventTypes = [
      'data_access',
      'data_export',
      'data_download',
      'bulk_export',
      'report_download',
      'query_execution',
      'api_data_request',
      'file_download',
      'record_view',
      'search_results',
    ];

    return dataEventTypes.includes(event.eventType) ||
           event.eventType.includes('export') ||
           event.eventType.includes('download') ||
           event.eventType.includes('data');
  }

  /**
   * Check for bulk data exports
   */
  private checkBulkExport(event: SecurityEvent): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const recordCount = this.extractRecordCount(metadata);
    const exportFormat = metadata['format'] as string ||
                        metadata['exportFormat'] as string || '';

    // Check record count threshold
    if (recordCount > this.config.maxBulkExportRecords) {
      indicators.push({
        type: 'bulk_export_records',
        description: `Bulk export of ${recordCount.toLocaleString()} records exceeds threshold of ${this.config.maxBulkExportRecords.toLocaleString()}`,
        value: recordCount,
        weight: Math.min(100, 50 + Math.round((recordCount / this.config.maxBulkExportRecords - 1) * 30)),
      });
    }

    // Check for risky export formats
    if (exportFormat && this.config.riskyExportFormats.includes(exportFormat.toLowerCase())) {
      const formatWeight = recordCount > 1000 ? 40 : 20;
      indicators.push({
        type: 'risky_export_format',
        description: `Export in portable format: ${exportFormat}`,
        value: exportFormat,
        weight: formatWeight,
      });
    }

    // Check for "select all" or full table export indicators
    const isFullExport = metadata['fullExport'] === true ||
                        metadata['selectAll'] === true ||
                        (metadata['filter'] as string) === '' ||
                        (metadata['query'] as string)?.toLowerCase().includes('select *');

    if (isFullExport && recordCount > 100) {
      indicators.push({
        type: 'unfiltered_export',
        description: 'Export without filtering criteria',
        value: true,
        weight: 35,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for unusual download volumes
   */
  private async checkVolumeAnomaly(
    event: SecurityEvent,
    baseline: DataAccessBaseline,
    velocity: VelocityWindow | null
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const byteCount = this.extractByteCount(metadata);

    // Check absolute volume threshold
    const hourlyBytes = await this.getHourlyBytes(event.userId!);
    if (hourlyBytes > this.config.maxDownloadBytesPerHour) {
      const excess = hourlyBytes - this.config.maxDownloadBytesPerHour;
      indicators.push({
        type: 'excessive_download_volume',
        description: `Hourly download volume (${this.formatBytes(hourlyBytes)}) exceeds threshold (${this.formatBytes(this.config.maxDownloadBytesPerHour)})`,
        value: hourlyBytes,
        weight: Math.min(100, 50 + Math.round((excess / this.config.maxDownloadBytesPerHour) * 30)),
      });
    }

    // Check against baseline if established
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE && baseline.stdDevBytesPerHour > 0) {
      const zScore = (byteCount - baseline.avgBytesPerHour) / baseline.stdDevBytesPerHour;

      if (zScore > 3) {
        indicators.push({
          type: 'volume_deviation',
          description: `Download volume significantly exceeds baseline (${zScore.toFixed(1)} standard deviations)`,
          value: zScore,
          weight: Math.min(80, 30 + Math.round(zScore * 10)),
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for high-velocity access patterns
   */
  private checkVelocityAnomaly(
    event: SecurityEvent,
    baseline: DataAccessBaseline,
    velocity: VelocityWindow | null
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    if (!velocity) {
      return { detected: false, indicators };
    }

    // Check absolute record count threshold
    if (velocity.recordCount > this.config.maxRecordsPerWindow) {
      indicators.push({
        type: 'high_access_velocity',
        description: `${velocity.recordCount.toLocaleString()} records accessed in 15-minute window (threshold: ${this.config.maxRecordsPerWindow.toLocaleString()})`,
        value: velocity.recordCount,
        weight: Math.min(100, 50 + Math.round((velocity.recordCount / this.config.maxRecordsPerWindow - 1) * 30)),
      });
    }

    // Check against baseline
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE && baseline.avgRecordsPerHour > 0) {
      // Convert 15-minute window to hourly rate
      const hourlyRate = velocity.recordCount * 4;
      const expectedRate = baseline.avgRecordsPerHour;
      const ratio = hourlyRate / expectedRate;

      if (ratio > this.config.velocityThresholdMultiplier) {
        indicators.push({
          type: 'velocity_baseline_deviation',
          description: `Access rate ${ratio.toFixed(1)}x higher than normal baseline`,
          value: ratio,
          weight: Math.min(80, 30 + Math.round((ratio - this.config.velocityThresholdMultiplier) * 10)),
        });
      }
    }

    // Check for sequential access patterns (enumeration)
    if (velocity.uniqueRecords.size < velocity.recordCount * 0.9 && velocity.recordCount > 50) {
      const duplicateRatio = 1 - (velocity.uniqueRecords.size / velocity.recordCount);
      indicators.push({
        type: 'repeated_access_pattern',
        description: `${(duplicateRatio * 100).toFixed(0)}% duplicate record access may indicate scraping`,
        value: duplicateRatio,
        weight: 25,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for access outside normal scope
   */
  private async checkScopeAnomaly(
    event: SecurityEvent,
    baseline: DataAccessBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const dataType = metadata['dataType'] as string || metadata['table'] as string || '';
    const scope = metadata['scope'] as string ||
                 metadata['tenant'] as string ||
                 metadata['department'] as string || '';

    if (baseline.totalEvents < MIN_EVENTS_FOR_BASELINE) {
      return { detected: false, indicators };
    }

    // Check for new data type access
    if (dataType && !baseline.normalDataTypes.includes(dataType)) {
      const sensitivity = this.getDataSensitivity(dataType);
      if (sensitivity >= 50) {
        indicators.push({
          type: 'new_data_type_access',
          description: `First-time access to data type: ${dataType} (sensitivity: ${sensitivity})`,
          value: dataType,
          weight: Math.round(sensitivity * 0.5),
        });
      }
    }

    // Check for new scope access
    if (scope && !baseline.normalScopes.includes(scope)) {
      indicators.push({
        type: 'new_scope_access',
        description: `Access to new data scope: ${scope}`,
        value: scope,
        weight: 30,
      });
    }

    // Check for cross-scope access in single session
    const recentScopes = await this.getRecentScopes(event.userId!);
    if (recentScopes.length > 3) {
      indicators.push({
        type: 'multi_scope_access',
        description: `Access across ${recentScopes.length} different scopes in recent session`,
        value: recentScopes.length,
        weight: 35,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check data sensitivity level
   */
  private checkDataSensitivity(
    event: SecurityEvent
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const dataType = metadata['dataType'] as string ||
                    metadata['dataClass'] as string ||
                    metadata['classification'] as string || '';

    const sensitivity = this.getDataSensitivity(dataType);
    const recordCount = this.extractRecordCount(metadata);

    // Flag high-sensitivity bulk access
    if (sensitivity >= 80 && recordCount > 100) {
      indicators.push({
        type: 'sensitive_bulk_access',
        description: `Bulk access to high-sensitivity data (${dataType}, sensitivity: ${sensitivity})`,
        value: sensitivity,
        weight: Math.round(sensitivity * 0.7),
      });
    }

    // Flag PII/PHI specific access patterns
    if ((dataType.toLowerCase().includes('pii') || dataType.toLowerCase().includes('phi')) &&
        recordCount > 10) {
      indicators.push({
        type: 'regulated_data_access',
        description: `Access to ${recordCount} regulated data records (${dataType})`,
        value: dataType,
        weight: 50,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  // ===========================================================================
  // Private Baseline Methods
  // ===========================================================================

  /**
   * Update velocity tracking for current window
   */
  private async updateVelocityTracking(event: SecurityEvent): Promise<VelocityWindow | null> {
    const userId = event.userId!;
    const metadata = event.metadata || {};

    const windowKey = Math.floor(Date.now() / (VELOCITY_WINDOW_SECONDS * 1000));
    const key = `${VELOCITY_PREFIX}${userId}:${windowKey}`;

    // Increment counters
    const recordCount = this.extractRecordCount(metadata);
    const byteCount = this.extractByteCount(metadata);
    const recordId = metadata['recordId'] as string || metadata['id'] as string || event.eventId;
    const dataType = metadata['dataType'] as string || '';
    const scope = metadata['scope'] as string || '';

    await this.redis.hincrby(key, 'recordCount', recordCount);
    await this.redis.hincrby(key, 'byteCount', byteCount);

    if (recordId) {
      await this.redis.sadd(`${key}:records`, recordId);
    }
    if (dataType) {
      await this.redis.sadd(`${key}:types`, dataType);
    }
    if (scope) {
      await this.redis.sadd(`${key}:scopes`, scope);
    }

    await this.redis.expire(key, VELOCITY_WINDOW_SECONDS * 2);
    await this.redis.expire(`${key}:records`, VELOCITY_WINDOW_SECONDS * 2);
    await this.redis.expire(`${key}:types`, VELOCITY_WINDOW_SECONDS * 2);
    await this.redis.expire(`${key}:scopes`, VELOCITY_WINDOW_SECONDS * 2);

    // Get current window state
    const data = await this.redis.hgetall(key);
    const uniqueRecords = await this.redis.smembers(`${key}:records`);
    const dataTypes = await this.redis.smembers(`${key}:types`);
    const scopes = await this.redis.smembers(`${key}:scopes`);

    return {
      userId,
      windowStart: windowKey * VELOCITY_WINDOW_SECONDS * 1000,
      recordCount: parseInt(data['recordCount'] || '0', 10),
      byteCount: parseInt(data['byteCount'] || '0', 10),
      uniqueRecords: new Set(uniqueRecords),
      dataTypes: new Set(dataTypes),
      scopes: new Set(scopes),
    };
  }

  /**
   * Update user's data access baseline
   */
  private async updateBaseline(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const baseline = await this.getBaseline(userId);
    const metadata = event.metadata || {};

    const recordCount = this.extractRecordCount(metadata);
    const byteCount = this.extractByteCount(metadata);
    const dataType = metadata['dataType'] as string || metadata['table'] as string;
    const scope = metadata['scope'] as string || metadata['tenant'] as string;

    // Update using Welford's online algorithm
    const n = baseline.sampleCount + 1;

    // Update records per hour stats
    const recordsDelta = recordCount - baseline.avgRecordsPerHour;
    const newAvgRecords = baseline.avgRecordsPerHour + recordsDelta / n;
    const recordsDelta2 = recordCount - newAvgRecords;
    let newStdDevRecords = baseline.stdDevRecordsPerHour;
    if (n >= 2) {
      const oldVariance = baseline.stdDevRecordsPerHour ** 2 * (n - 1);
      const newVariance = (oldVariance + recordsDelta * recordsDelta2) / n;
      newStdDevRecords = Math.sqrt(newVariance);
    }

    // Update bytes per hour stats
    const bytesDelta = byteCount - baseline.avgBytesPerHour;
    const newAvgBytes = baseline.avgBytesPerHour + bytesDelta / n;
    const bytesDelta2 = byteCount - newAvgBytes;
    let newStdDevBytes = baseline.stdDevBytesPerHour;
    if (n >= 2) {
      const oldBytesVariance = baseline.stdDevBytesPerHour ** 2 * (n - 1);
      const newBytesVariance = (oldBytesVariance + bytesDelta * bytesDelta2) / n;
      newStdDevBytes = Math.sqrt(newBytesVariance);
    }

    // Update data types and scopes
    if (dataType && !baseline.normalDataTypes.includes(dataType)) {
      baseline.normalDataTypes.push(dataType);
      if (baseline.normalDataTypes.length > 50) {
        baseline.normalDataTypes.shift();
      }
    }
    if (scope && !baseline.normalScopes.includes(scope)) {
      baseline.normalScopes.push(scope);
      if (baseline.normalScopes.length > 20) {
        baseline.normalScopes.shift();
      }
    }

    const updatedBaseline: DataAccessBaseline = {
      ...baseline,
      avgRecordsPerHour: newAvgRecords,
      stdDevRecordsPerHour: newStdDevRecords,
      avgBytesPerHour: newAvgBytes,
      stdDevBytesPerHour: newStdDevBytes,
      totalEvents: baseline.totalEvents + 1,
      sampleCount: Math.min(n, 1000), // Cap at 1000 samples
      lastUpdated: new Date().toISOString(),
    };

    const key = `${this.keyPrefix}${userId}`;
    await this.redis.set(key, JSON.stringify(updatedBaseline), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Update scope tracking
   */
  private async updateScopeTracking(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const metadata = event.metadata || {};
    const scope = metadata['scope'] as string || metadata['tenant'] as string;

    if (!scope) {
      return;
    }

    const key = `${SCOPE_PREFIX}${userId}`;
    await this.redis.zadd(key, event.timestamp.getTime(), scope);

    // Trim old entries (keep last 24 hours)
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    await this.redis.zremrangebyscore(key, '-inf', cutoff);
    await this.redis.expire(key, BASELINE_TTL_SECONDS);
  }

  /**
   * Get recent scopes accessed
   */
  private async getRecentScopes(userId: string): Promise<string[]> {
    const key = `${SCOPE_PREFIX}${userId}`;
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    const scopes = await this.redis.zrangebyscore(key, oneHourAgo, '+inf');
    return Array.from(new Set(scopes));
  }

  /**
   * Get hourly byte count
   */
  private async getHourlyBytes(userId: string): Promise<number> {
    const now = Math.floor(Date.now() / (VELOCITY_WINDOW_SECONDS * 1000));
    let total = 0;

    // Sum up 4 windows (1 hour)
    for (let i = 0; i < 4; i++) {
      const key = `${VELOCITY_PREFIX}${userId}:${now - i}`;
      const bytes = await this.redis.hget(key, 'byteCount');
      if (bytes) {
        total += parseInt(bytes, 10);
      }
    }

    return total;
  }

  /**
   * Extract record count from metadata
   */
  private extractRecordCount(metadata: Record<string, unknown>): number {
    return (metadata['recordCount'] as number) ||
           (metadata['count'] as number) ||
           (metadata['rows'] as number) ||
           (metadata['items'] as number) ||
           1;
  }

  /**
   * Extract byte count from metadata
   */
  private extractByteCount(metadata: Record<string, unknown>): number {
    return (metadata['byteCount'] as number) ||
           (metadata['bytes'] as number) ||
           (metadata['size'] as number) ||
           (metadata['contentLength'] as number) ||
           0;
  }

  /**
   * Get data sensitivity level
   */
  private getDataSensitivity(dataType: string): number {
    const lowerType = dataType.toLowerCase();

    for (const [pattern, sensitivity] of Object.entries(this.config.dataSensitivity)) {
      if (pattern !== 'default' && lowerType.includes(pattern)) {
        return sensitivity;
      }
    }

    return this.config.dataSensitivity['default'] || 40;
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Create empty baseline for new user
   */
  private createEmptyBaseline(userId: string): DataAccessBaseline {
    return {
      userId,
      avgRecordsPerHour: 0,
      stdDevRecordsPerHour: 0,
      avgBytesPerHour: 0,
      stdDevBytesPerHour: 0,
      normalScopes: [],
      normalDataTypes: [],
      avgExportsPerDay: 0,
      totalEvents: 0,
      sampleCount: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Calculate combined risk score
   */
  private calculateRiskScore(
    indicators: Indicator[],
    event: SecurityEvent
  ): { score: number; calculatedSeverity: AnomalySeverity } {
    const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
    const signalCount = indicators.length;
    const correlationBonus = Math.min(20, (signalCount - 1) * 5);

    // Check for high-severity combinations
    const hasBulkExport = indicators.some((i) => i.type === 'bulk_export_records');
    const hasHighVelocity = indicators.some((i) => i.type === 'high_access_velocity');
    const hasSensitiveData = indicators.some((i) =>
      i.type === 'sensitive_bulk_access' || i.type === 'regulated_data_access'
    );
    const hasVolumeDeviation = indicators.some((i) => i.type === 'excessive_download_volume');

    let score = Math.min(100, totalWeight + correlationBonus);

    // Boost for critical combinations
    if (hasBulkExport && hasSensitiveData) {
      score = Math.min(100, score + 15);
    }
    if (hasHighVelocity && hasVolumeDeviation) {
      score = Math.min(100, score + 10);
    }

    // Determine severity
    let calculatedSeverity: AnomalySeverity;
    if (score >= 85 || (hasBulkExport && hasSensitiveData)) {
      calculatedSeverity = Severity.CRITICAL;
    } else if (score >= 70 || (hasBulkExport && hasHighVelocity)) {
      calculatedSeverity = Severity.HIGH;
    } else if (score >= 50) {
      calculatedSeverity = Severity.MEDIUM;
    } else {
      calculatedSeverity = Severity.LOW;
    }

    return { score, calculatedSeverity };
  }

  /**
   * Generate human-readable description
   */
  private generateDescription(event: SecurityEvent, indicators: Indicator[]): string {
    const parts: string[] = ['Potential data exfiltration detected:'];

    const bulkIndicator = indicators.find((i) => i.type === 'bulk_export_records');
    if (bulkIndicator) {
      parts.push(bulkIndicator.description);
    }

    const velocityIndicator = indicators.find((i) => i.type === 'high_access_velocity');
    if (velocityIndicator) {
      parts.push(velocityIndicator.description);
    }

    const sensitiveIndicator = indicators.find((i) =>
      i.type === 'sensitive_bulk_access' || i.type === 'regulated_data_access'
    );
    if (sensitiveIndicator) {
      parts.push(sensitiveIndicator.description);
    }

    if (parts.length === 1) {
      parts.push(`${indicators.length} suspicious data access indicators found.`);
    }

    return parts.join(' ');
  }

  /**
   * Create a detection result
   */
  private createResult(
    anomalyDetected: boolean,
    indicators: Indicator[],
    suggestedActions: string[],
    startTime: number
  ): DetectionResult {
    return {
      detectorName: this.name,
      anomalyDetected,
      indicators,
      suggestedActions,
      durationMs: performance.now() - startTime,
    };
  }

  /**
   * Delete keys matching a pattern
   */
  private async deleteKeysByPattern(pattern: string): Promise<void> {
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

/**
 * Create a new data exfiltration detector instance
 */
export function createDataExfiltrationDetector(
  config?: Partial<DataExfiltrationDetectorConfig>,
  keyPrefix?: string
): DataExfiltrationDetector {
  return new DataExfiltrationDetector(config, keyPrefix);
}
