/**
 * Temporal Anomaly Detector
 *
 * Detects unusual access time patterns by:
 * - Comparing access times against configured normal hours
 * - Learning user-specific access patterns over time
 * - Flagging access outside established behavioral baselines
 *
 * Uses statistical analysis to determine when access times deviate
 * significantly from learned patterns.
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/temporal
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../../common/logger.js';
import { getRedis } from '../../../common/redis.js';
import type {
  Detector,
  DetectionResult,
  SecurityEvent,
  TemporalDetectorConfig,
  UserAccessPattern,
  Indicator,
  AnomalySeverity,
} from '../types.js';
import {
  DEFAULT_TEMPORAL_DETECTOR_CONFIG,
  AnomalySeverity as Severity,
} from '../types.js';

const logger = createLogger({ component: 'temporal-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for temporal patterns */
const TEMPORAL_PATTERN_PREFIX = 'vorion:anomaly:temporal:pattern:';

/** Redis key prefix for global temporal stats */
const TEMPORAL_GLOBAL_PREFIX = 'vorion:anomaly:temporal:global';

/** Time-to-live for pattern records in seconds (90 days) */
const PATTERN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Number of hours in a day */
const HOURS_IN_DAY = 24;

/** Number of days in a week */
const DAYS_IN_WEEK = 7;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get hour and day of week from a date in a specific timezone
 */
function getTimeParts(
  date: Date,
  timezone?: string
): { hour: number; dayOfWeek: number } {
  try {
    if (timezone) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
        weekday: 'short',
      });
      const parts = formatter.formatToParts(date);
      const hourPart = parts.find((p) => p.type === 'hour');
      const dayPart = parts.find((p) => p.type === 'weekday');

      const hour = hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayOfWeek = dayPart ? dayMap[dayPart.value] ?? date.getUTCDay() : date.getUTCDay();

      return { hour, dayOfWeek };
    }
  } catch {
    // Fall back to UTC if timezone is invalid
  }

  return {
    hour: date.getUTCHours(),
    dayOfWeek: date.getUTCDay(),
  };
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Create an empty access pattern
 */
function createEmptyPattern(userId: string): UserAccessPattern {
  return {
    userId,
    hourHistogram: new Array(HOURS_IN_DAY).fill(0),
    dayHistogram: new Array(DAYS_IN_WEEK).fill(0),
    totalEvents: 0,
    lastUpdated: new Date(),
  };
}

// =============================================================================
// Temporal Detector Implementation
// =============================================================================

/**
 * Temporal anomaly detector for unusual access times
 */
export class TemporalDetector implements Detector {
  public readonly name = 'temporal';
  public readonly description =
    'Detects unusual access times based on configured hours and learned user patterns';

  private readonly config: TemporalDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<TemporalDetectorConfig> = {},
    keyPrefix: string = TEMPORAL_PATTERN_PREFIX
  ) {
    this.config = { ...DEFAULT_TEMPORAL_DETECTOR_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for temporal anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      // Get time parts in the user's timezone if available
      const timezone = event.location?.timezone;
      const { hour, dayOfWeek } = getTimeParts(event.timestamp, timezone);

      // Check against configured normal hours
      const normalHoursResult = this.checkNormalHours(hour, dayOfWeek);
      if (!normalHoursResult.isNormal) {
        indicators.push(...normalHoursResult.indicators);
        suggestedActions.push(
          'Verify this access was expected at this time',
          'Consider if user might be traveling or working remotely'
        );
      }

      // Check against user-specific patterns if available
      if (event.userId && this.config.learnUserPatterns) {
        const pattern = await this.getUserPattern(event.userId);

        if (pattern && pattern.totalEvents >= this.config.minEventsForBaseline) {
          const patternResult = this.checkAgainstPattern(hour, dayOfWeek, pattern);
          if (patternResult.isUnusual) {
            indicators.push(...patternResult.indicators);
            suggestedActions.push(
              'Review if user schedule has changed',
              'Consider requiring additional authentication for unusual time access'
            );
          }
        }
      }

      // Calculate overall result
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
        confidence = Math.min(100, totalWeight);
        severity = this.calculateSeverity(confidence, indicators);
        description = this.generateDescription(hour, dayOfWeek, indicators, timezone);
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
      logger.error({ error, eventId: event.eventId }, 'Temporal detection failed');

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
   * Learn from an event by updating user patterns
   */
  async learn(event: SecurityEvent): Promise<void> {
    if (!event.userId || !this.config.learnUserPatterns) {
      return;
    }

    try {
      const timezone = event.location?.timezone;
      const { hour, dayOfWeek } = getTimeParts(event.timestamp, timezone);

      const key = this.getPatternKey(event.userId);

      // Get existing pattern or create new one
      let pattern = await this.getUserPattern(event.userId);
      if (!pattern) {
        pattern = createEmptyPattern(event.userId);
      }

      // Update histograms
      pattern.hourHistogram[hour]++;
      pattern.dayHistogram[dayOfWeek]++;
      pattern.totalEvents++;
      pattern.lastUpdated = new Date();

      // Store updated pattern
      await this.redis.set(key, JSON.stringify(pattern), 'EX', PATTERN_TTL_SECONDS);

      // Also update global stats
      await this.updateGlobalStats(hour, dayOfWeek);

      logger.debug(
        { userId: event.userId, hour, dayOfWeek, totalEvents: pattern.totalEvents },
        'Updated temporal pattern'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to update temporal pattern');
    }
  }

  /**
   * Reset all learned patterns
   */
  async reset(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}*`;
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

      // Also reset global stats
      await this.redis.del(TEMPORAL_GLOBAL_PREFIX);

      logger.info('Temporal detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset temporal detector');
      throw error;
    }
  }

  /**
   * Get user's access pattern from Redis
   */
  private async getUserPattern(userId: string): Promise<UserAccessPattern | null> {
    const key = this.getPatternKey(userId);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        lastUpdated: new Date(parsed.lastUpdated),
      } as UserAccessPattern;
    } catch {
      return null;
    }
  }

  /**
   * Get Redis key for user's pattern
   */
  private getPatternKey(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  /**
   * Check if access time is within configured normal hours
   */
  private checkNormalHours(
    hour: number,
    dayOfWeek: number
  ): { isNormal: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    // Check if day is normal
    const isDayNormal = this.config.normalDays.includes(dayOfWeek);

    // Check if hour is within normal range
    let isHourNormal: boolean;
    if (this.config.normalHoursStart <= this.config.normalHoursEnd) {
      // Normal range doesn't cross midnight
      isHourNormal =
        hour >= this.config.normalHoursStart && hour < this.config.normalHoursEnd;
    } else {
      // Normal range crosses midnight (e.g., 22:00 - 06:00)
      isHourNormal =
        hour >= this.config.normalHoursStart || hour < this.config.normalHoursEnd;
    }

    if (!isDayNormal) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      indicators.push({
        type: 'unusual_day',
        description: `Access on ${dayNames[dayOfWeek]} which is outside normal working days`,
        value: dayOfWeek,
        weight: 30,
      });
    }

    if (!isHourNormal) {
      indicators.push({
        type: 'unusual_hour',
        description: `Access at ${hour}:00 which is outside normal hours (${this.config.normalHoursStart}:00 - ${this.config.normalHoursEnd}:00)`,
        value: hour,
        weight: 35,
      });
    }

    return { isNormal: indicators.length === 0, indicators };
  }

  /**
   * Check access time against user's learned pattern
   */
  private checkAgainstPattern(
    hour: number,
    dayOfWeek: number,
    pattern: UserAccessPattern
  ): { isUnusual: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    // Calculate hour statistics
    const hourTotal = pattern.hourHistogram.reduce((a, b) => a + b, 0);
    const hourMean = hourTotal / HOURS_IN_DAY;
    const hourStdDev = calculateStdDev(pattern.hourHistogram, hourMean);
    const hourCount = pattern.hourHistogram[hour];
    const hourZScore = hourStdDev > 0 ? (hourCount - hourMean) / hourStdDev : 0;

    // Calculate day statistics
    const dayTotal = pattern.dayHistogram.reduce((a, b) => a + b, 0);
    const dayMean = dayTotal / DAYS_IN_WEEK;
    const dayStdDev = calculateStdDev(pattern.dayHistogram, dayMean);
    const dayCount = pattern.dayHistogram[dayOfWeek];
    const dayZScore = dayStdDev > 0 ? (dayCount - dayMean) / dayStdDev : 0;

    // Check if hour is unusual (significantly below average)
    // Using z-score < -1.5 as threshold for "unusual"
    if (hourZScore < -1.5 && hourCount < hourMean * 0.2) {
      const hourPercentage = hourTotal > 0
        ? Math.round((hourCount / hourTotal) * 100)
        : 0;
      indicators.push({
        type: 'unusual_hour_pattern',
        description: `Access at ${hour}:00 is unusual for this user (only ${hourPercentage}% of past activity)`,
        value: hourPercentage,
        weight: 40,
      });
    }

    // Check if day is unusual
    if (dayZScore < -1.5 && dayCount < dayMean * 0.2) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayPercentage = dayTotal > 0
        ? Math.round((dayCount / dayTotal) * 100)
        : 0;
      indicators.push({
        type: 'unusual_day_pattern',
        description: `Access on ${dayNames[dayOfWeek]} is unusual for this user (only ${dayPercentage}% of past activity)`,
        value: dayPercentage,
        weight: 35,
      });
    }

    // Check for first-time access at this hour
    if (hourCount === 0 && pattern.totalEvents >= this.config.minEventsForBaseline) {
      indicators.push({
        type: 'first_time_hour',
        description: `First recorded access at ${hour}:00 after ${pattern.totalEvents} previous events`,
        value: hour,
        weight: 25,
      });
    }

    return { isUnusual: indicators.length > 0, indicators };
  }

  /**
   * Update global temporal statistics
   */
  private async updateGlobalStats(hour: number, dayOfWeek: number): Promise<void> {
    try {
      await this.redis.hincrby(TEMPORAL_GLOBAL_PREFIX, `hour:${hour}`, 1);
      await this.redis.hincrby(TEMPORAL_GLOBAL_PREFIX, `day:${dayOfWeek}`, 1);
      await this.redis.hincrby(TEMPORAL_GLOBAL_PREFIX, 'total', 1);
    } catch (error) {
      logger.warn({ error }, 'Failed to update global temporal stats');
    }
  }

  /**
   * Calculate severity based on confidence and indicators
   */
  private calculateSeverity(
    confidence: number,
    indicators: Indicator[]
  ): AnomalySeverity {
    const hasPatternDeviation = indicators.some(
      (i) => i.type === 'unusual_hour_pattern' || i.type === 'unusual_day_pattern'
    );
    const hasConfiguredDeviation = indicators.some(
      (i) => i.type === 'unusual_hour' || i.type === 'unusual_day'
    );

    // Higher severity if both learned pattern and configured hours are violated
    if (hasPatternDeviation && hasConfiguredDeviation) {
      if (confidence >= 80) return Severity.HIGH;
      return Severity.MEDIUM;
    }

    if (confidence >= 70) return Severity.MEDIUM;
    return Severity.LOW;
  }

  /**
   * Generate human-readable description
   */
  private generateDescription(
    hour: number,
    dayOfWeek: number,
    indicators: Indicator[],
    timezone?: string
  ): string {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timeStr = `${hour.toString().padStart(2, '0')}:00`;
    const tzStr = timezone ? ` (${timezone})` : '';

    const parts: string[] = [
      `Unusual access time detected: ${dayNames[dayOfWeek]} at ${timeStr}${tzStr}`,
    ];

    const patternIndicators = indicators.filter(
      (i) => i.type.includes('pattern') || i.type === 'first_time_hour'
    );
    if (patternIndicators.length > 0) {
      parts.push('This deviates from the user\'s established access patterns');
    }

    return parts.join('. ');
  }
}

/**
 * Create a new temporal detector instance
 */
export function createTemporalDetector(
  config?: Partial<TemporalDetectorConfig>,
  keyPrefix?: string
): TemporalDetector {
  return new TemporalDetector(config, keyPrefix);
}
