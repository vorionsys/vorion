/**
 * Volume Spike Anomaly Detector
 *
 * Detects unusual request volume patterns by:
 * - Tracking request counts per user, IP, and endpoint
 * - Learning baseline volume statistics over time
 * - Flagging when volume exceeds statistical thresholds
 *
 * Uses a sliding window approach with statistical analysis to identify
 * traffic spikes that may indicate:
 * - Credential stuffing attacks
 * - API abuse
 * - Automated scraping
 * - Denial of service attempts
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/volume
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../../common/logger.js';
import { getRedis } from '../../../common/redis.js';
import type {
  Detector,
  DetectionResult,
  SecurityEvent,
  VolumeDetectorConfig,
  VolumeBaseline,
  Indicator,
  AnomalySeverity,
} from '../types.js';
import {
  DEFAULT_VOLUME_DETECTOR_CONFIG,
  AnomalySeverity as Severity,
} from '../types.js';

const logger = createLogger({ component: 'volume-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for volume counts */
const VOLUME_COUNT_PREFIX = 'vorion:anomaly:volume:count:';

/** Redis key prefix for volume baselines */
const VOLUME_BASELINE_PREFIX = 'vorion:anomaly:volume:baseline:';

/** Time-to-live for count buckets in seconds (1 hour) */
const COUNT_TTL_SECONDS = 60 * 60;

/** Time-to-live for baselines in seconds (30 days) */
const BASELINE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Minimum samples required for reliable baseline */
const MIN_BASELINE_SAMPLES = 10;

/** Rolling window for baseline updates */
const BASELINE_WINDOW_SIZE = 100;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the current time window bucket key
 */
function getTimeBucket(windowMinutes: number): string {
  const now = Date.now();
  const bucketSize = windowMinutes * 60 * 1000;
  const bucket = Math.floor(now / bucketSize);
  return bucket.toString();
}

/**
 * Calculate mean of an array
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const m = mean ?? calculateMean(values);
  const squaredDiffs = values.map((v) => Math.pow(v - m, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Create an empty baseline
 */
function createEmptyBaseline(
  identifier: string,
  identifierType: 'user' | 'ip' | 'endpoint'
): VolumeBaseline {
  return {
    identifier,
    identifierType,
    mean: 0,
    stdDev: 0,
    sampleCount: 0,
    lastUpdated: new Date(),
  };
}

// =============================================================================
// Volume Detector Implementation
// =============================================================================

/**
 * Volume spike anomaly detector
 */
export class VolumeDetector implements Detector {
  public readonly name = 'volume';
  public readonly description =
    'Detects unusual request volume spikes per user, IP, or endpoint';

  private readonly config: VolumeDetectorConfig;
  private readonly redis: Redis;
  private readonly countPrefix: string;
  private readonly baselinePrefix: string;

  constructor(
    config: Partial<VolumeDetectorConfig> = {},
    countPrefix: string = VOLUME_COUNT_PREFIX,
    baselinePrefix: string = VOLUME_BASELINE_PREFIX
  ) {
    this.config = { ...DEFAULT_VOLUME_DETECTOR_CONFIG, ...config };
    this.redis = getRedis();
    this.countPrefix = countPrefix;
    this.baselinePrefix = baselinePrefix;
  }

  /**
   * Analyze an event for volume anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      const timeBucket = getTimeBucket(this.config.windowMinutes);

      // Check user volume
      if (this.config.trackPerUser && event.userId) {
        const userResult = await this.checkVolume(
          'user',
          event.userId,
          timeBucket
        );
        if (userResult.isSpike) {
          indicators.push(...userResult.indicators);
          suggestedActions.push(
            'Investigate user activity for automated behavior',
            'Consider temporary rate limiting for this user'
          );
        }
      }

      // Check IP volume
      if (this.config.trackPerIp && event.ipAddress) {
        const ipResult = await this.checkVolume(
          'ip',
          event.ipAddress,
          timeBucket
        );
        if (ipResult.isSpike) {
          indicators.push(...ipResult.indicators);
          suggestedActions.push(
            'Check if IP is associated with known proxy/VPN services',
            'Consider IP-based rate limiting or blocking'
          );
        }
      }

      // Check endpoint volume
      if (this.config.trackPerEndpoint && event.resource) {
        const endpointResult = await this.checkVolume(
          'endpoint',
          event.resource,
          timeBucket
        );
        if (endpointResult.isSpike) {
          indicators.push(...endpointResult.indicators);
          suggestedActions.push(
            'Review endpoint for potential abuse vectors',
            'Consider implementing endpoint-specific rate limits'
          );
        }
      }

      // Calculate overall result
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
        // Average the weights since we might have multiple indicators
        confidence = Math.min(100, Math.round(totalWeight / Math.max(1, indicators.length) * 1.5));
        severity = this.calculateSeverity(confidence, indicators);
        description = this.generateDescription(indicators);
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
      logger.error({ error, eventId: event.eventId }, 'Volume detection failed');

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
   * Learn from an event by updating volume counts and baselines
   */
  async learn(event: SecurityEvent): Promise<void> {
    try {
      const timeBucket = getTimeBucket(this.config.windowMinutes);

      // Increment counts
      const incrementPromises: Promise<number>[] = [];

      if (this.config.trackPerUser && event.userId) {
        incrementPromises.push(this.incrementCount('user', event.userId, timeBucket));
      }

      if (this.config.trackPerIp && event.ipAddress) {
        incrementPromises.push(this.incrementCount('ip', event.ipAddress, timeBucket));
      }

      if (this.config.trackPerEndpoint && event.resource) {
        incrementPromises.push(this.incrementCount('endpoint', event.resource, timeBucket));
      }

      await Promise.all(incrementPromises);

      logger.debug(
        {
          userId: event.userId,
          ipAddress: event.ipAddress,
          resource: event.resource,
        },
        'Updated volume counts'
      );
    } catch (error) {
      logger.error({ error, eventId: event.eventId }, 'Failed to update volume counts');
    }
  }

  /**
   * Reset all learned baselines and counts
   */
  async reset(): Promise<void> {
    try {
      // Reset counts
      await this.deleteKeysByPattern(`${this.countPrefix}*`);

      // Reset baselines
      await this.deleteKeysByPattern(`${this.baselinePrefix}*`);

      logger.info('Volume detector baselines and counts reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset volume detector');
      throw error;
    }
  }

  /**
   * Update baseline with a new sample
   * Called periodically to update baselines from accumulated counts
   */
  async updateBaseline(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    count: number
  ): Promise<void> {
    const baseline = await this.getBaseline(identifierType, identifier);
    const samples = baseline.sampleCount;

    // Use Welford's online algorithm for mean and variance
    const newSamples = samples + 1;
    const delta = count - baseline.mean;
    const newMean = baseline.mean + delta / newSamples;
    const delta2 = count - newMean;

    // Update variance incrementally (for stdDev calculation)
    // This is an approximation that works well for our purposes
    let newStdDev: number;
    if (newSamples < 2) {
      newStdDev = 0;
    } else if (samples === 0) {
      newStdDev = 0;
    } else {
      // Running variance update
      const oldVariance = baseline.stdDev * baseline.stdDev * samples;
      const newVariance = (oldVariance + delta * delta2) / newSamples;
      newStdDev = Math.sqrt(newVariance);
    }

    const updatedBaseline: VolumeBaseline = {
      identifier,
      identifierType,
      mean: newMean,
      stdDev: newStdDev,
      sampleCount: Math.min(newSamples, BASELINE_WINDOW_SIZE),
      lastUpdated: new Date(),
    };

    await this.saveBaseline(identifierType, identifier, updatedBaseline);
  }

  /**
   * Check volume for a specific identifier
   */
  private async checkVolume(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    timeBucket: string
  ): Promise<{ isSpike: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];

    // Get current count
    const count = await this.getCount(identifierType, identifier, timeBucket);

    // Check against absolute maximum
    if (count > this.config.absoluteMaxRequests) {
      const excess = count - this.config.absoluteMaxRequests;
      indicators.push({
        type: `absolute_volume_spike_${identifierType}`,
        description: `${this.formatIdentifierType(identifierType)} ${identifier} exceeded absolute maximum: ${count} requests (max: ${this.config.absoluteMaxRequests}) in ${this.config.windowMinutes} minutes`,
        value: count,
        weight: Math.min(100, 60 + Math.round((excess / this.config.absoluteMaxRequests) * 40)),
      });
    }

    // Check against learned baseline
    const baseline = await this.getBaseline(identifierType, identifier);

    if (baseline.sampleCount >= MIN_BASELINE_SAMPLES && baseline.stdDev > 0) {
      const zScore = (count - baseline.mean) / baseline.stdDev;

      if (zScore > this.config.spikeThresholdStdDev) {
        const percentageIncrease = baseline.mean > 0
          ? Math.round(((count - baseline.mean) / baseline.mean) * 100)
          : 0;

        indicators.push({
          type: `statistical_volume_spike_${identifierType}`,
          description: `${this.formatIdentifierType(identifierType)} ${identifier} volume spike: ${count} requests (baseline: ${Math.round(baseline.mean)} +/- ${Math.round(baseline.stdDev)}, ${percentageIncrease}% increase)`,
          value: zScore,
          weight: Math.min(100, 40 + Math.round(zScore * 10)),
        });
      }
    }

    // Update baseline with current count for future reference
    if (count > 0) {
      // Schedule baseline update (don't await to avoid blocking detection)
      this.updateBaseline(identifierType, identifier, count).catch((error) => {
        logger.warn({ error, identifierType, identifier }, 'Failed to update baseline');
      });
    }

    return { isSpike: indicators.length > 0, indicators };
  }

  /**
   * Increment count for an identifier in the current time bucket
   */
  private async incrementCount(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    timeBucket: string
  ): Promise<number> {
    const key = this.getCountKey(identifierType, identifier, timeBucket);
    const count = await this.redis.incr(key);

    // Set TTL only if this is a new key
    if (count === 1) {
      await this.redis.expire(key, COUNT_TTL_SECONDS);
    }

    return count;
  }

  /**
   * Get current count for an identifier
   */
  private async getCount(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    timeBucket: string
  ): Promise<number> {
    const key = this.getCountKey(identifierType, identifier, timeBucket);
    const count = await this.redis.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Get Redis key for count
   */
  private getCountKey(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    timeBucket: string
  ): string {
    return `${this.countPrefix}${identifierType}:${identifier}:${timeBucket}`;
  }

  /**
   * Get baseline for an identifier
   */
  private async getBaseline(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string
  ): Promise<VolumeBaseline> {
    const key = this.getBaselineKey(identifierType, identifier);
    const data = await this.redis.get(key);

    if (!data) {
      return createEmptyBaseline(identifier, identifierType);
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        lastUpdated: new Date(parsed.lastUpdated),
      } as VolumeBaseline;
    } catch {
      return createEmptyBaseline(identifier, identifierType);
    }
  }

  /**
   * Save baseline for an identifier
   */
  private async saveBaseline(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string,
    baseline: VolumeBaseline
  ): Promise<void> {
    const key = this.getBaselineKey(identifierType, identifier);
    await this.redis.set(key, JSON.stringify(baseline), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Get Redis key for baseline
   */
  private getBaselineKey(
    identifierType: 'user' | 'ip' | 'endpoint',
    identifier: string
  ): string {
    return `${this.baselinePrefix}${identifierType}:${identifier}`;
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

  /**
   * Format identifier type for display
   */
  private formatIdentifierType(type: 'user' | 'ip' | 'endpoint'): string {
    switch (type) {
      case 'user':
        return 'User';
      case 'ip':
        return 'IP';
      case 'endpoint':
        return 'Endpoint';
      default:
        return type;
    }
  }

  /**
   * Calculate severity based on confidence and indicators
   */
  private calculateSeverity(
    confidence: number,
    indicators: Indicator[]
  ): AnomalySeverity {
    const hasAbsoluteSpike = indicators.some((i) =>
      i.type.startsWith('absolute_volume_spike')
    );
    const multipleTypes = new Set(indicators.map((i) => i.type.split('_').pop())).size > 1;

    if (hasAbsoluteSpike && confidence >= 80) {
      return Severity.CRITICAL;
    }
    if (hasAbsoluteSpike || (multipleTypes && confidence >= 70)) {
      return Severity.HIGH;
    }
    if (confidence >= 60) {
      return Severity.MEDIUM;
    }
    return Severity.LOW;
  }

  /**
   * Generate human-readable description
   */
  private generateDescription(indicators: Indicator[]): string {
    const types: string[] = [];

    if (indicators.some((i) => i.type.includes('_user'))) {
      types.push('user');
    }
    if (indicators.some((i) => i.type.includes('_ip'))) {
      types.push('IP');
    }
    if (indicators.some((i) => i.type.includes('_endpoint'))) {
      types.push('endpoint');
    }

    const isAbsolute = indicators.some((i) => i.type.startsWith('absolute'));

    if (isAbsolute) {
      return `Volume spike detected: ${types.join(', ')} exceeded absolute limits`;
    }

    return `Unusual volume pattern detected for ${types.join(', ')} based on historical baseline`;
  }
}

/**
 * Create a new volume detector instance
 */
export function createVolumeDetector(
  config?: Partial<VolumeDetectorConfig>,
  countPrefix?: string,
  baselinePrefix?: string
): VolumeDetector {
  return new VolumeDetector(config, countPrefix, baselinePrefix);
}
